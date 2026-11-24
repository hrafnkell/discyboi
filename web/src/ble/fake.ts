/**
 * Fake discyboi for working without hardware (?fake=1). Produces real little-endian byte
 * buffers and feeds them through the same parser as the BLE path.
 */
import type { DiscDevice } from './device';
import {
  encodeStatus,
  encodeThrowResult,
  FLAG_ANGLES_VALID,
  FLAG_LANDED,
  FLAG_SPEED_VALID,
  FLAG_SPIN_CENTRIP,
  parseStatus,
  parseThrowResult,
  type DeviceStatus,
  type ThrowResult,
} from './protocol';

const gauss = () => {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

export class FakeDisc implements DiscDevice {
  name = 'discyboi (fake)';
  firmware = '0.2.0+fake';
  onThrow?: (r: ThrowResult) => void;
  onStatus?: (s: DeviceStatus) => void;
  onBattery?: (percent: number) => void;
  onDisconnect?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private id = 1;
  private battery = 4050;

  constructor(private intervalMs = 9000) {}

  async connect() {
    await new Promise((r) => setTimeout(r, 300));
    this.status('armed');
    this.onBattery?.(82);
    this.timer = setInterval(() => this.throwNow(), this.intervalMs);
  }

  disconnect() {
    clearInterval(this.timer);
    this.onDisconnect?.();
  }

  async identify() {}

  /** Emit one plausible right-handed backhand throw (board face up, so spin is negative). */
  throwNow() {
    this.status('pull');
    const speed = 22 + gauss() * 2.5;
    const spin = Math.min(1500, Math.max(600, 1000 + gauss() * 150 + (speed - 22) * 30));
    const launch = 9 + gauss() * 3;
    const r: ThrowResult = {
      throwId: this.id++,
      flags: FLAG_ANGLES_VALID | FLAG_SPEED_VALID | FLAG_LANDED | (spin > 667 ? FLAG_SPIN_CENTRIP : 0),
      spinRpm: -Math.round(spin),
      speedCms: Math.round(speed * 100),
      hyzerCdeg: Math.round((-4 + gauss() * 8) * 100), // + right edge down = anhyzer for RHBH
      noseCdeg: Math.round((launch - 2 + gauss() * 2.5) * 100),
      launchCdeg: Math.round(launch * 100),
      wobbleDps: Math.round(Math.abs(gauss()) * 40),
      peakDg: Math.round(300 + gauss() * 40),
      pullMs: Math.round(220 + gauss() * 30),
      flightMs: Math.round(3500 + gauss() * 500),
      batteryMv: (this.battery -= 2),
    };
    const bytes = encodeThrowResult(r);
    setTimeout(() => {
      this.onThrow?.(parseThrowResult(bytes));
      this.status('armed');
    }, 250);
  }

  private status(state: DeviceStatus['state']) {
    this.onStatus?.(parseStatus(encodeStatus({ state, downloading: false, batteryMv: this.battery, throws: this.id - 1 })));
  }
}
