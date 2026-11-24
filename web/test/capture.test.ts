import { describe, expect, test } from 'bun:test';
import { CAPTURE_HEADER_SIZE, CaptureAssembler } from '../src/ble/protocol';

const SIZE = 30;
function header(len: number, throwId = 7): DataView {
  const dv = new DataView(new ArrayBuffer(CAPTURE_HEADER_SIZE));
  dv.setUint8(0, 0x00);
  dv.setUint8(1, 1);
  dv.setUint16(2, SIZE, true);
  dv.setUint32(4, throwId, true);
  dv.setUint16(8, len, true);
  dv.setUint16(10, 5, true);
  dv.setUint16(12, 9, true);
  dv.setUint16(14, 960, true);
  return dv;
}
function samples(first: number, n: number): DataView {
  const b = new Uint8Array(4 + n * SIZE);
  b[0] = 0x01;
  b[1] = n;
  new DataView(b.buffer).setUint16(2, first, true);
  for (let i = 0; i < n; i++) b.fill((first + i) & 0xff, 4 + i * SIZE, 4 + (i + 1) * SIZE);
  return new DataView(b.buffer);
}
const end = (status: number, sent: number) => {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint8(0, 0x02);
  dv.setUint8(1, status);
  dv.setUint16(2, sent, true);
  return dv;
};

describe('raw capture download', () => {
  test('packets assemble into header + samples', () => {
    const a = new CaptureAssembler();
    expect(a.feed(header(20))).toBeUndefined();
    expect(a.header).toMatchObject({ throwId: 7, len: 20, sampleSize: SIZE, pullIdx: 5, releaseIdx: 9, odrHz: 960 });
    expect(a.feed(samples(0, 8))).toBeUndefined();
    expect(a.feed(samples(8, 8))).toBeUndefined();
    expect(a.progress).toBeCloseTo(0.8);
    expect(a.feed(samples(16, 4))).toBeUndefined();
    const file = a.feed(end(0, 20))!;
    expect(file.length).toBe(CAPTURE_HEADER_SIZE + 20 * SIZE);
    expect(new DataView(file.buffer).getUint32(4, true)).toBe(7);
    for (let i = 0; i < 20; i++) expect(file[CAPTURE_HEADER_SIZE + i * SIZE + 3]).toBe(i);
  });

  test('a short, aborted or refused download is an error', () => {
    const a = new CaptureAssembler();
    a.feed(header(20));
    a.feed(samples(0, 8));
    expect(() => a.feed(end(0, 8))).toThrow('cut short');
    expect(() => new CaptureAssembler().feed(end(2, 0))).toThrow('no capture');
    const b = new CaptureAssembler();
    b.feed(header(4));
    expect(() => b.feed(samples(2, 8))).toThrow('Bad capture packet');
  });
});
