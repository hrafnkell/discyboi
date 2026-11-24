/**
 * discyboi BLE protocol, mirroring firmware/app/src/discy.h and ble.c. All little-endian.
 */
const uuid = (n: number) => `6d2b${n.toString(16).padStart(4, '0')}-5f3c-4b8a-9e0d-d15cb0100000`;

export const SERVICE_UUID = uuid(1);
export const THROW_UUID = uuid(2);
export const STATUS_UUID = uuid(3);
export const CONTROL_UUID = uuid(4);
export const DATA_UUID = uuid(5);
/** Firmware version string, e.g. "0.2.0+0c1c28b". Missing on firmware before 0.2.0. */
export const INFO_UUID = uuid(6);
export const DEVICE_NAME = 'discyboi';

export const CTRL_DOWNLOAD = 0x01;
export const CTRL_ABORT = 0x02;
export const CTRL_IDENTIFY = 0x10;

export const FLAG_ANGLES_VALID = 1 << 0;
export const FLAG_SPEED_VALID = 1 << 1;
export const FLAG_SPIN_CENTRIP = 1 << 2;
export const FLAG_LANDED = 1 << 3;
/** No truly still moment before the throw: the calmest 100 ms was the reference, so speed and angles are approximate. */
export const FLAG_REF_APPROX = 1 << 4;
/** Why speed and angles are missing: the disc was never calm enough before the pull. */
export const FLAG_NO_REF = 1 << 5;
/** Why speed and angles are missing: the integrated release velocity was implausible. */
export const FLAG_BAD_SPEED = 1 << 6;

/** Why a throw has no speed, in words. Older firmware does not say, so the likely cause is given. */
export function noSpeedReason(flags: number): string {
  if (flags & FLAG_BAD_SPEED) return 'the measured release velocity was implausible';
  return 'the disc was never held still in the 2.5 s before release';
}

export const THROW_RESULT_SIZE = 26;

/** struct throw_result, in firmware units. */
export interface ThrowResult {
  throwId: number;
  flags: number;
  spinRpm: number; // + = CCW seen from the top of the board
  speedCms: number;
  hyzerCdeg: number; // + = right edge down
  noseCdeg: number; // + = nose up
  launchCdeg: number;
  wobbleDps: number;
  peakDg: number;
  pullMs: number;
  flightMs: number;
  batteryMv: number;
}

export function parseThrowResult(dv: DataView): ThrowResult {
  if (dv.byteLength < THROW_RESULT_SIZE) throw new Error(`throw result too short: ${dv.byteLength} B`);
  return {
    throwId: dv.getUint32(0, true),
    flags: dv.getUint16(4, true),
    spinRpm: dv.getInt16(6, true),
    speedCms: dv.getUint16(8, true),
    hyzerCdeg: dv.getInt16(10, true),
    noseCdeg: dv.getInt16(12, true),
    launchCdeg: dv.getInt16(14, true),
    wobbleDps: dv.getUint16(16, true),
    peakDg: dv.getUint16(18, true),
    pullMs: dv.getUint16(20, true),
    flightMs: dv.getUint16(22, true),
    batteryMv: dv.getUint16(24, true),
  };
}

/** Inverse of parseThrowResult (used by the fake device and tests). */
export function encodeThrowResult(r: ThrowResult): DataView {
  const dv = new DataView(new ArrayBuffer(THROW_RESULT_SIZE));
  dv.setUint32(0, r.throwId, true);
  dv.setUint16(4, r.flags, true);
  dv.setInt16(6, r.spinRpm, true);
  dv.setUint16(8, r.speedCms, true);
  dv.setInt16(10, r.hyzerCdeg, true);
  dv.setInt16(12, r.noseCdeg, true);
  dv.setInt16(14, r.launchCdeg, true);
  dv.setUint16(16, r.wobbleDps, true);
  dv.setUint16(18, r.peakDg, true);
  dv.setUint16(20, r.pullMs, true);
  dv.setUint16(22, r.flightMs, true);
  dv.setUint16(24, r.batteryMv, true);
  return dv;
}

export const STATE_NAMES = ['idle', 'armed', 'pull', 'post', 'flight'] as const;
export type DeviceState = (typeof STATE_NAMES)[number] | 'unknown';

export interface DeviceStatus {
  state: DeviceState;
  downloading: boolean;
  batteryMv: number;
  throws: number;
}

export const STATUS_SIZE = 8;

export function parseStatus(dv: DataView): DeviceStatus {
  if (dv.byteLength < STATUS_SIZE) throw new Error(`status too short: ${dv.byteLength} B`);
  const s = dv.getUint8(0);
  return {
    state: STATE_NAMES[s] ?? 'unknown',
    downloading: dv.getUint8(1) !== 0,
    batteryMv: dv.getUint16(2, true),
    throws: dv.getUint32(4, true),
  };
}

export function encodeStatus(s: DeviceStatus): DataView {
  const dv = new DataView(new ArrayBuffer(STATUS_SIZE));
  dv.setUint8(0, Math.max(0, STATE_NAMES.indexOf(s.state as (typeof STATE_NAMES)[number])));
  dv.setUint8(1, s.downloading ? 1 : 0);
  dv.setUint16(2, s.batteryMv, true);
  dv.setUint32(4, s.throws, true);
  return dv;
}

// Raw capture download (Data characteristic, packet types 0x00 header / 0x01 samples / 0x02 end)
// is not used yet; see firmware/README.md "Raw download" when adding it.
