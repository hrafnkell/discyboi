import type { FlightResult } from '../sim/types';
import { fmtDist, fmtSpeed, type Units } from '../units';
import { h } from './dom';

export class StatsBar {
  readonly el: HTMLElement;
  private cells: Record<string, HTMLElement> = {};

  constructor() {
    const cell = (k: string, label: string, big = false) =>
      h(`div.stat${big ? '.big' : ''}` as 'div', {}, (this.cells[k] = h('b', {}, '–')), h('span', {}, label));
    this.el = h('div.stats', { 'aria-live': 'polite' },
      cell('distance', 'distance', true),
      cell('carry', 'carry'),
      cell('lateral', 'lateral'),
      cell('apex', 'apex'),
      cell('time', 'flight time'),
      cell('live', 'speed now'),
    );
  }

  /** Units for the live speed readout; show() takes them explicitly. */
  units: Units = 'metric';

  show(f: FlightResult | undefined, units: Units) {
    this.units = units;
    if (!f) return;
    const lat = f.lateral;
    this.cells.distance.textContent = fmtDist(f.distance, units);
    this.cells.carry.textContent = fmtDist(f.carry, units);
    this.cells.lateral.textContent = Math.abs(lat) < 0.5 ? 'centre' : `${fmtDist(Math.abs(lat), units)} ${lat > 0 ? 'L' : 'R'}`;
    this.cells.apex.textContent = fmtDist(f.apex, units);
    this.cells.time.textContent = `${f.flightTime.toFixed(1)} s`;
  }

  live(speed: number) {
    this.cells.live.textContent = fmtSpeed(speed, this.units);
  }
}
