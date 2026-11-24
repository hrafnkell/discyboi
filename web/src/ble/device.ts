/** Web Bluetooth connection to a discyboi. Chrome / Edge (desktop, Android) on https or localhost. */
import {
  CONTROL_UUID,
  CTRL_IDENTIFY,
  DEVICE_NAME,
  INFO_UUID,
  parseStatus,
  parseThrowResult,
  SERVICE_UUID,
  STATUS_UUID,
  THROW_UUID,
  type DeviceStatus,
  type ThrowResult,
} from './protocol';

export interface DiscDevice {
  readonly name: string;
  /** Firmware version, once connected. Undefined on firmware too old to report one. */
  readonly firmware?: string;
  connect(): Promise<void>;
  disconnect(): void;
  identify(): Promise<void>;
  onThrow?: (r: ThrowResult) => void;
  onStatus?: (s: DeviceStatus) => void;
  onBattery?: (percent: number) => void;
  onDisconnect?: () => void;
}

export function bleSupport(): { ok: boolean; reason?: string } {
  if (!window.isSecureContext) return { ok: false, reason: 'Web Bluetooth needs https (or localhost).' };
  if (!('bluetooth' in navigator)) return { ok: false, reason: 'This browser has no Web Bluetooth. Use Chrome or Edge on desktop or Android.' };
  return { ok: true };
}

export class BleDisc implements DiscDevice {
  name = DEVICE_NAME;
  firmware?: string;
  onThrow?: (r: ThrowResult) => void;
  onStatus?: (s: DeviceStatus) => void;
  onBattery?: (percent: number) => void;
  onDisconnect?: () => void;
  private device?: BluetoothDevice;
  private control?: BluetoothRemoteGATTCharacteristic;
  private lastThrowId = -1;

  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }, { services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID, 'battery_service'],
    });
    this.device = device;
    this.name = device.name ?? DEVICE_NAME;
    device.addEventListener('gattserverdisconnected', () => this.onDisconnect?.());
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(SERVICE_UUID);

    const thr = await svc.getCharacteristic(THROW_UUID);
    thr.addEventListener('characteristicvaluechanged', () => this.handleThrow(thr.value!));
    await thr.startNotifications();
    // The latest throw is readable; remember its id so it is not reported as new.
    try {
      const v = await thr.readValue();
      if (v.byteLength >= 26) this.lastThrowId = parseThrowResult(v).throwId;
    } catch {
      /* nothing thrown yet */
    }

    const st = await svc.getCharacteristic(STATUS_UUID);
    st.addEventListener('characteristicvaluechanged', () => this.onStatus?.(parseStatus(st.value!)));
    await st.startNotifications();
    try {
      this.onStatus?.(parseStatus(await st.readValue()));
    } catch {
      /* ignore */
    }

    this.control = await svc.getCharacteristic(CONTROL_UUID);

    this.firmware = undefined;
    try {
      const info = await svc.getCharacteristic(INFO_UUID);
      this.firmware = new TextDecoder().decode(await info.readValue());
    } catch {
      /* firmware before 0.2.0 has no Info characteristic */
    }

    try {
      const bs = await server.getPrimaryService('battery_service');
      const lvl = await bs.getCharacteristic('battery_level');
      lvl.addEventListener('characteristicvaluechanged', () => this.onBattery?.(lvl.value!.getUint8(0)));
      this.onBattery?.((await lvl.readValue()).getUint8(0));
      await lvl.startNotifications().catch(() => undefined);
    } catch {
      /* battery service optional */
    }
  }

  private handleThrow(v: DataView) {
    const r = parseThrowResult(v);
    if (r.throwId === this.lastThrowId) return;
    this.lastThrowId = r.throwId;
    this.onThrow?.(r);
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  async identify() {
    await this.control?.writeValueWithResponse(new Uint8Array([CTRL_IDENTIFY]));
  }
}
