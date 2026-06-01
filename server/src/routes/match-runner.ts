// Endpoints for running a match live: state machine (begin / pause / resume /
// end half / complete), event log (goals, subs, notes).
//
// State machine phases stored on matches.live_state:
//   pre_match  → first_half → halftime → second_half → post_match
// POST /complete sets matches.status = 'completed' and cascades playtime.

import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  matchEvents,
  matchPlayers,
  matchSegments,
  matches,
  players,
  segmentPositions,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTeam } from '../middleware/team.js';
import { HttpError } from '../middleware/error.js';

export const matchRunnerRouter = Router({ mergeParams: true });
matchRunnerRouter.use(requireAuth, requireTeam);

// ---------- live_state shape ----------

const livePhase = z.enum(['pre_match', 'first_half', 'halftime', 'second_half', 'post_match']);

const liveStateSchema = z.object({
  phase: livePhase,
  halfStartedAt: z.string().datetime().optional(),
  pausedAt: z.string().datetime().nullable().optional(),
  totalPausedMs: z.number().int().nonnegative().default(0),
  halftimeStartedAt: z.string().datetime().optional(),
  half1EndClockSec: z.number().int().optional(),
  half2EndClockSec: z.number().int().optional(),
  // Developer-mode clock acceleration. Default 1 = real time.
  clockMultiplier: z.number().positive().max(120).optional(),
});
type LiveState = z.infer<typeof liveStateSchema>;

function parseLive(raw: unknown): LiveState | null {
  if (raw == null) return null;
  return liveStateSchema.parse(raw);
}

function currentClockSec(live: LiveState, now: Date): number {
  if (!live.halfStartedAt) return 0;
  const mult = live.clockMultiplier ?? 1;
  const halfStart = new Date(live.halfStartedAt).getTime();
  const nowMs = now.getTime();
  const pausedMs = live.pausedAt
    ? live.totalPausedMs + (nowMs - new Date(live.pausedAt).getTime())
    : live.totalPausedMs;
  const realActiveMs = nowMs - halfStart - pausedMs;
  return Math.floor((realActiveMs * mult) / 1000);
}

async function loadMatch(teamId: string, id: string) {
  const [m] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.id, id), eq(matches.teamId, teamId)))
    .limit(1);
  if (!m) throw new HttpError(404, 'Match not found');
  return m;
}

async function setLive(
  matchId: string,
  live: LiveState | null,
  extra?: { status?: 'upcoming' | 'in_progress' | 'completed'; myScore?: number; opponentScore?: number },
) {
  await db
    .update(matches)
    .set({
      liveState: live as unknown as object,
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.myScore !== undefined ? { myScore: extra.myScore } : {}),
      ...(extra?.opponentScore !== undefined ? { opponentScore: extra.opponentScore } : {}),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));
}

async function recordEvent(
  matchId: string,
  eventType: string,
  payload: object,
  matchClockSeconds: number,
  half: number,
) {
  await db.insert(matchEvents).values({
    matchId,
    eventType,
    payload,
    matchClockSeconds,
    half,
  });
}

// ---------- field_state ----------

type FieldSlot = { playerId: string; slot: number | null; isGoalie: boolean };
type FieldState = {
  currentSegmentIdx: number;
  field: FieldSlot[];
  reserves: string[];
  sickBay: string[];
};

const fieldStateSchema = z.object({
  currentSegmentIdx: z.number().int().nonnegative(),
  field: z.array(
    z.object({
      playerId: z.string().uuid(),
      slot: z.number().int().nullable(),
      isGoalie: z.boolean(),
    }),
  ),
  reserves: z.array(z.string().uuid()),
  sickBay: z.array(z.string().uuid()),
});

function parseField(raw: unknown): FieldState | null {
  if (raw == null) return null;
  return fieldStateSchema.parse(raw);
}

async function loadFieldStateOrThrow(matchId: string): Promise<{ match: typeof matches.$inferSelect; fs: FieldState }> {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!m) throw new HttpError(404, 'Match not found');
  const fs = parseField(m.fieldState);
  if (!fs) throw new HttpError(400, 'Match has not been started yet');
  return { match: m, fs };
}

