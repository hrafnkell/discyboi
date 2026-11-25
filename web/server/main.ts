/**
 * discyboi server: accounts + throw history in SQLite, a live event stream per user, and (when
 * web/dist exists) the built site. Run with `bun run server`; in development Vite proxies /api here.
 *
 * Env: PORT (8787), DISCYBOI_DB (./data/discyboi.db), DISCYBOI_SIGNUP (open | closed, default open),
 * DISCYBOI_MAX_THROWS (per account, 20000), DISCYBOI_TRUST_PROXY (1 = use X-Forwarded-For / -Proto),
 * DISCYBOI_ORIGINS (extra allowed origins, comma separated), DISCYBOI_HOST (canonical host, e.g. discyboi.com)
 * with DISCYBOI_ALIASES (hosts that 308-redirect to it, comma separated).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { Db, type StoredThrow, type User } from './db';

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
const DB_PATH = resolve(env.DISCYBOI_DB ?? join(import.meta.dir, '../data/discyboi.db'));
const SIGNUP_OPEN = (env.DISCYBOI_SIGNUP ?? 'open') !== 'closed';
const MAX_THROWS = Number(env.DISCYBOI_MAX_THROWS ?? 20000);
const TRUST_PROXY = env.DISCYBOI_TRUST_PROXY === '1';
const EXTRA_ORIGINS = new Set((env.DISCYBOI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const HOST = env.DISCYBOI_HOST?.trim();
const ALIASES = new Set((env.DISCYBOI_ALIASES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const DIST = resolve(import.meta.dir, '../dist');
// Disc firmware offered to connected discs: manifest.json + the signed image, put there by firmware/release.sh.
const FIRMWARE = resolve(env.DISCYBOI_FIRMWARE ?? join(import.meta.dir, '../firmware'));
const SESSION_TTL = 60 * 24 * 3600e3; // 60 days
const COOKIE = 'discyboi_session';
const MAX_THROW_BYTES = 16 * 1024;
const MAX_BULK = 1000;
const MAX_CAPTURE_BYTES = 256 * 1024; // a full capture is 86 KB
const MAX_CAPTURES = Number(env.DISCYBOI_MAX_CAPTURES ?? 1000);

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Db(DB_PATH);
setInterval(() => db.pruneSessions(), 3600e3);

// ------------------------------------------------------------------ helpers
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers } });
}
const err = (status: number, error: string) => json({ error }, status);

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req: Request): boolean {
  if (new URL(req.url).protocol === 'https:') return true;
  return TRUST_PROXY && req.headers.get('x-forwarded-proto') === 'https';
}

function sessionCookie(req: Request, token: string, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${isHttps(req) ? '; Secure' : ''}`;
}

/** Writes must come from this site: the Origin (sent by browsers on POST/PUT/DELETE) must match the Host. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser client; the cookie is SameSite=Lax anyway
  if (EXTRA_ORIGINS.has(origin)) return true;
  const host = (TRUST_PROXY && req.headers.get('x-forwarded-host')) || req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(req: Request, server: Bun.Server<undefined>): string {
  if (TRUST_PROXY) {
    const f = req.headers.get('x-forwarded-for');
    // The proxy appends the address it saw, so the last entry is the one a client can't forge.
    if (f) return f.split(',').at(-1)!.trim();
  }
  return server.requestIP(req)?.address ?? '?';
}

/**
 * Failed logins in 15 minutes: at most 10 per IP + username and 50 per IP. Keyed on the pair, so
 * someone else guessing can't lock the real user out from their own address.
 */
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60e3;
function limited(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => (failures.get(k) ?? []).filter((t) => now - t < WINDOW).length >= (k.startsWith('ip:') ? 50 : 10));
}
function fail(keys: string[]) {
  const now = Date.now();
  for (const k of keys) failures.set(k, [...(failures.get(k) ?? []).filter((t) => now - t < WINDOW), now]);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failures) if (v.every((t) => now - t >= WINDOW)) failures.delete(k);
}, WINDOW);

