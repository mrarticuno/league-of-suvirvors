// Udyr. Numbers mirror League of Legends: the client's spell data (DataValues and spell calculations of
// data/characters/udyr/udyr.bin, patch 26.21), Meraki Analytics for base stats and timings.
// Four stances instead of an ultimate (Bridge Between): each cast enters a stance, empowers the next two basic attacks
// and puts the other stances on a 1.5 s global cooldown. Awakened Spirit (50/40/30/20 s by level, with haste) lets the
// stance be recast once within 5 s to Awaken it. Monk Training: the two attacks after a cast get 30% attack speed and
// refund 5% of Awakened Spirit. The LoL model has no stance-less clips: Udyr animates as Mantle (spell2_*) until his
// first stance, like the client's Idle1/Attack1 bindings.
// Adapted for hordes: attack range 250 (League: 125, like every melee champion here); "champions" are elite and epic
// monsters; mana costs lowered like the mages' (Q 15, W/E/R 28–18; LoL 20 and 40–23) and kills by stance effects
// (empowered attacks, lightning, the storm) restore 10–30 mana, once per second against minions.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat, type ParticleSystem } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
type Stance = SkillKey;
const STANCES: readonly Stance[] = ['Q', 'W', 'E', 'R'];

// systems the skin's ResourceResolver only names by hash (tools/build_vfx.py keys them as 0x...). The resolver's
// names come from the old kit (Tiger/Turtle/Bear/Phoenix); the particle names say which stance they belong to
const FX = {
  cast: { Q: 'Udyr_TigerStance', W: 'Udyr_TurtleStance', E: 'Udyr_BearStance', R: 'Udyr_PhoenixStance' },
  awaken: { Q: 'Udyr_Passive_Awaken_Cast01', W: 'Udyr_Passive_Awaken_Cast02', E: 'Udyr_Passive_Awaken_Cast03', R: 'Udyr_Passive_Awaken_Cast04' },
  ready: { Q: 'Udyr_Passive_Attack_Ready_Cast01', W: 'Udyr_Passive_Attack_Ready_Cast02', E: 'Udyr_Passive_Attack_Ready_Cast03', R: 'Udyr_Passive_Attack_Ready_Cast04' },
  hit: { Q: 'Udyr_BA_Tar_Q', W: 'Udyr_BA_Tar_W', E: 'Udyr_BA_Tar_E', R: 'Udyr_BA_Tar_R' },
  empHit: { Q: ['Udyr_Q_Tar_L', 'Udyr_Q_Tar_R'], W: ['Udyr_W_Tar_L', 'Udyr_W_Tar_R'], E: ['0x02c30c57', '0x02c30c57'], R: ['Udyr_R_Tar_L', 'Udyr_R_Tar_R'] },
  baseHit: 'Udyr_BA_tar_03',
  qScalingTar: '0xb5acf852', qBounce: '0x83def8d6', qBeam: 'Udyr_Q_chainLightning_01', qFlash: 'Udyr_Q_Lightning_hitFlash_01',
  wShield: 'Udyr_TurtleStance_buf', wAwakenShield: '0x774df3c6', wAwakenHeal: '0x7b26e29d',
  eSpeed: 'Udyr_PrimalCharge', eTimer: 'Udyr_E_Timer',
  rBlizzard: '0x21f4f5a8', rStorm: '0x2d336aac', rStormTarget: '0xdcb71de1', rTick: '0x48c05388', rSplash: '0x23f1a639', rLinger: 'Udyr_R_Hit_Linger',
};
// stance idle systems and the bones they ride (the R buff's PersistentVfxs names Layout_Loc; the others follow the
// _SnapJoint suffix). Mantle's Udyr_Idle_W_IdleVFX001 is only a chromatic aberration post effect: left out.
const IDLE: Record<Stance, readonly (readonly [string, string])[]> = {
  Q: [['Udyr_Idle_Q_IdleVFX01_ClawTips', 'R_BearHand'], ['Udyr_Idle_Q_IdleVFX01_ClawTips', 'L_BearHand'], ['0x0499ab85', 'R_SnapJoint'], ['0x1699c7db', 'L_SnapJoint']],
  W: [],
  E: [['Udyr_Idle_E_IdleVFX01_SnapJoint', 'R_SnapJoint'], ['Udyr_Idle_E_IdleVFX01_SnapJoint', 'L_SnapJoint']],
  R: [['Udyr_Idle_R_IdleVFX01', 'C_Buffbone_Glb_Layout_Loc'], ['Udyr_Idle_R_IdleVFX01_SnapJoint', 'R_SnapJoint'], ['Udyr_Idle_R_IdleVFX01_SnapJoint02', 'L_SnapJoint']],
};
// the model's arms per stance (the skin bin's Gear data: Spell1 shows BearArms, Spell2 BoarArms, Spell3 RamArms and
// RamHorns, Spell4 PhoenixArms, the stance-less gear Arms)
const ARMS: Record<Stance, readonly string[]> = { Q: ['BearArms'], W: ['BoarArms'], E: ['RamArms', 'RamHorns'], R: ['PhoenixArms'] };
const ALL_ARMS = ['Arms', 'BearArms', 'BoarArms', 'RamArms', 'RamHorns', 'PhoenixArms'];
// clips per stance, written out because tools/optimize.mjs keeps only the clips named literally in the bundle. An
// attack is the windup clip then its _to_idle follow-through (the animation graph's Attack -> Attack_To_Idle), whose
// particle events (events.json) are the swipe and claw ribbons of the hit. Walking, the follow-through is the _to_run clip
// (the graph's Attack -> Attack_To_Run), which fires the _to_idle clip's events: the bin puts them on _to_idle only.
// `windup`: the attack's castFrame (spell data, 30 fps): the hit lands as the windup clip ends
interface Clips {
  idle: string; run: string; runFast: string; cast: string;
  attacks: readonly string[]; follow: readonly string[]; followRun: readonly string[];
  emp: readonly string[]; empFollow: readonly string[]; empFollowRun: readonly string[]; empWindup: number;
}
const CLIPS: Record<Stance, Clips> = {
  Q: {
    idle: 'spell1_idle', run: 'spell1_run', runFast: 'spell1_run_fast', cast: 'spell1_activate',
    attacks: ['spell1_attack1', 'spell1_attack2'], follow: ['spell1_attack1_to_idle', 'spell1_attack2_to_idle'], followRun: ['spell1_attack1_to_run', 'spell1_attack2_to_run'],
    emp: ['spell1_attack1', 'spell1_attack2'], empFollow: ['spell1_attack1_to_idle', 'spell1_attack2_to_idle'], empFollowRun: ['spell1_attack1_to_run', 'spell1_attack2_to_run'], empWindup: 12,
  },
  W: {
    idle: 'spell2_idle', run: 'spell2_run', runFast: 'spell2_run_fast', cast: 'spell2_activation',
    attacks: ['spell2_attack'], follow: ['spell2_attack_to_idle'], followRun: ['spell2_attack_to_run'],
    emp: ['spell2_enhancedattack1', 'spell2_enhancedattack2'], empFollow: ['spell2_enhancedattack1_to_idle', 'spell2_enhancedattack2_to_idle'], empFollowRun: ['spell2_attack1_to_run', 'spell2_attack2_to_run'], empWindup: 16,
  },
  E: {
    idle: 'spell3_idle', run: 'spell3_run', runFast: 'spell3_run', cast: 'spell3',
    attacks: ['spell3_attack1', 'spell3_attack2'], follow: ['spell3_attack1_to_idle', 'spell3_attack2_to_idle'], followRun: ['spell3_attack1_to_run', 'spell3_attack2_to_run'],
    emp: ['spell3_enhanced_attack'], empFollow: ['spell3_enhanced_attack_to_idle'], empFollowRun: ['spell3_enhanced_attack_to_run'], empWindup: 14,
  },
  R: {
    idle: 'spell4_idle', run: 'spell4_run', runFast: 'spell4_run_fast', cast: 'spell4',
    attacks: ['spell4_attack1', 'spell4_attack2'], follow: ['spell4_attack1_to_idle', 'spell4_attack2_to_idle'], followRun: ['spell4_attack1_to_run', 'spell4_attack2_to_run'],
    emp: ['spell4_attack1', 'spell4_attack2'], empFollow: ['spell4_attack1_to_idle', 'spell4_attack2_to_idle'], empFollowRun: ['spell4_attack1_to_run', 'spell4_attack2_to_run'], empWindup: 12,
  },
};

