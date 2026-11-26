/**
 * Daily database backups: a copy of the database in <db dir>/backups/discyboi-YYYY-MM-DD.db, made
 * at start-up if today's is missing and checked again every hour. The newest KEEP are kept.
 * Restore by stopping the server and copying a backup over the database file (and removing the
 * -wal / -shm files next to it).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './db';

const KEEP = 7;
const NAME = /^discyboi-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupNow(db: Db, dbPath: string, now = new Date()): string | undefined {
  const dir = join(dirname(dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const file = join(dir, `discyboi-${day}.db`);
  if (existsSync(file)) return undefined;
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  db.backup(tmp); // written under a temporary name, so a half-made copy never looks like a backup
  renameSync(tmp, file);
  const old = readdirSync(dir).filter((f) => NAME.test(f)).sort().slice(0, -KEEP);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}

export function scheduleBackups(db: Db, dbPath: string) {
  const run = () => {
    try {
      const f = backupNow(db, dbPath);
      if (f) console.log(`backup: ${f}`);
    } catch (e) {
      console.error('backup failed:', e);
    }
  };
  run();
  setInterval(run, 3600e3).unref?.();
}
