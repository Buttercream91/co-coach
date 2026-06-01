import type { MatchEvent, Player } from '../types';
import { formatSigned } from '../lib/clock';

export function RunnerEventLog({
  events,
  playersById,
  opponentName,
  onDelete,
}: {
  events: MatchEvent[];
  playersById: Map<string, Player>;
  opponentName: string;
  onDelete?: (eventId: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-slate-500 px-3 py-4 text-center">
        No events yet. Goals, substitutions and notes will show up here.
      </div>
    );
  }

  // Newest first.
  const sorted = [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <ul className="divide-y divide-slate-200">
      {sorted.map((ev) => (
        <li key={ev.id} className="flex items-start gap-2 px-3 py-2">
          <span className="text-[10px] font-mono text-slate-500 shrink-0 w-16 pt-0.5">
            H{ev.half} {formatSigned(ev.matchClockSeconds)}
          </span>
          <span className="flex-1 text-sm">
            {describe(ev, playersById, opponentName)}
          </span>
          {onDelete && !isStructuralEvent(ev.eventType) && (
            <button
              onClick={() => {
                if (confirm('Remove this event from the log?')) onDelete(ev.id);
              }}
              className="text-xs text-slate-400 hover:text-rose-600"
              aria-label="Delete event"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function isStructuralEvent(t: string) {
  return t === 'half_start' || t === 'half_end' || t === 'pause' || t === 'resume';
}

function describe(
  ev: MatchEvent,
  playersById: Map<string, Player>,
  opponentName: string,
): React.ReactNode {
  const p = (id?: string) => (id ? playersById.get(id)?.name ?? 'Unknown' : 'Unknown');
  const payload = ev.payload as Record<string, unknown>;
  switch (ev.eventType) {
    case 'goal': {
      const side = payload.side as 'us' | 'opp';
      const scorerId = payload.playerId as string | undefined;
      if (side === 'us') {
        return (
          <span>
            <span className="font-semibold text-emerald-700">⚽ Goal</span> by{' '}
            <span className="font-medium">{p(scorerId)}</span>
          </span>
        );
      }
      return (
        <span>
          <span className="font-semibold text-rose-700">⚽ Goal</span> by {opponentName}
        </span>
      );
    }
    case 'substitution': {
      const reason = (payload.reason as string) ?? '';
      const reasonText = payload.reasonText as string | undefined;
      return (
        <span>
          <span className="font-semibold">Sub:</span> {p(payload.outPlayerId as string)} →{' '}
          {p(payload.inPlayerId as string)}{' '}
          <span className="text-slate-500 text-xs">
            ({reasonText ? `other: ${reasonText}` : reason})
          </span>
        </span>
      );
    }
    case 'position_switch':
      return (
        <span>
          <span className="font-semibold">Switch:</span> {p(payload.playerAId as string)} ↔{' '}
          {p(payload.playerBId as string)}
        </span>
      );
    case 'note': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      return (
        <span>
          <span className="font-semibold">Note:</span> {text}
        </span>
      );
    }
    case 'half_start': {
      const halfN = typeof payload.half === 'number' ? payload.half : '?';
      return <span className="text-slate-600 italic">Half {halfN} started</span>;
    }
    case 'half_end': {
      const halfN = typeof payload.half === 'number' ? payload.half : '?';
      const fin = typeof payload.finalClockSec === 'number' ? payload.finalClockSec : 0;
      return (
        <span className="text-slate-600 italic">
          Half {halfN} ended ({formatSigned(fin)})
        </span>
      );
    }
    case 'pause':
      return <span className="text-slate-600 italic">Paused</span>;
    case 'resume':
      return <span className="text-slate-600 italic">Resumed</span>;
    case 'rotate_back':
      return (
        <span>
          <span className="font-semibold">Rotated back to reserves:</span>{' '}
          {p(payload.playerId as string)}
        </span>
      );
    case 'segment_advance': {
      const swaps = (payload.swaps as { outPlayerId: string; inPlayerId: string }[]) ?? [];
      if (swaps.length === 0) {
        return <span className="text-slate-600 italic">Sub window applied (no swaps)</span>;
      }
      return (
        <span>
          <span className="font-semibold">Sub window:</span>{' '}
          {swaps.map((s, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {p(s.outPlayerId)} → {p(s.inPlayerId)}
            </span>
          ))}
        </span>
      );
    }
    default:
      return <span className="text-slate-500">{ev.eventType}</span>;
  }
}
