import type { Player, Segment, SegmentPosition } from '../types';
import { formationByName } from '../domain/formations';

// A *placement* is one assignment of one player in one segment.
export type Placement = {
  segmentIndex: number;
  playerId: string;
  isField: boolean;
  positionSlot: number | null;
  isGoalie: boolean;
};

export type SegmentInfo = {
  segmentIndex: number;
  formation: string;
  playerCount: number;
};

export type AutofillInput = {
  availablePlayers: Player[]; // includes the goalie
  goaliePlayerId: string | null;
  segments: SegmentInfo[];
  halfLengthMinutes: number;
  substitutionWindows: number;
  preserved?: Map<number, Placement[]>;
};

// ---- Fair rotation algorithm ----
//
// Goal: distribute reserve segments evenly within a match, and compensate
// across matches based on the previous match's bench count.
//
// Within a match:
//   * Track `currentMatchReserves[playerId]` — segments they've been reserve
//     so far this match.
//   * For each segment, the bench is filled by the players with the LOWEST
//     `currentMatchReserves`. No one gets benched a second time until
//     everyone has been benched at least once.
//   * Tiebreak by `lastMatchReserveCount` ascending — a player who wasn't
//     benched much last match gets benched first now; a player who was
//     benched a lot last match plays the field first.
//   * Final tiebreak by id for determinism.
//
// Goalie is never in the rotation (always on the field, in the GK slot).

export function autofillAll(input: AutofillInput): Map<number, Placement[]> {
  const result = new Map<number, Placement[]>();
  const currentMatchReserves = new Map<string, number>();
  for (const p of input.availablePlayers) currentMatchReserves.set(p.id, 0);

  const sorted = [...input.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);

  let prev: Placement[] | null = null;

  for (const seg of sorted) {
    const preserved = input.preserved?.get(seg.segmentIndex);
    if (preserved) {
      result.set(seg.segmentIndex, preserved);
      accumulateReserves(preserved, currentMatchReserves);
      prev = preserved;
      continue;
    }

    const placements = fillSegment(
      seg,
      prev,
      input.availablePlayers,
      input.goaliePlayerId,
      currentMatchReserves,
    );
    result.set(seg.segmentIndex, placements);
    accumulateReserves(placements, currentMatchReserves);
    prev = placements;
  }

  return result;
}

function accumulateReserves(
  placements: Placement[],
  reserves: Map<string, number>,
) {
  for (const p of placements) {
    if (!p.isGoalie && !p.isField) {
      reserves.set(p.playerId, (reserves.get(p.playerId) ?? 0) + 1);
    }
  }
}

function fillSegment(
  seg: SegmentInfo,
  prev: Placement[] | null,
  availablePlayers: Player[],
  goalieId: string | null,
  currentMatchReserves: Map<string, number>,
): Placement[] {
  const formation = formationByName(seg.playerCount, seg.formation);
  if (!formation) return [];

  const result: Placement[] = [];
  if (goalieId && availablePlayers.some((p) => p.id === goalieId)) {
    result.push({
      segmentIndex: seg.segmentIndex,
      playerId: goalieId,
      isField: true,
      positionSlot: null,
      isGoalie: true,
    });
  }

  const outfielders = availablePlayers.filter((p) => p.id !== goalieId);
  const formationSlots = formation.positions.map((p) => p.slot);
  const fieldBudget = Math.min(formationSlots.length, outfielders.length);
  const reserveCount = Math.max(0, outfielders.length - fieldBudget);

  // Sort the outfielders to decide who benches first.
  //   primary  : currentMatchReserves ASC   (round-robin)
  //   secondary: lastMatchReserveCount ASC  (across-match compensation —
  //              low last-match → bench now)
  //   tertiary : id ASC                     (deterministic)
  const sortForBench = (a: Player, b: Player) => {
    const aMatch = currentMatchReserves.get(a.id) ?? 0;
    const bMatch = currentMatchReserves.get(b.id) ?? 0;
    if (aMatch !== bMatch) return aMatch - bMatch;
    const aLast = a.lastMatchReserveCount ?? 0;
    const bLast = b.lastMatchReserveCount ?? 0;
    if (aLast !== bLast) return aLast - bLast;
    return a.id.localeCompare(b.id);
  };

  const sorted = [...outfielders].sort(sortForBench);
  const benchPlayers = sorted.slice(0, reserveCount);
  const fieldPlayers = sorted.slice(reserveCount);

  if (!prev) {
    // Bootstrap segment — assign slots in formation order.
    fieldPlayers.forEach((p, i) => {
      result.push({
        segmentIndex: seg.segmentIndex,
        playerId: p.id,
        isField: true,
        positionSlot: formationSlots[i] ?? null,
        isGoalie: false,
      });
    });
    benchPlayers.forEach((p) => {
      result.push({
        segmentIndex: seg.segmentIndex,
        playerId: p.id,
        isField: false,
        positionSlot: null,
        isGoalie: false,
      });
    });
    return result;
  }

  // Subsequent segment — preserve slot continuity where possible.
  const prevByPlayer = new Map(
    prev.filter((p) => !p.isGoalie).map((p) => [p.playerId, p]),
  );
  const slotAssignments = new Map<string, number>();
  const usedSlots = new Set<number>();
  const slotSet = new Set(formationSlots);

  // 1) Field players who stayed (also on field last segment) keep their slot.
  for (const f of fieldPlayers) {
    const prevP = prevByPlayer.get(f.id);
    if (
      prevP?.isField &&
      prevP.positionSlot !== null &&
      slotSet.has(prevP.positionSlot) &&
      !usedSlots.has(prevP.positionSlot)
    ) {
      slotAssignments.set(f.id, prevP.positionSlot);
      usedSlots.add(prevP.positionSlot);
    }
  }

  // 2) Incoming field players (were reserves last segment) prefer to take
  // slots vacated by going-off players (so swap pair colours line up).
  const goingOffSlots: number[] = [];
  const benchSet = new Set(benchPlayers.map((p) => p.id));
  for (const f of prev) {
    if (f.isGoalie || !f.isField) continue;
    if (benchSet.has(f.playerId) && f.positionSlot !== null) {
      goingOffSlots.push(f.positionSlot);
    }
  }

  let offIdx = 0;
  for (const f of fieldPlayers) {
    if (slotAssignments.has(f.id)) continue;
    // Skip slots already taken by stayers.
    while (offIdx < goingOffSlots.length) {
      const candidate = goingOffSlots[offIdx++];
      if (slotSet.has(candidate) && !usedSlots.has(candidate)) {
        slotAssignments.set(f.id, candidate);
        usedSlots.add(candidate);
        break;
      }
    }
  }

  // 3) Orphan field players (no continuity, no going-off slot) take any free slot.
  for (const f of fieldPlayers) {
    if (slotAssignments.has(f.id)) continue;
    for (const s of formationSlots) {
      if (!usedSlots.has(s)) {
        slotAssignments.set(f.id, s);
        usedSlots.add(s);
        break;
      }
    }
  }

  for (const [playerId, slot] of slotAssignments) {
    result.push({
      segmentIndex: seg.segmentIndex,
      playerId,
      isField: true,
      positionSlot: slot,
      isGoalie: false,
    });
  }
  for (const p of benchPlayers) {
    result.push({
      segmentIndex: seg.segmentIndex,
      playerId: p.id,
      isField: false,
      positionSlot: null,
      isGoalie: false,
    });
  }

  return result;
}

