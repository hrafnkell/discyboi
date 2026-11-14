/** Shared simulation types. World frame: x downrange, y left, z up (metres, seconds). */

export type Vec3 = [number, number, number];

export type Hand = 'R' | 'L';
export type Style = 'BH' | 'FH';

/** Manufacturer-style flight numbers. */
export interface FlightNumbers {
  speed: number; // 1..14
  glide: number; // 1..7
  turn: number; // +1..-5 (negative = understable, turns right for RHBH at speed)
  fade: number; // 0..5
}

export type DiscClass = 'putter' | 'midrange' | 'fairway' | 'driver';

export interface DiscSpec {
  id: string;
  name: string;
  cls: DiscClass;
  numbers: FlightNumbers;
  color: string;
  massKg?: number;
}

/** Everything needed to start a flight. Angles in degrees, user-facing conventions. */
export interface ThrowParams {
  speed: number; // release speed, m/s
  spinRpm: number; // spin magnitude, rpm (direction comes from hand + style)
  hyzerDeg: number; // + = hyzer for this hand/style (edge on the fade side down), - = anhyzer
  noseDeg: number; // disc pitch relative to horizontal, + = nose up
  launchDeg: number; // velocity angle above horizontal
  hand: Hand;
  style: Style;
  headingDeg?: number; // aim, + = left of the target line
  releaseHeight?: number; // m, default 1.4
  wind?: Vec3; // m/s in the world frame (x = tailwind, y = wind blowing to the left)
}

export interface TrajectoryPoint {
  t: number;
  p: Vec3;
  n: Vec3; // disc normal (top of the disc)
  v: Vec3;
  phase: number; // integrated spin angle, rad (for drawing)
  alpha: number; // angle of attack, rad
  onGround: boolean;
}

export interface FlightResult {
  points: TrajectoryPoint[];
  landing: Vec3; // first ground contact
  rest: Vec3; // where it stopped
  carry: number; // horizontal distance tee -> landing
  distance: number; // horizontal distance tee -> rest
  lateral: number; // rest y, + = left of the target line
  apex: number; // max height
  flightTime: number; // time to first ground contact
}
