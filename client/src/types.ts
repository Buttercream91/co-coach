// Shared types mirrored from the server. Keep in sync with server/src/db/schema.ts
// and the route response shapes.

export type Player = {
  id: string;
  teamId: string;
  name: string;
  jerseyNumber: number | null;
  photoUrl: string | null;
  playTimeSeconds: number;
  // Reserve segments in their most recently completed match. Drives the
  // fair-rotation autofill — higher = they were benched more recently, so they
  // get field priority next match. Defaults to 0 for newcomers.
  lastMatchReserveCount: number;
  active: boolean;
  createdAt: string;
};

export type LivePhase =
  | 'pre_match'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'post_match';

export type LiveState = {
  phase: LivePhase;
  halfStartedAt?: string;
  pausedAt?: string | null;
  totalPausedMs: number;
  halftimeStartedAt?: string;
  half1EndClockSec?: number;
  half2EndClockSec?: number;
  clockMultiplier?: number;
};

export type FieldSlotState = {
  playerId: string;
  slot: number | null;
  isGoalie: boolean;
};

export type FieldState = {
  currentSegmentIdx: number;
  field: FieldSlotState[];
  reserves: string[];
  sickBay: string[];
};

export type Match = {
  id: string;
  teamId: string;
  opponent: string;
  scheduledAt: string;
  halfLengthMinutes: number;
  substitutionWindows: number;
  playerCount: number;
  goaliePlayerId: string | null;
  status: 'upcoming' | 'in_progress' | 'completed';
  myScore: number | null;
  opponentScore: number | null;
  liveState: LiveState | null;
  fieldState: FieldState | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MatchEventType =
  | 'goal'
  | 'substitution'
  | 'position_switch'
  | 'segment_advance'
  | 'rotate_back'
  | 'reserve_to_sick_bay'
  | 'note'
  | 'half_start'
  | 'half_end'
  | 'pause'
  | 'resume';

export type MatchEvent = {
  id: string;
  matchId: string;
  occurredAt: string;
  matchClockSeconds: number;
  half: number;
  eventType: MatchEventType;
  payload: Record<string, unknown>;
};

export type Segment = {
  id: string;
  matchId: string;
  segmentIndex: number;
  formation: string;
  playerCount: number;
};

export type SegmentPosition = {
  id: string;
  segmentId: string;
  playerId: string;
  isField: boolean;
  positionSlot: number | null;
  isGoalie: boolean;
};

export type FormationPosition = {
  slot: number;
  label: string;
  x: number;
  y: number;
};

export type Formation = {
  name: string;
  positions: FormationPosition[];
};
