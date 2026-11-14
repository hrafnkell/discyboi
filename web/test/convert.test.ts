import { describe, expect, test } from 'bun:test';
import { FLAG_ANGLES_VALID, FLAG_SPEED_VALID, type ThrowResult } from '../src/ble/protocol';
import { convertResult } from '../src/sim/convert';
import { initialState } from '../src/sim/flight';
import { dot } from '../src/sim/vec';

const base: ThrowResult = {
  throwId: 1, flags: FLAG_ANGLES_VALID | FLAG_SPEED_VALID, spinRpm: -1200, speedCms: 2400,
  hyzerCdeg: 0, noseCdeg: 600, launchCdeg: 900, wobbleDps: 0, peakDg: 0, pullMs: 0, flightMs: 0, batteryMv: 4000,
};
const DEG = 180 / Math.PI;

/** Re-measure angles from the simulator's initial state exactly as analysis.c does. */
function measure(r: ThrowResult, hand: 'R' | 'L', mount: 'faceUp' | 'faceDown' = 'faceUp') {
  const c = convertResult(r, { hand, mount });
  const s = initialState(c.params);
  const vh = Math.hypot(s.v[0], s.v[1]);
  const f: [number, number, number] = [s.v[0] / vh, s.v[1] / vh, 0];
  const right: [number, number, number] = [f[1], -f[0], 0];
  return {
    c,
    hyzer: Math.atan2(dot(s.n, right), s.n[2]) * DEG,
    nose: Math.atan2(-dot(s.n, f), s.n[2]) * DEG,
    launch: Math.atan2(s.v[2], vh) * DEG,
    speed: Math.hypot(...s.v),
  };
}

describe('firmware -> simulator conversion', () => {
  test('clockwise spin from a right-hander is backhand, CCW is forehand', () => {
    expect(convertResult(base, { hand: 'R', mount: 'faceUp' }).params.style).toBe('BH');
    expect(convertResult({ ...base, spinRpm: 1200 }, { hand: 'R', mount: 'faceUp' }).params.style).toBe('FH');
    expect(convertResult(base, { hand: 'L', mount: 'faceUp' }).params.style).toBe('FH');
  });

  test('face-down mounting flips the spin direction', () => {
    expect(convertResult(base, { hand: 'R', mount: 'faceDown' }).params.style).toBe('FH');
  });

  test('right edge down is anhyzer for RHBH and hyzer for RHFH', () => {
    const r = { ...base, hyzerCdeg: 1500 };
    expect(convertResult(r, { hand: 'R', mount: 'faceUp' }).params.hyzerDeg).toBeCloseTo(-15);
    expect(convertResult({ ...r, spinRpm: 1200 }, { hand: 'R', mount: 'faceUp' }).params.hyzerDeg).toBeCloseTo(15);
  });

  test('angles and speed round-trip through the initial state', () => {
    for (const [hyz, nose, spin] of [[1500, 600, -1200], [-2000, -300, 900], [700, 1200, 1300]]) {
      const r = { ...base, hyzerCdeg: hyz, noseCdeg: nose, spinRpm: spin };
      const m = measure(r, 'R');
      expect(m.hyzer).toBeCloseTo(hyz / 100, 6);
      expect(m.nose).toBeCloseTo(nose / 100, 6);
      expect(m.launch).toBeCloseTo(9, 6);
      expect(m.speed).toBeCloseTo(24, 6);
    }
  });

  test('missing angles fall back to a flat release', () => {
    const c = convertResult({ ...base, flags: FLAG_SPEED_VALID, hyzerCdeg: 3000 }, { hand: 'R', mount: 'faceUp' });
    expect(c.anglesValid).toBe(false);
    expect(c.params.hyzerDeg).toBe(0);
  });
});
