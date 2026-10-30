// Aphelios. Numbers mirror League of Legends: the client's spell data (DataValues and spell calculations of
// data/characters/aphelios/aphelios.bin), Meraki Analytics for base stats and timings.
// Five Moonstone weapons, a main one and an off-hand: the main weapon decides the basic attack and the Q, the off-hand
// joins the Qs that attack (Onslaught, Duskwave, Sentry) and the long-range Calibrum mark attack. Each weapon has 50
// Moonlight (1 per attack, 10 per Q); an empty main weapon goes to the end of the queue and the next one is assembled.
// Skill points buy bonus AD (Q), attack speed (W) or lethality (E); the weapon abilities grow with level, R by itself.
// Adapted for hordes: what LoL limits to enemy champions works on any enemy (Moonlight Vigil stops on, and heals for,
// the first enemy; Crescendum's chakrams refresh on any target). Enemies do not attack the sentry (it lasts its timer).
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t, type Key } from '../i18n';
import { facingQuat, missileQuat, type ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
// per-weapon HUD icons are not on Data Dragon: CommunityDragon serves the client's hud/icons2d
const HUD = 'https://raw.communitydragon.org/latest/game/assets/characters/aphelios/hud/icons2d';

export type Weapon = 'calibrum' | 'severum' | 'gravitum' | 'infernum' | 'crescendum';
const WEAPONS: readonly Weapon[] = ['calibrum', 'severum', 'gravitum', 'infernum', 'crescendum'];
// clip set per weapon; written out because tools/optimize.mjs keeps only the clips named literally in the bundle
type ClipName = 'idle1' | 'run1' | 'attack1' | 'attack2' | 'spell1' | 'spell2';
const CLIPS: Record<Weapon, Record<ClipName, string>> = {
  severum: { idle1: 'aphelios_a_idle1', run1: 'aphelios_a_run1', attack1: 'aphelios_a_attack1', attack2: 'aphelios_a_attack2', spell1: 'aphelios_a_spell1', spell2: 'aphelios_a_spell2' },
  calibrum: { idle1: 'aphelios_b_idle1', run1: 'aphelios_b_run1', attack1: 'aphelios_b_attack1', attack2: 'aphelios_b_attack2', spell1: 'aphelios_b_spell1', spell2: 'aphelios_b_spell2' },
  gravitum: { idle1: 'aphelios_c_idle1', run1: 'aphelios_c_run1', attack1: 'aphelios_c_attack1', attack2: 'aphelios_c_attack2', spell1: 'aphelios_c_spell1', spell2: 'aphelios_c_spell2' },
  infernum: { idle1: 'aphelios_d_idle1', run1: 'aphelios_d_run1', attack1: 'aphelios_d_attack1', attack2: 'aphelios_d_attack2', spell1: 'aphelios_d_spell1', spell2: 'aphelios_d_spell2' },
  crescendum: { idle1: 'aphelios_e_idle1', run1: 'aphelios_e_run1', attack1: 'aphelios_e_attack1', attack2: 'aphelios_e_attack2', spell1: 'aphelios_e_spell1', spell2: 'aphelios_e_spell2' },
};
const BONE: Record<Weapon, string> = { calibrum: 'Calibrum', severum: 'Severum', gravitum: 'Gravitum', infernum: 'Infernum', crescendum: 'Crescendum' };
const clip = (w: Weapon, name: ClipName) => CLIPS[w][name];
// Duskwave hands the off-hand weapon over with its own systems; some keys are only hashes in the skin bin
const DUSK_SWAP: Record<Weapon, readonly string[]> = {
  calibrum: ['Aphelios_Q_infernum_swapTo_calibrum', 'Aphelios_Q_infernum_swipeTo_calibrum'],
  severum: ['0x18dd43b2', '0x5e560b87'], gravitum: ['0x20cb0bd2', '0x8ff82199'], crescendum: ['0xa03ad10e', '0x92d8eb15'], infernum: [],
};
const FX = { infernumSplit: '0x1abade44', infernumMark: '0xc59c22e1', chainMis: '0x24ff9430', chainBeam: '0xc016c59a' };

const PASSIVE = {
  ammo: 50, qAmmo: 10, assemble: 1, assembleQCooldown: 1.5,
  ad: 4, as: 0.09, lethality: 4.5, // per skill point (Q W E)
  calibrumRange: 100, markDuration: 4.5, markRange: 1800, markBase: 15, markBonusAd: 0.15,
  severumHeal: [0.02, 0.071], severumAbility: 2.5, shieldBase: 10, shieldPerLevel: 10, shieldFrom: 6, shieldHp: 0.06, shieldDuration: 30,
  gravitumSlow: 0.3, gravitumDecayTo: 0.1, gravitumDecayAt: 0.7, gravitumDuration: 2.5, gravitumArc: 90,
  infernumMult: 1.1, infernumBolts: 4, infernumCritBolts: 6, infernumCone: Math.PI / 6, infernumRange: 400, infernumSecondary: [0.75, 1], infernumMinion: 0.3,
  chakramMax: 20, chakramDuration: 5, chakramFirst: 0.15, chakramStep: 0.015, chakramMin: 0.05,
  orbitRadius: 110, orbitHeight: 110, orbitSpin: 2.5, // the chakrams circling Aphelios (radians/s)
  crescendumSpeed: 2600, returnSpeed: 600, returnPerAs: 750, linger: 0.2, windup: 0.1067, critWindup: 0.0667,
};

// by champion level: 7 steps at levels 1/3/5/7/9/11/13
const step = (level: number, first: number, per: number) => first + per * Math.min(6, Math.floor((Math.max(1, level) - 1) / 2));

const Q = {
  calibrum: { castTime: 0.35, cooldown: [10, -1 / 3], damage: [70, 15], bonusAd: [0.42, 0.03], ap: 1, range: 1450, speed: 1800, width: 120 },
  severum: { castTime: 0.05, cooldown: [10, -1 / 3], adRatio: [0.2, 0.035], duration: 1.75, attacks: 6, asCoeff: 0.333, radius: 550, ms: 0.25, msPerAp: 0.001, onHit: 0.25 },
  gravitum: { castTime: 0.25, cooldown: [12, -1 / 3], damage: [50, 15], bonusAd: [0.32, 0.03], ap: 0.7, root: 1 },
  infernum: { castTime: 0.4, cooldown: [9, -0.5], damage: [20, 15], bonusAd: [0.15, 0.01], ap: 0.7, range: 650, cone: (20 * Math.PI) / 180, volleyDelay: 0.25 },
  crescendum: {
    castTime: 0.25, cooldown: [9, -0.5], damage: [35, 15], bonusAd: [0.34, 0.03], ap: 0.5, range: 475, speed: 1500, arm: 0.35,
    idle: 20, active: 4, attackRange: 500, scale: 1.4,
  },
} as const;

const SKILLS = {
  Q: {
    name: t('champion.aphelios.Q'), desc: t('champion.aphelios.Q.desc'), damageType: 'physical', maxRank: 6, anim: 'aphelios_b_spell1', icon: `${HUD}/apheliosq.png`,
    cooldown: [0, 0, 0, 0, 0, 0], cost: [60, 60, 60, 60, 60, 60], damage: [0, 0, 0, 0, 0, 0], unlockLevel: 2,
    extra: { label: t('stat.ad'), values: [4, 8, 12, 16, 20, 24] }, castTime: 0.35, aim: 1450,
  },
  W: {
    name: t('champion.aphelios.W'), desc: t('champion.aphelios.W.desc'), damageType: 'physical', maxRank: 6, anim: 'aphelios_b_spell2', icon: `${ICON}/spell/ApheliosW.png`,
    cooldown: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], cost: [0, 0, 0, 0, 0, 0], damage: [0, 0, 0, 0, 0, 0], unlockLevel: 1,
    extra: { label: t('stat.as'), values: [0.09, 0.18, 0.27, 0.36, 0.45, 0.54], percent: true }, castTime: 0.05, aim: 'none',
  },
  E: {
    name: t('champion.aphelios.E'), desc: t('champion.aphelios.E.desc'), damageType: 'physical', maxRank: 6, anim: 'none', icon: `${ICON}/spell/ApheliosE_ClientTooltipWrapper.png`,
    cooldown: [0, 0, 0, 0, 0, 0], cost: [0, 0, 0, 0, 0, 0], damage: [0, 0, 0, 0, 0, 0], unlockLevel: 1,
    extra: { label: t('stat.lethality'), values: [4.5, 9, 13.5, 18, 22.5, 27] }, castTime: 0.05, aim: 'none',
  },
  R: {
    name: t('champion.aphelios.R'), desc: t('champion.aphelios.R.desc'), damageType: 'physical', maxRank: 3, anim: 'aphelios_spell4', icon: `${ICON}/spell/ApheliosR.png`,
    cooldown: [120, 110, 100], cost: [100, 100, 100], damage: [125, 175, 225], bonusAdRatio: 0.2, apRatio: 1,
    range: 1300, aim: 1300, width: 125, radius: 300, lockDelay: 0.35, castTime: 0.5, speed: 2050, critBase: 1.2,
    markBonus: [50, 80, 110], heal: [250, 350, 450], slow: 0.99, root: 1.35, infernumBonus: [50, 100, 150], infernumBonusAd: 0.25,
    infernumRadius: 400, infernumBolts: 14, infernumCritBolts: 18, infernumPenalty: 0.9, chakrams: 5,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

// most hits come in a plain and a critical version; Severum's heal recognises its own hits (SEVERUM)
const hit = (h: Hit) => ({ ...h, crit: false }) as Hit;
const critOf = (h: Hit) => ({ ...h, crit: true }) as Hit;
const pair = (h: Hit) => [hit(h), critOf(h)] as const;
type HitPair = readonly [Hit, Hit];
const HITS = {
  auto: pair({ type: 'physical', source: 'auto', onHit: true }),
  bolt: pair({ type: 'physical', source: 'auto', onHit: true, bolt: true }), // Runaan's Hurricane
  mark: { type: 'physical', source: 'auto', onHit: true, bolt: true } as Hit, // Calibrum marks: on-hit, no on-attack
  splash: { type: 'physical', source: 'auto', bolt: true } as Hit, // Infernum's secondary bolts
  Q: { type: 'physical', source: 'ability', skill: 'Q' } as Hit,
  QMagic: { type: 'magic', source: 'ability', skill: 'Q' } as Hit,
  QAttack: pair({ type: 'physical', source: 'ability', skill: 'Q', onHit: true }), // off-hand volleys and sentry shots
  QOnslaught: pair({ type: 'physical', source: 'ability', skill: 'Q', onHit: true, onHitMult: Q.severum.onHit }),
  R: { type: 'physical', source: 'ability', skill: 'R' } as Hit,
  RAttack: pair({ type: 'physical', source: 'ability', skill: 'R', onHit: true }),
  RSplash: { type: 'physical', source: 'ability', skill: 'R' } as Hit,
};
// the same hits dealt by Severum (attacks, Onslaught's own shots, Resurgent sentry, a Severum Moonlight Vigil)
const sev = (p: HitPair) => [{ ...p[0] }, { ...p[1] }] as const;
const SEV = { auto: sev(HITS.auto), bolt: sev(HITS.bolt), QAttack: sev(HITS.QAttack), QOnslaught: sev(HITS.QOnslaught), RAttack: sev(HITS.RAttack) };
const SEV_R = { ...HITS.R }, SEV_MARK = { ...HITS.mark };
const SEVERUM = new Set<Hit>([...Object.values(SEV).flat(), SEV_R, SEV_MARK]);

export const APHELIOS: ChampionDef = {
  id: 'aphelios', name: t('champion.aphelios.name'), model: 'aphelios', icon: `${ICON}/champion/Aphelios.png`, scale: 1.45,
  title: t('champion.aphelios.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aphelios_0.jpg',
  roles: ['marksman'], difficulty: 10,
  // the skin bin's initialSubmeshToHide; which weapons show is the kit's (main and off-hand)
  hide: ['recall', 'flower', 'scarf_recall'],
  textures: { calibrum: 'aphelios_guns', crescendum: 'aphelios_guns', infernum: 'aphelios_guns', gravitum: 'aphelios_guns', severum: 'aphelios_guns' },
  base: {
    hp: 600, hpPerLevel: 102,
    hpRegen5: 3.25, hpRegen5PerLevel: 0.55,
    mana: 348, manaPerLevel: 42,
    manaRegen5: 6.5, manaRegen5PerLevel: 0.4,
    ad: 55, adPerLevel: 2.3,
    attackSpeed: 0.64, attackSpeedPerLevel: 0.021,
    attackRange: 550,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: 0.23 / 1.5,
    missileSpeed: 3000,
    radius: 65,
    armor: 26, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  // skill points buy stats: one stat reaches rank 6 at level 9 at the earliest (1/2/3/5/7/9); R ranks up on its own
  rankLevels: { Q: [1, 2, 3, 5, 7, 9], W: [1, 2, 3, 5, 7, 9], E: [1, 2, 3, 5, 7, 9] },
  autoRank: ['R'],
  // OP.GG 16.21: The Collector, Infinity Edge, Lord Dominik's; then Runaan's Hurricane, Guardian Angel, Bloodthirster
  build: ['6676', '3031', '3036', '3085', '3026', '3072'],
  passive: { name: t('champion.aphelios.passive'), icon: `${ICON}/passive/ApheliosP.png` },
  anims: { idle: clip('calibrum', 'idle1'), run: clip('calibrum', 'run1'), death: 'aphelios_death', attacks: [clip('calibrum', 'attack1'), clip('calibrum', 'attack2')], crit: clip('calibrum', 'attack2') },
  vfx: { auto: 'Aphelios_BA_calibrum_mis', crit: 'Aphelios_BA_calibrum_mis', autoHit: 'Aphelios_BA_calibrum_hit', critHit: 'Aphelios_BA_calibrum_hit' },
  animVfx: true, // muzzle flashes, Q casts, Phase swaps, R symbols and death ride the clips' own particle events
  kit: apheliosKit,
};

const name = (w: Weapon) => t(`champion.aphelios.weapon.${w}` as Key);
/** Weapon ability name: the main weapon's, with the off-hand's prefix (all Gravitum ones are Binding Eclipse). */
const qName = (main: Weapon, off: Weapon) => t((main === 'gravitum' ? 'champion.aphelios.Q.gravitum' : `champion.aphelios.Q.${main}.${off}`) as Key);

interface Mark { until: number; bonus: number; fx: THREE.Object3D | null }
interface Gravity { until: number; decayAt: number; enhanced: boolean; fx: THREE.Object3D | null }
/** A Crescendum blade on its way: the weapon itself, a chakram from the orbit (a basic attack) or a spectral one (an ability). */
type BladeKind = 'main' | 'orbit' | 'spectral';
interface Blade { fx: THREE.Object3D; wait: number; kind: BladeKind } // flying back to Aphelios
interface Flight { target: Enemy; kind: BladeKind; landed: boolean } // thrown by a basic attack, not landed yet
interface Sentry {
  actor: Actor; pos: THREE.Vector3; weapon: Weapon; armAt: number; until: number; active: boolean; next: number;
  fx: THREE.Object3D[]; dying: number; level: number;
}
interface Toss { fx: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; length: number; weapon: Weapon }
/** One attack from a weapon: who fires it and what it counts as. */
interface Shot {
  from: THREE.Vector3; hits: HitPair; sevHits: HitPair;
  flight?: Flight; // a basic attack of Crescendum: the weapon or an orbiting chakram, back in hand once caught
  mark?: boolean; // a long-range attack on a Calibrum mark: consumes every mark
  markBonus?: number; // a Calibrum ability shot marks with this bonus per mark (default the passive's)
  enhanced?: boolean; // Gravitum's Moonlight Vigil slow
  rRank?: number; // Infernum's Moonlight Vigil explosion
}

function apheliosKit(g: Game): ChampionKit {
  const B = APHELIOS.base;
  const near: Enemy[] = []; // own query arrays: hurtEnemy may run item effects that query too
  const near2: Enemy[] = [];
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  loadModel('apheliosturret', ['gravitum', 'infernum', 'severum'], 'apheliosturret').catch(() => {}); // the sentry, wanted from level 2

  let main: Weapon = 'calibrum', off: Weapon = 'severum';
  const reserve: Weapon[] = ['gravitum', 'infernum', 'crescendum'];
  const ammo: Record<Weapon, number> = { calibrum: PASSIVE.ammo, severum: PASSIVE.ammo, gravitum: PASSIVE.ammo, infernum: PASSIVE.ammo, crescendum: PASSIVE.ammo };
  const qCooldown: Record<Weapon, number> = { calibrum: 0, severum: 0, gravitum: 0, infernum: 0, crescendum: 0 }; // weapons not in the main hand
  let assembling = 0; // Alune assembling the next weapon: no Phase
  let attack: { weapon: Weapon; mark: boolean } = { weapon: main, mark: false }; // the basic attack in windup
  let attackSwing = 0, severumSwing = 0;
  let qWeapon: Weapon = main; // the Q being cast (chosen when the cast starts)
  let rWeapon: Weapon = main;

  const marks = new Map<Enemy, Mark>();
  const gravity = new Map<Enemy, Gravity>();
  let chakrams = 0, chakramUntil = 0;
  // Crescendum's basic attacks throw the weapon, then each orbiting chakram: no attacks only while all of them are out
  let mainOut = false, orbitOut = 0;
  const flights: Flight[] = [];
  const orbitFx: THREE.Object3D[] = []; // one per chakram in hand
  const timed: { o: THREE.Object3D; until: number }[] = []; // ground effects with a duration (roots)
  const blades: Blade[] = [];
  const tosses: Toss[] = [];
  const sentries: Sentry[] = [];
  let onslaught: { left: number; shots: number; next: number; interval: number; i: number; fx: THREE.Object3D[] } | null = null;
  const volleys: { at: number; targets: Enemy[]; weapon: Weapon; fx: THREE.Object3D[] }[] = [];
  const vigils: { at: number; targets: Enemy[]; weapon: Weapon; rank: number; fx: THREE.Object3D[] }[] = [];
  let spotlight: { fx: ParticleSystem | null; orb: MissileFx; pos: THREE.Vector3; dir: THREE.Vector3; left: number; weapon: Weapon; rank: number } | null = null;
  let glows: ParticleSystem[] = [];
  let rangeRing: THREE.Object3D | null = null;
  const MAX_MARK_FX = 30, MAX_TRACERS = 12; // particle budget: past these, the mechanics run without their own visuals
  let markFx = 0, gravityFx = 0;

  const level = () => g.level;
  const bonusAs = () => Math.max(0, g.attackSpeed / B.attackSpeed - 1);
  const critMult = () => B.critDamage + g.items.critDamage;
  const roll = () => Math.random() < g.critChance;
  const alive = (e: Enemy) => e.deadFor < 0;
  const edge = (e: Enemy, p: THREE.Vector3) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.def.radius;
  const severumHeal = () => PASSIVE.severumHeal[0] + ((PASSIVE.severumHeal[1] - PASSIVE.severumHeal[0]) * (Math.min(18, level()) - 1)) / 17;
  const shieldCap = () => PASSIVE.shieldBase + PASSIVE.shieldPerLevel * Math.max(0, level() - PASSIVE.shieldFrom + 1) + PASSIVE.shieldHp * g.maxHp;
  const markBonus = () => PASSIVE.markBase + PASSIVE.markBonusAd * g.bonusAd;
  const chakramBonus = () => {
    let b = 0;
    for (let i = 0; i < chakrams; i++) b += Math.max(PASSIVE.chakramMin, PASSIVE.chakramFirst - PASSIVE.chakramStep * i);
    return b;
  };
  const qCooldownOf = (w: Weapon) => step(level(), Q[w].cooldown[0], Q[w].cooldown[1]);
  const qDamage = (w: 'calibrum' | 'gravitum' | 'infernum' | 'crescendum') => {
    const q = Q[w];
    return step(level(), q.damage[0], q.damage[1]) + step(level(), q.bonusAd[0], q.bonusAd[1]) * g.bonusAd + q.ap * g.ap;
  };
  const attach = (key: string, at: THREE.Vector3) => {
    const o = g.vfx.attach(key);
    o.position.copy(at);
    g.scene.add(o);
    return o;
  };
  const drop = (o: THREE.Object3D | null | undefined) => o?.removeFromParent();

  // ---- weapons in hand ----
  const showWeapons = () => {
    for (const w of WEAPONS) g.player.showSubmesh(w, w === main || w === off);
    for (const s of glows) s.stop();
    glows = [];
    const glow = (key: string, w: Weapon) => {
      const bone = g.player.bone(BONE[w]);
      const sys = bone && g.vfx.play(key, bone.getWorldPosition(tmp), facingQuat(g.facing), { bone, owner: g.player.root, until: undefined });
      if (sys) glows.push(sys);
    };
    glow(`Aphelios_Weapon_${main}_Glow`, main);
    glow(`Aphelios_Weapon_${off}_Glow_BP`, off);
    drop(rangeRing);
    rangeRing = main === 'calibrum' ? attach('Aphelios_BA_calibrum_rangeIndicator', g.pos.clone().setY(0)) : null;
  };
  const swapFx = (w: Weapon) => {
    const bone = g.player.bone(BONE[w]);
    if (bone) g.vfx.playOn(`Aphelios_P_swap_gun_${w}`, bone, g.facing, g.player.root);
    g.vfx.playAt(`Aphelios_P_swap_avatar_${w}`, g.pos.clone().setY(0), g.facing, { owner: g.player.root });
  };
  /** Main and off-hand trade places; each keeps its own Q cooldown. */
  const setMain = (w: Weapon) => {
    qCooldown[main] = g.cooldowns.Q;
    main = w;
    g.cooldowns.Q = qCooldown[w];
    showWeapons();
  };
  const loseChakrams = () => {
    chakrams = 0;
    orbitOut = 0;
  };
  /** The main weapon ran dry: it goes to the end of the queue and Alune assembles the next one. */
  const exhaust = () => {
    const spent = main;
    const next = reserve.shift()!;
    reserve.push(spent);
    ammo[next] = PASSIVE.ammo;
    if (spent === 'crescendum') loseChakrams();
    setMain(next);
    g.cooldowns.Q = Math.max(g.cooldowns.Q, PASSIVE.assembleQCooldown);
    assembling = PASSIVE.assemble;
    swapFx(next);
    audio.play('aphelios_reload');
  };
  const spend = (n: number) => {
    const before = ammo[main];
    ammo[main] = Math.max(0, before - n);
    if (before > 10 && ammo[main] <= 10) audio.play('aphelios_ammo'); // Alune's low Moonlight warning
    if (ammo[main] <= 0) exhaust();
  };

  // ---- marks and debuffs ----
  const addMark = (e: Enemy, bonus: number) => {
    const m = marks.get(e);
    if (m) { m.until = g.time + PASSIVE.markDuration; m.bonus = Math.max(m.bonus, bonus); return; }
    const fx = markFx < MAX_MARK_FX ? (markFx++, attach('Aphelios_Q_calibrum_mark', e.pos)) : null;
    marks.set(e, { until: g.time + PASSIVE.markDuration, bonus, fx });
  };
  const endMark = (e: Enemy, m: Mark) => {
    if (m.fx) { markFx--; drop(m.fx); }
    marks.delete(e);
  };
  /** A long-range attack landed on a mark: every mark pops, the others through a chain from the target. */
  const consumeMarks = (target: Enemy, weapon: Weapon) => {
    const hitOf = weapon === 'severum' ? SEV_MARK : HITS.mark;
    let tracers = 0;
    for (const [e, m] of [...marks]) {
      endMark(e, m);
      if (!alive(e)) continue;
      g.vfx.hit('Aphelios_Q_calibrum_mark_outro', e.pos, 0, { size: boundSize(e) });
      if (e === target) {
        g.vfx.hit('Aphelios_Q_Calibrum_Chain_Hit', e.pos, 0, { size: boundSize(e) });
        g.hurtEnemy(e, m.bonus, hitOf);
      } else if (tracers++ < MAX_TRACERS) {
        const bonus = m.bonus;
        g.vfx.play(FX.chainBeam, target.pos.clone().setY(100), facingQuat(0), { target: e.pos.clone().setY(100) });
        g.spawnMissile(FX.chainMis, target.pos, e.pos, {
          speed: 2400, range: 4000, radius: 10, damage: bonus, target: e, hit: hitOf,
          onHit: (x) => {
            g.vfx.hit('Aphelios_Q_Calibrum_Chain_Hit', x.pos, 0, { size: boundSize(x) });
            audio.play('aphelios_mark_hit');
            g.hurtEnemy(x, bonus, hitOf);
          },
        });
      } else g.hurtEnemy(e, m.bonus, hitOf);
    }
    audio.play('aphelios_mark_hit');
  };
  const addGravity = (e: Enemy, enhanced: boolean) => {
    const was = gravity.get(e);
    g.slow(e, enhanced ? SKILLS.R.slow : PASSIVE.gravitumSlow, PASSIVE.gravitumDecayAt);
    const fx = was?.fx ?? (gravityFx < MAX_MARK_FX ? (gravityFx++, attach('Aphelios_BA_gravitum_debuff', e.pos)) : null);
    gravity.set(e, { until: g.time + PASSIVE.gravitumDuration, decayAt: g.time + PASSIVE.gravitumDecayAt, enhanced: enhanced || (was?.enhanced ?? false), fx });
  };
  const endGravity = (e: Enemy, x: Gravity) => {
    if (x.fx) { gravityFx--; drop(x.fx); }
    gravity.delete(e);
  };
  const addChakrams = (n: number) => {
    chakrams = Math.min(PASSIVE.chakramMax, chakrams + n);
    chakramUntil = g.time + PASSIVE.chakramDuration;
  };

  // ---- one attack of a weapon ----
  /** What the weapon does where it lands: damage plus its passive. */
  const land = (w: Weapon, e: Enemy, damage: number, crit: boolean, s: Shot, at: THREE.Vector3) => {
    if (!alive(e)) return;
    const hits = w === 'severum' ? s.sevHits : s.hits;
    const h = hits[crit ? 1 : 0];
    const size = { size: boundSize(e) };
    const facing = Math.atan2(e.pos.x - at.x, e.pos.z - at.z);
    if (s.mark && marks.has(e)) consumeMarks(e, w);
    switch (w) {
      case 'calibrum':
        g.vfx.hit('Aphelios_BA_calibrum_hit', e.pos, facing, size);
        audio.play(crit ? 'aphelios_crit_hit' : 'aphelios_calibrum_hit');
        g.hurtEnemy(e, damage, h);
        if (h.source === 'ability' && alive(e)) addMark(e, s.markBonus ?? markBonus()); // marks come from abilities only
        break;
      case 'severum':
        g.vfx.hit('Aphelios_BA_severum_hit_tar', e.pos, facing, size);
        audio.play(crit ? 'aphelios_crit_hit' : 'aphelios_severum_hit');
        g.hurtEnemy(e, damage, h);
        break;
      case 'gravitum':
        g.vfx.hit('Aphelios_BA_gravitum_hit', e.pos, facing, size);
        g.vfx.hit('Aphelios_BA_gravitum_hit_child', e.pos, facing, size);
        audio.play(crit ? 'aphelios_crit_hit' : 'aphelios_gravitum_hit');
        g.hurtEnemy(e, damage, h);
        if (alive(e)) addGravity(e, !!s.enhanced);
        break;
      case 'infernum': {
        g.vfx.hit('Aphelios_BA_Infernum_hit_tar', e.pos, facing, size);
        audio.play(crit ? 'aphelios_crit_hit' : 'aphelios_infernum_hit');
        const primary = damage * PASSIVE.infernumMult;
        const from = e.pos.clone();
        g.hurtEnemy(e, primary, h);
        splitBolts(from, facing, primary, crit, e, s);
        break;
      }
      case 'crescendum': {
        const kind: BladeKind = s.flight?.kind ?? 'spectral', big = kind === 'main';
        if (s.flight) s.flight.landed = true;
        g.vfx.hit(big ? 'Aphelios_BA_crescendum_hit_tar' : 'Aphelios_BA_crescendum_hit_tar_mini', e.pos, facing, size);
        audio.play(crit ? 'aphelios_crit_hit' : 'aphelios_crescendum_hit');
        g.hurtEnemy(e, damage * (1 + chakramBonus()), h);
        if (chakrams > 0) chakramUntil = g.time + PASSIVE.chakramDuration; // attacks refresh the chakrams
        returnBlade(kind, e.pos, PASSIVE.linger); // the returning blade itself waits on the target (no separate linger effect)
        break;
      }
    }
  };

  /** Infernum: the fire bolt splits into a cone behind the target (a circle for Moonlight Vigil), hitting each enemy once. */
  const splitBolts = (from: THREE.Vector3, facing: number, damage: number, crit: boolean, primary: Enemy, s: Shot) => {
    const vigil = s.rRank !== undefined;
    const n = vigil ? (crit ? SKILLS.R.infernumCritBolts : SKILLS.R.infernumBolts) : crit ? PASSIVE.infernumCritBolts : PASSIVE.infernumBolts;
    const cone = (crit ? 1.5 : 1) * PASSIVE.infernumCone;
    const range = vigil ? SKILLS.R.infernumRadius : PASSIVE.infernumRange;
    const share = (level() >= 9 ? PASSIVE.infernumSecondary[1] : PASSIVE.infernumSecondary[0]) * (vigil ? SKILLS.R.infernumPenalty : 1);
    const struck = new Set<Enemy>([primary]);
    const splash = vigil ? HITS.RSplash : HITS.splash;
    for (let i = 0; i < n; i++) {
      const a = vigil ? (i / n) * Math.PI * 2 : facing + (n > 1 ? -cone + (2 * cone * i) / (n - 1) : 0);
      const to = from.clone().add(dir.set(Math.sin(a), 0, Math.cos(a)));
      g.spawnMissile(FX.infernumSplit, from, to, {
        speed: 1500, range, radius: 20, damage: 0, hit: splash, pierce: true, height: 100,
        onHit: (e) => {
          if (struck.has(e)) return;
          struck.add(e);
          g.hurtEnemy(e, damage * share * (e.def.tier === 'minion' ? PASSIVE.infernumMinion : 1), splash);
        },
      });
    }
  };

  /** A weapon attack from `s.from` on `e`: its missile (Severum strikes at once), then `land`. */
  const fire = (w: Weapon, e: Enemy, damage: number, crit: boolean, s: Shot) => {
    switch (w) {
      case 'severum':
        // Severum strikes at once: its "missile" is a beam from the shooter to the target
        g.vfx.play(severumSwing++ % 2 ? 'Aphelios_BA_severum_mis2' : 'Aphelios_BA_severum_mis', s.from.clone().setY(0),
          facingQuat(Math.atan2(e.pos.x - s.from.x, e.pos.z - s.from.z)), { target: e.pos.clone().setY(0) });
        land(w, e, damage, crit, s, s.from);
        return;
      case 'crescendum':
        if (s.flight?.kind !== 'main') audio.play('aphelios_chakram_out'); // the weapon's throw sound plays with the attack
        g.spawnMissile(s.flight?.kind === 'main' ? 'Aphelios_BA_crescendum_mis' : 'Aphelios_BA_crescendum_mis_mini', s.from, e.pos, {
          speed: PASSIVE.crescendumSpeed, range: 4000, radius: 10, damage, target: e, hit: s.hits[0],
          onHit: (x, m) => land(w, x, damage, crit, s, m.pos),
        });
        return;
      default: {
        const speed = w === 'calibrum' ? (s.mark ? 3000 : B.missileSpeed) : w === 'gravitum' ? 1500 : 1700;
        g.spawnMissile(`Aphelios_BA_${w}_mis`, s.from, e.pos, {
          speed, range: 4000, radius: 10, damage, target: e, hit: s.hits[0], arc: w === 'gravitum' ? PASSIVE.gravitumArc : undefined, // a lobbed orb
          onHit: (x, m) => land(w, x, damage, crit, s, m.pos),
        });
      }
    }
  };
  const shotFrom = (from: THREE.Vector3, hits: HitPair, sevHits: HitPair, extra: Partial<Shot> = {}): Shot => ({ from, hits, sevHits, ...extra });

  // ---- skills ----
  const nearestTo = (p: THREE.Vector3, r: number) => g.nearestEnemy(p, r);
  const castOnslaught = () => {
    const q = Q.severum;
    const shots = Math.round(q.attacks * (1 + q.asCoeff * bonusAs()));
    onslaught = {
      left: q.duration, shots, next: 0, interval: q.duration / shots, i: 0,
      fx: [attach('Aphelios_Q_severum_buff', g.pos.clone().setY(0)), attach('Aphelios_Q_severum_indicator_ring', g.pos.clone().setY(0))],
    };
    g.vfx.playAt('Aphelios_Q_severum_cas', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
    g.cooldowns.Q += q.duration; // the cooldown starts when the onslaught ends
  };
  const onslaughtShot = () => {
    const o = onslaught!;
    const e = nearestTo(g.pos, Q.severum.radius);
    if (!e) return;
    const w: Weapon = o.i++ % 2 === 0 ? off : 'severum'; // starts with the off-hand
    const crit = roll();
    const damage = step(level(), Q.severum.adRatio[0], Q.severum.adRatio[1]) * g.ad * (crit ? critMult() : 1);
    g.vfx.hit('Aphelios_Q_severum_tar', e.pos, 0, { size: boundSize(e) });
    audio.play(`aphelios_${w}_line`);
    fire(w, e, damage, crit, shotFrom(g.pos.clone(), HITS.QOnslaught, SEV.QOnslaught));
  };
  const endOnslaught = () => {
    if (!onslaught) return;
    for (const o of onslaught.fx) drop(o);
    onslaught = null;
  };

  const castEclipse = () => {
    const q = Q.gravitum;
    const damage = qDamage('gravitum');
    audio.play('aphelios_gravitum_Q_beam');
    let tracers = 0;
    for (const [e, x] of [...gravity]) {
      endGravity(e, x);
      if (!alive(e)) continue;
      if (tracers++ < MAX_TRACERS) {
        // a dark beam from Gravitum to each slowed enemy (its end follows the enemy)
        const gun = g.player.bone('Gravitum_RingFront') ?? g.player.bone(BONE.gravitum);
        const from = gun ? gun.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(100);
        g.vfx.play('Aphelios_Q_gravitum_beam', from, facingQuat(g.facing), { target: e.pos, bone: gun, owner: g.player.root });
      }
      g.vfx.hit('Aphelios_Q_gravitum_root_activate', e.pos, 0, { size: boundSize(e) });
      const ground = gravityFx < MAX_MARK_FX ? attach('Aphelios_Q_gravitum_root_ground', e.pos.clone().setY(0)) : null;
      const root = x.enhanced ? SKILLS.R.root : q.root;
      if (ground) timed.push({ o: ground, until: g.time + root });
      g.rootEnemy(e, root);
      g.hurtEnemy(e, damage, HITS.QMagic);
    }
    audio.play('aphelios_gravitum_root');
  };

  const castDuskwave = (point: THREE.Vector3) => {
    const q = Q.infernum;
    const aim = dir.copy(point).sub(g.pos).setY(0);
    if (aim.lengthSq() < 1) aim.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    aim.normalize();
    const facing = Math.atan2(aim.x, aim.z);
    g.vfx.playAt('Aphelios_Q_infernum_cone', g.pos.clone().setY(0), facing);
    audio.play('aphelios_infernum_Q_burst');
    const damage = qDamage('infernum');
    const cos = Math.cos(q.cone);
    const targets: Enemy[] = [];
    const fx: THREE.Object3D[] = [];
    for (const e of g.enemiesNear(g.pos, q.range, near)) {
      if (!alive(e) || edge(e, g.pos) > q.range) continue;
      const dx = e.pos.x - g.pos.x, dz = e.pos.z - g.pos.z, d = Math.hypot(dx, dz);
      // the hitbox reaches a little behind Aphelios (his own radius)
      if (d > B.radius + e.def.radius && (dx * aim.x + dz * aim.z) / d < cos) continue;
      targets.push(e);
      if (fx.length < MAX_TRACERS) fx.push(attach(FX.infernumMark, e.pos));
    }
    for (const e of targets) g.hurtEnemy(e, damage, HITS.Q);
    volleys.push({ at: g.time + q.volleyDelay, targets, weapon: off, fx });
  };

  const castSentry = (point: THREE.Vector3) => {
    const q = Q.crescendum;
    const to = point.clone().setY(0);
    const off2 = tmp.copy(to).sub(g.pos).setY(0);
    if (off2.length() > q.range) to.copy(g.pos).addScaledVector(off2.normalize(), q.range).setY(0);
    const from = g.pos.clone().setY(100);
    const length = Math.max(0.05, from.distanceTo(to) / q.speed);
    tosses.push({ fx: attach('Aphelios_Q_crescendum_mis', from), from, to, t: 0, length, weapon: off });
    g.vfx.playAt('Aphelios_Q_crescendum_LandPositionIndicator', to, 0);
  };
  const deploy = (to: THREE.Vector3, weapon: Weapon) => {
    audio.play('aphelios_crescendum_Q_land');
    let actor: Actor;
    try { actor = new Actor('apheliosturret', Q.crescendum.scale); } catch { return; } // model still downloading
    for (const w of WEAPONS) actor.showSubmesh(w, w === weapon);
    actor.root.position.copy(to);
    actor.root.rotation.y = g.facing;
    actor.play('apheliosturret_spawn', { loop: false });
    g.scene.add(actor.root);
    const fx = [attach('Aphelios_Q_crescendum_turret_indicator_dormant', to.clone()), attach(`Aphelios_Weapon_${weapon}_Glow_Sentry`, to.clone().setY(110))];
    sentries.push({ actor, pos: to.clone(), weapon, armAt: g.time + Q.crescendum.arm, until: g.time + Q.crescendum.idle, active: false, next: 0, fx, dying: -1, level: level() });
  };
  const endSentry = (s: Sentry) => {
    for (const o of s.fx) drop(o);
    s.fx = [];
    s.dying = 0.6;
    s.actor.play('apheliosturret_death', { loop: false });
    audio.play('aphelios_sentry_end');
  };
  const updateSentry = (s: Sentry, dt: number) => {
    s.actor.update(dt);
    if (s.dying >= 0) return (s.dying -= dt) > 0 || (s.actor.dispose(), false);
    if (g.time >= s.until) { endSentry(s); return true; }
    if (g.time < s.armAt) return true;
    const range = Q.crescendum.attackRange;
    const e = g.nearestEnemy(s.pos, range);
    if (!s.active) {
      if (!e) return true;
      s.active = true;
      s.until = g.time + Q.crescendum.active;
      drop(s.fx[0]);
      s.fx[0] = attach('Aphelios_Q_crescendum_turret_indicator_Active', s.pos.clone());
      audio.play(`aphelios_sentry_${s.weapon}`);
    }
    if ((s.next -= dt) > 0 || !e) return true;
    s.next = 1 / g.attackSpeed; // the sentry uses Aphelios' attack speed and crit chance
    s.actor.root.rotation.y = Math.atan2(e.pos.x - s.pos.x, e.pos.z - s.pos.z);
    s.actor.play('apheliosturret_attack1', { loop: false, restart: true });
    const crit = roll();
    const q = Q.crescendum;
    const damage = (step(level(), q.damage[0], q.damage[1]) + step(level(), q.bonusAd[0], q.bonusAd[1]) * g.bonusAd + q.ap * g.ap) * (crit ? critMult() : 1);
    audio.play(`aphelios_${s.weapon}_line`);
    fire(s.weapon, e, damage, crit, shotFrom(s.pos.clone().setY(110), HITS.QAttack, SEV.QAttack));
    return true;
  };

  const castVigil = (rank: number, point: THREE.Vector3) => {
    const r = SKILLS.R;
    const d = dir.copy(point).sub(g.pos).setY(0);
    if (d.lengthSq() < 1) d.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    const pos = g.pos.clone().setY(100);
    const heading = d.clone().normalize();
    // ApheliosRMis: a ball of moonlight in the weapon's colours flies out; the moonbeam trails from the weapon in hand to it
    const orb = g.vfx.missile(`Aphelios_R_Mis_${rWeapon}`);
    orb.root.position.copy(pos);
    g.scene.add(orb.root);
    spotlight = { fx: beam(`Aphelios_R_moonbeam_${rWeapon}`, rWeapon, pos, missileQuat(heading)), orb, pos, dir: heading, left: r.range, weapon: rWeapon, rank };
    audio.play('aphelios_R_launch');
  };
  const beam = (key: string, w: Weapon, target: THREE.Vector3, targetQuat?: THREE.Quaternion) => {
    const gun = g.player.bone(BONE[w]);
    const from = gun ? gun.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(100);
    return g.vfx.play(key, from, facingQuat(g.facing), { target, targetQuat, bone: gun, owner: g.player.root, until: undefined });
  };
  /** Alune smites where the moonlight found an enemy, then each locked-on target takes an attack of the weapon. */
  const smite = (at: THREE.Vector3, w: Weapon, rank: number) => {
    const r = SKILLS.R;
    g.vfx.playAt('Aphelios_R_Explosion', at.clone().setY(0));
    g.vfx.playAt(`Aphelios_R_Explosion_${w}`, at.clone().setY(0));
    beam(`Aphelios_R_moonbeam_${w}_boom`, w, at.clone().setY(100));
    audio.play('aphelios_R_hit');
    const damage = r.damage[rank] + r.bonusAdRatio * g.bonusAd + r.apRatio * g.ap
      + (w === 'infernum' ? r.infernumBonus[rank] + r.infernumBonusAd * g.bonusAd : 0);
    const targets: Enemy[] = [];
    const fx: THREE.Object3D[] = [];
    for (const e of g.enemiesNear(at, r.radius, near)) {
      if (!alive(e) || edge(e, at) > r.radius) continue;
      targets.push(e);
      if (fx.length < MAX_TRACERS) fx.push(attach('Aphelios_R_mark', e.pos));
    }
    for (const e of targets) {
      g.vfx.hit(e === targets[0] ? 'Aphelios_R_hit_tar' : 'Aphelios_R_hit_tar_small', e.pos, 0, { size: boundSize(e) });
      g.hurtEnemy(e, damage, w === 'severum' ? SEV_R : HITS.R);
    }
    if (targets.length && w === 'severum') g.heal(r.heal[rank]);
    if (targets.length && w === 'crescendum') addChakrams(r.chakrams); // from the first enemy hit, on top of one per target
    vigils.push({ at: g.time + r.lockDelay, targets, weapon: w, rank, fx });
  };

  const inHand = () => (mainOut ? 0 : 1) + Math.max(0, chakrams - orbitOut);
  const returnBlade = (kind: BladeKind, from: THREE.Vector3, wait: number) => {
    const key = kind === 'main' ? 'Aphelios_BA_crescendum_mis_return' : 'Aphelios_BA_crescendum_mis_mini_return';
    blades.push({ fx: attach(key, from.clone().setY(100)), wait, kind });
  };
  /** The chakrams in hand circle Aphelios, one each. */
  const updateOrbit = () => {
    const n = main === 'crescendum' || chakrams > 0 ? Math.max(0, chakrams - orbitOut) : 0;
    while (orbitFx.length > n) drop(orbitFx.pop());
    while (orbitFx.length < n) orbitFx.push(attach('Aphelios_BA_crescendum_mis_mini_self', g.pos));
    for (let i = 0; i < n; i++) {
      const a = g.time * PASSIVE.orbitSpin + (i / n) * Math.PI * 2;
      orbitFx[i].position.set(g.pos.x + Math.sin(a) * PASSIVE.orbitRadius, PASSIVE.orbitHeight, g.pos.z + Math.cos(a) * PASSIVE.orbitRadius);
    }
  };

  // ---- HUD ----
  const view = {
    Q: () => ({ icon: `${HUD}/q_${main}.png`, name: qName(main, off), badge: String(ammo[main]) }),
    W: () => ({ icon: `${HUD}/${off}_m.png`, name: t('champion.aphelios.W.view', { weapon: name(off) }), badge: String(ammo[off]) }),
    E: () => ({ icon: `${HUD}/${reserve[0]}_l.png`, name: t('champion.aphelios.next', { weapon: name(reserve[0]) }) }),
  };

  showWeapons();

  return {
    stat(k) {
      if (k === 'ad') return PASSIVE.ad * g.ranks.Q;
      if (k === 'as') return PASSIVE.as * g.ranks.W;
      if (k === 'lethality') return PASSIVE.lethality * g.ranks.E;
      if (k === 'range') return main === 'calibrum' && !onslaught ? PASSIVE.calibrumRange : 0;
      return 0;
    },
    moveSpeedBonus: () => (onslaught ? Q.severum.ms + Q.severum.msPerAp * g.ap : 0),
    disarmed: () => onslaught !== null || (main === 'crescendum' && inHand() <= 0) || volleys.length > 0,
    canCast(key) {
      if (onslaught) return false; // no Phase nor Moonlight Vigil (nor another Q) during Onslaught
      if (key === 'W') return assembling <= 0;
      if (key === 'Q' && main === 'gravitum') return gravity.size > 0; // Binding Eclipse needs a Gravitum target
      return true;
    },
    cooldownBase: (key) => (key === 'Q' ? qCooldownOf(main) : undefined),
    castTime: (key) => (key === 'Q' ? Q[main].castTime : undefined),
    moveAnims: () => (onslaught ? { idle: 'aphelios_a_spell1_idle', run: 'aphelios_a_spell1_run' } : { idle: clip(main, 'idle1'), run: clip(main, 'run1') }),

    attackTarget(target) {
      if (marks.size === 0) return target;
      if (target && marks.has(target)) return target;
      let best: Enemy | null = null, bestD = PASSIVE.markRange;
      for (const e of marks.keys()) {
        const d = edge(e, g.pos);
        if (alive(e) && d <= bestD) { best = e; bestD = d; }
      }
      return best ?? target;
    },
    attackStart(target, crit) {
      const mark = marks.has(target);
      // a mark is shot with the off-hand weapon (the main one when Calibrum is the off-hand)
      const weapon = mark ? (off === 'calibrum' ? main : off) : main;
      attack = { weapon, mark };
      const swing = attackSwing++ % 2 === 0 ? 'attack1' : 'attack2';
      const anim = mark && main === 'calibrum' ? (swing === 'attack1' ? 'aphelios_b_spell1_attack' : 'aphelios_b_spell1_attack2') : clip(main, swing);
      return {
        anim, sound: mark ? 'aphelios_mark_attack' : `aphelios_${weapon}_auto`,
        windupPercent: weapon === 'crescendum' ? (crit ? PASSIVE.critWindup : PASSIVE.windup) : undefined,
      };
    },
    basicAttack(target, damage, crit, bolt) {
      if (bolt) {
        fire(main, target, damage, crit, shotFrom(g.pos.clone(), HITS.bolt, SEV.bolt));
        return true;
      }
      const w = attack.weapon;
      let flight: Flight | undefined;
      if (w === 'crescendum') {
        const kind: BladeKind = mainOut ? 'orbit' : 'main';
        if (kind === 'main') mainOut = true;
        else orbitOut++;
        flights.push(flight = { target, kind, landed: false });
      }
      fire(w, target, damage, crit, shotFrom(g.pos.clone(), HITS.auto, SEV.auto, { mark: attack.mark, flight }));
      spend(1);
      // like a machine gun: while a chakram still circles him, the next one goes at once (only its windup), no attack timer
      if (flight && main === 'crescendum' && inHand() > 0) g.resetAttack();
      return true;
    },
    onDealt(_e, h, dealt) {
      if (!SEVERUM.has(h) || dealt <= 0) return;
      const heal = dealt * severumHeal() * (h.source === 'ability' ? PASSIVE.severumAbility : 1);
      const over = Math.max(0, heal - (g.maxHp - g.hp));
      g.heal(heal);
      const room = shieldCap() - g.shield;
      if (over > 0 && room > 0) g.addShield(Math.min(over, room), PASSIVE.shieldDuration);
    },

    castAnim(key) {
      if (key === 'W') return clip(off, 'spell2');
      if (key !== 'Q') return undefined;
      qWeapon = main;
      if (main === 'severum') return 'aphelios_a_spell1_activate';
      if (main === 'infernum') return off === 'severum' || off === 'crescendum' ? 'aphelios_d_spell1a' : 'aphelios_d_spell1b';
      return clip(main, 'spell1');
    },
    castStart(key) {
      if (key === 'Q') {
        const w = qWeapon;
        audio.play(`aphelios_${w}_Q`);
        // Calibrum's and Gravitum's cast effects ride their clips; Duskwave's clip has a variant per off-hand weapon
        const hand = g.player.bone('R_Hand'), layout = g.player.bone('C_Buffbone_GLB_Layout_Loc');
        if (w === 'infernum' && hand && layout) {
          g.vfx.playOn('Aphelios_Q_infernum_cas', hand, g.facing, g.player.root);
          const [swap, swipe] = DUSK_SWAP[off];
          if (swap) g.vfx.playOn(swap, hand, g.facing, g.player.root);
          if (swipe) g.vfx.playOn(swipe, layout, g.facing, g.player.root);
        }
      } else if (key === 'R') {
        rWeapon = main;
        g.vfx.playAt('Aphelios_R_cas', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
        g.vfx.playAt(`Aphelios_R_cas_${main}`, g.pos.clone().setY(0), g.facing, { owner: g.player.root });
      } else if (key === 'W') {
        audio.play(`aphelios_W_${off}`);
      }
    },
    cast(key, rank, point) {
      if (key === 'W') {
        const was = main;
        setMain(off);
        off = was;
        showWeapons(); // the swap effects are the Phase clip's own events
        return;
      }
      if (key === 'E') {
        g.float(g.pos, t('champion.aphelios.next', { weapon: name(reserve[0]) }), 'xp');
        return;
      }
      if (key === 'R') {
        castVigil(rank, point);
        return;
      }
      const w = qWeapon;
      if (w === 'calibrum') {
        const q = Q.calibrum;
        const aim = point.clone().sub(g.pos).setY(0);
        if (aim.lengthSq() < 1) aim.set(Math.sin(g.facing), 0, Math.cos(g.facing));
        const damage = qDamage('calibrum');
        g.spawnMissile('Aphelios_Q_calibrum_mis', g.pos, g.pos.clone().add(aim), {
          speed: q.speed, range: q.range, radius: q.width / 2, damage, hit: HITS.Q,
          onHit: (e) => {
            g.vfx.hit('Aphelios_Q_calibrum_hit', e.pos, 0, { size: boundSize(e) });
            audio.play('aphelios_calibrum_Q_hit');
            g.hurtEnemy(e, damage, HITS.Q);
            if (alive(e)) addMark(e, markBonus());
          },
        });
      } else if (w === 'severum') castOnslaught();
      else if (w === 'gravitum') castEclipse();
      else if (w === 'infernum') castDuskwave(point);
      else castSentry(point);
      if (main === w) spend(Math.min(PASSIVE.qAmmo, ammo[main])); // with less than 10 Moonlight, a Q takes the rest
    },

    update(dt) {
      assembling -= dt;
      for (const w of WEAPONS) if (w !== main) qCooldown[w] = Math.max(0, qCooldown[w] - dt);
      rangeRing?.position.copy(g.pos).setY(0);
      if (chakrams > 0 && g.time >= chakramUntil) loseChakrams();
      updateOrbit();

      for (const [e, m] of marks) {
        if (!alive(e) || g.time >= m.until) endMark(e, m);
        else m.fx?.position.copy(e.pos).setY(e.def.radius + 120);
      }
      for (const [e, x] of gravity) {
        if (!alive(e) || g.time >= x.until) { endGravity(e, x); continue; }
        x.fx?.position.copy(e.pos).setY(60);
        if (x.decayAt > 0 && g.time >= x.decayAt) {
          x.decayAt = 0;
          g.slow(e, PASSIVE.gravitumDecayTo, x.until - g.time); // the slow decays after its first moments
        }
      }

      for (let i = blades.length - 1; i >= 0; i--) {
        const b = blades[i];
        if ((b.wait -= dt) > 0) continue;
        const to = tmp.copy(g.pos).setY(100).sub(b.fx.position);
        const d = to.length();
        const move = (PASSIVE.returnSpeed + PASSIVE.returnPerAs * bonusAs()) * dt;
        if (d > move + 40) { b.fx.position.addScaledVector(to.normalize(), move); continue; }
        drop(b.fx);
        blades.splice(i, 1);
        const waiting = main === 'crescendum' && inHand() <= 0;
        if (b.kind === 'main') mainOut = false;
        else if (b.kind === 'orbit') orbitOut = Math.max(0, orbitOut - 1);
        // only the spectral chakrams of abilities stack; the others come back into the orbit and refresh it
        if (b.kind === 'spectral') addChakrams(1);
        else if (chakrams > 0) chakramUntil = g.time + PASSIVE.chakramDuration;
        audio.play(b.kind === 'main' ? 'aphelios_crescendum_catch' : 'aphelios_chakram_catch');
        if (waiting) g.resetAttack(); // every blade was out: the attack timer resets on the catch
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        if (f.landed) flights.splice(i, 1);
        else if (!alive(f.target)) {
          // the target died with the blade on its way (the missile is gone): it comes back from there
          returnBlade(f.kind, f.target.pos, 0);
          flights.splice(i, 1);
        }
      }
      for (let i = timed.length - 1; i >= 0; i--) if (g.time >= timed[i].until) { drop(timed[i].o); timed.splice(i, 1); }

      for (let i = tosses.length - 1; i >= 0; i--) {
        const s = tosses[i];
        s.t += dt;
        const k = Math.min(1, s.t / s.length);
        s.fx.position.lerpVectors(s.from, s.to, k).setY(100 + Math.sin(k * Math.PI) * 120);
        if (k < 1) continue;
        drop(s.fx);
        tosses.splice(i, 1);
        deploy(s.to, s.weapon);
      }
      for (let i = sentries.length - 1; i >= 0; i--) if (!updateSentry(sentries[i], dt)) sentries.splice(i, 1);

      if (onslaught) {
        for (const o of onslaught.fx) o.position.copy(g.pos).setY(0);
        onslaught.left -= dt;
        while ((onslaught.next -= dt) <= 0 && onslaught.shots > 0) {
          onslaught.next += onslaught.interval;
          onslaught.shots--;
          onslaughtShot();
          if (!onslaught) break;
        }
        if (onslaught && (onslaught.left <= 0 || !g.alive)) endOnslaught();
      }

      for (let i = volleys.length - 1; i >= 0; i--) {
        const v = volleys[i];
        for (let j = 0; j < v.fx.length; j++) if (alive(v.targets[j])) v.fx[j].position.copy(v.targets[j].pos).setY(100);
        if (g.time < v.at) continue;
        for (const o of v.fx) drop(o);
        volleys.splice(i, 1);
        audio.play(`aphelios_${v.weapon}_line`);
        for (const e of v.targets) {
          if (!alive(e)) continue;
          const crit = roll();
          fire(v.weapon, e, g.ad * (crit ? critMult() : 1), crit, shotFrom(g.pos.clone(), HITS.QAttack, SEV.QAttack));
        }
      }

      if (spotlight) {
        const s = spotlight;
        const stepLen = SKILLS.R.speed * dt;
        s.pos.addScaledVector(s.dir, stepLen);
        s.left -= stepLen;
        s.orb.root.position.copy(s.pos);
        s.orb.update(dt, s.dir, SKILLS.R.range - s.left);
        let found: Enemy | null = null;
        for (const e of g.enemiesNear(s.pos, SKILLS.R.width / 2, near2)) {
          if (alive(e) && edge(e, s.pos) <= SKILLS.R.width / 2) { found = e; break; }
        }
        if (found || s.left <= 0) {
          s.fx?.kill();
          s.orb.root.removeFromParent();
          spotlight = null;
          if (found) smite(found.pos.clone(), s.weapon, s.rank);
          else g.vfx.playAt('Aphelios_R_Fizzle', s.pos.clone().setY(0));
        }
      }
      for (let i = vigils.length - 1; i >= 0; i--) {
        const v = vigils[i];
        for (let j = 0; j < v.fx.length; j++) if (alive(v.targets[j])) v.fx[j].position.copy(v.targets[j].pos).setY(100);
        if (g.time < v.at) continue;
        for (const o of v.fx) drop(o);
        vigils.splice(i, 1);
        const r = SKILLS.R;
        for (const e of v.targets) {
          if (!alive(e)) continue;
          const crit = roll();
          const damage = g.ad * (crit ? r.critBase + g.items.critDamage : 1);
          fire(v.weapon, e, damage, crit, shotFrom(g.pos.clone(), HITS.RAttack, SEV.RAttack, {
            markBonus: r.markBonus[v.rank], enhanced: v.weapon === 'gravitum', rRank: v.weapon === 'infernum' ? v.rank : undefined,
          }));
        }
      }
    },

    dispose() {
      for (const [e, m] of [...marks]) endMark(e, m);
      for (const [e, x] of [...gravity]) endGravity(e, x);
      for (const b of blades) drop(b.fx);
      for (const s of tosses) drop(s.fx);
      for (const s of sentries) { for (const o of s.fx) drop(o); s.actor.dispose(); }
      for (const x of timed) drop(x.o);
      for (const v of volleys) for (const o of v.fx) drop(o);
      for (const v of vigils) for (const o of v.fx) drop(o);
      endOnslaught();
      loseChakrams();
      for (const o of orbitFx) drop(o);
      spotlight?.fx?.kill();
      spotlight?.orb.root.removeFromParent();
      drop(rangeRing);
      for (const s of glows) s.stop();
    },

    hud: () => (chakrams > 0
      ? t('champion.aphelios.hud.chakrams', { n: Math.max(0, chakrams - orbitOut) }) // in orbit: thrown ones count again when caught
      : marks.size > 0 ? t('champion.aphelios.hud.marks', { n: marks.size }) : ''),
    gauge: () => ({ label: String(ammo[main]), fill: ammo[main] / PASSIVE.ammo, ready: false, icon: `${HUD}/${main}_m.png` }),
    skillView: (key) => (key === 'R' ? undefined : view[key]()),
    tray: () => reserve.map((w, i) => ({ icon: `${HUD}/${w}_u.png`, title: i === 0 ? t('champion.aphelios.next', { weapon: name(w) }) : name(w) })),
  };
}
