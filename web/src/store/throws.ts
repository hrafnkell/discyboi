/**
 * Throw history and settings in localStorage. Trajectories are not stored; they are
 * re-simulated from the parameters when replayed.
 */
import type { ThrowResult } from '../ble/protocol';
import type { Mount } from '../sim/convert';
import type { DiscSpec, FlightResult, Hand, ThrowParams } from '../sim/types';

export interface ThrowRecord {
  id: string;
  ts: number;
  source: 'manual' | 'disc';
  disc: DiscSpec;
  params: ThrowParams;
  raw?: ThrowResult; // as received from the hardware
  anglesEstimated?: boolean;
  summary: { distance: number; carry: number; lateral: number; apex: number; flightTime: number };
  actualDistance?: number; // measured by the player, for future model calibration
}

export interface Settings {
  hand: Hand;
  mount: Mount;
  units: 'm' | 'ft';
  basketDist: number;
}

const KEY = 'discyboi.throws.v1';
const SETTINGS_KEY = 'discyboi.settings.v1';
const MAX = 500;

function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: history just isn't persisted */
  }
}

export function summarize(f: FlightResult): ThrowRecord['summary'] {
  return { distance: f.distance, carry: f.carry, lateral: f.lateral, apex: f.apex, flightTime: f.flightTime };
}

export class ThrowStore {
  private items: ThrowRecord[];
  onChange?: () => void;

  constructor() {
    const v = read<ThrowRecord[]>(KEY, []);
    this.items = Array.isArray(v) ? v : [];
  }

  all(): readonly ThrowRecord[] {
    return this.items;
  }

  get(id: string) {
    return this.items.find((t) => t.id === id);
  }

  add(rec: Omit<ThrowRecord, 'id' | 'ts'>): ThrowRecord {
    const full: ThrowRecord = { ...rec, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
    this.items.unshift(full);
    if (this.items.length > MAX) this.items.length = MAX;
    this.save();
    return full;
  }

  update(id: string, patch: Partial<ThrowRecord>) {
    const t = this.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.save();
  }

  remove(id: string) {
    this.items = this.items.filter((t) => t.id !== id);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  exportJson(): string {
    return JSON.stringify({ app: 'discyboi', version: 1, exported: new Date().toISOString(), throws: this.items }, null, 2);
  }

  private save() {
    write(KEY, this.items);
    this.onChange?.();
  }
}

export const DEFAULT_SETTINGS: Settings = { hand: 'R', mount: 'faceUp', units: 'm', basketDist: 100 };

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(s: Settings) {
  write(SETTINGS_KEY, s);
}
