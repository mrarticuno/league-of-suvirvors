// Heimerdinger. Numbers mirror League of Legends: the installed client's spell bins (Heimerdinger, HeimerTYellow and
// HeimerTBlue: DataValues, mSpellCalculations, cooldowns, costs, missile specs, cast frames) and the LoL Wiki for what
// the bins leave to scripts (turret attack speed 1.75 / Apex 1.05, beam charge 1.1%/s / Apex 12.5%/s + 20% per attack,
// the 8s deactivation timer, Hextech Affinity's 300 radius).
// H-28G Evolution Turret: Turret Kits recharge every 20s (ability haste shortens it), 3 at most; up to 10 turrets (League: 3, buffed for hordes), an 11th
// destroys the oldest. A turret fires cannon shots at the enemy Heimerdinger last hit (a 3s mark), else the nearest one,
// and fires its beam at full charge. Out of Heimerdinger's reach (900) for 8s, it shuts down and loses its charge.
// Hextech Micro-Rockets / CH-2 grenade charge nearby turrets when they hit a champion: elite and epic monsters stand in
// for champions here (20% per rocket, 100% per grenade). UPGRADE!!! empowers the next basic ability (no mana), can be
// cancelled after 3s, and goes on its full cooldown when the empowered ability is cast.
// Adapted for hordes: mana costs are lower (Q 15, W 30-50, E 55, R 80) and kills by Heimerdinger's abilities and
// turrets restore 10-30 mana by level (1s cooldown against minions and small monsters, elite and epic kills always
// restore), like Ziggs. Enemies do not attack pets in this game, so turrets have no health: they last until replaced
// (the Apex Turret for its 8s).
// Not in the bins nor the wiki, estimated from Riot's ability videos: the micro-rockets' launch spread (65 between
// rockets), the Rocket Swarm's waves (0.25s apart), the Lightning Grenade's bounce length (300) and the Apex Turret's
// splash radius (150, its impact's size).
// Systems not played: the turret idle/upgrade steam emitters (no texture in the client), Heimerdinger_R_Beam
// (VfxPrimitiveCameraSegmentBeam, not supported), the turret range rings and aggro icons (champion-targeting UI), emotes,
// recall and the HeimerdingerScrapRelic / slowAura / hexTech leftovers of older versions.
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, KitBar, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const CD_ICON = 'https://raw.communitydragon.org/latest/game/assets/characters/heimerdinger/hud/icons2d';
const FPS = 30;
const ANTENNAS = ['L_Buffbone_Cstm_Antenna', 'R_Buffbone_Cstm_Antenna'];
const ROCKETS_BONE = 'R_Weapon'; // HeimerdingerWAttack2's mStartBoneName
const HEAD = 'Head'; // HeimerdingerESpell's mStartBoneName
const LAUNCH_HEIGHT = 100; // the bins' mOffsetInitialTargetHeight / mTargetHeightAugment
const SCALE = 1.2;
const peak = (gravity: number, time: number) => (gravity * time * time) / 8;

const PASSIVE = { moveSpeed: 0.2, radius: 300, manaRestore: [10, 30], manaCooldown: 1 };

/** H-28G Evolution Turret (HeimerTYellow) and H-28Q Apex Turret (HeimerTBlue). */
const TURRET = {
  yellow: {
    attackSpeed: 1.75, ratio: 1.25, range: 550, minionRange: 600, speed: 1600, castFrame: 12.775, casFrame: 8,
    charge: 0.011, beamRange: 900, beamLength: 1000, beamWidth: 50, beamWindup: 0.425,
  },
  blue: {
    attackSpeed: 1.05, ratio: 1.25, range: 650, speed: 1599.4, castFrame: 12.95, smokeFrame: 8,
    charge: 0.125, chargePerAttack: 0.2, beamRange: 650, beamLength: 1000, beamWidth: 75, beamWindup: 0.35,
    duration: 8, splash: 150, slow: 0.25, slowDuration: 2,
  },
  beam: { speed: 1650, accel: -1000, min: 1200, max: 1650 }, // HeimerdingerTurret(Big)EnergyBlast's AcceleratingMovement
  max: 10, reach: 900, shutdown: 8, mark: 3, spawn: 1.067, scale: SCALE * 1.1 / 0.9, // SkinScale 1.1 against Heimerdinger's 0.9: League's turret-to-Heimerdinger size
};

/**
 * Not from LoL: Q cast on one of his Evolution Turrets (or tapping it on a touch screen) spends the Kit and the Mana to
 * level it up instead of building another, from level 1 up to 10; each level picks one of three upgrades.
 */
const UPGRADES = {
  max: 10, pick: 120, tap: 140, // pointer / tap reach around a turret
  ap: 40, // bonus ability power of that turret's shots and beam
  attackSpeed: 0.3, // bonus attack speed of that turret
  cleave: 0.4, radius: 350, // Tiamat's Cleave: share of a shot's damage dealt to the other enemies around its target
  grow: 0.08, // the turret's size per level (+8%: 1.72x at level 10), grown over `growTime` seconds
  growTime: 0.4,
};
type Upgrade = 'ap' | 'attackSpeed' | 'cleave';

