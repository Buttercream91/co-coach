import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { RunnerEventLog } from '../components/RunnerEventLog';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { formationByName } from '../domain/formations';
import type {
  Match,
  MatchEvent,
  Player,
  Segment,
  SegmentPosition,
} from '../types';

type MatchDetail = {
  match: Match;
  availablePlayerIds: string[];
  segments: Segment[];
  positions: SegmentPosition[];
};

export default function MatchStatsPage() {
  const { matchId } = useParams<{ matchId: string }>();

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => api<MatchDetail>(`/matches/${matchId}`),
    enabled: !!matchId,
  });
  const eventsQuery = useQuery({
    queryKey: ['match-events', matchId],
    queryFn: () => api<{ events: MatchEvent[] }>(`/matches/${matchId}/events`),
    enabled: !!matchId,
  });
  const playersQuery = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: Player[] }>('/players'),
  });

  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of playersQuery.data?.players ?? []) m.set(p.id, p);
    return m;
  }, [playersQuery.data]);

  if (matchQuery.isLoading || playersQuery.isLoading) {
    return <div className="p-4 text-slate-500">Loading…</div>;
  }
  if (!matchQuery.data) {
    return (
      <div className="p-4 text-rose-600">
        Couldn't load match. <Link to="/" className="underline">Back</Link>
      </div>
    );
  }

  const detail = matchQuery.data;
  const match = detail.match;
  const events = eventsQuery.data?.events ?? [];
  const availablePlayers = (playersQuery.data?.players ?? []).filter((p) =>
    detail.availablePlayerIds.includes(p.id),
  );

  // Per-player rollup.
  const segLengthSec = (match.halfLengthMinutes * 2 * 60) / (match.substitutionWindows + 1);
  const totalMatchSec =
    (match.liveState?.half1EndClockSec ?? match.halfLengthMinutes * 60) +
    (match.liveState?.half2EndClockSec ?? match.halfLengthMinutes * 60);

  type Row = {
    player: Player;
    secondsPlayed: number;
    segmentsPlayed: number;
    goals: number;
    wasGoalie: boolean;
    positions: { slot: number | null; label: string; seconds: number }[];
  };

  const rows: Row[] = availablePlayers.map((p) => {
    const segIds = detail.segments.map((s) => s.id);
    const placements = detail.positions.filter(
      (pp) => segIds.includes(pp.segmentId) && pp.playerId === p.id,
    );

    let secondsPlayed = 0;
    let segmentsPlayed = 0;
    let wasGoalie = false;
    const positionBuckets = new Map<string, { slot: number | null; label: string; seconds: number }>();

    for (const pp of placements) {
      if (!pp.isField) continue;
      segmentsPlayed++;
      if (pp.isGoalie) wasGoalie = true;
      const delta = pp.isGoalie ? totalMatchSec / detail.segments.length : segLengthSec;
      secondsPlayed += Math.round(delta);
      const seg = detail.segments.find((s) => s.id === pp.segmentId);
      const formation = seg ? formationByName(seg.playerCount, seg.formation) : undefined;
      const label = pp.isGoalie
        ? 'GK'
        : formation?.positions.find((x) => x.slot === pp.positionSlot)?.label ?? `Slot ${pp.positionSlot ?? '?'}`;
      const key = pp.isGoalie ? 'GK' : `${pp.positionSlot}:${label}`;
      const bucket = positionBuckets.get(key) ?? { slot: pp.positionSlot, label, seconds: 0 };
      bucket.seconds += Math.round(delta);
      positionBuckets.set(key, bucket);
    }

    const goals = events.filter((ev) => {
      if (ev.eventType !== 'goal') return false;
      const payload = ev.payload as { side: 'us' | 'opp'; playerId?: string };
      return payload.side === 'us' && payload.playerId === p.id;
    }).length;

    return {
      player: p,
      secondsPlayed,
      segmentsPlayed,
      goals,
      wasGoalie,
      positions: Array.from(positionBuckets.values()).sort((a, b) => b.seconds - a.seconds),
    };
  });
  rows.sort((a, b) => b.secondsPlayed - a.secondsPlayed);

  const notes = events.filter((e) => e.eventType === 'note');
  const goalsLog = events.filter((e) => e.eventType === 'goal' || e.eventType === 'substitution' || e.eventType === 'position_switch');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">vs {match.opponent}</h1>
        <div className="text-xs text-slate-500">
          {new Date(match.scheduledAt).toLocaleString()}
        </div>
        <div className="mt-2 text-3xl font-bold">
          {match.myScore ?? 0} – {match.opponentScore ?? 0}
        </div>
      </div>

      {/* Per-player rollup */}
      <section className="card !p-0 overflow-hidden">
        <h2 className="px-3 py-2 text-sm font-semibold text-slate-600 uppercase tracking-wide bg-slate-50 border-b border-slate-200">
          Per-player
        </h2>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.player.id} className="px-3 py-3 flex items-start gap-3">
              <Link to={`/players/${r.player.id}`} className="shrink-0">
                <PlayerAvatar
                  photoUrl={r.player.photoUrl}
                  jerseyNumber={r.player.jerseyNumber}
                  name={r.player.name}
                  size="sm"
                />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {r.player.name}
                  {r.wasGoalie && <span className="ml-2 text-xs text-amber-700">GK</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {formatMinutes(r.secondsPlayed)} · {r.segmentsPlayed} segments
                  {r.goals > 0 && <span className="ml-2 text-emerald-700 font-medium">⚽ {r.goals}</span>}
                </div>
                {r.positions.length > 0 && (
                  <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.positions.map((p, i) => (
                      <span key={i}>
                        {p.label}: {formatMinutes(p.seconds)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Notes */}
      {notes.length > 0 && (
        <section className="card">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Notes
          </h2>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="text-sm">
                <span className="text-xs font-mono text-slate-500 mr-2">
                  H{n.half} {Math.floor(n.matchClockSeconds / 60)}:
                  {String(n.matchClockSeconds % 60).padStart(2, '0')}
                </span>
                {typeof (n.payload as { text?: unknown }).text === 'string'
                  ? (n.payload as { text: string }).text
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Full event log */}
      <section className="card !p-0 overflow-hidden">
        <h2 className="px-3 py-2 text-sm font-semibold text-slate-600 uppercase tracking-wide bg-slate-50 border-b border-slate-200">
          Match log ({goalsLog.length} key events)
        </h2>
        <div className="max-h-96 overflow-y-auto">
          <RunnerEventLog events={events} playersById={playersById} opponentName={match.opponent} />
        </div>
      </section>

      <Link to="/" className="btn-secondary inline-block">
        ← Back
      </Link>
    </div>
  );
}

function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
