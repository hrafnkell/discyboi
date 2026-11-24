/**
 * Throw history page: live numbers for the latest throw (field work: no 3D needed), session
 * stats with targets, a per-metric trend, the full list, a detail view and a side-by-side compare.
 * Updates live from its own disc connection and from throws recorded in other tabs.
 */
import '../style.css';
import './throws.css';
import type { ThrowResult } from '../ble/protocol';
import { FLAG_ANGLES_VALID, FLAG_LANDED, FLAG_REF_APPROX, FLAG_SPEED_VALID, FLAG_SPIN_CENTRIP, noSpeedReason } from '../ble/protocol';
import { DISCS } from '../sim/discs';
import { simulate } from '../sim/flight';
import type { DiscSpec, FlightResult } from '../sim/types';
import { discThrow } from '../store/record';
import { loadSettings, read, saveSettings, ThrowStore, write, type ThrowRecord } from '../store/throws';
import { AccountPanel } from '../ui/accountPanel';
import { DevicePanel } from '../ui/devicePanel';
import { fmtDist, h, segmented } from '../ui/dom';
import { fmt, metric, METRICS, onTarget, stats, type Metric, type Targets } from './metrics';
import { pathPlot, SERIES, trendChart } from './plots';

type Range = 'session' | 'today' | 'week' | 'all';
interface UiState {
  range: Range;
  sessionStart: number;
  targets: Targets;
  trendKey: string;
  follow: boolean;
  speak: boolean;
  discId: string;
}
const UI_KEY = 'discyboi.historyui.v1';
const ui: UiState = { range: 'session', sessionStart: Date.now() - 3 * 3600e3, targets: {}, trendKey: 'nose', follow: true, speak: false, discId: 'drv-stable', ...read<Partial<UiState>>(UI_KEY, {}) };
const saveUi = () => write(UI_KEY, ui);

const settings = loadSettings();
const fake = new URLSearchParams(location.search).has('fake');
const store = new ThrowStore();
const flights = new Map<string, FlightResult>();
let selected: string | undefined = new URLSearchParams(location.search).get('throw') ?? undefined;
const compare: string[] = []; // ids in selection order; slot i gets SERIES[i] and letter A..F
let tab: 'detail' | 'compare' = 'detail';
let newestId = store.all()[0]?.id;
let flashId: string | undefined;

const units = () => settings.units;
const fmtLen = (m: number) => fmtDist(m, units());
const LETTERS = 'ABCDEF';

function flightOf(r: ThrowRecord): FlightResult | undefined {
  if (r.noSim) return undefined;
  let f = flights.get(r.id);
  if (!f) flights.set(r.id, (f = simulate(r.params, r.disc)));
  return f;
}

function inRange(r: ThrowRecord): boolean {
  const now = Date.now();
  switch (ui.range) {
    case 'session':
      return r.ts >= ui.sessionStart;
    case 'today':
      return new Date(r.ts).toDateString() === new Date(now).toDateString();
    case 'week':
      return r.ts >= now - 7 * 86400e3;
    default:
      return true;
  }
}
/** Throws in range, oldest first (numbered 1..n in the table and the trend). */
const ranged = () => store.all().filter(inRange).slice().reverse();

const timeStr = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateStr = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function targetBadge(key: string, v: number | undefined): HTMLElement | null {
  const st = onTarget(ui.targets, key, v);
  if (!st) return null;
  if (st === 'in') return h('span.badge.in', {}, '✓ on target');
  const b = ui.targets[key];
  const low = b.min !== undefined && v! < b.min;
  return h('span.badge.out', {}, low ? '▼ low' : '▲ high');
}

// ---------------------------------------------------------------- top bar
const toasts = h('div.toasts', { 'aria-live': 'polite' });
const toast = (msg: string, kind?: 'err') => {
  const t = h('div.toast', { class: kind === 'err' ? 'toast err' : 'toast' }, msg);
  toasts.append(t);
  setTimeout(() => t.remove(), 4000);
};

