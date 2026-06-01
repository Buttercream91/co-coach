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

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  const teamId = getActiveTeamId();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (teamId) headers.set('X-Team-Id', teamId);
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api${path}`, {
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
