/**
 * The static world: sky, ground, tee pad, distance rings, basket, scenery.
 * Takes a Hole description so courses can be dropped in later.
 */
import * as THREE from 'three';
import type { Vec3 } from '../sim/types';
import { toThree } from './coords';
import type { Units } from '../units';
import { Label } from './labels';

export interface Obstacle {
  kind: 'tree';
  at: Vec3; // base position, sim frame
  height: number;
  radius: number;
}

export interface Hole {
  name: string;
  tee: Vec3;
  basket: Vec3;
  obstacles: Obstacle[];
}

/** Open practice field: basket at `basketDist`, a loose tree line well off the fairway. */
/** Rings across the fairway with labels, plus a centre line with ticks; in metres or feet. */
function distanceMarks(u: Units): THREE.Group {
  const g = new THREE.Group();
  // metric: rings and labels every 25 m, ticks every 5 m. imperial: every 100 ft, ticks every 20 ft.
  const [unit, major, minor, last] = u === 'imperial' ? [0.3048, 100, 20, 800] : [1, 25, 5, 250];
  const label = u === 'imperial' ? 'ft' : 'm';
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  for (let n = major; n <= last; n += major) {
    const d = n * unit;
    const arc = new THREE.Mesh(new THREE.RingGeometry(d - 0.08, d + 0.08, 96, 1, -Math.PI / 5, (2 * Math.PI) / 5), ringMat);
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.02;
    g.add(arc);
    const lab = new Label(`${n} ${label}`, d >= 100 ? 2.5 : 1.75, 0.03);
    lab.sprite.position.set(d, 0.3, -d * Math.sin(Math.PI / 5) - 2);
    g.add(lab.sprite);
  }
  const len = last * unit;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.06), ringMat);
  line.rotation.x = -Math.PI / 2;
  line.position.set(len / 2, 0.02, 0);
  g.add(line);
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  for (let n = minor; n <= last; n += minor) {
    const d = n * unit;
    const isMajor = n % major === 0;
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(isMajor ? 0.12 : 0.08, isMajor ? 2.4 : 0.9), isMajor ? tickMat : ringMat);
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(d, 0.021, 0);
    g.add(tick);
    if (isMajor) {
      const lab = new Label(`${n}`, 0.7, 0.02);
      lab.sprite.position.set(d, 0.05, 1.6); // just right of the line, clear of the flight path
      g.add(lab.sprite);
    }
  }
  return g;
}

export function practiceField(basketDist = 100): Hole {
  const rnd = mulberry32(7);
  const obstacles: Obstacle[] = [];
  for (let x = -20; x < 260; x += 6 + rnd() * 10) {
    for (const side of [1, -1]) {
      const y = side * (48 + rnd() * 40);
      obstacles.push({ kind: 'tree', at: [x + rnd() * 5, y, 0], height: 7 + rnd() * 9, radius: 2 + rnd() * 2 });
    }
  }
  for (let k = 0; k < 40; k++) {
    obstacles.push({ kind: 'tree', at: [215 + rnd() * 60, (rnd() - 0.5) * 150, 0], height: 8 + rnd() * 10, radius: 2.5 + rnd() * 2 });
  }
  return { name: 'Practice field', tee: [0, 0, 0], basket: [basketDist, 0, 0], obstacles };
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d8f3c';
  g.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(3);
  for (let i = 0; i < 26000; i++) {
    const l = 30 + rnd() * 22;
    g.fillStyle = `hsl(${88 + rnd() * 22}, ${38 + rnd() * 20}%, ${l}%)`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 1.5, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function basketMesh(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.8, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 12), metal);
  pole.position.y = 0.8;
  g.add(pole);
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.22, 24, 1, true), yellow);
  tray.position.y = 0.66;
  g.add(tray);
  const trayBottom = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), yellow);
  trayBottom.rotation.x = -Math.PI / 2;
  trayBottom.position.y = 0.55;
  g.add(trayBottom);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 32), yellow);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.36;
  g.add(band);
  const chainMat = new THREE.LineBasicMaterial({ color: 0xdfe3e8 });
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.29, 1.35, Math.sin(a) * 0.29), new THREE.Vector3(Math.cos(a + 0.6) * 0.05, 0.8, Math.sin(a + 0.6) * 0.05));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), chainMat));
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function treeMesh(height: number, radius: number, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkH = height * 0.3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.08, radius * 0.12, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 1 }),
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  const hue = 0.27 + rnd() * 0.08;
  const leaves = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.45, 0.22 + rnd() * 0.08), roughness: 0.9, flatShading: true });
  const conifer = rnd() < 0.5;
  if (conifer) {
    for (let k = 0; k < 3; k++) {
      const h = (height - trunkH) * (0.55 - k * 0.1);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * (1 - k * 0.25), h, 7), leaves);
      cone.position.y = trunkH + k * (height - trunkH) * 0.25 + h / 2;
      g.add(cone);
    }
  } else {
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), leaves);
    crown.scale.y = (height - trunkH) / (2 * radius);
    crown.position.y = trunkH + (height - trunkH) / 2;
    g.add(crown);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class World {
  readonly group = new THREE.Group();
  private holeGroup = new THREE.Group();
  private marks = {} as Record<Units, THREE.Group>;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.add(this.group);
    this.group.add(this.holeGroup);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // Sky dome with a vertical gradient, and matching fog.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x3d7fd9) }, horizon: { value: new THREE.Color(0xcfe3f2) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
    sky.renderOrder = -1;
    this.group.add(sky);
    scene.fog = new THREE.Fog(0xcfe3f2, 150, 700);

    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(-60, 120, 80);
    sun.target.position.set(80, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -140;
    sc.right = 140;
    sc.top = 140;
    sc.bottom = -140;
    sc.far = 400;
    scene.add(sun, sun.target);

    const tex = grassTexture();
    tex.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Mowed fairway stripes.
    for (let k = 0; k < 14; k++) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 50),
        new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffffff : 0x000000, transparent: true, opacity: 0.045, depthWrite: false }),
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(k * 20 + 10, 0.01, 0);
      this.group.add(stripe);
    }

    // Distance rings, centre line ticks and labels, one set per unit system; setUnits() picks one.
    for (const u of ['metric', 'imperial'] as const) {
      const g = distanceMarks(u);
      g.visible = u === 'metric';
      this.marks[u] = g;
      this.group.add(g);
    }

    // Tee pad.
    const pad = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.06, 1.6), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.95 }));
    pad.position.set(-2.5, 0.03, 0);
    pad.receiveShadow = true;
    this.group.add(pad);
  }

  /** Shows the distance markings in metres (every 25 m) or feet (every 100 ft). */
  setUnits(u: Units) {
    this.marks.metric.visible = u === 'metric';
    this.marks.imperial.visible = u === 'imperial';
  }

  setHole(hole: Hole) {
    this.holeGroup.clear();
    const b = basketMesh();
    b.position.copy(toThree(hole.basket));
    this.holeGroup.add(b);
    const rnd = mulberry32(11);
    for (const o of hole.obstacles) {
      const t = treeMesh(o.height, o.radius, rnd);
      t.position.copy(toThree(o.at));
      this.holeGroup.add(t);
    }
  }
}
