import { bleSupport, BleDisc, rememberedDisc, type DiscDevice } from '../ble/device';
import { FakeDisc } from '../ble/fake';
import type { DeviceStatus, ThrowResult } from '../ble/protocol';
import { compareVersions, parseImage } from '../ble/smp';
import { h } from './dom';
import { keepAwake } from './wakeLock';

/** /firmware/manifest.json: the firmware the site offers (written by firmware/release.sh). */
interface FirmwareManifest {
  version: string;
  file: string;
  size: number;
  sha256: string;
}

/** Below this the cell may sag too far while the disc writes flash. */
const UPDATE_MIN_MV = 2600;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** Connect button + status chip in the top bar. */
export class DevicePanel {
  readonly el: HTMLElement;
  private dev?: DiscDevice;
  private chip: HTMLElement;
  private btn: HTMLButtonElement;
  private idBtn: HTMLButtonElement;
  private fakeBtn?: HTMLButtonElement;
  private updBtn: HTMLButtonElement;
  /** Newer firmware than the connected disc has. */
  private offer?: FirmwareManifest;
  /** Shown instead of the disc state while an update runs. */
  private updating?: string;
  private status?: DeviceStatus;
  private battery?: number;

  constructor(private fake: boolean, private onThrow: (r: ThrowResult) => void, private toast: (msg: string, kind?: 'err') => void) {
    this.chip = h('span.chip', { title: 'Disc status' }, 'no disc');
    this.btn = h('button.connect', { type: 'button', onclick: () => this.toggle() }, fake ? 'Connect fake disc' : 'Connect disc');
    this.idBtn = h('button.ghostbtn', { type: 'button', title: 'Blink the LED on the disc', hidden: true, onclick: () => this.dev?.identify() }, 'Identify');
    if (fake) this.fakeBtn = h('button.ghostbtn', { type: 'button', hidden: true, onclick: () => (this.dev as FakeDisc).throwNow() }, 'Fake throw');
    this.updBtn = h('button.ghostbtn.update', { type: 'button', hidden: true, onclick: () => this.updateFirmware() }, 'Update firmware');
    this.el = h('div.device', {}, this.chip, this.fakeBtn ?? null, this.updBtn, this.idBtn, this.btn);
    if (!fake) {
      const s = bleSupport();
      if (!s.ok) {
        this.btn.disabled = true;
        this.btn.title = s.reason!;
        this.chip.textContent = 'no Bluetooth';
        this.chip.title = s.reason!;
      } else void this.reconnect();
    }
  }

  /** Coming from the other lab page while connected: connect to the same disc again, no picker. */
  private async reconnect() {
    const known = await rememberedDisc();
    if (known && !this.dev) await this.start(known);
  }

  private async toggle() {
    if (this.dev) {
      this.dev.disconnect();
      return;
    }
    await this.start();
  }

  private async start(known?: BluetoothDevice) {
    const dev: DiscDevice = this.fake ? new FakeDisc() : new BleDisc();
    dev.onThrow = (r) => this.onThrow(r);
    dev.onStatus = (s) => {
      this.status = s;
      this.render();
    };
    dev.onBattery = (b) => {
      this.battery = b;
      this.render();
    };
    dev.onDisconnect = () => {
      this.dev = undefined;
      this.status = undefined;
      this.offer = undefined;
      this.render();
      this.toast('Disc disconnected');
    };
    this.btn.disabled = true;
    this.chip.textContent = known ? 'reconnecting…' : 'connecting…';
    try {
      await dev.connect(known);
      this.dev = dev;
      this.toast(`Connected to ${dev.name}, firmware ${dev.firmware ?? 'older than 0.2.0 (no version reported)'}`);
      void this.checkForUpdate(dev);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (known) this.toast(`Could not reconnect to the disc (${msg}). Press Connect disc.`, 'err');
      else if (!/cancel/i.test(msg)) this.toast(`Bluetooth: ${msg}`, 'err');
    } finally {
      this.btn.disabled = false;
      this.render();
    }
  }

