/**
 * Disc flight integrator.
 *
 * State: position p, velocity v, unit disc normal n (top side), spin rate w (rad/s about n,
 * + = counter-clockwise seen from the top). The disc is treated as a fast gyroscope: angular
 * momentum L ≈ Izz·w·n, so an aerodynamic pitching moment M (perpendicular to n) does not
 * pitch the disc but precesses it: dn/dt = M / (Izz·w). That is what turns a nose-down
 * moment into "turn" and a nose-up moment into "fade", and why more spin flies straighter.
 *
 * RK4 at 2 ms, trajectory sampled every 10 ms. After the first ground contact the disc
 * slides to a stop with Coulomb friction (no skips or rollers yet).
 */
import { aeroModel, coefficients, G, RHO, type AeroModel } from './aero';
import type { DiscSpec, FlightResult, ThrowParams, TrajectoryPoint, Vec3 } from './types';
import { add, cross, dot, norm, normalize, scale, sub } from './vec';

const DT = 0.002;
const SAMPLE_EVERY = 5;
const T_MAX = 20;
const MIN_SPIN = 8; // rad/s: below this the gyroscope approximation breaks down; clamp
const SLIDE_MU = 0.55;
const DEG = Math.PI / 180;

interface State {
  p: Vec3;
  v: Vec3;
  n: Vec3;
  w: number;
}

/** + = counter-clockwise seen from above: RHBH and LHFH spin clockwise. */
export function spinSign(hand: ThrowParams['hand'], style: ThrowParams['style']): number {
  return (hand === 'R') === (style === 'BH') ? -1 : 1;
}

/** World-frame side (+1 = left, −1 = right) the disc fades towards for a given spin. */
export function fadeSide(spin: number): number {
  return spin < 0 ? 1 : -1;
}

/**
 * Disc normal from the measured angles, using the same definitions as the firmware
 * (analysis.c): tan(nose) = −n·f / n·up and tan(roll) = n·side / n·up, where side points
 * to the fade side. Exact inverse, so firmware angles round-trip.
 */
export function normalFromAngles(headingRad: number, noseDeg: number, rollTowardsLeftDeg: number): Vec3 {
  const f: Vec3 = [Math.cos(headingRad), Math.sin(headingRad), 0];
  const l: Vec3 = [-Math.sin(headingRad), Math.cos(headingRad), 0];
  const n = add(add(scale(f, -Math.tan(noseDeg * DEG)), scale(l, Math.tan(rollTowardsLeftDeg * DEG))), [0, 0, 1]);
  return normalize(n);
}

export function initialState(params: ThrowParams): State {
  const heading = (params.headingDeg ?? 0) * DEG;
  const w = (spinSign(params.hand, params.style) * Math.abs(params.spinRpm) * 2 * Math.PI) / 60;
  const roll = params.hyzerDeg * fadeSide(w || spinSign(params.hand, params.style));
  const n = normalFromAngles(heading, params.noseDeg, roll);
  const th = params.launchDeg * DEG;
  const v: Vec3 = [
    params.speed * Math.cos(th) * Math.cos(heading),
    params.speed * Math.cos(th) * Math.sin(heading),
    params.speed * Math.sin(th),
  ];
  return { p: [0, 0, params.releaseHeight ?? 1.4], v, n, w };
}

interface Deriv {
  dp: Vec3;
  dv: Vec3;
  dn: Vec3;
  dw: number;
  alpha: number;
}

function derivative(s: State, m: AeroModel, wind: Vec3): Deriv {
  const va = sub(s.v, wind);
  const V = norm(va);
  const dv: Vec3 = [0, 0, -G];
  let dn: Vec3 = [0, 0, 0];
  let alpha = 0;
  if (V > 0.05) {
    const u = scale(va, 1 / V);
    const nu = dot(s.n, u);
    alpha = -Math.asin(Math.max(-1, Math.min(1, nu)));
    const c = coefficients(m, alpha, V);
    const qa = 0.5 * RHO * V * V * m.area;
    // Lift is perpendicular to the airflow, on the top side of the disc.
    const lRaw = sub(s.n, scale(u, nu));
    const lLen = norm(lRaw);
    const lift = lLen > 1e-6 ? scale(lRaw, (qa * c.cl) / lLen) : ([0, 0, 0] as Vec3);
    const drag = scale(u, -qa * c.cd);
    const acc = scale(add(lift, drag), 1 / m.mass);
    dv[0] += acc[0];
    dv[1] += acc[1];
    dv[2] += acc[2];
    // Pitching moment about the disc's pitch axis (forward x normal = the disc's right).
    const fRaw = sub(u, scale(s.n, nu));
    const fLen = norm(fRaw);
    if (fLen > 1e-6) {
      const ep = cross(scale(fRaw, 1 / fLen), s.n);
      const M = scale(ep, qa * m.diameter * c.cm);
      const wEff = Math.sign(s.w || 1) * Math.max(Math.abs(s.w), MIN_SPIN);
      dn = scale(M, 1 / (m.izz * wEff));
    }
  }
  const dw = -m.spinDamp * s.w * V;
  return { dp: s.v, dv, dn, dw, alpha };
}