/** Interest sign-ups: at most this many per IP per hour, and this many stored in all. */
const INTEREST_PER_HOUR = 5;
const MAX_INTEREST = Number(env.DISCYBOI_MAX_INTEREST ?? 2000);
const signups = new Map<string, number[]>();
function signupLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (signups.get(ip) ?? []).filter((t) => now - t < 3600e3);
  if (recent.length >= INTEREST_PER_HOUR) return true;
  signups.set(ip, [...recent, now]);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of signups) if (v.every((t) => now - t >= 3600e3)) signups.delete(k);
}, 3600e3);
// Deliberately loose: one @, a dot in the domain, no spaces. The real check is writing to it.
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const THROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function body<T>(req: Request): Promise<T | undefined> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return undefined;
  try {
    return (await req.json()) as T;
  } catch {
    return undefined;
  }
}

/** Accepts a client ThrowRecord: an object with a safe id, a timestamp and release params. */
function toStored(t: unknown): StoredThrow | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const r = t as { id?: unknown; ts?: unknown; params?: unknown };
  if (typeof r.id !== 'string' || !THROW_ID.test(r.id)) return undefined;
  if (typeof r.ts !== 'number' || !Number.isFinite(r.ts) || r.ts < 0) return undefined;
  if (!r.params || typeof r.params !== 'object') return undefined;
  const data = JSON.stringify(t);
  if (data.length > MAX_THROW_BYTES) return undefined;
  return { id: r.id, ts: Math.round(r.ts), data };
}

// ------------------------------------------------------------ live events
type Sink = { send: (s: string) => void; close: () => void };
const sinks = new Map<number, Set<Sink>>();
function publish(userId: number, ev: object) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const s of sinks.get(userId) ?? []) s.send(line);
}
/** Event payloads carry the stored JSON as-is, so wrap it rather than re-parsing. */
const putEvent = (items: StoredThrow[]) => `{"op":"put","throws":[${items.map((t) => t.data).join(',')}]}`;
function publishRaw(userId: number, raw: string) {
  for (const s of sinks.get(userId) ?? []) s.send(`data: ${raw}\n\n`);
}

function events(req: Request, user: User): Response {
  let sink: Sink;
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<string>({
    start(ctl) {
      sink = {
        send: (s) => {
          try {
            ctl.enqueue(s);
          } catch {
            /* closed */
          }
        },
        close: () => ctl.close(),
      };
      if (!sinks.has(user.id)) sinks.set(user.id, new Set());
      sinks.get(user.id)!.add(sink);
      sink.send('retry: 3000\n\n: hello\n\n');
      ping = setInterval(() => sink.send(': ping\n\n'), 25e3);
      req.signal.addEventListener('abort', () => cleanup());
    },
    cancel: () => cleanup(),
  });
  const cleanup = () => {
    clearInterval(ping);
    sinks.get(user.id)?.delete(sink);
  };
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...SEC_HEADERS } });
}

