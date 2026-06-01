import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  matchEvents,
  matchSegments,
  matches,
  players,
  segmentPositions,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTeam } from '../middleware/team.js';
import { HttpError } from '../middleware/error.js';
import { FORMATIONS_BY_PLAYER_COUNT } from '../domain/formations.js';

export const playersRouter = Router();

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  jerseyNumber: z.number().int().min(0).max(99).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  playTimeSeconds: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

playersRouter.use(requireAuth, requireTeam);

playersRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(players)
    .where(eq(players.teamId, req.teamId!))
    .orderBy(asc(players.name));

  // For each player, find their most recently completed match (where they
  // actually had a segment placement) and count reserve segments there. This
  // drives the fair-rotation autofill: a player who was reserved a lot last
  // match plays the field first next match.
  const completed = await db
    .select()
    .from(matches)
    .where(and(eq(matches.teamId, req.teamId!), eq(matches.status, 'completed')))
    .orderBy(desc(matches.scheduledAt));

  const lastReserve = new Map<string, number>();
  if (completed.length > 0) {
    const matchIds = completed.map((m) => m.id);
    const segs = await db
      .select()
      .from(matchSegments)
      .where(inArray(matchSegments.matchId, matchIds));
    const segIds = segs.map((s) => s.id);
    const positions = segIds.length
      ? await db
          .select()
          .from(segmentPositions)
          .where(inArray(segmentPositions.segmentId, segIds))
      : [];
    const segToMatchDate = new Map(
      segs.map((s) => [s.id, completed.find((m) => m.id === s.matchId)?.scheduledAt ?? null]),
    );

    // Group: player → matchId → reserveCount.
    type Bucket = { reserveCount: number; matchDate: Date | null };
    const perPlayer = new Map<string, Map<string, Bucket>>();
    for (const pos of positions) {
      const matchDate = segToMatchDate.get(pos.segmentId) ?? null;
      const matchId = segs.find((s) => s.id === pos.segmentId)?.matchId;
      if (!matchId) continue;
      const pMap = perPlayer.get(pos.playerId) ?? new Map<string, Bucket>();
      const entry = pMap.get(matchId) ?? { reserveCount: 0, matchDate };
      if (!pos.isField) entry.reserveCount += 1;
      pMap.set(matchId, entry);
      perPlayer.set(pos.playerId, pMap);
    }

    for (const [playerId, pMap] of perPlayer) {
      let bestDate: Date | null = null;
      let bestCount = 0;
      for (const bucket of pMap.values()) {
        if (!bucket.matchDate) continue;
        if (!bestDate || bucket.matchDate > bestDate) {
          bestDate = bucket.matchDate;
          bestCount = bucket.reserveCount;
        }
      }
      lastReserve.set(playerId, bestCount);
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    lastMatchReserveCount: lastReserve.get(r.id) ?? 0,
  }));
  res.json({ players: enriched });
});

playersRouter.post('/', async (req, res) => {
  const data = upsertSchema.parse(req.body);
  const [created] = await db
    .insert(players)
    .values({
      teamId: req.teamId!,
      name: data.name,
      jerseyNumber: data.jerseyNumber ?? null,
      photoUrl: data.photoUrl ?? null,
      playTimeSeconds: data.playTimeSeconds ?? 0,
      active: data.active ?? true,
    })
    .returning();
  res.json({ player: created });
});

playersRouter.patch('/:id', async (req, res) => {
  const data = upsertSchema.partial().parse(req.body);
  const [existing] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, req.params.id), eq(players.teamId, req.teamId!)))
    .limit(1);
  if (!existing) throw new HttpError(404, 'Player not found');

  const [updated] = await db
    .update(players)
    .set({
      name: data.name ?? existing.name,
      jerseyNumber: data.jerseyNumber !== undefined ? data.jerseyNumber : existing.jerseyNumber,
      photoUrl: data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
      playTimeSeconds: data.playTimeSeconds ?? existing.playTimeSeconds,
      active: data.active ?? existing.active,
    })
    .where(eq(players.id, existing.id))
    .returning();
  res.json({ player: updated });
});

playersRouter.delete('/:id', async (req, res) => {
  const [existing] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, req.params.id), eq(players.teamId, req.teamId!)))
    .limit(1);
  if (!existing) throw new HttpError(404, 'Player not found');
  await db.delete(players).where(eq(players.id, existing.id));
  res.json({ ok: true });
});

// ---------- Per-player stats across completed matches ----------

