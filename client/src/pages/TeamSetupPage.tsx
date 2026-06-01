import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';

type Mode = 'create' | 'join';

export default function TeamSetupPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('create');
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user?.teamId) {
    navigate('/', { replace: true });
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        await api('/teams', { method: 'POST', json: { name: teamName } });
      } else {
        await api('/teams/join', { method: 'POST', json: { code: inviteCode.trim() } });
      }
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm card space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-center">Set up your team</h1>
          <p className="text-sm text-slate-600 text-center mt-1">
            Welcome, {user?.name}.
          </p>
        </div>

        <div className="flex rounded-md bg-slate-100 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 rounded py-2 ${mode === 'create' ? 'bg-white shadow' : 'text-slate-600'}`}
          >
            Create team
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`flex-1 rounded py-2 ${mode === 'join' ? 'bg-white shadow' : 'text-slate-600'}`}
          >
            Join team
          </button>
        </div>

        {error && <div className="text-sm text-rose-600">{error}</div>}

        {mode === 'create' ? (
          <div>
            <label className="label" htmlFor="teamName">Team name</label>
            <input
              id="teamName"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="input"
              required
            />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="inviteCode">Invite code</label>
            <input
              id="inviteCode"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="input"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Ask the team owner for the code shown on their team page.
            </p>
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : mode === 'create' ? 'Create team' : 'Join team'}
        </button>
        <button type="button" onClick={logout} className="text-xs text-slate-500 underline w-full text-center">
          Sign out
        </button>
      </form>
    </div>
  );
}