async function setFieldState(matchId: string, fs: FieldState) {
  await db
    .update(matches)
    .set({ fieldState: fs as unknown as object, updatedAt: new Date() })
    .where(eq(matches.id, matchId));
}

// Build field_state for a given segment index from the planned positions.
async function fieldStateFromSegment(matchId: string, segmentIdx: number): Promise<FieldState> {
  const segs = await db
    .select()
    .from(matchSegments)
    .where(eq(matchSegments.matchId, matchId))
    .orderBy(asc(matchSegments.segmentIndex));
  const seg = segs.find((s) => s.segmentIndex === segmentIdx);
  if (!seg) throw new HttpError(400, `Segment ${segmentIdx} not found`);

  const positions = await db
    .select()
    .from(segmentPositions)
    .where(eq(segmentPositions.segmentId, seg.id));

  // Load match for full available player set.
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!m) throw new HttpError(404, 'Match not found');
  const availableRows = await db
    .select({ playerId: matchPlayers.playerId })
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, matchId));
  const available = new Set(availableRows.map((r) => r.playerId));

  const field: FieldSlot[] = [];
  const reserves: string[] = [];
  const placed = new Set<string>();
  for (const p of positions) {
    if (!available.has(p.playerId)) continue;
    if (p.isField) {
      field.push({ playerId: p.playerId, slot: p.positionSlot, isGoalie: p.isGoalie });
    } else {
      reserves.push(p.playerId);
    }
    placed.add(p.playerId);
  }
  // Any available player not placed yet becomes a reserve.
  for (const pid of available) {
    if (!placed.has(pid)) reserves.push(pid);
  }

  return { currentSegmentIdx: segmentIdx, field, reserves, sickBay: [] };
}