function onDiscThrow(r: ThrowResult) {
  const disc = DISCS.find((d) => d.id === ui.discId) ?? DISCS[0];
  const t = discThrow(r, disc, { hand: settings.hand, mount: settings.mount });
  const rec = store.add(t.rec); // onChange re-renders and treats it as new
  if (t.flight) flights.set(rec.id, t.flight);
  if (!t.flight) toast(`Throw #${r.throwId}: no valid speed, angles only`, 'err');
}
const device = new DevicePanel(fake, onDiscThrow, toast);
const account = new AccountPanel(store, toast);
const labLink = h('a.ghostbtn.navlink', { href: `./index.html${fake ? '?fake=1' : ''}` }, '← Flight lab');

document.body.classList.add('page');
document.body.append(
  h('header.topbar', {}, h('div.brand', {}, h('span.logo'), 'discyboi', h('small', {}, fake ? 'throws · fake disc' : 'throws')), labLink, h('div.spacer'), device.el, account.el),
  toasts,
);
const wrap = h('main.wrap');
document.body.append(wrap);

// ---------------------------------------------------------------- recording settings
const discSel = h('select', { 'aria-label': 'Disc used for new throws' }, ...DISCS.map((d) => h('option', { value: d.id, selected: d.id === ui.discId }, `${d.name}`)));
discSel.addEventListener('change', () => ((ui.discId = discSel.value), saveUi()));
const handSeg = segmented([{ id: 'R', label: 'Right' }, { id: 'L', label: 'Left' }], settings.hand, (v) => ((settings.hand = v), saveSettings(settings)));
const mountSeg = segmented([{ id: 'faceUp', label: 'Face up' }, { id: 'faceDown', label: 'Face down' }], settings.mount, (v) => ((settings.mount = v), saveSettings(settings)));
const unitSeg = segmented([{ id: 'm', label: 'm' }, { id: 'ft', label: 'ft' }], settings.units, (v) => ((settings.units = v), saveSettings(settings), renderAll()));
const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, title: string) => {
  const cb = h('input', { type: 'checkbox', checked: get() });
  cb.addEventListener('change', () => set(cb.checked));
  return h('label.toggle', { title }, cb, label);
};
const recCard = h('section.card.reccard', {},
  h('div.cardhead', {}, h('h2', {}, 'Recording')),
  h('div.recrow', {},
    h('label.field', {}, h('span', {}, 'Disc'), discSel),
    h('div.field', {}, h('span', {}, 'Hand'), handSeg.el),
    h('div.field', {}, h('span', {}, 'Board'), mountSeg.el),
    h('div.field', {}, h('span', {}, 'Units'), unitSeg.el),
    toggle('Follow latest', () => ui.follow, (v) => ((ui.follow = v), saveUi()), 'Open each new throw in the detail view'),
    toggle('Speak', () => ui.speak, (v) => {
      ui.speak = v;
      saveUi();
      if (v) speak('Speaking new throws');
    }, 'Read out the numbers of each new throw, so you can keep your eyes off the screen'),
  ),
);

// ---------------------------------------------------------------- latest throw
const latestCard = h('section.card.latest');
const HERO = ['speed', 'spin', 'hyzer', 'nose', 'launch', 'aoa', 'wobble', 'distance'];

