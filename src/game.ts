import * as THREE from 'three';
import { Actor, loadModel } from './assets';
import {
  BARON, DIRECTOR, DRAGONS, ENEMIES, ENEMY_ARMOR, ENEMY_MISSILE_EXTRA_RANGE, EVENTS, enemyArmorScale, enemyDamageScale, enemyHpScale, EZREAL, HORDE,
  MAX_CHAMPION_LEVEL, MAX_ENEMIES, POOL, RUN_LENGTH, SKILL_KEYS, xpToNext, type EnemyDef, type SkillKey,
} from './data';
import { BLUEPRINT_CHANCE, buildComplete, isFinal, MAX_ITEMS, POTION, slotItem, sumStats, type Slot } from './items';
import { loadVfx, Vfx, type MissileFx } from './vfx';

const B = EZREAL.base;
const SPAWN_RADIUS = 1800;
const DESPAWN_RADIUS = 3600;

/** LoL per-level stat growth formula. */
const grow = (base: number, perLevel: number, level: number) => {
  const n = Math.min(level, MAX_CHAMPION_LEVEL) - 1;
  return base + perLevel * n * (0.7025 + 0.0175 * n);
};

export interface Enemy {
  def: EnemyDef;
  actor: Actor;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  attackTimer: number;
  windup: number; // seconds left in attack windup, <0 when not attacking
  deadFor: number; // seconds since death, <0 while alive
  markedUntil: number; // Essence Flux mark
  markMesh?: THREE.Object3D;
  armor: number;
  shred: number; // Black Cleaver stacks
  shredUntil: number;
}

type MissileKind = 'auto' | 'Q' | 'W' | 'E' | 'R' | 'enemy';
interface Missile {
  kind: MissileKind;
  mesh: THREE.Object3D;
  fx: MissileFx;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  travelled: number;
  range: number;
  radius: number;
  damage: number;
  target?: Enemy; // homing missiles
  hit?: Set<Enemy>; // piercing missiles
  crit?: boolean;
}

/** Floating combat text (damage dealt/taken, XP), rendered by the HUD. */
export interface Floater { pos: THREE.Vector3; text: string; kind: 'physical' | 'magic' | 'crit' | 'taken' | 'xp'; age: number }

type DamageType = 'physical' | 'magic';

/** A telegraphed Baron ability: the ground marker fills up over `cast` seconds, then `fire` resolves it. */
interface Hazard { mesh: THREE.Object3D; fill: THREE.Object3D; line: boolean; t: number; cast: number; fire: () => void }
/** Short-lived visual (tentacle bursting out of the ground, knock-up eruption). */
interface Effect { mesh: THREE.Mesh; age: number; life: number; height: number }

const ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const glow = (color: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
export class Game {
  readonly scene = new THREE.Scene();
  time = 0;
  kills = 0;
  paused = false;
  over: 'won' | 'lost' | null = null;

  // Ezreal state
  player!: Actor;
  pos = new THREE.Vector3();
  facing = 0;
  level = 1;
  xp = 0;
  hp = 0;
  mana = 0;
  ranks: Record<SkillKey, number> = { Q: 0, W: 0, E: 0, R: 0 };
  cooldowns: Record<SkillKey, number> = { Q: 0, W: 0, E: 0, R: 0 };
  slots: Slot[] = [];
  legendary = -1; // slot upgraded by the blueprint
  items = sumStats([]);
  private blueprintDropped = false; // at most one blueprint per run
  private blueprint: THREE.Object3D | null = null; // scroll lying on the ground
  passiveStacks = 0;
  passiveTimer = 0;
  autoAttack = true;
  focus: Enemy | null = null; // right-click focus target
  manualTarget: Enemy | null = null; // left-click target when auto attack is off
  pendingLevelUps = 1; // LoL grants a skill point at level 1
  private attackTimer = 0;
  private windup = -1;
  private windupTarget: Enemy | null = null;
  private pendingCrit = false;
  private attackIndex = 0;
  private castLock = 0;
  private animLock = 0;
  private pendingCast: { key: SkillKey; point: THREE.Vector3 } | null = null;
  private spellbladeArmed = false;
  private spellbladeCd = 0;
  private autoCount = 0; // Kraken Slayer counts every 3rd attack
  private guardianAngelReadyAt = 0;
  stasis = 0; // Guardian Angel revive timer
  stunned = 0; // seconds of crowd control left (Baron knock-up / tentacle pull)
  private stunLength = 0;
  arena: { center: THREE.Vector3; mesh: THREE.Object3D } | null = null; // Baron fight
  private pull: THREE.Mesh | null = null; // tentacle dragging Ezreal back into the arena
  private hazards: Hazard[] = [];
  private effects: Effect[] = [];

  enemies: Enemy[] = [];
  private missiles: Missile[] = [];
  floaters: Floater[] = [];
  private nextEvent = 0;
  // spawn director state
  private spawnBudget = 0;
  private spawnLog: number[] = [];
  private killLog: number[] = [];
  nextHordeAt = HORDE.every;
  private focusRing = new THREE.Mesh(ringGeo, glow(0xff3030));
  private vfx = new Vfx(this.scene);

  async load(onProgress: (done: number, total: number) => void) {
    const ids = [EZREAL.model, ...new Set(Object.values(ENEMIES).map((e) => e.model))];
    let done = 0;
    await Promise.all([
      loadVfx(),
      ...ids.map((id) => {
        const def = Object.values(ENEMIES).find((e) => e.model === id);
        return loadModel(id, def?.hide, def?.mesh).then(() => onProgress(++done, ids.length));
      }),
    ]);
    this.scene.background = new THREE.Color(0x0b1410);
    this.scene.add(makeGround());
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);
    this.reset();
  }

  reset() {
    for (const e of this.enemies) e.actor.dispose();
    for (const m of this.missiles) m.mesh.removeFromParent();
    for (const e of this.enemies) e.markMesh?.removeFromParent();
    for (const h of this.hazards) h.mesh.removeFromParent();
    for (const f of this.effects) f.mesh.removeFromParent();
    this.arena?.mesh.removeFromParent();
    this.pull?.removeFromParent();
    this.blueprint?.removeFromParent();
    this.blueprint = null;
    this.vfx?.clear();
    this.player?.dispose();
    Object.assign(this, {
      time: 0, kills: 0, over: null, paused: false, level: 1, xp: 0, facing: 0,
      passiveStacks: 0, passiveTimer: 0, focus: null, manualTarget: null, pendingLevelUps: 1,
      attackTimer: 0, windup: -1, windupTarget: null, castLock: 0, animLock: 0, pendingCast: null,
      enemies: [], missiles: [], floaters: [], nextEvent: 0, spawnBudget: 0, spawnLog: [], killLog: [],
      nextHordeAt: HORDE.every, slots: [], legendary: -1, blueprintDropped: false, items: sumStats([]), spellbladeArmed: false, spellbladeCd: 0,
      autoCount: 0, guardianAngelReadyAt: 0, stasis: 0, stunned: 0, stunLength: 0, arena: null, pull: null,
      hazards: [], effects: [],
    });
    this.ranks = { Q: 0, W: 0, E: 0, R: 0 };
    this.cooldowns = { Q: 0, W: 0, E: 0, R: 0 };
    this.pos.set(0, 0, 0);
    this.player = new Actor(EZREAL.model);
    this.scene.add(this.player.root);
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.player.play(EZREAL.anims.idle);
  }

  // ---- derived stats ----
  get maxHp() { return grow(B.hp, B.hpPerLevel, this.level) + this.items.hp; }
  get maxMana() { return grow(B.mana, B.manaPerLevel, this.level) + this.items.mana; }
  get baseAd() { return grow(B.ad, B.adPerLevel, this.level); }
  /** Bonus AD from items, plus Manamune's Awe (2.5% max mana). */
  get bonusAd() { return this.items.ad + (this.has('3004') ? 0.025 * this.maxMana : 0); }
  get ad() { return this.baseAd + this.bonusAd; }
  get attackSpeed() {
    const bonus = grow(0, B.attackSpeedPerLevel, this.level) + this.items.as + this.passiveStacks * EZREAL.passive.asPerStack;
    return Math.min(2.5, B.attackSpeed * (1 + bonus));
  }
  get moveSpeed() { return Math.round(B.moveSpeed * (1 + this.items.msPct)); }
  get critChance() { return Math.min(1, this.items.crit); }
  get armor() { return grow(B.armor, B.armorPerLevel, this.level) + this.items.armor; }
  get abilityHaste() { return this.items.ah; }
  get alive() { return this.hp > 0; }
  get inventory() { return this.slots.map(slotItem); }
  has(id: string) { return this.slots.some((s) => slotItem(s) === id); }
  cooldownOf(key: SkillKey) { return EZREAL[key].cooldown[this.ranks[key] - 1] * (100 / (100 + this.abilityHaste)); }
  costOf(key: SkillKey) { return EZREAL[key].cost[Math.max(0, this.ranks[key] - 1)]; }

  // ---- level up ----
  /** LoL skill point rules: basic ranks at levels 1/3/5/7/9, R at 6/11/16. */
  canRankUp(key: SkillKey) {
    const r = this.ranks[key];
    if (r >= EZREAL[key].maxRank) return false;
    if (key === 'R') return this.level >= [6, 11, 16][r];
    return r < Math.ceil(this.level / 2);
  }

  skillOptions() { return SKILL_KEYS.filter((k) => this.canRankUp(k)); }

  rankUp(key: SkillKey) { this.ranks[key]++; }

  /** Change the inventory, keeping current HP/mana in step with the max values (like buying in LoL). */
  private setSlots(slots: Slot[]) {
    const hpBefore = this.maxHp, manaBefore = this.maxMana;
    this.slots = slots;
    this.items = sumStats(this.inventory, this.legendary);
    this.hp = Math.max(1, Math.min(this.maxHp, this.hp + this.maxHp - hpBefore));
    this.mana = Math.max(0, Math.min(this.maxMana, this.mana + this.maxMana - manaBefore));
  }
  takeItem(base: string) { if (this.slots.length < MAX_ITEMS) this.setSlots([...this.slots, { base, path: [] }]); }
  /** Evolve slot i one step; callers only pass steps from nextSteps(). */
  evolve(i: number, step: string) {
    this.setSlots(this.slots.map((s, j) => (j === i ? { ...s, path: [...s.path, step] } : s)));
  }
  drinkPotion(kind: keyof typeof POTION) {
    if (kind === 'hp') this.hp = Math.min(this.maxHp, this.hp + POTION.hp * this.maxHp);
    else this.mana = Math.min(this.maxMana, this.mana + POTION.mana * this.maxMana);
  }

  float(pos: THREE.Vector3, text: string, kind: Floater['kind']) {
    if (this.floaters.length < 150) this.floaters.push({ pos: pos.clone(), text, kind, age: 0 });
  }

  private gainXp(v: number) {
    this.xp += v;
    this.float(this.pos, `+${v} XP`, 'xp');
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      const hpBefore = this.maxHp, manaBefore = this.maxMana;
      this.level++;
      this.hp += this.maxHp - hpBefore;
      this.mana += this.maxMana - manaBefore;
      this.pendingLevelUps++;
    }
  }

  // ---- input ----
  enemyAt(point: THREE.Vector3) {
    let best: Enemy | null = null, bestD = Infinity;
    for (const e of this.enemies) {
      if (e.deadFor >= 0) continue;
      const d = e.pos.distanceTo(point) - e.def.radius;
      if (d < 60 && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  cast(key: SkillKey, point: THREE.Vector3) {
    if (!this.alive || this.stunned > 0 || this.ranks[key] === 0 || this.cooldowns[key] > 0 || this.castLock > 0) return;
    if (this.mana < this.costOf(key)) return;
    this.mana -= this.costOf(key);
    this.cooldowns[key] = this.cooldownOf(key);
    if (this.spellbladeCd <= 0 && (this.has('3057') || this.has('3078') || this.has('3508'))) this.spellbladeArmed = true;
    this.windup = -1; // casting cancels an attack windup
    this.faceTowards(point);
    this.castLock = EZREAL[key].castTime;
    this.pendingCast = { key, point: point.clone() };
    this.player.play(EZREAL.anims[key], { loop: false, restart: true, fade: 0.05 });
    this.vfx.cast(key, this.pos, this.facing);
    this.animLock = Math.min(this.player.duration(EZREAL.anims[key]), EZREAL[key].castTime + 0.6);
  }

  // ---- simulation ----
  update(dt: number, move: THREE.Vector3) {
    if (this.paused || this.over) {
      if (this.over) this.player.update(dt); // let the death animation finish
      return;
    }
    this.time += dt;
    this.spawn(dt);
    this.horde();
    this.updatePlayer(dt, move);
    this.updateEnemies(dt);
    this.updateMissiles(dt);
    this.updateArena(dt);
    this.updateBlueprint(dt);
    this.vfx.update(dt);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < 0.9);
    if (this.focus && this.focus.deadFor >= 0) this.focus = null;
    this.focusRing.visible = !!this.focus;
    if (this.focus) {
      this.focusRing.position.set(this.focus.pos.x, 3, this.focus.pos.z);
      this.focusRing.scale.setScalar(this.focus.def.radius + 25);
    }
  }

  /** Blueprint scroll: bobs on the ground until Ezreal walks over it, then a random finished item turns legendary. */
  private updateBlueprint(dt: number) {
    const bp = this.blueprint;
    if (!bp) return;
    bp.rotation.y += dt * 1.5;
    bp.children[0].position.y = 60 + 15 * Math.sin(this.time * 3);
    if (bp.position.distanceTo(this.pos) > B.radius + 60) return;
    bp.removeFromParent();
    this.blueprint = null;
    const finals = this.slots.flatMap((s, i) => (isFinal(s) ? [i] : []));
    this.legendary = finals[Math.floor(Math.random() * finals.length)];
    this.setSlots(this.slots);
    this.float(this.pos, 'Item Lendário!', 'crit');
  }

  private updatePlayer(dt: number, move: THREE.Vector3) {
    if (this.stasis > 0) {
      // Guardian Angel: frozen and untargetable, then revive
      this.stasis -= dt;
      if (this.stasis <= 0) {
        this.hp = 0.5 * grow(B.hp, B.hpPerLevel, this.level);
        this.mana = this.maxMana;
      }
      return;
    }
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + (grow(B.hpRegen5, B.hpRegen5PerLevel, this.level) / 5) * dt);
    this.mana = Math.min(this.maxMana, this.mana + (grow(B.manaRegen5, B.manaRegen5PerLevel, this.level) / 5) * dt);
    this.spellbladeCd -= dt;
    for (const k of SKILL_KEYS) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.passiveTimer -= dt;
    if (this.passiveTimer <= 0) this.passiveStacks = 0;
    this.attackTimer -= dt;
    this.animLock -= dt;

    if (this.stunned > 0) {
      // knocked up: arc into the air and land, no actions
      this.stunned -= dt;
      const t = 1 - Math.max(0, this.stunned) / this.stunLength;
      this.player.root.position.set(this.pos.x, this.pull ? 0 : Math.sin(Math.min(1, t * 1.6) * Math.PI) * 260, this.pos.z);
      this.player.update(dt);
      return;
    }

    if (this.castLock > 0) {
      this.castLock -= dt;
      if (this.castLock <= 0 && this.pendingCast) {
        this.resolveCast(this.pendingCast.key, this.pendingCast.point);
        this.pendingCast = null;
      }
      return; // champions stand still while casting
    }

    const moving = move.lengthSq() > 0;
    // Survivors rule: Ezreal attacks while moving. During the windup he turns to the target; after it, back to running.
    this.tryAttack(dt);
    if (moving) {
      this.pos.addScaledVector(move, this.moveSpeed * dt);
      if (this.arena) {
        // the arena wall blocks walking out
        const off = this.pos.clone().sub(this.arena.center);
        const max = BARON.arenaRadius - B.radius;
        if (off.length() > max) this.pos.copy(this.arena.center).addScaledVector(off.normalize(), max);
      }
      if (this.windup < 0) {
        this.facing = Math.atan2(move.x, move.z);
        this.animLock = 0;
      }
    }

    if (this.animLock <= 0) {
      if (moving) {
        this.player.play(EZREAL.anims.run);
        this.player.setTimeScale(this.moveSpeed / B.moveSpeed);
      } else this.player.play(EZREAL.anims.idle, { fade: 0.2 });
    }
    this.player.root.position.copy(this.pos);
    this.player.root.rotation.y = this.facing;
    this.player.update(dt);
  }

  private inAttackRange(e: Enemy) {
    return e.deadFor < 0 && e.pos.distanceTo(this.pos) - e.def.radius - B.radius <= B.attackRange;
  }

  private tryAttack(dt: number) {
    if (this.windup >= 0) {
      this.windup -= dt;
      const t = this.windupTarget;
      if (!t || t.deadFor >= 0) { this.windup = -1; return; }
      this.faceTowards(t.pos);
      if (this.windup < 0) this.fireAuto(t);
      return;
    }
    if (this.attackTimer > 0) return;
    let target: Enemy | null = null;
    if (this.autoAttack) {
      if (this.focus && this.inAttackRange(this.focus)) target = this.focus;
      else target = this.nearestEnemy(this.pos, B.attackRange + B.radius, (e) => this.inAttackRange(e));
    } else if (this.manualTarget && this.inAttackRange(this.manualTarget)) target = this.manualTarget;
    if (!target) return;
    const delay = 1 / this.attackSpeed;
    this.attackTimer = delay;
    this.windup = delay * B.windupPercent;
    this.windupTarget = target;
    this.faceTowards(target.pos);
    const crit = Math.random() < this.critChance;
    this.pendingCrit = crit;
    const anim = crit ? EZREAL.anims.crit : EZREAL.anims.attacks[this.attackIndex++ % EZREAL.anims.attacks.length];
    const length = Math.min(this.player.duration(anim), delay);
    this.player.play(anim, { loop: false, restart: true, duration: length, fade: 0.05 });
    this.animLock = length;
  }

  private fireAuto(target: Enemy) {
    const dmg = this.ad * (this.pendingCrit ? B.critDamage + this.items.critDamage : 1);
    this.spawnMissile('auto', this.pos, target.pos, { speed: B.missileSpeed, range: 3000, radius: 10, damage: dmg, target, crit: this.pendingCrit });
  }

  /** On-hit item effects for basic attacks (and Mystic Shot, which applies on-hit in LoL). */
  private onHit(e: Enemy, source: MissileKind) {
    let bonus = 0;
    if (this.has('3153')) bonus += Math.min(e.def.tier === 'epic' ? Infinity : 100, 0.06 * e.hp); // Blade of the Ruined King
    if (source !== 'auto') return bonus;
    if (this.has('6672') && ++this.autoCount % 3 === 0) {
      bonus += (140 + 0.45 * this.bonusAd) * (1 + 0.75 * (1 - e.hp / e.maxHp)); // Kraken Slayer
    }
    if (this.spellbladeArmed) {
      this.spellbladeArmed = false;
      this.spellbladeCd = 1.5;
      if (this.has('3078')) bonus += 2 * this.baseAd;
      else if (this.has('3508')) {
        bonus += this.baseAd + 0.4 * this.bonusAd;
        this.mana = Math.min(this.maxMana, this.mana + 0.1 * (this.maxMana - this.mana));
      } else bonus += this.baseAd;
    }
    return bonus;
  }

  private resolveCast(key: SkillKey, point: THREE.Vector3) {
    const r = this.ranks[key] - 1;
    if (key === 'Q') {
      const q = EZREAL.Q;
      this.spawnMissile('Q', this.pos, point, { speed: q.speed, range: q.range, radius: q.width / 2, damage: q.damage[r] + q.adRatio * this.ad });
    } else if (key === 'W') {
      const w = EZREAL.W;
      this.spawnMissile('W', this.pos, point, { speed: w.speed, range: w.range, radius: w.width / 2, damage: 0 });
    } else if (key === 'E') {
      const e = EZREAL.E;
      const dir = point.clone().sub(this.pos).setY(0);
      const dist = Math.min(dir.length(), e.blinkRange);
      const from = this.pos.clone();
      if (dist > 0) this.pos.addScaledVector(dir.normalize(), dist);
      this.vfx.blink(from, this.pos);
      const marked = this.nearestEnemy(this.pos, e.boltRange, (x) => x.markedUntil > this.time);
      const target = marked ?? this.nearestEnemy(this.pos, e.boltRange);
      if (target) this.spawnMissile('E', this.pos, target.pos, {
        speed: e.speed, range: 3000, radius: 10, damage: e.damage[r] + e.bonusAdRatio * this.bonusAd, target,
      });
    } else {
      const R = EZREAL.R;
      this.spawnMissile('R', this.pos, point, {
        speed: R.speed, range: R.range, radius: R.width / 2, damage: R.damage[r] + R.bonusAdRatio * this.bonusAd, hit: new Set(),
      });
    }
  }

  private spawnMissile(kind: MissileKind, from: THREE.Vector3, to: THREE.Vector3,
    o: { speed: number; range: number; radius: number; damage: number; target?: Enemy; hit?: Set<Enemy>; crit?: boolean }) {
    const fx = this.vfx.missile(kind, o.crit);
    const mesh = fx.root;
    const pos = from.clone().setY(kind === 'R' ? 60 : 110);
    const dir = to.clone().setY(pos.y).sub(pos).normalize();
    if (dir.lengthSq() === 0) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.scene.add(mesh);
    this.missiles.push({ kind, mesh, fx, pos, dir, travelled: 0, ...o });
  }

  private updateMissiles(dt: number) {
    this.missiles = this.missiles.filter((m) => {
      if (m.target) {
        if (m.target.deadFor >= 0) return this.removeMesh(m.mesh);
        m.dir.copy(m.target.pos).setY(m.pos.y).sub(m.pos).normalize();
      }
      const step = m.speed * dt;
      m.pos.addScaledVector(m.dir, step);
      m.travelled += step;
      m.mesh.position.copy(m.pos);
      m.fx.update(dt, m.dir, m.travelled);

      if (m.kind === 'enemy') {
        if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) <= B.radius + m.radius) { this.hurtPlayer(m.damage); this.vfx.hit('enemy', m.pos); return this.removeMesh(m.mesh); }
      } else if (m.target) {
        if (m.pos.distanceTo(m.target.pos.clone().setY(m.pos.y)) <= m.target.def.radius) {
          this.vfx.hit(m.kind, m.pos, m.crit, Math.atan2(m.dir.x, m.dir.z));
          this.hurtEnemy(m.target, m.damage, m.kind, m.crit);
          return this.removeMesh(m.mesh);
        }
      } else {
        for (const e of this.enemies) {
          if (e.deadFor >= 0 || m.hit?.has(e)) continue;
          if (Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) > e.def.radius + m.radius) continue;
          if (m.kind === 'W') {
            e.markedUntil = this.time + EZREAL.W.markDuration;
            this.vfx.hit('W-burst', m.pos);
            this.stackPassive();
            return this.removeMesh(m.mesh);
          }
          if (m.kind === 'R') {
            m.hit!.add(e);
            this.vfx.hit('R', e.pos.clone().setY(m.pos.y));
            this.hurtEnemy(e, m.damage * (e.def.tier === 'epic' ? 1 : EZREAL.R.nonEpicMultiplier), 'R');
            continue;
          }
          this.vfx.hit(m.kind, m.pos, false, Math.atan2(m.dir.x, m.dir.z));
          this.hurtEnemy(e, m.damage, m.kind);
          if (m.kind === 'Q') for (const k of SKILL_KEYS) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - EZREAL.Q.cdRefundOnHit);
          return this.removeMesh(m.mesh);
        }
      }
      return m.travelled < m.range || this.removeMesh(m.mesh);
    });
  }

  private removeMesh(mesh: THREE.Object3D) {
    mesh.removeFromParent();
    return false;
  }

  private stackPassive() {
    const p = EZREAL.passive;
    this.passiveStacks = Math.min(p.maxStacks, this.passiveStacks + 1);
    this.passiveTimer = p.duration;
  }

  /** Physical damage is reduced by armor (after Black Cleaver shred and armor penetration); magic is not (no MR). */
  private mitigate(e: Enemy, amount: number) {
    const shred = e.shredUntil > this.time ? e.shred * 0.06 : 0;
    const armor = e.armor * (1 - shred) * (1 - this.items.armorPen);
    return amount * (100 / (100 + armor));
  }

  private hurtEnemy(e: Enemy, amount: number, source: MissileKind, crit = false) {
    if (e.deadFor >= 0) return;
    if (source !== 'auto') this.stackPassive();
    // Ezreal's autos and Q are physical; W, E and R are magic
    const type: DamageType = source === 'auto' || source === 'Q' ? 'physical' : 'magic';
    let physical = type === 'physical' ? amount + this.onHit(e, source) : 0;
    let magic = type === 'magic' ? amount : 0;
    if (e.markedUntil > this.time) {
      // Essence Flux detonation; ability detonations refund mana
      e.markedUntil = 0;
      this.vfx.hit('W-burst', e.pos.clone().setY(100));
      magic += EZREAL.W.damage[this.ranks.W - 1] + EZREAL.W.bonusAdRatio * this.bonusAd;
      if (source !== 'auto') this.mana = Math.min(this.maxMana, this.mana + EZREAL.W.manaRestore + this.costOf(source as SkillKey));
    }
    physical = this.mitigate(e, physical);
    if (physical > 0 && this.has('3071')) {
      e.shred = e.shredUntil > this.time ? Math.min(5, e.shred + 1) : 1;
      e.shredUntil = this.time + 6;
    }
    const dealt = Math.min(e.hp, physical + magic);
    this.hp = Math.min(this.maxHp, this.hp + dealt * (this.items.omnivamp + (source === 'auto' ? this.items.lifesteal : 0)));
    e.hp -= physical + magic;
    this.float(e.pos, String(Math.round(physical + magic)), crit ? 'crit' : magic > physical ? 'magic' : 'physical');
    if (e.hp <= 0) this.killEnemy(e);
  }

  /** `nonLethal` damage leaves Ezreal at 1 HP at worst (Baron's whip). */
  private hurtPlayer(amount: number, nonLethal = false) {
    if (!this.alive || this.stasis > 0) return;
    let taken = amount * (100 / (100 + this.armor));
    if (nonLethal) taken = Math.min(taken, this.hp - 1);
    this.hp -= taken;
    this.float(this.pos, `-${Math.round(taken)}`, 'taken');
    if (this.hp <= 0 && this.has('3026') && this.time >= this.guardianAngelReadyAt) {
      // Guardian Angel: 4s stasis, then revive
      this.hp = 1;
      this.stasis = 4;
      this.guardianAngelReadyAt = this.time + 300;
      this.windup = -1;
      this.castLock = 0;
      this.pendingCast = null;
      this.stunned = 0;
      return;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.over = 'lost';
      this.player.play(EZREAL.anims.death, { loop: false, fade: 0.1 });
    }
  }

  private killEnemy(e: Enemy) {
    e.deadFor = 0;
    e.markMesh?.removeFromParent();
    this.kills++;
    this.killLog.push(this.time);
    e.actor.play(e.def.anims.death, { loop: false, fade: 0.08 });
    this.gainXp(e.def.xp); // XP is absorbed on kill (no gems to collect)
    if (!this.blueprintDropped && buildComplete(this.slots) && this.slots.some(isFinal) && Math.random() < BLUEPRINT_CHANCE) {
      this.blueprintDropped = true;
      this.blueprint = makeBlueprint();
      this.blueprint.position.set(e.pos.x, 0, e.pos.z);
      this.scene.add(this.blueprint);
    }
    if (e.def.model === 'baron') { this.over = 'won'; this.player.play(EZREAL.anims.idle); }
  }

  private nearestEnemy(from: THREE.Vector3, range: number, filter: (e: Enemy) => boolean = () => true) {
    let best: Enemy | null = null, bestD = range;
    for (const e of this.enemies) {
      if (e.deadFor >= 0 || !filter(e)) continue;
      const d = e.pos.distanceTo(from) - e.def.radius;
      if (d <= bestD) { best = e; bestD = d; }
    }
    return best;
  }

  private faceTowards(p: THREE.Vector3) {
    this.facing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  // ---- enemies ----
  /**
   * Spawn director: spawns per second follow the base rate (grows with level and time), scaled by how many of the
   * recently spawned enemies the player managed to kill. Alive count is capped so early game stays survivable.
   */
  private spawn(dt: number) {
    if (this.arena) return; // nothing else spawns during the Baron fight
    this.spawnLog = this.spawnLog.filter((t) => this.time - t < DIRECTOR.window);
    this.killLog = this.killLog.filter((t) => this.time - t < DIRECTOR.window);
    this.spawnBudget += DIRECTOR.baseRate(this.time, this.level) * this.performance * dt;
    let alive = this.enemies.filter((e) => e.deadFor < 0).length;
    const cap = Math.min(MAX_ENEMIES, DIRECTOR.maxAlive(this.time, this.level));
    while (this.spawnBudget >= 1) {
      if (alive >= cap) { this.spawnBudget = 1; break; }
      this.spawnEnemy(this.pickFromPool());
      this.spawnBudget--;
      alive++;
    }
    while (this.nextEvent < EVENTS.length && this.time >= EVENTS[this.nextEvent].at) {
      const key = EVENTS[this.nextEvent++].enemy;
      if (key === 'baron') this.startBaronFight();
      else if (key === 'dragon') this.spawnEnemy(DRAGONS[Math.floor(Math.random() * DRAGONS.length)].model);
      else this.spawnEnemy(key);
    }
  }

  get performance() {
    if (this.spawnLog.length < 5) return 1;
    const ratio = Math.min(1, this.killLog.length / this.spawnLog.length);
    return DIRECTOR.perfMin + (DIRECTOR.perfMax - DIRECTOR.perfMin) * ratio;
  }

  private pickFromPool() {
    const active = POOL.filter((p) => this.time >= p.from && this.time <= p.to);
    let r = Math.random() * active.reduce((sum, p) => sum + p.weight, 0);
    return (active.find((p) => (r -= p.weight) < 0) ?? active[0]).enemy;
  }

  /** Every HORDE.every seconds a ring of weak swarmers closes in around the player. */
  private horde() {
    if (this.arena || this.time < this.nextHordeAt) return;
    this.nextHordeAt += HORDE.every;
    const swarmers = POOL.filter((p) => this.time >= p.from && this.time <= p.to && ENEMIES[p.enemy].hp <= 60);
    const key = swarmers[Math.floor(Math.random() * swarmers.length)].enemy;
    const alive = this.enemies.filter((e) => e.deadFor < 0).length;
    const n = Math.min(HORDE.size(this.level), MAX_ENEMIES - alive);
    // ring with an opening (HORDE.gap of the circle) at a random side, so the player can break out
    const start = Math.random() * Math.PI * 2;
    const arc = Math.PI * 2 * (1 - HORDE.gap);
    for (let i = 0; i < n; i++) {
      const a = start + (i / (n - 1)) * arc;
      this.spawnEnemy(key, new THREE.Vector3(this.pos.x + Math.cos(a) * HORDE.radius, 0, this.pos.z + Math.sin(a) * HORDE.radius));
    }
  }

  private spawnEnemy(key: string, at?: THREE.Vector3): Enemy {
    const def = ENEMIES[key];
    const a = Math.random() * Math.PI * 2;
    const r = SPAWN_RADIUS + Math.random() * 200;
    const epic = def.tier === 'epic';
    const actor = new Actor(def.model, def.scale);
    const hp = def.hp * (epic ? 1 : enemyHpScale(this.time, this.level));
    const e: Enemy = {
      def, actor, pos: at ?? new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r),
      hp, maxHp: hp, attackTimer: 0, windup: -1, deadFor: -1, markedUntil: 0,
      armor: (def.armor ?? ENEMY_ARMOR[def.tier]) * (epic ? 1 : enemyArmorScale(this.time)), shred: 0, shredUntil: 0,
    };
    actor.play(def.anims.run);
    this.scene.add(actor.root);
    this.enemies.push(e);
    this.spawnLog.push(this.time);
    return e;
  }

  private updateEnemies(dt: number) {
    const tmp = new THREE.Vector3();
    for (const e of this.enemies) {
      e.actor.update(dt);
      if (e.deadFor >= 0) { e.deadFor += dt; continue; }
      if (e.def.model === 'baron') { this.updateBaron(e, dt); continue; }
      const toPlayer = tmp.copy(this.pos).sub(e.pos).setY(0);
      const dist = toPlayer.length();
      const edge = dist - e.def.radius - B.radius;
      e.attackTimer -= dt;

      if (dist > DESPAWN_RADIUS && e.def.tier !== 'epic') {
        // survivors convention: stragglers reappear ahead of the player instead of despawning
        e.pos.copy(this.pos).addScaledVector(toPlayer.normalize(), SPAWN_RADIUS);
        continue;
      }
      if (e.windup >= 0) {
        e.windup -= dt;
        if (e.windup < 0 && this.alive && this.stasis <= 0) {
          if (e.def.ranged) {
            // aimed at where Ezreal is now, then flies straight so it can be dodged
            this.spawnMissile('enemy', e.pos, this.pos, {
              speed: e.def.ranged, range: e.def.attackRange + e.def.radius + ENEMY_MISSILE_EXTRA_RANGE, radius: 25,
              damage: e.def.damage * enemyDamageScale(this.time),
            });
          } else if (edge <= e.def.attackRange + 80) this.hurtPlayer(e.def.damage * enemyDamageScale(this.time));
        }
      } else if (edge <= e.def.attackRange && this.alive && this.stasis <= 0) {
        if (e.attackTimer <= 0) {
          // Frozen Heart: nearby enemies attack 20% slower
          e.attackTimer = e.def.attackCooldown * (this.has('3110') && dist < 700 ? 1.25 : 1);
          e.windup = e.def.windup;
          const anims = e.def.anims.attacks;
          const anim = anims[Math.floor(Math.random() * anims.length)];
          e.actor.play(anim, { loop: false, restart: true, duration: Math.min(e.actor.duration(anim), e.def.attackCooldown) });
        } else if (e.attackTimer < e.def.attackCooldown - e.actor.duration(e.actor.currentName)) {
          e.actor.play(e.def.anims.idle, { fade: 0.2 });
        }
      } else {
        e.pos.addScaledVector(toPlayer.normalize(), e.def.speed * dt);
        e.actor.play(e.def.anims.run, { fade: 0.2 });
      }
      e.actor.root.rotation.y = Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z);
    }
    this.separate();
    for (const e of this.enemies) {
      e.actor.root.position.copy(e.pos);
      const marked = e.markedUntil > this.time && e.deadFor < 0;
      if (marked && !e.markMesh) {
        e.markMesh = this.vfx.mark();
        this.scene.add(e.markMesh);
      } else if (!marked && e.markMesh) {
        e.markMesh.removeFromParent();
        e.markMesh = undefined;
      }
      if (e.markMesh) {
        e.markMesh.position.set(e.pos.x, 40 + e.def.radius * 2.5, e.pos.z);
        e.markMesh.userData.tick(this.time);
      }
    }
    this.enemies = this.enemies.filter((e) => {
      if (e.deadFor < 2) return true;
      e.actor.dispose();
      return false;
    });
  }

  /** Push overlapping units apart (and out of Ezreal), like LoL unit collision. */
  private separate() {
    const list = this.enemies.filter((e) => e.deadFor < 0);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = (a.def.radius + b.def.radius) * 0.8;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2), push = (min - d) / 2 / d;
        a.pos.x -= dx * push; a.pos.z -= dz * push;
        b.pos.x += dx * push; b.pos.z += dz * push;
      }
      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const min = a.def.radius + B.radius, d = Math.hypot(dx, dz);
      if (d >= min || d === 0) continue;
      if (a.def.model === 'baron') { this.pos.x = a.pos.x - (dx / d) * min; this.pos.z = a.pos.z - (dz / d) * min; } // Baron is immovable
      else { a.pos.x = this.pos.x + (dx / d) * min; a.pos.z = this.pos.z + (dz / d) * min; }
    }
  }

  // ---- Baron Nashor ----
  /** Every other enemy dies, spawns stop, and a closed arena forms around Ezreal and the Baron. */
  private startBaronFight() {
    for (const e of this.enemies) {
      if (e.deadFor >= 0) continue;
      e.deadFor = 0; // no XP: the Baron's arrival clears the map
      e.markMesh?.removeFromParent();
      e.actor.play(e.def.anims.death, { loop: false, fade: 0.08 });
    }
    for (const m of this.missiles) if (m.kind === 'enemy') m.mesh.removeFromParent();
    this.missiles = this.missiles.filter((m) => m.kind !== 'enemy');
    this.nextHordeAt = Infinity;
    const center = this.pos.clone();
    const mesh = makeArena(BARON.arenaRadius);
    mesh.position.copy(center);
    this.scene.add(mesh);
    this.arena = { center, mesh };
    const a = Math.random() * Math.PI * 2;
    const baron = this.spawnEnemy('baron', center.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(BARON.spawnOffset)));
    baron.attackTimer = 2; // grace period before the first ability
    baron.actor.play(ENEMIES.baron.anims.idle);
  }

  private updateBaron(e: Enemy, dt: number) {
    e.attackTimer -= dt;
    e.actor.root.rotation.y = Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z);
    if (e.attackTimer < BARON.gap - 0.6) e.actor.play(e.def.anims.idle, { fade: 0.3 });
    if (e.attackTimer > 0 || !this.alive || this.stasis > 0) return;
    const edge = e.pos.distanceTo(this.pos) - e.def.radius - B.radius;
    let cast: number;
    let anim: string;
    if (edge <= BARON.melee.range) {
      if (Math.random() < BARON.melee.biteChance) {
        // bite: instant, cannot be dodged
        anim = BARON.anims.bite;
        cast = 0.5;
        this.hurtPlayer(BARON.lethal);
      } else {
        anim = BARON.anims.whip;
        cast = this.baronWhip(e);
      }
    } else {
      const pick = Math.floor(Math.random() * 3);
      anim = [BARON.anims.knockup, BARON.anims.tentacle, BARON.anims.spit][pick];
      cast = [() => this.baronKnockup(), () => this.baronTentacle(), () => this.baronSpit(e)][pick]();
    }
    e.actor.play(anim, { loop: false, restart: true, fade: 0.1, duration: Math.min(e.actor.duration(anim), cast + 0.6) });
    e.attackTimer = cast + BARON.gap;
  }

  /** Circles erupt around Ezreal: knock-up, stun and heavy (non-lethal) damage. */
  private baronKnockup() {
    const k = BARON.knockup;
    let hit = false; // overlapping circles only hit once
    for (let i = 0; i < k.count; i++) {
      const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : k.spread * Math.sqrt(Math.random());
      const at = this.inArena(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
      this.telegraph(at, circleGeo, k.radius, 0, k.cast, 0x9a4dff, () => {
        this.spike(at, k.radius * 0.8, 220, 0xb070ff);
        if (hit || !this.playerWithin(at, k.radius)) return;
        hit = true;
        this.hurtPlayer(k.damage, true);
        this.stun(k.stun);
      });
    }
    return k.cast;
  }

  /** A tentacle bursts out of the ground where Ezreal stood. Lethal. */
  private baronTentacle() {
    const t = BARON.tentacle;
    const at = this.pos.clone();
    this.telegraph(at, circleGeo, t.radius, 0, t.cast, 0xff3050, () => {
      this.spike(at, t.radius * 0.6, 520, 0x5a2a7a);
      if (this.playerWithin(at, t.radius)) this.hurtPlayer(BARON.lethal);
    });
    return t.cast;
  }

  /** Acid spit: the line shows the path during the cast, then a fast lethal skillshot flies along it. */
  private baronSpit(e: Enemy) {
    const s = BARON.spit;
    const dir = this.pos.clone().sub(e.pos).setY(0).normalize();
    this.telegraph(e.pos, lineGeo, s.range, Math.atan2(dir.x, dir.z), s.cast, 0x60ff40, () => {
      this.spawnMissile('enemy', e.pos, e.pos.clone().add(dir), { speed: s.speed, range: s.range, radius: s.radius, damage: BARON.lethal });
    }, s.radius * 2);
    return s.cast;
  }

  /** Tentacle whip in a cone towards Ezreal: huge damage, never lethal. */
  private baronWhip(e: Enemy) {
    const w = BARON.whip;
    const facing = Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z);
    this.telegraph(e.pos, coneGeo(w.arc), w.radius + e.def.radius, facing, w.cast, 0xff8030, () => {
      const d = this.pos.clone().sub(e.pos);
      const angle = Math.abs(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - facing), Math.cos(Math.atan2(d.x, d.z) - facing)));
      if (d.length() <= w.radius + e.def.radius + B.radius && angle <= w.arc / 2) this.hurtPlayer(w.damage * this.maxHp, true);
    });
    return w.cast;
  }

  private stun(seconds: number) {
    if (!this.alive || this.stasis > 0) return;
    this.stunned = this.stunLength = Math.max(this.stunned, seconds);
    this.windup = -1;
    this.castLock = 0;
    this.pendingCast = null;
    this.player.play(EZREAL.anims.idle, { fade: 0.1 });
  }

  private playerWithin(at: THREE.Vector3, radius: number) {
    return Math.hypot(this.pos.x - at.x, this.pos.z - at.z) <= radius + B.radius;
  }

  private inArena(p: THREE.Vector3) {
    if (!this.arena) return p;
    const off = p.clone().sub(this.arena.center);
    const max = BARON.arenaRadius - 100;
    return off.length() > max ? this.arena.center.clone().addScaledVector(off.normalize(), max) : p;
  }

  /**
   * Ground marker: outline at full size plus a fill that grows until the ability resolves (like LoL indicators).
   * `size` is the radius (circle/cone) or length (line); `width` is the line width.
   */
  private telegraph(at: THREE.Vector3, geo: THREE.BufferGeometry, size: number, rotation: number, cast: number, color: number, fire: () => void, width = size) {
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

  private spike(at: THREE.Vector3, radius: number, height: number, color: number) {
    const mesh = new THREE.Mesh(spikeGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(at.x, 0, at.z);
    mesh.scale.set(radius, 0.01, radius);
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.6, height });
  }

  private updateArena(dt: number) {
    this.hazards = this.hazards.filter((h) => {
      h.t += dt;
      const k = Math.min(1, h.t / h.cast);
      if (h.line) h.fill.scale.set(1, 1, k); // lines fill along their length
      else h.fill.scale.set(k, 1, k);
      if (h.t < h.cast) return true;
      h.mesh.removeFromParent();
      h.mesh.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
      if (this.alive && this.stasis <= 0) h.fire();
      return false;
    });
    this.effects = this.effects.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      f.mesh.scale.y = f.height * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - Math.max(0, k * 2 - 1);
      if (k < 1) return true;
      f.mesh.removeFromParent();
      (f.mesh.material as THREE.Material).dispose();
      return false;
    });
    if (!this.arena) return;
    // escaped (e.g. Arcane Shift over the wall): a tentacle drags Ezreal back in
    const baron = this.enemies.find((e) => e.def.model === 'baron' && e.deadFor < 0);
    const off = this.pos.clone().sub(this.arena.center).setY(0);
    const dist = off.length();
    const inside = BARON.arenaRadius - 350;
    if (!this.pull && dist > BARON.arenaRadius && baron && this.alive) {
      this.pull = new THREE.Mesh(tentacleGeo, new THREE.MeshBasicMaterial({ color: 0x5a2a7a }));
      this.scene.add(this.pull);
    }
    if (!this.pull) return;
    if (dist > inside && baron && this.alive) {
      this.stun(0.2); // keeps Ezreal locked while dragged
      this.pos.addScaledVector(off.normalize(), -Math.min(BARON.pullSpeed * dt, dist - inside));
      const from = baron.pos.clone().setY(80), to = this.pos.clone().setY(80);
      this.pull.position.copy(from).lerp(to, 0.5);
      this.pull.scale.set(1, 1, from.distanceTo(to));
      this.pull.lookAt(to);
    } else {
      this.pull.removeFromParent();
      this.pull = null;
    }
  }

  get runLength() { return RUN_LENGTH; }
  get boss() { return this.enemies.find((e) => e.def.tier === 'epic' && e.deadFor < 0) ?? null; }
}

const circleGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const lineGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5); // starts at origin, runs along +Z
// sector centred on +Z (the facing convention: rotation.y = atan2(dx, dz))
const coneGeo = (arc: number) => new THREE.CircleGeometry(1, 32, Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2).rotateY(Math.PI);
const spikeGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
const tentacleGeo = new THREE.CylinderGeometry(22, 22, 1, 8).rotateX(Math.PI / 2); // unit length along +Z for lookAt

/** Baron arena: a ring of tall void spikes on a glowing circle. */
function makeArena(radius: number) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.RingGeometry(radius - 30, radius + 30, 96).rotateX(-Math.PI / 2), glow(0x8a3cff));
  floor.position.y = 3;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 260, 96, 1, true).translate(0, 130, 0),
    new THREE.MeshBasicMaterial({ color: 0x6a2aaa, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  g.add(floor, wall);
  const spikeMat = new THREE.MeshBasicMaterial({ color: 0x2a1240 });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const s = new THREE.Mesh(spikeGeo, spikeMat);
    s.scale.set(55, 260 + (i % 3) * 90, 55);
    s.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    g.add(s);
  }
  return g;
}

/** Blue scroll (blueprint drop): rolled parchment over a glowing ring. */
function makeBlueprint() {
  const g = new THREE.Group();
  const scroll = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 70, 16).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d8bff }));
  const ring = new THREE.Mesh(ringGeo, glow(0x3d8bff));
  ring.scale.setScalar(70);
  ring.position.y = 3;
  g.add(scroll, ring);
  return g;
}

function makeGround() {
  // Procedural Summoner's Rift-ish jungle floor; tiled across a large plane
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f4a2a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(70,100,50,0.25)' : v < 0.85 ? 'rgba(30,50,25,0.3)' : 'rgba(110,95,60,0.25)';
    const s = 4 + Math.random() * 18;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, s, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex }));
  ground.name = 'ground';
  return ground;
}
