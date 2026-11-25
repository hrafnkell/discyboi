import type { Hand, Style, ThrowParams, Vec3 } from '../sim/types';
import { speedAlt, speedScale, type Units } from '../units';
import { h, section, segmented, slider } from './dom';

export interface WindSetting {
  speed: number; // m/s
  fromDeg: number; // direction the wind comes FROM, 0 = headwind, 90 = from the right, 180 = tailwind
}

export const windVector = (w: WindSetting): Vec3 => {
  // Headwind blows towards the thrower (−x). "From the right" blows to the left (+y).
  const a = (w.fromDeg * Math.PI) / 180;
  return [-w.speed * Math.cos(a), w.speed * Math.sin(a), 0];
};

export class ThrowPanel {
  readonly el: HTMLElement;
  readonly params: ThrowParams = { speed: 22, spinRpm: 1000, hyzerDeg: 0, noseDeg: 7, launchDeg: 9, hand: 'R', style: 'BH', headingDeg: 0 };
  readonly wind: WindSetting = { speed: 0, fromDeg: 0 };
  private sl: Record<string, ReturnType<typeof slider>> = {};
  private handSeg;
  private styleSeg;
  private aoa: HTMLElement;
  /** Filled by main.ts with the release preview (kept out of the UI module so it stays DOM-only). */
  readonly previewSlot = h('div.previewslot');

  constructor(private onThrow: () => void, private onEdit: () => void, private units: () => Units) {
    const p = this.params;
    // Speeds stay m/s inside; in imperial the sliders read mph.
    const speed = (step: number) => () => ({ ...speedScale(this.units()), step: this.units() === 'imperial' ? 1 : step });
    const edit = () => {
      this.updateAoa();
      this.onEdit();
    };
    this.handSeg = segmented<Hand>([{ id: 'R', label: 'Right' }, { id: 'L', label: 'Left' }], p.hand, (v) => {
      p.hand = v;
      edit();
    });
    this.styleSeg = segmented<Style>([{ id: 'BH', label: 'Backhand' }, { id: 'FH', label: 'Forehand' }], p.style, (v) => {
      p.style = v;
      edit();
    });
    const s = (key: string, o: Parameters<typeof slider>[0]) => (this.sl[key] = slider(o)).el;
    this.aoa = h('div.aoa');
    const release = section(
      'Release',
      h('div.row2', {}, this.handSeg.el, this.styleSeg.el),
      this.previewSlot,
      s('speed', { label: 'Speed', min: 5, max: 38, step: 0.1, value: p.speed, scale: speed(0.1), hint: (v) => speedAlt(v, this.units()), onInput: (v) => ((p.speed = v), edit()) }),
      s('spin', { label: 'Spin', min: 0, max: 1800, step: 10, value: p.spinRpm, unit: 'rpm', hint: (v) => `${(v / 60).toFixed(1)} rev/s`, onInput: (v) => ((p.spinRpm = v), edit()) }),
      s('hyzer', { label: 'Hyzer', min: -45, max: 45, step: 0.5, value: p.hyzerDeg, unit: '°', hint: (v) => (v > 0.4 ? 'hyzer' : v < -0.4 ? 'anhyzer' : 'flat'), onInput: (v) => ((p.hyzerDeg = v), edit()) }),
      s('nose', { label: 'Nose', min: -20, max: 35, step: 0.5, value: p.noseDeg, unit: '°', hint: () => 'to horizon', onInput: (v) => ((p.noseDeg = v), edit()) }),
      s('launch', { label: 'Launch', min: -10, max: 40, step: 0.5, value: p.launchDeg, unit: '°', hint: () => 'flight path', onInput: (v) => ((p.launchDeg = v), edit()) }),
      this.aoa,
    );
    const aim = section(
      'Aim & wind',
      // Slider reads like the screen: drag right to aim right. The simulator's heading is + = left.
      s('heading', { label: 'Aim', min: -25, max: 25, step: 0.5, value: 0, unit: '°', hint: (v) => (v > 0.4 ? 'right' : v < -0.4 ? 'left' : 'centre'), onInput: (v) => ((p.headingDeg = -v), edit()) }),
      s('wind', { label: 'Wind', min: 0, max: 15, step: 0.5, value: 0, scale: speed(0.5), hint: (v) => `${Math.round(v * 3.6)} km/h`, onInput: (v) => ((this.wind.speed = v), edit()) }),
      s('windDir', {
        label: 'From', min: 0, max: 360, step: 5, value: 0, unit: '°',
        hint: (v) => ['head', 'head-right', 'right', 'tail-right', 'tail', 'tail-left', 'left', 'head-left', 'head'][Math.round(v / 45)],
        onInput: (v) => ((this.wind.fromDeg = v), edit()),
      }),
    );
    const btn = h('button.throw', { type: 'button', onclick: () => this.onThrow(), title: 'Throw (space)' }, 'Throw');
    this.el = h('div.throwpanel', {}, release, aim, btn);
    this.updateAoa();
  }

  /** Load parameters (e.g. from a hardware throw) into the controls without firing edits. */
  set(params: ThrowParams) {
    Object.assign(this.params, params);
    const p = this.params;
    this.sl.speed.set(p.speed, true);
    this.sl.spin.set(p.spinRpm, true);
    this.sl.hyzer.set(p.hyzerDeg, true);
    this.sl.nose.set(p.noseDeg, true);
    this.sl.launch.set(p.launchDeg, true);
    this.sl.heading.set(-(p.headingDeg ?? 0), true);
    this.handSeg.set(p.hand);
    this.styleSeg.set(p.style);
    this.updateAoa();
  }

  /** Re-reads the units setting into the speed sliders. */
  refreshUnits() {
    this.sl.speed.refresh();
    this.sl.wind.refresh();
  }

  /** Turn the aim by `d` degrees (+ = right), as a slider edit. Used by dragging in the tee view. */
  nudgeAim(d: number) {
    this.sl.heading.set(this.sl.heading.get() + d);
  }

    current(): ThrowParams {
    return { ...this.params, wind: windVector(this.wind) };
  }

  private updateAoa() {
    const a = this.params.noseDeg - this.params.launchDeg;
    this.aoa.textContent = `Angle of attack ${a > 0 ? '+' : ''}${a.toFixed(1)}° (${a < -0.5 ? 'nose down' : a > 0.5 ? 'nose up' : 'neutral'})`;
    this.aoa.classList.toggle('warn', a > 4);
  }
}
