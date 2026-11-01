// Ability VFX: League particle systems (src/particles.ts, data from tools/build_vfx.py) played by key, as named by the
// champion's skin ResourceResolver; champions pass their own keys. Enemy skillshots keep a small hand-made look.
import * as THREE from 'three';
import { createSystem, facingQuat, loadItemParticles, loadParticles, missileQuat, type ParticleSystem, type SystemOpts } from './particles';
import { compact } from './util';

export const loadVfx = loadParticles;
export { loadItemParticles };

/**
 * A running system, optionally following an object (missile root, W mark) until that object leaves the scene,
 * or a bone of an animated model (cast effects at the hand or weapon), keeping its facing.
 */
interface Live { sys: ParticleSystem; follow?: THREE.Object3D; bone?: THREE.Object3D; orient?: boolean; dir?: THREE.Vector3; until?: number; killOnStop?: boolean; shot?: string }
type PlayOpts = Partial<Omit<Live, 'sys'>> & SystemOpts & { life?: number }; // life: seconds a one-shot emits (default 3)
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
// Overlapping copies of a one-shot effect (impacts on a crowd: a piercing ult, Infernum's bolts) thin out instead of
// multiplying the particle count: the first SAME_FULL copies emit everything, the n-th SAME_FULL/n of it; past
// PARTICLE_BUDGET live particles every new one-shot thins too. Every hit still shows its effect.
const SAME_FULL = 8;
const PARTICLE_BUDGET = 6000;
const BOLT_LIFE = 0.25; // seconds a lightning arc stays on screen
const BOLT_KINKS = 7; // straight segments per arc

export class Vfx {
  private live: Live[] = [];
  private time = 0;
  private shots = new Map<string, number>(); // live one-shot systems per key
  private particles = 0; // live particles, counted each update
  private flashes: { s: THREE.Sprite; age: number; size: number }[] = [];
  private bolts: { m: THREE.Mesh[]; age: number }[] = [];
  private enemyTex = glowTexture(); // drawn in code: enemy skillshots look the same for every champion
  constructor(private scene: THREE.Scene) {}

  clear() {
    for (const l of this.live) l.sys.dispose();
    for (const f of this.flashes) f.s.removeFromParent();
    for (const b of this.bolts) this.endBolt(b);
    this.live = [];
    this.flashes = [];
    this.bolts = [];
    this.shots.clear();
  }

  private end(l: Live) {
    l.sys.dispose();
    if (l.shot) this.shots.set(l.shot, this.shots.get(l.shot)! - 1);
    return false;
  }

  update(dt: number) {
    this.time += dt;
    compact(this.flashes, (f) => {
      f.age += dt;
      f.s.material.opacity = 1 - f.age / 0.2;
      f.s.scale.setScalar(f.size * (1 + f.age * 2));
      return f.age < 0.2 || !f.s.removeFromParent();
    });
    compact(this.bolts, (b) => {
      b.age += dt;
      for (const m of b.m) (m.material as THREE.MeshBasicMaterial).opacity = (m.userData.alpha as number) * (1 - b.age / BOLT_LIFE);
      return b.age < BOLT_LIFE || this.endBolt(b);
    });
    compact(this.live, (l) => {
      if (l.follow) {
        if (!l.follow.parent) {
          if (l.killOnStop) return this.end(l);
          l.sys.kill(); // the followed object (missile) is gone: only lingering particles stay
        }
        else {
          l.sys.setFrame(l.follow.position, l.dir ? missileQuat(l.dir, _q) : l.sys.frameQuat);
          l.sys.scale = l.follow.scale.x; // scaling the followed object scales its effect (a growing area)
        }
      }
      // `orient`: the system turns with the bone too (offsets authored along it, e.g. flames running down a blade)
      if (l.bone) l.sys.setFrame(l.bone.getWorldPosition(_p), l.orient ? l.bone.getWorldQuaternion(_q) : l.sys.frameQuat);
      if (l.until !== undefined && this.time >= l.until) l.sys.stop();
      l.sys.update(dt);
      if (!l.sys.done) return true;
      return this.end(l);
    });
    let n = 0;
    for (const l of this.live) n += l.sys.particleCount;
    this.particles = n;
  }

  play(key: string, at: THREE.Vector3, quat: THREE.Quaternion, { owner, size, target, targetQuat, bind, duration, life = 3, ...extra }: PlayOpts = {}) {
    const sys = createSystem(key, this.scene, at, quat, { owner, size, target, targetQuat, bind, duration });
    // one-shot effects stop emitting after a while even if an emitter loops forever
    if (!sys) return sys;
    const live: Live = { sys, until: extra.follow ? undefined : this.time + life, ...extra };
    sys.persistent = live.until === undefined;
    if (live.until !== undefined && !live.bone) { // short-lived and free-standing: marks, glows and missiles keep full density
      const same = (this.shots.get(key) ?? 0) + 1;
      this.shots.set(key, same);
      live.shot = key;
      sys.density = Math.min(1, SAME_FULL / same, PARTICLE_BUDGET / Math.max(PARTICLE_BUDGET, this.particles));
    }
    this.live.push(live);
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

  /** A system that follows the returned object (e.g. a mark over an enemy) while it stays in the scene; its scale.x scales the effect. */
  attach(key: string, opts?: SystemOpts) {
    const g = new THREE.Group();
    this.play(key, g.position, new THREE.Quaternion(), { follow: g, killOnStop: true, ...opts });
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

  enemyHit(at: THREE.Vector3) { this.flash(at, 0xff5a3a, 90); }

  private flash(at: THREE.Vector3, color: number, size: number) {
    const s = this.sprite(color, size);
    s.position.copy(at).setY(at.y || 100);
    this.scene.add(s);
    this.flashes.push({ s, age: 0, size });
  }

  // ---- item procs (hand-made: only the champion's particle systems are loaded) ----

  /** Jagged lightning arc from `a` to `b` at hit height, with a spark at the struck end (Statikk Shiv's chain). */
  bolt(a: THREE.Vector3, b: THREE.Vector3, color = 0x9fd8ff) {
    const from = a.clone().setY(a.y || 100), to = b.clone().setY(b.y || 100);
    const path = new THREE.CurvePath<THREE.Vector3>();
    let prev = from;
    for (let i = 1; i <= BOLT_KINKS; i++) {
      const p = from.clone().lerp(to, i / BOLT_KINKS);
      if (i < BOLT_KINKS) p.add(new THREE.Vector3((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 50));
      path.add(new THREE.LineCurve3(prev, p));
      prev = p;
    }
    const tube = (radius: number, c: number, alpha: number) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(path, BOLT_KINKS * 4, radius, 5),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: alpha, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.userData.alpha = alpha;
      this.scene.add(m);
      return m;
    };
    this.bolts.push({ m: [tube(5, 0xffffff, 1), tube(16, color, 0.45)], age: 0 });
    this.flash(to, color, 110);
  }

  private endBolt(b: { m: THREE.Mesh[] }) {
    for (const m of b.m) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    return false;
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
