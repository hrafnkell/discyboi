/**
 * The "want a board?" list from the landing page. Run where the database is:
 *   bun server/interest.ts                 list everyone (newest last)
 *   bun server/interest.ts --csv           as CSV, e.g. to paste into a spreadsheet
 *   bun server/interest.ts --delete <email>   remove someone who asked to be taken off
 * On the host: ssh <host> 'cd ~/srv/discyboi && ~/.bun/bin/bun server/interest.ts'
 */
import { join, resolve } from 'node:path';
import { Db } from './db';

const path = resolve(process.env.DISCYBOI_DB ?? join(import.meta.dir, '../data/discyboi.db'));
const db = new Db(path);
const [flag, arg] = process.argv.slice(2);

if (flag === '--delete') {
  if (!arg) throw new Error('usage: --delete <email>');
  console.log(db.deleteInterest(arg.trim().toLowerCase()) ? `removed ${arg}` : `${arg} is not on the list`);
} else {
  const rows = db.listInterest();
  const date = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  if (flag === '--csv') {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    console.log('signed up,updated,name,email,wants,note');
    for (const r of rows) console.log([date(r.created), date(r.updated), q(r.name), q(r.email), r.wants, q(r.note)].join(','));
  } else {
    for (const r of rows) console.log(`${date(r.created)}  ${r.wants === 'kit' ? 'board + case' : 'board       '}  ${r.name} <${r.email}>${r.note ? `\n                    ${r.note.replace(/\n/g, ' ')}` : ''}`);
    const kits = rows.filter((r) => r.wants === 'kit').length;
    console.log(`\n${rows.length} sign-up${rows.length === 1 ? '' : 's'}: ${rows.length - kits} board only, ${kits} board + case`);
  }
}
