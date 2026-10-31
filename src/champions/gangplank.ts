// Gangplank. Numbers mirror League of Legends (source: the DataValues of his spell bins, patch 26.21, cross-checked
// with the LoL wiki and Meraki Analytics).
// Adapted for hordes (asked for): attack range 250 (League: 125, melee) and Powder Keg recharges in half the time
// (8.5/8/7.5/7/6.5s; League: 17-13s). There are no Silver Serpents (Parrrley plunders nothing): Cannon Barrage's
// upgrades are picked instead, one at level 11 and another at level 16, out of Death's Daughter, Fire at Will and
// Raise Morale. "Against champions" (Powder Keg's bonus damage) means elite and epic monsters here; enemies never
// attack kegs, so they are never defused.
// Trial by Fire: every 15s the next basic attack burns for 50-250 (by level) +100% bonus AD (+2 per 1% crit chance)
// true damage over 2.5s and grants 15-30% Move Speed for 2s; every keg explosion resets it and grants the speed.
// Parrrley: a 2600 u/s shot at an enemy or a keg within 625; it can crit, applies on-hit effects and never Trial by Fire.
// Remove Scurvy: cleanses crowd control (castable while stunned) and heals 45-145 +90% AP +13% missing Health.
// Powder Keg: charges (3/3/4/4/5). A keg has 3 Health and loses 1 every 2/1/0.5s (by level, when placed) down to 1;
// Gangplank's attacks and Parrrley take 1. Destroyed by him it explodes (360 radius) for the attack's damage (x2 on a
// crit, +30% with Infinity Edge), ignoring 40% armor and slowing 40-80% for 2s, and kegs whose 345 connection radius
// overlap explode 0.3s apart (each enemy hit once per chain). The attack swing picks a keg in range when its chain
// would hit an enemy.
// Cannon Barrage: anywhere, 12 waves over 8s in clusters of 3 (0.25s apart) every 2s, each 40/70/100 +10% AP magic
// damage to every enemy within 580 and a 30% slow for 0.5s. Fire at Will: 18 waves, a cluster every 1.33s. Death's
// Daughter: after the first cluster a big ball deals a cluster's worth of true damage within 170 and slows 75% for 1s.
// Raise Morale: Gangplank gains 40% Move Speed in the zone, lingering 2s.
// Each wave is a Gangplank_R_Point_Blue over the zone (the authored rings span it, its mesh drops several balls that
// blast where they land) and the GangPlank_R_tar scorch. Gangplank_Q_Gold and Gangplank_Q_Token are Silver Serpent
// plunder (no coins here); Gangplank_Taunt_* belong to the taunt emote; the _Red/_Enemy variants are the enemy team's
// look; Global_Slow_BV2 and Gangplank_Sound_Q_Cas_BV2 are keys of the shared spell scripts; Gangplank_idle_barrel_01
// has no emitters. Gangplank_E_AoE_Green (the keg's range ring) is a uvMode 2 mesh, which the runtime does not
// support: it barely shows.
// Mana, like the mages here: lower costs (Q 30-18, W 40-70, R 80; League: Q 50-30, W 60-100, R 100) and kills by
// Parrrley or a keg explosion restore 10-30 mana (by level), once per second from minions and monsters, always from
// elite and epic ones (League: Parrrley kills plunder gold). Parrrley also triggers "on attack" item effects.
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { AttackProp, ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const BASE_MS = 345;
// the skin bins' SkinScale (Ezreal 1.1, Gangplank 0.95, keg 1.1) relative to Ezreal's, whose model plays at 1
const SCALE = 0.95 / 1.1;
const KEG_SCALE = 1.1 / 1.1;
const KEG_RADIUS = 65; // gameplay radius (League's default) for the attack reach on a keg
const Q_HEIGHT = 100; // Parrrley's missile height (mOffsetInitialTargetHeight)
const FUSE_TIME = 0.3; // the lit fuse running to the next keg (GangplankEBarrelFuseMissile travel time)
const lerpLevel = (level: number, a: number, b: number) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

const MANA = { restore: [10, 30], cooldown: 1 }; // mana on Parrrley and keg kills (by level), lockout against small enemies
const PASSIVE = {
  cooldown: 15, damage: [50, 250], bonusAdRatio: 1, critRatio: 200, // +2 per 1% crit chance, up to 100%
  ticks: 10, tick: 0.25, ms: [0.15, 0.3], msDuration: 2,
} as const;

const SKILLS = {
  Q: {
    name: t('champion.gangplank.Q'), desc: t('champion.gangplank.Q.desc'), damageType: 'physical', maxRank: 5, anim: 'gangplank_spell1_alt1', icon: `${ICON}/spell/GangplankQWrapper.png`,
    cooldown: [4.5, 4.5, 4.5, 4.5, 4.5], cost: [30, 27, 24, 21, 18], // League: 50-30
    damage: [10, 40, 70, 100, 130], adRatio: 1,
    range: 625, aim: 625, speed: 2600, castTime: 0.25,
  },
  W: {
    name: t('champion.gangplank.W'), desc: t('champion.gangplank.W.desc'), damageType: 'magic', maxRank: 5, anim: 'gangplank_spell2', icon: `${ICON}/spell/GangplankW.png`,
    cooldown: [22, 20, 18, 16, 14], cost: [40, 47, 55, 62, 70], // League: 60-100
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('champion.gangplank.heal'), values: [45, 70, 95, 120, 145] },
    aim: 'none', castTime: 0.25, cleanse: true, heal: [45, 70, 95, 120, 145], healApRatio: 0.9, missingHealth: 0.13,
  },
  E: {
    name: t('champion.gangplank.E'), desc: t('champion.gangplank.E.desc'), damageType: 'physical', maxRank: 5, anim: 'gangplank_spell3', icon: `${ICON}/spell/GangplankE.png`,
    cooldown: [0.5, 0.5, 0.5, 0.5, 0.5], cost: [0, 0, 0, 0, 0], // lockout between kegs; charges recharge on their own
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('champion.gangplank.slow'), values: [40, 50, 60, 70, 80], percent: true },
    aim: 1000, castTime: 0.25, range: 1000,
    charges: [3, 3, 4, 4, 5], recharge: [8.5, 8, 7.5, 7, 6.5], // League: 17/16/15/14/13s, halved
    health: 3, life: 25, decay: [2, 1, 0.5], decayLevels: [1, 7, 13],
    radius: 360, link: 345, chainDelay: 0.3, armorPen: 0.4, critMult: 2, critMultPerCritDamage: 0.75,
    slow: [0.4, 0.5, 0.6, 0.7, 0.8], slowDuration: 2, bigBonus: [75, 95, 115, 135, 155],
  },
  R: {
    name: t('champion.gangplank.R'), desc: t('champion.gangplank.R.desc'), damageType: 'magic', maxRank: 3, anim: 'gangplank_spell4', icon: `${ICON}/spell/GangplankR.png`,
    cooldown: [160, 140, 120], cost: [80, 80, 80], // League: 100
    damage: [40, 70, 100], apRatio: 0.1, hits: 12,
    aim: 2500, castTime: 0.25, radius: 580, duration: 8, delay: 0.5, waveGap: 0.25, perCluster: 3,
    clusters: 4, clusterGap: 2, fireClusters: 6, fireClusterGap: 4 / 3, slow: 0.3, slowDuration: 0.5,
    ddRatio: 3, ddRadius: 170, ddSlow: 0.75, ddSlowDuration: 1, moraleMs: 0.4, moraleLinger: 2,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  auto: { type: 'physical', source: 'auto', onHit: true },
  crit: { type: 'physical', source: 'auto', onHit: true, crit: true },
  Q: { type: 'physical', source: 'ability', skill: 'Q', onHit: true },
  Qcrit: { type: 'physical', source: 'ability', skill: 'Q', onHit: true, crit: true },
  E: { type: 'physical', source: 'ability', skill: 'E', armorPen: SKILLS.E.armorPen },
  Ecrit: { type: 'physical', source: 'ability', skill: 'E', armorPen: SKILLS.E.armorPen, crit: true },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  dd: { type: 'true', source: 'ability', skill: 'R' },
  burn: { type: 'true', source: 'item' }, // Trial by Fire's burn: a proc, like item burns
} as const satisfies Record<string, Hit>;

