/** SQLite storage: users, login sessions, throws. One file, WAL mode. */
import { Database } from 'bun:sqlite';

export interface User {
  id: number;
  username: string;
}

export interface StoredThrow {
  id: string;
  ts: number;
  data: string; // the client's ThrowRecord as JSON
}

const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

export class Db {
  readonly sql: Database;

  constructor(path: string) {
    this.sql = new Database(path, { create: true, strict: true });
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pw_hash TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,          -- sha256 of the cookie value; the raw token is never stored
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS throws (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE INDEX IF NOT EXISTS throws_user_ts ON throws(user_id, ts DESC);
      CREATE TABLE IF NOT EXISTS captures (   -- raw sensor recording of a throw, as sent by the disc
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,                     -- the throw's id
        created INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS prefs (      -- small per-account settings shared by all devices
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
    `);
  }

  // ------------------------------------------------------------- users
  async createUser(username: string, password: string): Promise<User | undefined> {
    const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
    try {
      const row = this.sql.query<{ id: number }, [string, string, number]>('INSERT INTO users (username, pw_hash, created) VALUES (?, ?, ?) RETURNING id').get(username, hash, Date.now());
      return row ? { id: row.id, username } : undefined;
    } catch (e) {
      if (String(e).includes('UNIQUE')) return undefined; // name taken
      throw e;
    }
  }

  /** Always runs a hash verify, so a missing user takes as long as a wrong password. */
  async checkLogin(username: string, password: string): Promise<User | undefined> {
    const row = this.sql.query<{ id: number; username: string; pw_hash: string }, [string]>('SELECT id, username, pw_hash FROM users WHERE username = ?').get(username);
    const ok = await Bun.password.verify(password, row?.pw_hash ?? DUMMY_HASH);
    return row && ok ? { id: row.id, username: row.username } : undefined;
  }

  async changePassword(userId: number, password: string) {
    const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
    this.sql.query('UPDATE users SET pw_hash = ? WHERE id = ?').run(hash, userId);
    this.sql.query('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // ---------------------------------------------------------- sessions
  newSession(userId: number, ttlMs: number): string {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const now = Date.now();
    this.sql.query('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now + ttlMs);
    return token;
  }

  sessionUser(token: string | undefined): User | undefined {
    if (!token) return undefined;
    return (
      this.sql
        .query<User, [string, number]>('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?')
        .get(sha256(token), Date.now()) ?? undefined
    );
  }

  endSession(token: string) {
    this.sql.query('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  pruneSessions() {
    this.sql.query('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  }

  // ------------------------------------------------------------ throws
  listThrows(userId: number, limit: number): StoredThrow[] {
    return this.sql.query<StoredThrow, [number, number]>('SELECT id, ts, data FROM throws WHERE user_id = ? ORDER BY ts DESC LIMIT ?').all(userId, limit);
  }

  countThrows(userId: number): number {
    return this.sql.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM throws WHERE user_id = ?').get(userId)!.n;
  }

  /** Inserts or replaces throws. Returns the ids that were new. */
  putThrows(userId: number, items: StoredThrow[]): string[] {
    const exists = this.sql.query<{ x: number }, [number, string]>('SELECT 1 AS x FROM throws WHERE user_id = ? AND id = ?');
    const put = this.sql.query('INSERT INTO throws (user_id, id, ts, data, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET ts = excluded.ts, data = excluded.data, updated = excluded.updated');
    const added: string[] = [];
    this.sql.transaction(() => {
      const now = Date.now();
      for (const t of items) {
        if (!exists.get(userId, t.id)) added.push(t.id);
        put.run(userId, t.id, t.ts, t.data, now);
      }
    })();
    return added;
  }

  /** Drops the oldest throws beyond `max`. Returns the dropped ids. */
  trimThrows(userId: number, max: number): string[] {
    const old = this.sql.query<{ id: string }, [number, number]>('SELECT id FROM throws WHERE user_id = ? ORDER BY ts DESC LIMIT -1 OFFSET ?').all(userId, max);
    if (old.length) this.sql.query('DELETE FROM throws WHERE user_id = ? AND id IN (SELECT id FROM throws WHERE user_id = ? ORDER BY ts DESC LIMIT -1 OFFSET ?)').run(userId, userId, max);
    return old.map((r) => r.id);
  }

  deleteThrow(userId: number, id: string): boolean {
    this.sql.query('DELETE FROM captures WHERE user_id = ? AND id = ?').run(userId, id);
    return this.sql.query('DELETE FROM throws WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
  }

  clearThrows(userId: number) {
    this.sql.query('DELETE FROM captures WHERE user_id = ?').run(userId);
    this.sql.query('DELETE FROM throws WHERE user_id = ?').run(userId);
  }

  // ---------------------------------------------------------- captures
  /** Stores a capture and drops the oldest ones beyond `max`. */
  putCapture(userId: number, id: string, data: Uint8Array, max: number) {
    this.sql.query('INSERT INTO captures (user_id, id, created, data) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET created = excluded.created, data = excluded.data').run(userId, id, Date.now(), data);
    this.sql.query('DELETE FROM captures WHERE user_id = ? AND id IN (SELECT id FROM captures WHERE user_id = ? ORDER BY created DESC LIMIT -1 OFFSET ?)').run(userId, userId, max);
  }

  getCapture(userId: number, id: string): Uint8Array | undefined {
    return this.sql.query<{ data: Uint8Array }, [number, string]>('SELECT data FROM captures WHERE user_id = ? AND id = ?').get(userId, id)?.data;
  }

  // ------------------------------------------------------------- prefs
  /** The account's shared settings as stored JSON ('{}' if none). */
  getPrefs(userId: number): string {
    return this.sql.query<{ data: string }, [number]>('SELECT data FROM prefs WHERE user_id = ?').get(userId)?.data ?? '{}';
  }

  setPrefs(userId: number, data: string) {
    this.sql.query('INSERT INTO prefs (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated').run(userId, data, Date.now());
  }
}

// A real argon2id hash of a random string, verified against when the user doesn't exist.
const DUMMY_HASH = await Bun.password.hash(crypto.randomUUID(), { algorithm: 'argon2id' });