// Apply the rotation from current field state to the next segment's plan.
//
// Sick-bay players are untouched. We only apply swaps where BOTH sides are
// actually possible: if a planned coming-on player is in the sick bay, the
// corresponding going-off player stays on the field rather than vacating to
// an empty slot. This means the number of swaps applied is bounded by the
// number of available reserves (not by the number of planned field changes).
async function applyRotation(
  matchId: string,
  fs: FieldState,
  toSegmentIdx: number,
): Promise<{ fs: FieldState; swaps: { outPlayerId: string; inPlayerId: string; slot: number | null }[] }> {
  const segs = await db
    .select()
    .from(matchSegments)
    .where(eq(matchSegments.matchId, matchId));
  const target = segs.find((s) => s.segmentIndex === toSegmentIdx);
  if (!target) throw new HttpError(400, `Target segment ${toSegmentIdx} not found`);
  const targetPositions = await db
    .select()
    .from(segmentPositions)
    .where(eq(segmentPositions.segmentId, target.id));

  const plannedField = new Map<string, { slot: number | null; isGoalie: boolean }>();
  for (const tp of targetPositions) {
    if (tp.isField && !tp.isGoalie) {
      plannedField.set(tp.playerId, { slot: tp.positionSlot, isGoalie: tp.isGoalie });
    }
  }

  const reservesSet = new Set(fs.reserves);
  const currentField = fs.field.filter((f) => !f.isGoalie);
  const currentFieldIds = new Set(currentField.map((f) => f.playerId));

  // Candidates.
  const goingOffCandidates = currentField.filter((f) => !plannedField.has(f.playerId));
  const comingOnCandidates: { playerId: string; plannedSlot: number | null }[] = [];
  for (const [playerId, planned] of plannedField) {
    if (!currentFieldIds.has(playerId) && reservesSet.has(playerId)) {
      comingOnCandidates.push({ playerId, plannedSlot: planned.slot });
    }
  }

  // Pair them up — prefer matching by slot so swap-pair highlighting lines up.
  const pairs: { outPlayerId: string; inPlayerId: string; slot: number | null }[] = [];
  const usedOff = new Set<string>();
  const usedOn = new Set<string>();
  for (const c of comingOnCandidates) {
    if (c.plannedSlot === null) continue;
    const partner = goingOffCandidates.find(
      (g) => g.slot === c.plannedSlot && !usedOff.has(g.playerId),
    );
    if (partner) {
      pairs.push({ outPlayerId: partner.playerId, inPlayerId: c.playerId, slot: c.plannedSlot });
      usedOff.add(partner.playerId);
      usedOn.add(c.playerId);
    }
  }
  // Pair the rest by index.
  const restOff = goingOffCandidates.filter((g) => !usedOff.has(g.playerId));
  const restOn = comingOnCandidates.filter((c) => !usedOn.has(c.playerId));
  for (let i = 0; i < Math.min(restOff.length, restOn.length); i++) {
    const g = restOff[i];
    const c = restOn[i];
    pairs.push({
      outPlayerId: g.playerId,
      inPlayerId: c.playerId,
      slot: c.plannedSlot ?? g.slot,
    });
    usedOff.add(g.playerId);
    usedOn.add(c.playerId);
  }

  // Extra reserves not represented in the plan (e.g. rotated back from the
  // sick bay) should also come on. Pair each with a current stayer (a field
  // player planned to remain) so the field stays full. Picks first stayers
  // in order — a fair-rotation tiebreak could refine this later.
  const matchedOnIds = new Set(pairs.map((p) => p.inPlayerId));
  const extraReserves = fs.reserves.filter((id) => !matchedOnIds.has(id));
  if (extraReserves.length > 0) {
    const stayerPool = currentField.filter(
      (f) => plannedField.has(f.playerId) && !usedOff.has(f.playerId),
    );
    for (const incomingId of extraReserves) {
      const stayer = stayerPool.shift();
      if (!stayer) break; // no stayers left to displace
      // Use the stayer's PLANNED slot as the swap slot — that slot was
      // reserved for them by the plan, so it's guaranteed not to clash with
      // another planned-field player. Fall back to current slot otherwise.
      const stayerPlanned = plannedField.get(stayer.playerId);
      pairs.push({
        outPlayerId: stayer.playerId,
        inPlayerId: incomingId,
        slot: stayerPlanned?.slot ?? stayer.slot,
      });
      usedOff.add(stayer.playerId);
      usedOn.add(incomingId);
    }
  }

  const matchedGoingOffIds = new Set(pairs.map((p) => p.outPlayerId));
  const matchedComingOnIds = new Set(pairs.map((p) => p.inPlayerId));

  // ---- Greedy slot assignment ----
  //
  // The previous two-pass approach silently double-claimed a slot when a
  // stayer's planned slot equalled an unmatched going-off's current slot.
  // Rebuild as a single-pass greedy assignment with a preference list per
  // player and a fall-back to any unused planned slot.

  const next: FieldState = {
    currentSegmentIdx: toSegmentIdx,
    field: [],
    reserves: [],
    sickBay: [...fs.sickBay],
  };

  // Goalie unchanged.
  const goalie = fs.field.find((f) => f.isGoalie);
  if (goalie) next.field.push(goalie);

  type Candidate = { playerId: string; preferred: number[] };
  const candidates: Candidate[] = [];

  // Stayers + unmatched going-off — prefer planned slot, fall back to current.
  for (const f of currentField) {
    if (matchedGoingOffIds.has(f.playerId)) continue;
    const planned = plannedField.get(f.playerId);
    const pref: number[] = [];
    if (planned?.slot !== null && planned?.slot !== undefined) pref.push(planned.slot);
    if (f.slot !== null && !pref.includes(f.slot)) pref.push(f.slot);
    candidates.push({ playerId: f.playerId, preferred: pref });
  }

  // Matched coming-on — prefer pair slot, then planned, then going-off slot, then stayer slot.
  for (const pair of pairs) {
    const planned = plannedField.get(pair.inPlayerId);
    const goingOff = goingOffCandidates.find((g) => g.playerId === pair.outPlayerId);
    const stayer = currentField.find((f) => f.playerId === pair.outPlayerId);
    const pref: number[] = [];
    if (pair.slot !== null) pref.push(pair.slot);
    if (planned?.slot !== null && planned?.slot !== undefined && !pref.includes(planned.slot)) {
      pref.push(planned.slot);
    }
    if (goingOff?.slot !== null && goingOff?.slot !== undefined && !pref.includes(goingOff.slot)) {
      pref.push(goingOff.slot);
    }
    if (stayer?.slot !== null && stayer?.slot !== undefined && !pref.includes(stayer.slot)) {
      pref.push(stayer.slot);
    }
    candidates.push({ playerId: pair.inPlayerId, preferred: pref });
  }

  // All planned outfield slots — used as last-resort pool.
  const fallbackSlots: number[] = [];
  for (const p of plannedField.values()) {
    if (p.slot !== null && !fallbackSlots.includes(p.slot)) fallbackSlots.push(p.slot);
  }

  const usedSlots = new Set<number>();
  for (const c of candidates) {
    let slot: number | null = null;
    for (const s of c.preferred) {
      if (!usedSlots.has(s)) {
        slot = s;
        break;
      }
    }
    if (slot === null) {
      for (const s of fallbackSlots) {
        if (!usedSlots.has(s)) {
          slot = s;
          break;
        }
      }
    }
    next.field.push({ playerId: c.playerId, slot, isGoalie: false });
    if (slot !== null) usedSlots.add(slot);
  }

  // Reserves: matched going-off, plus existing reserves who didn't come on.
  for (const pair of pairs) next.reserves.push(pair.outPlayerId);
  for (const r of fs.reserves) {
    if (matchedComingOnIds.has(r)) continue;
    if (!next.reserves.includes(r)) next.reserves.push(r);
  }

  return { fs: next, swaps: pairs };
}

