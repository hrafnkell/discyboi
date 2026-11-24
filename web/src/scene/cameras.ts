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
    this.bindDrag(dom);
  }

  /**
   * Tee view: dragging sideways turns the aim. Called with the change in degrees, + = right
   * (screen sense); main.ts applies it to the throw panel and passes the new aim back via `aimDeg`.
   */
  onAim?: (deltaDeg: number) => void;
  /** Current aim, degrees, + = right. The tee camera stands behind the tee looking along it. */
  aimDeg = 0;
  /** Tee view looks down the aim line (set by an aim drag) instead of at the disc, until the next throw. */
  private aimLook = false;

  /** Chase / side: orbit around the disc (yaw about vertical, pitch = change in elevation), radians. */
  private orbit: Partial<Record<CamMode, { yaw: number; pitch: number }>> = { chase: { yaw: 0, pitch: 0 }, side: { yaw: 0, pitch: 0 } };
  /** Top view: how far the map has been dragged, in three.js metres (x, z). */
  private topPan = new THREE.Vector3();

  /** One-finger / mouse drag for the scripted rigs. Free view leaves it to OrbitControls. */
  private bindDrag(dom: HTMLElement) {
    const down = new Map<number, { x: number; y: number }>();
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode === 'free') return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      const last = down.get(e.pointerId);
      if (!last || this.mode === 'free') return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;
      if (down.size !== 1) return; // two fingers: pinch zoom (bindZoom)
      this.drag(dx, dy, dom.clientWidth || 1, dom.clientHeight || 1);
    });
    const up = (e: PointerEvent) => down.delete(e.pointerId);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('contextmenu', (e) => this.mode !== 'free' && e.preventDefault());
    // Double click / double tap: back to this view's default framing.
    dom.addEventListener('dblclick', () => this.resetView());
  }

  private drag(dx: number, dy: number, w: number, h: number) {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const radPerPx = vfov / h;
    switch (this.mode) {
      case 'chase':
      case 'side': {
        const o = this.orbit[this.mode]!;
        o.yaw -= dx * radPerPx * 1.6;
        o.pitch = Math.min(1.3, Math.max(-0.6, o.pitch + dy * radPerPx * 1.6));
        break;
      }
      case 'top': {
        // Move the ground with the finger: screen px -> metres at the ground plane.
        const m = (2 * this.camera.position.y * Math.tan(vfov / 2)) / h;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const upv = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
        this.topPan.addScaledVector(right, -dx * m).addScaledVector(upv, dy * m);
        this.topPan.y = 0;
        break;
      }
      case 'tee': {
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (w / h));
        this.aimLook = true;
        this.onAim?.((dx / w) * ((hfov * 180) / Math.PI));
        break;
      }
    }
  }

  /** Undo drags and zoom for the current view. */
  resetView() {
    if (this.mode === 'free') return;
    const o = this.orbit[this.mode];
    if (o) o.yaw = o.pitch = 0;
    if (this.mode === 'top') this.topPan.set(0, 0, 0);
    if (this.zoom[this.mode] !== undefined) this.zoom[this.mode] = 1;
    if (this.mode === 'tee') this.aimLook = false;
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

  /** New throw or replay: re-centre. Orbit, top-view pan and zoom are kept: they're the user's framing. */
  reset() {
    const a = (this.aimDeg * Math.PI) / 180;
    this.dir.set(Math.cos(a), 0, Math.sin(a));
    this.look.set(10, 1, 0);
    this.panOffset.set(0, 0, 0);
    this.aimLook = false;
  }

  /** Rotate `off` (camera minus pivot) about the vertical by yaw and tilt its elevation by pitch. */
  private static orbitOffset(off: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
    const r = off.length();
    if (r < 1e-6) return off;
    const az = Math.atan2(off.z, off.x) - yaw;
    const el = Math.min(1.45, Math.max(0.03, Math.asin(off.y / r) + pitch));
    return off.set(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
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
        const o = this.orbit.chase!;
        const off = new THREE.Vector3().addScaledVector(this.dir, -2.6 * z).add(new THREE.Vector3(0, 0.75 * Math.sqrt(z), 0));
        want.copy(p).add(CameraRig.orbitOffset(off, o.yaw, o.pitch));
        want.y = Math.max(want.y, 0.3);
        // Look a little ahead of the disc when behind it; straight at it once orbited round.
        target.addScaledVector(this.dir, 3 * Math.max(0, Math.cos(o.yaw)));
        break;
      }
      case 'tee': {
        // Stand behind the tee on the aim line. Aim + = right, which is +z in three.js.
        const a = (this.aimDeg * Math.PI) / 180;
        const f = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        want.copy(f).multiplyScalar(-6).addScaledVector(r, 0.8).setY(2.0);
        if (this.aimLook) target.copy(f).multiplyScalar(30).setY(1);
        break;
      }
      case 'side': {
        const z = this.zoom.side!;
        const o = this.orbit.side!;
        target.set(p.x + 8, Math.max(p.y * 0.6, 1), p.z * 0.3);
        const off = new THREE.Vector3(p.x - 5 * z, 3 * z, 45 * z).sub(target);
        want.copy(target).add(CameraRig.orbitOffset(off, o.yaw, o.pitch));
        break;
      }
      case 'top':
        want.set(p.x + this.topPan.x, 70 * this.zoom.top!, p.z + this.topPan.z);
        target.set(p.x + this.topPan.x, 0, p.z + this.topPan.z);
        break;
    }
    // Top view: downrange is screen-up (a straight-down lookAt needs an explicit up vector).
    cam.up.set(this.mode === 'top' ? 1 : 0, this.mode === 'top' ? 0 : 1, 0);
    if (this.mode === 'tee') cam.position.lerp(want, 1 - Math.exp(-dt * 12));
    else cam.position.lerp(want, this.mode === 'chase' ? 1 - Math.exp(-dt * 6) : k);
    this.look.lerp(target, this.mode === 'tee' ? 1 - Math.exp(-dt * 8) : k);
    cam.lookAt(this.look);
  }
}