function renderLatest() {
  const r = store.all()[0];
  if (!r) {
    latestCard.replaceChildren(h('div.cardhead', {}, h('h2', {}, 'Latest throw')), h('p.muted', {}, fake ? 'Connect the fake disc, or throw in the flight lab.' : 'Connect the disc and throw, or throw in the flight lab. New throws appear here live.'));
    return;
  }
  const others = ranged().filter((x) => x.id !== r.id);
  const tiles = HERO.filter((k) => metric(k).group !== 'sensor' || metric(k).get(r) !== undefined).map((k) => {
    const m = metric(k);
    const v = m.get(r);
    const st = stats(others.map((o) => m.get(o)));
    const d = v !== undefined && st && st.n >= 2 ? v - st.mean : undefined;
    const ot = onTarget(ui.targets, k, v);
    return h('div.tile', { class: ot ? `tile ${ot}` : 'tile' },
      h('span.tl', {}, m.label),
      h('b', {}, fmt(m, v, units(), false), v !== undefined && m.unit !== 'm' ? h('small', {}, m.unit === '°' ? '°' : ` ${m.unit}`) : v !== undefined && m.unit === 'm' ? h('small', {}, units() === 'ft' ? ' ft' : ' m') : null),
      h('span.ts', {}, v !== undefined && m.sub ? m.sub(v) : ' '),
      h('span.delta', {}, d === undefined ? ' ' : `${d >= 0 ? '+' : '−'}${fmt(m, Math.abs(d), units())} vs avg`),
      targetBadge(k, v),
    );
  });
  latestCard.replaceChildren(
    h('div.cardhead', {},
      h('h2', {}, 'Latest throw'),
      h('span.meta', {}, `${timeStr(r.ts)} · ${r.disc.name} · ${r.params.hand}H${r.params.style}${r.raw ? ` · disc #${r.raw.throwId}` : ''}${r.anglesEstimated ? ' · angles estimated' : ''}`),
      h('button.ghostbtn', { type: 'button', onclick: () => select(r.id) }, 'Details'),
    ),
    h('div.tiles', {}, ...tiles),
  );
  if (flashId === r.id) {
    latestCard.classList.remove('flash');
    void latestCard.offsetWidth;
    latestCard.classList.add('flash');
    flashId = undefined;
  }
}

// ---------------------------------------------------------------- range + stats with targets
const rangeSeg = segmented<Range>(
  [{ id: 'session', label: 'Session' }, { id: 'today', label: 'Today' }, { id: 'week', label: '7 days' }, { id: 'all', label: 'All' }],
  ui.range,
  (v) => ((ui.range = v), saveUi(), renderAll()),
);
const newSessionBtn = h('button.ghostbtn', { type: 'button', title: 'Only count throws from now on', onclick: () => {
  ui.sessionStart = Date.now();
  ui.range = 'session';
  rangeSeg.set('session');
  saveUi();
  renderAll();
  toast('New session started');
} }, 'New session');
const rangeInfo = h('span.meta');
const statsCard = h('section.card.statscard');

function renderStats() {
  const list = ranged();
  rangeInfo.textContent = ui.range === 'session' ? `${list.length} throws since ${dateStr(ui.sessionStart)}` : `${list.length} throws`;
  const rows = METRICS.map((m) => {
    const st = stats(list.map((r) => m.get(r)));
    const t = ui.targets[m.key] ?? {};
    const inp = (side: 'min' | 'max') => {
      const el = h('input.tnum', { type: 'number', step: m.dp ? 0.5 : 1, value: t[side] ?? '', placeholder: side, 'aria-label': `${m.label} target ${side}` });
      el.addEventListener('change', () => {
        const cur = { ...(ui.targets[m.key] ?? {}) };
        if (el.value === '') delete cur[side];
        else cur[side] = Number(el.value);
        if (cur.min === undefined && cur.max === undefined) delete ui.targets[m.key];
        else ui.targets[m.key] = cur;
        saveUi();
        renderLatest();
        renderTrend();
        renderTable();
        renderStatsHit();
      });
      return el;
    };
    const vals = list.map((r) => m.get(r)).filter((v) => v !== undefined);
    const hits = vals.filter((v) => onTarget(ui.targets, m.key, v) === 'in').length;
    const hasT = ui.targets[m.key] !== undefined;
    return h('tr', { class: m.key === ui.trendKey ? 'cur' : undefined },
      h('th', {}, h('button.linkbtn', { type: 'button', title: 'Show the trend', onclick: () => ((ui.trendKey = m.key), saveUi(), renderTrend(), renderStats()) }, m.label)),
      h('td', {}, st ? fmt(m, st.mean, units()) : '–'),
      h('td', {}, st && st.n > 1 ? `±${fmt(m, st.sd, units(), false)}` : '–'),
      h('td', {}, st ? `${fmt(m, st.min, units(), false)} … ${fmt(m, st.max, units(), false)}` : '–'),
      h('td.target', {}, inp('min'), inp('max')),
      h('td.hit', { 'data-key': m.key }, hasT && vals.length ? `${hits}/${vals.length}` : ''),
    );
  });
  statsCard.replaceChildren(
    h('div.cardhead', {}, h('h2', {}, 'Stats'), rangeInfo),
    h('div.scrollx', {}, h('table.stats-t', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Mean'), h('th', {}, 'Spread (sd)'), h('th', {}, 'Range'), h('th', {}, 'Target min / max'), h('th', {}, 'On target'))),
      h('tbody', {}, ...rows),
    )),
  );
}
/** Updates just the on-target counts (so typing a target doesn't rebuild the inputs). */
function renderStatsHit() {
  const list = ranged();
  for (const td of statsCard.querySelectorAll<HTMLElement>('td.hit')) {
    const m = metric(td.dataset.key!);
    const vals = list.map((r) => m.get(r)).filter((v) => v !== undefined);
    td.textContent = ui.targets[m.key] && vals.length ? `${vals.filter((v) => onTarget(ui.targets, m.key, v) === 'in').length}/${vals.length}` : '';
  }
}

// ---------------------------------------------------------------- trend
const trendCard = h('section.card.trendcard');
const trendKeys = ['speed', 'spin', 'hyzer', 'nose', 'launch', 'aoa', 'wobble', 'distance', 'actual'];

function renderTrend() {
  const m = metric(ui.trendKey) ?? metric('nose');
  const list = ranged();
  const pts = list.flatMap((r, i) => {
    const v = m.get(r);
    if (v === undefined) return [];
    const val = m.unit === 'm' && units() === 'ft' ? v * 3.28084 : v;
    return [{ id: r.id, v: val, selected: r.id === selected, label: `#${i + 1} · ${timeStr(r.ts)}: ${fmt(m, v, units())}` }];
  });
  const t = ui.targets[m.key];
  const conv = (x?: number) => (x === undefined ? undefined : m.unit === 'm' && units() === 'ft' ? x * 3.28084 : x);
  const seg = segmented(trendKeys.map((k) => ({ id: k, label: metric(k).short })), m.key, (k) => {
    ui.trendKey = k;
    saveUi();
    renderTrend();
    renderStats();
  });
  trendCard.replaceChildren(
    h('div.cardhead', {}, h('h2', {}, `Trend · ${m.label}`), h('span.meta', {}, t ? 'shaded: target band' : 'set a target in Stats to shade it')),
    h('div.scrollx', {}, seg.el),
    trendChart(pts, { unit: m.unit === 'm' ? units() : m.unit, dp: m.dp, target: t && { min: conv(t.min), max: conv(t.max) }, onPick: (id) => select(id) }),
  );
}

// ---------------------------------------------------------------- table
const tableCard = h('section.card.tablecard');
const COLS = ['speed', 'spin', 'hyzer', 'nose', 'launch', 'aoa', 'wobble', 'distance', 'actual'];
const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  try {
    toast(`Imported ${store.importJson(await f.text())} new throws`);
  } catch (e) {
    toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'err');
  }
  fileIn.value = '';
});

