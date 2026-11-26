/** Talks to the discyboi server (server/main.ts): sign-in state and the throw API. */
import type { Units } from '../units';
import type { ThrowRecord } from './throws';

export interface User {
  id: number;
  username: string;
  /** Optional, for account recovery. */
  email?: string | null;
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
  signup: (username: string, password: string, email?: string) => call<Me>('POST', '/api/signup', { username, password, ...(email ? { email } : {}) }),
  email: (email: string) => call<{ ok: true; email: string | null }>('POST', '/api/email', { email }),
  logout: () => call<{ ok: true }>('POST', '/api/logout'),
  password: (current: string, password: string) => call<{ ok: true }>('POST', '/api/password', { current, password }),
  throws: () => call<{ throws: ThrowRecord[] }>('GET', '/api/throws'),
  put: (throws: ThrowRecord[]) => call<{ added: number; updated: number; rejected: number; dropped: number; count: number }>('POST', '/api/throws', { throws }),
  del: (id: string) => call<{ ok: true }>('DELETE', `/api/throws/${encodeURIComponent(id)}`),
  clear: () => call<{ ok: true }>('DELETE', '/api/throws'),
  /** Stores the raw sensor recording that belongs to a throw. */
  putCapture: async (id: string, bytes: Uint8Array) => {
    let res: Response;
    try {
      res = await fetch(`/api/captures/${encodeURIComponent(id)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as BodyInit });
    } catch {
      throw new ApiError(0, 'Server unreachable');
    }
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  },
  prefs: () => call<{ prefs: Prefs }>('GET', '/api/prefs'),
  /** Changes only the fields given; the server keeps the rest. */
  setPrefs: (p: Prefs) => call<{ ok: true }>('PUT', '/api/prefs', p),
};

/** Settings shared by every device signed in to the account. Add a field here and in PREFS in server/main.ts. */
export interface Prefs {
  /** When the current practice session began (ms since epoch). */
  sessionStart?: number;
  /** Metric (m, m/s) or imperial (ft, mph). */
  units?: Units;
}

export type ServerEvent = { op: 'put'; throws: ThrowRecord[] } | { op: 'del'; ids: string[] } | { op: 'clear' } | { op: 'prefs'; prefs: Prefs };