playersRouter.get('/:id/stats', async (req, res) => {
  const [pl] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, req.params.id), eq(players.teamId, req.teamId!)))
    .limit(1);
  if (!pl) throw new HttpError(404, 'Player not found');

  const teamMatches = await db
    .select()
    .from(matches)
    .where(and(eq(matches.teamId, req.teamId!), eq(matches.status, 'completed')))
    .orderBy(desc(matches.scheduledAt));

  if (teamMatches.length === 0) {
    res.json({ player: pl, perMatch: [], totals: { matches: 0, secondsPlayed: 0, goals: 0, goalieMatches: 0 } });
    return;
  }

  const matchIds = teamMatches.map((m) => m.id);
  const segs = await db
    .select()
    .from(matchSegments)
    .where(inArray(matchSegments.matchId, matchIds));
  const positionsForPlayer = await db
    .select()
    .from(segmentPositions)
    .where(
      and(
        inArray(segmentPositions.segmentId, segs.map((s) => s.id)),
        eq(segmentPositions.playerId, pl.id),
      ),
    );
  const events = await db
    .select()
    .from(matchEvents)
    .where(inArray(matchEvents.matchId, matchIds));

  type PerMatch = {
    matchId: string;
    opponent: string;
    scheduledAt: string;
    finalScore: { us: number | null; opp: number | null };
    segmentsPlayed: number;
    secondsPlayed: number;
    wasGoalie: boolean;
    positions: { slot: number | null; label: string; seconds: number }[];
    goals: number;
  };
  const perMatch: PerMatch[] = [];

  for (const m of teamMatches) {
    const segsForMatch = segs.filter((s) => s.matchId === m.id);
    const segIds = segsForMatch.map((s) => s.id);
    const playerPositions = positionsForPlayer.filter((p) => segIds.includes(p.segmentId));
    if (playerPositions.length === 0) continue;

    const segLength = (m.halfLengthMinutes * 2 * 60) / (m.substitutionWindows + 1);
    const totalMatchSec = m.halfLengthMinutes * 2 * 60;

    let secondsPlayed = 0;
    let segmentsPlayed = 0;
    let wasGoalie = false;
    const positionBuckets = new Map<string, { slot: number | null; label: string; seconds: number }>();

    for (const pp of playerPositions) {
      if (!pp.isField) continue;
      segmentsPlayed++;
      if (pp.isGoalie) wasGoalie = true;
      const delta = pp.isGoalie ? totalMatchSec / segsForMatch.length : segLength;
      secondsPlayed += Math.round(delta);
      const segMeta = segsForMatch.find((s) => s.id === pp.segmentId);
      const label = pp.isGoalie
        ? 'GK'
        : labelForSlot(segMeta?.playerCount ?? 9, segMeta?.formation ?? '', pp.positionSlot);
      const key = pp.isGoalie ? 'GK' : `${pp.positionSlot ?? 'x'}:${label}`;
      const bucket = positionBuckets.get(key) ?? { slot: pp.positionSlot, label, seconds: 0 };
      bucket.seconds += Math.round(delta);
      positionBuckets.set(key, bucket);
    }

    const goals = events.filter((ev) => {
      if (ev.matchId !== m.id) return false;
      if (ev.eventType !== 'goal') return false;
      const payload = ev.payload as { side: 'us' | 'opp'; playerId?: string };
      return payload.side === 'us' && payload.playerId === pl.id;
    }).length;

    perMatch.push({
      matchId: m.id,
      opponent: m.opponent,
      scheduledAt: m.scheduledAt.toISOString(),
      finalScore: { us: m.myScore, opp: m.opponentScore },
      segmentsPlayed,
      secondsPlayed,
      wasGoalie,
      positions: Array.from(positionBuckets.values()).sort((a, b) => b.seconds - a.seconds),
      goals,
    });
  }

  const totals = perMatch.reduce(
    (acc, pm) => {
      acc.matches += 1;
      acc.secondsPlayed += pm.secondsPlayed;
      acc.goals += pm.goals;
      acc.goalieMatches += pm.wasGoalie ? 1 : 0;
      return acc;
    },
    { matches: 0, secondsPlayed: 0, goals: 0, goalieMatches: 0 },
  );

  res.json({ player: pl, perMatch, totals });
});

function labelForSlot(playerCount: number, formationName: string, slot: number | null): string {
  if (slot === null) return '—';
  const f = FORMATIONS_BY_PLAYER_COUNT[playerCount]?.find((x) => x.name === formationName);
  return f?.positions.find((p) => p.slot === slot)?.label ?? `Slot ${slot}`;
}
