import { customDisc, DISCS, fmtNumbers } from '../sim/discs';
import type { DiscSpec, FlightNumbers } from '../sim/types';
import { h, section, slider } from './dom';

const CLASS_LABEL = { putter: 'Putters', midrange: 'Midranges', fairway: 'Fairway drivers', driver: 'Distance drivers' } as const;

export class DiscPicker {
  readonly el: HTMLElement;
  private disc: DiscSpec;
  private custom: FlightNumbers = { speed: 9, glide: 5, turn: -1, fade: 2 };
  private select: HTMLSelectElement;
  private customBox: HTMLElement;
  private numbers: HTMLElement;
  private dot: HTMLElement;
  private sliders: Record<keyof FlightNumbers, ReturnType<typeof slider>>;

  constructor(initialId: string, private onChange: (d: DiscSpec) => void) {
    this.disc = DISCS.find((d) => d.id === initialId) ?? DISCS[10];
    this.select = h('select', { 'aria-label': 'Disc', onchange: () => this.pick(this.select.value) });
    for (const cls of ['putter', 'midrange', 'fairway', 'driver'] as const) {
      const g = h('optgroup', { label: CLASS_LABEL[cls] });
      for (const d of DISCS.filter((x) => x.cls === cls)) g.append(h('option', { value: d.id }, `${d.name}  (${fmtNumbers(d.numbers)})`));
      this.select.append(g);
    }
    this.select.append(h('option', { value: 'custom' }, 'Custom flight numbers…'));
    this.select.value = this.disc.id;

    const mk = (key: keyof FlightNumbers, label: string, min: number, max: number, step: number) =>
      slider({ label, min, max, step, value: this.custom[key], onInput: (v) => {
        this.custom[key] = v;
        this.pick('custom');
      } });
    this.sliders = {
      speed: mk('speed', 'Speed', 1, 14, 0.5),
      glide: mk('glide', 'Glide', 1, 7, 0.5),
      turn: mk('turn', 'Turn', -5, 1, 0.5),
      fade: mk('fade', 'Fade', 0, 5, 0.5),
    };
    this.customBox = h('div.custom', {}, ...Object.values(this.sliders).map((s) => s.el));
    this.numbers = h('div.flightnums');
    this.dot = h('span.discdot');
    this.el = section('Disc', h('div.discrow', {}, this.dot, this.select), this.numbers, this.customBox);
    this.render();
  }

  get(): DiscSpec {
    return this.disc;
  }

  private pick(id: string) {
    if (id === 'custom') {
      this.disc = customDisc(this.custom);
      this.select.value = 'custom';
    } else {
      this.disc = DISCS.find((d) => d.id === id)!;
      this.custom = { ...this.disc.numbers };
      for (const k of Object.keys(this.sliders) as (keyof FlightNumbers)[]) this.sliders[k].set(this.custom[k], true);
    }
    this.render();
    this.onChange(this.disc);
  }

  private render() {
    const n = this.disc.numbers;
    this.dot.style.background = this.disc.color;
    this.numbers.replaceChildren(
      ...(['speed', 'glide', 'turn', 'fade'] as const).map((k) => h('div.fn', {}, h('b', {}, String(n[k])), h('span', {}, k))),
    );
    this.customBox.hidden = this.disc.id !== 'custom';
  }
}
