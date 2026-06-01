import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  matches,
  matchPlayers,
  matchSegments,
  segmentPositions,
  players,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTeam } from '../middleware/team.js';
import { HttpError } from '../middleware/error.js';
import {
  FORMATIONS_BY_PLAYER_COUNT,
  isValidFormation,
} from '../domain/formations.js';

export const matchesRouter = Router();

matchesRouter.use(requireAuth, requireTeam);

const createSchema = z.object({
  opponent: z.string().min(1).max(120),
  scheduledAt: z.string().datetime(),
  halfLengthMinutes: z.number().int().min(5).max(60),
  substitutionWindows: z.number().int().min(3).max(5),
  playerCount: z.number().int().min(9).max(9).default(9),
  goaliePlayerId: z.string().uuid().nullable(),
  // Goalie + at least one outfielder.
  availablePlayerIds: z.array(z.string().uuid()).min(2),
});

const updateSchema = createSchema.partial();

// ---------- List ----------

matchesRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(matches)
    .where(eq(matches.teamId, req.teamId!))
    .orderBy(desc(matches.scheduledAt));
  res.json({ matches: rows });
});

// ---------- Get one (with segments + positions + available players) ----------

matchesRouter.get('/:id', async (req, res) => {
  const match = await loadOwnedMatch(req.teamId!, req.params.id);

  const available = await db
    .select({ playerId: matchPlayers.playerId })
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, match.id));

  const segments = await db
    .select()
    .from(matchSegments)
    .where(eq(matchSegments.matchId, match.id))
    .orderBy(asc(matchSegments.segmentIndex));

  const segmentIds = segments.map((s) => s.id);
  const positions = segmentIds.length
    ? await db
        .select()
        .from(segmentPositions)
        .where(inArray(segmentPositions.segmentId, segmentIds))
    : [];

  res.json({
    match,
    availablePlayerIds: available.map((a) => a.playerId),
    segments,
    positions,
  });
});

// ---------- Create ----------

matchesRouter.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  await assertPlayersBelongToTeam(req.teamId!, [
    ...data.availablePlayerIds,
    ...(data.goaliePlayerId ? [data.goaliePlayerId] : []),
  ]);

  if (data.goaliePlayerId && !data.availablePlayerIds.includes(data.goaliePlayerId)) {
    throw new HttpError(400, 'Goalie must also be in the available players list');
  }

  const formation = FORMATIONS_BY_PLAYER_COUNT[data.playerCount]?.[0]?.name;
  if (!formation) throw new HttpError(400, `Unsupported player count: ${data.playerCount}`);

  const [match] = await db
    .insert(matches)
    .values({
      teamId: req.teamId!,
      opponent: data.opponent,
      scheduledAt: new Date(data.scheduledAt),
      halfLengthMinutes: data.halfLengthMinutes,
      substitutionWindows: data.substitutionWindows,
      playerCount: data.playerCount,
      goaliePlayerId: data.goaliePlayerId,
      createdBy: req.user!.id,
    })
    .returning();

  if (data.availablePlayerIds.length > 0) {
    await db.insert(matchPlayers).values(
      data.availablePlayerIds.map((playerId) => ({ matchId: match.id, playerId })),
    );
  }

  // Create N+1 empty segments. Autofill happens client-side once segments and
  // available players are loaded; we just allocate the rows here so the
  // formation editor has somewhere to write to.
  const segmentRows = Array.from({ length: data.substitutionWindows + 1 }, (_v, i) => ({
    matchId: match.id,
    segmentIndex: i,
    formation,
    playerCount: data.playerCount,
  }));
  await db.insert(matchSegments).values(segmentRows);

  res.json({ match });
});

// ---------- Update (basic fields only — segment edits are a separate endpoint) ----------