// Detect substitution pairs between consecutive segments for the sub-pair
// highlight colours in the formation editor.
export type SubColorMap = Record<string, number>;

export function computeSubColors(
  prev: Placement[],
  curr: Placement[],
): SubColorMap {
  const colors: SubColorMap = {};
  const prevByPlayer = new Map(prev.map((p) => [p.playerId, p]));
  const currByPlayer = new Map(curr.map((p) => [p.playerId, p]));

  const goingOff: { playerId: string; slot: number | null }[] = [];
  const comingOn: { playerId: string; slot: number | null }[] = [];

  for (const [playerId, p1] of prevByPlayer) {
    const p2 = currByPlayer.get(playerId);
    if (!p2) continue;
    if (p1.isGoalie || p2.isGoalie) continue;
    if (p1.isField && !p2.isField) goingOff.push({ playerId, slot: p1.positionSlot });
    else if (!p1.isField && p2.isField) comingOn.push({ playerId, slot: p2.positionSlot });
  }

  const offBySlot = new Map<number, string>();
  for (const off of goingOff) {
    if (off.slot !== null) offBySlot.set(off.slot, off.playerId);
  }

  // Two-pass pairing so we don't double-claim the same going-off player.
  // Pass 1 takes clean slot matches (coming-on at slot S paired with going-off
  // who was at slot S). Pass 2 mops up any unpaired entries in order.
  const pairs: { on: string; off: string }[] = [];
  const usedOff = new Set<string>();
  const usedOn = new Set<string>();

  for (const on of comingOn) {
    if (on.slot === null) continue;
    const off = offBySlot.get(on.slot);
    if (!off || usedOff.has(off)) continue;
    pairs.push({ on: on.playerId, off });
    usedOn.add(on.playerId);
    usedOff.add(off);
  }

  const remainingOn = comingOn.filter((o) => !usedOn.has(o.playerId));
  const remainingOff = goingOff.filter((o) => !usedOff.has(o.playerId));
  const extra = Math.min(remainingOn.length, remainingOff.length);
  for (let i = 0; i < extra; i++) {
    pairs.push({ on: remainingOn[i].playerId, off: remainingOff[i].playerId });
  }

  pairs.forEach((p, idx) => {
    colors[p.on] = idx;
    colors[p.off] = idx;
  });
  return colors;
}

export function indexBySegment(
  rows: SegmentPosition[],
  segments: Segment[],
): Map<number, Placement[]> {
  const segById = new Map(segments.map((s) => [s.id, s.segmentIndex]));
  const map = new Map<number, Placement[]>();
  for (const r of rows) {
    const segmentIndex = segById.get(r.segmentId);
    if (segmentIndex === undefined) continue;
    const arr = map.get(segmentIndex) ?? [];
    arr.push({
      segmentIndex,
      playerId: r.playerId,
      isField: r.isField,
      positionSlot: r.positionSlot,
      isGoalie: r.isGoalie,
    });
    map.set(segmentIndex, arr);
  }
  return map;
}
