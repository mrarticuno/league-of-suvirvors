// Telegraphed boss abilities (ground markers that fill up, then resolve) and short ground eruptions.
import * as THREE from 'three';
import { compact } from './util';

export const circleGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
export const lineGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5); // starts at origin, runs along +Z
// sector centred on +Z (the facing convention: rotation.y = atan2(dx, dz))
export const coneGeo = (arc: number) => new THREE.CircleGeometry(1, 32, Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2).rotateY(Math.PI);
export const spikeGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);

/** The ground marker fills up over `cast` seconds, then `fire` resolves it. */
interface Hazard { mesh: THREE.Object3D; fill: THREE.Object3D; line: boolean; t: number; cast: number; fire: () => void }
/** Short-lived visual (tentacle bursting out of the ground, knock-up eruption). */
interface Effect { mesh: THREE.Mesh; age: number; life: number; height: number }

export class Hazards {
  private hazards: Hazard[] = [];
  private effects: Effect[] = [];
  constructor(private scene: THREE.Scene) {}

  /**
   * Ground marker: outline at full size plus a fill that grows until the ability resolves (like LoL indicators).
   * `size` is the radius (circle/cone) or length (line); `width` is the line width.
   */
  telegraph(at: THREE.Vector3, geo: THREE.BufferGeometry, size: number, rotation: number, cast: number, color: number, fire: () => void, width = size) {
    const mesh = new THREE.Group();
    const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    mesh.add(outline, fill);
    mesh.scale.set(width, 1, size);
    mesh.rotation.y = rotation;
    mesh.position.set(at.x, 4, at.z);
    fill.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.hazards.push({ mesh, fill, line: geo === lineGeo, t: 0, cast, fire });
  }

  spike(at: THREE.Vector3, radius: number, height: number, color: number) {
    const mesh = new THREE.Mesh(spikeGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(at.x, 0, at.z);
    mesh.scale.set(radius, 0.01, radius);
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.6, height });
  }

  /** `armed`: resolved markers only fire while the target can be hit (alive, not in stasis). */
  update(dt: number, armed: boolean) {
    compact(this.hazards, (h) => {
      h.t += dt;
      const k = Math.min(1, h.t / h.cast);
      if (h.line) h.fill.scale.set(1, 1, k); // lines fill along their length
      else h.fill.scale.set(k, 1, k);
      if (h.t < h.cast) return true;
      dispose(h.mesh);
      if (armed) h.fire();
      return false;
    });
    compact(this.effects, (f) => {
      f.age += dt;
      const k = f.age / f.life;
      f.mesh.scale.y = f.height * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - Math.max(0, k * 2 - 1);
      if (k < 1) return true;
      dispose(f.mesh);
      return false;
    });
  }

  clear() {
    for (const h of this.hazards) dispose(h.mesh);
    for (const f of this.effects) dispose(f.mesh);
    this.hazards.length = 0;
    this.effects.length = 0;
  }
}

/** Removes a marker and frees its own materials (geometries are shared). */
function dispose(o: THREE.Object3D) {
  o.removeFromParent();
  o.traverse((x) => ((x as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
}
