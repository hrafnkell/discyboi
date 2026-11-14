/**
 * Text labels as camera-facing sprites that stay readable when zoomed out: each label has a
 * world-space height, but never shrinks below a minimum angular size (`minAngle`, label height
 * per metre of camera distance). Call `updateLabels(camera)` once per frame.
 */
import * as THREE from 'three';

export interface LabelLine {
  text: string;
  size?: number; // relative font size, 1 = main line
  color?: string;
}

interface Entry {
  sprite: THREE.Sprite;
  height: number;
  minAngle: number;
  aspect: number;
  fixed: boolean; // constant on-screen size (height ignored)
  ground: boolean; // grow only when seen from above, so far labels don't pile up at a low horizon
}

const live = new Set<Entry>();
const PX = 64; // font px for size 1

function draw(canvas: HTMLCanvasElement, lines: LabelLine[]): number {
  const g = canvas.getContext('2d')!;
  const font = (l: LabelLine) => `600 ${Math.round(PX * (l.size ?? 1))}px system-ui, sans-serif`;
  let w = 0;
  let hgt = 0;
  for (const l of lines) {
    g.font = font(l);
    w = Math.max(w, g.measureText(l.text).width);
    hgt += PX * (l.size ?? 1) * 1.15;
  }
  const pad = 14;
  canvas.width = Math.ceil(w + 2 * pad);
  canvas.height = Math.ceil(hgt + 2 * pad);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let y = pad;
  for (const l of lines) {
    const lh = PX * (l.size ?? 1) * 1.15;
    g.font = font(l);
    g.lineWidth = 10 * (l.size ?? 1);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(l.text, canvas.width / 2, y + lh / 2);
    g.fillStyle = l.color ?? '#ffffff';
    g.fillText(l.text, canvas.width / 2, y + lh / 2);
    y += lh;
  }
  return canvas.width / canvas.height;
}

export class Label {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private entry: Entry;

  /** `height` is the label's height in metres when close; `minAngle` keeps it readable far away. */
  constructor(lines: LabelLine[] | string, height: number, minAngle = 0.03, opts: { onTop?: boolean; fixed?: boolean } = {}) {
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, depthTest: !opts.onTop });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.center.set(0.5, 0); // anchored at the bottom: the position is the point labelled
    if (opts.onTop) this.sprite.renderOrder = 20;
    this.entry = { sprite: this.sprite, height, minAngle, aspect: 1, fixed: !!opts.fixed, ground: !opts.onTop };
    this.set(lines);
    live.add(this.entry);
  }

  set(lines: LabelLine[] | string) {
    const ls = typeof lines === 'string' ? [{ text: lines }] : lines;
    this.entry.aspect = draw(this.canvas, ls);
    const mat = this.sprite.material;
    mat.map!.dispose();
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  dispose() {
    live.delete(this.entry);
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}

const tmp = new THREE.Vector3();
export function updateLabels(camera: THREE.Camera) {
  for (const e of live) {
    if (!e.sprite.visible) continue;
    e.sprite.getWorldPosition(tmp);
    const d = camera.position.distanceTo(tmp);
    const look = e.ground ? Math.min(1, Math.max(0, ((camera.position.y - tmp.y) / Math.max(d, 1e-3)) * 4)) : 1;
    const h = e.fixed ? d * e.minAngle : Math.max(e.height, d * e.minAngle * look);
    e.sprite.scale.set(h * e.aspect, h, 1);
  }
}
