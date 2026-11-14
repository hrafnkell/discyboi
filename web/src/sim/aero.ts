/**
 * Flight numbers -> aerodynamic model.
 *
 * Coefficients follow the usual disc model (Hummel 2003; Potts & Crowther 2002), with
 * angle of attack alpha = angle between the airflow and the disc plane (+ = nose up):
 *   CL = CL0·cos α + ½·CLa·sin 2α                 (≈ CL0 + CLa·α at small α, saturates near stall)
 *   CD = CD0 + CDa·sin²(α − α0)                    (α0 = zero-lift angle)
 *   CM = CMa·(α − αM) + turn term + fade term      (pitching moment, + = nose up)
 *
 * A spinning disc does not pitch in response to CM: the moment precesses the spin axis, so
 * nose-up moment rolls the disc towards its fade side and nose-down moment rolls it towards
 * its turn side (see flight.ts).
 *
 * Flight numbers are opinions, not measurements, so the mapping is phenomenological and
 * calibrated against typical arm-speed -> distance figures (test/flight.test.ts):
 *   speed -> lower profile drag, higher "design airspeed" Vd
 *   glide -> more lift at a given α
 *   turn  -> nose-down moment that grows with (V/Vd)², so it only bites above design speed
 *   fade  -> nose-up moment that grows as the disc slows below Vd
 */
import type { DiscClass, FlightNumbers } from './types';

export const RHO = 1.225; // kg/m³
export const G = 9.81;

export interface AeroModel {
  diameter: number;
  area: number;
  mass: number;
  izz: number; // spin-axis moment of inertia, kg m²
  vDesign: number; // m/s
  cl0: number;
  cla: number;
  cd0: number;
  cda: number;
  alpha0: number;
  cma: number;
  alphaM: number; // α where the base moment is zero
  kTurn: number; // nose-down moment coefficient per unit (−turn) at V = Vd
  kFade: number; // nose-up moment coefficient per unit fade at low speed
  kTurnStable: number; // extra nose-up moment for turn > 0 (very overstable)
  spinDamp: number; // spin decay coefficient
}

/** Tunables shared by every disc. Exported so the calibration test can report them. */
export const TUNE = {
  cd0Base: 0.085,
  cd0PerSpeed: 0.0032,
  cl0Base: 0.04,
  cl0PerGlide: 0.03,
  cla: 2.3,
  cda: 1.2,
  cma: 0.04,
  alphaM: 0.06, // rad (~3.4°): typical gliding α where an untrimmed disc is neutral
  kTurn: 0.0015,
  kFade: 0.004,
  turnExp: 1,
  vDesignBase: 12.5,
  vDesignPerSpeed: 1.15,
  spinDamp: 0.0012, // dω/dt = −spinDamp·ω·V
};

const DIAMETER: Record<DiscClass, number> = {
  putter: 0.212,
  midrange: 0.215,
  fairway: 0.212,
  driver: 0.211,
};

export function classForSpeed(speed: number): DiscClass {
  if (speed <= 3) return 'putter';
  if (speed <= 6) return 'midrange';
  if (speed <= 9) return 'fairway';
  return 'driver';
}

export function aeroModel(numbers: FlightNumbers, cls: DiscClass = classForSpeed(numbers.speed), massKg = 0.172): AeroModel {
  const t = TUNE;
  const d = DIAMETER[cls];
  const area = (Math.PI * d * d) / 4;
  // Rim-weighted discs: Izz ≈ 0.55·m·r² for putters up to ≈ 0.62·m·r² for wide-rim drivers.
  const izzFactor = 0.55 + Math.min(Math.max(numbers.speed - 2, 0), 12) * 0.006;
  const cl0 = t.cl0Base + t.cl0PerGlide * numbers.glide;
  return {
    diameter: d,
    area,
    mass: massKg,
    izz: izzFactor * massKg * (d / 2) ** 2,
    vDesign: t.vDesignBase + t.vDesignPerSpeed * numbers.speed,
    cl0,
    cla: t.cla,
    cd0: t.cd0Base - t.cd0PerSpeed * numbers.speed,
    cda: t.cda,
    alpha0: -cl0 / t.cla,
    cma: t.cma,
    alphaM: t.alphaM,
    kTurn: t.kTurn * Math.max(-numbers.turn, 0),
    kTurnStable: t.kTurn * Math.max(numbers.turn, 0),
    kFade: t.kFade * numbers.fade,
    spinDamp: t.spinDamp,
  };
}

export interface Coeffs {
  cl: number;
  cd: number;
  cm: number;
}

export function coefficients(m: AeroModel, alpha: number, airspeed: number): Coeffs {
  const cl = m.cl0 * Math.cos(alpha) + 0.5 * m.cla * Math.sin(2 * alpha);
  const s = Math.sin(alpha - m.alpha0);
  const cd = m.cd0 + m.cda * s * s;
  const r = airspeed / m.vDesign;
  // Moment terms fade out as the flow separates at high α (falling, stalled).
  const attached = Math.max(0, Math.cos(Math.min(Math.abs(alpha), Math.PI / 2)) ** 2);
  const turn = -m.kTurn * Math.pow(r, TUNE.turnExp);
  const fade = (m.kFade + m.kTurnStable) * Math.min(Math.max(1.3 - r, 0.15), 1);
  const cm = m.cma * (alpha - m.alphaM) * attached + (turn + fade) * attached;
  return { cl, cd, cm };
}