// ---------- State transitions ----------

matchRunnerRouter.post('/:id/begin', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  if (match.status === 'completed') throw new HttpError(400, 'Match already finished');
  const live = parseLive(match.liveState);
  if (live && live.phase !== 'pre_match') {
    throw new HttpError(400, 'Match already started');
  }
  const now = new Date().toISOString();
  const next: LiveState = {
    phase: 'first_half',
    halfStartedAt: now,
    pausedAt: null,
    totalPausedMs: 0,
  };
  const fs = await fieldStateFromSegment(match.id, 0);
  await setLive(match.id, next, { status: 'in_progress', myScore: 0, opponentScore: 0 });
  await setFieldState(match.id, fs);
  await recordEvent(match.id, 'half_start', { half: 1 }, 0, 1);
  res.json({ liveState: next, fieldState: fs });
});

matchRunnerRouter.post('/:id/pause', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (!live || (live.phase !== 'first_half' && live.phase !== 'second_half')) {
    throw new HttpError(400, 'Cannot pause from this phase');
  }
  if (live.pausedAt) {
    res.json({ liveState: live });
    return;
  }
  const now = new Date();
  const next: LiveState = { ...live, pausedAt: now.toISOString() };
  await setLive(match.id, next);
  await recordEvent(match.id, 'pause', {}, currentClockSec(live, now), live.phase === 'first_half' ? 1 : 2);
  res.json({ liveState: next });
});

matchRunnerRouter.post('/:id/resume', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (!live || (live.phase !== 'first_half' && live.phase !== 'second_half')) {
    throw new HttpError(400, 'Cannot resume from this phase');
  }
  if (!live.pausedAt) {
    res.json({ liveState: live });
    return;
  }
  const now = new Date();
  const pausedAt = new Date(live.pausedAt).getTime();
  const next: LiveState = {
    ...live,
    pausedAt: null,
    totalPausedMs: live.totalPausedMs + (now.getTime() - pausedAt),
  };
  await setLive(match.id, next);
  await recordEvent(match.id, 'resume', {}, currentClockSec(next, now), live.phase === 'first_half' ? 1 : 2);
  res.json({ liveState: next });
});

