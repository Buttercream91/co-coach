import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

type CurrentTeamResp = {
  team: { id: string; name: string; inviteCode: string };
  members: { userId: string; name: string; email: string; role: 'owner' | 'coach' }[];
};

export default function TeamPage() {
  const qc = useQueryClient();
  const { user, activeTeam, setActiveTeam, refresh } = useAuth();
  const [mode, setMode] = useState<'idle' | 'create' | 'join'>('idle');
  const [copied, setCopied] = useState(false);

  const currentQuery = useQuery({
    queryKey: ['team-current', activeTeam?.id],
    queryFn: () => api<CurrentTeamResp>('/teams/current'),
    enabled: !!activeTeam,
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      api<{ team: { id: string; name: string; inviteCode: string } }>('/teams', {
        method: 'POST',
        json: { name },
      }),
    onSuccess: async (data) => {
      await refresh();
      setActiveTeam(data.team.id);
      setMode('idle');
    },
  });

  const join = useMutation({
    mutationFn: (code: string) =>
      api<{ team: { id: string; name: string; inviteCode: string } }>('/teams/join', {
        method: 'POST',
        json: { code: code.trim().toUpperCase() },
      }),
    onSuccess: async (data) => {
      await refresh();
      setActiveTeam(data.team.id);
      setMode('idle');
    },
  });

  const leave = useMutation({
    mutationFn: () => api('/teams/leave', { method: 'POST' }),
    onSuccess: async () => {
      qc.clear();
      await refresh();
    },
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers — open prompt
      window.prompt('Copy invite code', code);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Team</h1>
      </div>

      {/* Active team switcher */}
      {user.teams.length > 0 && (
        <div className="card space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Active team
          </div>
          {user.teams.length === 1 ? (
            <div className="font-semibold">{user.teams[0].name}</div>
          ) : (
            <select
              value={activeTeam?.id ?? ''}
              onChange={(e) => setActiveTeam(e.target.value)}
              className="input"
            >
              {user.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.role})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Current team details (invite code + members) */}
      {activeTeam && (
        <div className="card space-y-3">
          {currentQuery.isLoading && <div className="text-sm text-slate-500">Loading…</div>}
          {currentQuery.data && (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Invite code
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg tracking-widest bg-slate-100 px-3 py-2 rounded select-all">
                    {currentQuery.data.team.inviteCode}
                  </code>
                  <button
                    onClick={() => copyCode(currentQuery.data!.team.inviteCode)}
                    className="btn-secondary"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Share this code with another coach. They sign up, then choose "Join team" and enter the code.
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Coaches ({currentQuery.data.members.length})
                </div>
                <ul className="divide-y divide-slate-100">
                  {currentQuery.data.members.map((m) => (
                    <li key={m.userId} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-slate-500">{m.email}</div>
                      </div>
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide ${
                          m.role === 'owner' ? 'text-amber-700' : 'text-slate-500'
                        }`}
                      >
                        {m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      {/* Create / join another team */}
      <div className="card space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {user.teams.length === 0 ? 'Set up your team' : 'Manage another team'}
        </div>
        {mode === 'idle' && (
          <div className="flex gap-2">
            <button onClick={() => setMode('create')} className="btn-primary flex-1">
              + Create team
            </button>
            <button onClick={() => setMode('join')} className="btn-secondary flex-1">
              Join with code
            </button>
          </div>
        )}
        {mode === 'create' && (
          <CreateForm
            busy={create.isPending}
            error={create.error instanceof Error ? create.error.message : null}
            onSubmit={(name) => create.mutate(name)}
            onCancel={() => setMode('idle')}
          />
        )}
        {mode === 'join' && (
          <JoinForm
            busy={join.isPending}
            error={join.error instanceof Error ? join.error.message : null}
            onSubmit={(code) => join.mutate(code)}
            onCancel={() => setMode('idle')}
          />
        )}
      </div>

      {/* Leave team — only if there's a current team and multiple coaches OR multiple teams */}
      {activeTeam && currentQuery.data && (
        <div>
          <button
            onClick={() => {
              if (
                confirm(
                  `Leave ${activeTeam.name}? You'll lose access to its matches and players (other coaches keep theirs).`,
                )
              ) {
                leave.mutate();
              }
            }}
            disabled={leave.isPending}
            className="btn-danger"
          >
            Leave this team
          </button>
        </div>
      )}
    </div>
  );
}

function CreateForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      {error && <div className="text-sm text-rose-600">{error}</div>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        className="input"
        autoFocus
        required
      />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function JoinForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmit(code.trim());
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      {error && <div className="text-sm text-rose-600">{error}</div>}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Invite code"
        className="input font-mono tracking-widest"
        autoFocus
        required
      />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
    </form>
  );
}
