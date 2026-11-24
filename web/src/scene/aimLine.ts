/** Aim indicator for the tee view: a faint strip on the ground from the tee along the aim. */
import * as THREE from 'three';

export class AimLine {
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(38, 0.12), mat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(21, 0.03, 0);
    // Chevrons every 10 m so the direction reads at a glance.
    const chev = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.9, 0.55), new THREE.Vector2(-0.6, 0), new THREE.Vector2(-0.9, -0.55)]);
    for (let d = 10; d <= 40; d += 10) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(chev), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(d + 0.5, 0.03, 0);
      this.group.add(m);
    }
    this.group.add(strip);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Aim in degrees, + = right (three.js +z). */
  set(aimDeg: number, visible: boolean) {
    this.group.rotation.y = (-aimDeg * Math.PI) / 180;
    this.group.visible = visible;
  }
}