matchesRouter.patch('/:id', async (req, res) => {
  const match = await loadOwnedMatch(req.teamId!, req.params.id);
  const data = updateSchema.parse(req.body);

  if (data.goaliePlayerId !== undefined && data.goaliePlayerId !== null) {
    await assertPlayersBelongToTeam(req.teamId!, [data.goaliePlayerId]);
  }
  if (data.availablePlayerIds) {
    await assertPlayersBelongToTeam(req.teamId!, data.availablePlayerIds);
  }

  if (match.status !== 'upcoming') {
    throw new HttpError(400, 'Cannot edit a match that has already started');
  }

  // Decide whether segment positions need to be wiped. We wipe whenever the
  // change can invalidate existing placements: goalie change, availability
  // change, sub-window resize, or player-count change.
  const playerChanges =
    (data.goaliePlayerId !== undefined && data.goaliePlayerId !== match.goaliePlayerId) ||
    !!data.availablePlayerIds ||
    !!data.playerCount ||
    (!!data.substitutionWindows && data.substitutionWindows !== match.substitutionWindows);

  const [updated] = await db
    .update(matches)
    .set({
      opponent: data.opponent ?? match.opponent,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : match.scheduledAt,
      halfLengthMinutes: data.halfLengthMinutes ?? match.halfLengthMinutes,
      substitutionWindows: data.substitutionWindows ?? match.substitutionWindows,
      playerCount: data.playerCount ?? match.playerCount,
      goaliePlayerId:
        data.goaliePlayerId !== undefined ? data.goaliePlayerId : match.goaliePlayerId,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, match.id))
    .returning();

  if (data.availablePlayerIds) {
    await db.delete(matchPlayers).where(eq(matchPlayers.matchId, match.id));
    if (data.availablePlayerIds.length > 0) {
      await db.insert(matchPlayers).values(
        data.availablePlayerIds.map((playerId) => ({ matchId: match.id, playerId })),
      );
    }
  }

  // Resize segments if the sub-window count changed.
  if (data.substitutionWindows && data.substitutionWindows !== match.substitutionWindows) {
    const desired = data.substitutionWindows + 1;
    const existing = await db
      .select()
      .from(matchSegments)
      .where(eq(matchSegments.matchId, match.id))
      .orderBy(asc(matchSegments.segmentIndex));
    if (existing.length < desired) {
      const lastFormation = existing[existing.length - 1]?.formation ?? 'unknown';
      const lastPlayerCount = existing[existing.length - 1]?.playerCount ?? data.playerCount ?? 9;
      const toInsert = [];
      for (let i = existing.length; i < desired; i++) {
        toInsert.push({
          matchId: match.id,
          segmentIndex: i,
          formation: lastFormation,
          playerCount: lastPlayerCount,
        });
      }
      if (toInsert.length) await db.insert(matchSegments).values(toInsert);
    } else if (existing.length > desired) {
      const toRemove = existing.slice(desired).map((s) => s.id);
      await db.delete(matchSegments).where(inArray(matchSegments.id, toRemove));
    }
  }

  if (playerChanges) {
    // Wipe placements — they will be regenerated by autofill next time the
    // editor opens.
    const segs = await db
      .select({ id: matchSegments.id })
      .from(matchSegments)
      .where(eq(matchSegments.matchId, match.id));
    if (segs.length > 0) {
      await db
        .delete(segmentPositions)
        .where(inArray(segmentPositions.segmentId, segs.map((s) => s.id)));
    }
  }

  res.json({ match: updated });
});

// ---------- Delete ----------

matchesRouter.delete('/:id', async (req, res) => {
  const match = await loadOwnedMatch(req.teamId!, req.params.id);
  await db.delete(matches).where(eq(matches.id, match.id));
  res.json({ ok: true });
});

// ---------- Segment positions: bulk save for one segment ----------

const positionsSchema = z.object({
  formation: z.string().min(1),
  playerCount: z.number().int().min(9).max(9),
  positions: z.array(
    z.object({
      playerId: z.string().uuid(),
      isField: z.boolean(),
      positionSlot: z.number().int().min(0).nullable(),
      isGoalie: z.boolean().optional(),
    }),
  ),
});

matchesRouter.put('/:id/segments/:segmentIndex', async (req, res) => {
  const match = await loadOwnedMatch(req.teamId!, req.params.id);
  const segmentIndex = Number.parseInt(req.params.segmentIndex, 10);
  if (Number.isNaN(segmentIndex)) throw new HttpError(400, 'segmentIndex must be a number');

  const data = positionsSchema.parse(req.body);
  if (!isValidFormation(data.playerCount, data.formation)) {
    throw new HttpError(400, `Formation ${data.formation} invalid for ${data.playerCount} players`);
  }

  const [segment] = await db
    .select()
    .from(matchSegments)
    .where(and(eq(matchSegments.matchId, match.id), eq(matchSegments.segmentIndex, segmentIndex)))
    .limit(1);
  if (!segment) throw new HttpError(404, 'Segment not found');

  await assertPlayersBelongToTeam(req.teamId!, data.positions.map((p) => p.playerId));

  await db
    .update(matchSegments)
    .set({ formation: data.formation, playerCount: data.playerCount })
    .where(eq(matchSegments.id, segment.id));

  await db.delete(segmentPositions).where(eq(segmentPositions.segmentId, segment.id));
  if (data.positions.length > 0) {
    await db.insert(segmentPositions).values(
      data.positions.map((p) => ({
        segmentId: segment.id,
        playerId: p.playerId,
        isField: p.isField,
        positionSlot: p.positionSlot,
        isGoalie: p.isGoalie ?? false,
      })),
    );
  }

  res.json({ ok: true });
});

// ---------- helpers ----------

async function loadOwnedMatch(teamId: string, matchId: string) {
  const [m] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.teamId, teamId)))
    .limit(1);
  if (!m) throw new HttpError(404, 'Match not found');
  return m;
}

async function assertPlayersBelongToTeam(teamId: string, playerIds: string[]) {
  if (playerIds.length === 0) return;
  const unique = Array.from(new Set(playerIds));
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.teamId, teamId), inArray(players.id, unique)));
  if (rows.length !== unique.length) {
    throw new HttpError(400, 'One or more players do not belong to this team');
  }
}
