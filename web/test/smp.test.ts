import { describe, expect, test } from 'bun:test';
import { cborDecode, cborEncode, compareVersions, parseImage, sameBytes, sendFirmware, SmpClient, type Cbor, type SmpTransport } from '../src/ble/smp';

/** A signed-image lookalike: MCUboot header, body, then a TLV area holding the hash. */
function makeImage(size: number, hash: Uint8Array, version = [0, 3, 0], protectedTlv = false): Uint8Array {
  const hdr = 32, prot = protectedTlv ? 4 + 4 + 2 : 0;
  const file = new Uint8Array(hdr + size + prot + 4 + 4 + 32 + 4 + 8);
  const dv = new DataView(file.buffer);
  dv.setUint32(0, 0x96f3b83d, true);
  dv.setUint16(8, hdr, true);
  dv.setUint16(10, prot, true);
  dv.setUint32(12, size, true);
  dv.setUint8(20, version[0]);
  dv.setUint8(21, version[1]);
  dv.setUint16(22, version[2], true);
  for (let i = 0; i < size; i++) file[hdr + i] = (i * 7) & 0xff;
  let p = hdr + size;
  if (protectedTlv) {
    dv.setUint16(p, 0x6908, true);
    dv.setUint16(p + 2, prot, true);
    dv.setUint16(p + 4, 0x50, true);
    dv.setUint16(p + 6, 2, true);
    p += prot;
  }
  dv.setUint16(p, 0x6907, true);
  dv.setUint16(p + 2, 4 + 4 + 32 + 4 + 8, true);
  dv.setUint16(p + 4, 0x10, true);
  dv.setUint16(p + 6, 32, true);
  file.set(hash, p + 8);
  dv.setUint16(p + 40, 0x22, true); // some other entry (a signature in real life)
  dv.setUint16(p + 42, 8, true);
  return file;
}

const hashOf = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (seed + i * 3) & 0xff);

/** Encodes like Zephyr's zcbor does by default: maps and lists of indefinite length. */
function zcbor(v: Cbor): number[] {
  if (Array.isArray(v)) return [0x9f, ...v.flatMap(zcbor), 0xff];
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return [0xbf, ...Object.entries(v).flatMap(([k, x]) => [...cborEncode(k), ...zcbor(x)]), 0xff];
  return [...cborEncode(v)];
}

/** A disc's update service: reassembles requests, stores the upload, answers in MTU-sized pieces. */
class FakeDisc implements SmpTransport {
  onData?: (d: Uint8Array) => void;
  slot1?: { data: Uint8Array; len: number; id: Uint8Array; got: number };
  pending = false;
  resets = 0;
  writes: number[] = [];
  dropNext = 0;
  refuseUpload = false;
  private rx = new Uint8Array(0);

  constructor(private mtuPayload: number, private running: Uint8Array) {}

  async write(d: Uint8Array) {
    if (d.length > this.mtuPayload) throw new Error(`write of ${d.length} exceeds the link (${this.mtuPayload})`);
    this.writes.push(d.length);
    this.rx = Uint8Array.from([...this.rx, ...d]);
    if (this.rx.length < 8) return;
    const total = 8 + ((this.rx[2] << 8) | this.rx[3]);
    if (this.rx.length < total) return;
    const pkt = this.rx.slice(0, total);
    this.rx = this.rx.slice(total);
    if (this.dropNext > 0) {
      this.dropNext--;
      return;
    }
    queueMicrotask(() => this.handle(pkt));
  }

  private slotHash(): Uint8Array | undefined {
    const s = this.slot1;
    return s && s.got === s.len ? parseImage(s.data).hash : undefined;
  }

  private state(): Cbor {
    const images: Cbor[] = [{ image: 0, slot: 0, version: '0.2.0', hash: this.running, bootable: true, pending: false, confirmed: true, active: true, permanent: false }];
    const h = this.slotHash();
    if (h) images.push({ image: 0, slot: 1, version: '0.3.0', hash: h, bootable: true, pending: this.pending, confirmed: false, active: false, permanent: false });
    return { images, splitStatus: 0 };
  }

