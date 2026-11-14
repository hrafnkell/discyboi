type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Tiny element builder: h('div.cls#id', {attrs, onclick}, ...children). */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}` | `${K}#${string}`, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9]+)([#.][^]*)?$/i.exec(sel)!;
  const el = document.createElement(m[1] as K);
  for (const part of (m[2] ?? '').match(/[#.][^#.]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  hint?: (v: number) => string;
  onInput: (v: number) => void;
}

export interface Slider {
  el: HTMLElement;
  set(v: number, silent?: boolean): void;
  get(): number;
}

/** Labelled range input with an editable numeric field and an optional derived hint. */
export function slider(o: SliderOpts): Slider {
  const range = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: o.value, 'aria-label': o.label });
  const num = h('input.num', { type: 'number', min: o.min, max: o.max, step: o.step, value: o.value, 'aria-label': `${o.label} value` });
  const hint = h('span.hint');
  const decimals = Math.max(0, (String(o.step).split('.')[1] ?? '').length);
  let value = o.value;
  const show = () => {
    range.value = String(value);
    if (document.activeElement !== num) num.value = value.toFixed(decimals);
    hint.textContent = o.hint ? o.hint(value) : '';
  };
  const set = (v: number, silent = false) => {
    if (!Number.isFinite(v)) return;
    value = Math.min(o.max, Math.max(o.min, v));
    show();
    if (!silent) o.onInput(value);
  };
  range.addEventListener('input', () => set(Number(range.value)));
  num.addEventListener('change', () => set(Number(num.value)));
  num.addEventListener('blur', show);
  show();
  const el = h('div.slider', {}, h('div.slider-head', {}, h('label', {}, o.label), hint, h('span.numwrap', {}, num, o.unit ? h('span.unit', {}, o.unit) : null)), range);
  return { el, set, get: () => value };
}

export function segmented<T extends string>(options: { id: T; label: string; title?: string }[], value: T, onChange: (v: T) => void) {
  const el = h('div.seg', { role: 'group' });
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', title: o.title, 'aria-pressed': String(o.id === value), onclick: () => set(o.id, false) }, o.label);
    el.append(b);
    return b;
  });
  const set = (v: T, silent = true) => {
    value = v;
    btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].id === v)));
    if (!silent) onChange(v);
  };
  return { el, set, get: () => value };
}

export function section(title: string, ...kids: (Node | null)[]) {
  return h('section.card', {}, h('h2', {}, title), ...kids);
}

export const fmtDist = (m: number, units: 'm' | 'ft') => (units === 'ft' ? `${Math.round(m * 3.28084)} ft` : `${m.toFixed(m < 10 ? 1 : 0)} m`);
