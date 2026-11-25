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
  /**
   * Show and edit the value in other units (e.g. mph) while it stays SI inside: shown = value × k.
   * Read on every refresh(), so a units toggle only needs to call refresh().
   */
  scale?: () => { k: number; unit: string; step: number };
}

export interface Slider {
  el: HTMLElement;
  set(v: number, silent?: boolean): void;
  get(): number;
  /** Re-reads the scale (units changed). */
  refresh(): void;
}

/** Labelled range input with an editable numeric field and an optional derived hint. */
export function slider(o: SliderOpts): Slider {
  const range = h('input', { type: 'range', 'aria-label': o.label });
  const num = h('input.num', { type: 'number', 'aria-label': `${o.label} value` });
  const hint = h('span.hint');
  const unitEl = h('span.unit');
  let sc = { k: 1, unit: o.unit ?? '', step: o.step };
  let decimals = 0;
  let value = o.value;
  const show = () => {
    range.value = String(value * sc.k);
    if (document.activeElement !== num) num.value = (value * sc.k).toFixed(decimals);
    hint.textContent = o.hint ? o.hint(value) : '';
  };
  const refresh = () => {
    sc = o.scale ? o.scale() : sc;
    decimals = Math.max(0, (String(sc.step).split('.')[1] ?? '').length);
    // Snap the ends to the step so the range ticks land on round numbers (60, 70… ft, not 65.6, 75.6…).
    const lo = Math.floor((o.min * sc.k) / sc.step + 1e-9) * sc.step;
    const hi = Math.ceil((o.max * sc.k) / sc.step - 1e-9) * sc.step;
    for (const el of [range, num]) {
      el.min = String(+lo.toFixed(decimals));
      el.max = String(+hi.toFixed(decimals));
      el.step = String(sc.step);
    }
    unitEl.textContent = sc.unit;
    unitEl.hidden = !sc.unit;
    show();
  };
  const set = (v: number, silent = false) => {
    if (!Number.isFinite(v)) return;
    value = Math.min(o.max, Math.max(o.min, v));
    show();
    if (!silent) o.onInput(value);
  };
  range.addEventListener('input', () => set(Number(range.value) / sc.k));
  num.addEventListener('change', () => set(Number(num.value) / sc.k));
  num.addEventListener('blur', show);
  refresh();
  const el = h('div.slider', {}, h('div.slider-head', {}, h('label', {}, o.label), hint, h('span.numwrap', {}, num, unitEl)), range);
  return { el, set, get: () => value, refresh };
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

