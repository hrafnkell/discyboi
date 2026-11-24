/** Talks to the discyboi server (server/main.ts): sign-in state and the throw API. */
import type { ThrowRecord } from './throws';

export interface User {
  id: number;
  username: string;
}

export interface Me {
  user: User | null;
  signup: boolean;
  maxThrows: number;
  count: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Server unreachable');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  if (!ct.includes('application/json')) throw new ApiError(0, 'Server unreachable'); // e.g. a static host with no API
  return data as T;
}

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  login: (username: string, password: string) => call<Me>('POST', '/api/login', { username, password }),
  signup: (username: string, password: string) => call<Me>('POST', '/api/signup', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout'),
  password: (current: string, password: string) => call<{ ok: true }>('POST', '/api/password', { current, password }),
  throws: () => call<{ throws: ThrowRecord[] }>('GET', '/api/throws'),
  put: (throws: ThrowRecord[]) => call<{ added: number; updated: number; rejected: number; dropped: number; count: number }>('POST', '/api/throws', { throws }),
  del: (id: string) => call<{ ok: true }>('DELETE', `/api/throws/${encodeURIComponent(id)}`),
  clear: () => call<{ ok: true }>('DELETE', '/api/throws'),
  prefs: () => call<{ prefs: Prefs }>('GET', '/api/prefs'),
  setPrefs: (p: Prefs) => call<{ ok: true }>('PUT', '/api/prefs', p),
};

/** Settings shared by every device signed in to the account. */
export interface Prefs {
  /** When the current practice session began (ms since epoch). */
  sessionStart?: number;
}

export type ServerEvent = { op: 'put'; throws: ThrowRecord[] } | { op: 'del'; ids: string[] } | { op: 'clear' } | { op: 'prefs'; prefs: Prefs };