matchRunnerRouter.post('/:id/end-half', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (!live) throw new HttpError(400, 'Match not in progress');

  const now = new Date();

  if (live.phase === 'first_half') {
    const resolved: LiveState = live.pausedAt
      ? { ...live, totalPausedMs: live.totalPausedMs + (now.getTime() - new Date(live.pausedAt).getTime()), pausedAt: null }
      : live;
    const clockSec = currentClockSec(resolved, now);
    const next: LiveState = {
      ...live,
      phase: 'halftime',
      totalPausedMs: 0,
      pausedAt: null,
      halftimeStartedAt: now.toISOString(),
      half1EndClockSec: clockSec,
    };
    await setLive(match.id, next);
    await recordEvent(match.id, 'half_end', { half: 1, finalClockSec: clockSec }, clockSec, 1);

    // Auto-apply the rotation that brings the second-half starting lineup
    // onto the field. Coach wanted this to happen on End First Half (not on
    // Begin Second Half), so the halftime break starts with the new lineup
    // already in place.
    const fs = parseField(match.fieldState);
    const segmentsPerHalf = (match.substitutionWindows + 1) / 2;
    if (fs && fs.currentSegmentIdx < segmentsPerHalf) {
      const targetIdx = segmentsPerHalf; // first segment of second half
      const segs = await db
        .select()
        .from(matchSegments)
        .where(eq(matchSegments.matchId, match.id))
        .orderBy(asc(matchSegments.segmentIndex));
      if (segs.find((s) => s.segmentIndex === targetIdx)) {
        const { fs: rotated, swaps } = await applyRotation(match.id, fs, targetIdx);
        await setFieldState(match.id, rotated);
        await recordEvent(
          match.id,
          'segment_advance',
          { fromSegment: fs.currentSegmentIdx, toSegment: targetIdx, scheduled: true, swaps },
          clockSec,
          1,
        );
        res.json({ liveState: next, fieldState: rotated });
        return;
      }
    }
    res.json({ liveState: next });
    return;
  }

  if (live.phase === 'second_half') {
    const resolved: LiveState = live.pausedAt
      ? { ...live, totalPausedMs: live.totalPausedMs + (now.getTime() - new Date(live.pausedAt).getTime()), pausedAt: null }
      : live;
    const clockSec = currentClockSec(resolved, now);
    const next: LiveState = {
      ...live,
      phase: 'post_match',
      totalPausedMs: 0,
      pausedAt: null,
      half2EndClockSec: clockSec,
    };
    await setLive(match.id, next);
    await recordEvent(match.id, 'half_end', { half: 2, finalClockSec: clockSec }, clockSec, 2);
    res.json({ liveState: next });
    return;
  }

  throw new HttpError(400, `Cannot end half from phase ${live.phase}`);
});

matchRunnerRouter.post('/:id/begin-second-half', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (!live || live.phase !== 'halftime') {
    throw new HttpError(400, 'Cannot begin second half from this phase');
  }
  const now = new Date();
  const next: LiveState = {
    ...live,
    phase: 'second_half',
    halfStartedAt: now.toISOString(),
    pausedAt: null,
    totalPausedMs: 0,
  };
  await setLive(match.id, next);
  await recordEvent(match.id, 'half_start', { half: 2 }, 0, 2);

  // No rotation here — End First Half already moved the lineup to the first
  // segment of second half.
  res.json({ liveState: next });
});

// ---------- Rotate Substitutes (manual sub window) ----------

matchRunnerRouter.post('/:id/rotate-substitutes', async (req, res) => {
  const { match, fs } = await loadFieldStateOrThrow(req.params.id);
  if (match.teamId !== req.teamId!) throw new HttpError(403, 'Not your team');

  const targetIdx = fs.currentSegmentIdx + 1;
  const { fs: rotated, swaps } = await applyRotation(match.id, fs, targetIdx);
  await setFieldState(match.id, rotated);
  const live = parseLive(match.liveState);
  const half = live?.phase === 'second_half' ? 2 : 1;
  const clock = live ? currentClockSec(live, new Date()) : 0;
  await recordEvent(
    match.id,
    'segment_advance',
    { fromSegment: fs.currentSegmentIdx, toSegment: targetIdx, scheduled: false, swaps },
    clock,
    half,
  );
  res.json({ fieldState: rotated, swaps });
});

