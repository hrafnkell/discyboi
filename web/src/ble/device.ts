/** Web Bluetooth connection to a discyboi. Chrome / Edge (desktop, Android) on https or localhost. */
import {
  CaptureAssembler,
  CONTROL_UUID,
  CTRL_DOWNLOAD,
  DATA_UUID,
  CTRL_IDENTIFY,
  DEVICE_NAME,
  INFO_UUID,
  BOARD_UUID,
  parseStatus,
  parseThrowResult,
  SERVICE_UUID,
  STATUS_UUID,
  THROW_UUID,
  type DeviceStatus,
  type ThrowResult,
} from './protocol';
import { boardId, reportBoard } from './census';
import { sendFirmware, SMP_CHAR_UUID, SMP_SERVICE_UUID, SmpClient, type SmpTransport } from './smp';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DiscDevice {
  readonly name: string;
  /** Firmware version, once connected. Undefined on firmware too old to report one. */
  readonly firmware?: string;
  /** Asks the user to pick a disc, or connects to `known` (a disc this site may already use). */
  connect(known?: BluetoothDevice): Promise<void>;
  disconnect(): void;
  identify(): Promise<void>;
  /** Downloads the raw sensor recording of the latest throw (see CaptureAssembler for the format). */
  downloadCapture?(): Promise<Uint8Array>;
  /**
   * Sends a signed firmware image, restarts the disc into it and reconnects; `firmware` then
   * holds what the disc actually runs. onProgress gets the upload fraction, then 'restart'.
   * If it rejects while still connected, the disc keeps running its current firmware.
   */
  updateFirmware?(image: Uint8Array, onProgress: (p: number | 'restart') => void): Promise<void>;
  onThrow?: (r: ThrowResult) => void;
  onStatus?: (s: DeviceStatus) => void;
  onBattery?: (percent: number) => void;
  onDisconnect?: () => void;
}

/** The disc this tab is connected to, so the next page can reconnect without the picker. */
const LAST_KEY = 'discyboi.lastDisc';

type BluetoothWithDevices = Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
type WatchableDevice = BluetoothDevice & { watchAdvertisements?: (o?: { signal?: AbortSignal }) => Promise<void> };

/**
 * The disc this tab was connected to before the page changed, if the browser lets the site reach
 * it again without the picker (navigator.bluetooth.getDevices; not every browser has it).
 */
export async function rememberedDisc(): Promise<BluetoothDevice | undefined> {
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(LAST_KEY);
  } catch {
    return undefined;
  }
  const bt = navigator.bluetooth as BluetoothWithDevices | undefined;
  if (!id || !bt?.getDevices) return undefined;
  try {
    return (await bt.getDevices()).find((d) => d.id === id);
  } catch {
    return undefined;
  }
}

const remember = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(LAST_KEY, id);
    else sessionStorage.removeItem(LAST_KEY);
  } catch {
    /* storage blocked: no reconnect on the next page */
  }
};