/** Cannon Barrage upgrades (the Silver Serpent shop items, by Data Dragon item id). */
const UPGRADES = { dd: '3902', fire: '3901', morale: '3903' } as const;
type Upgrade = keyof typeof UPGRADES;

export const GANGPLANK: ChampionDef = {
  id: 'gangplank', name: t('champion.gangplank.name'), model: 'gangplank', icon: `${ICON}/champion/Gangplank.png`,
  title: t('champion.gangplank.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Gangplank_0.jpg',
  roles: ['fighter'], difficulty: 9,
  scale: SCALE, // head at 165 (Ezreal's at 153), as in League
  hide: ['Crate_Mat'], // the recall crate (initialSubmeshToHide)
  base: {
    hp: 630, hpPerLevel: 114,
    hpRegen5: 6, hpRegen5PerLevel: 0.6,
    mana: 280, manaPerLevel: 60,
    manaRegen5: 8, manaRegen5PerLevel: 0.7,
    ad: 64, adPerLevel: 4.2,
    attackSpeed: 0.658, attackSpeedPerLevel: 0.032,
    attackRange: 250, // League: 125
    moveSpeed: BASE_MS,
    critDamage: 1.75,
    windupPercent: 0.25 / 1.52,
    missileSpeed: 2000, // melee: the hit lands at the end of the windup (the kit's basicAttack)
    radius: 65,
    armor: 31, armorPerLevel: 4.7,
  },
  skills: SKILLS,
  // OP.GG 16.21: Essence Reaver, The Collector, Infinity Edge; then Lord Dominik's, Immortal Shieldbow, Guardian Angel
  build: ['3508', '6676', '3031', '3036', '6673', '3026'],
  passive: { name: t('champion.gangplank.passive'), icon: `${ICON}/passive/Gangplank_Passive.png` },
  // the animation graph: Attack1/Attack2, Crit, Passive_Attack (Trial by Fire), Spell1 picks Spell1_Alt/Spell1_Alt2
  // (Spell1_Base on a crit), Run turns to Run_Haste from 575 Move Speed
  anims: {
    idle: 'gangplank_idle1', run: 'gangplank_run', death: 'gangplank_death',
    attacks: ['gangplank_attack1', 'gangplank_attack2'], crit: 'gangplank_crit',
  },
  animVfx: true, // swing trails, Parrrley's muzzle and the flare of Cannon Barrage
  vfx: { auto: 'Gangplank_BA_tar', crit: 'Gangplank_BA_Tar_Crit', autoHit: 'Gangplank_BA_tar', critHit: 'Gangplank_BA_Tar_Crit' },
  kit: gangplankKit,
};

interface Keg {
  pos: THREE.Vector3; hp: number; actor: Actor | null; ring: THREE.Object3D; links: Map<Keg, THREE.Object3D>;
  decay: number; decayFx: string; nextDecay: number; expireAt: number; rank: number; lit: boolean;
}
/** One chain reaction: the triggering attack's damage, crit, and the enemies already hit. */
interface Chain { damage: number; crit: boolean; hit: Set<Enemy> }
interface Burn { e: Enemy; ticks: number; next: number; damage: number }
interface Shot { fx: MissileFx; keg: Keg; damage: number; crit: boolean; dir: THREE.Vector3 }
interface Fuse { fx: MissileFx; from: THREE.Vector3; to: Keg; age: number; chain: Chain }
interface Barrage {
  at: THREE.Vector3; rank: number; start: number; waves: number[]; balls: number[]; dd: number; ddFalling: boolean;
  zone: THREE.Object3D; center: THREE.Object3D | null; speedZone: THREE.Object3D | null; morale: boolean;
}

function gangplankKit(g: Game): ChampionKit {
  loadModel('gangplankbarrel', [], 'gangplankbarrel').catch(() => {}); // the kegs, wanted from the first E
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const tmp = new THREE.Vector3();
  const kegs: Keg[] = [];
  const shots: Shot[] = [];
  const fuses: Fuse[] = [];
  const burns: Burn[] = [];
  const burnFx = new Map<Enemy, THREE.Object3D>();
  const barrages: Barrage[] = [];
  const upgrades = new Set<Upgrade>();
  let offered = 0; // upgrade popups shown (level 11 and 16)
  let charges = 1, recharging = 0, eRank = 0; // recharging: progress (0..1) of the next keg
  let passiveAt = 0, empowered = false, passiveFx: ParticleSystem | null = null;
  let msUntil = 0, msFx: THREE.Object3D | null = null;
  let moraleUntil = 0, moraleFx: THREE.Object3D | null = null;
  let qCrit = false;
  let manaReady = 0; // run time the minion/monster mana restore is ready again

  const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  const inReach = (e: Enemy, at: THREE.Vector3, r: number) => e.deadFor < 0 && flatDist(e.pos, at) - e.def.radius <= r;
  const big = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';
  const follow = (key: string, at: THREE.Vector3, height = 0) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(height);
    g.scene.add(o);
    return o;
  };
  const drop = (o: THREE.Object3D | null) => { o?.removeFromParent(); return null; };
  const critMult = () => GANGPLANK.base.critDamage + g.items.critDamage;

  // ---- Trial by Fire ----
  const passiveReady = () => g.time >= passiveAt;
  const speedUp = () => {
    msUntil = g.time + PASSIVE.msDuration;
    msFx ??= follow('Gangplank_P_Speed', g.pos);
  };
  const burn = (e: Enemy) => {
    const total = lerpLevel(g.level, PASSIVE.damage[0], PASSIVE.damage[1]) + PASSIVE.bonusAdRatio * g.bonusAd
      + PASSIVE.critRatio * Math.min(1, g.critChance);
    burns.push({ e, ticks: PASSIVE.ticks, next: g.time + PASSIVE.tick, damage: total / PASSIVE.ticks });
    if (!burnFx.has(e)) burnFx.set(e, follow('Gangplank_P_Burn', e.pos));
    g.vfx.hit('Gangplank_P_Tar', e.pos, g.facing, { size: boundSize(e) });
    audio.play('gangplank_P_burn');
  };

  // ---- Powder Keg ----
  const maxCharges = () => SKILLS.E.charges[Math.max(0, g.ranks.E - 1)];
  const chainOf = (start: Keg) => {
    const seen = new Set<Keg>([start]);
    for (const k of seen) for (const n of k.links.keys()) seen.add(n);
    return seen;
  };
  /** Whether exploding `k` now would hit an enemy somewhere along its chain. */
  const worth = (k: Keg) => {
    for (const c of chainOf(k)) if (g.nearestEnemy(c.pos, SKILLS.E.radius + 150, (e) => inReach(e, c.pos, SKILLS.E.radius))) return true;
    return false;
  };
  const unlink = (k: Keg) => {
    for (const [n, beam] of k.links) { beam.removeFromParent(); n.links.get(k)?.removeFromParent(); n.links.delete(k); }
    k.links.clear();
  };
  const removeKeg = (k: Keg) => {
    unlink(k);
    k.ring.removeFromParent();
    k.actor?.dispose();
    const i = kegs.indexOf(k);
    if (i >= 0) kegs.splice(i, 1);
  };
  const place = (at: THREE.Vector3, r: number) => {
    const E = SKILLS.E;
    let d = 0;
    while (d + 1 < E.decayLevels.length && g.level >= E.decayLevels[d + 1]) d++;
    const k: Keg = {
      pos: at.clone().setY(0), hp: E.health, actor: null, ring: follow('Gangplank_E_AoE_Green', at), links: new Map(),
      decay: E.decay[d], decayFx: (['Gangplank_E_Timer2', 'Gangplank_E_Timer3', 'Gangplank_E_Timer4'] as const)[d],
      nextDecay: g.time + E.decay[d], expireAt: g.time + E.life, rank: r, lit: false,
    };
    g.vfx.playAt(k.decayFx, k.pos, 0);
    // a powder trail to every keg whose connection radius overlaps
    for (const o of kegs) {
      if (flatDist(o.pos, k.pos) > 2 * E.link) continue;
      const beam = g.vfx.attach('Gangplank_E_Link', { target: o.pos });
      beam.position.copy(k.pos);
      g.scene.add(beam);
      k.links.set(o, beam);
      o.links.set(k, beam);
    }
    try {
      k.actor = new Actor('gangplankbarrel', KEG_SCALE);
      k.actor.root.position.copy(k.pos);
      k.actor.root.rotation.y = g.facing;
      k.actor.play('gangplankbarrel_spawn', { loop: false });
      g.scene.add(k.actor.root);
    } catch { /* model still downloading: the keg works without it */ }
    kegs.push(k);
    audio.playAt('gangplank_E_life', k.pos, g.pos);
  };
  const explode = (k: Keg, chain: Chain) => {
    const E = SKILLS.E;
    const next = [...k.links.keys()];
    removeKeg(k);
    g.vfx.playAt(chain.crit ? 'Gangplank_E_Explosion_Crit' : 'Gangplank_E_Explosion', k.pos, 0);
    audio.playAt('gangplank_E_explode', k.pos, g.pos);
    for (const e of g.enemiesNear(k.pos, E.radius + 150, near)) {
      if (chain.hit.has(e) || !inReach(e, k.pos, E.radius)) continue;
      chain.hit.add(e);
      g.slow(e, E.slow[k.rank], E.slowDuration);
      g.hurtEnemy(e, chain.damage + (big(e) ? E.bigBonus[k.rank] : 0), chain.crit ? HITS.Ecrit : HITS.E);
    }
    // Trial by Fire comes back with every explosion
    passiveAt = g.time;
    speedUp();
    // the chain: connected kegs light up and blow 0.3s later
    for (const n of next) light(n, k.pos, chain);
  };
  const light = (k: Keg, from: THREE.Vector3, chain: Chain) => {
    if (k.lit) return;
    k.lit = true;
    g.vfx.playAt('Gangplank_E_Detonate', k.pos, 0);
    const fx = g.vfx.missile('Gangplank_E_Fuze_Lit');
    fx.root.position.copy(from).setY(0);
    g.scene.add(fx.root);
    fuses.push({ fx, from: from.clone().setY(0), to: k, age: 0, chain });
  };
  /** Gangplank's attack or Parrrley lands on `k` for `damage` (before crit). */
  const strike = (k: Keg, damage: number, crit: boolean) => {
    if (!kegs.includes(k) || k.lit) return;
    if (--k.hp > 0) return;
    const E = SKILLS.E;
    const mult = crit ? E.critMult + E.critMultPerCritDamage * g.items.critDamage : 1;
    explode(k, { damage: damage * mult, crit, hit: new Set() });
  };
  const kegAt = (p: THREE.Vector3, r: number, from: THREE.Vector3, range: number) => {
    let best: Keg | null = null, bestD = r;
    for (const k of kegs) {
      const d = flatDist(k.pos, p);
      if (!k.lit && d <= bestD && flatDist(k.pos, from) - KEG_RADIUS <= range) { best = k; bestD = d; }
    }
    return best;
  };
  const prop = (k: Keg): AttackProp => ({
    pos: k.pos,
    gone: () => !kegs.includes(k) || k.lit,
    struck: (damage, crit) => {
      g.vfx.hit(crit ? 'Gangplank_BA_Tar_Crit' : 'Gangplank_BA_tar', k.pos, g.facing);
      audio.play(crit ? 'gangplank_crit_hit' : 'gangplank_auto_hit');
      strike(k, damage / (crit ? critMult() : 1), crit);
    },
  });

  // ---- Parrrley ----
  const qTarget = (point: THREE.Vector3) => {
    const Q = SKILLS.Q;
    const keg = kegAt(point, 120, g.pos, Q.range);
    if (keg) return keg;
    const inRange = (e: Enemy) => e.deadFor < 0 && flatDist(e.pos, g.pos) - e.def.radius <= Q.range;
    const e = g.enemyAt(point) ?? g.nearestEnemy(point, Q.range, inRange);
    if (!e || !inRange(e)) return null;
    // a keg ready to blow (1 Health) whose explosion covers the target is the better shot
    for (const k of kegs) {
      if (k.hp === 1 && !k.lit && flatDist(k.pos, g.pos) - KEG_RADIUS <= Q.range && inReach(e, k.pos, SKILLS.E.radius)) return k;
    }
    return e;
  };

  // ---- Cannon Barrage ----
  const wave = (b: Barrage) => {
    const R = SKILLS.R;
    const damage = R.damage[b.rank] + R.apRatio * g.ap;
    g.vfx.playAt('GangPlank_R_tar', b.at, 0);
    audio.playAt('gangplank_R_hit', b.at, g.pos); // Gangplank_R_Point_Blue's soundOnCreateDefault
    for (const e of g.enemiesNear(b.at, R.radius + 150, near)) {
      if (!inReach(e, b.at, R.radius)) continue;
      g.slow(e, R.slow, R.slowDuration);
      g.hurtEnemy(e, damage, HITS.R);
    }
  };
  const deathsDaughter = (b: Barrage) => {
    const R = SKILLS.R;
    b.center = drop(b.center);
    g.vfx.playAt('Gangplank_R_Tar_Large', b.at, 0);
    audio.playAt('gangplank_R_bigshot', b.at, g.pos);
    const damage = R.ddRatio * (R.damage[b.rank] + R.apRatio * g.ap);
    for (const e of g.enemiesNear(b.at, R.ddRadius + 150, near)) {
      if (!inReach(e, b.at, R.ddRadius)) continue;
      g.slow(e, R.ddSlow, R.ddSlowDuration);
      g.hurtEnemy(e, damage, HITS.dd);
    }
  };
  const volley = (b: Barrage) => g.vfx.playAt('Gangplank_R_Point_Blue', b.at, Math.random() * Math.PI * 2);
  const BALL_FALL = 0.2; // Gangplank_R_Point_Blue: the balls land (their blast child starts) 0.2s after the system
  const DD_FALL = 0.5; // Gangplank_R_Point_Large: the big ball's fall before its blast
  const barrage = (at: THREE.Vector3, r: number) => {
    const R = SKILLS.R;
    const fire = upgrades.has('fire');
    const clusters = fire ? R.fireClusters : R.clusters, gap = fire ? R.fireClusterGap : R.clusterGap;
    const waves: number[] = [];
    for (let c = 0; c < clusters; c++) for (let w = 0; w < R.perCluster; w++) waves.push(g.time + R.delay + c * gap + w * R.waveGap);
    const balls = waves.map((t) => t - BALL_FALL);
    const dd = upgrades.has('dd') ? waves[R.perCluster - 1] + R.waveGap : Infinity;
    const zone = follow('Gangplank_R_AoE_Green', at);
    const morale = upgrades.has('morale');
    barrages.push({
      at: at.clone().setY(0), rank: r, start: g.time, waves, balls, dd, ddFalling: false, zone, morale,
      center: dd < Infinity ? follow('Gangplank_R_AoE_Center_Green', at) : null,
      speedZone: morale ? follow('Gangplank_R_Speed_Zone', at) : null,
    });
  };
  const updateBarrages = () => {
    const R = SKILLS.R;
    for (let i = barrages.length - 1; i >= 0; i--) {
      const b = barrages[i];
      while (b.balls.length && g.time >= b.balls[0]) { b.balls.shift(); volley(b); }
      while (b.waves.length && g.time >= b.waves[0]) {
        const first = b.waves.length % R.perCluster === 0; // first wave of a cluster
        if (first) audio.playAt('gangplank_R_shots', b.at, g.pos);
        b.waves.shift();
        wave(b);
      }
      if (b.dd < Infinity && !b.ddFalling && g.time >= b.dd - DD_FALL) {
        b.ddFalling = true;
        g.vfx.playAt('Gangplank_R_Point_Large', b.at, 0);
      }
      if (g.time >= b.dd) { b.dd = Infinity; deathsDaughter(b); }
      if (b.morale && g.alive && flatDist(g.pos, b.at) <= R.radius) {
        if (g.time >= moraleUntil) audio.play('gangplank_R_speed');
        moraleUntil = g.time + R.moraleLinger;
      }
      if (g.time >= b.start + R.duration && !b.waves.length && b.dd === Infinity) {
        drop(b.zone); drop(b.center); drop(b.speedZone);
        barrages.splice(i, 1);
      }
    }
  };

  // ---- upgrades at level 11 and 16 ----
  const offerUpgrade = () => {
    const left = (Object.keys(UPGRADES) as Upgrade[]).filter((u) => !upgrades.has(u));
    g.choices.push({
      title: t('champion.gangplank.upgrade.title', { level: g.level }),
      options: left.map((u) => ({
        name: t(`champion.gangplank.upgrade.${u}`), text: t(`champion.gangplank.upgrade.${u}.desc`),
        icon: `${ICON}/item/${UPGRADES[u]}.png`,
        run: () => { upgrades.add(u); audio.play('gangplank_R_bigshot'); },
      })),
    });
  };

  return {
    moveSpeedBonus() {
      let ms = g.time < msUntil ? lerpLevel(g.level, PASSIVE.ms[0], PASSIVE.ms[1]) : 0;
      if (g.time < moraleUntil) ms += SKILLS.R.moraleMs;
      return ms;
    },
    moveAnims: () => (g.moveSpeed >= 575 ? { idle: 'gangplank_idle1', run: 'gangplank_run_haste' } : undefined),
    hud: () => (passiveReady()
      ? t('champion.gangplank.hud.ready', { kegs: kegs.length })
      : t('champion.gangplank.hud', { s: Math.ceil(passiveAt - g.time), kegs: kegs.length })),
    gauge: () => ({
      label: passiveReady() ? String(kegs.length) : `${Math.ceil(passiveAt - g.time)}s`,
      fill: passiveReady() ? 1 : 1 - (passiveAt - g.time) / PASSIVE.cooldown,
      ready: passiveReady(),
    }),
    skillView: (key) => (key === 'E' && g.ranks.E > 0 ? { badge: String(charges) } : undefined),

    canCast(key) {
      if (key === 'E') return charges > 0;
      if (key === 'Q') return g.nearestEnemy(g.pos, SKILLS.Q.range + 100, (e) => flatDist(e.pos, g.pos) - e.def.radius <= SKILLS.Q.range) !== null
        || kegs.some((k) => !k.lit && flatDist(k.pos, g.pos) - KEG_RADIUS <= SKILLS.Q.range);
      return true;
    },

    castAnim(key) {
      if (key !== 'Q') return undefined;
      qCrit = Math.random() < g.critChance; // decided with the cast: Spell1_Base swings for a crit
      return qCrit ? 'gangplank_spell1' : Math.random() < 0.5 ? 'gangplank_spell1_alt1' : 'gangplank_spell1_alt2';
    },

    castStart(key) {
      if (key === 'E') charges--; // spent at the start: a stun that cancels the cast loses it, like the mana
      else if (key === 'W') audio.play('gangplank_W_foley');
      else if (key === 'Q') audio.play(qCrit ? 'gangplank_Q_crit_swing' : 'gangplank_Q_swing');
    },

    attackStart() {
      empowered = passiveReady();
      return empowered ? { anim: 'gangplank_passive_attack', sound: 'gangplank_P_auto' } : undefined;
    },

    // melee: the hit lands at the end of the windup, no missile
    basicAttack(target, damage, crit, bolt) {
      g.vfx.hit(crit ? 'Gangplank_BA_Tar_Crit' : 'Gangplank_BA_tar', target.pos, g.facing, { size: boundSize(target) });
      audio.play(crit ? 'gangplank_crit_hit' : 'gangplank_auto_hit');
      g.hurtEnemy(target, damage, bolt ? { ...(crit ? HITS.crit : HITS.auto), bolt } : crit ? HITS.crit : HITS.auto);
      if (empowered && !bolt) {
        empowered = false;
        passiveAt = g.time + PASSIVE.cooldown;
        burn(target);
        speedUp();
      }
      return true;
    },

    attackProp() {
      // swing at a keg in reach when its chain would hit an enemy (the lowest Health first)
      let best: Keg | null = null;
      for (const k of kegs) {
        if (k.lit || flatDist(k.pos, g.pos) - KEG_RADIUS - GANGPLANK.base.radius > g.attackRange) continue;
        if (best && k.hp >= best.hp) continue;
        if (worth(k)) best = k;
      }
      return best ? prop(best) : null;
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        const target = qTarget(point);
        const crit = qCrit;
        const base = Q.damage[r] + Q.adRatio * g.ad;
        const damage = base * (crit ? critMult() : 1);
        if (!target) { g.mana += g.costOf('Q'); g.cooldowns.Q = 0; return; } // nothing left to shoot: no cost, like League
        audio.play(crit ? 'gangplank_Q_crit_launch' : 'gangplank_Q_launch');
        if (!('links' in target)) g.attackEffects(target, damage, crit); // on attack, like a basic attack (a keg is no unit)
        const hand = g.player.bone('R_Hand');
        const from = hand ? hand.getWorldPosition(new THREE.Vector3()) : g.pos;
        if ('hp' in target && 'links' in target) {
          const fx = g.vfx.missile(crit ? 'Gangplank_Q_Mis_Crit' : 'Gangplank_Q_Mis');
          fx.root.position.copy(from).setY(Q_HEIGHT);
          g.scene.add(fx.root);
          shots.push({ fx, keg: target, damage: base, crit, dir: new THREE.Vector3() });
          return;
        }
        g.spawnMissile(crit ? 'Gangplank_Q_Mis_Crit' : 'Gangplank_Q_Mis', from, target.pos, {
          speed: Q.speed, range: 3000, radius: 10, damage, target, height: Q_HEIGHT, hit: crit ? HITS.Qcrit : HITS.Q,
          hitFx: crit ? 'Gangplank_Q_Tar_Crit' : 'Gangplank_Q_Tar', hitSound: crit ? 'gangplank_Q_crit_hit' : 'gangplank_Q_hit',
        });
      } else if (key === 'W') {
        const W = SKILLS.W;
        audio.play('gangplank_W_cleanse');
        const head = g.player.bone('C_Buffbone_Glb_Head_Loc');
        if (head) g.vfx.playOn('Gangplank_W_Citrus', head, g.facing, g.player.root);
        g.vfx.playAt('Gangplank_W_Heal', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
        g.heal(W.heal[r] + W.healApRatio * g.ap + W.missingHealth * (g.maxHp - g.hp));
      } else if (key === 'E') {
        const E = SKILLS.E;
        const dir = tmp.copy(point).sub(g.pos).setY(0);
        const d = Math.min(dir.length(), E.range);
        const at = d > 0 ? g.pos.clone().addScaledVector(dir.normalize(), d) : g.pos.clone();
        place(at, r);
      } else {
        audio.play('gangplank_R_shots');
        barrage(point, r);
      }
    },

    onKill(e, hit) {
      if (hit.skill !== 'Q' && hit.skill !== 'E') return;
      if (!big(e)) {
        if (g.time < manaReady) return;
        manaReady = g.time + MANA.cooldown;
      }
      g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, MANA.restore[0], MANA.restore[1]));
    },

    update(dt) {
      // Powder Keg charges: one recharges at a time, even before the skill is learned
      const E = SKILLS.E;
      const r = Math.max(0, g.ranks.E - 1);
      if (g.ranks.E !== eRank) {
        // ranking up while full grants the new charge at once
        if (charges >= SKILLS.E.charges[Math.max(0, eRank - 1)]) charges = maxCharges();
        eRank = g.ranks.E;
      }
      const time = E.recharge[r] * (g.cooldownOf('E') / E.cooldown[r]); // ability haste shortens it too
      if (charges < maxCharges() && (recharging += dt / time) >= 1) { charges++; recharging = 0; }
      if (charges === 0) g.cooldowns.E = Math.max(g.cooldowns.E, (1 - recharging) * time);

      // kegs: decay down to 1 Health, expire after 25s
      for (let i = kegs.length - 1; i >= 0; i--) {
        const k = kegs[i];
        k.actor?.update(dt);
        if (k.actor?.currentName === 'gangplankbarrel_spawn' && k.actor && g.time > k.expireAt - E.life + k.actor.duration('gangplankbarrel_spawn')) {
          k.actor.play('gangplankbarrel_idle1');
        }
        if (k.lit) continue;
        if (g.time >= k.expireAt) {
          audio.playAt('gangplank_E_gone', k.pos, g.pos);
          removeKeg(k);
          continue;
        }
        if (k.hp > 1 && g.time >= k.nextDecay) {
          k.hp--;
          k.nextDecay = g.time + k.decay;
          if (k.hp > 1) g.vfx.playAt(k.decayFx, k.pos, 0);
          else g.vfx.playAt('Gangplank_E_Smoke', k.pos, 0);
        }
      }
      // lit fuses running down the powder trails
      for (let i = fuses.length - 1; i >= 0; i--) {
        const f = fuses[i];
        f.age += dt;
        const k = Math.min(1, f.age / FUSE_TIME);
        const dir = tmp.copy(f.to.pos).sub(f.from).setY(0);
        f.fx.root.position.copy(f.from).addScaledVector(dir, k);
        f.fx.update(dt, dir.normalize(), k);
        if (f.age < E.chainDelay) continue;
        f.fx.root.removeFromParent();
        fuses.splice(i, 1);
        if (kegs.includes(f.to)) explode(f.to, f.chain);
      }
      // Parrrley shots flying to a keg
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        const at = s.fx.root.position;
        const to = tmp.copy(s.keg.pos).setY(Q_HEIGHT).sub(at);
        const d = to.length(), step = SKILLS.Q.speed * dt;
        if (kegs.includes(s.keg) && !s.keg.lit && d > step) {
          s.dir.copy(to).divideScalar(d);
          at.addScaledVector(s.dir, step);
          s.fx.update(dt, s.dir, 0);
          continue;
        }
        s.fx.root.removeFromParent();
        shots.splice(i, 1);
        if (!kegs.includes(s.keg) || s.keg.lit) continue;
        g.vfx.hit(s.crit ? 'Gangplank_Q_Tar_Crit' : 'Gangplank_Q_Tar', s.keg.pos.clone().setY(Q_HEIGHT), g.facing);
        audio.play(s.crit ? 'gangplank_Q_crit_hit' : 'gangplank_Q_hit');
        strike(s.keg, s.damage, s.crit);
      }

      // Trial by Fire: the blade burns while ready; burns tick on their own
      if (passiveReady() && g.alive) {
        const bone = g.player.bone('Buffbone_Glb_Weapon_2'); // the sword (Weapon_1 is the pistol: Parrrley's muzzle)
        if (!passiveFx && bone) {
          passiveFx = g.vfx.play('Gangplank_P_Buf', bone.getWorldPosition(tmp), bone.getWorldQuaternion(new THREE.Quaternion()),
            { bone, orient: true, owner: g.player.root, until: undefined }) ?? null;
        }
      } else if (passiveFx) { passiveFx.stop(); passiveFx = null; }
      for (let i = burns.length - 1; i >= 0; i--) {
        const b = burns[i];
        if (b.e.deadFor >= 0) { burns.splice(i, 1); continue; }
        if (g.time < b.next) continue;
        b.next += PASSIVE.tick;
        g.hurtEnemy(b.e, b.damage, HITS.burn);
        if (--b.ticks <= 0) burns.splice(i, 1);
      }
      for (const [e, o] of burnFx) {
        if (e.deadFor >= 0 || !burns.some((b) => b.e === e)) { o.removeFromParent(); burnFx.delete(e); }
        else o.position.copy(e.pos).setY(0);
      }
      if (msFx) {
        if (g.time >= msUntil) msFx = drop(msFx);
        else msFx.position.copy(g.pos).setY(0);
      }

      updateBarrages();
      if (moraleFx || g.time < moraleUntil) {
        if (g.time >= moraleUntil) moraleFx = drop(moraleFx);
        else (moraleFx ??= follow('Gangplank_R_Speed_Buf', g.pos)).position.copy(g.pos).setY(0);
      }

      const owed = (g.level >= 11 ? 1 : 0) + (g.level >= 16 ? 1 : 0);
      if (offered < owed) { offered++; offerUpgrade(); }
    },

    dispose() {
      for (const k of [...kegs]) removeKeg(k);
      for (const s of shots) s.fx.root.removeFromParent();
      for (const f of fuses) f.fx.root.removeFromParent();
      for (const o of burnFx.values()) o.removeFromParent();
      for (const b of barrages) { drop(b.zone); drop(b.center); drop(b.speedZone); }
      shots.length = fuses.length = burns.length = barrages.length = 0;
      burnFx.clear();
      passiveFx?.stop();
      passiveFx = null;
      msFx = drop(msFx);
      moraleFx = drop(moraleFx);
    },
  };
}