const SKILLS = {
  Q: {
    name: t('champion.heimerdinger.Q'), desc: t('champion.heimerdinger.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'heimerdinger_base_spell1', icon: `${ICON}/spell/HeimerdingerQ.png`,
    cooldown: [1, 1, 1, 1, 1], cost: [15, 15, 15, 15, 15],
    damage: [7, 11, 15, 19, 23], apRatio: 0.35, apPerLevel: 0.01, // buffed for hordes: +1% AP per champion level (League: 35%)
    extra: { label: t('champion.heimerdinger.beam'), values: [40, 60, 80, 100, 120] },
    beam: [40, 60, 80, 100, 120], beamAp: 0.55,
    range: 350, ultRange: 450, aim: 350, castTime: 0.25, kits: 3, kitRecharge: 20,
  },
  W: {
    name: t('champion.heimerdinger.W'), desc: t('champion.heimerdinger.W.desc'), damageType: 'magic', maxRank: 5, anim: 'heimerdinger_base_spell2', icon: `${ICON}/spell/HeimerdingerW.png`,
    cooldown: [11, 10, 9, 8, 7], cost: [30, 35, 40, 45, 50],
    damage: [50, 75, 100, 125, 150], apRatio: 0.55,
    extra: { label: t('champion.heimerdinger.extraRocket'), values: [10, 15, 20, 25, 30] },
    extraHit: [10, 15, 20, 25, 30], extraAp: 0.12, minionMult: 3,
    rockets: 5, spread: 65, range: 1350, aim: 1150, farAt: 1000, farAim: 1100,
    speed: 750, accel: 4000, maxSpeed: 3000, width: 40, ultWidth: 60, castTime: 0.25, charge: 0.2, chargeRange: 1000,
  },
  E: {
    name: t('champion.heimerdinger.E'), desc: t('champion.heimerdinger.E.desc'), damageType: 'magic', maxRank: 5, anim: 'heimerdinger_base_spell3', icon: `${ICON}/spell/HeimerdingerE.png`,
    cooldown: [11, 11, 11, 11, 11], cost: [55, 55, 55, 55, 55],
    damage: [60, 100, 140, 180, 220], apRatio: 0.6,
    range: 925, aim: 925, speed: 1200, gravity: 5000, radius: 250, inner: 100,
    ultRadius: 300, ultInner: 150, bounce: 300, bounceTime: 0.4, bounceGravity: [7500, 4500],
    slow: 0.35, slowDuration: 2, stun: 1.5, castTime: 0.25, chargeRange: 1000, maxHitFx: 30,
  },
  R: {
    name: t('champion.heimerdinger.R'), desc: t('champion.heimerdinger.R.desc'), damageType: 'magic', maxRank: 3, anim: 'heimerdinger_spell4_in', icon: `${ICON}/spell/HeimerdingerR.png`,
    cooldown: [100, 85, 70], cost: [80, 80, 80],
    damage: [100, 200, 300], apRatio: 0.6, // CH-3X Lightning Grenade (the card's headline number)
    aim: 'none', castTime: 0.05, recast: 3,
    qUlt: [80, 100, 120], qUltAp: 0.35, qUltBeam: [100, 140, 180], qUltBeamAp: 0.7,
    wUlt: [135, 180, 225], wUltAp: 0.45, wUltExtra: [32, 45, 58], wUltExtraAp: 0.12, waves: 4, waveGap: 0.25,
    eUlt: [100, 200, 300], eUltAp: 0.6,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' }, // turret shots and beams are Heimerdinger's spell damage
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  cleave: { type: 'magic', source: 'item' }, // a turret's Cleave splash: an area proc, like an item's
} as const satisfies Record<string, Hit>;

export const HEIMERDINGER: ChampionDef = {
  id: 'heimerdinger', name: t('champion.heimerdinger.name'), model: 'heimerdinger', icon: `${ICON}/champion/Heimerdinger.png`,
  scale: SCALE, // Ezreal's height: the export stands ~155 tall (hair included), ~186 here (Ezreal ~183), like Veigar
  title: t('champion.heimerdinger.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Heimerdinger_0.jpg',
  roles: ['mage', 'support'], difficulty: 8,
  // initialSubmeshToHide, plus what Idle1's events hide: the rocket and its holder and the grabbing hand only show in casts
  hide: ['Heimerdinger_Grab_Hand', 'Heimerdinger_Antenna', 'Heimerdinger_Rocket_Holder', 'Heimerdinger_Rocket'],
  base: {
    hp: 558, hpPerLevel: 105,
    hpRegen5: 7, hpRegen5PerLevel: 0.55,
    mana: 385, manaPerLevel: 20,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 56, adPerLevel: 2.7,
    attackSpeed: 0.658, attackSpeedPerLevel: 0.0136,
    attackRange: 550,
    moveSpeed: 340,
    critDamage: 1.75,
    windupPercent: 0.3 - 0.1, // attack cast time 0.3 plus the bin's mAttackDelayCastOffsetPercent
    missileSpeed: 1500,
    radius: 55,
    armor: 19, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.heimerdinger.passive'), icon: `${ICON}/passive/Heimerdinger_Passive.png` },
  anims: {
    idle: 'heimerdinger_base_idle1', run: 'heimerdinger_base_run1', death: 'heimerdinger_base_death',
    attacks: ['heimerdinger_base_attack1', 'heimerdinger_base_attack2'], crit: 'heimerdinger_base_attackcrit',
  },
  // HeimerdingerBasicAttack (R_hand) / HeimerdingerBasicAttack2 (L_hand, Heimerdinger_AA_2_mis: see basicAttack)
  vfx: { auto: 'Heimerdinger_AA_mis', crit: 'Heimerdinger_Crit_mis', autoHit: 'Heimerdinger_AA_Tar', critHit: 'Heimerdinger_Crit_Tar' },
  animVfx: true, // the casts' rocket, holder, hand and antenna submeshes, and the death explosion
  kit: heimerdingerKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;
const champion = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic'; // the stand-ins for League's champions

type Kind = 'yellow' | 'blue';
interface Turret {
  kind: Kind; actor: Actor | null; pos: THREE.Vector3; born: number; until: number; charge: number;
  next: number; // run time of the next cannon shot
  shot: { at: number; target: Enemy; cas: number; beam: boolean } | null; // an attack in windup
  away: number; // seconds out of Heimerdinger's reach
  dormant: boolean; dying: number; fx: THREE.Object3D[]; // countdown timer, exclamation, dormant sparks
  level: number; pending: number; ap: number; attackSpeed: number; cleave: number; // upgrades
  ring: THREE.Object3D | null; // range ring while under the pointer
}
/** A straight missile the kit moves (accelerating rockets and beams). */
interface Bolt {
  fx: MissileFx; pos: THREE.Vector3; dir: THREE.Vector3; speed: number; accel: number; min: number; max: number;
  left: number; radius: number; pierce: Set<Enemy> | null; hit: (e: Enemy, b: Bolt) => void;
}
interface Lob { fx: MissileFx; from: THREE.Vector3; to: THREE.Vector3; dir: THREE.Vector3; age: number; time: number; peak: number; land: () => void }

function heimerdingerKit(g: Game): ChampionKit {
  loadModel('heimertyellow').catch(() => {});
  loadModel('heimertblue').catch(() => {});
  const near: Enemy[] = [];
  const flat = new THREE.Vector3();
  const turrets: Turret[] = [];
  const bolts: Bolt[] = [];
  const lobs: Lob[] = [];
  const later: { at: number; run: () => void }[] = [];
  const marks = new Map<Enemy, number>(); // Heimerdinger's hits: turrets shoot these first
  let kits: number = SKILLS.Q.kits, kitTimer = 0;
  let upgraded = false, consuming = false;
  const ult: Partial<Record<SkillKey, boolean>> = {}; // the cast under way is the empowered one
  let antennaFx: (ParticleSystem | null)[] = [];
  let ammo: { n: number; o: THREE.Object3D } | null = null;
  let manaReady = 0;
  let attack2 = false;

  const after = (s: number, run: () => void) => later.push({ at: g.time + s, run });
  const alive = (e: Enemy) => e.deadFor < 0;
  const edge = (e: Enemy, p: THREE.Vector3) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.def.radius;
  const boneAt = (name: string, fallback: number) => {
    const b = g.player.bone(name);
    return b ? b.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(fallback);
  };
  const toward = (point: THREE.Vector3) => {
    const d = flat.copy(point).sub(g.pos).setY(0);
    if (d.lengthSq() < 1) d.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return d.clone().normalize();
  };
  const within = (point: THREE.Vector3, range: number) => {
    const off = flat.copy(point).sub(g.pos).setY(0);
    if (off.length() > range) off.setLength(range);
    return g.pos.clone().add(off).setY(0);
  };
  const qRank = () => Math.max(0, g.ranks.Q - 1);
  const rRank = () => Math.max(0, g.ranks.R - 1);
  const restoreMana = (e: Enemy) => {
    const big = champion(e);
    if (!big && g.time < manaReady) return;
    if (!big) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.manaRestore));
  };
  /** Beam charge for every turret within `range` of `at` (micro-rockets and grenades hitting a champion). */
  const chargeTurrets = (at: THREE.Vector3, amount: number, range: number) => {
    for (const tu of turrets) if (!tu.dormant && tu.dying < 0 && tu.pos.distanceTo(flat.copy(at).setY(0)) <= range) tu.charge = Math.min(1, tu.charge + amount);
  };

  // ---- missiles the kit moves ----
  const bolt = (key: string, from: THREE.Vector3, dir: THREE.Vector3, o: Omit<Bolt, 'fx' | 'pos' | 'dir' | 'pierce'> & { pierce?: boolean }) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(from);
    g.scene.add(fx.root);
    bolts.push({ ...o, fx, pos: from.clone(), dir: dir.clone().setY(0).normalize(), pierce: o.pierce ? new Set() : null });
  };
  const lob = (key: string, from: THREE.Vector3, to: THREE.Vector3, time: number, gravity: number, land: () => void) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(from);
    g.scene.add(fx.root);
    const dir = to.clone().sub(from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    lobs.push({ fx, from: from.clone(), to: to.clone(), dir: dir.normalize(), age: 0, time: Math.max(time, 0.05), peak: peak(gravity, time), land });
  };

  // ---- Q: turrets ----
  const turretDamage = (tu: Turret) => SKILLS.Q.damage[qRank()] + (SKILLS.Q.apRatio + SKILLS.Q.apPerLevel * g.level) * (g.ap + tu.ap);
  const beamDamage = (tu: Turret) => tu.kind === 'blue'
    ? SKILLS.R.qUltBeam[rRank()] + SKILLS.R.qUltBeamAp * g.ap
    : SKILLS.Q.beam[qRank()] + SKILLS.Q.beamAp * (g.ap + tu.ap);
  const attackSpeedOf = (tu: Turret) => TURRET[tu.kind].attackSpeed * (1 + tu.attackSpeed);
  /** The Evolution Turret within `reach` of `point` that can still level up, nearest first. */
  const upgradable = (point: THREE.Vector3, reach: number) => {
    let best: Turret | null = null, d = reach;
    for (const tu of turrets) {
      if (tu.kind !== 'yellow' || tu.dying >= 0 || tu.level + tu.pending >= UPGRADES.max) continue;
      const dist = Math.hypot(tu.pos.x - point.x, tu.pos.z - point.z);
      if (dist <= d) { d = dist; best = tu; }
    }
    return best;
  };
  const UPGRADE_ICON: Record<Upgrade, string> = { ap: `${ICON}/item/1058.png`, attackSpeed: `${ICON}/item/1043.png`, cleave: `${ICON}/item/3077.png` };
  const levelUp = (tu: Turret) => {
    tu.pending++;
    g.vfx.playAt('Heimerdinger_Q_Turret_Spawn', tu.pos, tu.actor?.root.rotation.y ?? 0);
    audio.playAt('heimerdinger_turret_spawn', tu.pos, g.pos);
    const values: Record<Upgrade, number> = { ap: UPGRADES.ap, attackSpeed: UPGRADES.attackSpeed * 100, cleave: UPGRADES.cleave * 100 };
    const apply: Record<Upgrade, () => void> = {
      ap: () => { tu.ap += UPGRADES.ap; },
      attackSpeed: () => { tu.attackSpeed += UPGRADES.attackSpeed; },
      cleave: () => { tu.cleave += UPGRADES.cleave; },
    };
    g.choices.push({
      title: t('champion.heimerdinger.upgrade', { level: tu.level + tu.pending }),
      options: (['ap', 'attackSpeed', 'cleave'] as const).map((u) => ({
        name: t(`champion.heimerdinger.upgrade.${u}`), text: t(`champion.heimerdinger.upgrade.${u}.desc`, { n: values[u] }), icon: UPGRADE_ICON[u],
        run: () => { apply[u](); tu.level++; },
      })),
    });
    // the popup shows on the next frame; a declined one leaves the level free again
    after(0, () => { tu.pending = Math.max(0, tu.pending - 1); });
  };
  const turretFx = (tu: Turret, key: string, at = tu.pos) => {
    const o = g.vfx.attach(key);
    o.position.copy(at);
    g.scene.add(o);
    tu.fx.push(o);
    return o;
  };
  const clearFx = (tu: Turret) => { for (const o of tu.fx) o.removeFromParent(); tu.fx = []; };
  const deploy = (kind: Kind, point: THREE.Vector3) => {
    if (kind === 'yellow') {
      const own = turrets.filter((x) => x.kind === 'yellow' && x.dying < 0);
      if (own.length >= TURRET.max) destroy(own[0]);
    }
    let actor: Actor | null = null;
    try { actor = new Actor(kind === 'yellow' ? 'heimertyellow' : 'heimertblue', TURRET.scale); } catch { /* model still downloading */ }
    const pos = point.clone().setY(0);
    if (actor) {
      actor.root.position.copy(pos);
      actor.root.rotation.y = g.facing;
      actor.play(kind === 'yellow' ? 'heimerturret_spawn' : 'heimerturret_mega_spawn', { loop: false });
      g.scene.add(actor.root);
    }
    const tu: Turret = {
      kind, actor, pos, born: g.time, until: kind === 'blue' ? g.time + TURRET.blue.duration : Infinity, charge: 0,
      next: g.time + TURRET.spawn, shot: null, away: 0, dormant: false, dying: -1, fx: [],
      level: 1, pending: 0, ap: 0, attackSpeed: 0, cleave: 0, ring: null,
    };
    turrets.push(tu);
    if (kind === 'yellow') {
      g.vfx.playAt('Heimerdinger_Q_Turret_Spawn', pos, g.facing); // the Spawn clip's event
      audio.playAt('heimerdinger_turret_spawn', pos, g.pos);
    } else {
      g.vfx.playAt('Heimerdinger_R_MegaTurret_Spawn', pos, g.facing);
      audio.playAt('heimerdinger_apex_spawn', pos, g.pos);
    }
  };
  function destroy(tu: Turret) {
    if (tu.dying >= 0) return;
    clearFx(tu);
    tu.ring?.removeFromParent();
    tu.ring = null;
    tu.shot = null;
    if (tu.kind === 'yellow') {
      tu.dying = 1;
      tu.actor?.play('heimerturret_death', { loop: false });
      audio.playAt('heimerdinger_turret_destroy', tu.pos, g.pos);
    } else {
      tu.dying = 1.867;
      tu.actor?.play('heimerturret_mega_death', { loop: false });
      g.vfx.playAt('Heimerdinger_R_MegaTurret_Die', tu.pos, tu.actor?.root.rotation.y ?? 0); // the Death clip's event (Root)
      audio.playAt('heimerdinger_apex_end', tu.pos, g.pos);
    }
  }
  const muzzle = (tu: Turret, bone: string) => {
    const b = tu.actor?.bone(bone);
    return b ? b.getWorldPosition(new THREE.Vector3()) : tu.pos.clone().setY(60);
  };
  const turretTarget = (tu: Turret, range: number) => {
    const inRange = (e: Enemy) => alive(e) && edge(e, tu.pos) <= range;
    return g.nearestEnemy(tu.pos, range + 100, (e) => inRange(e) && (marks.get(e) ?? 0) > g.time)
      ?? g.nearestEnemy(tu.pos, range + 100, inRange)
      ?? (tu.kind === 'yellow' ? g.nearestEnemy(tu.pos, TURRET.yellow.minionRange + 100, (e) => alive(e) && e.def.tier === 'minion' && edge(e, tu.pos) <= TURRET.yellow.minionRange) : null);
  };
  const beamTarget = (tu: Turret) => {
    const T = TURRET[tu.kind];
    const ok = (e: Enemy) => alive(e) && edge(e, tu.pos) <= T.beamRange;
    return g.nearestEnemy(tu.pos, T.beamRange + 100, (e) => ok(e) && champion(e)) ?? turretTarget(tu, T.beamRange);
  };
  const face = (tu: Turret, e: Enemy) => { if (tu.actor) tu.actor.root.rotation.y = Math.atan2(e.pos.x - tu.pos.x, e.pos.z - tu.pos.z); };
  const startAttack = (tu: Turret, e: Enemy, beam: boolean) => {
    const T = TURRET[tu.kind];
    const speed = attackSpeedOf(tu) / T.ratio; // the clip plays at the attack speed ratio, as the champion's do
    face(tu, e);
    if (beam) {
      tu.shot = { at: g.time + T.beamWindup, target: e, cas: Infinity, beam: true };
      tu.actor?.play(tu.kind === 'yellow' ? 'heimerturret_attack1' : 'heimerturret_mega_attack1', { loop: false, restart: true });
      const from = muzzle(tu, tu.kind === 'yellow' ? 'Rocket' : 'AlienInvader_Ring3');
      g.vfx.play('Heimerdinger_TracerBeam_Allied_BV2', tu.pos.clone(), new THREE.Quaternion(), { target: e.pos.clone().setY(0) });
      g.vfx.playAt(tu.kind === 'yellow' ? 'Heimerdinger_Q_Turret_Charge_Up' : 'Heimerdinger_R_MegaTurret_Charge_Up', tu.kind === 'yellow' ? from.setY(from.y - 70) : tu.pos.clone());
      audio.playAt(tu.kind === 'yellow' ? 'heimerdinger_turret_beam' : 'heimerdinger_apex_beam', tu.pos, g.pos);
      if (tu.kind === 'blue') after(12 / FPS, () => { if (tu.dying < 0) g.vfx.playAt('Heimerdinger_R_MegaTurret_Charged_Cas', muzzle(tu, 'AlienInvader_Ring3'), tu.actor?.root.rotation.y ?? 0); });
      return;
    }
    const clip = tu.kind === 'yellow' ? 'heimerturret_attack1' : 'heimerturret_mega_attack1';
    tu.actor?.play(clip, { loop: false, restart: true, duration: (tu.actor.duration(clip) || 1) / speed });
    const cast = tu.kind === 'yellow' ? TURRET.yellow.castFrame : TURRET.blue.castFrame;
    const cas = tu.kind === 'yellow' ? TURRET.yellow.casFrame : TURRET.blue.smokeFrame;
    tu.shot = { at: g.time + cast / FPS / speed, target: e, cas: g.time + cas / FPS / speed, beam: false };
    tu.next = g.time + 1 / attackSpeedOf(tu);
    audio.playAt(tu.kind === 'yellow' ? 'heimerdinger_turret_auto' : 'heimerdinger_apex_auto', tu.pos, g.pos);
  };
  const fireShot = (tu: Turret, e: Enemy, beam: boolean) => {
    const T = TURRET[tu.kind];
    if (beam) {
      tu.charge = 0;
      const from = muzzle(tu, tu.kind === 'yellow' ? 'Rocket' : 'AlienInvader_Ring3');
      const dir = flat.copy(e.pos).sub(tu.pos).setY(0);
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      const damage = beamDamage(tu);
      const B = TURRET.beam;
      audio.playAt(tu.kind === 'yellow' ? 'heimerdinger_turret_beam_launch' : 'heimerdinger_apex_beam_launch', tu.pos, g.pos);
      bolt(tu.kind === 'yellow' ? 'Heimerdinger_Q_Turret_Charged_Mis' : 'Heimerdinger_R_MegaTurret_Charged_Mis', from.setY(LAUNCH_HEIGHT), dir, {
        speed: B.speed, accel: B.accel, min: B.min, max: B.max, left: T.beamLength, radius: T.beamWidth / 2, pierce: true,
        hit: (x, b) => {
          g.vfx.hit(tu.kind === 'yellow' ? 'Heimerdinger_Q_Turret_Charged_Tar' : 'Heimerdinger_R_MegaTurret_Charged_Tar', x.pos, Math.atan2(b.dir.x, b.dir.z), { size: boundSize(x) });
          audio.play(tu.kind === 'yellow' ? 'heimerdinger_turret_beam_hit' : 'heimerdinger_apex_beam_hit');
          g.hurtEnemy(x, damage, HITS.Q);
        },
      });
      return;
    }
    const from = muzzle(tu, tu.kind === 'yellow' ? 'Rocket' : 'Buffbone_Glb_Weapon_1');
    audio.playAt(tu.kind === 'yellow' ? 'heimerdinger_turret_launch' : 'heimerdinger_apex_launch', tu.pos, g.pos);
    if (tu.kind === 'yellow') {
      g.spawnMissile('Heimerdinger_Q_Turret_Mis', from, e.pos, {
        speed: T.speed, range: 3000, radius: 10, damage: turretDamage(tu), target: e, hit: HITS.Q, height: from.y,
        hitFx: 'Heimerdinger_Q_Turret_Tar', hitSound: 'heimerdinger_turret_hit',
        onHit: (x, m) => {
          g.impact(x, m);
          if (tu.cleave <= 0) return;
          // Cleave (Tiamat's, with its blast): the other enemies around the target take a share of the shot
          g.vfx.playAt('3077_AoE', x.pos.clone().setY(0));
          for (const y of g.enemiesNear(x.pos, UPGRADES.radius + 100, near)) {
            if (y === x || !alive(y) || edge(y, x.pos) > UPGRADES.radius) continue;
            g.hurtEnemy(y, m.damage * tu.cleave, HITS.cleave);
          }
        },
      });
      return;
    }
    tu.charge = Math.min(1, tu.charge + TURRET.blue.chargePerAttack);
    const damage = SKILLS.R.qUlt[rRank()] + SKILLS.R.qUltAp * g.ap;
    g.spawnMissile('Heimerdinger_R_MegaTurret_Mis', from, e.pos, {
      speed: T.speed, range: 3000, radius: 10, damage, target: e, hit: HITS.Q, height: from.y,
      onHit: (x, m) => {
        g.vfx.hit('Heimerdinger_R_MegaTurret_Tar', x.pos.clone().setY(0.01), 0, { size: boundSize(x) });
        audio.play('heimerdinger_apex_hit');
        // its shots hurt and slow every enemy around the target
        for (const y of g.enemiesNear(m.pos, TURRET.blue.splash + 100, near)) {
          if (!alive(y) || edge(y, m.pos) > TURRET.blue.splash) continue;
          g.slow(y, TURRET.blue.slow, TURRET.blue.slowDuration);
          g.hurtEnemy(y, damage, HITS.Q);
        }
      },
    });
  };
  const sizeOf = (tu: Turret) => 1 + UPGRADES.grow * (tu.level - 1);
  const updateTurret = (tu: Turret, dt: number) => {
    tu.actor?.update(dt);
    if (tu.actor) { // each level makes the turret bigger: it grows to its new size
      const sc = tu.actor.root.scale, to = sizeOf(tu);
      if (sc.x !== to) sc.setScalar(sc.x < to ? Math.min(to, sc.x + (UPGRADES.grow / UPGRADES.growTime) * dt) : to);
    }
    if (tu.dying >= 0) {
      if ((tu.dying -= dt) > 0) return true;
      tu.actor?.dispose();
      tu.actor?.root.removeFromParent();
      return false;
    }
    if (g.time >= tu.until) { destroy(tu); return true; }
    const T = TURRET[tu.kind];
    // spawn clip over: idle
    if (tu.actor && g.time - tu.born >= TURRET.spawn && !tu.dormant && !tu.shot && tu.actor.currentName !== (tu.kind === 'yellow' ? 'heimerturret_idle1' : 'heimerturret_mega_idle1')
      && g.time >= tu.next - 1 / attackSpeedOf(tu) + 0.6) tu.actor.play(tu.kind === 'yellow' ? 'heimerturret_idle1' : 'heimerturret_mega_idle1');
    // deactivation: out of Heimerdinger's reach for 8s
    if (tu.kind === 'yellow') {
      const far = tu.pos.distanceTo(flat.copy(g.pos).setY(0)) > TURRET.reach;
      if (far && !tu.dormant) {
        if (tu.away === 0) {
          turretFx(tu, 'TurretTimer_BV2', tu.pos.clone().setY(10));
          turretFx(tu, 'Heimerdinger_Q_Turret_Exclamation', tu.pos.clone().setY(70));
        }
        tu.away += dt;
        if (tu.away >= TURRET.shutdown) {
          clearFx(tu);
          tu.dormant = true;
          tu.charge = 0;
          tu.shot = null;
          tu.actor?.play('heimerturret_deactivate', { loop: false });
          after(1, () => { if (tu.dormant && tu.dying < 0) tu.actor?.play('heimerturret_deactivate_idle'); });
          turretFx(tu, 'heimerdinger_turret_idle_deactivate_BV2', tu.pos.clone().setY(40));
          audio.playAt('heimerdinger_turret_shutdown', tu.pos, g.pos);
        }
      } else if (!far && (tu.away > 0 || tu.dormant)) {
        clearFx(tu);
        if (tu.dormant) {
          tu.actor?.play('heimerturret_idle1');
          audio.playAt('heimerdinger_turret_wake', tu.pos, g.pos);
        }
        tu.away = 0;
        tu.dormant = false;
      }
      if (tu.dormant) return true;
    }
    if (g.time - tu.born < TURRET.spawn) return true;
    tu.charge = Math.min(1, tu.charge + T.charge * (1 + g.abilityHaste / 100) * dt);
    if (tu.shot) {
      const s = tu.shot;
      if (g.time >= s.cas) {
        s.cas = Infinity;
        if (tu.kind === 'yellow') g.vfx.playAt('Heimerdinger_Q_Turret_Cas', muzzle(tu, 'Rocket'), tu.actor?.root.rotation.y ?? 0);
        else g.vfx.playAt('Heimerdinger_R_MegaTurret_Smoke', tu.pos, tu.actor?.root.rotation.y ?? 0);
      }
      if (g.time < s.at) return true;
      tu.shot = null;
      if (alive(s.target)) fireShot(tu, s.target, s.beam);
      if (s.beam) tu.next = Math.max(tu.next, g.time + 1 / attackSpeedOf(tu));
      return true;
    }
    if (tu.charge >= 1) {
      const e = beamTarget(tu);
      if (e) { startAttack(tu, e, true); return true; }
    }
    if (g.time < tu.next) return true;
    const e = turretTarget(tu, T.range);
    if (e) startAttack(tu, e, false);
    return true;
  };

  // ---- W: rockets ----
  const rockets = (point: THREE.Vector3, rank: number, upgraded: boolean, wave: number, perEnemy: Map<Enemy, number>) => {
    const W = SKILLS.W, R = SKILLS.R;
    const dir = toward(point);
    const dist = Math.hypot(point.x - g.pos.x, point.z - g.pos.z);
    // beyond 1000 every rocket aims at 1100 along the cast direction
    const aim = dist > W.farAt ? g.pos.clone().addScaledVector(dir, W.farAim) : point.clone().setY(0);
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const from = boneAt(ROCKETS_BONE, LAUNCH_HEIGHT);
    audio.play(upgraded ? 'heimerdinger_W_ult_launch' : 'heimerdinger_W_launch');
    if (wave === 0) audio.play('heimerdinger_W_rocket');
    for (let i = 0; i < W.rockets; i++) {
      const start = from.clone().addScaledVector(side, (i - (W.rockets - 1) / 2) * W.spread);
      const d = aim.clone().sub(start).setY(0);
      bolt(upgraded ? 'Heimerdinger_W_Mis_Ult' : 'Heimerdinger_W_Mis', start, d, {
        speed: W.speed, accel: W.accel, min: W.speed, max: W.maxSpeed, left: W.range,
        radius: (upgraded ? W.ultWidth : W.width) / 2,
        hit: (e, b) => {
          const n = (perEnemy.get(e) ?? 0) + 1;
          perEnemy.set(e, n);
          let damage: number;
          if (upgraded) {
            const first = R.wUlt[rRank()] + R.wUltAp * g.ap;
            const extra = R.wUltExtra[rRank()] + R.wUltExtraAp * g.ap;
            damage = e.def.tier === 'minion' || n === 1 ? first : n <= 5 ? extra : extra / 2;
          } else {
            const extra = W.extraHit[rank] + W.extraAp * g.ap;
            damage = n === 1 ? W.damage[rank] + W.apRatio * g.ap : extra * (e.def.tier === 'minion' ? W.minionMult : 1);
          }
          g.vfx.hit(upgraded ? 'Heimerdinger_W_ULT_Tar' : 'Heimerdinger_W_Tar', b.pos.clone().setY(0.01), Math.atan2(b.dir.x, b.dir.z), { size: boundSize(e) });
          audio.play(upgraded ? 'heimerdinger_W_ult_hit' : 'heimerdinger_W_hit');
          if (champion(e)) chargeTurrets(g.pos, W.charge, W.chargeRange);
          g.hurtEnemy(e, damage, HITS.W);
        },
      });
    }
  };

  // ---- E: grenades ----
  const explode = (at: THREE.Vector3, rank: number, upgraded: boolean, fx: string, hitOnce: Set<Enemy> | null) => {
    const E = SKILLS.E;
    const radius = upgraded ? E.ultRadius : E.radius, inner = upgraded ? E.ultInner : E.inner;
    const damage = upgraded ? SKILLS.R.eUlt[rRank()] + SKILLS.R.eUltAp * g.ap : E.damage[rank] + E.apRatio * g.ap;
    g.vfx.playAt(fx, at.clone().setY(0));
    audio.playAt(upgraded ? 'heimerdinger_E_ult_hit' : 'heimerdinger_E_hit', at, g.pos);
    let shown = 0, champHit = false;
    for (const e of g.enemiesNear(at, radius + 100, near)) {
      if (!alive(e) || edge(e, at) > radius) continue;
      if (shown++ < E.maxHitFx) g.vfx.hit('Heimerdinger_E_Tar', e.pos.clone().setY(0.01), 0, { size: boundSize(e) });
      g.slow(e, E.slow, E.slowDuration);
      if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= inner + e.def.radius) g.stunEnemy(e, E.stun);
      if (champion(e)) champHit = true;
      // champions take the Lightning Grenade's damage once per cast
      if (hitOnce && champion(e)) { if (hitOnce.has(e)) continue; hitOnce.add(e); }
      g.hurtEnemy(e, damage, HITS.E);
    }
    if (champHit && !upgraded) chargeTurrets(at, 1, E.chargeRange);
  };
  const grenade = (point: THREE.Vector3, rank: number) => {
    const E = SKILLS.E;
    const to = within(point, E.range);
    const t0 = Math.max(0.05, Math.hypot(to.x - g.pos.x, to.z - g.pos.z) / E.speed);
    audio.play('heimerdinger_E_launch');
    lob('Heimerdinger_E_Mis', boneAt(HEAD, LAUNCH_HEIGHT), to.clone().setY(LAUNCH_HEIGHT), t0, E.gravity, () => explode(to, rank, false, 'Heimerdinger_E_Explosion', null));
  };
  const lightningGrenade = (point: THREE.Vector3, rank: number) => {
    const E = SKILLS.E;
    const dir = toward(point);
    const to = within(point, E.range);
    const t0 = Math.max(0.05, Math.hypot(to.x - g.pos.x, to.z - g.pos.z) / E.speed);
    const once = new Set<Enemy>();
    audio.play('heimerdinger_E_ult_launch');
    const bounce = (at: THREE.Vector3, stage: number) => {
      const last = stage >= E.bounceGravity.length;
      explode(at, rank, true, last ? 'Heimerdinger_E_Explosion_Ult_End' : 'Heimerdinger_E_Explosion_Ult', once);
      if (last) return;
      const next = at.clone().addScaledVector(dir, E.bounce).setY(0);
      lob('Heimerdinger_E_Mis_Ult', at.clone().setY(LAUNCH_HEIGHT), next.clone().setY(LAUNCH_HEIGHT), E.bounceTime, E.bounceGravity[stage], () => bounce(next, stage + 1));
    };
    lob('Heimerdinger_E_Mis_Ult', boneAt(HEAD, LAUNCH_HEIGHT), to.clone().setY(LAUNCH_HEIGHT), t0, E.gravity, () => bounce(to, 0));
  };

  // ---- R: UPGRADE!!! ----
  const antenna = (on: boolean) => {
    g.player.showSubmesh('Heimerdinger_Antenna', on);
    for (const s of antennaFx) s?.stop();
    antennaFx = [];
    if (!on) return;
    for (const name of ANTENNAS) {
      const bone = g.player.bone(name);
      if (bone) antennaFx.push(g.vfx.play('Heimerdinger_R_Antenna_Glow', bone.getWorldPosition(new THREE.Vector3()), new THREE.Quaternion(), { bone, owner: g.player.root, until: undefined }));
    }
  };
  const endUpgrade = (consumed: boolean) => {
    upgraded = false;
    antenna(false);
    audio.play('heimerdinger_R_end');
    if (!consumed) return;
    consuming = true;
    g.cooldowns.R = g.cooldownOf('R'); // the full cooldown starts when the empowered ability is cast
    consuming = false;
  };

  // Turret Kit charges orbit Heimerdinger: one system per count
  const AMMO = ['', 'Heimer_Q_Ammo1', 'Heimer_Q_Ammo2_BV2', 'Heimer_Q_Ammo3_BV2'];
  const showAmmo = () => {
    const n = g.ranks.Q > 0 && g.hp > 0 ? kits : 0;
    if (ammo?.n === n) return;
    ammo?.o.removeFromParent();
    ammo = null;
    if (!n) return;
    const o = g.vfx.attach(AMMO[n]);
    g.scene.add(o);
    ammo = { n, o };
  };

  return {
    hud: () => t('champion.heimerdinger.hud', { n: turrets.filter((x) => x.kind === 'yellow' && x.dying < 0).length, max: TURRET.max }),
    gauge: () => ({ label: String(kits), fill: kits >= SKILLS.Q.kits ? 1 : kitTimer / (SKILLS.Q.kitRecharge * 100 / (100 + g.abilityHaste)), ready: kits > 0, skill: 'Q' }),
    skillView(k) {
      if (!upgraded || k === 'R') return k === 'Q' ? { badge: String(kits) } : undefined;
      const n = { Q: 'q2', W: 'w2', E: 'e2' }[k];
      return { icon: `${CD_ICON}/heimerdinger_${n}.png`, name: t(`champion.heimerdinger.${k}2`) };
    },
    moveSpeedBonus: () => (turrets.some((x) => x.dying < 0 && x.pos.distanceTo(flat.copy(g.pos).setY(0)) <= PASSIVE.radius) ? PASSIVE.moveSpeed : 0),
    cost: () => (upgraded ? 0 : undefined),
    canCast: (k) => k !== 'Q' || upgraded || kits > 0,
    cooldownBase: (k) => (k === 'R' && !consuming ? SKILLS.R.recast : undefined),
    castAnim: (k) => (k === 'R' && upgraded ? 'heimerdinger_spell4_windown' : undefined),

    castStart(key) {
      if (key === 'R') return;
      ult[key] = upgraded;
      const bone = g.player.bone('C_Buffbone_Glb_Center_Loc');
      const fx = `Heimerdinger_${key}_Cas${upgraded ? '_Ult' : ''}`;
      if (bone) g.vfx.playOn(fx, bone, g.facing, g.player.root);
      if (upgraded) endUpgrade(true);
      if (ult.E && key === 'E') audio.play('heimerdinger_E_ult');
      if (key === 'Q' && !ult.Q) {
        if (kits === SKILLS.Q.kits) kitTimer = 0;
        kits--;
        g.vfx.playAt('Heimerdinger_Q_Ammo_Spend', g.pos.clone().setY(0), g.facing);
      }
    },

    cast(key, r, point) {
      if (key === 'R') {
        if (upgraded) return endUpgrade(false); // recast: cancel
        upgraded = true;
        antenna(true);
        g.vfx.playAt('Heimerdinger_R_Cast', g.pos.clone().setY(0), g.facing);
        return;
      }
      const up = !!ult[key];
      ult[key] = false;
      if (key === 'Q') {
        const target = up ? null : upgradable(point, UPGRADES.pick);
        if (target) levelUp(target);
        else deploy(up ? 'blue' : 'yellow', within(point, up ? SKILLS.Q.ultRange : SKILLS.Q.range));
      }
      else if (key === 'W') {
        const perEnemy = new Map<Enemy, number>();
        const at = point.clone();
        if (!up) rockets(at, r, false, 0, perEnemy);
        else for (let w = 0; w < SKILLS.R.waves; w++) after(w * SKILLS.R.waveGap, () => rockets(at, r, true, w, perEnemy));
      } else if (up) lightningGrenade(point, r);
      else grenade(point, r);
    },

    bars() {
      const out: KitBar[] = [];
      const hover = g.cursor && !upgraded ? upgradable(g.cursor, UPGRADES.pick) : null;
      for (const tu of turrets) {
        if (tu.dying >= 0) continue;
        const h = tu === hover;
        out.push({
          pos: tu.pos, height: (tu.kind === 'yellow' ? 95 : 190) * TURRET.scale * sizeOf(tu), fill: tu.charge, ready: tu.charge >= 1, dim: tu.dormant,
          hover: h, hint: h ? t('champion.heimerdinger.upgradeHint') : undefined,
          level: tu.kind === 'yellow' ? tu.level : undefined,
        });
      }
      return out;
    },
    tap(point) {
      const tu = upgradable(point, UPGRADES.tap);
      if (!tu) return false;
      g.cast('Q', tu.pos.clone());
      return true;
    },

    attackStart() {
      attack2 = !attack2;
      return undefined;
    },
    basicAttack(target, damage, crit, bolt) {
      if (crit || bolt || !attack2) return false;
      // HeimerdingerBasicAttack2 throws the other wrench from the left hand
      g.spawnMissile('Heimerdinger_AA_2_mis', g.pos, target.pos, {
        speed: HEIMERDINGER.base.missileSpeed, range: 3000, radius: 10, damage, target,
        hit: { type: 'physical', source: 'auto', onHit: true, crit }, hitFx: 'Heimerdinger_AA_Tar', hitSound: 'heimerdinger_auto_hit',
      });
      return true;
    },

    onDamage(e, hit) {
      // Heimerdinger's own attacks and abilities mark the target for his turrets (not the turrets' shots)
      if (hit.source !== 'item' && hit.skill !== 'Q') marks.set(e, g.time + TURRET.mark);
      return 0;
    },
    onKill(e, hit) {
      marks.delete(e);
      if (hit.source === 'ability') restoreMana(e);
    },

    update(dt) {
      if (g.ranks.Q > 0 && kits < SKILLS.Q.kits) {
        kitTimer += dt;
        const every = SKILLS.Q.kitRecharge * 100 / (100 + g.abilityHaste);
        if (kitTimer >= every) { kitTimer -= every; kits++; }
      }
      showAmmo();
      ammo?.o.position.copy(g.pos).setY(0);

      for (let i = later.length - 1; i >= 0; i--) {
        if (g.time < later[i].at) continue;
        const run = later[i].run;
        later.splice(i, 1);
        run();
      }
      for (let i = turrets.length - 1; i >= 0; i--) if (!updateTurret(turrets[i], dt)) turrets.splice(i, 1);
      // the turret under the pointer shows its range ring (League's, on hover), the way to level it up with Q
      const hover = g.cursor && !upgraded ? upgradable(g.cursor, UPGRADES.pick) : null;
      for (const tu of turrets) {
        if ((tu === hover) === !!tu.ring) continue;
        if (tu.ring) { tu.ring.removeFromParent(); tu.ring = null; continue; }
        tu.ring = g.vfx.attach('heimerdinger_turret_ring_BV2');
        tu.ring.position.copy(tu.pos);
        g.scene.add(tu.ring);
      }

      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.speed = Math.min(b.max, Math.max(b.min, b.speed + b.accel * dt));
        const step = Math.min(b.left, b.speed * dt);
        b.pos.addScaledVector(b.dir, step);
        b.left -= step;
        b.fx.root.position.copy(b.pos);
        b.fx.update(dt, b.dir, 0);
        let done = b.left <= 0;
        for (const e of g.enemiesNear(b.pos, b.radius + 100, near)) {
          if (!alive(e) || b.pierce?.has(e) || edge(e, b.pos) > b.radius) continue;
          b.hit(e, b);
          if (!b.pierce) { done = true; break; }
          b.pierce.add(e);
        }
        if (!done) continue;
        b.fx.root.removeFromParent();
        bolts.splice(i, 1);
      }

      for (let i = lobs.length - 1; i >= 0; i--) {
        const b = lobs[i];
        b.age += dt;
        const k = Math.min(1, b.age / b.time);
        b.fx.root.position.lerpVectors(b.from, b.to, k);
        b.fx.root.position.y += b.peak * 4 * k * (1 - k);
        b.fx.update(dt, b.dir, k);
        if (k < 1) continue;
        b.fx.root.removeFromParent();
        lobs.splice(i, 1);
        b.land();
      }

      for (const [e, until] of marks) if (until <= g.time || !alive(e)) marks.delete(e);
      if (g.hp <= 0 && upgraded) { upgraded = false; antenna(false); }
    },

    dispose() {
      for (const tu of turrets) { clearFx(tu); tu.ring?.removeFromParent(); tu.actor?.dispose(); tu.actor?.root.removeFromParent(); }
      for (const b of bolts) b.fx.root.removeFromParent();
      for (const b of lobs) b.fx.root.removeFromParent();
      for (const s of antennaFx) s?.stop();
      ammo?.o.removeFromParent();
      turrets.length = bolts.length = lobs.length = later.length = 0;
      antennaFx = [];
      ammo = null;
      marks.clear();
    },
  };
}
