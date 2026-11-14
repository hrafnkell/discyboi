import { describe, expect, test } from 'bun:test';
import {
  encodeStatus,
  encodeThrowResult,
  parseStatus,
  parseThrowResult,
  SERVICE_UUID,
  THROW_UUID,
  type ThrowResult,
} from '../src/ble/protocol';

describe('protocol', () => {
  test('UUIDs match the firmware (UUID_DISCY(n) = 0x6d2b0000 + n)', () => {
    expect(SERVICE_UUID).toBe('6d2b0001-5f3c-4b8a-9e0d-d15cb0100000');
    expect(THROW_UUID).toBe('6d2b0002-5f3c-4b8a-9e0d-d15cb0100000');
  });

  test('parses a hand-built 26-byte struct throw_result', () => {
    // Laid out exactly like the packed C struct, little-endian.
    const bytes = new Uint8Array([
      0x78, 0x56, 0x34, 0x12, // throw_id 0x12345678
      0x07, 0x00, // flags = angles | speed | centrip
      0xb4, 0xfa, // spin_rpm -1356
      0xc4, 0x09, // speed_cms 2500
      0x18, 0xfc, // hyzer_cdeg -1000
      0x20, 0x03, // nose_cdeg 800
      0xe8, 0x03, // launch_cdeg 1000
      0x2a, 0x00, // wobble_dps 42
      0x5e, 0x01, // peak_dg 350
      0xfa, 0x00, // pull_ms 250
      0xd0, 0x07, // flight_ms 2000
      0x68, 0x10, // battery_mv 4200
    ]);
    expect(bytes.length).toBe(26);
    const r = parseThrowResult(new DataView(bytes.buffer));
    expect(r).toEqual({
      throwId: 0x12345678,
      flags: 7,
      spinRpm: -1356,
      speedCms: 2500,
      hyzerCdeg: -1000,
      noseCdeg: 800,
      launchCdeg: 1000,
      wobbleDps: 42,
      peakDg: 350,
      pullMs: 250,
      flightMs: 2000,
      batteryMv: 4200,
    });
  });

  test('throw result round-trips', () => {
    const r: ThrowResult = {
      throwId: 9, flags: 3, spinRpm: 1100, speedCms: 2210, hyzerCdeg: 512, noseCdeg: -300,
      launchCdeg: 1234, wobbleDps: 10, peakDg: 200, pullMs: 180, flightMs: 3100, batteryMv: 3900,
    };
    expect(parseThrowResult(encodeThrowResult(r))).toEqual(r);
  });

  test('rejects short buffers', () => {
    expect(() => parseThrowResult(new DataView(new ArrayBuffer(20)))).toThrow();
  });

  test('status', () => {
    const dv = new DataView(new Uint8Array([1, 0, 0x68, 0x10, 5, 0, 0, 0]).buffer);
    expect(parseStatus(dv)).toEqual({ state: 'armed', downloading: false, batteryMv: 4200, throws: 5 });
    const s = { state: 'flight' as const, downloading: true, batteryMv: 3700, throws: 70000 };
    expect(parseStatus(encodeStatus(s))).toEqual(s);
  });
});
