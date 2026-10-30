// Ability VFX: League particle systems (src/particles.ts, data from tools/build_vfx.py) played by key, as named by the
// champion's skin ResourceResolver; champions pass their own keys. Enemy skillshots keep a small hand-made look.
import * as THREE from 'three';
import { createSystem, facingQuat, loadParticles, missileQuat, type ParticleSystem, type SystemOpts } from './particles';
import { compact } from './util';

export const loadVfx = loadParticles;

/**
 * A running system, optionally following an object (missile root, W mark) until that object leaves the scene,
 * or a bone of an animated model (cast effects at the hand or weapon), keeping its facing.
 */
interface Live { sys: ParticleSystem; follow?: THREE.Object3D; bone?: THREE.Object3D; dir?: THREE.Vector3; until?: number; killOnStop?: boolean }
type PlayOpts = Partial<Omit<Live, 'sys'>> & SystemOpts;
const _p = new THREE.Vector3();

export class Vfx {
  private live: Live[] = [];
  private time = 0;
  private flashes: { s: THREE.Sprite; age: number }[] = [];
  private enemyTex = glowTexture(); // drawn in code: enemy skillshots look the same for every champion
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
          l.sys.kill(); // the followed object (missile) is gone: only lingering particles stay
        }
        else l.sys.setFrame(l.follow.position, l.dir ? missileQuat(l.dir, l.sys.quat) : l.sys.quat);
      }
      if (l.bone) l.sys.setFrame(l.bone.getWorldPosition(_p), l.sys.quat);
      if (l.until !== undefined && this.time >= l.until) l.sys.stop();
      l.sys.update(dt);
      if (!l.sys.done) return true;
      l.sys.dispose();
      return false;
    });
  }

  play(key: string, at: THREE.Vector3, quat: THREE.Quaternion, { owner, size, ...extra }: PlayOpts = {}) {
    const sys = createSystem(key, this.scene, at, quat, { owner, size });
    // one-shot effects stop emitting after a while even if an emitter loops forever
    if (sys) this.live.push({ sys, until: extra.follow ? undefined : this.time + 3, ...extra });
    return sys;
  }

  /** One-shot system at `at`, turned to `facing` (radians around Y). */
  playAt(key: string, at: THREE.Vector3, facing = 0, opts?: SystemOpts) { this.play(key, at, facingQuat(facing), opts); }

  /** One-shot system riding a bone (`Actor.bone`), turned to `facing`; `owner` is the model it belongs to. */
  playOn(key: string, bone: THREE.Object3D, facing: number, owner?: THREE.Object3D) {
    this.play(key, bone.getWorldPosition(new THREE.Vector3()), facingQuat(facing), { bone, owner });
  }

  /** Impact effect; a zero height means the default hit height. `opts.size` scales FlexShape emitters to the target. */
  hit(key: string, at: THREE.Vector3, facing = 0, opts?: SystemOpts) {
    this.playAt(key, at.clone().setY(at.y || 100), facing, opts);
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

/** Soft white radial glow, tinted by the sprite colour. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export interface MissileFx {
  root: THREE.Object3D;
  update: (dt: number, dir: THREE.Vector3, travelled: number) => void;
}
