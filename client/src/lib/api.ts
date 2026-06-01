const TOKEN_KEY = 'cocoach.token';
const TEAM_KEY = 'cocoach.activeTeamId';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getActiveTeamId(): string | null {
  return localStorage.getItem(TEAM_KEY);
}

export function setActiveTeamId(id: string | null) {
  if (id) localStorage.setItem(TEAM_KEY, id);
  else localStorage.removeItem(TEAM_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Options = RequestInit & { json?: unknown };

// In dev, Vite's proxy forwards /api/* to localhost:3001 (see vite.config.ts),
// so VITE_API_URL is empty and we just fetch /api/...
// In prod (Render), VITE_API_URL is set to the API service origin (e.g.
// https://co-coach.onrender.com) and we issue cross-origin requests. The
// server already enables CORS for any origin (see server/src/index.ts).
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  const teamId = getActiveTeamId();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (teamId) headers.set('X-Team-Id', teamId);
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with ${res.status}`);
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}