// ---------- Developer mode: clock multiplier ----------
//
// Sets a clock-speed multiplier on the live state so testers can blow through
// a 50-minute match in a few real minutes. Multiplier of 1 = real time;
// 60 = each real second is one game minute. Changing this MID-MATCH causes
// the displayed clock to jump (this is intentional — the user is testing).

matchRunnerRouter.post('/:id/dev/clock-multiplier', async (req, res) => {
  const schema = z.object({ multiplier: z.number().positive().max(120) });
  const { multiplier } = schema.parse(req.body);
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (!live) throw new HttpError(400, 'Match has not been started');
  const next: LiveState = { ...live, clockMultiplier: multiplier };
  await setLive(match.id, next);
  res.json({ liveState: next });
});

// ---------- Move a reserve straight into the sick bay ----------

matchRunnerRouter.post('/:id/to-sick-bay', async (req, res) => {
  const schema = z.object({ playerId: z.string().uuid() });
  const { playerId } = schema.parse(req.body);
  const { match, fs } = await loadFieldStateOrThrow(req.params.id);
  if (match.teamId !== req.teamId!) throw new HttpError(403, 'Not your team');

  if (!fs.reserves.includes(playerId)) {
    throw new HttpError(400, 'Player is not currently in reserves');
  }
  const next: FieldState = {
    ...fs,
    reserves: fs.reserves.filter((id) => id !== playerId),
    sickBay: [...fs.sickBay, playerId],
  };
  await setFieldState(match.id, next);
  const live = parseLive(match.liveState);
  const half = live?.phase === 'second_half' ? 2 : 1;
  const clock = live ? currentClockSec(live, new Date()) : 0;
  await recordEvent(match.id, 'reserve_to_sick_bay', { playerId }, clock, half);
  res.json({ fieldState: next });
});

// ---------- Rotate sick-bay player back into reserves ----------

matchRunnerRouter.post('/:id/rotate-back', async (req, res) => {
  const schema = z.object({ playerId: z.string().uuid() });
  const { playerId } = schema.parse(req.body);
  const { match, fs } = await loadFieldStateOrThrow(req.params.id);
  if (match.teamId !== req.teamId!) throw new HttpError(403, 'Not your team');

  if (!fs.sickBay.includes(playerId)) {
    throw new HttpError(400, 'Player is not in the sick bay');
  }
  const next: FieldState = {
    ...fs,
    sickBay: fs.sickBay.filter((id) => id !== playerId),
    reserves: [...fs.reserves, playerId],
  };
  await setFieldState(match.id, next);
  const live = parseLive(match.liveState);
  const half = live?.phase === 'second_half' ? 2 : 1;
  const clock = live ? currentClockSec(live, new Date()) : 0;
  await recordEvent(match.id, 'rotate_back', { playerId }, clock, half);
  res.json({ fieldState: next });
});

// ---------- Events ----------

const goalPayload = z.object({
  side: z.enum(['us', 'opp']),
  playerId: z.string().uuid().optional(),
});
const substitutionPayload = z.object({
  outPlayerId: z.string().uuid(),
  inPlayerId: z.string().uuid(),
  reason: z.enum(['exhaustion', 'injury', 'other']),
  reasonText: z.string().max(200).optional(),
});
const positionSwitchPayload = z.object({
  playerAId: z.string().uuid(),
  playerBId: z.string().uuid(),
});
const notePayload = z.object({ text: z.string().min(1).max(2000) });

const eventInputSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('goal'), payload: goalPayload }),
  z.object({ eventType: z.literal('substitution'), payload: substitutionPayload }),
  z.object({ eventType: z.literal('position_switch'), payload: positionSwitchPayload }),
  z.object({ eventType: z.literal('note'), payload: notePayload }),
]);

