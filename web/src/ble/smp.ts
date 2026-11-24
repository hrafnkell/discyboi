/**
 * Firmware update over Bluetooth: a small client for the mcumgr SMP service that Zephyr /
 * MCUboot expose (the same one nRF Connect Device Manager talks to). No DOM, no Web Bluetooth
 * types: it works on a byte transport, so the tests run it against a simulated disc.
 *
 * An SMP packet is an 8-byte header (op, flags, length, group, sequence, command) followed by
 * a CBOR map. Requests go out as writes without response, answers come back as notifications.
 * Either side splits a packet over several writes / notifications when it exceeds the link's
 * packet size; the firmware reassembles (CONFIG_MCUMGR_TRANSPORT_BT_REASSEMBLY).
 */

export const SMP_SERVICE_UUID = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
export const SMP_CHAR_UUID = 'da2e7828-fbce-4e01-ae9e-261174997c48';

// ---------------------------------------------------------------- CBOR (the subset SMP uses)
export type Cbor = number | boolean | null | string | Uint8Array | Cbor[] | { [k: string]: Cbor };

const utf8 = new TextEncoder();

function head(major: number, n: number, out: number[]) {
  const m = major << 5;
  if (n < 24) out.push(m | n);
  else if (n < 0x100) out.push(m | 24, n);
  else if (n < 0x10000) out.push(m | 25, n >> 8, n & 0xff);
  else out.push(m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function enc(v: Cbor, out: number[]) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || Math.abs(v) > 0xffffffff) throw new Error('CBOR: only 32-bit integers');
    if (v >= 0) head(0, v, out);
    else head(1, -1 - v, out);
  } else if (typeof v === 'boolean') out.push(v ? 0xf5 : 0xf4);
  else if (v === null) out.push(0xf6);
  else if (typeof v === 'string') {
    const b = utf8.encode(v);
    head(3, b.length, out);
    for (const x of b) out.push(x);
  } else if (v instanceof Uint8Array) {
    head(2, v.length, out);
    for (const x of v) out.push(x);
  } else if (Array.isArray(v)) {
    head(4, v.length, out);
    for (const x of v) enc(x, out);
  } else {
    const keys = Object.keys(v);
    head(5, keys.length, out);
    for (const k of keys) {
      enc(k, out);
      enc(v[k], out);
    }
  }
}

export function cborEncode(v: Cbor): Uint8Array {
  const out: number[] = [];
  enc(v, out);
  return Uint8Array.from(out);
}

export function cborDecode(b: Uint8Array): Cbor {
  let p = 0;
  const need = (n: number) => {
    if (p + n > b.length) throw new Error('CBOR: truncated');
  };
  const item = (): Cbor => {
    need(1);
    const ib = b[p++], major = ib >> 5, info = ib & 31;
    let n = info;
    if (info === 24) {
      need(1);
      n = b[p++];
    } else if (info === 25) {
      need(2);
      n = (b[p] << 8) | b[p + 1];
      p += 2;
    } else if (info === 26) {
      need(4);
      n = b[p] * 0x1000000 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
      p += 4;
    } else if (info === 27) {
      need(8);
      n = 0;
      for (let i = 0; i < 8; i++) n = n * 256 + b[p++];
    } else if (info > 27 && info < 31) throw new Error('CBOR: bad length');
    const indefinite = info === 31;
    const atBreak = () => {
      need(1);
      if (b[p] !== 0xff) return false;
      p++;
      return true;
    };
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 2:
      case 3: {
        if (indefinite) throw new Error('CBOR: chunked strings not supported');
        need(n);
        const s = b.slice(p, p + n);
        p += n;
        return major === 2 ? s : new TextDecoder().decode(s);
      }
      case 4: {
        const a: Cbor[] = [];
        if (indefinite) while (!atBreak()) a.push(item());
        else for (let i = 0; i < n; i++) a.push(item());
        return a;
      }
      case 5: {
        const o: { [k: string]: Cbor } = {};
        const pair = () => {
          const k = item();
          o[String(k)] = item();
        };
        if (indefinite) while (!atBreak()) pair();
        else for (let i = 0; i < n; i++) pair();
        return o;
      }
      case 6:
        return item(); // tag: ignore it
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        throw new Error('CBOR: unsupported value');
    }
  };
  return item();
}

// ---------------------------------------------------------------- MCUboot image file
const IMAGE_MAGIC = 0x96f3b83d;
const TLV_MAGIC = 0x6907, TLV_PROT_MAGIC = 0x6908, TLV_SHA256 = 0x10;

export interface ImageInfo {
  /** "major.minor.revision" from the image header (app/VERSION at build time). */
  version: string;
  /** The image's SHA-256 as MCUboot knows it (not the hash of the file): identifies the image on the disc. */
  hash: Uint8Array;
}

