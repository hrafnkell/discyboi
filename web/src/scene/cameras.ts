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
    c.minPolarAngle = 0.05;
    c.enablePan = true; // right drag / two-finger drag; the pan offset then rides along with the disc
    c.screenSpacePanning = true;
    c.enabled = false;
    this.bindZoom(dom);
  }

  /** Per-mode zoom for the scripted rigs (free view uses OrbitControls' own dolly). 1 = default framing. */
  private zoom: Partial<Record<CamMode, number>> = { chase: 1, side: 1, top: 1 };
  private static ZOOM_RANGE: Partial<Record<CamMode, [number, number]>> = { chase: [0.35, 8], side: [0.3, 4], top: [0.15, 5] };

  private zoomBy(f: number) {
    const r = CameraRig.ZOOM_RANGE[this.mode];
    if (!r || this.zoom[this.mode] === undefined) return;
    this.zoom[this.mode] = Math.min(r[1], Math.max(r[0], this.zoom[this.mode]! * f));
  }

  private bindZoom(dom: HTMLElement) {
    dom.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'free' || !CameraRig.ZOOM_RANGE[this.mode]) return;
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomBy(Math.exp(dy * 0.0015));
      },
      { passive: false },
    );
    // Pinch zoom on touch screens.
    const pts = new Map<number, { x: number; y: number }>();
    let last = 0;
    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) last = spread();
    });
    dom.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2 || this.mode === 'free') return;
      const d = spread();
      if (last > 0 && d > 0) this.zoomBy(last / d);
      last = d;
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      last = 0;
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
  }

  /** Free view orbits the disc and follows it: left drag = rotate, right drag = pan, wheel/pinch = zoom. */
  setMode(mode: CamMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      // The top view leaves cam.up pointing downrange; OrbitControls needs +Y or every drag rolls the view.
      this.camera.up.set(0, 1, 0);
      const target = this.lastPose ?? this.look;
      this.panOffset.set(0, 0, 0);
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
  /** Free view: how far the user has panned the pivot away from the disc. */
  private panOffset = new THREE.Vector3();

  reset() {
    this.dir.set(1, 0, 0);
    this.look.set(10, 1, 0);
    this.panOffset.set(0, 0, 0);
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
        cam.position.add(d);
        this.controls.target.copy(pose.pos).add(this.panOffset); // pivot on the disc, plus any pan
        cam.position.y = Math.max(cam.position.y, 0.2);
      }
      this.followFrom = pose ? pose.pos.clone() : this.followFrom;
      this.controls.update();
      if (this.followFrom) this.panOffset.copy(this.controls.target).sub(this.followFrom);
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
      case 'chase': {
        const z = this.zoom.chase!;
        want.copy(p).addScaledVector(this.dir, -2.6 * z).add(new THREE.Vector3(0, 0.75 * Math.sqrt(z), 0));
        want.y = Math.max(want.y, 0.5);
        target.addScaledVector(this.dir, 3);
        break;
      }
      case 'tee':
        want.set(-6, 2.0, 0.8);
        break;
      case 'side':
        want.set(p.x - 5 * this.zoom.side!, 3 * this.zoom.side!, 45 * this.zoom.side!);
        target.set(p.x + 8, Math.max(p.y * 0.6, 1), p.z * 0.3);
        break;
      case 'top':
        want.set(p.x, 70 * this.zoom.top!, p.z);
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
