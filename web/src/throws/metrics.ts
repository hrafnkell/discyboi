/** The per-throw numbers the history page shows, compares and charts. */
import type { ThrowRecord } from '../store/throws';
import { scaleFor, speedAlt, type Units } from '../units';

export interface Metric {
  key: string;
  label: string;
  short: string;
  unit: string;
  dp: number;
  /** Undefined when the throw doesn't have it (e.g. a manual throw has no raw IMU data). */
  get(r: ThrowRecord): number | undefined;
  /** Shown under the value, e.g. km/h for speed. */
  sub?(v: number, units: Units): string;
  /** Whether it's part of the release (vs a simulated result or a raw sensor value). */
  group: 'release' | 'sensor' | 'result';
}

export const METRICS: Metric[] = [
  { key: 'speed', label: 'Speed', short: 'Speed', unit: 'm/s', dp: 1, group: 'release', get: (r) => r.params.speed, sub: (v, u) => speedAlt(v, u) },
  { key: 'spin', label: 'Spin', short: 'Spin', unit: 'rpm', dp: 0, group: 'release', get: (r) => r.params.spinRpm, sub: (v) => `${(v / 60).toFixed(1)} rev/s` },
  { key: 'hyzer', label: 'Hyzer', short: 'Hyz', unit: '°', dp: 1, group: 'release', get: (r) => r.params.hyzerDeg, sub: (v) => (v > 1 ? 'hyzer' : v < -1 ? 'anhyzer' : 'flat') },
  { key: 'nose', label: 'Nose', short: 'Nose', unit: '°', dp: 1, group: 'release', get: (r) => r.params.noseDeg, sub: (v) => (v > 0.5 ? 'nose up' : v < -0.5 ? 'nose down' : 'level') },
  { key: 'launch', label: 'Launch', short: 'Launch', unit: '°', dp: 1, group: 'release', get: (r) => r.params.launchDeg, sub: () => 'flight path' },
  { key: 'aoa', label: 'Angle of attack', short: 'AoA', unit: '°', dp: 1, group: 'release', get: (r) => r.params.noseDeg - r.params.launchDeg, sub: (v) => (v > 2 ? 'nose up: stalls early' : v < -4 ? 'very nose down' : 'nose − launch') },
  { key: 'wobble', label: 'Wobble', short: 'Wob', unit: '°/s', dp: 0, group: 'sensor', get: (r) => r.raw?.wobbleDps, sub: () => 'off-axis RMS' },
  { key: 'peak', label: 'Peak accel', short: 'Peak', unit: 'g', dp: 1, group: 'sensor', get: (r) => (r.raw ? r.raw.peakDg / 10 : undefined), sub: () => 'during the pull' },
  { key: 'pull', label: 'Pull time', short: 'Pull', unit: 'ms', dp: 0, group: 'sensor', get: (r) => r.raw?.pullMs },
  { key: 'flight', label: 'Flight time (disc)', short: 'Air', unit: 's', dp: 1, group: 'sensor', get: (r) => (r.raw?.flightMs ? r.raw.flightMs / 1000 : undefined), sub: () => 'measured' },
  { key: 'distance', label: 'Sim distance', short: 'Dist', unit: 'm', dp: 0, group: 'result', get: (r) => (r.noSim ? undefined : r.summary.distance) },
  { key: 'lateral', label: 'Sim lateral', short: 'Lat', unit: 'm', dp: 0, group: 'result', get: (r) => (r.noSim ? undefined : r.summary.lateral), sub: (v) => (Math.abs(v) < 1 ? 'centre' : v > 0 ? 'left' : 'right') },
  { key: 'actual', label: 'Actual distance', short: 'Actual', unit: 'm', dp: 0, group: 'result', get: (r) => r.actualDistance },
];

export const metric = (key: string) => METRICS.find((m) => m.key === key)!;

/** How a metric reads in the chosen units: display = stored × k, with its unit and decimals. */
export function display(m: Metric, units: Units) {
  const sc = scaleFor(m.unit, units);
  // Feet and mph are ~3× and ~2× bigger numbers: one decimal less keeps the same precision.
  const dp = sc.k > 1.5 ? Math.max(0, m.dp - 1) : m.dp;
  return { ...sc, dp };
}

/** The value in display units, or undefined. */
export const shown = (m: Metric, v: number | undefined, units: Units) => (v === undefined ? undefined : v * scaleFor(m.unit, units).k);

/** Formats a metric value in the chosen units. */
export function fmt(m: Metric, v: number | undefined, units: Units = 'metric', withUnit = true): string {
  if (v === undefined || !Number.isFinite(v)) return '–';
  const d = display(m, units);
  const s = (v * d.k).toFixed(d.dp);
  if (!withUnit) return s;
  return d.unit === '°' ? `${s}°` : `${s} ${d.unit}`;
}

export interface Stats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
}

export function stats(values: (number | undefined)[]): Stats | undefined {
  const v = values.filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (!v.length) return undefined;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v) };
}

export type Targets = Record<string, { min?: number; max?: number }>;

/** 'in' / 'out' of the target band, or undefined when there's no target or no value. */
export function onTarget(t: Targets, key: string, v: number | undefined): 'in' | 'out' | undefined {
  const b = t[key];
  if (!b || v === undefined || (b.min === undefined && b.max === undefined)) return undefined;
  return (b.min === undefined || v >= b.min) && (b.max === undefined || v <= b.max) ? 'in' : 'out';
}