matchRunnerRouter.post('/:id/events', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const data = eventInputSchema.parse(req.body);
  const live = parseLive(match.liveState);
  if (!live) throw new HttpError(400, 'Match has not been started');

  let half = 1;
  let clockSec = 0;
  const now = new Date();
  if (live.phase === 'first_half') {
    half = 1;
    clockSec = currentClockSec(live, now);
  } else if (live.phase === 'second_half') {
    half = 2;
    clockSec = currentClockSec(live, now);
  } else if (live.phase === 'halftime') {
    half = 1;
    clockSec = live.half1EndClockSec ?? 0;
  } else if (live.phase === 'post_match') {
    half = 2;
    clockSec = live.half2EndClockSec ?? 0;
  }

  // Mutate field_state for state-changing events.
  const fs = parseField(match.fieldState);
  let updatedFieldState: FieldState | undefined;

  if (data.eventType === 'substitution' && fs) {
    const { outPlayerId, inPlayerId, reason } = data.payload;
    const out = fs.field.find((f) => f.playerId === outPlayerId);
    if (!out) throw new HttpError(400, 'Out player is not on the field');
    const inFromReserves = fs.reserves.includes(inPlayerId);
    const inFromSick = fs.sickBay.includes(inPlayerId);
    if (!inFromReserves && !inFromSick) {
      throw new HttpError(400, 'In player must come from reserves or sick bay');
    }
    // Exhaustion subs go straight back to reserves (eligible for next window).
    // Injury and Other stay in sick bay until manually rotated back.
    const outGoesToReserves = reason === 'exhaustion';
    updatedFieldState = {
      ...fs,
      field: fs.field
        .filter((f) => f.playerId !== outPlayerId)
        .concat({ playerId: inPlayerId, slot: out.slot, isGoalie: out.isGoalie }),
      reserves: outGoesToReserves
        ? fs.reserves.filter((id) => id !== inPlayerId).concat(outPlayerId)
        : fs.reserves.filter((id) => id !== inPlayerId),
      sickBay: outGoesToReserves
        ? fs.sickBay.filter((id) => id !== inPlayerId)
        : fs.sickBay.filter((id) => id !== inPlayerId).concat(outPlayerId),
    };
  } else if (data.eventType === 'position_switch' && fs) {
    const { playerAId, playerBId } = data.payload;
    const a = fs.field.find((f) => f.playerId === playerAId);
    const b = fs.field.find((f) => f.playerId === playerBId);
    if (!a || !b) throw new HttpError(400, 'Both players must be on the field for a switch');
    updatedFieldState = {
      ...fs,
      field: fs.field.map((f) => {
        if (f.playerId === playerAId) return { ...f, slot: b.slot, isGoalie: b.isGoalie };
        if (f.playerId === playerBId) return { ...f, slot: a.slot, isGoalie: a.isGoalie };
        return f;
      }),
    };
  }

  let scoreUpdate: { myScore?: number; opponentScore?: number } | undefined;
  if (data.eventType === 'goal') {
    if (data.payload.side === 'us') {
      scoreUpdate = { myScore: (match.myScore ?? 0) + 1 };
    } else {
      scoreUpdate = { opponentScore: (match.opponentScore ?? 0) + 1 };
    }
  }

  const [event] = await db
    .insert(matchEvents)
    .values({
      matchId: match.id,
      occurredAt: now,
      matchClockSeconds: clockSec,
      half,
      eventType: data.eventType,
      payload: data.payload,
    })
    .returning();

  if (scoreUpdate) {
    await db.update(matches).set({ ...scoreUpdate, updatedAt: now }).where(eq(matches.id, match.id));
  }
  if (updatedFieldState) await setFieldState(match.id, updatedFieldState);

  res.json({ event, scoreUpdate, fieldState: updatedFieldState });
});

matchRunnerRouter.get('/:id/events', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, match.id))
    .orderBy(asc(matchEvents.occurredAt));
  res.json({ events: rows });
});