  /** Offers the site's firmware if it is newer than the disc's, or a different build of the same version. */
  private async checkForUpdate(dev: DiscDevice) {
    if (!dev.updateFirmware) return;
    try {
      const res = await fetch('/firmware/manifest.json', { cache: 'no-store' });
      if (!res.ok) return; // nothing published
      const m = (await res.json()) as FirmwareManifest;
      if (typeof m.version !== 'string' || !/^[\w.+-]+\.bin$/.test(m.file) || typeof m.sha256 !== 'string') return;
      if (this.dev !== dev || dev.firmware === m.version || compareVersions(dev.firmware, m.version) > 0) return;
      this.offer = m;
      this.render();
      this.toast(`Firmware ${m.version} is available for this disc`);
    } catch {
      /* offline, or no server: no offer */
    }
  }

  private async updateFirmware() {
    const dev = this.dev, m = this.offer;
    if (!dev?.updateFirmware || !m || this.updating) return;
    const mv = this.status?.batteryMv;
    if (mv !== undefined && mv < UPDATE_MIN_MV) {
      this.toast(`Battery too low for a firmware update (${(mv / 1000).toFixed(2)} V). Fit a fresh cell first.`, 'err');
      return;
    }
    const from = dev.firmware ?? 'older than 0.2.0';
    if (!confirm(`Update the disc's firmware?\n\n${from}  →  ${m.version}\n\nThis takes a minute or two. Keep the disc still and close by, and leave this page open. If anything goes wrong, the disc keeps its current firmware.`)) return;
    this.updating = 'Fetching…';
    this.render();
    try {
      const res = await fetch(`/firmware/${m.file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`could not fetch the firmware (${res.status})`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength !== m.size || hex(await crypto.subtle.digest('SHA-256', buf)) !== m.sha256) throw new Error('the downloaded firmware is damaged');
      const image = new Uint8Array(buf);
      if (parseImage(image).version !== m.version.split('+')[0]) throw new Error('the published firmware does not match its description');
      await dev.updateFirmware(image, (p) => {
        this.updating = p === 'restart' ? 'Restarting…' : `Updating ${Math.round(p * 100)}%`;
        this.render();
      });
      if (dev.firmware === m.version) {
        this.offer = undefined;
        this.toast(`Firmware updated to ${m.version}`);
      } else {
        this.toast(`The disc came back with firmware ${dev.firmware ?? 'unknown'}: the new one did not start, so it went back to the old one.`, 'err');
      }
    } catch (e) {
      this.toast(`Firmware update failed: ${e instanceof Error ? e.message : String(e)}`, 'err');
    } finally {
      this.updating = undefined;
      this.render();
    }
  }

  /** Raw sensor recording of the latest throw. Rejects if the disc can't provide one. */
  downloadCapture(): Promise<Uint8Array> {
    return this.dev?.downloadCapture?.() ?? Promise.reject(new Error('This disc connection has no raw download'));
  }

  private render() {
    const on = !!this.dev;
    keepAwake(on);
    this.btn.textContent = on ? 'Disconnect' : this.fake ? 'Connect fake disc' : 'Connect disc';
    this.idBtn.hidden = !on || this.fake || !!this.updating;
    this.btn.disabled = !!this.updating;
    this.updBtn.hidden = !on || !this.offer;
    this.updBtn.disabled = !!this.updating;
    this.updBtn.textContent = this.updating ?? 'Update firmware';
    this.updBtn.title = this.offer ? `Firmware ${this.offer.version} is available (the disc has ${this.dev?.firmware ?? 'an older one'})` : '';
    if (this.fakeBtn) this.fakeBtn.hidden = !on;
    this.chip.classList.toggle('on', on);
    if (!on) {
      this.chip.textContent = 'no disc';
      this.chip.title = 'Disc status';
      return;
    }
    const s = this.status;
    const bat = this.battery !== undefined ? `${this.battery}%` : s ? `${(s.batteryMv / 1000).toFixed(2)} V` : '';
    const fw = this.dev!.firmware;
    this.chip.textContent = [this.updating ? 'updating firmware' : s?.downloading ? 'sending raw data' : (s?.state ?? 'connected'), bat, s ? `${s.throws} throws` : '', fw ? `v${fw.split('+')[0]}` : ''].filter(Boolean).join(' · ');
    this.chip.title = `Firmware ${fw ?? 'older than 0.2.0'}`;
    this.chip.dataset.state = s?.state ?? '';
  }
}