function step(s: State, m: AeroModel, wind: Vec3): { s: State; alpha: number } {
  const k1 = derivative(s, m, wind);
  const at = (k: Deriv, h: number): State => ({
    p: add(s.p, scale(k.dp, h)),
    v: add(s.v, scale(k.dv, h)),
    n: add(s.n, scale(k.dn, h)),
    w: s.w + k.dw * h,
  });
  const k2 = derivative(at(k1, DT / 2), m, wind);
  const k3 = derivative(at(k2, DT / 2), m, wind);
  const k4 = derivative(at(k3, DT), m, wind);
  const comb = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 => [
    (a[0] + 2 * b[0] + 2 * c[0] + d[0]) / 6,
    (a[1] + 2 * b[1] + 2 * c[1] + d[1]) / 6,
    (a[2] + 2 * b[2] + 2 * c[2] + d[2]) / 6,
  ];
  return {
    s: {
      p: add(s.p, scale(comb(k1.dp, k2.dp, k3.dp, k4.dp), DT)),
      v: add(s.v, scale(comb(k1.dv, k2.dv, k3.dv, k4.dv), DT)),
      n: normalize(add(s.n, scale(comb(k1.dn, k2.dn, k3.dn, k4.dn), DT))),
      w: s.w + ((k1.dw + 2 * k2.dw + 2 * k3.dw + k4.dw) / 6) * DT,
    },
    alpha: k1.alpha,
  };
}

export function simulate(params: ThrowParams, disc: DiscSpec): FlightResult {
  const m = aeroModel(disc.numbers, disc.cls, disc.massKg);
  const wind = params.wind ?? [0, 0, 0];
  let s = initialState(params);
  let phase = 0;
  let t = 0;
  let apex = s.p[2];
  const points: TrajectoryPoint[] = [];
  const push = (alpha: number, onGround: boolean) =>
    points.push({ t, p: [...s.p], n: [...s.n], v: [...s.v], phase, alpha, onGround });
  push(0, false);

  let i = 0;
  while (t < T_MAX) {
    const prev = s;
    const r = step(s, m, wind);
    s = r.s;
    phase += s.w * DT;
    t += DT;
    i++;
    apex = Math.max(apex, s.p[2]);
    if (s.p[2] <= 0) {
      // Interpolate the contact point.
      const f = prev.p[2] / (prev.p[2] - s.p[2]);
      s = { ...s, p: add(prev.p, scale(sub(s.p, prev.p), f)) };
      s.p[2] = 0;
      t -= DT * (1 - f);
      push(r.alpha, false);
      break;
    }
    if (i % SAMPLE_EVERY === 0) push(r.alpha, false);
  }
  const landing: Vec3 = [...s.p];
  const flightTime = t;

  // Slide: keep some of the horizontal speed (less for steep impacts), decelerate at μg.
  const vh: Vec3 = [s.v[0], s.v[1], 0];
  const vhLen = norm(vh);
  const impact = Math.atan2(-s.v[2], vhLen);
  let speed = vhLen * 0.6 * Math.max(Math.cos(impact) ** 2, 0) * Math.max(0.2, Math.abs(s.n[2]));
  const dir: Vec3 = vhLen > 1e-6 ? scale(vh, 1 / vhLen) : [1, 0, 0];
  const n0 = s.n;
  const slideStart = t;
  while (speed > 0.02 && t < T_MAX + 5) {
    const dt = 0.01;
    speed = Math.max(0, speed - SLIDE_MU * G * dt);
    s.p = add(s.p, scale(dir, speed * dt));
    s.w *= 0.97;
    phase += s.w * dt;
    t += dt;
    const k = Math.min(1, (t - slideStart) / 0.3);
    s.n = normalize(add(scale(n0, 1 - k), scale([0, 0, 1], k)));
    s.v = scale(dir, speed);
    points.push({ t, p: [...s.p], n: [...s.n], v: [...s.v], phase, alpha: 0, onGround: true });
  }
  const rest: Vec3 = [...s.p];
  return {
    points,
    landing,
    rest,
    carry: Math.hypot(landing[0], landing[1]),
    distance: Math.hypot(rest[0], rest[1]),
    lateral: rest[1],
    apex,
    flightTime,
  };
}
