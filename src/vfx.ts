// Ability VFX: League particle systems (src/particles.ts, data from tools/build_vfx.py) played by key, as named by the
// champion's skin ResourceResolver; champions pass their own keys. Enemy skillshots keep a small hand-made look.
import * as THREE from 'three';
import { createSystem, facingQuat, loadParticles, missileQuat, type ParticleSystem } from './particles';
import { compact, IMG } from './util';

export const loadVfx = loadParticles;

/** A running system, optionally following an object (missile root, W mark) until that object leaves the scene. */
interface Live { sys: ParticleSystem; follow?: THREE.Object3D; dir?: THREE.Vector3; until?: number; killOnStop?: boolean }

export class Vfx {
  private live: Live[] = [];
  private time = 0;
  private flashes: { s: THREE.Sprite; age: number }[] = [];
  private enemyTex = new THREE.TextureLoader().load(`assets/vfx/ezreal/ezreal_base_z_glow.${IMG}`);
  constructor(private scene: THREE.Scene) {}

  clear() {
    for (const l of this.live) l.sys.dispose();
    for (const f of this.flashes) f.s.removeFromParent();
    this.live = [];
    this.flashes = [];
  }

  update(dt: number) {
    this.time += dt;
    compact(this.flashes, (f) => {
      f.age += dt;
      f.s.material.opacity = 1 - f.age / 0.2;
      f.s.scale.setScalar(90 * (1 + f.age * 2));
      return f.age < 0.2 || !f.s.removeFromParent();
    });
    compact(this.live, (l) => {
      if (l.follow) {
        if (!l.follow.parent) {
          if (l.killOnStop) { l.sys.dispose(); return false; }
          l.sys.stop();
        }
        else l.sys.setFrame(l.follow.position, l.dir ? missileQuat(l.dir, l.sys.quat) : l.sys.quat);
      }
      if (l.until !== undefined && this.time >= l.until) l.sys.stop();
      l.sys.update(dt);
      if (!l.sys.done) return true;
      l.sys.dispose();
      return false;
    });
  }

  play(key: string, at: THREE.Vector3, quat: THREE.Quaternion, extra: Partial<Live> = {}) {
    const sys = createSystem(key, this.scene, at, quat);
    // one-shot effects stop emitting after a while even if an emitter loops forever
    if (sys) this.live.push({ sys, until: extra.follow ? undefined : this.time + 3, ...extra });
    return sys;
  }

  /** One-shot system at `at`, turned to `facing` (radians around Y). */
  playAt(key: string, at: THREE.Vector3, facing = 0) { this.play(key, at, facingQuat(facing)); }

  /** Impact effect; a zero height means the default hit height. */
  hit(key: string, at: THREE.Vector3, facing = 0) {
    this.playAt(key, at.clone().setY(at.y || 100), facing);
  }

  /** A system that follows the returned object (e.g. a mark over an enemy) while it stays in the scene. */
  attach(key: string) {
    const g = new THREE.Group();
    this.play(key, g.position, new THREE.Quaternion(), { follow: g, killOnStop: true });
    return g;
  }

  /** Missile visual; `key` null gives the hostile (enemy) look. */
  missile(key: string | null): MissileFx {
    const root = new THREE.Object3D();
    if (key === null) return this.enemyMissile(root);
    const dir = new THREE.Vector3(0, 0, 1);
    let started = false;
    return {
      root,
      update: (_dt, d) => {
        dir.copy(d);
        // created on the first update, once the game has placed the missile
        if (!started) { started = true; this.play(key, root.position, missileQuat(dir), { follow: root, dir }); }
      },
    };
  }

  // ---- enemy skillshots (hand-made) ----

  private sprite(color: number, size: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.enemyTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size);
    return s;
  }

  private enemyMissile(root: THREE.Object3D): MissileFx {
    root.add(this.sprite(0xff5a3a, 70), this.sprite(0xff3020, 130));
    return { root, update: () => {} };
  }

  enemyHit(at: THREE.Vector3) {
    const s = this.sprite(0xff5a3a, 90);
    s.position.copy(at).setY(at.y || 100);
    this.scene.add(s);
    this.flashes.push({ s, age: 0 });
  }
}

export interface MissileFx {
  root: THREE.Object3D;
  update: (dt: number, dir: THREE.Vector3, travelled: number) => void;
}
