import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getActiveTeamId, setActiveTeamId, setToken } from '../lib/api';

export type TeamMembership = {
  id: string;
  name: string;
  role: 'owner' | 'coach';
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  teams: TeamMembership[];
  teamId: string | null;
  teamName: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  activeTeam: TeamMembership | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setActiveTeam: (teamId: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(() => getActiveTeamId());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: AuthUser }>('/auth/me');
      setUser(me.user);
      // Reconcile active team id: keep current if still a member, otherwise pick first.
      const currentId = getActiveTeamId();
      const stillMember = currentId && me.user.teams.some((t) => t.id === currentId);
      const resolvedId = stillMember ? currentId : (me.user.teams[0]?.id ?? null);
      setActiveTeamIdState(resolvedId);
      setActiveTeamId(resolvedId);
    } catch {
      setUser(null);
      setActiveTeamIdState(null);
      setActiveTeamId(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        json: { email, password },
      });
      setToken(res.token);
      setUser(res.user);
      const firstTeamId = res.user.teams[0]?.id ?? null;
      setActiveTeamIdState(firstTeamId);
      setActiveTeamId(firstTeamId);
    },
    [],
  );

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      json: { email, password, name },
    });
    setToken(res.token);
    setUser(res.user);
    setActiveTeamIdState(null);
    setActiveTeamId(null);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setActiveTeamId(null);
    setUser(null);
    setActiveTeamIdState(null);
    qc.clear();
  }, [qc]);

  const setActiveTeam = useCallback(
    (teamId: string) => {
      setActiveTeamIdState(teamId);
      setActiveTeamId(teamId);
      // Wipe cached team-scoped data so the dashboard refetches with the new scope.
      qc.invalidateQueries();
    },
    [qc],
  );

  const activeTeam = useMemo(() => {
    if (!user || !activeTeamId) return null;
    return user.teams.find((t) => t.id === activeTeamId) ?? null;
  }, [user, activeTeamId]);

  const value = useMemo(
    () => ({ user, activeTeam, loading, login, register, logout, refresh, setActiveTeam }),
    [user, activeTeam, loading, login, register, logout, refresh, setActiveTeam],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