  private handle(pkt: Uint8Array) {
    const op = pkt[0], group = (pkt[4] << 8) | pkt[5], seq = pkt[6], id = pkt[7];
    const req = cborDecode(pkt.subarray(8)) as { [k: string]: Cbor };
    let rsp: Cbor = { rc: 8 };
    if (group === 1 && id === 0 && op === 0) rsp = this.state();
    else if (group === 1 && id === 0 && op === 2) {
      const h = this.slotHash();
      if (h && sameBytes(h, req.hash as Uint8Array)) {
        this.pending = true;
        rsp = this.state();
      } else rsp = { rc: 5 };
    } else if (group === 1 && id === 1 && op === 2) {
      const off = req.off as number, data = req.data as Uint8Array;
      if (this.refuseUpload) rsp = { rc: 6 };
      else if (off === 0) {
        const id = req.sha as Uint8Array;
        // Same file as a partial upload already here: continue it.
        if (!this.slot1 || !sameBytes(this.slot1.id, id)) this.slot1 = { data: new Uint8Array(req.len as number), len: req.len as number, id, got: 0 };
        if (this.slot1.got === 0) {
          this.slot1.data.set(data, 0);
          this.slot1.got = data.length;
        }
        rsp = { rc: 0, off: this.slot1.got };
      } else if (this.slot1 && off === this.slot1.got) {
        this.slot1.data.set(data, off);
        this.slot1.got += data.length;
        rsp = { off: this.slot1.got }; // newer firmware leaves rc out on success
      } else rsp = { rc: 0, off: this.slot1?.got ?? 0 };
    } else if (group === 0 && id === 5) {
      this.resets++;
      rsp = {};
    }
    const body = Uint8Array.from(zcbor(rsp));
    const out = Uint8Array.from([op + 1, 0, body.length >> 8, body.length & 0xff, pkt[4], pkt[5], seq, id, ...body]);
    for (let o = 0; o < out.length; o += this.mtuPayload) this.onData?.(out.slice(o, o + this.mtuPayload));
  }
}

describe('cbor', () => {
  test('round trip', () => {
    const v = { off: 70000, len: 23, neg: -5, data: new Uint8Array([1, 2, 3]), ok: true, no: false, nil: null, s: 'héllo', list: [1, { a: 300 }] };
    expect(cborDecode(cborEncode(v))).toEqual(v);
  });
  test('known encodings', () => {
    expect([...cborEncode({ off: 0 })]).toEqual([0xa1, 0x63, 0x6f, 0x66, 0x66, 0x00]);
    expect([...cborEncode(500)]).toEqual([0x19, 0x01, 0xf4]);
    expect([...cborEncode(100000)]).toEqual([0x1a, 0x00, 0x01, 0x86, 0xa0]);
  });
  test('indefinite-length containers, as Zephyr sends them', () => {
    expect(cborDecode(Uint8Array.from(zcbor({ images: [{ slot: 1, hash: new Uint8Array([9]) }], splitStatus: 0 })))).toEqual({ images: [{ slot: 1, hash: new Uint8Array([9]) }], splitStatus: 0 });
  });
  test('truncated input throws', () => {
    expect(() => cborDecode(Uint8Array.from([0xa1, 0x63, 0x6f]))).toThrow();
  });
});

describe('image file', () => {
  test('version and hash', () => {
    const info = parseImage(makeImage(1000, hashOf(5), [1, 2, 300]));
    expect(info.version).toBe('1.2.300');
    expect(info.hash).toEqual(hashOf(5));
  });
  test('with a protected TLV area in front', () => {
    expect(parseImage(makeImage(64, hashOf(8), [0, 3, 0], true)).hash).toEqual(hashOf(8));
  });
  test('rejects other files and cut-off images', () => {
    expect(() => parseImage(new Uint8Array(100))).toThrow('Not a firmware image');
    expect(() => parseImage(makeImage(1000, hashOf(1)).slice(0, 900))).toThrow('cut short');
  });
  test('compareVersions', () => {
    expect(compareVersions('0.2.0+d1d731a', '0.3.0+abc')).toBe(-1);
    expect(compareVersions('0.3.0+abc', '0.3.0+def-dirty')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions(undefined, '0.1.0')).toBe(-1);
  });
});

