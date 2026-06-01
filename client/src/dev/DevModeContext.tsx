import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const KEY = 'cocoach.devmode';

type Ctx = {
  devMode: boolean;
  setDevMode: (v: boolean) => void;
};

const DevModeContext = createContext<Ctx | null>(null);

export function DevModeProvider({ children }: { children: React.ReactNode }) {
  const [devMode, setDevModeState] = useState(false);
  useEffect(() => {
    setDevModeState(localStorage.getItem(KEY) === '1');
  }, []);
  const setDevMode = useCallback((v: boolean) => {
    setDevModeState(v);
    localStorage.setItem(KEY, v ? '1' : '0');
  }, []);
  return <DevModeContext.Provider value={{ devMode, setDevMode }}>{children}</DevModeContext.Provider>;
}

export function useDevMode() {
  const ctx = useContext(DevModeContext);
  if (!ctx) throw new Error('useDevMode must be inside DevModeProvider');
  return ctx;
}
