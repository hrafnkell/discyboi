/**
 * Throw history (localStorage, or the server when signed in) and settings (localStorage).
 * Trajectories are not stored; they are re-simulated from the parameters when replayed.
 */
import type { ThrowResult } from '../ble/protocol';
import type { Mount } from '../sim/convert';
import type { DiscSpec, FlightResult, Hand, ThrowParams } from '../sim/types';
import { api, ApiError, type ServerEvent, type User } from './account';

export interface ThrowRecord {
  id: string;
  ts: number;
  source: 'manual' | 'disc';
  disc: DiscSpec;
  params: ThrowParams;
  raw?: ThrowResult; // as received from the hardware
  anglesEstimated?: boolean;
  summary: { distance: number; carry: number; lateral: number; apex: number; flightTime: number };
  actualDistance?: number; // measured by the player, for future model calibration
  note?: string; // free text, e.g. what the player was working on
  noSim?: boolean; // the disc reported no valid speed: release angles only, no flight simulated
}

export interface Settings {
  hand: Hand;
  mount: Mount;
  units: 'm' | 'ft';
  basketDist: number;
}

const KEY = 'discyboi.throws.v1';
const SETTINGS_KEY = 'discyboi.settings.v1';
const MAX = 500;

export function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: history just isn't persisted */
  }
}

export function summarize(f: FlightResult): ThrowRecord['summary'] {
  return { distance: f.distance, carry: f.carry, lateral: f.lateral, apex: f.apex, flightTime: f.flightTime };
}

type ChangeKind = 'change' | 'reload';
type PendingOp = { t: 'put'; rec: ThrowRecord } | { t: 'del'; id: string } | { t: 'clear' };
export type SyncState = 'local' | 'synced' | 'pending' | 'offline' | 'signedout';

/**
 * Throw history. Signed out it lives in this browser's localStorage (newest 500). Signed in it
 * lives on the server (much larger cap): changes apply here at once, queue in localStorage until
 * the server has them, and other tabs and devices hear about them over a live event stream.
 */
export class ThrowStore {
  private items: ThrowRecord[];
  private user?: User;
  private max = MAX;
  private es?: EventSource;
  private flushing = false;
  private retry?: ReturnType<typeof setTimeout>;
  sync: SyncState = 'local';
  /** 'reload' = the whole list was replaced (sign in/out), not a new throw. */
  onChange?: (kind: ChangeKind) => void;
  onSync?: (s: SyncState) => void;
  /** The server stopped accepting this session (expired or signed out elsewhere). */
  onAuthLost?: () => void;

  constructor() {
    this.items = this.loadLocal();
    // Another tab added or edited throws: pick them up (signed in, the event stream does this).
    window.addEventListener('storage', (e) => {
      if (this.user || (e.key !== KEY && e.key !== null)) return;
      this.items = this.loadLocal();
      this.onChange?.('change');
    });
    window.addEventListener('online', () => this.flush());
  }

  get account(): User | undefined {
    return this.user;
  }

  get capacity(): number {
    return this.max;
  }

  private loadLocal(): ThrowRecord[] {
    const v = read<ThrowRecord[]>(KEY, []);
    return Array.isArray(v) ? v : [];
  }

  /** Throws saved in this browser while signed out (for uploading into an account). */
  localThrows(): ThrowRecord[] {
    return this.loadLocal();
  }

  // ------------------------------------------------------------ backends
  /** Switch to the account's history on the server. */
  async useAccount(user: User, maxThrows: number) {
    this.closeStream();
    this.user = user;
    this.max = maxThrows;
    this.items = [];
    this.setSync('pending');
    this.onChange?.('reload');
    await this.fetchAll();
    this.openStream();
    void this.flush();
  }

  /** Back to this browser's own history. */
  useLocal() {
    this.closeStream();
    clearTimeout(this.retry);
    this.user = undefined;
    this.max = MAX;
    this.items = this.loadLocal();
    this.setSync('local');
    this.onChange?.('reload');
  }

  private async fetchAll() {
    const user = this.user;
    try {
      const { throws } = await api.throws();
      if (this.user !== user) return;
      this.items = throws;
      for (const op of this.pending()) this.applyLocal(op);
      this.setSync(this.pending().length ? 'pending' : 'synced');
    } catch (e) {
      if (this.user !== user) return;
      if (e instanceof ApiError && e.status === 401) return this.authLost();
      this.setSync('offline');
    }
    this.onChange?.('reload');
  }