function renderTable() {
  const list = ranged();
  const body = list
    .map((r, i) => {
      const cb = h('input', { type: 'checkbox', checked: compare.includes(r.id), 'aria-label': 'Compare', title: compare.length >= 6 && !compare.includes(r.id) ? 'Compare holds up to 6 throws' : 'Compare' });
      cb.addEventListener('change', () => toggleCompare(r.id, cb.checked));
      const slot = compare.indexOf(r.id);
      return h('tr', { class: [r.id === selected ? 'sel' : '', r.id === newestId && list.length > 1 ? 'newest' : ''].join(' ').trim() || undefined, onclick: (e: Event) => {
        if ((e.target as HTMLElement).closest('input')) return;
        select(r.id);
      } },
        h('td.cmp', {}, cb, slot >= 0 ? h('span.slot', { style: `background:${SERIES[slot]}` }, LETTERS[slot]) : null),
        h('td.n', {}, String(i + 1)),
        h('td.time', {}, timeStr(r.ts)),
        h('td', {}, h('span.swatch', { style: `background:${r.disc.color}` }), ' ', r.source === 'disc' ? h('span.tag', {}, r.anglesEstimated ? 'disc*' : 'disc') : h('span.tag.man', { title: 'Entered in the flight lab' }, 'lab')),
        ...COLS.map((k) => {
          const m = metric(k);
          const v = m.get(r);
          const ot = onTarget(ui.targets, k, v);
          return h('td.num', { class: ot ? `num ${ot}` : 'num' }, fmt(m, v, units(), false));
        }),
        h('td.note', { title: r.note ?? '' }, r.note ?? ''),
      );
    })
    .reverse();
  tableCard.replaceChildren(
    h('div.cardhead', {},
      h('h2', {}, 'Throws'),
      h('span.meta', {}, 'Tick up to 6 to compare'),
      h('button.ghostbtn', { type: 'button', onclick: () => fileIn.click() }, 'Import'),
      h('button.ghostbtn', { type: 'button', onclick: () => exportJson() }, 'Export'),
    ),
    fileIn,
    list.length
      ? h('div.scrollx', {}, h('table.throws-t', {},
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '#'), h('th', {}, 'Time'), h('th', {}, ''), ...COLS.map((k) => {
            const m = metric(k);
            return h('th.num', { title: m.label }, m.short, h('small', {}, m.unit === 'm' ? units() : m.unit));
          }), h('th', {}, 'Note'))),
          h('tbody', {}, ...body),
        ))
      : h('p.muted', {}, 'No throws in this range.'),
  );
}