const PASSIVE = {
  empowered: 2, globalCd: 1.5, globalCdAwakened: 0.5, awakenMin: 0.25, awakenWindow: 5, awakenRecast: 0.25,
  awakenCd: [50, 40, 30, 20], awakenCdLevels: [1, 6, 11, 16], monkAs: 0.3, monkDuration: 4, monkRefund: 0.05, monkRefundMin: 1,
  hairUp: 4, // the Awaken cast raises the hair (HairUp) for the awakened buff
  // mana on kills (adapted): by stance effects, once per second against minions
  mana: [10, 30], manaCooldown: 1,
};

const Q = {
  cooldown: 6, duration: 4, range: 50, as: [0.2, 0.32, 0.44, 0.56, 0.68, 0.8],
  maxHp: [0.03, 0.04, 0.05, 0.06, 0.07, 0.08], maxHpPerBonusAd: 0.00035, // empowered attacks
  onHit: [6, 12, 18, 24, 30, 36], onHitBonusAd: 0.2, onHitBonusHp: [0.008, 0.01, 0.012, 0.014, 0.016, 0.018], // every attack for 4 s
  awakenAs: [0.2, 0.7], awakenMaxHp: [0.02, 0.04], awakenMaxHpPerBonusAd: 0.0005,
  lightning: { attacks: 2, duration: 4, bounces: 6, interval: 0.2, range: 450, targets: 3, pct: [0.015, 0.03], pctPerAp: 0.00006, minionMin: [40, 160], monsterCap: 15, monsterCapBonusAd: 1, monsterCapAp: 0.5 },
};
const W = {
  cooldown: 6, duration: 4, lifesteal: [0.15, 0.16, 0.17, 0.18, 0.19, 0.2], healHp: 0.012, healAp: 0.08, minionHeal: 0.6,
  shield: [45, 65, 85, 105, 125, 145], shieldHp: [0.02, 0.023, 0.026, 0.029, 0.032, 0.035], shieldAp: 0.4, shieldBonusAd: 0.5,
  awaken: { shield: [20, 150], ap: 0.65, hp: 0.08, bonusAd: 1, healShare: 0.5, healTicks: 16, healInterval: 0.25, mult: 2 },
};
const E = {
  cooldown: 6, duration: 4, ms: [0.25, 0.31, 0.37, 0.43, 0.49, 0.55], msPerBonusAd: 0.0005, decayTo: 0.3, decayOver: 1.5,
  stun: 0.75, stunCd: [6, 5.6, 5.2, 4.8, 4.4, 4], pounce: 1200, pounceMin: 40,
  awaken: { range: 75, ms: [0.3, 0.4], msPerBonusAd: 0.001, unstoppable: 1.5 },
};
const R = {
  cooldown: 6, duration: 4, radius: 370, interval: 0.5, damage: [20, 36, 52, 68, 84, 100], ap: 0.35, slow: [0.15, 0.18, 0.21, 0.24, 0.27, 0.3], slowDuration: 2,
  minionMult: [0.5, 0.6, 0.7, 0.8], minionLevels: [1, 6, 11, 16], pulse: [10, 40], pulseAp: 0.35, pulseRadius: 300,
  awaken: { maxHp: [0.08, 0.14], maxHpPerAp: 0.00035, monsterCap: [10, 50], slow: 0.05, speed: [109.5, 250], follow: 1200 },
  maxTickFx: 30,
};

