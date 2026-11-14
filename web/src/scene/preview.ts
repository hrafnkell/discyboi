/**
 * Release preview: the disc at the release pose, seen from behind (hyzer) and from the side
 * (nose + launch), with a horizon line and the flight-path direction. Small dedicated canvas,
 * rendered on demand when the release parameters change.
 */
import * as THREE from 'three';
import { initialState } from '../sim/flight';
import type { DiscSpec, ThrowParams } from '../sim/types';
import { normalize } from '../sim/vec';
import { toThree } from './coords';
import { DiscMesh } from './discMesh';

const UP = new THREE.Vector3(0, 1, 0);

export class ReleasePreview {
  readonly el: HTMLElement;
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private disc = new DiscMesh();
  private behind = new THREE.PerspectiveCamera(28, 1, 0.05, 10);
  private side = new THREE.PerspectiveCamera(28, 1, 0.05, 10);
  private arrow!: THREE.ArrowHelper;
  private normalArrow!: THREE.ArrowHelper;
  private discKey = '';
  private pending = false;

  constructor() {
    const canvas = document.createElement('canvas');
    this.el = document.createElement('div');
    this.el.className = 'preview';
    this.el.append(canvas);
    for (const [cls, txt] of [['l', 'from behind'], ['r', 'from the side']]) {
      const s = document.createElement('span');
      s.className = `pvlabel ${cls}`;
      s.textContent = txt;
      this.el.append(s);
    }
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      this.el.hidden = true;
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setScissorTest(true);

    this.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x3a4a2a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 3, 2);
    this.scene.add(sun);
    this.scene.add(this.disc.root);

    // Horizon reference: level lines through the disc centre (along and across the flight path).
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd9f0b0, transparent: true, opacity: 0.85 });
    const line = (a: THREE.Vector3, b: THREE.Vector3) => this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat));
    line(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0));
    line(new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, 2));

    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.22, 0xffb703, 0.04, 0.025);
    this.scene.add(this.arrow);
    this.normalArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 0.09, 0xffffff, 0.02, 0.012);
    this.scene.add(this.normalArrow);

    // Behind: looking downrange (screen right = thrower's right). Side: from the thrower's
    // right looking left, so downrange is screen right and nose-up tilts the right edge up.
    this.behind.position.set(-0.62, 0.05, 0);
    this.behind.lookAt(0, 0, 0);
    this.side.position.set(0.05, 0.05, 0.62);
    this.side.lookAt(0.05, 0, 0);

    new ResizeObserver(() => this.render()).observe(this.el);
  }

  update(params: ThrowParams, disc: DiscSpec) {
    if (!this.renderer) return;
    const key = `${disc.cls}|${disc.color}`;
    if (key !== this.discKey) {
      this.discKey = key;
      this.disc.setDisc(disc.cls, disc.color);
    }
    // Aim is irrelevant here: show the release relative to the flight direction.
    const s = initialState({ ...params, headingDeg: 0, speed: Math.max(params.speed, 1) });
    const n = toThree(s.n).normalize();
    this.disc.root.quaternion.setFromUnitVectors(UP, n);
    this.normalArrow.setDirection(n);
    this.arrow.setDirection(toThree(normalize(s.v)).normalize());
    this.render();
  }

  private render() {
    if (!this.renderer || this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const r = this.renderer!;
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false);
      const half = Math.floor(w / 2);
      for (const [cam, x] of [[this.behind, 0], [this.side, half]] as const) {
        cam.aspect = half / h;
        cam.updateProjectionMatrix();
        r.setViewport(x, 0, half, h);
        r.setScissor(x, 0, half, h);
        r.render(this.scene, cam);
      }
    });
  }
}