function exportJson() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `discyboi-throws-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- side: detail / compare
const sideCard = h('section.card.side');

function toggleCompare(id: string, on: boolean) {
  const i = compare.indexOf(id);
  if (on && i < 0) {
    if (compare.length >= 6) {
      toast('Compare holds up to 6 throws');
      renderTable();
      return;
    }
    compare.push(id);
  } else if (!on && i >= 0) compare.splice(i, 1);
  if (compare.length >= 2) tab = 'compare';
  if (!compare.length && tab === 'compare') tab = 'detail';
  renderTable();
  renderSide();
}

function select(id: string) {
  selected = id;
  tab = 'detail';
  history.replaceState(null, '', `?${new URLSearchParams({ ...(fake ? { fake: '1' } : {}), throw: id })}`);
  renderTable();
  renderTrend();
  renderSide();
  if (innerWidth < 1100) sideCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSide() {
  const tabs = segmented<'detail' | 'compare'>([{ id: 'detail', label: 'Detail' }, { id: 'compare', label: `Compare (${compare.length})` }], tab, (v) => ((tab = v), renderSide()));
  sideCard.replaceChildren(h('div.cardhead', {}, tabs.el), tab === 'detail' ? detailView() : compareView());
}

function detailView(): HTMLElement {
  const r = selected ? store.get(selected) : undefined;
  if (!r) return h('p.muted', {}, 'Click a throw in the list, the trend or the latest card to see it here.');
  const groups: [string, Metric['group']][] = [['Release', 'release'], ['Sensor', 'sensor'], ['Result', 'result']];
  const grid = groups.map(([title, g]) => {
    const ms = METRICS.filter((m) => m.group === g && m.key !== 'actual' && m.get(r) !== undefined);
    if (!ms.length) return null;
    return h('div.dgroup', {}, h('h3', {}, title), h('dl.dgrid', {}, ...ms.flatMap((m) => {
      const v = m.get(r);
      return [h('dt', {}, m.label), h('dd', {}, fmt(m, v, units()), m.sub && v !== undefined ? h('small', {}, m.sub(v)) : null, targetBadge(m.key, v))];
    })));
  });
  const f = flightOf(r);
  if (f) grid.push(h('div.dgroup', {}, h('h3', {}, 'Simulated flight'), h('dl.dgrid', {},
    h('dt', {}, 'Carry'), h('dd', {}, fmtLen(f.carry)),
    h('dt', {}, 'Skip'), h('dd', {}, fmtLen(Math.hypot(f.rest[0] - f.landing[0], f.rest[1] - f.landing[1]))),
    h('dt', {}, 'Apex'), h('dd', {}, fmtLen(f.apex)),
    h('dt', {}, 'Flight time'), h('dd', {}, `${f.flightTime.toFixed(1)} s`),
  )));
  if (r.raw) {
    const fl = r.raw.flags;
    const flag = (bit: number, on: string, off: string) => h('li', { class: fl & bit ? 'ok' : 'no' }, fl & bit ? `✓ ${on}` : `✗ ${off}`);
    grid.push(h('div.dgroup', {}, h('h3', {}, `From the disc · #${r.raw.throwId}`), h('ul.flags', {},
      flag(FLAG_ANGLES_VALID, 'angles measured', 'angles estimated (no still moment before the throw)'),
      flag(FLAG_SPEED_VALID, fl & FLAG_REF_APPROX ? 'speed and angles approximate (disc not held still before the throw)' : 'speed measured', `no valid speed: ${noSpeedReason(fl)}`),
      flag(FLAG_SPIN_CENTRIP, 'spin from the off-centre accelerometer (above gyro range)', 'spin from the gyro'),
      flag(FLAG_LANDED, 'landing detected', 'no landing detected'),
      h('li', {}, `battery ${(r.raw.batteryMv / 1000).toFixed(2)} V`),
    )));
  }
  const actual = h('input.tnum.wide', { type: 'number', min: 0, step: 1, value: r.actualDistance ?? '', placeholder: 'm', 'aria-label': 'Actual distance in metres' });
  actual.addEventListener('change', () => store.update(r.id, { actualDistance: actual.value === '' ? undefined : Number(actual.value) }));
  const note = h('textarea.notebox', { rows: 2, placeholder: 'What were you working on? e.g. "nose down, more snap"', 'aria-label': 'Note' });
  note.value = r.note ?? '';
  note.addEventListener('change', () => store.update(r.id, { note: note.value.trim() || undefined }));
  const del = h('button.ghostbtn.danger', { type: 'button', onclick: () => {
    if (!del.dataset.armed) {
      del.dataset.armed = '1';
      del.textContent = 'Really delete?';
      setTimeout(() => {
        delete del.dataset.armed;
        del.textContent = 'Delete';
      }, 2500);
      return;
    }
    const i = compare.indexOf(r.id);
    if (i >= 0) compare.splice(i, 1);
    selected = undefined;
    store.remove(r.id);
  } }, 'Delete');
  const inCmp = compare.includes(r.id);
  return h('div.detail', {},
    h('div.dhead', {},
      h('span.swatch', { style: `background:${r.disc.color}` }),
      h('div', {}, h('b', {}, dateStr(r.ts)), h('div.meta', {}, `${r.disc.name} · ${r.params.hand}H${r.params.style} · ${r.source === 'disc' ? 'from the disc' : 'entered in the flight lab'}`)),
    ),
    ...grid,
    h('div.dgroup', {}, h('h3', {}, 'Your notes'),
      h('label.field.inline', {}, h('span', {}, 'Actual distance'), actual, h('span.muted', {}, 'm')),
      note),
    f ? h('div.dgroup', {}, h('h3', {}, 'Path from above'), pathPlot([{ flight: f, color: SERIES[0], label: '' }], 'top', fmtLen), h('h3', {}, 'From the side'), pathPlot([{ flight: f, color: SERIES[0], label: '' }], 'side', fmtLen))
      : h('p.muted', {}, 'No valid speed, so no flight was simulated.'),
    h('div.actions', {},
      h('a.ghostbtn', { href: `./index.html?${new URLSearchParams({ ...(fake ? { fake: '1' } : {}), throw: r.id })}` }, 'Open in flight lab'),
      h('button.ghostbtn', { type: 'button', onclick: () => toggleCompare(r.id, !inCmp) }, inCmp ? 'Remove from compare' : 'Add to compare'),
      del,
    ),
  );
}