// ------------------------------------------------------------------- routes
async function api(req: Request, server: Bun.Server<undefined>, path: string): Promise<Response> {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return err(403, 'Cross-site request refused');
  const token = cookies(req)[COOKIE];
  const user = db.sessionUser(token);

  if (path === '/api/me' && method === 'GET') {
    return json({ user: user ?? null, signup: SIGNUP_OPEN, maxThrows: MAX_THROWS, count: user ? db.countThrows(user.id) : 0 });
  }

  // "Want a board?" form on the landing page. No account needed.
  if (path === '/api/interest' && method === 'POST') {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return err(400, 'Bad request');
    if (clean(b.website, 200)) return json({ ok: true }); // honeypot: only bots fill the hidden field
    const name = clean(b.name, 100), email = clean(b.email, 254).toLowerCase(), note = clean(b.note, 1000);
    const wants = b.wants === 'kit' ? 'kit' : b.wants === 'board' ? 'board' : '';
    if (!name) return err(400, 'Please enter your name');
    if (!EMAIL.test(email)) return err(400, 'Please enter a valid email address');
    if (!wants) return err(400, 'Please choose board or board + case');
    if (signupLimited(clientIp(req, server))) return err(429, 'Too many sign-ups from here. Try again in an hour.');
    if (db.countInterest() >= MAX_INTEREST) return err(503, 'The list is full for now. Please email info@discyboi.com instead.');
    const added = db.addInterest({ email, name, wants, note });
    console.log(`interest: ${added ? 'new' : 'updated'} sign-up (${wants})`);
    // Same answer either way, so the form can't be used to find out who is on the list.
    return json({ ok: true });
  }

  if ((path === '/api/login' || path === '/api/signup') && method === 'POST') {
    const b = await body<{ username?: unknown; password?: unknown }>(req);
    const username = typeof b?.username === 'string' ? b.username.trim() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    const ip = clientIp(req, server);
    const keys = [`ip:${ip}`, `ipu:${ip}|${username.toLowerCase()}`];
    if (limited(keys)) return err(429, 'Too many attempts. Try again in 15 minutes.');
    let u: User | undefined;
    if (path === '/api/signup') {
      if (!SIGNUP_OPEN) return err(403, 'Sign-up is closed on this server');
      if (!USERNAME.test(username)) return err(400, 'Username: 3–32 letters, digits, . _ or -');
      if (password.length < 8 || password.length > 256) return err(400, 'Password: at least 8 characters');
      u = await db.createUser(username, password);
      if (!u) {
        fail([`ip:${ip}`]); // stops enumerating names through sign-up
        return err(409, 'That username is taken');
      }
    } else {
      if (!username || !password || password.length > 256) return err(400, 'Enter a username and password');
      u = await db.checkLogin(username, password);
      if (!u) {
        fail(keys);
        return err(401, 'Wrong username or password');
      }
    }
    if (token) db.endSession(token);
    const t = db.newSession(u.id, SESSION_TTL);
    return json({ user: u, signup: SIGNUP_OPEN, maxThrows: MAX_THROWS, count: db.countThrows(u.id) }, 200, { 'Set-Cookie': sessionCookie(req, t, SESSION_TTL) });
  }

  if (path === '/api/logout' && method === 'POST') {
    if (token) db.endSession(token);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Everything below needs a session.
  if (!user) return err(401, 'Not signed in');

  if (path === '/api/password' && method === 'POST') {
    const b = await body<{ current?: unknown; password?: unknown }>(req);
    const ip = clientIp(req, server);
    const keys = [`ip:${ip}`, `ipu:${ip}|${user.username.toLowerCase()}`];
    if (limited(keys)) return err(429, 'Too many attempts. Try again in 15 minutes.');
    if (typeof b?.current !== 'string' || !(await db.checkLogin(user.username, b.current))) {
      fail(keys);
      return err(401, 'Current password is wrong');
    }
    if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 256) return err(400, 'Password: at least 8 characters');
    await db.changePassword(user.id, b.password); // also ends every session
    const t = db.newSession(user.id, SESSION_TTL);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, t, SESSION_TTL) });
  }

  if (path === '/api/events' && method === 'GET') {
    server.timeout(req, 0); // long-lived stream
    return events(req, user);
  }

  if (path === '/api/throws') {
    if (method === 'GET') {
      const rows = db.listThrows(user.id, MAX_THROWS);
      // Stored rows are already JSON: splice them instead of parse + stringify.
      return new Response(`{"throws":[${rows.map((r) => r.data).join(',')}]}`, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS } });
    }
    if (method === 'POST') {
      // Bulk upsert: new throws, edits, and importing a browser's local history.
      const b = await body<{ throws?: unknown[] }>(req);
      if (!Array.isArray(b?.throws) || b.throws.length > MAX_BULK) return err(400, `Send { throws: [...] }, at most ${MAX_BULK} at a time`);
      const items: StoredThrow[] = [];
      let rejected = 0;
      for (const t of b.throws) {
        const s = toStored(t);
        if (s) items.push(s);
        else rejected++;
      }
      const added = db.putThrows(user.id, items);
      const dropped = db.trimThrows(user.id, MAX_THROWS);
      if (items.length) publishRaw(user.id, putEvent(items.filter((t) => !dropped.includes(t.id))));
      if (dropped.length) publish(user.id, { op: 'del', ids: dropped });
      return json({ added: added.length, updated: items.length - added.length, rejected, dropped: dropped.length, count: db.countThrows(user.id) });
    }
    if (method === 'DELETE') {
      db.clearThrows(user.id);
      publish(user.id, { op: 'clear' });
      return json({ ok: true });
    }
  }

  const cm = /^\/api\/captures\/([^/]+)$/.exec(path);
  if (cm && (method === 'PUT' || method === 'GET')) {
    const id = decodeURIComponent(cm[1]);
    if (!THROW_ID.test(id)) return err(400, 'Bad id');
    if (method === 'GET') {
      const data = db.getCapture(user.id, id);
      if (!data) return err(404, 'No capture for that throw');
      return new Response(data as BodyInit, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="discyboi-capture-${id}.bin"`, 'Cache-Control': 'no-store', ...SEC_HEADERS } });
    }
    if (Number(req.headers.get('content-length') ?? 0) > MAX_CAPTURE_BYTES) return err(413, 'Capture too large');
    const data = new Uint8Array(await req.arrayBuffer());
    if (data.length < 32 || data.length > MAX_CAPTURE_BYTES) return err(400, 'Not a capture');
    db.putCapture(user.id, id, data, MAX_CAPTURES);
    return json({ ok: true });
  }

  if (path === '/api/prefs') {
    if (method === 'GET') return new Response(`{"prefs":${db.getPrefs(user.id)}}`, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS } });
    if (method === 'PUT') {
      // Only known fields are kept. sessionStart: when the current practice session began (ms).
      const b = await body<{ sessionStart?: unknown }>(req);
      const s = b?.sessionStart;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return err(400, 'Send { sessionStart: <ms> }');
      const data = JSON.stringify({ sessionStart: Math.round(s) });
      db.setPrefs(user.id, data);
      publishRaw(user.id, `{"op":"prefs","prefs":${data}}`);
      return json({ ok: true });
    }
  }

  const m = /^\/api\/throws\/([^/]+)$/.exec(path);
  if (m && method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    if (!THROW_ID.test(id)) return err(400, 'Bad id');
    if (db.deleteThrow(user.id, id)) publish(user.id, { op: 'del', ids: [id] });
    return json({ ok: true });
  }

  return err(404, 'Not found');
}

const redirect = (to: string) => new Response(null, { status: 308, headers: { Location: to, ...SEC_HEADERS } });

async function staticFile(path: string, root = DIST, search = ''): Promise<Response> {
  if (!existsSync(root)) return new Response(root === DIST ? 'Not found (run `bun run build`, or use the Vite dev server)' : 'Not found', { status: 404 });
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (file !== root && !file.startsWith(root + '/')) return new Response('Not found', { status: 404 });
  // A folder without its trailing slash: relative links in its index page would resolve one level up.
  if (!rel.endsWith('/') && existsSync(join(file, 'index.html'))) return redirect(rel + '/' + search);
  let f = Bun.file(file);
  if (!(await f.exists()) && (await Bun.file(file + '.html').exists())) f = Bun.file((file += '.html'));
  if (!(await f.exists())) return new Response('Not found', { status: 404 });
  const cache = root === DIST && rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  return new Response(f, { headers: { 'Cache-Control': cache, ...SEC_HEADERS } });
}

const server = Bun.serve({
  port: PORT,
  hostname: env.HOST ?? '0.0.0.0',
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(req, srv) {
    const url = new URL(req.url), path = url.pathname;
    // Old and www hostnames go to the one real address, keeping the path and query.
    if (HOST && ALIASES.has(url.hostname.toLowerCase())) return redirect(`https://${HOST}${path}${url.search}`);
    try {
      if (path.startsWith('/api/')) return await api(req, srv, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      if (path.startsWith('/firmware/')) return await staticFile(path.slice('/firmware'.length), FIRMWARE);
      // The app moved from / to /lab/ when the landing page arrived: keep old links and bookmarks working.
      if (path === '/throws' || path === '/throws.html') return redirect(`/lab/throws.html${url.search}`);
      if ((path === '/' || path === '/index.html') && (url.searchParams.has('throw') || url.searchParams.has('fake'))) return redirect(`/lab/${url.search}`);
      return await staticFile(path, DIST, url.search);
    } catch (e) {
      console.error(e);
      return err(500, 'Server error');
    }
  },
});

console.log(`discyboi server on http://localhost:${server.port} · db ${DB_PATH} · sign-up ${SIGNUP_OPEN ? 'open' : 'closed'}${existsSync(DIST) ? ' · serving dist/' : ''}`);
