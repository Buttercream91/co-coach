import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { Player } from '../types';

export default function PlayersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: Player[] }>('/players'),
  });

  const [editing, setEditing] = useState<Player | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/players/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
  });

  const players = data?.players ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Players</h1>
        <button onClick={() => setEditing('new')} className="btn-primary">
          + Add player
        </button>
      </div>

      {isLoading && <div className="text-slate-500">Loading…</div>}

      {!isLoading && players.length === 0 && (
        <div className="card text-sm text-slate-600">
          No players on the roster yet. Add your first one to get started.
        </div>
      )}

      <ul className="space-y-2">
        {players.map((p) => (
          <li key={p.id} className="card flex items-center justify-between gap-3">
            <Link to={`/players/${p.id}`} className="flex items-center gap-3 min-w-0 flex-1">
              <PlayerAvatar
                photoUrl={p.photoUrl}
                jerseyNumber={p.jerseyNumber}
                name={p.name}
                size="md"
              />
              <div className="min-w-0">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-xs text-slate-500">
                  Playtime: {formatPlaytime(p.playTimeSeconds)}
                </div>
              </div>
            </Link>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setEditing(p)} className="btn-secondary">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remove ${p.name} from the roster?`)) remove.mutate(p.id);
                }}
                className="btn-danger"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <PlayerModal
          player={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['players'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function formatPlaytime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function PlayerModal({
  player,
  onClose,
  onSaved,
}: {
  player: Player | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(player?.name ?? '');
  const [jerseyNumber, setJerseyNumber] = useState<string>(
    player?.jerseyNumber !== null && player?.jerseyNumber !== undefined
      ? String(player.jerseyNumber)
      : '',
  );
  const [photoUrl, setPhotoUrl] = useState(player?.photoUrl ?? '');
  const [playMinutes, setPlayMinutes] = useState(
    String(Math.floor((player?.playTimeSeconds ?? 0) / 60)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        jerseyNumber: jerseyNumber.trim() === '' ? null : Number(jerseyNumber),
        photoUrl: photoUrl.trim() === '' ? null : photoUrl.trim(),
        playTimeSeconds: Math.max(0, Math.round(Number(playMinutes) * 60)),
      };
      if (player) {
        await api(`/players/${player.id}`, { method: 'PATCH', json: body });
      } else {
        await api('/players', { method: 'POST', json: body });
      }
      onSaved();
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
      className="fixed inset-0 z-20 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-bold">{player ? 'Edit player' : 'Add player'}</h2>
        {error && <div className="text-sm text-rose-600">{error}</div>}

        <div>
          <label className="label" htmlFor="p-name">Name</label>
          <input
            id="p-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="p-jersey">Jersey number (optional)</label>
          <input
            id="p-jersey"
            type="number"
            min={0}
            max={99}
            value={jerseyNumber}
            onChange={(e) => setJerseyNumber(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label" htmlFor="p-photo">Photo URL (optional)</label>
          <input
            id="p-photo"
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            className="input"
            placeholder="https://…"
          />
        </div>

        <div>
          <label className="label" htmlFor="p-playtime">Season playtime (minutes)</label>
          <input
            id="p-playtime"
            type="number"
            min={0}
            value={playMinutes}
            onChange={(e) => setPlayMinutes(e.target.value)}
            className="input"
          />
          <p className="text-xs text-slate-500 mt-1">
            Used to weight who starts and who sits next. Edit if you need to adjust historical data.
          </p>
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
