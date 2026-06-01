import { useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useDevMode } from '../dev/DevModeContext';

export default function AppShell() {
  const { activeTeam, logout } = useAuth();
  const { devMode, setDevMode } = useDevMode();
  const [clicks, setClicks] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const lastClickRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  function handleTitleClick() {
    const now = Date.now();
    const next = now - lastClickRef.current > 1500 ? 1 : clicks + 1;
    lastClickRef.current = now;
    if (next >= 5) {
      const turningOn = !devMode;
      setDevMode(turningOn);
      setClicks(0);
      flashToast(turningOn ? 'Dev mode ON' : 'Dev mode OFF');
      return;
    }
    setClicks(next);
  }

  function flashToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTitleClick}
              className="text-lg font-bold focus:outline-none"
              aria-label="Co-Coach (tap 5 times to toggle dev mode)"
            >
              Co-Coach
            </button>
            {devMode && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-purple-600 px-1.5 py-0.5 rounded">
                DEV
              </span>
            )}
            {activeTeam && (
              <span className="text-sm text-slate-300">· {activeTeam.name}</span>
            )}
          </div>
          <button onClick={logout} className="text-sm text-slate-300 hover:text-white">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-10">
        <div className="mx-auto max-w-3xl flex">
          <Tab to="/" label="Matches" />
          <Tab to="/players" label="Players" />
          <Tab to="/team" label="Team" />
        </div>
      </nav>

      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm px-3 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex-1 text-center py-3 text-sm font-medium ${
          isActive ? 'text-emerald-600' : 'text-slate-600'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