/** Reads the version and hash out of a signed MCUboot image (zephyr.signed.bin). Throws if it isn't one. */
export function parseImage(file: Uint8Array): ImageInfo {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 32 || dv.getUint32(0, true) !== IMAGE_MAGIC) throw new Error('Not a firmware image');
  const hdrSize = dv.getUint16(8, true), imgSize = dv.getUint32(12, true);
  const version = `${dv.getUint8(20)}.${dv.getUint8(21)}.${dv.getUint16(22, true)}`;
  let off = hdrSize + imgSize;
  const info = (at: number) => {
    if (at + 4 > file.length) throw new Error('Firmware image is cut short');
    return { magic: dv.getUint16(at, true), total: dv.getUint16(at + 2, true) };
  };
  let t = info(off);
  if (t.magic === TLV_PROT_MAGIC) {
    off += t.total;
    t = info(off);
  }
  if (t.magic !== TLV_MAGIC || off + t.total > file.length) throw new Error('Firmware image is cut short');
  for (let p = off + 4; p + 4 <= off + t.total; ) {
    const type = dv.getUint16(p, true), len = dv.getUint16(p + 2, true);
    if (type === TLV_SHA256 && len === 32) return { version, hash: file.slice(p + 4, p + 36) };
    p += 4 + len;
  }
  throw new Error('Firmware image has no hash');
}

/** -1 / 0 / 1 for the numeric part of two versions ("0.3.0+abc" -> 0.3.0). Unparseable counts as oldest. */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const parts = (s: string | undefined) => (/^\d+(\.\d+)*/.exec(s ?? '')?.[0] ?? '-1').split('.').map(Number);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------- SMP client
const OP_READ = 0, OP_WRITE = 2;
const GROUP_OS = 0, GROUP_IMAGE = 1;
const ID_RESET = 5, ID_IMAGE_STATE = 0, ID_IMAGE_UPLOAD = 1;

/** Smallest packet every BLE link carries (ATT MTU 23), and the most the disc's MTU of 247 allows. */
const FRAGMENT_MIN = 20, FRAGMENT_MAX = 244;
/** With a small link MTU, send packets this big anyway, split over several writes. */
const PACKET_MIN = 244;

const RC_TEXT: Record<number, string> = {
  1: 'unknown error', 2: 'out of memory', 3: 'invalid value', 4: 'timeout', 5: 'no entry', 6: 'bad state',
  7: 'response too large', 8: 'not supported', 9: 'corrupt', 10: 'busy',
};

export interface SmpTransport {
  /** One write without response. The value fits the link if it is no longer than the client's fragment size. */
  write(data: Uint8Array): Promise<void>;
  /** Called with every notification payload. */
  onData?: (data: Uint8Array) => void;
}

export interface ImageSlot {
  slot: number;
  version: string;
  hash: Uint8Array;
  pending: boolean;
  confirmed: boolean;
  active: boolean;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

type Fields = { [k: string]: Cbor };

export class SmpClient {
  /** Largest single write the link is known to carry. Grows once the disc shows a larger MTU. */
  fragment = FRAGMENT_MIN;
  private seq = 0;
  private rx = new Uint8Array(0);
  private waiting?: { seq: number; resolve: (v: Fields) => void; reject: (e: Error) => void };
  private closed?: Error;

  constructor(private transport: SmpTransport) {
    transport.onData = (d) => this.receive(d);
  }

  /** Fails the request in flight (and any later one), e.g. when the link drops. */
  close(reason = 'Disconnected') {
    this.closed = new Error(reason);
    this.waiting?.reject(this.closed);
  }