/** Waits (up to ms) until the disc is heard advertising; browsers want that before a picker-less connect. */
async function waitForAdvert(device: WatchableDevice, ms: number) {
  if (!device.watchAdvertisements) return;
  const ctl = new AbortController();
  try {
    const heard = new Promise<void>((r) => device.addEventListener('advertisementreceived', () => r(), { once: true }));
    await device.watchAdvertisements({ signal: ctl.signal });
    await Promise.race([heard, sleep(ms).then(() => Promise.reject(new Error('The disc is not advertising: is it on and close by?')))]);
  } finally {
    ctl.abort();
  }
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
  private data?: BluetoothRemoteGATTCharacteristic;
  private downloading = false;
  private updating = false;
  private retrying = false;
  private smp?: SmpClient;
  private lastThrowId = -1;
  /** Anonymous board id for the board count (firmware 0.4.2+). */
  private boardId?: string;

  async connect(known?: BluetoothDevice) {
    const device =
      known ??
      (await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }, { services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID, 'battery_service', SMP_SERVICE_UUID],
      }));
    if (known) await waitForAdvert(known, 10000);
    this.device = device;
    this.name = device.name ?? DEVICE_NAME;
    device.addEventListener('gattserverdisconnected', () => {
      this.smp?.close('Disconnected during the update');
      // During an update the restart is expected; while retrying a connect, the drop is ours.
      if (!this.updating && !this.retrying) this.onDisconnect?.();
    });
    await this.setupWithRetry(device);
    remember(device.id);
  }

  /**
   * Android often fails the first connect or the service discovery right after it (GATT error
   * 133 and friends), and works on the next try. Retry quietly a few times before giving up.
   */
  private async setupWithRetry(device: BluetoothDevice, tries = 3) {
    this.retrying = true;
    try {
      for (let i = 1; ; i++) {
        try {
          await this.setup(device);
          return;
        } catch (e) {
          if (i >= tries) throw e;
          console.warn(`connect attempt ${i} failed, retrying`, e);
          if (device.gatt?.connected) device.gatt.disconnect();
          await sleep(500 * i);
        }
      }
    } finally {
      this.retrying = false;
    }
  }

  /** Connects and subscribes. Also used to come back after a firmware update. */
  private async setup(device: BluetoothDevice) {
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(SERVICE_UUID);

    const thr = await svc.getCharacteristic(THROW_UUID);
    // The latest throw is readable; remember its id so it is not reported as new. Read before
    // listening: a read fires characteristicvaluechanged too, and would replay the old throw.
    try {
      const v = await thr.readValue();
      if (v.byteLength >= 26) this.lastThrowId = parseThrowResult(v).throwId;
    } catch {
      /* nothing thrown yet */
    }
    thr.addEventListener('characteristicvaluechanged', () => this.handleThrow(thr.value!));
    await thr.startNotifications();

    const st = await svc.getCharacteristic(STATUS_UUID);
    st.addEventListener('characteristicvaluechanged', () => this.onStatus?.(parseStatus(st.value!)));
    await st.startNotifications();
    try {
      this.onStatus?.(parseStatus(await st.readValue()));
    } catch {
      /* ignore */
    }

    this.control = await svc.getCharacteristic(CONTROL_UUID);

    try {
      this.data = await svc.getCharacteristic(DATA_UUID);
      await this.data.startNotifications();
    } catch {
      this.data = undefined; // raw download just isn't offered
    }

    this.firmware = undefined;
    try {
      const info = await svc.getCharacteristic(INFO_UUID);
      this.firmware = new TextDecoder().decode(await info.readValue());
    } catch {
      /* firmware before 0.2.0 has no Info characteristic */
    }

    this.boardId = undefined;
    try {
      const bc = await svc.getCharacteristic(BOARD_UUID);
      this.boardId = await boardId(await bc.readValue());
      if (this.boardId) reportBoard(this.boardId, this.firmware);
    } catch {
      /* firmware before 0.4.2 has no board id */
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
    if (r.throwId === 0 || r.throwId === this.lastThrowId) return; // 0: nothing thrown since boot
    this.lastThrowId = r.throwId;
    if (this.boardId) reportBoard(this.boardId, this.firmware, r.throwId);
    this.onThrow?.(r);
  }

  disconnect() {
    remember(null); // chosen: don't reconnect on the next page
    this.device?.gatt?.disconnect();
  }

  downloadCapture(): Promise<Uint8Array> {
    const data = this.data, control = this.control, device = this.device;
    if (!data || !control || !device) return Promise.reject(new Error('Raw download is not available on this connection'));
    if (this.downloading) return Promise.reject(new Error('A download is already running'));
    this.downloading = true;
    return new Promise<Uint8Array>((resolve, reject) => {
      const asm = new CaptureAssembler();
      let quiet: ReturnType<typeof setTimeout>;
      const done = (fn: () => void) => {
        clearTimeout(quiet);
        data.removeEventListener('characteristicvaluechanged', onPacket);
        device.removeEventListener('gattserverdisconnected', onGone);
        this.downloading = false;
        fn();
      };
      const fail = (e: unknown) => done(() => reject(e instanceof Error ? e : new Error(String(e))));
      // The link is slow but steady: silence for this long means it stalled.
      const arm = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => fail(new Error('Capture download timed out')), 8000);
      };
      const onGone = () => fail(new Error('Disconnected during the download'));
      const onPacket = () => {
        arm();
        try {
          const file = asm.feed(data.value!);
          if (file) done(() => resolve(file));
        } catch (e) {
          fail(e);
        }
      };
      data.addEventListener('characteristicvaluechanged', onPacket);
      device.addEventListener('gattserverdisconnected', onGone);
      arm();
      control.writeValueWithResponse(new Uint8Array([CTRL_DOWNLOAD])).catch(fail);
    });
  }

  async updateFirmware(image: Uint8Array, onProgress: (p: number | 'restart') => void): Promise<void> {
    const device = this.device;
    if (!device?.gatt?.connected) throw new Error('Not connected');
    if (this.updating || this.downloading) throw new Error('The disc is busy');
    this.updating = true;
    try {
      // Opening the update service can hit the same Android hiccup as connecting: reconnect and retry.
      let ch: BluetoothRemoteGATTCharacteristic | undefined;
      for (let i = 1; !ch; i++) {
        try {
          if (!device.gatt.connected) await this.setupWithRetry(device);
          ch = await (await device.gatt.getPrimaryService(SMP_SERVICE_UUID)).getCharacteristic(SMP_CHAR_UUID);
        } catch (e) {
          if (i >= 3) throw e;
          console.warn(`opening the update service failed (attempt ${i}), retrying`, e);
          await sleep(500 * i);
        }
      }
      const transport: SmpTransport = { write: (d) => ch.writeValueWithoutResponse(d as BufferSource) };
      const smp = (this.smp = new SmpClient(transport));
      ch.addEventListener('characteristicvaluechanged', () => {
        const v = ch.value!;
        transport.onData?.(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
      });
      await ch.startNotifications();
      const gone = new Promise<void>((r) => device.addEventListener('gattserverdisconnected', () => r(), { once: true }));

      await sendFirmware(smp, image, onProgress);
      onProgress('restart');
      this.smp = undefined;
      // The disc restarts, MCUboot swaps the images, and the new firmware starts advertising.
      await Promise.race([gone, sleep(10000)]);
      if (device.gatt.connected) device.gatt.disconnect();
      const deadline = Date.now() + 90000;
      for (;;) {
        await sleep(2000);
        try {
          await Promise.race([this.setup(device), sleep(20000).then(() => Promise.reject(new Error('timeout')))]);
          break;
        } catch {
          if (Date.now() > deadline) throw new Error('The disc did not come back after the update. Connect again to see which firmware it runs.');
          if (device.gatt.connected) device.gatt.disconnect();
        }
      }
    } finally {
      this.updating = false;
      this.smp = undefined;
      if (!device.gatt?.connected) this.onDisconnect?.();
    }
  }

  async identify() {
    await this.control?.writeValueWithResponse(new Uint8Array([CTRL_IDENTIFY]));
  }
}
