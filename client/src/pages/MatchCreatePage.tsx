import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Match, Player } from '../types';

const SUB_WINDOW_OPTIONS = [3, 5] as const;
const HALF_LENGTH_OPTIONS = [20, 25, 30, 35, 40, 45] as const;

export default function MatchCreatePage() {
  const navigate = useNavigate();
  const { data: playersData, isLoading } = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: Player[] }>('/players'),
  });
  const players = playersData?.players ?? [];

  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(() => defaultDate());
  const [time, setTime] = useState('10:00');
  const [halfLength, setHalfLength] = useState<number>(25);
  const [subWindows, setSubWindows] = useState<number>(3);
  const [availableIds, setAvailableIds] = useState<Set<string>>(new Set());
  const [goalieId, setGoalieId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segmentLength = useMemo(
    () => (halfLength * 2) / (subWindows + 1),
    [halfLength, subWindows],
  );

  function toggleAvailable(id: string) {
    setAvailableIds((prev) => {
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

    if (availableIds.size < 2) {
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
      const res = await api<{ match: Match }>('/matches', {
        method: 'POST',
        json: {
          opponent: opponent.trim(),
          scheduledAt,
          halfLengthMinutes: halfLength,
          substitutionWindows: subWindows,
          playerCount: 9,
          goaliePlayerId: goalieId,
          availablePlayerIds: Array.from(availableIds),
        },
      });
      navigate(`/matches/${res.match.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create match');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="text-slate-500">Loading…</div>;

  if (players.length < 2) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">New match</h1>
        <div className="card text-sm">
          Add a few players to your roster first — you need at least one goalie and one outfielder.{' '}
          <a href="/players" className="text-emerald-700 font-medium">
            Go to players
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-bold">New match</h1>
      {error && <div className="text-sm text-rose-600">{error}</div>}

      <div className="card space-y-4">
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
            Each segment ≈ {segmentLength.toFixed(1)} min.
          </p>
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <div className="font-semibold">Available players</div>
          <div className="text-xs text-slate-500">
            Pick everyone showing up today. The match runs with whoever you've got — if it's fewer than the formation, some positions stay empty. Selected: {availableIds.size}
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-2">
          {players.map((p) => {
            const checked = availableIds.has(p.id);
            return (
              <li key={p.id}>
                <label
                  className={`flex items-center justify-between gap-3 rounded border px-3 py-2 cursor-pointer ${
                    checked ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAvailable(p.id)}
                      className="h-5 w-5"
                    />
                    <span>
                      {p.jerseyNumber !== null && (
                        <span className="text-slate-500 mr-1">#{p.jerseyNumber}</span>
                      )}
                      {p.name}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {Math.floor(p.playTimeSeconds / 60)}m played
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card space-y-3">
        <div className="font-semibold">Goalie</div>
        <p className="text-xs text-slate-500">
          The goalie stays in goal the whole match unless manually substituted (injury).
        </p>
        <select
          value={goalieId}
          onChange={(e) => setGoalieId(e.target.value)}
          className="input"
          required
        >
          <option value="">Select a goalie…</option>
          {players
            .filter((p) => availableIds.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.jerseyNumber !== null ? `#${p.jerseyNumber} ` : ''}
                {p.name}
              </option>
            ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => navigate('/')} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? 'Creating…' : 'Create & open formation editor'}
        </button>
      </div>
    </form>
  );
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
