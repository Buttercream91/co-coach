import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { Player } from '../types';

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

type Stats = {
  player: Player;
  perMatch: PerMatch[];
  totals: { matches: number; secondsPlayed: number; goals: number; goalieMatches: number };
};

export default function PlayerProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { playerId } = useParams<{ playerId: string }>();
  const [editing, setEditing] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['player-stats', playerId],
    queryFn: () => api<Stats>(`/players/${playerId}/stats`),
    enabled: !!playerId,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Player>) =>
      api(`/players/${playerId}`, { method: 'PATCH', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-stats', playerId] });
      qc.invalidateQueries({ queryKey: ['players'] });
      setEditing(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api(`/players/${playerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['players'] });
      navigate('/players');
    },
  });

  if (statsQuery.isLoading) return <div className="p-4 text-slate-500">Loading…</div>;
  if (!statsQuery.data) {
    return (
      <div className="p-4 text-rose-600">
        Couldn't load player. <Link to="/players" className="underline">Back</Link>
      </div>
    );
  }

  const { player, perMatch, totals } = statsQuery.data;

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-4">
        <PlayerAvatar
          photoUrl={player.photoUrl}
          jerseyNumber={player.jerseyNumber}
          name={player.name}
          size="lg"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{player.name}</h1>
          <div className="text-xs text-slate-500">
            {player.jerseyNumber !== null && <>#{player.jerseyNumber} · </>}
            Season playtime: {formatMinutes(player.playTimeSeconds)}
          </div>
        </div>
        <button onClick={() => setEditing(true)} className="btn-secondary">
          Edit
        </button>
      </div>

      <section className="card">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">
          Season totals
        </h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">Matches played</dt>
          <dd className="font-semibold">{totals.matches}</dd>
          <dt className="text-slate-500">Total time</dt>
          <dd className="font-semibold">{formatMinutes(totals.secondsPlayed)}</dd>
          <dt className="text-slate-500">Goals</dt>
          <dd className="font-semibold">{totals.goals}</dd>
          <dt className="text-slate-500">Goalie appearances</dt>
          <dd className="font-semibold">{totals.goalieMatches}</dd>
        </dl>
      </section>

      <section className="card !p-0 overflow-hidden">
        <h2 className="px-3 py-2 text-sm font-semibold text-slate-600 uppercase tracking-wide bg-slate-50 border-b border-slate-200">
          Per-match
        </h2>
        {perMatch.length === 0 ? (
          <div className="px-3 py-4 text-sm text-slate-500">
            No completed matches yet for this player.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {perMatch.map((m) => (
              <li key={m.matchId} className="px-3 py-3">
                <Link
                  to={`/matches/${m.matchId}/stats`}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      vs {m.opponent}{' '}
                      {m.wasGoalie && (
                        <span className="ml-1 text-xs text-amber-700">GK</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(m.scheduledAt).toLocaleDateString()} · {formatMinutes(m.secondsPlayed)} · {m.segmentsPlayed} segments
                      {m.goals > 0 && (
                        <span className="ml-2 text-emerald-700 font-medium">
                          ⚽ {m.goals}
                        </span>
                      )}
                    </div>
                    {m.positions.length > 0 && (
                      <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {m.positions.map((p, i) => (
                          <span key={i}>
                            {p.label}: {formatMinutes(p.seconds)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-semibold shrink-0">
                    {m.finalScore.us ?? '–'} – {m.finalScore.opp ?? '–'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        onClick={() => {
          if (confirm(`Remove ${player.name} from the roster?`)) removeMutation.mutate();
        }}
        className="btn-danger"
      >
        Remove player
      </button>

      {editing && (
        <EditPlayerSheet
          player={player}
          onClose={() => setEditing(false)}
          onSave={(patch) => saveMutation.mutate(patch)}
          busy={saveMutation.isPending}
        />
      )}
    </div>
  );
}

function EditPlayerSheet({
  player,
  onClose,
  onSave,
  busy,
}: {
  player: Player;
  onClose: () => void;
  onSave: (patch: Partial<Player>) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(player.name);
  const [jersey, setJersey] = useState(
    player.jerseyNumber !== null && player.jerseyNumber !== undefined
      ? String(player.jerseyNumber)
      : '',
  );
  const [photoUrl, setPhotoUrl] = useState(player.photoUrl ?? '');
  const [playMinutes, setPlayMinutes] = useState(
    String(Math.floor((player.playTimeSeconds ?? 0) / 60)),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({
      name: name.trim(),
      jerseyNumber: jersey.trim() === '' ? null : Number(jersey),
      photoUrl: photoUrl.trim() === '' ? null : photoUrl.trim(),
      playTimeSeconds: Math.max(0, Math.round(Number(playMinutes) * 60)),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-4 space-y-3"
      >
        <h2 className="text-lg font-bold">Edit player</h2>
        <div>
          <label className="label">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Jersey number</label>
          <input
            type="number"
            min={0}
            max={99}
            value={jersey}
            onChange={(e) => setJersey(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Photo URL</label>
          <input
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            className="input"
            placeholder="https://…"
          />
        </div>
        <div>
          <label className="label">Season playtime (minutes)</label>
          <input
            type="number"
            min={0}
            value={playMinutes}
            onChange={(e) => setPlayMinutes(e.target.value)}
            className="input"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
