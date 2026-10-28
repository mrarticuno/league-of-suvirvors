// Ability VFX: Ezreal's own particle systems (src/particles.ts, data from tools/build_vfx.py), keyed like the
// skin's ResourceResolver. Enemy skillshots are not Ezreal effects, so they keep a small hand-made look.
import * as THREE from 'three';
import { createSystem, facingQuat, loadParticles, missileQuat, type ParticleSystem } from './particles';

export const loadVfx = loadParticles;

const MISSILE: Record<string, string> = { auto: 'Ezreal_BA_mis', Q: 'Ezreal_Q_mis', W: 'Ezreal_W_mis', E: 'Ezreal_E_mis', R: 'Ezreal_R_mis' };
const HIT: Record<string, string> = { auto: 'Ezreal_BA_tar', Q: 'Ezreal_Q_tar', E: 'Ezreal_E_tar', R: 'Ezreal_R_tar', 'W-burst': 'Ezreal_W_hit' };
const CAST: Record<string, string[]> = { Q: ['Ezreal_Q_bow01'], W: ['Ezreal_W_Cas'], R: ['Ezreal_R_bow_01', 'Ezreal_R_Gauntlet_Glow'] };

/** A running system, optionally following an object (missile root, W mark) until that object leaves the scene. */
interface Live { sys: ParticleSystem; follow?: THREE.Object3D; dir?: THREE.Vector3; until?: number; killOnStop?: boolean }

export class Vfx {
  private live: Live[] = [];
  private time = 0;
  private flashes: { s: THREE.Sprite; age: number }[] = [];
  private enemyTex = new THREE.TextureLoader().load('assets/vfx/ezreal/ezreal_base_z_glow.png');
  constructor(private scene: THREE.Scene) {}

  clear() {
    for (const l of this.live) l.sys.dispose();
    for (const f of this.flashes) f.s.removeFromParent();
    this.live = [];
    this.flashes = [];
  }

  update(dt: number) {
    this.time += dt;
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      f.s.material.opacity = 1 - f.age / 0.2;
      f.s.scale.setScalar(90 * (1 + f.age * 2));
      return f.age < 0.2 || !f.s.removeFromParent();
    });
    this.live = this.live.filter((l) => {
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

  private play(key: string, at: THREE.Vector3, quat: THREE.Quaternion, extra: Partial<Live> = {}) {
    const sys = createSystem(key, this.scene, at, quat);
    // one-shot effects stop emitting after a while even if an emitter loops forever
    if (sys) this.live.push({ sys, until: extra.follow ? undefined : this.time + 3, ...extra });
    return sys;
  }

  hit(kind: string, at: THREE.Vector3, crit = false, facing = 0) {
    const p = at.clone().setY(at.y || 100);
    if (kind === 'enemy') return this.enemyFlash(p);
    const key = kind === 'auto' && crit ? 'Ezreal_BA_crit_tar' : HIT[kind];
    if (key) this.play(key, p, facingQuat(facing));
  }

  /** Arcane Shift: cast burst where Ezreal left, flash where he lands. */
  blink(from: THREE.Vector3, to: THREE.Vector3) {
    const q = facingQuat(Math.atan2(to.x - from.x, to.z - from.z));
    this.play('Ezreal_E_cas', from.clone().setY(0), q);
    this.play('Ezreal_E_Flash', to.clone().setY(0), q);
  }

  cast(key: string, at: THREE.Vector3, facing: number) {
    for (const k of CAST[key] ?? []) {
      // bow effects sit on the gauntlet hand in League; the R ones carry their own heights
      const p = key === 'R' ? at.clone().setY(0) : at.clone().add(new THREE.Vector3(Math.sin(facing) * 50, 110, Math.cos(facing) * 50));
      this.play(k, p, facingQuat(facing));
    }
  }

  /** Essence Flux mark floating on an enemy: lives while the returned object stays in the scene. */
  mark() {
    const g = new THREE.Group();
    g.userData.tick = () => {};
    this.play('Ezreal_W_tar', g.position, new THREE.Quaternion(), { follow: g, killOnStop: true });
    return g;
  }

  missile(kind: string, crit = false): MissileFx {
    const root = new THREE.Object3D();
    if (kind === 'enemy') return this.enemyMissile(root);
    const dir = new THREE.Vector3(0, 0, 1);
    const key = kind === 'auto' && crit ? 'Ezreal_BA_crit_mis' : MISSILE[kind];
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

  private enemyFlash(at: THREE.Vector3) {
    const s = this.sprite(0xff5a3a, 90);
    s.position.copy(at);
    this.scene.add(s);
    this.flashes.push({ s, age: 0 });
  }
}

export interface MissileFx {
  root: THREE.Object3D;
  update: (dt: number, dir: THREE.Vector3, travelled: number) => void;
}
