/**
 * Metric / imperial display. Everything is stored and simulated in SI (metres, m/s); these only
 * convert for showing and for reading what the user typed.
 */
export type Units = 'metric' | 'imperial';

export const UNIT_OPTIONS: { id: Units; label: string; title: string }[] = [
  { id: 'metric', label: 'Metric', title: 'Metres and m/s' },
  { id: 'imperial', label: 'Imperial', title: 'Feet and mph' },
];

const FT = 3.28084;
const MPH = 2.23694;

/** How a quantity reads in the chosen system: display value = SI value × k. */
export interface Scale {
  k: number;
  unit: string;
  /** Spoken form, for read-aloud. */
  word: string;
}

export function distScale(u: Units): Scale {
  return u === 'imperial' ? { k: FT, unit: 'ft', word: 'feet' } : { k: 1, unit: 'm', word: 'metres' };
}

export function speedScale(u: Units): Scale {
  return u === 'imperial' ? { k: MPH, unit: 'mph', word: 'miles per hour' } : { k: 1, unit: 'm/s', word: 'metres per second' };
}

/** The scale for a value stored in `siUnit` ('m' or 'm/s'); anything else (°, rpm, g…) is the same in both. */
export function scaleFor(siUnit: string, u: Units): Scale {
  if (siUnit === 'm') return distScale(u);
  if (siUnit === 'm/s') return speedScale(u);
  return { k: 1, unit: siUnit, word: siUnit === '°' ? 'degrees' : siUnit };
}

export const fmtDist = (m: number, u: Units) => (u === 'imperial' ? `${Math.round(m * FT)} ft` : `${m.toFixed(m < 10 ? 1 : 0)} m`);
export const fmtSpeed = (v: number, u: Units) => (u === 'imperial' ? `${(v * MPH).toFixed(0)} mph` : `${v.toFixed(1)} m/s`);
/** The other ways to say a speed, for hints under the main number. */
export const speedAlt = (v: number, u: Units) => (u === 'imperial' ? `${v.toFixed(1)} m/s · ${Math.round(v * 3.6)} km/h` : `${Math.round(v * 3.6)} km/h · ${Math.round(v * MPH)} mph`);

/** Older settings stored 'm' / 'ft'. */
export const asUnits = (v: unknown): Units => (v === 'imperial' || v === 'ft' ? 'imperial' : 'metric');