matchRunnerRouter.delete('/:id/events/:eventId', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const [event] = await db
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.id, req.params.eventId), eq(matchEvents.matchId, match.id)))
    .limit(1);
  if (!event) throw new HttpError(404, 'Event not found');

  await db.delete(matchEvents).where(eq(matchEvents.id, event.id));

  if (event.eventType === 'goal') {
    const payload = event.payload as { side: 'us' | 'opp' };
    if (payload.side === 'us') {
      await db
        .update(matches)
        .set({ myScore: Math.max(0, (match.myScore ?? 0) - 1) })
        .where(eq(matches.id, match.id));
    } else {
      await db
        .update(matches)
        .set({ opponentScore: Math.max(0, (match.opponentScore ?? 0) - 1) })
        .where(eq(matches.id, match.id));
    }
  }
  res.json({ ok: true });
});

// ---------- Complete: finalize, accumulate playtime, cascade-recalc ----------

matchRunnerRouter.post('/:id/complete', async (req, res) => {
  const match = await loadMatch(req.teamId!, req.params.id);
  const live = parseLive(match.liveState);
  if (live && live.phase !== 'post_match') {
    throw new HttpError(400, 'Finish the second half before completing the match');
  }
  if (match.status === 'completed') {
    res.json({ ok: true, alreadyComplete: true });
    return;
  }

  const segments = await db
    .select()
    .from(matchSegments)
    .where(eq(matchSegments.matchId, match.id))
    .orderBy(asc(matchSegments.segmentIndex));
  const segIds = segments.map((s) => s.id);
  const positions = segIds.length
    ? await db.select().from(segmentPositions).where(inArray(segmentPositions.segmentId, segIds))
    : [];

  const segLengthSec = (match.halfLengthMinutes * 2 * 60) / (match.substitutionWindows + 1);
  const totalMatchSec =
    (live?.half1EndClockSec ?? match.halfLengthMinutes * 60) +
    (live?.half2EndClockSec ?? match.halfLengthMinutes * 60);

  // Per-player seconds added by this match. Approximation: planned segments
  // count, ignoring manual sub events (a future iteration can refine using
  // the event log).
  const playerSeconds = new Map<string, number>();
  for (const pos of positions) {
    if (!pos.isField || pos.isGoalie) continue;
    playerSeconds.set(
      pos.playerId,
      (playerSeconds.get(pos.playerId) ?? 0) + Math.round(segLengthSec),
    );
  }
  if (match.goaliePlayerId) {
    playerSeconds.set(
      match.goaliePlayerId,
      (playerSeconds.get(match.goaliePlayerId) ?? 0) + Math.round(totalMatchSec),
    );
  }

  // Apply additive update.
  for (const [playerId, secs] of playerSeconds) {
    const [pl] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!pl) continue;
    await db
      .update(players)
      .set({ playTimeSeconds: (pl.playTimeSeconds ?? 0) + Math.max(0, secs) })
      .where(eq(players.id, playerId));
  }

  await setLive(match.id, live ?? null, { status: 'completed' });

  // Cascade recalc: wipe positions on later scheduled matches so they
  // re-autofill with the new playtimes.
  const laterMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.teamId, match.teamId),
        eq(matches.status, 'upcoming'),
        gt(matches.scheduledAt, match.scheduledAt),
      ),
    )
    .orderBy(asc(matches.scheduledAt));
  if (laterMatches.length > 0) {
    const laterSegIds = (
      await db
        .select({ id: matchSegments.id })
        .from(matchSegments)
        .where(inArray(matchSegments.matchId, laterMatches.map((m) => m.id)))
    ).map((r) => r.id);
    if (laterSegIds.length > 0) {
      await db.delete(segmentPositions).where(inArray(segmentPositions.segmentId, laterSegIds));
    }
  }

  res.json({
    ok: true,
    playerSeconds: Object.fromEntries(playerSeconds),
    recalculatedMatches: laterMatches.length,
  });
});
