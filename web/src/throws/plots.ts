/**
 * Small SVG charts for the history page: flight paths (top-down and side) and a per-metric trend.
 * No WebGL, so they work on any phone.
 */
import type { FlightResult } from '../sim/types';

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

/** Categorical slots (dark-surface steps), assigned in fixed order. Validated for CVD separation. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export interface PathSeries {
  flight: FlightResult;
  color: string;
  label: string;
}

/**
 * Flight paths. 'top': downrange → right, left of the thrower → up (lateral exaggerated if the
 * paths are narrow). 'side': downrange → right, height → up. Hovering shows each path's value at
 * that distance.
 */
export function pathPlot(series: PathSeries[], view: 'top' | 'side', fmtLen: (m: number) => string): HTMLElement {
  const W = 640;
  const H = view === 'top' ? 230 : 170;
  const pad = { l: 40, r: 14, t: 14, b: 24 };
  let xMax = 25;
  let yMin = view === 'top' ? -10 : 0;
  let yMax = view === 'top' ? 10 : 5;
  const val = (p: [number, number, number]) => (view === 'top' ? p[1] : p[2]);
  for (const { flight } of series)
    for (const pt of flight.points) {
      xMax = Math.max(xMax, pt.p[0]);
      yMin = Math.min(yMin, val(pt.p));
      yMax = Math.max(yMax, val(pt.p));
    }
  xMax *= 1.04;
  const ySpan = yMax - yMin;
  yMin -= ySpan * 0.08;
  yMax += ySpan * 0.08;
  const X = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r);
  const Y = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img' });
  svg.append(s('title', {}, view === 'top' ? 'Flight path from above' : 'Flight path from the side'));
  const grid = s('g', { class: 'grid' });
  const xs = niceStep(xMax, 6);
  for (let x = 0; x <= xMax; x += xs) {
    grid.append(s('line', { x1: X(x), x2: X(x), y1: pad.t, y2: H - pad.b }));
    grid.append(s('text', { x: X(x), y: H - 7, 'text-anchor': 'middle' }, fmtLen(x)));
  }
  const ys = niceStep(yMax - yMin, view === 'top' ? 4 : 3);
  for (let y = Math.ceil(yMin / ys) * ys; y <= yMax; y += ys) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(y), y2: Y(y), class: Math.abs(y) < 1e-9 ? 'zero' : '' }));
    const lab = view === 'top' ? (Math.abs(y) < 1e-9 ? '0' : `${fmtLen(Math.abs(y))} ${y > 0 ? 'L' : 'R'}`) : fmtLen(y);
    grid.append(s('text', { x: pad.l - 5, y: Y(y) + 3.5, 'text-anchor': 'end' }, lab));
  }
  svg.append(grid);

  for (const { flight, color, label } of series) {
    const air = flight.points.filter((p) => !p.onGround || p.t <= flight.flightTime);
    const d = air.map((p, i) => `${i ? 'L' : 'M'}${X(p.p[0]).toFixed(1)},${Y(val(p.p)).toFixed(1)}`).join('');
    svg.append(s('path', { d, class: 'path', stroke: color }));
    const ground = flight.points.filter((p) => p.t >= flight.flightTime);
    if (ground.length > 1)
      svg.append(s('path', { d: ground.map((p, i) => `${i ? 'L' : 'M'}${X(p.p[0]).toFixed(1)},${Y(val(p.p)).toFixed(1)}`).join(''), class: 'path skid', stroke: color }));
    const end = flight.rest;
    svg.append(s('circle', { cx: X(end[0]), cy: Y(val(end)), r: 4, fill: color, class: 'endpt' }));
    if (series.length > 1) svg.append(s('text', { x: X(end[0]) + 6, y: Y(val(end)) - 6, class: 'dlabel' }, label));
  }

  // Hover readout: a vertical rule and each path's value at that downrange distance.
  const rule = s('line', { class: 'rule', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
  const dots = series.map(({ color }) => s('circle', { r: 4, fill: color, class: 'hoverdot', visibility: 'hidden' }));
  svg.append(rule, ...dots);
  const wrap = document.createElement('div');
  wrap.className = 'plotwrap';
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  wrap.append(svg, tip);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const x = ((sx - pad.l) / (W - pad.l - pad.r)) * xMax;
    if (x < 0 || x > xMax) return hide();
    rule.setAttribute('x1', String(X(x)));
    rule.setAttribute('x2', String(X(x)));
    rule.setAttribute('visibility', 'visible');
    const rows: string[] = [`<b>${fmtLen(x)}</b>`];
    series.forEach(({ flight, label }, i) => {
      const pts = flight.points.filter((p) => !p.onGround);
      const k = pts.findIndex((p) => p.p[0] >= x);
      if (k <= 0) {
        dots[i].setAttribute('visibility', 'hidden');
        return;
      }
      const a = pts[k - 1];
      const b = pts[k];
      const f = (x - a.p[0]) / (b.p[0] - a.p[0] || 1);
      const v = val(a.p) + (val(b.p) - val(a.p)) * f;
      dots[i].setAttribute('cx', String(X(x)));
      dots[i].setAttribute('cy', String(Y(v)));
      dots[i].setAttribute('visibility', 'visible');
      const txt = view === 'top' ? (Math.abs(v) < 0.5 ? 'centre' : `${fmtLen(Math.abs(v))} ${v > 0 ? 'L' : 'R'}`) : `${fmtLen(v)} high`;
      rows.push(`${series.length > 1 ? `<i style="background:${series[i].color}"></i>${label}: ` : ''}${txt}`);
    });
    tip.innerHTML = rows.join('<br>');
    tip.hidden = false;
    const left = e.clientX - r.left;
    tip.style.left = `${Math.min(left + 12, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = '6px';
  });
  const hide = () => {
    rule.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  };
  svg.addEventListener('pointerleave', hide);
  return wrap;
}

export interface TrendPoint {
  id: string;
  v: number;
  label: string; // tooltip text
  selected?: boolean;
}

/**
 * One metric over the throws in range, oldest left. Dots + 2px line, a dashed mean, and the
 * target band shaded. Clicking a dot selects that throw.
 */
export function trendChart(points: TrendPoint[], opt: { unit: string; dp: number; target?: { min?: number; max?: number }; onPick: (id: string) => void }): HTMLElement {
  const W = 640;
  const H = 190;
  const pad = { l: 44, r: 14, t: 12, b: 22 };
  const wrap = document.createElement('div');
  wrap.className = 'plotwrap';
  if (!points.length) {
    wrap.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No values for this metric in the selected range.' }));
    return wrap;
  }
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  const t = opt.target;
  if (t?.min !== undefined) lo = Math.min(lo, t.min);
  if (t?.max !== undefined) hi = Math.max(hi, t.max);
  if (hi - lo < 1e-6) (lo -= 1), (hi += 1);
  const m = (hi - lo) * 0.12;
  lo -= m;
  hi += m;
  const n = points.length;
  const X = (i: number) => pad.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot trend', role: 'img' });

  if (t && (t.min !== undefined || t.max !== undefined)) {
    const y1 = Y(t.max ?? hi);
    const y2 = Y(t.min ?? lo);
    svg.append(s('rect', { x: pad.l, y: y1, width: W - pad.l - pad.r, height: Math.max(0, y2 - y1), class: 'band' }));
  }
  const grid = s('g', { class: 'grid' });
  const st = niceStep(hi - lo, 4);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: Math.abs(v) < 1e-9 ? 'zero' : '' }));
    grid.append(s('text', { x: pad.l - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }, `${+v.toFixed(Math.max(0, opt.dp))}${opt.unit === '°' ? '°' : ''}`));
  }
  const xt = Math.max(1, Math.ceil(n / 8));
  for (let i = 0; i < n; i += xt) grid.append(s('text', { x: X(i), y: H - 6, 'text-anchor': 'middle' }, `${i + 1}`));
  svg.append(grid);

  const mean = vs.reduce((a, b) => a + b, 0) / n;
  svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(mean), y2: Y(mean), class: 'mean' }));
  svg.append(s('text', { x: W - pad.r, y: Y(mean) - 4, 'text-anchor': 'end', class: 'meanlab' }, `mean ${mean.toFixed(opt.dp)}${opt.unit === '°' ? '°' : ` ${opt.unit}`}`));
  if (n > 1) svg.append(s('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(''), class: 'tline' }));
  points.forEach((p, i) => {
    const g = s('g', { class: `pt${p.selected ? ' sel' : ''}${i === n - 1 ? ' last' : ''}`, tabindex: 0 });
    g.append(s('circle', { cx: X(i), cy: Y(p.v), r: 12, class: 'hit' }));
    g.append(s('circle', { cx: X(i), cy: Y(p.v), r: p.selected || i === n - 1 ? 5.5 : 4, class: 'dot' }));
    g.append(s('title', {}, p.label));
    g.addEventListener('click', () => opt.onPick(p.id));
    g.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && opt.onPick(p.id));
    svg.append(g);
  });
  wrap.append(svg);
  return wrap;
}
