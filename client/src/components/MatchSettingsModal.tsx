import { FormEvent, useState } from 'react';
import type { Match, Player } from '../types';

const SUB_WINDOW_OPTIONS = [3, 5] as const;
const HALF_LENGTH_OPTIONS = [20, 25, 30, 35, 40, 45] as const;

export type MatchSettingsValues = {
  opponent: string;
  scheduledAt: string; // ISO
  halfLengthMinutes: number;
  substitutionWindows: number;
  goaliePlayerId: string | null;
  availablePlayerIds: string[];
};

export function MatchSettingsModal({
  match,
  availablePlayerIds,
  players,
  onSave,
  onClose,
}: {
  match: Match;
  availablePlayerIds: string[];
  players: Player[];
  onSave: (values: MatchSettingsValues) => Promise<void>;
  onClose: () => void;
}) {
  const initial = splitDateTime(match.scheduledAt);
  const [opponent, setOpponent] = useState(match.opponent);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [halfLength, setHalfLength] = useState(match.halfLengthMinutes);
  const [subWindows, setSubWindows] = useState(
    SUB_WINDOW_OPTIONS.includes(match.substitutionWindows as 3 | 5)
      ? match.substitutionWindows
      : SUB_WINDOW_OPTIONS[0],
  );
  const [availableSet, setAvailableSet] = useState<Set<string>>(new Set(availablePlayerIds));
  const [goalieId, setGoalieId] = useState<string>(match.goaliePlayerId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAvailable(id: string) {
    setAvailableSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (goalieId === id) setGoalieId('');
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (availableSet.size < 2) {
      setError('Pick at least the goalie plus one outfielder.');
      return;
    }
    if (!goalieId) {
      setError('Pick a goalie.');
      return;
    }

    setBusy(true);
    try {
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      await onSave({
        opponent: opponent.trim(),
        scheduledAt,
        halfLengthMinutes: halfLength,
        substitutionWindows: subWindows,
        goaliePlayerId: goalieId,
        availablePlayerIds: Array.from(availableSet),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="font-bold">Match settings</div>
          <button type="button" onClick={onClose} className="text-slate-500 text-sm">
            Close
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {error && <div className="text-sm text-rose-600">{error}</div>}

          <div>
            <label className="label" htmlFor="opponent">Opposition team</label>
            <input
              id="opponent"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              className="input"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="date">Date</label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="time">Kick-off</label>
              <input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="input"
                required
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="half">Half length (minutes)</label>
            <select
              id="half"
              value={halfLength}
              onChange={(e) => setHalfLength(Number(e.target.value))}
              className="input"
            >
              {HALF_LENGTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="subs">Substitution windows</label>
            <select
              id="subs"
              value={subWindows}
              onChange={(e) => setSubWindows(Number(e.target.value))}
              className="input"
            >
              {SUB_WINDOW_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} windows ({n + 1} segments)
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Changing this will reset segment placements.
            </p>
          </div>

          <div>
            <div className="label mb-1">Available players ({availableSet.size})</div>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {players.map((p) => {
                const checked = availableSet.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-center gap-2 rounded border px-3 py-2 cursor-pointer ${
                        checked ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAvailable(p.id)}
                        className="h-5 w-5"
                      />
                      <span className="flex-1">
                        {p.jerseyNumber !== null && (
                          <span className="text-slate-500 mr-1">#{p.jerseyNumber}</span>
                        )}
                        {p.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {Math.floor(p.playTimeSeconds / 60)}m
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <label className="label" htmlFor="goalie">Goalie</label>
            <select
              id="goalie"
              value={goalieId}
              onChange={(e) => setGoalieId(e.target.value)}
              className="input"
              required
            >
              <option value="">Select a goalie…</option>
              {players
                .filter((p) => availableSet.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jerseyNumber !== null ? `#${p.jerseyNumber} ` : ''}
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="p-3 border-t border-slate-200 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}
