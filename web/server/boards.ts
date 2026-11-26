/**
 * How many boards the lab has seen (anonymous: a hash of each chip's factory ID). Run where the database is:
 *   bun server/boards.ts          summary, then every board (oldest first)
 * On the host: ssh <host> 'cd ~/srv/discyboi && ~/.bun/bin/bun server/boards.ts'
 * Only boards on firmware 0.4.2 or later that connected to the lab are counted.
 */
import { join, resolve } from 'node:path';
import { Db } from './db';

const db = new Db(resolve(process.env.DISCYBOI_DB ?? join(import.meta.dir, '../data/discyboi.db')));
const rows = db.listBoards();
const date = (t: number) => new Date(t).toISOString().slice(0, 10);
const now = Date.now();
const within = (days: number) => rows.filter((r) => now - r.last_seen < days * 86400e3).length;

for (const r of rows) {
  console.log(`${r.id}  first ${date(r.first_seen)}  last ${date(r.last_seen)}  ${String(r.connects).padStart(5)} connects  ${String(r.throws).padStart(6)} throws  ${r.fw}`);
}
const fw = new Map<string, number>();
for (const r of rows) fw.set(r.fw.split('+')[0] || '?', (fw.get(r.fw.split('+')[0] || '?') ?? 0) + 1);
const throws = rows.reduce((n, r) => n + r.throws, 0);
console.log(`\n${rows.length} board${rows.length === 1 ? '' : 's'} seen, ${within(7)} in the last 7 days, ${within(30)} in the last 30; ${throws} throws`);
console.log('firmware: ' + [...fw].sort().map(([v, n]) => `${v} × ${n}`).join(', '));
