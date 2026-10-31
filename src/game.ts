import * as THREE from 'three';
import { Actor, loadModel, modelLoaded } from './assets';
import { audio } from './audio';
import { BUFF, buffEffects, isBuffMonster, type BuffKey } from './buffs';
import { MAX_CHAMPION_LEVEL, SKILL_KEYS, type AttackProp, type BoneVfx, type ChampionDef, type ChampionKit, type Hit, type SkillKey } from './champion';
import { DEFAULT_CHAMPION } from './champions';
import {
  DIRECTOR, DRAGONS, ENEMIES, ENEMY_ARMOR, ENEMY_MISSILE_EXTRA_RANGE, ENEMY_MR, EVENTS, enemyArmorScale, enemyDamageScale, enemyHpScale, HORDE,
  boundSize, CROWD_RANGE, HP_REGEN_MULT, MAX_ENEMIES, POOL, RUN_LENGTH, xpToNext, type EnemyDef,
} from './data';
import { AI, SPAWNERS, type EnemyAI } from './enemies';
import { Hazards } from './hazards';
import { ITEM_PASSIVES, type FxStat, type ItemEffect } from './itemEffects';
import {
  BLUEPRINT_CHANCE, BOOT_UPGRADES, BOOTS, BOOTS_AT, BOOTS_FIRST, buildComplete, describeStats, itemIcon, MAX_ITEMS, MAX_LEVEL, PASSIVE_POWER, PLATING, POTION,
  sumStats, type Slot,
} from './items';
import { loadMapPieces, loadMapTextures, WorldMap } from './map';
import { emptyPage, type Page } from './progress';
import { runeEffects } from './runes';
import { SpatialGrid } from './spatial';
import { t } from './i18n';
import { compact, TimeWindow } from './util';
import { animEvents, facingQuat, type ClipEvent, type ParticleSystem } from './particles';
import { loadVfx, Vfx, type MissileFx } from './vfx';

const SPAWN_RADIUS = 1800;
const BASIC_LEVELS = [1, 3, 5, 7, 9], ULT_LEVELS = [6, 11, 16]; // LoL skill point rules (ChampionDef.rankLevels)
const FLASH = { range: 400, cooldown: 120 };
// the enemy side (attacks, animations, boss AIs and hazards, enemy missiles, spawn rate) speeds up from x1 at
// 0:00 to x1.5 at 5:00, then stays; the clock, cooldowns, buffs and the champion keep real time
const PACE = { ramp: 300, max: 1.5 };
const ENEMY_SPEED_CAP = 0.9; // non-epic enemies move at most this share of the champion's base move speed
const CAMPING = { ramp: 5, max: 5 }; // standing still: damage taken grows to x5 (after armor) over 5 s
const BASE_MR = 30, BASE_MR_PER_LEVEL = 1.3; // LoL marksmen and mages: no champion file lists MR
const DESPAWN_RADIUS = 3600;
const AIR_HEIGHT = 220; // peak of an enemy knock-up arc (Game.knockUp)
const AIM_FAR = 5000; // 'move' aim: farther than any dash or blink
const GRID_CELL = 150;
const GRID_SLACK = 60; // enemies keep moving after the grid is built; queries widen by this much
// animation LOD: skinning is most of the frame, so enemies this far from the champion (screen edge and beyond)
// advance their mixer every ANIM_LOD_STEP frames with the accumulated time
const ANIM_LOD_DIST = 1400;
const ANIM_LOD_STEP = 3;
// view culling: an enemy whose bounding sphere (radius × VIEW_RADIUS + VIEW_MARGIN around its body) is outside the
// camera view is neither drawn nor animated (its animation time accumulates for when it comes back into view)
const VIEW_HEIGHT = 100;
const VIEW_RADIUS = 3;
const VIEW_MARGIN = 200;
const _sphere = new THREE.Sphere();
/** Sound key prefix of an enemy: the drakes share one bank for spawn/death. */
const voice = (def: EnemyDef) => (def.model.startsWith('dragon_') ? 'dragon' : def.model);
const PREFETCH = 60; // seconds before the timeline can first spawn an enemy that its model starts downloading
const RETRY = 5; // seconds before a failed enemy download is asked for again
/** Whether an enemy's model is loaded: until then the spawn director and the events skip or wait for it. */
const ready = (key: string) => modelLoaded(ENEMIES[key].model);

/** LoL per-level stat growth formula. */
const grow = (base: number, perLevel: number, level: number) => {
  const n = Math.min(level, MAX_CHAMPION_LEVEL) - 1;
  return base + perLevel * n * (0.7025 + 0.0175 * n);
};

export interface Enemy {
  id: number; // spawn order: unit collision visits each pair once
  def: EnemyDef;
  actor: Actor;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  attackTimer: number;
  windup: number; // seconds left in attack windup, <0 when not attacking
  deadFor: number; // seconds since death, <0 while alive
  armor: number;
  shred: number; // Black Cleaver stacks
  shredUntil: number;
  mr: number; // magic resist
  mrShred: number; // Bloodletter's Curse stacks
  mrShredUntil: number;
  slowPct: number; // movement slow while time < slowUntil
  slowUntil: number;
  slowFade: number; // > 0: the slow fades linearly to nothing over its last slowFade seconds
  stunUntil: number; // no moving nor attacking while time < stunUntil (generic loop only: EnemyAI bosses ignore it)
  rootUntil: number; // no moving (still attacks) while time < rootUntil (generic loop only, like stunUntil)
  blindUntil: number; // basic attacks miss while time < blindUntil (generic loop only, like stunUntil)
  airUntil: number; // knocked up: the model arcs into the air while time < airUntil (Game.knockUp)
  airFor: number; // length of that knock-up
  push?: { x: number; z: number; done: number }; // knocked back (Game.knockBack): ground offset and the share of it applied
  ai?: EnemyAI; // own behaviour (src/enemies), replaces the generic chase-and-attack loop
  animDt: number; // animation time not yet applied (animation LOD)
}

export interface Missile {
  mesh: THREE.Object3D;
  fx: MissileFx;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  travelled: number;
  range: number;
  radius: number;
  damage: number;
  hit?: Hit; // what it deals to enemies; missiles without it are hostile and hit the champion
  arc?: number; // targeted missiles: peak height over the straight path (lobbed shots)
  target?: Enemy; // homing
  pierce?: Set<Enemy>; // flies through, hitting each enemy once
  hitFx?: string;
  hitSound?: string;
  onHit?: (e: Enemy, m: Missile) => void; // replaces the default impact (Game.impact)
}

export interface MissileOpts {
  speed: number; range: number; radius: number; damage: number;
  hit?: Hit; target?: Enemy; pierce?: boolean; height?: number; arc?: number;
  hitFx?: string; hitSound?: string; onHit?: Missile['onHit'];
}

/**
 * What a run save keeps (src/runSave.ts): the champion's progress and the run's timeline. Enemies, missiles and the
 * map are not kept: loading starts on a fresh map around the champion, the director spawns from the saved clock.
 */
export interface RunSnapshot {
  time: number; kills: number; level: number; xp: number; hp: number; mana: number;
  ranks: Record<SkillKey, number>; cooldowns: Record<SkillKey, number>;
  slots: Slot[]; legendary: number; boots: string | null; dragonSlain: boolean; blueprintDropped: boolean;
  buffs: Record<BuffKey, number>; buffSpawnAt: Record<BuffKey, number>; bonusRunePoints: number; flashReady: number;
  nextEvent: number; nextHordeAt: number; dragon: string; pendingLevelUps: number; autoAttack: boolean;
  fx: { items: Record<string, unknown>; runes: unknown[] }; // ItemEffect.saved of the owned items (by id) and runes (page order)
}

/** A popup a rune asks the player to pick from (shown between frames, like level ups). */
export interface Choice { title: string; options: { name: string; text: string; icon: string; run: () => void }[] }

/** Floating combat text (damage dealt/taken, XP), rendered by the HUD. */
export interface Floater { pos: THREE.Vector3; text: string; kind: 'physical' | 'magic' | 'crit' | 'taken' | 'xp'; age: number }

const ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const glow = (color: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

export class Game {
  readonly scene = new THREE.Scene();
  readonly vfx = new Vfx(this.scene);
  readonly hazards = new Hazards(this.scene);
  time = 0;
  kills = 0;
  paused = false;
  over: 'won' | 'lost' | null = null;
  readonly winAt = new THREE.Vector3(); // where the run was won (the slain boss), for the victory cinematic

  // champion state
  player!: Actor;
  kit!: ChampionKit;
  pos = new THREE.Vector3();
  facing = 0;
  level = 1;
  xp = 0;
  hp = 0;
  mana = 0;
  ranks: Record<SkillKey, number> = { Q: 0, W: 0, E: 0, R: 0 };
  cooldowns: Record<SkillKey, number> = { Q: 0, W: 0, E: 0, R: 0 };
  slots: Slot[] = [];
  inventory: string[] = []; // item id of each slot
  legendary = -1; // slot upgraded by the blueprint
  boots: string | null = null; // the boot slot (BOOTS), outside the six
  private dragonSlain = false; // tier 3 boots: given when the tier 2 pick comes after the dragon
  items = sumStats([]);
  private owned = new Set<string>();
  private itemFx: ItemEffect[] = []; // hooks of the owned items and equipped runes
  page: Page = emptyPage(); // rune page of this run
  private runeFx: ItemEffect[] = [];
  private buffFx: ItemEffect[] = [];
  buffs: Record<BuffKey, number> = { blue: 0, red: 0 }; // run time each jungle buff ends
  private buffSpawnAt: Record<BuffKey, number> = { blue: BUFF.firstSpawn, red: BUFF.firstSpawn }; // Infinity while alive
  lastHurtAt = -Infinity; // run time of the last damage taken (red buff regen)
  stillFor = 0; // seconds the champion has stood still (CAMPING)
  private crowd = 0; // enemies in contact with the champion last frame (enemyDamageScale)
  private buffDrops: { key: BuffKey; mesh: THREE.Object3D; until: number }[] = []; // dropped buffs waiting to be picked up
  shield = 0;
  private shieldUntil = 0;
  choices: Choice[] = []; // rune popups waiting to be shown
  bonusRunePoints = 0; // extra rune points earned this run (Treasure Hunter)
  flashReady = 0; // Hextech Flashtraption cooldown end (run time)
  private fxCache = new Map<string, ItemEffect>(); // effect state outlives changes to the other slots
  private blueprintDropped = false; // at most one blueprint per run
  private blueprint: THREE.Object3D | null = null; // scroll lying on the ground
  autoAttack = true;
  focus: Enemy | null = null; // right-click focus target
  view: THREE.Frustum | null = null; // the camera's last view (main.ts), for culling enemies; null draws them all
  manualTarget: Enemy | null = null; // left-click target when auto attack is off
  pendingLevelUps = 1; // LoL grants a skill point at level 1
  private attackTimer = 0;
  private windup = -1;
  private windupTarget: Enemy | null = null;
  private windupProp: AttackProp | null = null; // a kit object being swung at (ChampionKit.attackProp)
  private pendingCrit = false;
  private pendingMelee = false;
  private attackIndex = 0;
  private castLock = 0;
  private idleFx: ParticleSystem[] = []; // ChampionDef.idleVfx, stopped on death
  private animLock = 0;
  private pendingCast: { key: SkillKey; point: THREE.Vector3 } | null = null;
  private dashMove: { dir: THREE.Vector3; left: number; speed: number; length: number; height: number } | null = null; // forced movement (dash)
  stasis = 0; // frozen and untargetable (Guardian Angel)
  private stasisEnd: (() => void) | null = null;
  stunned = 0; // seconds of crowd control left
  private stunLength = 0;
  private airborne = true; // knock-ups arc into the air; drags stay on the ground
  arena: { center: THREE.Vector3; radius: number; mesh: THREE.Object3D } | null = null; // walls block walking out

  enemies: Enemy[] = [];
  private aliveCount = 0;
  private epics: Enemy[] = [];
  private nextId = 0;
  private grid = new SpatialGrid<Enemy>(GRID_CELL);
  private maxEnemyRadius = 0;
  private near: Enemy[] = []; // query scratch arrays, one per caller that may overlap another
  private nearSep: Enemy[] = [];
  private nearMissile: Enemy[] = [];
  private tmp = new THREE.Vector3();
  private frame = 0;
  private missiles: Missile[] = [];
  floaters: Floater[] = [];
  private nextEvent = 0;
  // spawn director state
  private spawnBudget = 0;
  private spawnLog = new TimeWindow(DIRECTOR.window);
  private killLog = new TimeWindow(DIRECTOR.window);
  nextHordeAt = HORDE.every;
  private map!: WorldMap;
  private focusRing = new THREE.Mesh(ringGeo, glow(0xff3030));
  private vfxFor = ''; // champion whose particle systems are loaded
  private requested = new Set<string>(); // enemies whose download started (kept across runs, like the model cache)
  dragon = DRAGONS[0].model; // this run's drake, rolled in reset()

  constructor(public champ: ChampionDef = DEFAULT_CHAMPION) {
    // same colour as the background, hides the edge of the loaded chunks
    this.scene.fog = new THREE.Fog(0x0b1410, 5000, 9500);
  }

  /** Loads another champion's model and VFX; the next reset() spawns it. */
  async setChampion(c: ChampionDef) {
    // the particle systems are one champion's at a time (loadVfx replaces them)
    const vfx = this.vfxFor === c.id ? null : loadVfx(`assets/vfx/${c.id}/`);
    await Promise.all([vfx, loadModel(c.model, c.hide, c.model, { textures: c.textures, sequences: c.sequences, translucent: c.translucent }), audio.loadPrefix(c.id)]);
    this.vfxFor = c.id;
    this.champ = c;
  }

  /**
   * Map and the enemies of the first seconds; the champion loads once picked (setChampion), the other enemies
   * PREFETCH seconds before they can appear (prefetch). Call setChampion and reset before the first update.
   */
  async load(onProgress: (done: number, total: number) => void) {
    const starters = [...new Set([...POOL.filter((p) => p.from === 0).map((p) => p.enemy), ...BUFF.keys])];
    let done = 0;
    await Promise.all([
      audio.load(),
      ...starters.map((key) => {
        this.requested.add(key);
        return this.loadEnemy(key).then(() => onProgress(++done, starters.length));
      }),
    ]);
    this.scene.background = new THREE.Color(0x0b1410);
    const [{ textures, water }, pieces] = await Promise.all([loadMapTextures(), loadMapPieces()]);
    this.map = new WorldMap(this.scene, textures, pieces, Math.random, water);
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);
  }

  private loadEnemy(key: string) {
    const def = ENEMIES[key];
    return Promise.all([loadModel(def.model, def.hide, def.mesh), audio.loadPrefix(voice(def))]);
  }

  /** Starts downloading the enemies the timeline (POOL, EVENTS) can spawn within PREFETCH seconds. */
  private prefetch() {
    const due = (at: number) => this.time >= at - PREFETCH;
    for (const p of POOL) if (due(p.from)) this.want(p.enemy);
    for (const e of EVENTS) if (due(e.at)) this.want(this.eventEnemy(e.enemy));
  }

  private want(key: string) {
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.loadEnemy(key).catch(() => setTimeout(() => this.requested.delete(key), RETRY * 1000));
  }

  /** The enemy an event spawns: the 'dragon' event (SPAWNERS.dragon) spawns this run's rolled drake. */
  private eventEnemy(key: string) {
    return key === 'dragon' ? this.dragon : key;
  }

  reset(page: Page = emptyPage()) {
    for (const e of this.enemies) { e.actor.dispose(); e.ai?.dispose?.(); }
    for (const m of this.missiles) m.mesh.removeFromParent();
    this.kit?.dispose?.();
    this.hazards.clear();
    this.arena?.mesh.removeFromParent();
    this.blueprint?.removeFromParent();
    this.blueprint = null;
    for (const d of this.buffDrops) d.mesh.removeFromParent();
    this.map?.dispose(); // the next ensureChunks regenerates the chunks
    this.vfx.clear();
    this.player?.dispose();
    Object.assign(this, {
      time: 0, kills: 0, over: null, paused: false, level: 1, xp: 0, facing: 0,
      focus: null, manualTarget: null, pendingLevelUps: 1,
      attackTimer: 0, windup: -1, windupTarget: null, windupProp: null, castLock: 0, animLock: 0, pendingCast: null, dashMove: null,
      enemies: [], aliveCount: 0, epics: [], nextId: 0, missiles: [], floaters: [], nextEvent: 0, spawnBudget: 0,
      nextHordeAt: HORDE.every, legendary: -1, boots: null, dragonSlain: false, blueprintDropped: false,
      stasis: 0, stasisEnd: null, stunned: 0, stunLength: 0, airborne: true, arena: null,
      page, shield: 0, shieldUntil: 0, choices: [], bonusRunePoints: 0, flashReady: 0,
      buffs: { blue: 0, red: 0 }, buffDrops: [], crowd: 0, lastHurtAt: -Infinity, stillFor: 0,
      buffSpawnAt: { blue: BUFF.firstSpawn, red: BUFF.firstSpawn },
      dragon: DRAGONS[Math.floor(Math.random() * DRAGONS.length)].model,
    });
    this.runeFx = runeEffects(this, page); // fresh every run: rune stacks never carry over
    this.buffFx = buffEffects(this);
    this.spawnLog.clear();
    this.killLog.clear();
    this.grid.clear();
    this.fxCache.clear();
    this.setSlots([]);
    this.ranks = { Q: 0, W: 0, E: 0, R: 0 };
    this.cooldowns = { Q: 0, W: 0, E: 0, R: 0 };
    this.pos.set(0, 0, 0);
    this.player = new Actor(this.champ.model, this.champ.scale);
    if (this.champ.conformPath) this.player.conformToPath(...this.champ.conformPath);
    this.scene.add(this.player.root);
    this.kit = this.champ.kit(this);
    this.idleFx = (this.champ.idleVfx ?? []).flatMap((v) => this.boneVfx(v, true) ?? []);
    if (this.champ.animVfx) {
      this.player.events = animEvents();
      this.player.onEvent = (ev) => { for (const b of (ev as ClipEvent).bones) this.boneVfx([(ev as ClipEvent).key, b], false); };
    }
    this.autoRankUp();
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.player.play(this.moveAnims.idle);
  }

  /** The run's state for a save (RunSnapshot). */
  snapshot(): RunSnapshot {
    // an event monster still alive (a boss mid-fight) is fought again from full HP after loading
    const live = EVENTS.findIndex((ev, i) => i < this.nextEvent
      && this.enemies.some((e) => e.deadFor < 0 && e.def === ENEMIES[this.eventEnemy(ev.enemy)]));
    // a buff monster alive now (spawn time Infinity, which JSON can't hold) respawns right after loading
    const respawn = (at: number) => Math.min(at, this.time);
    return {
      time: this.time, kills: this.kills, level: this.level, xp: this.xp, hp: this.hp, mana: this.mana,
      ranks: { ...this.ranks }, cooldowns: { ...this.cooldowns },
      slots: this.slots, legendary: this.legendary, boots: this.boots, dragonSlain: this.dragonSlain,
      blueprintDropped: this.blueprintDropped && !this.blueprint, // a scroll still on the ground drops again
      buffs: { ...this.buffs }, buffSpawnAt: { blue: respawn(this.buffSpawnAt.blue), red: respawn(this.buffSpawnAt.red) },
      bonusRunePoints: this.bonusRunePoints, flashReady: this.flashReady,
      nextEvent: live < 0 ? this.nextEvent : live, nextHordeAt: this.nextHordeAt, dragon: this.dragon,
      pendingLevelUps: this.pendingLevelUps, autoAttack: this.autoAttack,
      fx: {
        items: Object.fromEntries(this.slots.flatMap(({ id }) => {
          const fx = this.fxCache.get(id);
          return fx?.saved ? [[id, fx.saved()]] : [];
        })),
        runes: this.runeFx.map((fx) => fx.saved?.() ?? null),
      },
    };
  }

  /** Puts a saved run back, right after reset() with the run's rune page (same champion). */
  restore(s: RunSnapshot) {
    const { slots, fx, hp, mana, ...rest } = s;
    Object.assign(this, rest);
    this.setSlots(slots);
    for (const [id, v] of Object.entries(fx.items)) this.fxCache.get(id)?.restore?.(v);
    fx.runes.forEach((v, i) => { if (v !== null) this.runeFx[i]?.restore?.(v); });
    this.hp = Math.max(1, Math.min(this.maxHp, hp));
    this.mana = Math.min(this.maxMana, mana);
  }

  /** Idle and run clips right now (the kit's, e.g. per weapon, else the champion's). */
  private get moveAnims() { return this.kit.moveAnims?.() ?? this.champ.anims; }

  /** Plays a champion system on one of its bones (`loop`: until stopped); null when the bone or system is missing. */
  private boneVfx([key, name]: BoneVfx, loop: boolean) {
    const bone = this.player.bone(name);
    if (!bone) return null;
    return this.vfx.play(key, bone.getWorldPosition(this.tmp), facingQuat(this.facing), { bone, owner: this.player.root, ...(loop && { until: undefined }) });
  }

  // ---- derived stats ----
  get baseHp() { const B = this.champ.base; return grow(B.hp, B.hpPerLevel, this.level); }
  /** Sum of a stat over item and rune effects (on top of item stats). */
  fxStat(k: FxStat) {
    let v = this.kit?.stat?.(k) ?? 0;
    for (const fx of this.itemFx) if (fx.stat) v += fx.stat(k);
    return v;
  }
  get maxHp() { return this.baseHp + this.items.hp + this.fxStat('hp'); }
  get maxMana() { const B = this.champ.base; return grow(B.mana, B.manaPerLevel, this.level) + this.items.mana + this.fxStat('mana'); }
  get baseAd() { const B = this.champ.base; return grow(B.ad, B.adPerLevel, this.level); }
  /** Bonus AD from item stats and item passives (e.g. Manamune). */
  get bonusAd() {
    let ad = this.items.ad + this.fxStat('ad');
    for (const fx of this.itemFx) if (fx.bonusAd) ad += fx.bonusAd();
    return ad;
  }
  get ad() { return this.baseAd + this.bonusAd; }
  get ap() { return this.items.ap + this.fxStat('ap'); }
  get attackSpeed() {
    const B = this.champ.base;
    const bonus = grow(0, B.attackSpeedPerLevel, this.level) + this.items.as + this.fxStat('as') + (this.kit.attackSpeedBonus?.() ?? 0);
    return Math.min(2.5, B.attackSpeed * (1 + bonus));
  }
  get moveSpeed() { return Math.round((this.champ.base.moveSpeed + this.items.ms) * (1 + this.items.msPct + this.fxStat('msPct') + (this.kit.moveSpeedBonus?.() ?? 0))); }
  get critChance() { return Math.min(1, this.items.crit + this.fxStat('crit')); }
  get armor() { const B = this.champ.base; return grow(B.armor, B.armorPerLevel, this.level) + this.items.armor + this.fxStat('armor'); }
  get mr() { return grow(BASE_MR, BASE_MR_PER_LEVEL, this.level) + this.items.mr + this.fxStat('mr'); }
  get abilityHaste() { return this.items.ah + this.fxStat('ah'); }
  get attackRange() { return this.champ.base.attackRange + this.fxStat('range'); }
  /** Center distance within which an enemy can be in attack range. */
  get attackReach() { return this.attackRange + this.champ.base.radius; }
  get alive() { return this.hp > 0; }
  has(id: string) { return this.owned.has(id); }
  cooldownOf(key: SkillKey) {
    const haste = this.abilityHaste + this.fxStat(key === 'R' ? 'ultHaste' : 'basicHaste');
    const base = this.kit.cooldownBase?.(key) ?? this.champ.skills[key].cooldown[Math.max(0, this.ranks[key] - 1)];
    return base * (100 / (100 + haste));
  }
  /** Whether a skill can be cast: it has a rank, or its unlock level came (SkillDef.unlockLevel, ranks then buy stats). */
  learned(key: SkillKey) {
    const unlock = this.champ.skills[key].unlockLevel;
    return unlock === undefined ? this.ranks[key] > 0 : this.level >= unlock;
  }
  costOf(key: SkillKey) { return this.champ.skills[key].cost[Math.max(0, this.ranks[key] - 1)]; }

  // ---- level up ----
  /** Skill point rules: the level each rank unlocks (ChampionDef.rankLevels, LoL default basic 1/3/5/7/9, R 6/11/16). */
  canRankUp(key: SkillKey) {
    const r = this.ranks[key];
    if (r >= this.champ.skills[key].maxRank) return false;
    return this.level >= (this.champ.rankLevels?.[key] ?? (key === 'R' ? ULT_LEVELS : BASIC_LEVELS))[r];
  }

  skillOptions() { return SKILL_KEYS.filter((k) => this.canRankUp(k) && !this.champ.autoRank?.includes(k)); }

  /** Ranks the skills that level up on their own (ChampionDef.autoRank). */
  private autoRankUp() {
    for (const k of this.champ.autoRank ?? []) while (this.canRankUp(k)) this.ranks[k]++;
  }

  rankUp(key: SkillKey) { this.ranks[key]++; }

  /** Change the inventory, keeping current HP/mana in step with the max values (like buying in LoL). */
  private setSlots(slots: Slot[]) {
    const hpBefore = this.maxHp, manaBefore = this.maxMana;
    this.slots = slots;
    this.inventory = slots.map((s) => s.id);
    this.owned = new Set(this.inventory);
    this.items = sumStats(slots, this.legendary, this.boots);
    this.itemFx = this.activeEffects();
    this.hp = Math.max(1, Math.min(this.maxHp, this.hp + this.maxHp - hpBefore));
    this.mana = Math.max(0, Math.min(this.maxMana, this.mana + this.maxMana - manaBefore));
  }

  /** One effect per owned item with hooks and its passive unlocked; of each UNIQUE group only the highest rank. */
  private activeEffects() {
    const out: ItemEffect[] = [];
    const best = new Map<string, ItemEffect>();
    for (const { id, level } of this.slots) {
      const make = ITEM_PASSIVES[id]?.effect;
      if (!make || !PASSIVE_POWER[level - 1]) continue;
      let fx = this.fxCache.get(id);
      if (!fx) this.fxCache.set(id, (fx = make(this, () => this.passivePower(id))));
      if (!fx.unique) out.push(fx);
      else if ((best.get(fx.unique)?.rank ?? -Infinity) < (fx.rank ?? 0)) best.set(fx.unique, fx);
    }
    return [...out, ...best.values(), ...this.runeFx, ...this.buffFx];
  }

  /** Strength (0..1) of an owned item's passive at its current level. */
  passivePower(id: string) {
    const s = this.slots.find((x) => x.id === id);
    return s ? PASSIVE_POWER[s.level - 1] : 0;
  }
  takeItem(id: string) {
    if (this.slots.length >= MAX_ITEMS || this.owned.has(id)) return;
    this.setSlots([...this.slots, { id, level: 1 }]);
    audio.play('hud_item');
  }
  /** One more level for slot i. */
  levelItem(i: number) {
    this.setSlots(this.slots.map((s, j) => (j === i ? { ...s, level: Math.min(MAX_LEVEL, s.level + 1) } : s)));
    audio.play('hud_item');
  }
  drinkPotion(kind: keyof typeof POTION) {
    let mult = 1;
    for (const fx of this.itemFx) if (fx.potionMult) mult *= fx.potionMult();
    if (kind === 'hp') this.heal(POTION.hp * this.maxHp * mult);
    else this.mana = Math.min(this.maxMana, this.mana + POTION.mana * this.maxMana * mult);
  }

  /** Healing goes through here so heal/shield power (Revitalize) applies. */
  heal(amount: number) {
    if (!this.alive) return;
    const healed = this.hp + amount * (1 + this.fxStat('healMult'));
    this.hp = Math.min(this.maxHp, healed);
    if (healed > this.hp) for (const fx of this.itemFx) fx.onOverheal?.(healed - this.hp);
  }
  addShield(amount: number, seconds: number) {
    this.shield += amount * (1 + this.fxStat('healMult'));
    this.shieldUntil = Math.max(this.shieldUntil, this.time + seconds);
    for (const fx of this.itemFx) fx.onShield?.();
  }
  /** `fade`: the slow decays to nothing over `seconds` instead of holding (e.g. Command: Dissonance after leaving its field). */
  slow(e: Enemy, pct: number, seconds: number, fade = false) {
    if (fade || e.slowFade > 0) {
      if (pct < this.slowAmount(e)) return; // a stronger slow is running
      e.slowPct = pct;
      e.slowUntil = this.time + seconds;
      e.slowFade = fade ? seconds : 0;
      return;
    }
    e.slowPct = Math.max(this.isSlowed(e) ? e.slowPct : 0, pct);
    e.slowUntil = Math.max(e.slowUntil, this.time + seconds);
  }
  isSlowed(e: Enemy) { return e.slowUntil > this.time; }
  /** Movement slow of `e` right now (0..1). */
  slowAmount(e: Enemy) {
    if (!this.isSlowed(e)) return 0;
    return e.slowFade > 0 ? e.slowPct * Math.min(1, (e.slowUntil - this.time) / e.slowFade) : e.slowPct;
  }
  /** Root: the enemy cannot move for `seconds` but still attacks (generic loop only, like stunEnemy). */
  rootEnemy(e: Enemy, seconds: number) { e.rootUntil = Math.max(e.rootUntil, this.time + seconds); }
  /** Blind: the enemy's basic attacks miss for `seconds` (generic loop only, like stunEnemy). */
  blindEnemy(e: Enemy, seconds: number) { e.blindUntil = Math.max(e.blindUntil, this.time + seconds); }
  stunEnemy(e: Enemy, seconds: number) {
    e.stunUntil = Math.max(e.stunUntil, this.time + seconds);
    e.windup = -1;
  }
  /** Knock-up: a stun that throws the enemy's model into the air and lands it when it ends. */
  knockUp(e: Enemy, seconds: number) {
    this.stunEnemy(e, seconds);
    if (e.airUntil > this.time) return; // already airborne: keep its arc
    e.airUntil = this.time + seconds;
    e.airFor = seconds;
  }
  /** Knock-back: a knock-up that also carries the enemy by `offset` (ground plane) while airborne; walls stop it. */
  knockBack(e: Enemy, offset: THREE.Vector3, seconds: number) {
    e.airUntil = 0; // a new knock-back restarts the arc
    this.knockUp(e, seconds);
    e.push = { x: offset.x, z: offset.z, done: 0 };
  }
  inWater() { return this.map.inWater(this.pos.x, this.pos.z); }

  get hasFlash() { return [...this.page.primaryRunes, ...this.page.secondaryRunes].includes('hextech-flashtraption'); }
  /** Hextech Flashtraption: blink up to FLASH.range towards `point`. */
  flash(point: THREE.Vector3) {
    if (!this.hasFlash || this.time < this.flashReady || !this.alive || this.stasis > 0 || this.stunned > 0) return;
    const step = this.tmp.copy(point).sub(this.pos).setY(0);
    if (step.length() > FLASH.range) step.setLength(FLASH.range);
    this.pos.add(step);
    this.collidePlayer();
    this.faceTowards(point);
    this.flashReady = this.time + FLASH.cooldown;
  }

  float(pos: THREE.Vector3, text: string, kind: Floater['kind']) {
    if (this.floaters.length < 150) this.floaters.push({ pos: pos.clone(), text, kind, age: 0 });
  }

  private gainXp(v: number) {
    for (const fx of this.itemFx) if (fx.xpMult) v *= fx.xpMult();
    this.xp += v;
    this.float(this.pos, `+${Math.round(v)} XP`, 'xp');
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      const hpBefore = this.maxHp, manaBefore = this.maxMana;
      this.level++;
      this.hp += this.maxHp - hpBefore;
      this.mana += this.maxMana - manaBefore;
      this.pendingLevelUps++;
      this.autoRankUp();
      for (const fx of this.itemFx) fx.onLevel?.();
      audio.play('hud_levelup');
    }
  }

  // ---- input ----
  enemyAt(point: THREE.Vector3) {
    let best: Enemy | null = null, bestD = Infinity;
    for (const e of this.enemiesNear(point, 60)) {
      if (e.deadFor >= 0) continue;
      const d = e.pos.distanceTo(point) - e.def.radius;
      if (d < 60 && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  cast(key: SkillKey, point: THREE.Vector3) {
    const skill = this.champ.skills[key];
    if (!this.alive || (this.stunned > 0 && !skill.cleanse) || !this.learned(key) || this.castLock > 0) return;
    if (this.cooldowns[key] > 0) return this.kit.recast?.(key, point);
    if (this.mana < this.costOf(key) || this.kit.canCast?.(key) === false) return;
    if (skill.cleanse) this.cleanse();
    this.mana -= this.costOf(key);
    this.cooldowns[key] = this.cooldownOf(key);
    for (const fx of this.itemFx) fx.onCast?.();
    this.windup = -1; // casting cancels an attack windup
    this.faceTowards(point);
    const castTime = this.kit.castTime?.(key) ?? skill.castTime;
    this.castLock = castTime;
    this.pendingCast = { key, point: point.clone() };
    const anim = this.kit.castAnim?.(key, point) ?? skill.anim;
    this.player.play(anim, { loop: false, restart: true, fade: 0.05 });
    this.kit.castStart?.(key, point);
    audio.play(`${this.champ.id}_${key}`);
    this.animLock = Math.min(this.player.duration(anim), castTime + 0.6);
  }

  /** The player gave a new move order (main.ts: click on the ground, arrow key or joystick pressed). */
  moveOrder() { this.kit.onMoveOrder?.(); }

  /** True while the kit walks the champion on its own (`ChampionKit.steer`): main.ts drops the old click target. */
  get steering() { return this.kit.steer?.() !== undefined; }

  /**
   * Cast point while moving with the arrow keys (SkillDef.aim): the auto-aimed enemy, else `moveDir` from the champion
   * (at the aim range, or AIM_FAR for 'move' so the kit's own range caps it). Null for 'none': keep the cursor.
   */
  aimPoint(key: SkillKey, moveDir: THREE.Vector3): THREE.Vector3 | null {
    const aim = this.champ.skills[key].aim;
    if (aim === 'none') return null;
    if (aim !== 'move') {
      const target = this.aimTarget(aim);
      if (target) return target.pos.clone();
    }
    return this.pos.clone().addScaledVector(moveDir, aim === 'move' ? AIM_FAR : aim);
  }

  /** Same priority as auto attacks: the marked target if within `range` (edge distance), else the nearest enemy. */
  aimTarget(range: number): Enemy | null {
    const marked = this.autoAttack ? this.focus : this.manualTarget;
    if (marked && marked.deadFor < 0 && marked.pos.distanceTo(this.pos) - marked.def.radius <= range) return marked;
    return this.nearestEnemy(this.pos, range);
  }

  // ---- simulation ----
  update(dt: number, move: THREE.Vector3) {
    if (this.paused || this.over) {
      if (this.over) { // let the death animations finish (the champion's, or Baron's under the victory cinematic)
        this.map.ensureChunks(this.pos);
        this.player.update(dt);
        for (const e of this.enemies) if (e.deadFor >= 0) e.actor.update(dt);
        this.vfx.update(dt);
      }
      return;
    }
    this.map.ensureChunks(this.pos);
    this.time += dt;
    const fast = dt * this.pace; // enemy-side time (PACE)
    this.spawn(fast);
    this.horde();
    this.respawnBuffMonsters();
    this.updatePlayer(dt, move);
    this.updateEnemies(fast);
    this.updateMissiles(dt);
    this.kit.update?.(dt);
    this.hazards.update(fast, this.alive && this.stasis <= 0);
    this.updateBlueprint(dt);
    if (!this.boots && this.time >= BOOTS_AT) this.setBoots(BOOTS_FIRST);
    this.updateBuffDrops(dt);
    this.map.update(dt);
    this.vfx.update(dt);
    for (const f of this.floaters) f.age += dt;
    compact(this.floaters, (f) => f.age < 0.9);
    if (this.focus && this.focus.deadFor >= 0) this.focus = null;
    this.focusRing.visible = !!this.focus;
    if (this.focus) {
      this.focusRing.position.set(this.focus.pos.x, 3, this.focus.pos.z);
      this.focusRing.scale.setScalar(this.focus.def.radius + 25);
    }
  }

  /** Enemy-side speed: x1 at the start, PACE.max from PACE.ramp seconds on. */
  get pace() { return 1 + (PACE.max - 1) * Math.min(1, this.time / PACE.ramp); }

  /** Puts `id` in the boot slot (BOOTS), keeping HP/mana in step like an item. */
  setBoots(id: string) {
    this.boots = id;
    this.setSlots(this.slots);
    this.float(this.pos, t('float.boots', { item: BOOTS[id].name }), 'crit');
    audio.play('hud_item');
  }

  /** Rift Scuttler slain: pick the tier 2 boots (straight to its tier 3 when the dragon already fell). */
  private offerBoots() {
    this.choices.push({
      title: t('boots.choose', { monster: ENEMIES.scuttle.name ?? '' }),
      options: Object.keys(BOOT_UPGRADES).map((id) => ({
        name: BOOTS[id].name, icon: itemIcon(id),
        text: [describeStats(BOOTS[id].stats), PLATING.has(id) ? t('boots.plating') : ''].filter(Boolean).join(' · '),
        run: () => this.setBoots(this.dragonSlain ? BOOT_UPGRADES[id] : id),
      })),
    });
  }

  /** Blueprint scroll: bobs on the ground until the champion walks over it, then a random max-level item turns legendary. */
  private updateBlueprint(dt: number) {
    const bp = this.blueprint;
    if (!bp) return;
    bp.rotation.y += dt * 1.5;
    bp.children[0].position.y = 60 + 15 * Math.sin(this.time * 3);
    if (bp.position.distanceTo(this.pos) > this.champ.base.radius + 60) return;
    bp.removeFromParent();
    this.blueprint = null;
    const maxed = this.slots.flatMap((s, i) => (s.level >= MAX_LEVEL ? [i] : []));
    this.legendary = maxed[Math.floor(Math.random() * maxed.length)];
    this.setSlots(this.slots);
    this.float(this.pos, t('float.legendaryItem'), 'crit');
    audio.play('hud_legendary');
  }

  /** Jungle buff drops: picked up by walking over them, gone after BUFF.dropLife seconds. */
  private updateBuffDrops(dt: number) {
    compact(this.buffDrops, (d) => {
      d.mesh.rotation.y += dt * 1.5;
      d.mesh.children[0].position.y = 60 + 15 * Math.sin(this.time * 3);
      const picked = this.alive && d.mesh.position.distanceTo(this.pos) <= this.champ.base.radius + 60;
      if (picked) {
        this.buffs[d.key] = this.time + BUFF.duration;
        this.float(this.pos, BUFF.names[d.key], 'crit');
        audio.play('hud_item');
      }
      return !(picked || this.time >= d.until) || this.removeMesh(d.mesh);
    });
  }

  private updatePlayer(dt: number, move: THREE.Vector3) {
    const B = this.champ.base, anims = this.moveAnims;
    if (this.stasis > 0) {
      this.stasis -= dt;
      if (this.stasis <= 0) {
        const end = this.stasisEnd;
        this.stasisEnd = null;
        end?.();
      }
      return;
    }
    if (!this.alive) return;
    if (this.time >= this.shieldUntil) this.shield = 0;
    this.hp = Math.min(this.maxHp, this.hp + ((grow(B.hpRegen5, B.hpRegen5PerLevel, this.level) * HP_REGEN_MULT) / 5) * dt);
    this.mana = Math.min(this.maxMana, this.mana + (grow(B.manaRegen5, B.manaRegen5PerLevel, this.level) / 5) * dt);
    for (const fx of this.itemFx) fx.tick?.(dt);
    for (const k of SKILL_KEYS) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.attackTimer -= dt;
    this.animLock -= dt;

    if (this.stunned > 0) {
      // knocked up: arc into the air and land, no actions
      this.dashMove = null; // crowd control interrupts dashes
      this.stunned -= dt;
      const t = 1 - Math.max(0, this.stunned) / this.stunLength;
      this.player.root.position.set(this.pos.x, this.airborne ? Math.sin(Math.min(1, t * 1.6) * Math.PI) * 260 : 0, this.pos.z);
      this.player.update(dt);
      return;
    }

    if (this.dashMove) {
      // dashes keep going through casts (a skill cast mid-dash resolves at its usual time)
      const d = this.dashMove;
      const step = Math.min(d.left, d.speed * dt);
      this.pos.addScaledVector(d.dir, step);
      this.clampToArena();
      if (!this.kit.ghost?.()) this.collidePlayer();
      this.facing = Math.atan2(d.dir.x, d.dir.z);
      this.stillFor = 0;
      if ((d.left -= step) <= 0) this.dashMove = null;
      this.player.root.position.copy(this.pos);
      const k = 1 - Math.max(0, d.left) / d.length;
      this.player.root.position.y = d.height * 4 * k * (1 - k);
      this.player.root.rotation.y = this.facing;
    }

    if (this.castLock > 0) {
      this.castLock -= dt;
      if (this.castLock <= 0 && this.pendingCast) {
        const { key, point } = this.pendingCast;
        this.pendingCast = null;
        this.kit.cast(key, Math.max(0, this.ranks[key] - 1), point);
        for (const fx of this.itemFx) fx.onCastResolved?.(key);
      }
      this.player.update(dt); // keep the spell animation playing while rooted
      return; // champions stand still while casting
    }

    if (this.dashMove) {
      // no walking nor attacking while dashing
      this.player.update(dt);
      return;
    }

    move = this.kit.steer?.() ?? move;
    const moving = move.lengthSq() > 0;
    // Survivors rule: the champion attacks while moving. During the windup it turns to the target; after it, back to running.
    this.tryAttack(dt);
    this.stillFor = moving ? 0 : this.stillFor + dt;
    if (moving) {
      this.pos.addScaledVector(move, this.moveSpeed * dt);
      this.clampToArena();
      if (this.windup < 0) {
        this.facing = Math.atan2(move.x, move.z);
        this.animLock = 0;
      }
    }
    // resolve even when stationary: a blink, the Baron's push or the tentacle drag can embed the player in scenery
    if (!this.kit.ghost?.()) this.collidePlayer();

    if (this.animLock <= 0) {
      if (moving) {
        this.player.play(anims.run);
        this.player.setTimeScale(this.moveSpeed / B.moveSpeed);
      } else this.player.play(anims.idle, { fade: 0.2 });
    }
    this.player.root.position.copy(this.pos);
    this.player.root.rotation.y = this.facing;
    this.player.update(dt);
  }

  /** Pushes the champion out of scenery. */
  collidePlayer() { this.map.collideCircle(this.pos, this.champ.base.radius); }

  /** The arena wall blocks walking (and dashing) out. */
  private clampToArena() {
    if (!this.arena) return;
    const off = this.tmp.copy(this.pos).sub(this.arena.center);
    const max = this.arena.radius - this.champ.base.radius;
    if (off.length() > max) this.pos.copy(this.arena.center).addScaledVector(off.normalize(), max);
  }

  /** Moves the champion `distance` along `dir` (ground plane) at `speed`; no walking or attacking meanwhile. `height`: peak of a jump arc. */
  dash(dir: THREE.Vector3, distance: number, speed: number, height = 0) {
    this.windup = -1;
    this.dashMove = { dir: dir.clone().setY(0).normalize(), left: distance, speed, length: distance, height };
  }

  get dashing() { return this.dashMove !== null; }

  /** Destroys hostile missiles within `radius` of `p` (projectile blocks); returns how many. */
  blockMissiles(p: THREE.Vector3, radius: number) {
    let n = 0;
    compact(this.missiles, (m) => m.hit !== undefined || Math.hypot(m.pos.x - p.x, m.pos.z - p.z) > radius + m.radius || (n++, this.removeMesh(m.mesh)));
    return n;
  }

  inAttackRange(e: Enemy) {
    return e.deadFor < 0 && e.pos.distanceTo(this.pos) - e.def.radius - this.champ.base.radius <= this.attackRange;
  }

  private tryAttack(dt: number) {
    if (this.windup >= 0) {
      this.windup -= dt;
      const p = this.windupProp;
      if (p) {
        if (p.gone()) { this.windup = -1; return; }
        this.faceTowards(p.pos);
        if (this.windup < 0) p.struck(this.ad * (this.pendingCrit ? this.champ.base.critDamage + this.items.critDamage : 1), this.pendingCrit);
        return;
      }
      const t = this.windupTarget;
      if (!t || t.deadFor >= 0) { this.windup = -1; return; }
      this.faceTowards(t.pos);
      if (this.windup < 0) this.fireAuto(t);
      return;
    }
    if (this.attackTimer > 0 || this.kit.disarmed?.()) return;
    let target: Enemy | null = null;
    if (this.autoAttack) {
      if (this.focus && this.inAttackRange(this.focus)) target = this.focus;
      else target = this.nearestEnemy(this.pos, this.attackReach, (e) => this.inAttackRange(e));
    } else if (this.manualTarget && this.inAttackRange(this.manualTarget)) target = this.manualTarget;
    if (this.kit.attackTarget) target = this.kit.attackTarget(target);
    const prop = (this.autoAttack || target ? this.kit.attackProp?.(target) : null) ?? null; // no swings of its own with auto attack off
    if (!target && !prop) return;
    const { base: B, anims, id } = this.champ;
    const crit = Math.random() < this.critChance;
    this.pendingCrit = crit;
    const melee = !prop && target && this.champ.melee && this.kit.meleeAuto?.(target) ? this.champ.melee : null;
    this.pendingMelee = melee !== null;
    const form = melee || prop ? undefined : this.kit.attackStart?.(target!, crit);
    const delay = 1 / this.attackSpeed;
    this.attackTimer = delay;
    this.windup = delay * (form?.windupPercent ?? B.windupPercent);
    this.windupTarget = prop ? null : target;
    this.windupProp = prop;
    this.faceTowards((prop ?? target!).pos);
    const set = melee ?? anims;
    const anim = form?.anim ?? (crit ? set.crit : set.attacks[this.attackIndex++ % set.attacks.length]);
    const length = Math.min(this.player.duration(anim), delay);
    this.player.play(anim, { loop: false, restart: true, duration: length, fade: 0.05 });
    const sound = melee ? `${id}_melee` : `${id}_auto`;
    audio.play(form?.sound ?? (crit ? (melee ? `${id}_melee_crit` : `${id}_crit`) : this.attackIndex % 2 ? sound : `${sound}2`));
    this.animLock = length;
  }

  /** The next basic attack can start right away (an attack timer reset, e.g. a returning blade caught). */
  resetAttack() { this.attackTimer = 0; }

  /** Plays a one-shot clip over the idle animation for its length (a kit's gesture, e.g. catching a returning blade); casts and attacks win. */
  gesture(anim: string) {
    if (this.castLock > 0 || this.windup >= 0 || !this.alive) return;
    this.player.play(anim, { loop: false, restart: true, fade: 0.05 });
    this.animLock = this.player.duration(anim);
  }

  private fireAuto(target: Enemy) {
    const B = this.champ.base;
    const dmg = this.ad * (this.pendingCrit ? B.critDamage + this.items.critDamage : 1);
    if (this.pendingMelee) this.meleeAttack(target, dmg, this.pendingCrit);
    else this.basicAttack(target, dmg, this.pendingCrit);
    this.attackEffects(target, dmg, this.pendingCrit);
  }

  /** Runs the "on attack" item and rune effects for an attack on `target` (also abilities that count as one, e.g. Parrrley). */
  attackEffects(target: Enemy, damage: number, crit: boolean) {
    for (const fx of this.itemFx) fx.onAttack?.(target, damage, crit);
  }

  /** The champion's melee basic attack (`ChampionDef.melee`): swing and hit land at once, no missile. */
  private meleeAttack(target: Enemy, damage: number, crit: boolean) {
    const { melee, id } = this.champ;
    const fx = melee!.vfx;
    const i = this.attackIndex % fx.swing.length;
    // swing meshes carry a 180° birth rotation (authored from the target back): half turn so the arc opens toward it
    this.vfx.playAt(crit ? fx.crit : fx.swing[i], this.pos.clone().setY(0), this.facing + Math.PI);
    this.vfx.hit(crit ? fx.critHit : fx.hit[i], target.pos, this.facing, { size: boundSize(target) });
    audio.play(`${id}_melee${crit ? '_crit' : ''}_hit`);
    this.hurtEnemy(target, damage, { type: 'physical', source: 'auto', onHit: true, crit });
  }

  /** Fires a basic attack missile; `bolt` marks secondary ones (Runaan's Hurricane). */
  basicAttack(target: Enemy, damage: number, crit: boolean, bolt = false) {
    if (this.kit.basicAttack?.(target, damage, crit, bolt)) return;
    const { base: B, vfx, id } = this.champ;
    this.spawnMissile(crit ? vfx.crit : vfx.auto, this.pos, target.pos, {
      speed: B.missileSpeed, range: 3000, radius: 10, damage, target,
      hit: { type: 'physical', source: 'auto', onHit: true, crit, bolt },
      hitFx: crit ? vfx.critHit : vfx.autoHit, hitSound: `${id}_${crit ? 'crit' : 'auto'}_hit`,
    });
  }

  /** `fx`: particle system of the missile; null gives the hostile (enemy) look. */
  spawnMissile(fx: string | null, from: THREE.Vector3, to: THREE.Vector3, o: MissileOpts) {
    const missileFx = this.vfx.missile(fx);
    const pos = from.clone().setY(o.height ?? 110);
    const dir = to.clone().setY(pos.y).sub(pos).normalize();
    if (dir.lengthSq() === 0) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.scene.add(missileFx.root);
    this.missiles.push({
      mesh: missileFx.root, fx: missileFx, pos, dir, travelled: 0, speed: o.speed, range: o.range, radius: o.radius,
      damage: o.damage, hit: o.hit, target: o.target, pierce: o.pierce ? new Set() : undefined,
      hitFx: o.hitFx, hitSound: o.hitSound, onHit: o.onHit, arc: o.arc,
    });
  }

  private updateMissiles(dt: number) {
    const radius = this.champ.base.radius;
    compact(this.missiles, (m) => {
      if (m.target) {
        if (m.target.deadFor >= 0) return this.removeMesh(m.mesh);
        m.dir.copy(m.target.pos).setY(m.pos.y).sub(m.pos).normalize();
      }
      const step = m.speed * (m.hit ? dt : dt * this.pace); // enemy missiles (no `hit`) fly on enemy time
      m.pos.addScaledVector(m.dir, step);
      m.travelled += step;
      m.mesh.position.copy(m.pos);
      if (m.arc && m.target) {
        const k = m.travelled / (m.travelled + Math.hypot(m.target.pos.x - m.pos.x, m.target.pos.z - m.pos.z) || 1);
        m.mesh.position.y += m.arc * 4 * k * (1 - k);
      }
      m.fx.update(dt, m.dir, m.travelled);

      if (!m.hit) {
        if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) <= radius + m.radius) {
          this.hurtPlayer(m.damage, false, true);
          this.vfx.enemyHit(m.pos);
          return this.removeMesh(m.mesh);
        }
      } else if (m.target) {
        if (Math.hypot(m.pos.x - m.target.pos.x, m.pos.z - m.target.pos.z) <= m.target.def.radius) {
          this.missileHit(m, m.target);
          return this.removeMesh(m.mesh);
        }
      } else {
        for (const e of this.enemiesNear(m.pos, m.radius, this.nearMissile)) {
          if (e.deadFor >= 0 || m.pierce?.has(e)) continue;
          if (Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) > e.def.radius + m.radius) continue;
          this.missileHit(m, e);
          if (!m.pierce) return this.removeMesh(m.mesh);
          m.pierce.add(e);
        }
      }
      return m.travelled < m.range || this.removeMesh(m.mesh);
    });
  }

  private missileHit(m: Missile, e: Enemy) {
    if (m.onHit) m.onHit(e, m);
    else this.impact(e, m);
  }

  /** Default missile impact: hit VFX and sound, then the missile's damage. */
  impact(e: Enemy, m: Missile) {
    if (m.hitFx) this.vfx.hit(m.hitFx, m.pos, Math.atan2(m.dir.x, m.dir.z), { size: boundSize(e) });
    if (m.hitSound) audio.play(m.hitSound);
    this.hurtEnemy(e, m.damage, m.hit!);
  }

  private removeMesh(mesh: THREE.Object3D) {
    mesh.removeFromParent();
    return false;
  }

  /** Damage left after the target's armor (physical) or magic resist (magic), with shred and penetration applied. */
  private mitigate(e: Enemy, amount: number, type: 'physical' | 'magic', hitPen = 0) {
    if (amount <= 0) return 0;
    const physical = type === 'physical';
    const shred = physical ? (e.shredUntil > this.time ? e.shred * 0.06 : 0) : (e.mrShredUntil > this.time ? e.mrShred * 0.075 : 0);
    const pen = physical ? this.items.armorPen + this.fxStat('armorPen') : this.items.magicPen + this.fxStat('magicPen');
    const flat = physical ? this.items.lethality + this.fxStat('lethality') : this.items.magicPenFlat + this.fxStat('magicPenFlat');
    const resist = Math.max(0, (physical ? e.armor : e.mr) * (1 - shred) * (1 - pen) * (physical ? 1 - hitPen : 1) - flat);
    return amount * (100 / (100 + resist));
  }

  /** Damage pipeline: on-hit items, champion passives, mitigation, healing, death. */
  hurtEnemy(e: Enemy, amount: number, hit: Hit) {
    if (e.deadFor >= 0) return;
    let physical = hit.type === 'physical' ? amount : 0;
    let magic = hit.type === 'magic' ? amount : 0;
    const pure = hit.type === 'true' ? amount : 0;
    if (hit.onHit) {
      for (const fx of this.itemFx) {
        if (fx.onHit) physical += fx.onHit(e, hit) * (hit.onHitMult ?? 1);
        if (fx.onHitMagic) magic += fx.onHitMagic(e, hit) * (hit.onHitMult ?? 1);
      }
    }
    magic += this.kit.onDamage?.(e, hit) ?? 0;
    physical = this.mitigate(e, physical, 'physical', hit.armorPen);
    magic = this.mitigate(e, magic, 'magic');
    if (physical > 0) for (const fx of this.itemFx) fx.onPhysical?.(e);
    if (magic > 0) for (const fx of this.itemFx) fx.onMagic?.(e);
    let total = physical + magic + pure;
    for (const fx of this.itemFx) if (fx.damageMult) total *= fx.damageMult(e, hit);
    const dealt = Math.min(e.hp, total);
    const vamp = this.items.omnivamp + this.fxStat('omnivamp') + (hit.source !== 'item' || hit.lifesteal ? this.items.lifesteal + this.fxStat('lifesteal') : 0); // life steal: autos and abilities; item procs and DoTs heal through omnivamp only
    if (vamp > 0) this.heal(dealt * vamp);
    e.hp -= total;
    this.float(e.pos, String(Math.round(total)), hit.crit ? 'crit' : magic > physical ? 'magic' : 'physical');
    // kill before the procs: a proc that lands on the corpse returns at the deadFor check above instead of killing twice
    if (e.hp <= 0) this.killEnemy(e, hit);
    for (const fx of this.itemFx) fx.onDealt?.(e, hit, dealt);
    this.kit.onDealt?.(e, hit, dealt);
  }

  /**
   * `nonLethal` damage leaves the champion at 1 HP at worst (Baron's whip); `magic` is reduced by MR instead of armor.
   * `spell` (default): the hit is an ability or projectile a spell shield (ChampionKit.blockSpell) can negate; melee basic attacks pass false.
   */
  /** Damage taken multiplier for standing still: x1 while walking, up to x5 after CAMPING.ramp seconds. */
  get campingMult() { return 1 + (CAMPING.max - 1) * Math.min(1, this.stillFor / CAMPING.ramp); }

  hurtPlayer(amount: number, nonLethal = false, magic = false, spell = true) {
    if (!this.alive || this.stasis > 0) return;
    if (spell && this.kit?.blockSpell?.()) return;
    let taken = amount * (100 / (100 + Math.max(0, magic ? this.mr : this.armor))) * this.campingMult;
    if (!magic && this.boots && PLATING.has(this.boots)) taken *= 0.9;
    for (const fx of this.itemFx) if (fx.onHurt) taken = fx.onHurt(taken);
    const absorbed = Math.min(this.shield, taken);
    this.shield -= absorbed;
    taken -= absorbed;
    if (nonLethal) taken = Math.min(taken, this.hp - 1);
    this.hp -= taken;
    if (taken > 0) this.lastHurtAt = this.time;
    this.float(this.pos, `-${Math.round(taken)}`, 'taken');
    if (this.hp > 0 || this.itemFx.some((fx) => fx.onLethal?.())) return;
    this.hp = 0;
    this.over = 'lost';
    this.player.play(this.champ.anims.death, { loop: false, fade: 0.1 });
    audio.play(`${this.champ.id}_death`);
    for (const fx of this.idleFx) fx.stop();
    for (const v of this.champ.vfx.death ?? []) this.boneVfx(v, false);
  }

  /** Frozen and untargetable at 1 HP for `seconds`, then `onEnd` (revive). */
  enterStasis(seconds: number, onEnd: () => void) {
    this.hp = 1;
    this.stasis = seconds;
    this.stasisEnd = onEnd;
    this.windup = -1;
    this.castLock = 0;
    this.pendingCast = null;
    this.stunned = 0;
  }

  /** Ends the champion's crowd control (a cleanse): back on the ground, free to act. */
  cleanse() {
    this.stunned = 0;
    this.player.root.position.copy(this.pos);
  }

  /** Crowd control: no actions for `seconds`; `airborne` plays the knock-up arc. */
  stun(seconds: number, airborne = true) {
    if (!this.alive || this.stasis > 0) return;
    seconds *= 1 - Math.min(0.8, this.items.tenacity + this.fxStat('tenacity'));
    for (const fx of this.itemFx) fx.onStunned?.();
    this.stunned = this.stunLength = Math.max(this.stunned, seconds);
    this.airborne = airborne;
    this.windup = -1;
    this.castLock = 0;
    this.pendingCast = null;
    this.player.play(this.moveAnims.idle, { fade: 0.1 });
  }

  win() {
    this.over = 'won';
    this.winAt.copy(this.epics.find((e) => e.deadFor >= 0)?.pos ?? this.pos);
    this.player.play(this.moveAnims.idle);
  }

  private killEnemy(e: Enemy, hit: Hit) {
    this.markDead(e);
    this.kills++;
    this.killLog.push(this.time);
    audio.playAt(`${voice(e.def)}_death`, e.pos, this.pos);
    this.gainXp(e.def.xp); // XP is absorbed on kill (no gems to collect)
    for (const fx of this.itemFx) fx.onKill?.(e);
    this.kit.onKill?.(e, hit);
    if (!this.blueprintDropped && buildComplete(this.slots) && Math.random() < BLUEPRINT_CHANCE) {
      this.blueprintDropped = true;
      this.blueprint = makeBlueprint();
      this.blueprint.position.set(e.pos.x, 0, e.pos.z);
      this.scene.add(this.blueprint);
    }
    if (e.def.model === 'scuttle' && (!this.boots || this.boots === BOOTS_FIRST)) {
      if (!this.boots) this.setBoots(BOOTS_FIRST);
      this.offerBoots();
    }
    if (e.def.model.startsWith('dragon_')) {
      this.dragonSlain = true;
      if (this.boots && BOOT_UPGRADES[this.boots]) this.setBoots(BOOT_UPGRADES[this.boots]);
    }
    if (isBuffMonster(e.def.model)) {
      this.buffSpawnAt[e.def.model] = this.time + BUFF.respawn;
      const mesh = makeBuffDrop(BUFF.colors[e.def.model]);
      mesh.position.set(e.pos.x, 0, e.pos.z);
      this.scene.add(mesh);
      this.buffDrops.push({ key: e.def.model, mesh, until: this.time + BUFF.dropLife });
    }
    e.ai?.onDeath?.();
  }

  private markDead(e: Enemy) {
    e.deadFor = 0;
    this.aliveCount--;
    e.actor.play(e.def.anims.death, { loop: false, fade: 0.08 });
  }

  /** Alive non-epic enemies within `radius` of the champion die without rewards (no XP, kills nor procs): a revive's breathing room. */
  banish(radius: number) {
    for (const e of this.enemies) {
      if (e.deadFor >= 0 || e.def.tier === 'epic') continue;
      if (e.pos.distanceTo(this.pos) - e.def.radius <= radius) this.markDead(e);
    }
  }

  /** Every alive enemy dies without rewards and hostile missiles vanish (a boss arena clearing the map). */
  despawnAll() {
    for (const e of this.enemies) if (e.deadFor < 0) this.markDead(e);
    compact(this.missiles, (m) => !!m.hit || this.removeMesh(m.mesh));
  }

  /** Alive enemies that may be within `r` (edge distance) of `p`: grid candidates, callers check the exact distance and deadFor. */
  enemiesNear(p: { x: number; z: number }, r: number, out = this.near) {
    return this.grid.query(p.x, p.z, r + this.maxEnemyRadius + GRID_SLACK, out);
  }

  nearestEnemy(from: THREE.Vector3, range: number, filter?: (e: Enemy) => boolean) {
    let best: Enemy | null = null, bestD = range;
    for (const e of this.enemiesNear(from, range)) {
      if (e.deadFor >= 0 || (filter && !filter(e))) continue;
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
    this.prefetch();
    if (this.arena) return; // nothing else spawns during an arena fight
    this.spawnBudget += DIRECTOR.baseRate(this.time, this.level) * this.performance() * dt;
    let alive = this.aliveCount;
    const cap = Math.min(MAX_ENEMIES, DIRECTOR.maxAlive(this.time, this.level));
    while (this.spawnBudget >= 1) {
      if (alive >= cap) { this.spawnBudget = 1; break; }
      this.spawnEnemy(this.pickFromPool());
      this.spawnBudget--;
      alive++;
    }
    while (this.nextEvent < EVENTS.length && this.time >= EVENTS[this.nextEvent].at) {
      const key = EVENTS[this.nextEvent].enemy;
      if (!ready(this.eventEnemy(key))) break; // still downloading: the event waits for it
      this.nextEvent++;
      const spawner = SPAWNERS[key];
      if (spawner) spawner(this);
      else this.spawnEnemy(key);
    }
  }

  private performance() {
    const spawned = this.spawnLog.count(this.time);
    if (spawned < 5) return 1;
    const ratio = Math.min(1, this.killLog.count(this.time) / spawned);
    return DIRECTOR.perfMin + (DIRECTOR.perfMax - DIRECTOR.perfMin) * ratio;
  }

  private pickFromPool() {
    const active = POOL.filter((p) => this.time >= p.from && this.time <= p.to && ready(p.enemy));
    let r = Math.random() * active.reduce((sum, p) => sum + p.weight, 0);
    return (active.find((p) => (r -= p.weight) < 0) ?? active[0]).enemy;
  }

  /** Every HORDE.every seconds a ring of weak swarmers closes in around the player. */
  private horde() {
    if (this.arena || this.time < this.nextHordeAt) return;
    this.nextHordeAt += HORDE.every;
    const swarmers = POOL.filter((p) => this.time >= p.from && this.time <= p.to && ENEMIES[p.enemy].hp <= 60 && ready(p.enemy));
    const key = swarmers[Math.floor(Math.random() * swarmers.length)].enemy;
    const n = Math.min(HORDE.size(this.level), MAX_ENEMIES - this.aliveCount);
    // ring with an opening (HORDE.gap of the circle) at a random side, so the player can break out
    const start = Math.random() * Math.PI * 2;
    const arc = Math.PI * 2 * (1 - HORDE.gap);
    for (let i = 0; i < n; i++) {
      const a = start + (i / (n - 1)) * arc;
      this.spawnEnemy(key, new THREE.Vector3(this.pos.x + Math.cos(a) * HORDE.radius, 0, this.pos.z + Math.sin(a) * HORDE.radius));
    }
    for (const fx of this.itemFx) fx.onHorde?.();
  }

  private respawnBuffMonsters() {
    if (this.arena) return;
    for (const k of BUFF.keys) {
      if (this.time < this.buffSpawnAt[k]) continue;
      this.buffSpawnAt[k] = Infinity;
      this.spawnEnemy(k);
    }
  }

  spawnEnemy(key: string, at?: THREE.Vector3): Enemy {
    const def = ENEMIES[key];
    const a = Math.random() * Math.PI * 2;
    const r = SPAWN_RADIUS + Math.random() * 200;
    const epic = def.tier === 'epic';
    const actor = new Actor(def.model, def.scale);
    const hp = def.hp * (epic ? 1 : enemyHpScale(this.time, this.level));
    const e: Enemy = {
      id: this.nextId++, def, actor, pos: at ?? new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r),
      hp, maxHp: hp, attackTimer: 0, windup: -1, deadFor: -1, animDt: 0,
      armor: (def.armor ?? ENEMY_ARMOR[def.tier]) * (epic ? 1 : enemyArmorScale(this.time)), shred: 0, shredUntil: 0, slowPct: 0, slowUntil: 0, slowFade: 0, stunUntil: 0, rootUntil: 0, blindUntil: 0, airUntil: 0, airFor: 0,
      mr: ENEMY_MR[def.tier] * (epic ? 1 : enemyArmorScale(this.time)), mrShred: 0, mrShredUntil: 0,
    };
    e.ai = AI[def.model]?.(this, e);
    actor.play(def.anims.run);
    if (def.tier === 'elite' || epic) audio.play(`${voice(def)}_spawn`);
    this.scene.add(actor.root);
    this.enemies.push(e);
    this.aliveCount++;
    if (epic) this.epics.push(e);
    this.spawnLog.push(this.time);
    // queryable right away (the grid is rebuilt once per frame)
    this.grid.insert(e);
    this.maxEnemyRadius = Math.max(this.maxEnemyRadius, def.radius);
    return e;
  }

  private enemyHitDamage(def: EnemyDef) {
    if (def.damageMax) return def.damage + Math.random() * (def.damageMax - def.damage);
    return def.damage * enemyDamageScale(this.time, this.crowd);
  }

  private updateEnemies(dt: number) {
    const B = this.champ.base;
    const toPlayer = this.tmp;
    const frame = ++this.frame;
    let crowd = 0;
    for (const e of this.enemies) {
      e.animDt += dt;
      const far = Math.abs(e.pos.x - this.pos.x) + Math.abs(e.pos.z - this.pos.z) > ANIM_LOD_DIST;
      const seen = this.inView(e);
      e.actor.root.visible = seen;
      if (seen && (!far || (frame + e.id) % ANIM_LOD_STEP === 0)) {
        e.actor.update(e.animDt);
        e.animDt = 0;
      }
      if (e.deadFor >= 0) { e.deadFor += dt; continue; }
      if (e.ai) { e.ai.update(dt); continue; }
      toPlayer.copy(this.pos).sub(e.pos).setY(0);
      const dist = toPlayer.length();
      const edge = dist - e.def.radius - B.radius;
      if (edge <= CROWD_RANGE) crowd++;
      e.attackTimer -= dt;

      if (e.stunUntil > this.time) {
        e.actor.play(e.def.anims.idle, { fade: 0.1 });
        if (e.push) {
          // offset applied by the share of the arc flown (real time: the arc is timed on this.time, not enemy-side dt)
          const k = Math.min(1, 1 - (e.airUntil - this.time) / e.airFor);
          e.pos.x += e.push.x * (k - e.push.done);
          e.pos.z += e.push.z * (k - e.push.done);
          e.push.done = k;
          if (k >= 1) e.push = undefined;
        }
        continue;
      }
      if (dist > DESPAWN_RADIUS && e.def.tier !== 'epic') {
        // survivors convention: stragglers reappear ahead of the player instead of despawning
        e.pos.copy(this.pos).addScaledVector(toPlayer.normalize(), SPAWN_RADIUS);
        continue;
      }
      if (e.windup >= 0) {
        e.windup -= dt;
        if (e.windup < 0 && this.alive && this.stasis <= 0 && e.blindUntil <= this.time) {
          audio.playAt(`${e.def.model}_hit`, e.pos, this.pos);
          if (e.def.ranged) {
            // aimed at where the champion is now, then flies straight so it can be dodged
            this.spawnMissile(null, e.pos, this.pos, {
              speed: e.def.ranged, range: e.def.attackRange + e.def.radius + ENEMY_MISSILE_EXTRA_RANGE, radius: e.def.missileRadius ?? 25,
              damage: this.enemyHitDamage(e.def),
            });
          } else if (edge <= e.def.attackRange + 80) {
            this.hurtPlayer(this.enemyHitDamage(e.def), false, false, false);
            for (const fx of this.itemFx) fx.onStruck?.(e);
          }
        }
      } else if (edge <= e.def.attackRange && this.alive && this.stasis <= 0) {
        if (e.attackTimer <= 0) {
          let cooldown = e.def.attackCooldown;
          for (const fx of this.itemFx) if (fx.enemyAttackCooldown) cooldown *= fx.enemyAttackCooldown(dist);
          e.attackTimer = cooldown;
          e.windup = e.def.windup;
          const anims = e.def.anims.attacks;
          const anim = anims[Math.floor(Math.random() * anims.length)];
          e.actor.play(anim, { loop: false, restart: true, duration: Math.min(e.actor.duration(anim), e.def.attackCooldown) });
        } else if (e.attackTimer < e.def.attackCooldown - e.actor.duration(e.actor.currentName)) {
          e.actor.play(e.def.anims.idle, { fade: 0.2 });
        }
      } else if (e.rootUntil > this.time) {
        e.actor.play(e.def.anims.idle, { fade: 0.2 });
      } else {
        // movement stays on real time (dt / pace): PACE made mobs outrun the champion; non-epic mobs are also capped
        // below the champion's base move speed so kiting always works
        const speed = e.def.tier === 'epic' ? e.def.speed : Math.min(e.def.speed, ENEMY_SPEED_CAP * B.moveSpeed);
        e.pos.addScaledVector(toPlayer.normalize(), speed * (1 - this.slowAmount(e)) * dt / this.pace);
        e.actor.play(e.def.anims.run, { fade: 0.2 });
      }
      e.actor.root.rotation.y = Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z);
    }
    this.crowd = crowd;
    this.rebuildGrid();
    this.separate();
    for (const e of this.enemies) {
      if (e.deadFor < 0) this.map.collideCircle(e.pos, e.def.radius);
      e.actor.root.position.copy(e.pos);
      if (e.airUntil > this.time) e.actor.root.position.y = Math.sin((1 - (e.airUntil - this.time) / e.airFor) * Math.PI) * AIR_HEIGHT;
    }
    compact(this.enemies, (e) => {
      if (e.deadFor < 2) return true;
      e.actor.dispose();
      e.ai?.dispose?.();
      if (e.def.tier === 'epic') compact(this.epics, (x) => x !== e);
      return false;
    });
  }

  /** Whether an enemy is inside the camera view (epic monsters always count: big models, arena effects). */
  private inView(e: Enemy) {
    if (!this.view || e.def.tier === 'epic') return true;
    _sphere.center.set(e.pos.x, VIEW_HEIGHT, e.pos.z);
    _sphere.radius = e.def.radius * VIEW_RADIUS + VIEW_MARGIN;
    return this.view.intersectsSphere(_sphere);
  }

  /** Grid of the alive enemies on their positions after this frame's movement. */
  private rebuildGrid() {
    this.grid.clear();
    let r = 0;
    for (const e of this.enemies) {
      if (e.deadFor >= 0) continue;
      this.grid.insert(e);
      if (e.def.radius > r) r = e.def.radius;
    }
    this.maxEnemyRadius = r;
  }

  /** Push overlapping units apart (and out of the champion), like LoL unit collision. Grid neighbours only. */
  private separate() {
    const B = this.champ.base;
    const ghost = this.kit.ghost?.() ?? false;
    for (const a of this.enemies) {
      if (a.deadFor >= 0) continue;
      for (const b of this.grid.query(a.pos.x, a.pos.z, (a.def.radius + this.maxEnemyRadius) * 0.8 + GRID_SLACK, this.nearSep)) {
        if (b.id <= a.id || b.deadFor >= 0) continue; // each pair once
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = (a.def.radius + b.def.radius) * 0.8;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 === 0) continue;
        const ka = a.def.immovable ? 0 : b.def.immovable ? 1 : 0.5; // share of the push each side takes
        if (a.def.immovable && b.def.immovable) continue;
        const d = Math.sqrt(d2), push = (min - d) / d;
        a.pos.x -= dx * push * ka; a.pos.z -= dz * push * ka;
        b.pos.x += dx * push * (1 - ka); b.pos.z += dz * push * (1 - ka);
      }
      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const min = a.def.radius + B.radius, d = Math.hypot(dx, dz);
      if (d >= min || d === 0 || ghost) continue;
      if (a.def.immovable) { this.pos.x = a.pos.x - (dx / d) * min; this.pos.z = a.pos.z - (dz / d) * min; }
      else { a.pos.x = this.pos.x + (dx / d) * min; a.pos.z = this.pos.z + (dz / d) * min; }
    }
  }

  get runLength() { return RUN_LENGTH; }
  get boss() { return this.epics.find((e) => e.deadFor < 0) ?? null; }
}

/** Jungle buff drop: a glowing orb over a ring in the buff's colour. */
function makeBuffDrop(color: number) {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 12), glow(color));
  const ring = new THREE.Mesh(ringGeo, glow(color));
  ring.scale.setScalar(70);
  ring.position.y = 3;
  g.add(orb, ring);
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
