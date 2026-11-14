/**
 * Firmware throw_result -> simulator ThrowParams.
 *
 * Firmware conventions (analysis.c), already relative to the flight direction and using the
 * upward disc normal, so they do not depend on how the board is mounted:
 *   hyzer_cdeg  + = right edge down
 *   nose_cdeg   + = nose up (pitch relative to horizontal)
 *   launch_cdeg velocity angle above horizontal
 * spin_rpm is + = counter-clockwise seen from the top of the *board*, so it flips when the
 * board is mounted face down in the disc.
 */
import { FLAG_ANGLES_VALID, FLAG_SPEED_VALID, type ThrowResult } from '../ble/protocol';
import { fadeSide } from './flight';
import type { Hand, Style, ThrowParams } from './types';

export type Mount = 'faceUp' | 'faceDown';

export interface ConvertOptions {
  hand: Hand;
  mount: Mount;
}

export interface Converted {
  params: ThrowParams;
  anglesValid: boolean;
  speedValid: boolean;
}

/** Spin about the world up axis, + = CCW seen from above, rpm. */
export function worldSpinRpm(r: ThrowResult, mount: Mount): number {
  return mount === 'faceUp' ? r.spinRpm : -r.spinRpm;
}

/** The thrower's hand is known; clockwise spin is RHBH / LHFH, counter-clockwise RHFH / LHBH. */
export function styleFromSpin(hand: Hand, spinCcwRpm: number): Style {
  const clockwise = spinCcwRpm < 0;
  return (hand === 'R') === clockwise ? 'BH' : 'FH';
}

export function convertResult(r: ThrowResult, opt: ConvertOptions): Converted {
  const spin = worldSpinRpm(r, opt.mount);
  const style = styleFromSpin(opt.hand, spin);
  const anglesValid = (r.flags & FLAG_ANGLES_VALID) !== 0;
  const speedValid = (r.flags & FLAG_SPEED_VALID) !== 0;
  // Firmware roll: + = right edge down = normal tilted right. Simulator hyzer: + = tilted
  // towards the fade side (left for clockwise spin).
  const rollRight = r.hyzerCdeg / 100;
  const rollLeft = -rollRight;
  const hyzer = anglesValid ? rollLeft * fadeSide(spin || (opt.hand === 'R' ? -1 : 1)) : 0;
  const launch = anglesValid ? r.launchCdeg / 100 : 8;
  return {
    params: {
      speed: r.speedCms / 100,
      spinRpm: Math.abs(spin),
      hyzerDeg: hyzer,
      noseDeg: anglesValid ? r.noseCdeg / 100 : launch - 2,
      launchDeg: launch,
      hand: opt.hand,
      style,
    },
    anglesValid,
    speedValid,
  };
}
