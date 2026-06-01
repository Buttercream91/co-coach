import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { KebabMenu } from '../components/KebabMenu';

type Match = {
  id: string;
  opponent: string;
  scheduledAt: string;
  halfLengthMinutes: number;
  substitutionWindows: number;
  status: 'upcoming' | 'in_progress' | 'completed';
  myScore: number | null;
  opponentScore: number | null;
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api<{ matches: Match[] }>('/matches'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/matches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const matches = data?.matches ?? [];
  const upcoming = matches.filter((m) => m.status !== 'completed');
  const previous = matches.filter((m) => m.status === 'completed');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Matches</h1>
        <Link to="/matches/new" className="btn-primary">
          + New match
        </Link>
      </div>

      {isLoading && <div className="text-slate-500">Loading…</div>}
      {error && (
        <div className="text-rose-600 text-sm">
          {error instanceof Error ? error.message : 'Failed to load matches'}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <div className="card text-sm text-slate-500">
            No upcoming matches. Create your first match to get started.
          </div>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((m) => (
              <li key={m.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">vs {m.opponent}</div>
                  <div className="text-xs text-slate-500">
                    {formatWhen(m.scheduledAt)}
                  </div>
                  {m.status === 'in_progress' && (
                    <div className="mt-1 text-xs text-amber-700 font-medium">In progress</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link to={`/matches/${m.id}/play`} className="btn-primary">
                    Enter game
                  </Link>
                  <KebabMenu
                    items={[
                      { label: 'Edit', onSelect: () => navigate(`/matches/${m.id}/edit`) },
                      {
                        label: 'Delete',
                        danger: true,
                        onSelect: () => {
                          if (confirm(`Delete the match vs ${m.opponent}?`)) remove.mutate(m.id);
                        },
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Previous
        </h2>
        {previous.length === 0 ? (
          <div className="card text-sm text-slate-500">No previous matches yet.</div>
        ) : (
          <ul className="space-y-2">
            {previous.map((m) => (
              <li key={m.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">vs {m.opponent}</div>
                  <div className="text-xs text-slate-500">{formatWhen(m.scheduledAt)}</div>
                  {m.myScore !== null && (
                    <div className="text-sm mt-1">
                      Final: {m.myScore} – {m.opponentScore}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link to={`/matches/${m.id}/stats`} className="btn-secondary">
                    Match stats
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