describe('update', () => {
  const run = async (mtuPayload: number, size = 5000) => {
    const disc = new FakeDisc(mtuPayload, hashOf(1));
    const smp = new SmpClient(disc);
    const file = makeImage(size, hashOf(2));
    const progress: number[] = [];
    const info = await sendFirmware(smp, file, (f) => progress.push(f));
    return { disc, smp, file, progress, info };
  };

  test('uploads, marks for test and resets (large MTU)', async () => {
    const { disc, smp, file, progress, info } = await run(244);
    // The link size is learned from the disc's answers; with one image on board the first
    // answer is 149 bytes, so that is what the upload uses (checked on the writes below).
    expect(smp.fragment).toBe(244); // learned later, from the longer answer with two images
    expect(disc.slot1!.data).toEqual(file);
    expect(disc.pending).toBe(true);
    expect(disc.resets).toBe(1);
    expect(info.version).toBe('0.3.0');
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(Math.max(...disc.writes)).toBe(149); // packets fill what is known of the link, one write each
  });

  test('uses the full link once the disc has shown it (two images on board)', async () => {
    const first = await run(244);
    const disc = first.disc, smp = new SmpClient(disc);
    disc.writes = [];
    const file = makeImage(4000, hashOf(3));
    await sendFirmware(smp, file);
    expect(smp.fragment).toBe(244);
    expect(Math.max(...disc.writes)).toBe(244);
    expect(disc.slot1!.data).toEqual(file);
  });

  test('default 23-byte MTU: packets are split into 20-byte writes', async () => {
    const { disc, smp, file } = await run(20, 1200);
    expect(smp.fragment).toBe(20);
    expect(Math.max(...disc.writes)).toBe(20);
    expect(disc.slot1!.data).toEqual(file);
    expect(disc.pending).toBe(true);
  });

  test('mid-sized MTU', async () => {
    const { disc, file } = await run(120);
    expect(Math.max(...disc.writes)).toBe(120);
    expect(disc.slot1!.data).toEqual(file);
  });

  test('refuses when the disc already runs the image', async () => {
    const disc = new FakeDisc(244, hashOf(2));
    await expect(sendFirmware(new SmpClient(disc), makeImage(500, hashOf(2)))).rejects.toThrow('already runs');
    expect(disc.resets).toBe(0);
  });

  test('skips the upload when the image is already in the spare slot', async () => {
    const first = await run(244);
    first.disc.pending = false;
    const before = first.disc.writes.length;
    await sendFirmware(new SmpClient(first.disc), first.file);
    expect(first.disc.writes.length - before).toBe(3); // state, test, reset
    expect(first.disc.pending).toBe(true);
  });

  test('continues an interrupted upload of the same file', async () => {
    const disc = new FakeDisc(244, hashOf(1));
    const file = makeImage(5000, hashOf(2));
    const id = new Uint8Array(await crypto.subtle.digest('SHA-256', file as BufferSource));
    disc.slot1 = { data: new Uint8Array(file.length), len: file.length, id, got: 3000 };
    disc.slot1.data.set(file.subarray(0, 3000));
    const sent: number[] = [];
    await new SmpClient(disc).upload(file, id, (s) => sent.push(s));
    expect(sent[0]).toBe(3000);
    expect(disc.slot1.data).toEqual(file);
  });

  test('an error from the disc stops the update', async () => {
    const disc = new FakeDisc(244, hashOf(1));
    disc.refuseUpload = true;
    await expect(sendFirmware(new SmpClient(disc), makeImage(500, hashOf(2)))).rejects.toThrow('bad state');
    expect(disc.resets).toBe(0);
  });

  test('a dropped link fails the request in flight', async () => {
    const disc = new FakeDisc(244, hashOf(1));
    const smp = new SmpClient(disc);
    disc.dropNext = 1;
    const p = smp.images();
    smp.close('Disconnected during the update');
    await expect(p).rejects.toThrow('Disconnected during the update');
    await expect(smp.images()).rejects.toThrow('Disconnected');
  });
});
