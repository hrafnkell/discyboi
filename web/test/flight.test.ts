/**
 * Flight model sanity + calibration. The distance table is the tuning target for aero.ts:
 * commonly quoted max-distance figures for a flat backhand with a disc suited to the arm.
 */
import { describe, expect, test } from 'bun:test';
import { DISCS } from '../src/sim/discs';
import { simulate } from '../src/sim/flight';
import type { DiscSpec, ThrowParams } from '../src/sim/types';

const disc = (id: string): DiscSpec => DISCS.find((d) => d.id === id)!;
const throwAt = (speed: number, extra: Partial<ThrowParams> = {}): ThrowParams => ({
  speed, spinRpm: 700 + 25 * speed, hyzerDeg: 0, noseDeg: 6, launchDeg: 8, hand: 'R', style: 'BH', ...extra,
});
/** Best distance over a few launch angles (nose 2° below the flight path), like a player would. */
function maxDistance(speed: number, d: DiscSpec): number {
  let best = 0;
  for (const launch of [6, 9, 12, 15]) {
    best = Math.max(best, simulate(throwAt(speed, { launchDeg: launch, noseDeg: launch - 2 }), d).distance);
  }
  return best;
}
const minY = (r: ReturnType<typeof simulate>) => Math.min(...r.points.map((p) => p.p[1]));

describe('calibration: arm speed -> distance (stable driver)', () => {
  const table: [number, number][] = [[20, 75], [22, 90], [25, 110], [27, 125], [30, 150]];
  for (const [speed, target] of table) {
    test(`${speed} m/s ≈ ${target} m`, () => {
      const d = maxDistance(speed, disc('drv-stable'));
      expect(Math.abs(d - target) / target).toBeLessThan(0.15);
    });
  }
});

describe('flight behaviour', () => {
  test('speed 0 just drops', () => {
    const r = simulate(throwAt(0, { launchDeg: 0 }), disc('putter-straight'));
    expect(r.distance).toBeLessThan(0.5);
    expect(r.flightTime).toBeGreaterThan(0.3);
  });

  test('understable ends right of overstable (RHBH)', () => {
    const u = simulate(throwAt(25), disc('fw-understable'));
    const o = simulate(throwAt(25), disc('fw-overstable'));
    expect(u.lateral).toBeLessThan(o.lateral - 10);
    expect(o.lateral).toBeGreaterThan(0); // overstable fades left
    expect(minY(u)).toBeLessThan(-10); // understable turns right
  });

  test('forehand mirrors backhand', () => {
    for (const id of ['fw-understable', 'drv-overstable']) {
      const bh = simulate(throwAt(24), disc(id));
      const fh = simulate(throwAt(24, { style: 'FH' }), disc(id));
      expect(fh.lateral).toBeCloseTo(-bh.lateral, 6);
      expect(fh.distance).toBeCloseTo(bh.distance, 6);
    }
  });

  test('left-hand backhand mirrors right-hand backhand', () => {
    const r = simulate(throwAt(24), disc('drv-stable'));
    const l = simulate(throwAt(24, { hand: 'L' }), disc('drv-stable'));
    expect(l.lateral).toBeCloseTo(-r.lateral, 6);
  });

  test('hyzer curves left, anhyzer curves right (RHBH)', () => {
    const flat = simulate(throwAt(23), disc('mid-straight'));
    const hyzer = simulate(throwAt(23, { hyzerDeg: 20 }), disc('mid-straight'));
    const anhyzer = simulate(throwAt(23, { hyzerDeg: -20 }), disc('mid-straight'));
    expect(hyzer.lateral).toBeGreaterThan(flat.lateral + 10);
    expect(anhyzer.lateral).toBeLessThan(flat.lateral - 10);
  });

  test('less spin = more turn and fade', () => {
    const fast = simulate(throwAt(26, { spinRpm: 1400 }), disc('fw-understable'));
    const slow = simulate(throwAt(26, { spinRpm: 700 }), disc('fw-understable'));
    expect(minY(slow)).toBeLessThan(minY(fast));
    const fastO = simulate(throwAt(22, { spinRpm: 1400 }), disc('drv-utility'));
    const slowO = simulate(throwAt(22, { spinRpm: 700 }), disc('drv-utility'));
    // Fade = the disc rolling onto its fade side; compare the roll 2 s into the flight.
    const rollAt = (r: ReturnType<typeof simulate>, t: number) => r.points.find((p) => p.t >= t)!.n[1];
    expect(rollAt(slowO, 2)).toBeGreaterThan(rollAt(fastO, 2));
  });

  test('headwind makes an understable disc turn more', () => {
    const calm = simulate(throwAt(24), disc('fw-straight'));
    const head = simulate(throwAt(24, { wind: [-6, 0, 0] }), disc('fw-straight'));
    expect(minY(head)).toBeLessThan(minY(calm));
  });

  test('every preset produces a sane flight', () => {
    for (const d of DISCS) {
      const r = simulate(throwAt(22), d);
      expect(r.distance).toBeGreaterThan(40);
      expect(r.distance).toBeLessThan(140);
      expect(r.flightTime).toBeGreaterThan(1.5);
      expect(Number.isFinite(r.lateral)).toBe(true);
    }
  });
});
