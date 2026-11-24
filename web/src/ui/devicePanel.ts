import { bleSupport, BleDisc, type DiscDevice } from '../ble/device';
import { FakeDisc } from '../ble/fake';
import type { DeviceStatus, ThrowResult } from '../ble/protocol';
import { h } from './dom';
import { keepAwake } from './wakeLock';

/** Connect button + status chip in the top bar. */
export class DevicePanel {
  readonly el: HTMLElement;
  private dev?: DiscDevice;
  private chip: HTMLElement;
  private btn: HTMLButtonElement;
  private idBtn: HTMLButtonElement;
  private fakeBtn?: HTMLButtonElement;
  private status?: DeviceStatus;
  private battery?: number;

  constructor(private fake: boolean, private onThrow: (r: ThrowResult) => void, private toast: (msg: string, kind?: 'err') => void) {
    this.chip = h('span.chip', { title: 'Disc status' }, 'no disc');
    this.btn = h('button.connect', { type: 'button', onclick: () => this.toggle() }, fake ? 'Connect fake disc' : 'Connect disc');
    this.idBtn = h('button.ghostbtn', { type: 'button', title: 'Blink the LED on the disc', hidden: true, onclick: () => this.dev?.identify() }, 'Identify');
    if (fake) this.fakeBtn = h('button.ghostbtn', { type: 'button', hidden: true, onclick: () => (this.dev as FakeDisc).throwNow() }, 'Fake throw');
    this.el = h('div.device', {}, this.chip, this.fakeBtn ?? null, this.idBtn, this.btn);
    if (!fake) {
      const s = bleSupport();
      if (!s.ok) {
        this.btn.disabled = true;
        this.btn.title = s.reason!;
        this.chip.textContent = 'no Bluetooth';
        this.chip.title = s.reason!;
      }
    }
  }

  private async toggle() {
    if (this.dev) {
      this.dev.disconnect();
      return;
    }
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
      this.render();
      this.toast('Disc disconnected');
    };
    this.btn.disabled = true;
    this.chip.textContent = 'connecting…';
    try {
      await dev.connect();
      this.dev = dev;
      this.toast(`Connected to ${dev.name}, firmware ${dev.firmware ?? 'older than 0.2.0 (no version reported)'}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) this.toast(`Bluetooth: ${msg}`, 'err');
    } finally {
      this.btn.disabled = false;
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
    this.idBtn.hidden = !on || this.fake;
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
    this.chip.textContent = [s?.downloading ? 'sending raw data' : (s?.state ?? 'connected'), bat, s ? `${s.throws} throws` : '', fw ? `v${fw.split('+')[0]}` : ''].filter(Boolean).join(' · ');
    this.chip.title = `Firmware ${fw ?? 'older than 0.2.0'}`;
    this.chip.dataset.state = s?.state ?? '';
  }
}
