// Hwei. Numbers mirror League of Legends: the champion bin (data/characters/hwei: DataValues, spell calculations, cast
// times, ranges, missile specs) and the wiki for what the bin leaves to scripts (7 Molten Fissure explosions, Pool of
// Reflection's growth, Despair's multiplicative slow). Every effect is a system of the skin's ResourceResolver; the bin
// names the missiles (mMissileEffectKey), scripts spawn the rest, placed here where their emitters are authored.
// Kit: Q, W and E open a mood (Subject: Disaster, Serenity, Torment) whose three spells then take the Q, W and E keys
// (ChampionKit.press): the mood's rank, mana cost and cooldown apply, as in League. R in a mood is Wash Brush (leaves it
// for free); out of a mood it is Spiraling Despair.
// Adapted for hordes: mana costs are lower (moods Q 30, W 45, E 25 instead of 80-120, 90-110, 50-70; R 80 instead of
// 100): Hwei casts all run long and Stirring Lights stays his mana engine (45-65 mana per empowered hit). The passive,
// Gaze of the Abyss and Spiraling Despair work on every enemy (League: champions), Spiraling Despair collides with the
// first enemy hit (League flies through minions), Grim Visage's 70-99% slow grows with the distance from Hwei.
// Not ported: Fleeting Current's ghosting (ChampionKit.ghost also walks over walls), allies, vision and reveals.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat, missileQuat, type ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
// the mood spells and Wash Brush are not on Data Dragon: CommunityDragon serves the client's hud/icons2d
const HUD = 'https://raw.communitydragon.org/latest/game/assets/characters/hwei/hud/icons2d';
const BRUSH_TIP = 'Brush3'; // basic attack missiles start there (HweiBasicAttack mStartBoneName)
const BRUSH = 'Brush1'; // brush ribbons (the Attack1/Attack2 ParticleEventData bone)
const LAYOUT = 'C_Buffbone_Glb_Layout_Loc';
const CENTER = 'C_Buffbone_Glb_Center_Loc';
const MISSILE_HEIGHT = 100; // mOffsetInitialTargetHeight of the spell missiles

type Mood = 'Q' | 'W' | 'E';
type Spell = 'QQ' | 'QW' | 'QE' | 'WQ' | 'WW' | 'WE' | 'EQ' | 'EW' | 'EE';

const MOOD = {
  Q: { activate: 'idleactivationq', idle: 'idle_q', run: 'runslowq', runFast: 'runfast_q', primed: 'Hwei_Q_Ink_Primed', trail: 'Hwei_Q_Ink_Trail', cast: 'Hwei_Q_Shared_Cas' },
  W: { activate: 'idleactivationw', idle: 'idlew', run: 'runsloww', runFast: 'runfast_w', primed: 'Hwei_W_Ink_Primed', trail: 'Hwei_W_Ink_Trail', cast: 'Hwei_W_Shared_Cas' },
  E: { activate: 'idleactivatione', idle: 'idlee', run: 'runslowe', runFast: 'runfast_e', primed: 'Hwei_E_Ink_Primed', trail: 'Hwei_E_Ink_Trail', cast: 'Hwei_E_Shared_Cas' },
} as const satisfies Record<Mood, Record<string, string>>;
const FAST_RUN = 410; // Run_Base switches to the fast run clips from this move speed (MoveSpeedParametricUpdater)

const PASSIVE = { damage: [40, 285], apRatio: 0.35, duration: 4, delay: 0.85, radius: 285, maxMarkFx: 40 };

/** The nine mood spells: clip (the animation graph's Spell<n><k>), cast time, aim and their own numbers. */
const SPELLS = {
  QQ: {
    anim: 'spell1q', castTime: 0.25, aim: 800, icon: `${HUD}/hweiqq.png`,
    range: 800, speed: 2000, width: 140, radius: 175,
    damage: [50, 80, 110, 140, 170], apRatio: 0.8, maxHp: [0.03, 0.04, 0.05, 0.06, 0.07], monsterCap: 250,
  },
  QW: {
    anim: 'spell1w', castTime: 0.5, aim: 1900, icon: `${HUD}/hweiqw.png`,
    range: 1900, radius: 225, delay: 1,
    damage: [60, 85, 110, 135, 160], apRatio: 0.3, bonusMult: [2, 2.375, 2.75, 3.125, 3.5], monsterCap: 300, minionMult: 0.5,
  },
  QE: {
    anim: 'spell1e', castTime: 0.35, aim: 1200, icon: `${HUD}/hweiqe.png`,
    range: 1200, tellSpeed: 1500, delay: 0.6, speed: 800, step: 150, explosions: 7, radius: 225,
    damage: [20, 35, 50, 65, 80], apRatio: 0.3,
    lava: 2.5, tick: 0.25, tickDamage: [5, 8.75, 12.5, 16.25, 20], tickApRatio: 0.06, slow: 0.35, minionMult: 0.6, monsterMult: 1.35,
  },
  WQ: {
    anim: 'spell3w', castTime: 0.25, aim: 'move', icon: `${HUD}/hweiwq.png`, // standing Spell2q plays spell3w.anm
    range: 1200, width: 300, speed: 1700, step: 100, duration: [4, 4.5, 5, 5.5, 6],
    ms: [0.3, 0.325, 0.35, 0.375, 0.4], msPerAp: 0.0003, refresh: 0.125, linger: 0.5,
  },
  WW: {
    anim: 'spell2w', castTime: 0.3, aim: 'move', icon: `${HUD}/hweiww.png`,
    range: 650, radius: 350, duration: 3,
    shield: [100, 140, 180, 220, 260], apRatio: 0.6, start: 0.5, tick: 0.264, ticksToFull: 6, linger: 0.5,
  },
  WE: {
    anim: 'spell2e', castTime: 0.25, aim: 'none', icon: `${HUD}/hweiwe.png`,
    charges: 3, duration: 9, damage: [20, 30, 40, 50, 60], apRatio: 0.15, aoeMult: 0.5, mana: [45, 50, 55, 60, 65],
    flareSpeed: 900, orbit: 110, orbitHeight: 90, turn: -1.855, // HweiWEFoxfireMis: CircleMovement angular velocity
  },
  EQ: {
    anim: 'spell1q', castTime: 0.25, aim: 1100, icon: `${HUD}/hweieq.png`, // Spell3q plays spell1q.anm
    range: 1100, speed: 1300, width: 140,
    damage: [70, 110, 150, 190, 230], apRatio: 0.65, fear: [1, 1.125, 1.25, 1.375, 1.5], slow: [0.7, 0.99],
  },
  EW: {
    anim: 'spell3w', castTime: 0.25, aim: 900, icon: `${HUD}/hweiew.png`,
    range: 900, speed: 1700, radius: 350, setup: 0.65, fireDelay: 0.3, duration: 3,
    launchRange: 600, width: 30, initialSpeed: 1300, acceleration: 2100, maxSpeed: 2100,
    damage: [70, 110, 150, 190, 230], apRatio: 0.65, root: [1.2, 1.4, 1.6, 1.8, 2],
  },
  EE: {
    anim: 'spell3e', castTime: 0.35, aim: 800, icon: `${HUD}/hweiee.png`,
    range: 800, delay: 0.6, width: 320, depth: 340, pull: 0.2,
    damage: [70, 110, 150, 190, 230], apRatio: 0.65, slow: [0.4, 0.475, 0.55, 0.625, 0.7], slowFor: 1.25,
  },
} as const;