  private receive(d: Uint8Array) {
    // The disc sends notifications as large as the link allows, so the largest one seen is a
    // size we can safely write too. Web Bluetooth doesn't tell us the MTU any other way.
    this.fragment = Math.min(FRAGMENT_MAX, Math.max(this.fragment, d.length));
    const rx = new Uint8Array(this.rx.length + d.length);
    rx.set(this.rx);
    rx.set(d, this.rx.length);
    this.rx = rx;
    while (this.rx.length >= 8) {
      const total = 8 + ((this.rx[2] << 8) | this.rx[3]);
      if (this.rx.length < total) return;
      const pkt = this.rx.slice(0, total);
      this.rx = this.rx.slice(total);
      const w = this.waiting;
      if (!w || pkt[6] !== w.seq) continue; // a late answer to a request we gave up on
      try {
        const body = cborDecode(pkt.subarray(8));
        if (body === null || typeof body !== 'object' || Array.isArray(body) || body instanceof Uint8Array) throw new Error('Unexpected answer from the disc');
        w.resolve(body);
      } catch (e) {
        w.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private packet(op: number, group: number, id: number, body: Fields, seq: number): Uint8Array {
    const payload = cborEncode(body);
    const pkt = new Uint8Array(8 + payload.length);
    pkt.set([op, 0, payload.length >> 8, payload.length & 0xff, group >> 8, group & 0xff, seq, id]);
    pkt.set(payload, 8);
    return pkt;
  }

  private async request(op: number, group: number, id: number, body: Fields, timeoutMs = 5000): Promise<Fields> {
    if (this.closed) throw this.closed;
    if (this.waiting) throw new Error('The disc is busy with another request');
    const seq = (this.seq = (this.seq + 1) & 0xff);
    const pkt = this.packet(op, group, id, body, seq);
    this.rx = new Uint8Array(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = new Promise<Fields>((resolve, reject) => {
        this.waiting = { seq, resolve, reject };
        timer = setTimeout(() => reject(new Error('The disc did not answer')), timeoutMs);
      });
      answer.catch(() => undefined); // a failed write below must not leave this unhandled
      for (let off = 0; off < pkt.length; off += this.fragment) await this.transport.write(pkt.subarray(off, off + this.fragment));
      const rsp = await answer;
      const err = rsp.err as Fields | undefined;
      const rc = typeof rsp.rc === 'number' ? rsp.rc : err && typeof err.rc === 'number' ? err.rc : 0;
      if (rc !== 0) throw new Error(`The disc refused (${RC_TEXT[rc] ?? 'error'} ${rc})`);
      return rsp;
    } finally {
      clearTimeout(timer);
      this.waiting = undefined;
    }
  }

  /** The firmware images on the disc: slot 0 is the running one, slot 1 an uploaded one. */
  async images(): Promise<ImageSlot[]> {
    return this.slots(await this.request(OP_READ, GROUP_IMAGE, ID_IMAGE_STATE, {}));
  }

  private slots(rsp: Fields): ImageSlot[] {
    const list = Array.isArray(rsp.images) ? rsp.images : [];
    return list.flatMap((im) => {
      if (im === null || typeof im !== 'object' || Array.isArray(im) || im instanceof Uint8Array) return [];
      if (!(im.hash instanceof Uint8Array)) return [];
      return [{ slot: Number(im.slot ?? 0), version: String(im.version ?? ''), hash: im.hash, pending: im.pending === true, confirmed: im.confirmed === true, active: im.active === true }];
    });
  }

  /**
   * Sends an image to the spare slot. `id` identifies the upload so the disc can continue an
   * interrupted one (any stable hash of the file). onProgress gets bytes sent / total.
   */
  async upload(file: Uint8Array, id: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    let off = 0;
    while (off < file.length) {
      const fields: Fields = off === 0 ? { image: 0, len: file.length, off, sha: id } : { off };
      // Room for data: the packet size minus the header, the other fields and the data's length prefix.
      const limit = this.fragment >= 100 ? this.fragment : PACKET_MIN;
      const most = limit - 8 - cborEncode({ ...fields, data: new Uint8Array(0) }).length; // if data had a 1-byte length prefix
      const room = most - (most > 257 ? 2 : most > 24 ? 1 : 0);
      const body = { ...fields, data: file.subarray(off, off + room) };
      let rsp: Fields | undefined;
      for (let attempt = 0; !rsp; attempt++) {
        try {
          // The first chunk makes the disc erase the slot, which can take a while.
          rsp = await this.request(OP_WRITE, GROUP_IMAGE, ID_IMAGE_UPLOAD, body, off === 0 ? 30000 : 5000);
        } catch (e) {
          if (this.closed || attempt >= 2 || !/did not answer/.test(String(e))) throw e;
        }
      }
      // The disc says where it wants the next chunk: normally right after this one, further
      // along when it already holds the start of this same file.
      if (typeof rsp.off !== 'number' || rsp.off <= off) throw new Error('The upload is not advancing');
      off = rsp.off;
      onProgress?.(Math.min(off, file.length), file.length);
    }
  }

  /** Marks an uploaded image to be tried on the next boot (MCUboot goes back if it isn't confirmed). */
  async test(hash: Uint8Array): Promise<ImageSlot[]> {
    return this.slots(await this.request(OP_WRITE, GROUP_IMAGE, ID_IMAGE_STATE, { hash, confirm: false }));
  }

  /** Restarts the disc. It may drop the link before answering, which is fine. */
  async reset(): Promise<void> {
    await this.request(OP_WRITE, GROUP_OS, ID_RESET, {}, 3000).catch(() => undefined);
  }
}

/**
 * The whole update up to the restart: check, upload, mark for test, reset. Resolves once the
 * reset has been asked for; the caller then waits for the disc to come back.
 */
export async function sendFirmware(smp: SmpClient, file: Uint8Array, onProgress?: (fraction: number) => void): Promise<ImageInfo> {
  const info = parseImage(file);
  const before = await smp.images(); // also teaches the client the link's packet size
  if (before.some((s) => s.active && sameBytes(s.hash, info.hash))) throw new Error('The disc already runs this firmware');
  if (!before.some((s) => s.slot === 1 && sameBytes(s.hash, info.hash))) {
    const id = new Uint8Array(await crypto.subtle.digest('SHA-256', file as BufferSource));
    await smp.upload(file, id, (sent, total) => onProgress?.(sent / total));
  }
  onProgress?.(1);
  const after = await smp.test(info.hash);
  if (!after.some((s) => sameBytes(s.hash, info.hash) && s.pending)) throw new Error('The disc did not accept the new firmware');
  await smp.reset();
  return info;
}
