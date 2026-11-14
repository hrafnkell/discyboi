/** Archetype discs, named by role rather than brand. Flight numbers are typical for each role. */
import { classForSpeed } from './aero';
import type { DiscSpec, FlightNumbers } from './types';

const d = (id: string, name: string, n: [number, number, number, number], color: string): DiscSpec => {
  const numbers: FlightNumbers = { speed: n[0], glide: n[1], turn: n[2], fade: n[3] };
  return { id, name, cls: classForSpeed(n[0]), numbers, color };
};

export const DISCS: DiscSpec[] = [
  d('putter-straight', 'Straight putter', [2, 3, 0, 1], '#f2f2ee'),
  d('putter-beadless', 'Glidey putter', [3, 4, 0, 1], '#ffd166'),
  d('putter-overstable', 'Overstable putter', [3, 3, 0, 3], '#ef476f'),
  d('mid-straight', 'Straight midrange', [5, 5, 0, 0], '#06d6a0'),
  d('mid-understable', 'Understable midrange', [5, 5, -2, 1], '#4cc9f0'),
  d('mid-overstable', 'Overstable midrange', [5, 4, 0, 3], '#9d4edd'),
  d('fw-understable', 'Turnover fairway', [7, 5, -3, 1], '#ff9f1c'),
  d('fw-straight', 'Control fairway', [7, 5, -1, 1], '#2ec4b6'),
  d('fw-overstable', 'Overstable fairway', [9, 4, 0, 3], '#e63946'),
  d('drv-understable', 'Understable driver', [10, 5, -3, 1], '#8ac926'),
  d('drv-stable', 'Stable driver', [12, 5, -1, 2], '#1982c4'),
  d('drv-overstable', 'Overstable driver', [12, 4, 0, 3], '#ff595e'),
  d('drv-max', 'Max-distance driver', [13, 5, -2, 2], '#6a4c93'),
  d('drv-utility', 'Utility (meathook)', [11, 3, 1, 5], '#3d405b'),
];

export function customDisc(numbers: FlightNumbers, color = '#f4a261'): DiscSpec {
  return { id: 'custom', name: 'Custom', cls: classForSpeed(numbers.speed), numbers: { ...numbers }, color };
}

export const fmtNumbers = (n: FlightNumbers) => `${n.speed} | ${n.glide} | ${n.turn} | ${n.fade}`;