  private openStream() {
    if (typeof EventSource === 'undefined') return;
    let opened = false;
    const es = new EventSource('/api/events');
    this.es = es;
    es.onopen = () => {
      // A reconnect may have missed events: refetch. The first open follows a fresh fetch.
      if (opened) void this.fetchAll();
      opened = true;
      if (this.sync === 'offline') void this.flush();
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        // Usually a 401: check the session, then reconnect if it's still good.
        this.es = undefined;
        api.me().then(
          (me) => (me.user ? this.user && setTimeout(() => this.user && !this.es && this.openStream(), 5000) : this.authLost()),
          () => this.user && setTimeout(() => this.user && !this.es && this.openStream(), 10000),
        );
      }
      if (this.user) this.setSync('offline');
    };
    es.onmessage = (m) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(m.data) as ServerEvent;
      } catch {
        return;
      }
      if (ev.op === 'put') for (const r of ev.throws) this.applyLocal({ t: 'put', rec: r });
      else if (ev.op === 'del') for (const id of ev.ids) this.applyLocal({ t: 'del', id });
      else this.applyLocal({ t: 'clear' });
      if (this.sync === 'offline') this.setSync(this.pending().length ? 'pending' : 'synced');
      this.onChange?.('change');
    };
  }

  private closeStream() {
    this.es?.close();
    this.es = undefined;
  }

  private authLost() {
    this.closeStream();
    this.setSync('signedout');
    this.onAuthLost?.();
  }

  private setSync(s: SyncState) {
    if (this.sync === s) return;
    this.sync = s;
    this.onSync?.(s);
  }

  // ------------------------------------------------- pending server writes
  private get pendingKey() {
    return `discyboi.pending.${this.user?.id}`;
  }

  private pending(): PendingOp[] {
    if (!this.user) return [];
    const v = read<PendingOp[]>(this.pendingKey, []);
    return Array.isArray(v) ? v : [];
  }

  private queue(op: PendingOp) {
    // A later put of the same throw supersedes an earlier one.
    const q = this.pending().filter((o) => !(op.t === 'put' && o.t === 'put' && o.rec.id === op.rec.id));
    write(this.pendingKey, op.t === 'clear' ? [op] : [...q, op]);
    this.setSync('pending');
    void this.flush();
  }

  /** Sends queued changes in order. Network trouble leaves them queued and retries. */
  private async flush(): Promise<void> {
    if (!this.user || this.flushing) return;
    this.flushing = true;
    clearTimeout(this.retry);
    const user = this.user;
    try {
      for (;;) {
        const q = this.pending();
        if (!q.length || this.user !== user) break;
        let n = 1;
        const head = q[0];
        if (head.t === 'put') {
          while (n < q.length && n < 500 && q[n].t === 'put') n++;
          await api.put(q.slice(0, n).map((o) => (o as { rec: ThrowRecord }).rec));
        } else if (head.t === 'del') await api.del(head.id);
        else await api.clear();
        // Drop what was sent; keep anything queued meanwhile (possibly by another tab).
        const sent = q.slice(0, n).map((o) => JSON.stringify(o));
        const now = this.pending();
        write(this.pendingKey, now.filter((o, i) => !(i < sent.length && JSON.stringify(o) === sent[i])));
      }
      if (this.user === user) this.setSync('synced');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.authLost();
      else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        // The server refused it for good (e.g. malformed): drop that op so the queue doesn't jam.
        write(this.pendingKey, this.pending().slice(1));
        this.flushing = false;
        return await this.flush();
      } else {
        this.setSync('offline');
        this.retry = setTimeout(() => this.flush(), 10000);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Applies an op to the in-memory list only. */
  private applyLocal(op: PendingOp) {
    if (op.t === 'clear') this.items = [];
    else if (op.t === 'del') this.items = this.items.filter((t) => t.id !== op.id);
    else {
      const i = this.items.findIndex((t) => t.id === op.rec.id);
      if (i >= 0) this.items[i] = op.rec;
      else {
        this.items.push(op.rec);
        this.items.sort((a, b) => b.ts - a.ts);
        if (this.items.length > this.max) this.items.length = this.max;
      }
    }
  }

  /** Uploads this browser's signed-out history into the account. Returns how many were new. */
  async uploadLocal(): Promise<number> {
    const local = this.loadLocal();
    let added = 0;
    for (let i = 0; i < local.length; i += 500) added += (await api.put(local.slice(i, i + 500))).added;
    return added;
  }

  // ------------------------------------------------------------ queries
  all(): readonly ThrowRecord[] {
    return this.items;
  }

  get(id: string) {
    return this.items.find((t) => t.id === id);
  }

  // ------------------------------------------------------------ changes
  add(rec: Omit<ThrowRecord, 'id' | 'ts'>): ThrowRecord {
    const full: ThrowRecord = { ...rec, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
    this.items.unshift(full);
    if (this.items.length > this.max) this.items.length = this.max;
    this.saved({ t: 'put', rec: full });
    return full;
  }

  update(id: string, patch: Partial<ThrowRecord>) {
    const t = this.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.saved({ t: 'put', rec: t });
  }

  remove(id: string) {
    this.items = this.items.filter((t) => t.id !== id);
    this.saved({ t: 'del', id });
  }

  /** Throws listed in an exported JSON file, merged in by id. Returns how many were new. */
  importJson(text: string): number {
    const data = JSON.parse(text) as { throws?: ThrowRecord[] };
    const have = new Set(this.items.map((t) => t.id));
    const add = (data.throws ?? []).filter((t) => t && typeof t.id === 'string' && typeof t.ts === 'number' && t.params && !have.has(t.id));
    this.items = [...this.items, ...add].sort((a, b) => b.ts - a.ts).slice(0, this.max);
    if (this.user) {
      const q = this.pending();
      write(this.pendingKey, [...q, ...add.map((rec) => ({ t: 'put' as const, rec }))]);
      this.setSync('pending');
      void this.flush();
      this.onChange?.('change');
    } else this.saved();
    return add.length;
  }

  clear() {
    this.items = [];
    this.saved({ t: 'clear' });
  }

  exportJson(): string {
    return JSON.stringify({ app: 'discyboi', version: 1, exported: new Date().toISOString(), throws: this.items }, null, 2);
  }

  private saved(op?: PendingOp) {
    if (this.user) {
      if (op) this.queue(op);
    } else write(KEY, this.items);
    this.onChange?.('change');
  }
}

export const DEFAULT_SETTINGS: Settings = { hand: 'R', mount: 'faceUp', units: 'm', basketDist: 100 };

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(s: Settings) {
  write(SETTINGS_KEY, s);
}
