/** Animates a simulated flight: disc pose, trail, ground shadow, landing marker, ghost paths. */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { DiscSpec, FlightResult, TrajectoryPoint } from '../sim/types';
import { toThree } from './coords';
import { DiscMesh } from './discMesh';

/** Drawn spin is slowed down: 20 rev/s would alias into a random-looking wobble at 60 fps. */
const VISUAL_SPIN = 1 / 14;
const UP = new THREE.Vector3(0, 1, 0);

export interface Pose {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
  onGround: boolean;
}

export function sampleAt(points: TrajectoryPoint[], t: number): Pose {
  let lo = 0;
  let hi = points.length - 1;
  if (t <= points[0].t) hi = 0;
  else if (t >= points[hi].t) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= t) lo = mid;
      else hi = mid;
    }
  }
  const a = points[lo];
  const b = points[hi];
  const f = hi === lo ? 0 : (t - a.t) / (b.t - a.t);
  const lerp = (x: number[], y: number[]) => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f] as [number, number, number];
  return {
    pos: toThree(lerp(a.p, b.p)),
    normal: toThree(lerp(a.n, b.n)).normalize(),
    vel: toThree(lerp(a.v, b.v)),
    phase: a.phase + (b.phase - a.phase) * f,
    onGround: f < 0.5 ? a.onGround : b.onGround,
  };
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 22, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function lineFor(points: TrajectoryPoint[], upTo: number, colorA: THREE.Color, colorB: THREE.Color): { pos: number[]; col: number[] } {
  const pos: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < upTo; i++) {
    toThree(points[i].p, v);
    pos.push(v.x, v.y + 0.01, v.z);
    c.copy(colorA).lerp(colorB, i / Math.max(points.length - 1, 1));
    col.push(c.r, c.g, c.b);
  }
  return { pos, col };
}

export class FlightView {
  readonly disc = new DiscMesh();
  readonly group = new THREE.Group();
  private trail: Line2;
  private trailMat: LineMaterial;
  private shadow: THREE.Mesh;
  private halo: THREE.Sprite;
  private landing: THREE.Mesh;
  private ghosts = new THREE.Group();
  private ghostMats: LineMaterial[] = [];
  private flight?: FlightResult;
  private trailCount = -1;
  t = 0;
  playing = false;
  rate = 1;
  onFinish?: () => void;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.disc.root, this.ghosts);
    this.trailMat = new LineMaterial({ linewidth: 3, vertexColors: true, transparent: true, opacity: 0.95, worldUnits: false });
    this.trail = new Line2(new LineGeometry(), this.trailMat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.group.add(this.shadow);

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.8 }));
    this.halo.scale.set(0.035, 0.035, 1);
    this.halo.renderOrder = 10;
    this.group.add(this.halo);

    this.landing = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.visible = false;
    this.group.add(this.landing);
  }

  setResolution(w: number, h: number) {
    this.trailMat.resolution.set(w, h);
    for (const m of this.ghostMats) m.resolution.set(w, h);
  }

  get duration() {
    return this.flight ? this.flight.points[this.flight.points.length - 1].t : 0;
  }

  get current(): FlightResult | undefined {
    return this.flight;
  }

  load(flight: FlightResult, disc: DiscSpec, autoplay = true) {
    this.flight = flight;
    this.disc.setDisc(disc.cls, disc.color);
    this.trailCount = -1;
    this.t = 0;
    this.playing = autoplay;
    this.landing.position.copy(toThree(flight.landing)).setY(0.03);
    this.landing.visible = false;
    this.update(0);
  }

  setGhosts(flights: { flight: FlightResult; color: string }[]) {
    for (const g of this.ghosts.children) (g as Line2).geometry.dispose();
    for (const m of this.ghostMats) m.dispose();
    this.ghosts.clear();
    this.ghostMats = [];
    for (const { flight, color } of flights) {
      const c = new THREE.Color(color);
      const { pos } = lineFor(flight.points, flight.points.length, c, c);
      if (pos.length < 6) continue;
      const geo = new LineGeometry();
      geo.setPositions(pos);
      const mat = new LineMaterial({ color: c.getHex(), linewidth: 1.5, transparent: true, opacity: 0.45, worldUnits: false });
      mat.resolution.copy(this.trailMat.resolution);
      this.ghostMats.push(mat);
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      this.ghosts.add(line);
    }
  }

  pose(): Pose | undefined {
    return this.flight ? sampleAt(this.flight.points, this.t) : undefined;
  }

  update(dt: number) {
    const f = this.flight;
    if (!f) return;
    if (this.playing) {
      this.t += dt * this.rate;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
        this.onFinish?.();
      }
    }
    const p = sampleAt(f.points, this.t);
    this.disc.root.position.copy(p.pos);
    this.disc.root.quaternion.setFromUnitVectors(UP, p.normal);
    this.disc.spinner.rotation.y = p.phase * VISUAL_SPIN;

    const h = p.pos.y;
    this.shadow.position.set(p.pos.x, 0.015, p.pos.z);
    const s = 0.24 + h * 0.04;
    this.shadow.scale.set(s, s, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - h / 25);
    this.halo.position.copy(p.pos).add(new THREE.Vector3(0, 0.0, 0));
    this.landing.visible = this.t >= f.flightTime;

    // Trail up to the current time (rebuilt only when the sample count changes).
    let n = 0;
    while (n < f.points.length && f.points[n].t <= this.t) n++;
    n = Math.max(n, 1);
    if (n !== this.trailCount) {
      this.trailCount = n;
      const { pos, col } = lineFor(f.points, n, new THREE.Color(0xffe66d), new THREE.Color(0xff4d6d));
      pos.push(p.pos.x, p.pos.y + 0.01, p.pos.z);
      col.push(col[col.length - 3] ?? 1, col[col.length - 2] ?? 1, col[col.length - 1] ?? 1);
      if (pos.length < 6) pos.push(pos[0], pos[1], pos[2]), col.push(col[0], col[1], col[2]);
      this.trail.geometry.dispose();
      const geo = new LineGeometry();
      geo.setPositions(pos);
      geo.setColors(col);
      this.trail.geometry = geo;
      this.trail.computeLineDistances();
    }
  }
}
