/** Disc golf disc as a lathe: flight plate dome, rim shaped by class, a stamp so spin is visible. */
import * as THREE from 'three';
import type { DiscClass } from '../sim/types';

interface Profile {
  r: number; // outer radius, m
  rimW: number; // rim width (horizontal)
  h: number; // total height
  dome: number; // flight plate dome height
  edge: number; // 0 = sharp wing, 1 = blunt
}

const PROFILES: Record<DiscClass, Profile> = {
  putter: { r: 0.106, rimW: 0.011, h: 0.021, dome: 0.003, edge: 1 },
  midrange: { r: 0.1075, rimW: 0.012, h: 0.019, dome: 0.002, edge: 0.7 },
  fairway: { r: 0.106, rimW: 0.017, h: 0.016, dome: 0.0025, edge: 0.4 },
  driver: { r: 0.1055, rimW: 0.022, h: 0.0145, dome: 0.003, edge: 0.15 },
};

function lathePoints(p: Profile): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const top = p.h;
  // Top surface from the centre outwards (dome), then the shoulder and the edge.
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * (p.r - 0.006);
    const y = top - p.dome * (x / p.r) ** 2;
    pts.push(new THREE.Vector2(x, y));
  }
  const shoulderY = top - p.dome;
  const edgeY = shoulderY - p.h * (0.35 + 0.15 * p.edge);
  const edgeR = 0.0045 * (0.4 + 0.6 * p.edge);
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(p.r - edgeR + Math.sin(a) * edgeR, shoulderY - edgeR + Math.cos(a) * edgeR));
  }
  pts.push(new THREE.Vector2(p.r, edgeY));
  // Underside of the wing curving into the rim bottom.
  const bottom = 0;
  const innerR = p.r - p.rimW;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(p.r - (p.rimW * 0.75) * Math.pow(t, 1 + p.edge), edgeY - (edgeY - bottom) * Math.sin((t * Math.PI) / 2)));
  }
  pts.push(new THREE.Vector2(innerR, bottom + 0.002));
  pts.push(new THREE.Vector2(innerR - 0.001, shoulderY - 0.004));
  // Underside of the flight plate back to the axis.
  pts.push(new THREE.Vector2(innerR - 0.004, top - p.dome - 0.0025));
  pts.push(new THREE.Vector2(0, top - 0.0025));
  // Lathe expects the profile ordered; reverse so normals face outwards.
  return pts.reverse();
}

function stampTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  // Hot stamp: an off-centre arc + a bar, so rotation reads clearly.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(128, 128, 70, -0.6, 1.4);
  g.stroke();
  g.fillStyle = 'rgba(20,20,30,0.75)';
  g.fillRect(118, 30, 20, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Object whose +y is the disc normal; spin by rotating `spinner` about y. */
export class DiscMesh {
  readonly root = new THREE.Group();
  readonly spinner = new THREE.Group();
  private body?: THREE.Mesh;
  private cap?: THREE.Mesh;

  constructor() {
    this.root.add(this.spinner);
  }

  setDisc(cls: DiscClass, color: string) {
    this.body?.geometry.dispose();
    this.cap?.geometry.dispose();
    this.spinner.clear();
    const p = PROFILES[cls];
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
    const geo = new THREE.LatheGeometry(lathePoints(p), 64);
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;
    this.spinner.add(this.body);
    const capR = p.r - 0.012;
    // Domed stamp: a subdivided ring following the flight plate, slightly proud of it.
    const capGeo = new THREE.RingGeometry(0.0005, capR, 48, 8);
    capGeo.rotateX(-Math.PI / 2);
    const pos = capGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getZ(i));
      pos.setY(i, p.h - p.dome * (rr / p.r) ** 2 + 0.0003);
    }
    capGeo.computeVertexNormals();
    const cap = new THREE.Mesh(
      capGeo,
      new THREE.MeshPhysicalMaterial({ map: stampTexture(color), roughness: 0.35, clearcoat: 0.6 }),
    );
    this.cap = cap;
    this.spinner.add(cap);
    this.spinner.position.y = -p.h / 2;
  }
}