function compareView(): HTMLElement {
  const recs = compare.map((id) => store.get(id)).filter((r): r is ThrowRecord => !!r);
  if (recs.length < 2) return h('p.muted', {}, 'Tick two or more throws in the list (up to 6) to compare them side by side. The first one ticked is the baseline.');
  const head = h('tr', {}, h('th', {}, ''), ...recs.map((r, i) => h('th', {}, h('span.slot', { style: `background:${SERIES[i]}` }, LETTERS[i]), h('div.meta', {}, timeStr(r.ts)), h('button.x', { type: 'button', title: 'Remove', 'aria-label': 'Remove from compare', onclick: () => toggleCompare(r.id, false) }, '×'))));
  const rows = METRICS.filter((m) => recs.some((r) => m.get(r) !== undefined)).map((m) => {
    const base = m.get(recs[0]);
    return h('tr', {}, h('th', {}, m.label), ...recs.map((r, i) => {
      const v = m.get(r);
      const d = i > 0 && v !== undefined && base !== undefined ? v - base : undefined;
      const ot = onTarget(ui.targets, m.key, v);
      return h('td', { class: ot ?? undefined }, fmt(m, v, units()), d !== undefined && Math.abs(d) >= 10 ** -m.dp / 2 ? h('small', {}, `${d > 0 ? '+' : '−'}${fmt(m, Math.abs(d), units())}`) : null);
    }));
  });
  rows.push(h('tr', {}, h('th', {}, 'Disc'), ...recs.map((r) => h('td', {}, r.disc.name))));
  rows.push(h('tr', {}, h('th', {}, 'Note'), ...recs.map((r) => h('td.note', {}, r.note ?? ''))));
  const ser = recs.flatMap((r, i) => {
    const f = flightOf(r);
    return f ? [{ flight: f, color: SERIES[i], label: LETTERS[i] }] : [];
  });
  return h('div.compare', {},
    h('div.scrollx', {}, h('table.cmp-t', {}, h('thead', {}, head), h('tbody', {}, ...rows))),
    h('p.meta', {}, 'Differences are against A.'),
    ser.length ? h('div.dgroup', {}, h('h3', {}, 'Paths from above'), pathPlot(ser, 'top', fmtLen), h('h3', {}, 'From the side'), pathPlot(ser, 'side', fmtLen)) : null,
    h('div.actions', {}, h('button.ghostbtn', { type: 'button', onclick: () => {
      compare.length = 0;
      tab = 'detail';
      renderTable();
      renderSide();
    } }, 'Clear compare')),
  );
}

