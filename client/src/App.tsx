import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import TeamSetupPage from './pages/TeamSetupPage';
import PlayersPage from './pages/PlayersPage';
import PlayerProfilePage from './pages/PlayerProfilePage';
import MatchCreatePage from './pages/MatchCreatePage';
import MatchEditPage from './pages/MatchEditPage';
import MatchStatsPage from './pages/MatchStatsPage';
import EnterGamePage from './pages/EnterGamePage';
import TeamPage from './pages/TeamPage';
import AppShell from './components/AppShell';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireTeam({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.teamId) return <Navigate to="/team-setup" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/team-setup"
        element={
          <ProtectedRoute>
            <TeamSetupPage />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <RequireTeam>
            <AppShell />
          </RequireTeam>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/players/:playerId" element={<PlayerProfilePage />} />
        <Route path="/matches/new" element={<MatchCreatePage />} />
        <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
        <Route path="/matches/:matchId/play" element={<EnterGamePage />} />
        <Route path="/matches/:matchId/stats" element={<MatchStatsPage />} />
        <Route path="/team" element={<TeamPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
