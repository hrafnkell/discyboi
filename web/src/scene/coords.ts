import { Vector3 } from 'three';
import type { Vec3 } from '../sim/types';

/**
 * Simulator frame: x downrange, y left, z up. three.js: y up. Mapping (right-handed):
 * three = (x, z, −y), so +x is still downrange and screen-right (looking downrange) is sim right.
 */
export const toThree = (v: Vec3, out = new Vector3()): Vector3 => out.set(v[0], v[2], -v[1]);
export const fromThree = (v: Vector3): Vec3 => [v.x, -v.z, v.y];
