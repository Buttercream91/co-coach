import type { LiveState } from '../types';

// Clock helpers mirroring the server. live.clockMultiplier (default 1) speeds
// up wall-clock seconds into game seconds — used for the dev-mode timer.

export function currentClockSec(live: LiveState | null, now: Date = new Date()): number {
  if (!live || !live.halfStartedAt) return 0;
  const mult = live.clockMultiplier ?? 1;
  const halfStart = new Date(live.halfStartedAt).getTime();
  const nowMs = now.getTime();
  const pausedMs = live.pausedAt
    ? live.totalPausedMs + (nowMs - new Date(live.pausedAt).getTime())
    : live.totalPausedMs;
  return Math.floor(((nowMs - halfStart - pausedMs) * mult) / 1000);
}

export function halftimeRemainingSec(live: LiveState | null, now: Date = new Date()): number {
  if (!live || live.phase !== 'halftime' || !live.halftimeStartedAt) return 5 * 60;
  const mult = live.clockMultiplier ?? 1;
  const elapsedReal = (now.getTime() - new Date(live.halftimeStartedAt).getTime()) / 1000;
  return Math.floor(5 * 60 - elapsedReal * mult);
}

export function formatClock(sec: number, halfLengthMin: number): string {
  const halfSec = halfLengthMin * 60;
  const diff = halfSec - sec;
  const abs = Math.abs(diff);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (diff >= 0) return `${mm}:${ss}`;
  return `+${mm}:${ss}`;
}

export function formatSigned(sec: number): string {
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sec < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}