const SKILLS = {
  Q: {
    name: t('champion.hwei.Q'), desc: t('champion.hwei.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'spell1q', icon: `${ICON}/spell/HweiQ.png`,
    cooldown: [10, 9, 8, 7, 6], cost: [30, 30, 30, 30, 30],
    damage: SPELLS.QQ.damage, apRatio: SPELLS.QQ.apRatio, aim: 800, castTime: 0.25,
  },
  W: {
    name: t('champion.hwei.W'), desc: t('champion.hwei.W.desc'), damageType: 'magic', maxRank: 5, anim: 'spell2w', icon: `${ICON}/spell/HweiW.png`,
    cooldown: [18, 17.5, 17, 16.5, 16], cost: [45, 45, 45, 45, 45],
    damage: SPELLS.WE.damage, apRatio: SPELLS.WE.apRatio, hits: 3, aim: 'move', castTime: 0.25,
    extra: { label: t('champion.hwei.W.shield'), values: SPELLS.WW.shield },
  },
  E: {
    name: t('champion.hwei.E'), desc: t('champion.hwei.E.desc'), damageType: 'magic', maxRank: 5, anim: 'spell3e', icon: `${ICON}/spell/HweiE.png`,
    cooldown: [12, 11.5, 11, 10.5, 10], cost: [25, 25, 25, 25, 25],
    damage: SPELLS.EQ.damage, apRatio: SPELLS.EQ.apRatio, aim: 1100, castTime: 0.25,
  },
  R: {
    name: t('champion.hwei.R'), desc: t('champion.hwei.R.desc'), damageType: 'magic', maxRank: 3, anim: 'spell4_alex', icon: `${ICON}/spell/HweiR.png`,
    cooldown: [120, 100, 80], cost: [80, 80, 80],
    damage: [200, 325, 450], apRatio: 0.8, aim: 1300, castTime: 0.25,
    range: 1300, speed: 1400, width: 180, duration: 3, tick: 0.25, radius: [150, 500],
    tickDamage: [2.5, 5, 7.5], tickApRatio: 0.0125, slowPerStack: 0.1, maxStacks: 12, slowFor: 0.35, maxSlowFx: 12,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  // damage over time (lava, Despair's aura), the passive's explosions and Stirring Lights' flares: procs that trigger nothing
  proc: { type: 'magic', source: 'item' },
  auto: { type: 'physical', source: 'auto', onHit: true },
} as const satisfies Record<string, Hit>;

export const HWEI: ChampionDef = {
  id: 'hwei', name: t('champion.hwei.name'), model: 'hwei', icon: `${ICON}/champion/Hwei.png`,
  // SkinScale 1.15 against Ezreal's 1.1: the same proportion to Ezreal as in League (the export stands ~207)
  scale: 1.15 / 1.1,
  textures: { Brush: 'hwei_weapon', PaletteA: 'hwei_weapon' }, // materialOverride: the brush texture (the palette's diffuse)
  title: t('champion.hwei.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Hwei_0.jpg',
  roles: ['mage', 'support'], difficulty: 9,
  itemPool: 'ap',
  // OP.GG mid core: Luden's Companion, Shadowflame, Rabadon's, Void Staff; then Banshee's Veil, Horizon Focus
  // (Zhonya's has an active)
  build: ['6655', '4645', '3089', '3135', '3102', '4628'],
  base: {
    hp: 580, hpPerLevel: 109,
    hpRegen5: 5.5, hpRegen5PerLevel: 0.55,
    mana: 480, manaPerLevel: 30,
    manaRegen5: 7.5, manaRegen5PerLevel: 0.75,
    ad: 54, adPerLevel: 3.3,
    attackSpeed: 0.69, attackSpeedPerLevel: 0.025,
    attackRange: 550,
    moveSpeed: 330,
    critDamage: 1.75,
    windupPercent: 0.28 / 1.495,
    missileSpeed: 2800,
    radius: 65,
    armor: 21, armorPerLevel: 4.7,
  },
  skills: SKILLS,
  passive: { name: t('champion.hwei.passive'), icon: `${ICON}/passive/HweiPassive.png` },
  anims: { idle: 'idle_base', run: 'runslow', death: 'death', attacks: ['attack01', 'attack02'], crit: 'attack01' },
  vfx: { auto: 'Hwei_BA_mis', crit: 'Hwei_BA_mis', autoHit: 'Hwei_BA_tar_1', critHit: 'Hwei_BA_tar_1' },
  animVfx: true, // the death clip's Hwei_Emote_Death
  kit: hweiKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;
const NAMES: Record<Spell, string> = {
  QQ: t('champion.hwei.QQ'), QW: t('champion.hwei.QW'), QE: t('champion.hwei.QE'),
  WQ: t('champion.hwei.WQ'), WW: t('champion.hwei.WW'), WE: t('champion.hwei.WE'),
  EQ: t('champion.hwei.EQ'), EW: t('champion.hwei.EW'), EE: t('champion.hwei.EE'),
};

/** One resolved spell: its hits share the passive's "same cast" rule and one Stirring Lights charge. */
interface Cast { id: number; spell: Spell | 'R'; key: SkillKey; empowered: boolean; aoe: boolean }
/** Signature of the Visionary on one enemy. */
interface Mark { spell: Spell | 'R'; until: number; consumedBy: number; fx: THREE.Object3D | null }
/** A kit-moved projectile (visual or colliding). */
interface Flight {
  fx: MissileFx; dir: THREE.Vector3; speed: number; left: number; travelled: number;
  accel?: number; maxSpeed?: number; radius?: number;
  onHit?: (e: Enemy, at: THREE.Vector3) => void; onEnd?: (at: THREE.Vector3) => void;
}
interface Lava { at: THREE.Vector3; ticks: number; tickIn: number; cast: Cast; rank: number }
interface Path { from: THREE.Vector3; dir: THREE.Vector3; len: number; until: number; rank: number; segs: ParticleSystem[]; nextSeg: number }
interface Pool { at: THREE.Vector3; until: number; rank: number; ticks: number; tickIn: number }
interface Eye {
  at: THREE.Vector3; until: number; lockAt: number; fireAt: number; target: Enemy | null; rank: number; cast: Cast;
  fx: THREE.Object3D[]; stare: THREE.Object3D[];
}
interface Aura { e: Enemy; at: THREE.Vector3; age: number; tickIn: number; rank: number; cast: Cast; fx: THREE.Object3D }
interface Despair { stacks: number; until: number; fx: THREE.Object3D | null }

function hweiKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const marks = new Map<Enemy, Mark>();
  const despair = new Map<Enemy, Despair>();
  const flights: Flight[] = [];
  const lavas: Lava[] = [];
  const paths: Path[] = [];
  const pools: Pool[] = [];
  const eyes: Eye[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const auras: Aura[] = [];
  let markFx = 0, slowFx = 0, castSeq = 0;

  let mood: Mood | null = null;
  let picked: Spell | null = null; // the spell the last routed press chose (cast starts with it)
  let casting: Spell | null = null; // the spell between castStart and cast
  let inkTrail: ParticleSystem | null = null;

  // Fleeting Current's speed and Pool of Reflection's shield
  let speedUntil = 0, speedPct = 0, speedFx: ParticleSystem | null = null, speedCheck = 0;
  let poolShield = false, shieldFx: THREE.Object3D | null = null;

  // Stirring Lights
  let flares: { o: THREE.Object3D; angle: number }[] = [];
  let lightsUntil = 0, lightsBuff: THREE.Object3D | null = null, lightsRank = 0;

  const ap = () => g.ap;
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && Math.hypot(e.pos.x - from.x, e.pos.z - from.z) - e.def.radius <= r;
  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  /** Ground point toward `point`, at most `range` away. */
  const clampPoint = (point: THREE.Vector3, range: number) => {
    const off = tmp.copy(point).sub(g.pos).setY(0);
    if (off.length() > range) off.setLength(range);
    return g.pos.clone().add(off).setY(0);
  };
  /**
   * A system that follows the returned object while it stays in the scene. `duration`: the buff it stands for, so
   * particles living as long as their system run their over-life curves over it (an aura that grows for 3s).
   */
  const follow = (key: string, at: THREE.Vector3, height = 0, facing = 0, duration?: number) => {
    const o = new THREE.Group();
    o.position.copy(at).setY(height);
    g.scene.add(o);
    g.vfx.play(key, o.position, facingQuat(facing), { follow: o, killOnStop: true, duration });
    return o;
  };
  /** A system riding one of Hwei's bones for its whole length (persistent: stop it yourself). */
  const onBone = (key: string, bone: string, orient = false, keep = false) => {
    const b = g.player.bone(bone);
    if (!b) return null;
    return g.vfx.play(key, b.getWorldPosition(new THREE.Vector3()), facingQuat(g.facing), {
      bone: b, orient, owner: g.player.root, ...(keep ? { until: undefined } : {}),
    });
  };
  const kind = (e: Enemy) => e.def.tier === 'minion' ? 'minion' : e.def.tier === 'monster' || e.def.tier === 'elite' ? 'monster' : 'epic';
  const newCast = (spell: Spell | 'R', key: SkillKey, aoe: boolean): Cast => ({ id: ++castSeq, spell, key, empowered: false, aoe });

  // ---- Signature of the Visionary ----
  const dropMarkFx = (m: Mark) => {
    if (!m.fx) return;
    m.fx.removeFromParent();
    m.fx = null;
    markFx--;
  };
  /** The explosion 0.85s after a mark is consumed, where the enemy stood. */
  const signature = (at: THREE.Vector3) => {
    g.vfx.playAt('Hwei_Passive_Detonate_Warning', at);
    audio.playAt('hwei_P_warning', at, g.pos);
    timers.push({
      at: g.time + PASSIVE.delay, run: () => {
        g.vfx.playAt('Hwei_Passive_Explosion', at);
        audio.playAt('hwei_P_explode', at, g.pos);
        const damage = lerpLevel(g.level, PASSIVE.damage) + PASSIVE.apRatio * ap();
        for (const e of g.enemiesNear(at, PASSIVE.radius, near)) if (inReach(e, at, PASSIVE.radius)) g.hurtEnemy(e, damage, HITS.proc);
      },
    });
  };
  /** A damaging spell hit `e`: consumes a mark left by a different spell, else marks it. */
  const markHit = (e: Enemy, c: Cast) => {
    let m = marks.get(e);
    if (m && m.until > g.time && m.spell !== c.spell) {
      dropMarkFx(m);
      m.until = 0;
      m.consumedBy = c.id; // the consuming cast does not mark again
      g.vfx.hit('Hwei_Passive_Tar', e.pos, 0, { size: boundSize(e) });
      signature(e.pos.clone().setY(0));
      return;
    }
    if (m?.consumedBy === c.id) return;
    if (!m) marks.set(e, (m = { spell: c.spell, until: 0, consumedBy: 0, fx: null }));
    const fresh = m.until <= g.time;
    m.spell = c.spell;
    m.until = g.time + PASSIVE.duration;
    if (fresh) audio.playAt('hwei_P_mark', e.pos, g.pos);
    if (!m.fx && markFx < PASSIVE.maxMarkFx) {
      m.fx = follow('Hwei_Passive_mark_ring', e.pos, 0, 0, PASSIVE.duration);
      markFx++;
    }
  };

  // ---- Stirring Lights ----
  const lightsOn = () => lightsUntil > g.time && flares.length > 0;
  const endLights = (expired: boolean) => {
    for (const f of flares) f.o.removeFromParent();
    flares = [];
    lightsBuff?.removeFromParent();
    lightsBuff = null;
    if (lightsUntil > 0) {
      const b = g.player.bone(CENTER);
      if (expired && b) g.vfx.playOn('Hwei_W_E_end', b, g.facing, g.player.root);
      audio.play('hwei_WE_end');
    }
    lightsUntil = 0;
  };
  /** One charge spent on `e`: a flare flies to it for the bonus damage; Hwei gets the mana back. */
  const spendLight = (e: Enemy, reduced: boolean) => {
    const W = SPELLS.WE;
    const f = flares.pop()!;
    const from = f.o.getWorldPosition(new THREE.Vector3());
    f.o.removeFromParent();
    g.mana = Math.min(g.maxMana, g.mana + W.mana[lightsRank]);
    const damage = (W.damage[lightsRank] + W.apRatio * ap()) * (reduced ? W.aoeMult : 1);
    g.spawnMissile('Hwei_W_E_Foxfire_Mis', from, e.pos, {
      speed: W.flareSpeed, range: 4000, radius: 10, damage, target: e, hit: HITS.proc, height: from.y,
      onHit: (x) => {
        g.vfx.hit('Hwei_W_E_Empowered_tar', x.pos, 0, { size: boundSize(x) });
        audio.play('hwei_WE_hit');
        g.hurtEnemy(x, damage, HITS.proc);
      },
    });
    if (!flares.length) endLights(false);
  };
  /**
   * Stirring Lights on a spell hit: the cast's first hit spends a charge (a flare flies to that enemy); the area
   * spells' other hits share it, at 50% against minions and monsters (QQ, QW, QE, EE and R in League).
   */
  const empower = (e: Enemy, c: Cast) => {
    const reduced = c.aoe && kind(e) !== 'epic';
    if (!c.empowered) {
      c.empowered = true;
      spendLight(e, reduced);
      return;
    }
    if (!c.aoe) return;
    const W = SPELLS.WE;
    g.hurtEnemy(e, (W.damage[lightsRank] + W.apRatio * ap()) * (reduced ? W.aoeMult : 1), HITS.proc);
  };

  /** A spell's damage on `e`: the passive and Stirring Lights first see it, then the hit lands. */
  const strike = (e: Enemy, damage: number, c: Cast) => {
    if (e.deadFor >= 0) return;
    markHit(e, c);
    g.hurtEnemy(e, damage, HITS[c.key]);
    if (e.deadFor < 0 && (c.empowered || lightsOn())) empower(e, c);
  };

  // ---- moods ----
  const closeMood = () => {
    inkTrail?.stop();
    inkTrail = null;
    mood = null;
    picked = null;
  };
  const openMood = (m: Mood) => {
    mood = m;
    const M = MOOD[m];
    g.gesture(M.activate);
    audio.play(`hwei_mood_${m}`);
    onBone(M.primed, LAYOUT);
    inkTrail = onBone(M.trail, BRUSH, true, true);
  };

  // ---- projectiles moved by the kit ----
  const fly = (key: string, from: THREE.Vector3, dir: THREE.Vector3, speed: number, range: number, o: Partial<Flight> = {}) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(from);
    g.scene.add(fx.root);
    flights.push({ fx, dir: dir.clone(), speed, left: range, travelled: 0, ...o });
  };
  const updateFlights = (dt: number) => {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (f.accel) f.speed = Math.min(f.maxSpeed ?? Infinity, f.speed + f.accel * dt);
      const step = Math.min(f.left, f.speed * dt);
      const p = f.fx.root.position;
      p.addScaledVector(f.dir, step);
      f.left -= step;
      f.travelled += step;
      f.fx.update(dt, f.dir, f.travelled);
      let hit: Enemy | null = null;
      if (f.onHit) {
        for (const e of g.enemiesNear(p, f.radius ?? 0, near)) {
          if (e.deadFor < 0 && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= e.def.radius + (f.radius ?? 0)) { hit = e; break; }
        }
      }
      if (!hit && f.left > 0) continue;
      f.fx.root.removeFromParent();
      flights.splice(i, 1);
      if (hit) f.onHit!(hit, p.clone());
      else f.onEnd?.(p.clone());
    }
  };

  // ---- Disaster ----
  const devastatingFire = (r: number, dir: THREE.Vector3) => {
    const S = SPELLS.QQ;
    const c = newCast('QQ', 'Q', true);
    const explode = (at: THREE.Vector3) => {
      at.setY(0);
      g.vfx.playAt('Hwei_Q_Q_explosion', at, Math.atan2(dir.x, dir.z));
      audio.playAt('hwei_QQ_hit', at, g.pos);
      const base = S.damage[r] + S.apRatio * ap();
      for (const e of g.enemiesNear(at, S.radius, near)) {
        if (!inReach(e, at, S.radius)) continue;
        const pct = S.maxHp[r] * e.maxHp;
        g.vfx.hit('Hwei_Q_Q_Tar', e.pos, 0, { size: boundSize(e) });
        strike(e, base + (kind(e) === 'minion' ? pct : Math.min(S.monsterCap, pct)), c);
      }
    };
    g.spawnMissile('Hwei_Q_Q_mis', g.pos, g.pos.clone().add(dir), {
      speed: S.speed, range: S.range, radius: S.width / 2, damage: 0, hit: HITS.Q, height: MISSILE_HEIGHT,
      onHit: (_e, m) => explode(m.pos.clone()), onEnd: (m) => explode(m.pos.clone()),
    });
    audio.play('hwei_QQ_launch');
  };

  const severingBolt = (r: number, point: THREE.Vector3) => {
    const S = SPELLS.QW;
    const at = clampPoint(point, S.range);
    g.vfx.playAt('Hwei_Q_W_warning', at);
    audio.playAt('hwei_QW_warning', at, g.pos);
    const c = newCast('QW', 'Q', true);
    timers.push({
      at: g.time + S.delay, run: () => {
        g.vfx.playAt('Hwei_Q_W_AoE', at);
        audio.playAt('hwei_QW_hit', at, g.pos);
        const hits = g.enemiesNear(at, S.radius, near).filter((e) => inReach(e, at, S.radius));
        const base = S.damage[r] + S.apRatio * ap();
        for (const e of hits) {
          let damage = base;
          // isolated (the only enemy hit) or immobilized: up to bonusMult times the damage by missing health
          if (hits.length === 1 || e.stunUntil > g.time || e.rootUntil > g.time) {
            const bonus = base * (S.bonusMult[r] - 1) * (1 - e.hp / e.maxHp);
            damage += kind(e) === 'epic' || kind(e) === 'minion' ? bonus : Math.min(S.monsterCap, bonus);
          }
          if (kind(e) !== 'epic') damage *= S.minionMult; // minions and non-epic monsters
          g.vfx.hit('Hwei_Q_W_Tar', e.pos, 0, { size: boundSize(e) });
          strike(e, damage, c);
        }
      },
    });
  };

  const moltenFissure = (r: number, dir: THREE.Vector3) => {
    const S = SPELLS.QE;
    const from = g.pos.clone().setY(0);
    const facing = Math.atan2(dir.x, dir.z);
    fly('Hwei_Q_E_Tell_Mis', from, dir, S.tellSpeed, S.range);
    audio.play('hwei_QE_launch');
    const c = newCast('QE', 'Q', true);
    const struck = new Set<Enemy>(); // the shockwaves hit each enemy once
    const scale = (e: Enemy) => kind(e) === 'minion' ? S.minionMult : S.monsterMult;
    // the eruption front leaves after 0.6s at 800 units/s, erupting every 150 units (HweiQE luaOnMissileUpdateDistanceInterval)
    for (let i = 1; i <= S.explosions; i++) {
      const at = from.clone().addScaledVector(dir, S.step * i);
      timers.push({
        at: g.time + S.delay + (S.step * i) / S.speed, run: () => {
          g.vfx.playAt('Hwei_Q_E_Lava', at, facing);
          audio.playAt('hwei_QE_lava', at, g.pos);
          lavas.push({ at, ticks: S.lava / S.tick, tickIn: S.tick, cast: c, rank: r });
          const damage = S.damage[r] + S.apRatio * ap();
          for (const e of g.enemiesNear(at, S.radius, near)) {
            if (!inReach(e, at, S.radius) || struck.has(e)) continue;
            struck.add(e);
            g.vfx.hit('Hwei_Q_E_Tar', e.pos, 0, { size: boundSize(e) });
            strike(e, damage * scale(e), c);
          }
        },
      });
    }
  };
  const updateLava = (dt: number) => {
    const S = SPELLS.QE;
    for (let i = lavas.length - 1; i >= 0; i--) {
      const l = lavas[i];
      if ((l.tickIn -= dt) > 0) continue;
      l.tickIn += S.tick;
      const damage = S.tickDamage[l.rank] + S.tickApRatio * ap();
      for (const e of g.enemiesNear(l.at, S.radius, near)) {
        if (!inReach(e, l.at, S.radius)) continue;
        g.slow(e, S.slow, S.tick + 0.05);
        g.hurtEnemy(e, damage * (kind(e) === 'minion' ? S.minionMult : S.monsterMult), HITS.proc);
      }
      if (--l.ticks <= 0) lavas.splice(i, 1);
    }
  };

  // ---- Serenity ----
  const fleetingCurrent = (r: number, dir: THREE.Vector3) => {
    const S = SPELLS.WQ;
    paths.push({ from: g.pos.clone().setY(0), dir: dir.clone(), len: 0, until: g.time + S.duration[r], rank: r, segs: [], nextSeg: 0 });
    audio.play('hwei_WQ_launch');
    audio.play('hwei_WQ_loop');
  };
  const updatePaths = (dt: number) => {
    const S = SPELLS.WQ;
    let inside = -1;
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i];
      if (g.time >= p.until) {
        for (const s of p.segs) s.stop();
        paths.splice(i, 1);
        continue;
      }
      if (p.len < S.range) {
        p.len = Math.min(S.range, p.len + S.speed * dt);
        // the current's missile lays a segment every 100 units (HweiWQ luaOnMissileUpdateDistanceInterval)
        while (p.nextSeg <= p.len && p.nextSeg <= S.range) {
          const at = p.from.clone().addScaledVector(p.dir, p.nextSeg);
          const sys = g.vfx.play('Hwei_W_Q_Trail', at, missileQuat(p.dir), { until: undefined, duration: p.until - g.time });
          if (sys) p.segs.push(sys);
          p.nextSeg += S.step;
        }
      }
      const dx = g.pos.x - p.from.x, dz = g.pos.z - p.from.z;
      const along = dx * p.dir.x + dz * p.dir.z;
      if (along >= -S.width / 2 && along <= p.len + S.width / 2 && Math.abs(dx * p.dir.z - dz * p.dir.x) <= S.width / 2) inside = Math.max(inside, p.rank);
    }
    if ((speedCheck -= dt) <= 0) {
      speedCheck = S.refresh;
      if (inside >= 0) {
        if (speedUntil <= g.time) {
          audio.play('hwei_WQ_speed');
          const b = g.player.bone(CENTER);
          if (b) g.vfx.playOn('Hwei_W_Q_Tar', b, g.facing, g.player.root);
        }
        speedPct = S.ms[inside] + S.msPerAp * ap();
        speedUntil = g.time + S.linger;
      }
    }
    const fast = speedUntil > g.time;
    if (fast && !speedFx) speedFx = onBone('Hwei_W_Q_Speedbuff', LAYOUT, false, true);
    if (!fast && speedFx) { speedFx.stop(); speedFx = null; }
  };

  const poolOfReflection = (point: THREE.Vector3, r: number) => {
    const S = SPELLS.WW;
    const at = clampPoint(point, S.range);
    g.vfx.play('Hwei_W_W_AoE', at, facingQuat(g.facing), { duration: S.duration });
    audio.playAt('hwei_WW_zone', at, g.pos);
    pools.push({ at, until: g.time + S.duration, rank: r, ticks: 0, tickIn: 0 });
  };
  const updatePools = (dt: number) => {
    const S = SPELLS.WW;
    for (let i = pools.length - 1; i >= 0; i--) {
      const p = pools[i];
      if (g.time >= p.until) { pools.splice(i, 1); continue; }
      if (Math.hypot(g.pos.x - p.at.x, g.pos.z - p.at.z) > S.radius) continue;
      if ((p.tickIn -= dt) > 0) continue;
      p.tickIn += S.tick;
      // half the shield on entering, growing a twelfth of it every 0.264s up to the full amount
      const full = S.shield[p.rank] + S.apRatio * ap();
      const want = full * Math.min(1, S.start + ((1 - S.start) * p.ticks) / S.ticksToFull);
      p.ticks++;
      if (!poolShield || g.shield <= 0) {
        audio.play('hwei_WW_shield');
        shieldFx?.removeFromParent();
        shieldFx = follow('Hwei_W_W_Shield', g.pos);
      }
      poolShield = true;
      g.addShield(Math.max(0, want - g.shield), S.linger);
    }
    if (poolShield) {
      if (g.shield <= 0) {
        poolShield = false;
        shieldFx?.removeFromParent();
        shieldFx = null;
        g.vfx.playAt('Hwei_W_W_Shield_Break', g.pos.clone().setY(0), g.facing);
        audio.play('hwei_WW_shield_end');
      } else shieldFx?.position.copy(g.pos).setY(0);
    }
  };

  const stirringLights = (r: number) => {
    const S = SPELLS.WE;
    endLights(false);
    lightsRank = r;
    lightsUntil = g.time + S.duration;
    lightsBuff = follow('Hwei_W_E_Buff', g.pos, 0, 0, S.duration);
    for (let i = 0; i < S.charges; i++) flares.push({ o: follow('Hwei_W_E_Foxfire_Mis', g.pos, S.orbitHeight), angle: (i * Math.PI * 2) / S.charges });
    audio.play('hwei_WE_buff');
  };
  const updateLights = (dt: number) => {
    if (!flares.length && !lightsBuff) return;
    if (g.time >= lightsUntil || !g.alive) { endLights(true); return; }
    const S = SPELLS.WE;
    lightsBuff?.position.copy(g.pos).setY(0);
    for (const f of flares) {
      f.angle += S.turn * dt;
      f.o.position.set(g.pos.x + Math.sin(f.angle) * S.orbit, S.orbitHeight, g.pos.z + Math.cos(f.angle) * S.orbit);
    }
  };

  // ---- Torment ----
  const grimVisage = (r: number, dir: THREE.Vector3) => {
    const S = SPELLS.EQ;
    const c = newCast('EQ', 'E', false);
    const from = g.pos.clone();
    g.spawnMissile('Hwei_E_Q_Mis', g.pos, g.pos.clone().add(dir), {
      speed: S.speed, range: S.range, radius: S.width / 2, damage: 0, hit: HITS.E, height: MISSILE_HEIGHT,
      onHit: (e, m) => {
        g.vfx.playAt('Hwei_E_Q_Mis_End', m.pos.clone().setY(0), Math.atan2(m.dir.x, m.dir.z));
        audio.play('hwei_EQ_hit');
        strike(e, S.damage[r] + S.apRatio * ap(), c);
        if (e.deadFor >= 0) return;
        const far = Math.min(1, Math.hypot(e.pos.x - from.x, e.pos.z - from.z) / S.range);
        g.fearEnemy(e, S.fear[r], g.pos);
        g.slow(e, S.slow[0] + (S.slow[1] - S.slow[0]) * far, S.fear[r]);
      },
      onEnd: (m) => g.vfx.playAt('Hwei_E_Q_Mis_End', m.pos.clone().setY(0), Math.atan2(m.dir.x, m.dir.z)),
    });
    audio.play('hwei_EQ_launch');
  };

  const gazeOfTheAbyss = (r: number, point: THREE.Vector3) => {
    const S = SPELLS.EW;
    const at = clampPoint(point, S.range);
    const dir = toward(at).clone();
    const dist = Math.hypot(at.x - g.pos.x, at.z - g.pos.z);
    audio.play('hwei_EW_launch');
    fly('Hwei_E_W_Eye', g.pos.clone().setY(MISSILE_HEIGHT), dir, S.speed, dist, {
      onEnd: () => {
        audio.playAt('hwei_EW_zone', at, g.pos);
        eyes.push({
          at, until: g.time + S.duration, lockAt: g.time + S.setup, fireAt: 0, target: null, rank: r, cast: newCast('EW', 'E', false),
          fx: [follow('Hwei_E_W_Eye_Waiting', at, 0, 0, S.duration), follow('Hwei_E_W_Ground', at, 0, 0, S.duration), follow('Hwei_E_W_Search_Ring', at, 0, 0, S.duration)], stare: [],
        });
      },
    });
  };
  const clearEye = (y: Eye) => { for (const o of [...y.fx, ...y.stare]) o.removeFromParent(); y.fx = []; y.stare = []; };
  const updateEyes = () => {
    const S = SPELLS.EW;
    for (let i = eyes.length - 1; i >= 0; i--) {
      const y = eyes[i];
      if (y.target && y.target.deadFor >= 0) { y.target = null; for (const o of y.stare) o.removeFromParent(); y.stare = []; }
      if (!y.target && g.time >= y.until) {
        clearEye(y);
        g.vfx.playAt('Hwei_E_W_Fizzle', y.at);
        audio.playAt('hwei_EW_zone_end', y.at, g.pos);
        eyes.splice(i, 1);
        continue;
      }
      if (!y.target && g.time >= y.lockAt) {
        y.target = g.nearestEnemy(y.at, S.radius + 200, (e) => inReach(e, y.at, S.radius));
        if (y.target) {
          y.fireAt = g.time + S.fireDelay;
          const facing = Math.atan2(y.target.pos.x - y.at.x, y.target.pos.z - y.at.z);
          y.stare = [follow('Hwei_E_W_stare', y.at, 0, facing), follow('Hwei_E_W_stare_Direction', y.at, 0, facing)];
          g.vfx.play('Hwei_E_W_Line', y.at.clone(), facingQuat(facing), { target: y.target.pos, duration: S.fireDelay });
          audio.playAt('hwei_EW_warning', y.at, g.pos);
        }
      }
      if (y.target) {
        if (g.time < y.fireAt) continue;
        // the eye launches itself at the locked enemy and roots the first enemy it meets
        // an enemy standing on the eye: aim from Hwei through it so the launch still meets it
        const dir = new THREE.Vector3(y.target.pos.x - y.at.x, 0, y.target.pos.z - y.at.z);
        if (dir.lengthSq() < 100) dir.set(y.target.pos.x - g.pos.x, 0, y.target.pos.z - g.pos.z);
        if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
        dir.normalize();
        const c = y.cast, rank = y.rank;
        fly('Hwei_E_W_mis', y.at.clone().setY(MISSILE_HEIGHT), dir, S.initialSpeed, S.launchRange, {
          accel: S.acceleration, maxSpeed: S.maxSpeed, radius: S.width / 2,
          onHit: (e) => {
            g.vfx.hit('Hwei_E_W_tar', e.pos.clone().setY(1), 0, { size: boundSize(e) });
            audio.play('hwei_EW_hit');
            strike(e, S.damage[rank] + S.apRatio * ap(), c);
            if (e.deadFor < 0) g.rootEnemy(e, S.root[rank]);
          },
        });
        clearEye(y);
        eyes.splice(i, 1);
      }
    }
  };

  const crushingMaw = (r: number, point: THREE.Vector3) => {
    const S = SPELLS.EE;
    const at = clampPoint(point, S.range);
    const dir = toward(at).clone();
    const facing = Math.atan2(dir.x, dir.z);
    // the jaws are authored from their near end: the bite's center sits 150 units ahead of the system
    g.vfx.playAt('Hwei_E_E_Hand', at.clone().addScaledVector(dir, -150), facing);
    audio.playAt('hwei_EE_zone', at, g.pos);
    const c = newCast('EE', 'E', true);
    timers.push({
      at: g.time + S.delay, run: () => {
        audio.playAt('hwei_EE_hit', at, g.pos);
        const reach = Math.hypot(S.width, S.depth) / 2;
        for (const e of g.enemiesNear(at, reach, near)) {
          if (e.deadFor >= 0) continue;
          const dx = e.pos.x - at.x, dz = e.pos.z - at.z;
          const along = dx * dir.x + dz * dir.z, side = dx * dir.z - dz * dir.x;
          if (Math.abs(along) > S.depth / 2 + e.def.radius || Math.abs(side) > S.width / 2 + e.def.radius) continue;
          g.vfx.hit('Hwei_E_E_tar', e.pos, facing, { size: boundSize(e) });
          strike(e, S.damage[r] + S.apRatio * ap(), c);
          if (e.deadFor >= 0) continue;
          if (Math.hypot(dx, dz) > 30) g.pullEnemy(e, at, S.pull);
          g.slow(e, S.slow[r], S.pull + S.slowFor, true);
        }
      },
    });
  };

  // ---- Spiraling Despair ----
  const auraRadius = (a: Aura) => {
    const [r0, r1] = SKILLS.R.radius;
    return r0 + (r1 - r0) * Math.min(1, a.age / SKILLS.R.duration);
  };
  const shatter = (a: Aura) => {
    const R = SKILLS.R;
    a.fx.removeFromParent();
    const radius = auraRadius(a);
    g.vfx.playAt('Hwei_R_AOE_Shatter', a.at.clone().setY(0));
    audio.playAt('hwei_R_shatter', a.at, g.pos);
    const damage = R.damage[a.rank] + R.apRatio * ap();
    for (const e of g.enemiesNear(a.at, radius, near)) {
      if (!inReach(e, a.at, radius)) continue;
      const d = despair.get(e);
      if (d) d.until = 0; // the explosion removes the stacks
      strike(e, damage, a.cast);
    }
  };
  const spiralingDespair = (r: number, dir: THREE.Vector3) => {
    const R = SKILLS.R;
    g.spawnMissile('Hwei_R_Mis', g.pos, g.pos.clone().add(dir), {
      speed: R.speed, range: R.range, radius: R.width / 2, damage: 0, hit: HITS.R, height: MISSILE_HEIGHT,
      onHit: (e) => {
        g.vfx.hit('Hwei_R_tar', e.pos, 0, { size: boundSize(e) });
        audio.play('hwei_R_hit');
        audio.playAt('hwei_R_grow', e.pos, g.pos);
        auras.push({ e, at: e.pos.clone().setY(0), age: 0, tickIn: R.tick, rank: r, cast: newCast('R', 'R', true), fx: follow('Hwei_R_AOE_Grow', e.pos, 0, 0, R.duration) });
      },
    });
    audio.play('hwei_R_launch');
  };
  const updateAuras = (dt: number) => {
    const R = SKILLS.R;
    for (let i = auras.length - 1; i >= 0; i--) {
      const a = auras[i];
      if (a.e.deadFor < 0) a.at.copy(a.e.pos).setY(0);
      a.fx.position.copy(a.at);
      a.age += dt;
      if ((a.tickIn -= dt) <= 0) {
        a.tickIn += R.tick;
        const radius = auraRadius(a);
        const damage = R.tickDamage[a.rank] + R.tickApRatio * ap();
        for (const e of g.enemiesNear(a.at, radius, near)) {
          if (!inReach(e, a.at, radius)) continue;
          let d = despair.get(e);
          if (!d) despair.set(e, (d = { stacks: 0, until: 0, fx: null }));
          if (d.until <= g.time) d.stacks = 0;
          d.stacks = Math.min(R.maxStacks, d.stacks + 1);
          d.until = g.time + R.slowFor;
          g.slow(e, 1 - (1 - R.slowPerStack) ** d.stacks, R.slowFor); // Despair's slows stack multiplicatively
          if (!d.fx && slowFx < R.maxSlowFx) { d.fx = follow('Hwei_R_Slow', e.pos); slowFx++; }
          g.hurtEnemy(e, damage, HITS.proc);
        }
      }
      if (a.age >= R.duration || a.e.deadFor >= 0) {
        shatter(a);
        auras.splice(i, 1);
      }
    }
    for (const [e, d] of despair) {
      if (d.until > g.time && e.deadFor < 0) { d.fx?.position.copy(e.pos).setY(0); continue; }
      if (d.fx) { d.fx.removeFromParent(); slowFx--; }
      despair.delete(e);
    }
  };

  const resolve = (s: Spell, r: number, point: THREE.Vector3) => {
    const dir = toward(point).clone();
    switch (s) {
      case 'QQ': return devastatingFire(r, dir);
      case 'QW': return severingBolt(r, point);
      case 'QE': return moltenFissure(r, dir);
      case 'WQ': return fleetingCurrent(r, dir);
      case 'WW': return; // the pool appears at the start of the cast (castStart)
      case 'WE': return stirringLights(r);
      case 'EQ': return grimVisage(r, dir);
      case 'EW': return gazeOfTheAbyss(r, point);
      case 'EE': return crushingMaw(r, point);
    }
  };

  const cleanup = () => {
    closeMood();
    endLights(false);
    for (const m of marks.values()) m.fx?.removeFromParent();
    for (const d of despair.values()) d.fx?.removeFromParent();
    for (const f of flights) f.fx.root.removeFromParent();
    for (const p of paths) for (const s of p.segs) s.stop();
    for (const y of eyes) clearEye(y);
    for (const a of auras) a.fx.removeFromParent();
    shieldFx?.removeFromParent();
    speedFx?.stop();
    marks.clear(); despair.clear();
    flights.length = lavas.length = paths.length = pools.length = eyes.length = timers.length = auras.length = 0;
    markFx = slowFx = 0;
    shieldFx = null; speedFx = null; poolShield = false; speedUntil = 0;
  };

  return {
    hud: () => t('champion.hwei.hud', { n: marks.size }),

    press(key) {
      if (mood) {
        if (key === 'R') { // Wash Brush: leaves the mood without its cost or cooldown, even under crowd control
          closeMood();
          g.gesture('washbrush');
          audio.play('hwei_wash');
          return null;
        }
        picked = `${mood}${key}` as Spell;
        return mood;
      }
      if (key === 'R') return undefined;
      if (g.stunned > 0 || !g.learned(key) || g.cooldowns[key] > 0) return null;
      openMood(key);
      return null;
    },

    aim(key) {
      if (!mood) return undefined;
      return key === 'R' ? 'none' : SPELLS[`${mood}${key}` as Spell].aim;
    },

    skillView(key) {
      if (!mood) return undefined;
      if (key === 'R') return { icon: `${HUD}/hweiwashbrush.png`, name: t('champion.hwei.wash'), as: null };
      const s = `${mood}${key}` as Spell;
      return { icon: SPELLS[s].icon, name: NAMES[s], as: mood };
    },

    castAnim(key) { return key !== 'R' && key === mood && picked ? SPELLS[picked].anim : undefined; },
    castTime(key) { return key !== 'R' && key === mood && picked ? SPELLS[picked].castTime : undefined; },

    castStart(key, point) {
      if (key === 'R') {
        const b = g.player.bone(LAYOUT);
        if (b) g.vfx.play('Hwei_R_cas', b.getWorldPosition(new THREE.Vector3()), facingQuat(g.facing), { bone: b, owner: g.player.root });
        return;
      }
      if (key !== mood || !picked) return;
      casting = picked;
      const M = MOOD[mood];
      closeMood();
      onBone(M.cast, BRUSH, true);
      audio.play(`hwei_${casting}`);
      if (casting === 'WW') poolOfReflection(point, Math.max(0, g.ranks.W - 1)); // the pool appears as the cast starts
    },

    cast(key, r, point) {
      if (key === 'R') return spiralingDespair(r, toward(point).clone());
      const s = casting;
      casting = null;
      if (s && s[0] === key) resolve(s, r, point);
    },

    moveAnims() {
      const fast = g.moveSpeed >= FAST_RUN;
      if (!mood) return fast ? { idle: 'idle_base', run: 'runfast' } : undefined;
      const M = MOOD[mood];
      return { idle: M.idle, run: fast ? M.runFast : M.run };
    },

    moveSpeedBonus: () => (speedUntil > g.time ? speedPct : 0),

    attackStart() {
      onBone('Hwei_BA_BrushRibbon', BRUSH, true);
      return undefined;
    },

    basicAttack(target, damage, crit, bolt) {
      const tip = g.player.bone(BRUSH_TIP);
      const from = tip ? tip.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(MISSILE_HEIGHT);
      g.spawnMissile('Hwei_BA_mis', from, target.pos, {
        speed: HWEI.base.missileSpeed, range: 3000, radius: 10, damage, target, height: from.y,
        hit: { ...HITS.auto, crit, bolt }, hitFx: 'Hwei_BA_tar_1', hitSound: crit ? 'hwei_crit_hit' : 'hwei_auto_hit',
      });
      if (!bolt) audio.play('hwei_auto_launch');
      return true;
    },

    onDamage(e, hit) {
      // Stirring Lights empowers basic attacks too (one charge each)
      if (hit.source === 'auto' && !hit.bolt && lightsOn()) spendLight(e, false);
      return 0;
    },

    update(dt) {
      if (!g.alive && mood) closeMood();
      for (let i = timers.length - 1; i >= 0; i--) {
        if (g.time < timers[i].at) continue;
        const run = timers[i].run;
        timers.splice(i, 1);
        run();
      }
      updateFlights(dt);
      updateLava(dt);
      updatePaths(dt);
      updatePools(dt);
      updateLights(dt);
      updateEyes();
      updateAuras(dt);
      for (const [e, m] of marks) {
        if (m.until > g.time && e.deadFor < 0) { m.fx?.position.copy(e.pos).setY(0); continue; }
        dropMarkFx(m);
        if (m.until <= g.time) marks.delete(e);
      }
    },

    dispose: cleanup,
  };
}