const SKILLS = {
  Q: {
    name: t('champion.udyr.Q'), desc: t('champion.udyr.Q.desc'), damageType: 'physical', maxRank: 6, anim: CLIPS.Q.cast, icon: `${ICON}/spell/UdyrQ.png`,
    cooldown: [6, 6, 6, 6, 6, 6], cost: [15, 15, 15, 15, 15, 15], damage: Q.onHit, bonusAdRatio: Q.onHitBonusAd,
    extra: { label: t('skillsel.bonusAs'), values: Q.as, percent: true }, castTime: 0.05, aim: 'none',
  },
  W: {
    name: t('champion.udyr.W'), desc: t('champion.udyr.W.desc'), damageType: 'magic', maxRank: 6, anim: CLIPS.W.cast, icon: `${ICON}/spell/UdyrW.png`,
    cooldown: [6, 6, 6, 6, 6, 6], cost: [28, 26, 24, 22, 20, 18], damage: [0, 0, 0, 0, 0, 0],
    extra: { label: t('champion.udyr.shield'), values: W.shield }, castTime: 0.05, aim: 'none',
  },
  E: {
    name: t('champion.udyr.E'), desc: t('champion.udyr.E.desc'), damageType: 'physical', maxRank: 6, anim: CLIPS.E.cast, icon: `${ICON}/spell/UdyrE.png`,
    cooldown: [6, 6, 6, 6, 6, 6], cost: [28, 26, 24, 22, 20, 18], damage: [0, 0, 0, 0, 0, 0],
    extra: { label: t('stat.ms'), values: E.ms, percent: true }, castTime: 0.05, aim: 'none',
  },
  R: {
    name: t('champion.udyr.R'), desc: t('champion.udyr.R.desc'), damageType: 'magic', maxRank: 6, anim: CLIPS.R.cast, icon: `${ICON}/spell/UdyrR.png`,
    cooldown: [6, 6, 6, 6, 6, 6], cost: [28, 26, 24, 22, 20, 18], damage: R.damage.map((d) => d / 2), apRatio: R.ap / 2, hits: 8,
    extra: { label: t('champion.udyr.slow'), values: R.slow, percent: true }, castTime: 0.1, aim: 'none',
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const hit = (h: Hit) => ({ ...h, crit: false }) as Hit;
const critOf = (h: Hit) => ({ ...h, crit: true }) as Hit;
const pair = (h: Hit) => [hit(h), critOf(h)] as const;
const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
const HITS = {
  auto: pair(AUTO),
  // empowered attacks per stance (the same basic attack: on-hit, crit); the kit's heal and mana on kills recognise them
  emp: { Q: pair(AUTO), W: pair(AUTO), E: pair(AUTO), R: pair(AUTO) } as Record<Stance, readonly [Hit, Hit]>,
  lightning: { type: 'magic', source: 'ability', skill: 'Q' } as Hit,
  storm: { type: 'magic', source: 'ability', skill: 'R' } as Hit,
  pulse: { type: 'magic', source: 'ability', skill: 'R' } as Hit,
};
const EMPOWERED = new Set<Hit>(Object.values(HITS.emp).flat());

export const UDYR: ChampionDef = {
  id: 'udyr', name: t('champion.udyr.name'), model: 'udyr', icon: `${ICON}/champion/Udyr.png`,
  title: t('champion.udyr.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Udyr_0.jpg',
  roles: ['fighter', 'tank'], difficulty: 7,
  // the skin bin's initialSubmeshToHide: the stance arms (the kit shows the current stance's) and the awakened hair
  hide: ['HairUp', 'BearArms', 'PhoenixArms', 'RamArms', 'RamHorns', 'BoarArms'],
  textures: { BearArms: 'udyr_arms', BoarArms: 'udyr_arms', RamArms: 'udyr_arms', RamHorns: 'udyr_arms', PhoenixArms: 'udyr_arms' },
  base: {
    hp: 664, hpPerLevel: 92,
    hpRegen5: 6, hpRegen5PerLevel: 0.75,
    mana: 271, manaPerLevel: 50,
    manaRegen5: 7.5, manaRegen5PerLevel: 0.45,
    ad: 62, adPerLevel: 4,
    attackSpeed: 0.65, attackSpeedPerLevel: 0.03,
    attackRange: 250, // League: 125
    moveSpeed: 350,
    critDamage: 1.75,
    windupPercent: (12 / 30) * 0.65, // UdyrBasicAttack castFrame 12 at 30 fps, at the base attack speed
    missileSpeed: 467, // melee: the hit lands at the end of the windup (the kit's basicAttack)
    radius: 65,
    armor: 31, armorPerLevel: 4.7,
  },
  skills: SKILLS,
  // four basic abilities with six ranks: one rank every other level, no ultimate
  rankLevels: { Q: [1, 3, 5, 7, 9, 11], W: [1, 3, 5, 7, 9, 11], E: [1, 3, 5, 7, 9, 11], R: [1, 3, 5, 7, 9, 11] },
  // OP.GG 16.21: Trinity Force, Spear of Shojin, Sterak's Gage; then Dead Man's Plate, Force of Nature, Spirit Visage
  build: ['3078', '3161', '3053', '3742', '4401', '3065'],
  passive: { name: t('champion.udyr.passive'), icon: `${ICON}/passive/Udyr_P.png` },
  // stance-less Udyr animates as Mantle (the graph binds Idle1/Run1/Attack1 to the spell2 clips)
  anims: { idle: CLIPS.W.idle, run: CLIPS.W.run, death: 'death', attacks: CLIPS.W.attacks, crit: CLIPS.W.attacks[0] },
  vfx: { auto: FX.baseHit, crit: FX.baseHit, autoHit: FX.baseHit, critHit: FX.baseHit },
  animVfx: true, // swipes and claw ribbons ride the attack follow-through clips, the death spirits the death clip
  kit: udyrKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;
const byLevel = (level: number, values: readonly number[], levels: readonly number[]) => {
  let i = 0;
  while (i + 1 < levels.length && level >= levels[i + 1]) i++;
  return values[i];
};
const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

interface Chain { from: Enemy; left: number; next: number; pct: number }
interface Storm { obj: THREE.Object3D; pos: THREE.Vector3; ticks: number; next: number; rank: number; awakened: boolean; target: Enemy | null; indicator: THREE.Object3D | null }

function udyrKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query arrays: hurtEnemy may run item effects that query too
  const near2: Enemy[] = [];
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

  let stance: Stance | null = null;
  let empowered = 0; // empowered attacks left in the current stance
  let empoweredAwakened = false; // they come from an Awakened cast (Claw: extra max Health damage; Mantle: doubled healing)
  let readyFx: ParticleSystem[] = [], idleFx: ParticleSystem[] = [];
  let awakenAt = g.time + byLevel(g.level, PASSIVE.awakenCd, PASSIVE.awakenCdLevels) * (100 / (100 + g.abilityHaste)); // Awakened Spirit ready at this time (on full cooldown from the start, as in League)
  let awakenWindow: { stance: Stance; from: number; until: number } | null = null;
  let hairUntil = 0;
  let monk = 0, monkUntil = 0; // Monk Training attacks left
  let attackIndex = 0;
  let pending: { stance: Stance | null; empowered: boolean; follow: string; followRun: string; sound: string } = { stance: null, empowered: false, follow: CLIPS.W.follow[0], followRun: CLIPS.W.followRun[0], sound: 'udyr_auto_hit' };
  let manaAt = 0;

  // Wilding Claw
  let clawUntil = 0, clawRank = 0, clawAwakened = false;
  let lightning = 0, lightningUntil = 0;
  const chains: Chain[] = [];
  // Iron Mantle
  let mantleRank = 0;
  let mantleHeal: { ticks: number; next: number; amount: number } | null = null;
  // Blazing Stampede
  let stampedeUntil = 0, stampedeStart = 0, stampedeRank = 0, stampedeAwakened = false, unstoppableUntil = 0;
  let speedFx: THREE.Object3D | null = null;
  const stunReady = new Map<Enemy, { at: number; fx: THREE.Object3D | null }>();
  // Wingborne Storm
  let storm: Storm | null = null;

  const big = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';
  const awakenReady = () => g.time >= awakenAt;
  const awakenCooldown = () => byLevel(g.level, PASSIVE.awakenCd, PASSIVE.awakenCdLevels) * (100 / (100 + g.abilityHaste));
  const rankOf = (k: Stance) => Math.max(0, g.ranks[k] - 1);
  const boneFx = (key: string, bone: string, loop: boolean) => {
    const b = g.player.bone(bone);
    if (!b) return null;
    return g.vfx.play(key, b.getWorldPosition(tmp), facingQuat(g.facing), { bone: b, owner: g.player.root, ...(loop && { until: undefined }) });
  };
  const follow = (key: string, at: THREE.Vector3) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(0);
    g.scene.add(o);
    return o;
  };
  const timed: { o: THREE.Object3D; until: number }[] = []; // systems riding Udyr for a while (the Mantle shields)
  const onUdyr = (key: string, seconds: number) => timed.push({ o: follow(key, g.pos), until: g.time + seconds });
  const stopAll = (list: ParticleSystem[]) => { for (const s of list) s.stop(); list.length = 0; };
  const endReady = () => stopAll(readyFx);
  const setArms = (s: Stance | null) => {
    for (const a of ALL_ARMS) g.player.showSubmesh(a, false);
    for (const a of s ? ARMS[s] : ['Arms']) g.player.showSubmesh(a, true);
  };
  const setHair = (up: boolean) => { g.player.showSubmesh('HairUp', up); g.player.showSubmesh('NormalHair', !up); };
  const endStorm = () => {
    if (!storm) return;
    storm.obj.removeFromParent();
    storm.indicator?.removeFromParent();
    storm = null;
  };
  const endSpeed = () => { speedFx?.removeFromParent(); speedFx = null; };
  const manaOnKill = (e: Enemy) => {
    if (!big(e)) {
      if (g.time < manaAt) return;
      manaAt = g.time + PASSIVE.manaCooldown;
    }
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.mana));
  };

  /** Entering a stance: the arms, idle systems, the empowered attacks and Monk Training. */
  const enter = (s: Stance, r: number) => {
    stopAll(idleFx);
    endReady();
    stance = s;
    empowered = PASSIVE.empowered;
    empoweredAwakened = false;
    monk = PASSIVE.empowered;
    monkUntil = g.time + PASSIVE.monkDuration;
    setArms(s);
    idleFx = IDLE[s].flatMap(([key, bone]) => boneFx(key, bone, true) ?? []);
    readyFx = [boneFx(FX.ready[s], 'R_SnapJoint', true), boneFx(FX.ready[s], 'L_SnapJoint', true)].flatMap((x) => x ?? []);
    audio.play('udyr_P_ready');
    g.vfx.playAt(FX.cast[s], g.pos.clone().setY(0), g.facing);
    for (const k of STANCES) if (k !== s) g.cooldowns[k] = Math.max(g.cooldowns[k], PASSIVE.globalCd);
    awakenWindow = awakenReady() ? { stance: s, from: g.time + PASSIVE.awakenMin, until: g.time + PASSIVE.awakenWindow } : null;
    if (s === 'Q') {
      clawUntil = g.time + Q.duration;
      clawRank = r;
      clawAwakened = false;
    } else if (s === 'W') {
      mantleRank = r;
      g.addShield(W.shield[r] + W.shieldHp[r] * g.maxHp + W.shieldAp * g.ap + W.shieldBonusAd * g.bonusAd, W.duration);
      onUdyr(FX.wShield, W.duration);
    } else if (s === 'E') {
      stampedeUntil = g.time + E.duration;
      stampedeStart = g.time;
      stampedeRank = r;
      stampedeAwakened = false;
      endSpeed();
      speedFx = follow(FX.eSpeed, g.pos);
      audio.play('udyr_E_buff');
    } else {
      endStorm();
      storm = { obj: follow(FX.rBlizzard, g.pos), pos: g.pos.clone(), ticks: R.duration / R.interval, next: g.time + R.interval, rank: r, awakened: false, target: null, indicator: null };
      audio.play('udyr_R_storm');
    }
  };

  /** The Awaken recast: the stance's extra effect, Awakened Spirit on cooldown, the other stances on a shorter global cooldown. */
  const awaken = (s: Stance) => {
    awakenWindow = null;
    awakenAt = g.time + awakenCooldown();
    hairUntil = g.time + PASSIVE.hairUp;
    setHair(true);
    g.gesture(CLIPS[s].cast);
    g.vfx.playAt(FX.awaken[s], g.pos.clone().setY(0), g.facing, { owner: g.player.root });
    audio.play(`udyr_${s}_awaken`);
    for (const k of STANCES) if (k !== s) g.cooldowns[k] = Math.max(g.cooldowns[k], PASSIVE.globalCdAwakened);
    empoweredAwakened = empowered > 0;
    const r = rankOf(s);
    if (s === 'Q') {
      clawAwakened = true;
      lightning = Q.lightning.attacks;
      lightningUntil = g.time + Q.lightning.duration;
      audio.play('udyr_Q_buff');
    } else if (s === 'W') {
      const shield = lerpLevel(g.level, W.awaken.shield) + W.shield[r] + W.awaken.ap * g.ap + W.awaken.hp * g.maxHp + W.awaken.bonusAd * g.bonusAd;
      g.addShield(shield, W.duration);
      mantleHeal = { ticks: W.awaken.healTicks, next: g.time + W.awaken.healInterval, amount: (shield * W.awaken.healShare) / W.awaken.healTicks };
      onUdyr(FX.wAwakenShield, W.duration);
    } else if (s === 'E') {
      stampedeAwakened = true;
      unstoppableUntil = g.time + E.awaken.unstoppable;
    } else if (storm) {
      // the blizzard ends and a glacial storm that hunts the nearest enemy takes its place
      const { pos, rank } = storm;
      endStorm();
      storm = { obj: follow(FX.rStorm, pos), pos: pos.clone(), ticks: R.duration / R.interval, next: g.time + R.interval, rank, awakened: true, target: null, indicator: null };
      audio.play('udyr_R_storm_awaken');
    }
  };

  /** One strike of the Awakened Claw lightning on `e`: a share of its max Health, floored against minions, capped against monsters. */
  const strike = (e: Enemy, pct: number) => {
    let dmg = pct * e.maxHp;
    if (e.def.tier === 'minion') dmg = Math.max(dmg, lerpLevel(g.level, Q.lightning.minionMin));
    else dmg = Math.min(dmg, Q.lightning.monsterCap + Q.lightning.monsterCapBonusAd * g.bonusAd + Q.lightning.monsterCapAp * g.ap);
    g.vfx.hit(FX.qFlash, e.pos, 0, { size: boundSize(e) });
    g.hurtEnemy(e, dmg, HITS.lightning);
  };

  const stormTick = (s: Storm) => {
    const r = s.rank;
    const minion = byLevel(g.level, R.minionMult, R.minionLevels);
    const base = R.damage[r] / 2 + (R.ap / 2) * g.ap;
    let fx = 0;
    for (const e of g.enemiesNear(s.pos, R.radius, near)) {
      if (e.deadFor >= 0 || flatDist(e.pos, s.pos) - e.def.radius > R.radius) continue;
      let dmg = base * (e.def.tier === 'minion' ? minion : 1);
      if (s.awakened) {
        const extra = ((lerpLevel(g.level, R.awaken.maxHp) + R.awaken.maxHpPerAp * g.ap) / (R.duration / R.interval)) * e.maxHp;
        dmg += e.def.tier === 'minion' ? extra : Math.min(extra, lerpLevel(g.level, R.awaken.monsterCap));
      }
      g.slow(e, R.slow[r] + (s.awakened ? R.awaken.slow : 0), R.slowDuration);
      if (fx++ < R.maxTickFx) g.vfx.hit(FX.rTick, e.pos, 0, { size: boundSize(e) });
      g.hurtEnemy(e, dmg, HITS.storm);
    }
    if (fx > 0) audio.play('udyr_R_storm_hit');
  };

  return {
    stat: (k) => (k === 'range' ? (stance === 'Q' && empowered > 0 ? Q.range : 0) + (stance === 'E' && stampedeAwakened && g.time < stampedeUntil ? E.awaken.range : 0) : 0),
    attackSpeedBonus() {
      let as = monk > 0 && g.time < monkUntil ? PASSIVE.monkAs : 0;
      if (g.time < clawUntil) as += Q.as[clawRank] + (clawAwakened ? lerpLevel(g.level, Q.awakenAs) : 0);
      return as;
    },
    moveSpeedBonus() {
      if (g.time >= stampedeUntil) return 0;
      const elapsed = g.time - stampedeStart;
      const decay = Math.max(E.decayTo, 1 - (elapsed / E.decayOver) * (1 - E.decayTo));
      let ms = (E.ms[stampedeRank] + E.msPerBonusAd * g.bonusAd) * decay;
      if (stampedeAwakened) ms += lerpLevel(g.level, E.awaken.ms) + E.awaken.msPerBonusAd * g.bonusAd;
      return ms;
    },
    ghost: () => g.time < stampedeUntil,
    unstoppable: () => g.time < unstoppableUntil,
    moveAnims() {
      const c = CLIPS[stance ?? 'W'];
      return { idle: c.idle, run: g.moveSpeed >= 575 ? c.runFast : c.run };
    },
    hud() {
      const name = stance ? SKILLS[stance].name : t('champion.udyr.hud.none');
      return awakenReady() ? t('champion.udyr.hud.ready', { stance: name, n: empowered }) : t('champion.udyr.hud', { stance: name, n: empowered, s: Math.ceil(awakenAt - g.time) });
    },
    gauge: () => ({
      label: awakenReady() ? '✦' : `${Math.ceil(awakenAt - g.time)}s`,
      fill: awakenReady() ? 1 : 1 - (awakenAt - g.time) / awakenCooldown(),
      ready: awakenReady() && awakenWindow !== null && g.time >= awakenWindow.from,
      skill: stance ?? undefined,
    }),
    skillView: (key) => (key === stance && empowered > 0 ? { badge: String(empowered) } : undefined),

    recast(key) {
      // the stance pressed again while on cooldown: Awaken it, once per Awakened Spirit, 0.25-5 s after entering it
      if (awakenWindow && awakenWindow.stance === key && stance === key && g.time >= awakenWindow.from && g.time <= awakenWindow.until) awaken(key);
    },

    cast(key, r) { enter(key, r); },

    attackStart(target) {
      const c = CLIPS[stance ?? 'W'];
      const emp = stance !== null && empowered > 0;
      const i = attackIndex++;
      const set = emp ? c.emp : c.attacks;
      const anim = set[i % set.length];
      pending = {
        stance, empowered: emp, follow: (emp ? c.empFollow : c.follow)[i % set.length], followRun: (emp ? c.empFollowRun : c.followRun)[i % set.length],
        sound: emp ? `udyr_${stance}_auto_hit` : 'udyr_auto_hit',
      };
      // Stampede: the empowered attack pounces onto its target
      if (emp && stance === 'E') {
        const gap = flatDist(target.pos, g.pos) - target.def.radius - UDYR.base.radius;
        if (gap > E.pounceMin) g.dash(dir.copy(target.pos).sub(g.pos).setY(0).normalize(), gap - E.pounceMin / 2, E.pounce);
      }
      const sound = emp ? `udyr_${stance}_auto${i % 2 ? '' : '2'}` : `udyr_auto${i % 2 ? '' : '2'}`;
      return { anim, sound, windupPercent: emp ? (c.empWindup / 30) * UDYR.base.attackSpeed : undefined };
    },

    // melee: the hit lands at the end of the windup, no missile
    basicAttack(target, damage, crit, bolt) {
      if (bolt) {
        g.hurtEnemy(target, damage, { ...HITS.auto[+crit], bolt });
        return true;
      }
      const s = pending.stance;
      const emp = pending.empowered && s !== null && empowered > 0;
      g.gesture(pending.follow, pending.followRun); // the follow-through carries the swipe and ribbon particle events
      audio.play(pending.sound);
      if (emp) {
        empowered--;
        if (empowered === 0) endReady();
        g.vfx.hit(FX.empHit[s][attackIndex % 2], target.pos, g.facing, { size: boundSize(target) });
      } else g.vfx.hit(s ? FX.hit[s] : FX.baseHit, target.pos, g.facing, { size: boundSize(target) });
      if (monk > 0 && g.time < monkUntil) {
        monk--;
        const left = awakenAt - g.time;
        if (left >= PASSIVE.monkRefundMin) awakenAt -= PASSIVE.monkRefund * awakenCooldown();
      }
      let total = damage;
      // Claw: on-hit damage for 4 s after the cast; the empowered attacks add a share of max Health
      if (g.time < clawUntil) total += Q.onHit[clawRank] + Q.onHitBonusAd * g.bonusAd + Q.onHitBonusHp[clawRank] * (g.maxHp - UDYR.base.hp);
      if (emp && s === 'Q') {
        total += (Q.maxHp[clawRank] + Q.maxHpPerBonusAd * g.bonusAd) * target.maxHp;
        if (empoweredAwakened) total += (lerpLevel(g.level, Q.awakenMaxHp) + Q.awakenMaxHpPerBonusAd * g.bonusAd) * target.maxHp;
      }
      if (emp && s === 'E') {
        const cd = stunReady.get(target);
        if (!cd || g.time >= cd.at) {
          g.stunEnemy(target, E.stun);
          cd?.fx?.removeFromParent();
          const fx = stunReady.size < 12 ? follow(FX.eTimer, target.pos) : null;
          stunReady.set(target, { at: g.time + E.stunCd[stampedeRank], fx });
        }
      }
      const hitDef = emp ? HITS.emp[s][+crit] : HITS.auto[+crit];
      g.hurtEnemy(target, total, hitDef);
      if (emp && s === 'W' && g.alive) {
        const heal = (W.healHp * g.maxHp + W.healAp * g.ap) * (empoweredAwakened ? W.awaken.mult : 1) * (target.def.tier === 'minion' ? W.minionHeal : 1);
        g.heal(heal);
      }
      if (emp && s === 'R') {
        // Storm: the empowered attack bursts around the target, or over the whole glacial storm while it blows
        const pulse = lerpLevel(g.level, R.pulse) + R.pulseAp * g.ap;
        const center = storm?.awakened ? storm.pos : target.pos, radius = storm?.awakened ? R.radius : R.pulseRadius;
        g.vfx.playAt(FX.rSplash, center.clone().setY(0), g.facing);
        for (const e of g.enemiesNear(center, radius, near2)) {
          if (e.deadFor >= 0 || e === target || flatDist(e.pos, center) - e.def.radius > radius) continue;
          g.hurtEnemy(e, pulse, HITS.pulse);
        }
        g.vfx.hit(FX.rLinger, target.pos, 0, { size: boundSize(target) });
        g.hurtEnemy(target, pulse, HITS.pulse);
      }
      // Awakened Claw: the next two attacks in any stance call lightning down on the target
      if (lightning > 0 && g.time < lightningUntil && target.deadFor < 0) {
        lightning--;
        g.vfx.hit(FX.qScalingTar, target.pos, 0, { size: boundSize(target) });
        chains.push({ from: target, left: Q.lightning.bounces, next: g.time, pct: lerpLevel(g.level, Q.lightning.pct) + Q.lightning.pctPerAp * g.ap });
      }
      return true;
    },

    onDealt(_e, h, dealt) {
      // Mantle: the empowered attacks life steal (doubled when Awakened)
      if (h === HITS.emp.W[0] || h === HITS.emp.W[1]) g.heal(dealt * W.lifesteal[mantleRank] * (empoweredAwakened ? W.awaken.mult : 1));
    },

    onKill(e, h) {
      if (h.skill !== undefined || EMPOWERED.has(h)) manaOnKill(e);
    },

    update(dt) {
      if (hairUntil > 0 && g.time >= hairUntil) { hairUntil = 0; setHair(false); }
      if (awakenWindow && g.time > awakenWindow.until) {
        // the window closed unused: the stance can be entered again right away, as in League
        if (stance === awakenWindow.stance) g.cooldowns[stance] = Math.min(g.cooldowns[stance], PASSIVE.awakenRecast);
        awakenWindow = null;
      }
      if (speedFx) {
        if (g.time >= stampedeUntil) endSpeed();
        else speedFx.position.copy(g.pos).setY(0);
      }
      for (const [e, cd] of stunReady) {
        if (e.deadFor >= 0 || g.time >= cd.at) { cd.fx?.removeFromParent(); stunReady.delete(e); } else cd.fx?.position.copy(e.pos).setY(0);
      }
      if (mantleHeal && g.time >= mantleHeal.next) {
        mantleHeal.next += W.awaken.healInterval;
        g.heal(mantleHeal.amount);
        if (mantleHeal.ticks % 4 === 0) g.vfx.playAt(FX.wAwakenHeal, g.pos.clone().setY(0), g.facing, { owner: g.player.root });
        if (--mantleHeal.ticks <= 0) mantleHeal = null;
      }
      for (let i = chains.length - 1; i >= 0; i--) {
        const c = chains[i];
        if (g.time < c.next) continue;
        c.next += Q.lightning.interval;
        // up to 3 enemies around the last one struck, the same target included; one of them at random
        const from = c.from.deadFor < 0 ? c.from : null;
        const at = from ? from.pos : c.from.pos;
        const around = g.enemiesNear(at, Q.lightning.range, near2).filter((e) => e.deadFor < 0 && flatDist(e.pos, at) - e.def.radius <= Q.lightning.range);
        around.sort((a, b) => flatDist(a.pos, at) - flatDist(b.pos, at));
        const pool = around.slice(0, Q.lightning.targets + (from ? 1 : 0));
        if (pool.length === 0) { chains.splice(i, 1); continue; }
        const to = pool[Math.floor(Math.random() * pool.length)];
        if (to !== from) {
          g.vfx.play(FX.qBeam, at.clone().setY(100), facingQuat(0), { target: to.pos.clone().setY(100) });
          g.vfx.play(FX.qBounce, at.clone().setY(100), facingQuat(Math.atan2(to.pos.x - at.x, to.pos.z - at.z)));
          audio.play(to.def.tier === 'minion' ? 'udyr_Q_bounce_small' : big(to) ? 'udyr_Q_bounce_large' : 'udyr_Q_bounce_med');
        }
        strike(to, c.pct);
        c.from = to;
        if (--c.left <= 0) chains.splice(i, 1);
      }
      if (storm) {
        const s = storm;
        {
          if (s.awakened) {
            // the glacial storm hunts the closest enemy around it, else drifts back to Udyr
            if (!s.target || s.target.deadFor >= 0 || flatDist(s.target.pos, s.pos) > R.awaken.follow) {
              s.target = g.nearestEnemy(s.pos, R.awaken.follow);
              s.indicator?.removeFromParent();
              s.indicator = s.target ? follow(FX.rStormTarget, s.target.pos) : null;
            }
            const goal = s.target ? s.target.pos : g.pos;
            const d = flatDist(goal, s.pos);
            const step = lerpLevel(g.level, R.awaken.speed) * dt;
            if (d > 1) s.pos.addScaledVector(dir.copy(goal).sub(s.pos).setY(0).normalize(), Math.min(step, d));
            s.indicator?.position.copy(goal).setY(0);
          } else s.pos.copy(g.pos);
          s.obj.position.copy(s.pos).setY(0);
          if (g.time >= s.next) {
            s.next += R.interval;
            stormTick(s);
            if (--s.ticks <= 0) endStorm(); // counted, not timed: the last tick must land
          }
        }
      }
      for (let i = timed.length - 1; i >= 0; i--) {
        if (g.time >= timed[i].until) { timed[i].o.removeFromParent(); timed.splice(i, 1); } else timed[i].o.position.copy(g.pos).setY(0);
      }
    },

    dispose() {
      stopAll(idleFx);
      endReady();
      endStorm();
      endSpeed();
      for (const cd of stunReady.values()) cd.fx?.removeFromParent();
      stunReady.clear();
      chains.length = 0;
      for (const x of timed) x.o.removeFromParent();
      timed.length = 0;
    },
  };
}