// ---------------------------------------------------------------- live updates
function speak(text: string) {
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* no speech synthesis */
  }
}
function speakThrow(r: ThrowRecord) {
  const keys = Object.keys(ui.targets).length ? Object.keys(ui.targets) : ['speed', 'nose', 'hyzer'];
  const parts = keys.flatMap((k) => {
    const m = metric(k);
    const v = m?.get(r);
    if (!m || v === undefined) return [];
    const unit = m.unit === '°' ? 'degrees' : m.unit === 'm/s' ? 'metres per second' : m.unit === 'm' ? (units() === 'ft' ? 'feet' : 'metres') : m.unit;
    const num = m.unit === 'm' && units() === 'ft' ? Math.round(v * 3.28084) : +v.toFixed(m.dp);
    const st = onTarget(ui.targets, k, v);
    return [`${m.label} ${num < 0 ? 'minus ' + Math.abs(num) : num} ${unit}${st === 'in' ? ', good' : st === 'out' ? ', off target' : ''}`];
  });
  speak(parts.join('. '));
}

store.onChange = (kind) => {
  const top = store.all()[0];
  if (kind === 'reload') newestId = top?.id; // signed in or out: a different list, not a new throw
  else if (top && top.id !== newestId) {
    newestId = top.id;
    flashId = top.id;
    if (ui.follow) selected = top.id; // stays on the Compare tab if that's open
    if (ui.speak) speakThrow(top);
  }
  if (selected && !store.get(selected)) selected = undefined;
  for (let i = compare.length - 1; i >= 0; i--) if (!store.get(compare[i])) compare.splice(i, 1);
  renderAll();
};

function renderAll() {
  renderLatest();
  renderStats();
  renderTrend();
  renderTable();
  // Don't rebuild the detail view under the user's cursor while they're typing a note.
  if (!sideCard.contains(document.activeElement) || document.activeElement === document.body) renderSide();
}

wrap.append(
  h('div.col.colmain', {}, recCard, latestCard, h('div.rangebar', {}, rangeSeg.el, newSessionBtn), trendCard, tableCard, statsCard),
  h('div.col.colside', {}, sideCard),
);
renderAll();

// Disc of the most recent throw is the default for new disc throws, if none was picked here.
if (!read<Partial<UiState>>(UI_KEY, {}).discId) {
  const d: DiscSpec | undefined = store.all()[0]?.disc;
  if (d && DISCS.some((x) => x.id === d.id)) discSel.value = ui.discId = d.id;
}
