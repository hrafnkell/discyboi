/** Camera rigs: chase, tee, side, top-down, free orbit. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Pose } from './playback';

export type CamMode = 'chase' | 'tee' | 'side' | 'top' | 'free';
export const CAM_MODES: { id: CamMode; label: string }[] = [
  { id: 'chase', label: 'Chase' },
  { id: 'tee', label: 'Tee' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
  { id: 'free', label: 'Free' },
];

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CamMode = 'chase';
  private look = new THREE.Vector3(10, 1, 0);
  private dir = new THREE.Vector3(1, 0, 0);

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
    this.camera.position.set(-4, 2.2, 0.6);
    this.controls = new OrbitControls(this.camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.maxPolarAngle = Math.PI / 2 - 0.02;
    c.minDistance = 0.4;
    c.maxDistance = 400;
    c.zoomSpeed = 1.6;
    c.rotateSpeed = 0.8;
    c.zoomToCursor = false;
    c.screenSpacePanning = true;
    c.enabled = false;
  }

  /** Free view orbits the disc and follows it: drag = rotate, wheel/pinch = zoom, right-drag = pan. */
  setMode(mode: CamMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      const target = this.lastPose ?? this.look;
      this.controls.target.copy(target);
      // Start from a sensible distance rather than wherever the previous rig left the camera.
      const off = this.camera.position.clone().sub(target);
      if (off.length() > 30 || off.length() < 0.5) off.setLength(6);
      off.y = Math.max(off.y, 1.5);
      this.camera.position.copy(target).add(off);
      this.followFrom = target.clone();
    }
  }

  private lastPose?: THREE.Vector3;
  private followFrom?: THREE.Vector3;

  reset() {
    this.dir.set(1, 0, 0);
    this.look.set(10, 1, 0);
  }

  update(pose: Pose | undefined, dt: number) {
    const cam = this.camera;
    const k = 1 - Math.exp(-dt * 4);
    const p = pose?.pos ?? new THREE.Vector3(0, 1.4, 0);
    if (pose) this.lastPose = pose.pos.clone();
    if (this.mode === 'free') {
      // Carry camera and target along with the disc so the orbit stays centred on it.
      if (pose && this.followFrom) {
        const d = pose.pos.clone().sub(this.followFrom);
        this.controls.target.add(d);
        cam.position.add(d);
        cam.position.y = Math.max(cam.position.y, 0.2);
      }
      this.followFrom = pose ? pose.pos.clone() : this.followFrom;
      this.controls.update();
      this.look.copy(this.controls.target);
      return;
    }
    if (pose) {
      const vh = new THREE.Vector3(pose.vel.x, 0, pose.vel.z);
      if (vh.lengthSq() > 1) this.dir.lerp(vh.normalize(), 1 - Math.exp(-dt * 1.5)).normalize();
    }
    const want = new THREE.Vector3();
    const target = p.clone();
    switch (this.mode) {
      case 'chase':
        want.copy(p).addScaledVector(this.dir, -2.6).add(new THREE.Vector3(0, 0.75, 0));
        want.y = Math.max(want.y, 0.5);
        target.addScaledVector(this.dir, 3);
        break;
      case 'tee':
        want.set(-6, 2.0, 0.8);
        break;
      case 'side':
        want.set(p.x - 5, 3, 45);
        target.set(p.x + 8, Math.max(p.y * 0.6, 1), p.z * 0.3);
        break;
      case 'top':
        want.set(p.x, 70, p.z);
        target.set(p.x, 0, p.z);
        break;
    }
    // Top view: downrange is screen-up (a straight-down lookAt needs an explicit up vector).
    cam.up.set(this.mode === 'top' ? 1 : 0, this.mode === 'top' ? 0 : 1, 0);
    if (this.mode === 'tee') cam.position.copy(want);
    else cam.position.lerp(want, this.mode === 'chase' ? 1 - Math.exp(-dt * 6) : k);
    this.look.lerp(target, this.mode === 'tee' ? 1 - Math.exp(-dt * 8) : k);
    cam.lookAt(this.look);
  }
}
