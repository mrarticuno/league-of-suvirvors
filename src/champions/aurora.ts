// Aurora. Numbers mirror League of Legends V26.19 (sources: the League wiki, the client's aurora.bin spell data and the
// skin bins; the installed client still has the pre-26.19 E damage and R durations, the wiki's patch notes win).
// Adapted for hordes:
// - Mana costs are lower (Q 35, W 50, E 50, R 80) and an enemy killed by an ability or while carrying Spirit
//   Abjuration stacks restores 10-30 mana (by level; 1s cooldown against minions and small monsters, elite and epic
//   kills always restore), like Lux and Ziggs.
// - Across the Veil does not make Aurora invisible: for the invisibility's 1-1.6s her Realm Hopper Move Speed is
//   doubled (40-80%), then it holds at 20-40% until the 4s end. The champion takedown reset is an elite/epic kill.
// - Elite and epic monsters stand in for champions: they free Spirits, take full Twofold Hex recast damage and wear the
//   champion curse (Aurora_Q_Vulnerable_Enemy). Smaller enemies free a Spirit once every 5s (the bin's unused
//   CooldownDuration), so hordes still show them.
// - Realm Hopper's ghosting walks through units, not scenery (ChampionKit.ghosted).
// - The rift's border dash is not untargetable (there is no such state for the champion).
// Not drawn: Aurora_R_Indicator_Circle_Self (the local cast reticle, its portals sit 650 out of a 350 rift),
// Aurora_W_CameraBoundVFX (a screen-space tint of the invisibility, camera-bound meshes are not supported)
// and the FresnelAlpha material of the spirits (they wear their diffuse texture).
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat, type ParticleSystem } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
// League's SkinScale is 0.95 for Aurora and 1.1 for Ezreal; the exports share League's units, so she keeps that ratio
const SCALE = 0.95 / 1.1;
const SPIRIT_SCALE = SCALE * (0.8 / 0.95); // the spirits' SkinScale is 0.8
const WAND = 'WeaponStretch3'; // the bin's cast effects ride the wand tip
const Q_HEIGHT = 150; // AuroraQ: FollowTerrainHeightSolver mHeightOffset
const RETURN_HEIGHT = 125; // AuroraQReturnMissile

const lerpLevel = (level: number, a: number, b: number) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

const PASSIVE = {
  maxStacks: 3, duration: 4, // DebuffDuration
  hpPct: 0.01, hpPctPerAp: 0.00027, // 1% (+2.7% per 100 AP) of max Health
  monsterCapBase: 90, monsterCapPerLevel: 10, // 100-270 against monsters
  spiritDuration: 4, maxSpirits: 4, spiritCooldown: 5, // SpiritModeDuration; CooldownDuration (small enemies only)
  healMin: 10, healMax: 20, healApRatio: 0.02, // per Spirit per second
  manaRestore: [10, 30] as const, manaCooldown: 1,
  maxMarkFx: 40, // particle budget: past this, stacks still count without their ring
};

const SKILLS = {
  Q: {
    name: t('champion.aurora.Q'), desc: t('champion.aurora.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'spell1', icon: `${ICON}/spell/AuroraQ.png`,
    cooldown: [6, 5.75, 5.5, 5.25, 5], cost: [35, 35, 35, 35, 35],
    damage: [45, 70, 95, 120, 145], apRatio: 0.4,
    range: 900, aim: 900, speed: 1600, width: 180, castTime: 0.25, markDuration: 3.5, recastDelay: 0.1,
    returnSpeed: 2000, minionMod: 0.75, monsterMod: 0.5, missingHpBonus: 0.5, repeatMod: 0.2,
  },
  W: {
    name: t('champion.aurora.W'), desc: t('champion.aurora.W.desc'), damageType: 'magic', maxRank: 5, anim: 'spell2', icon: `${ICON}/spell/AuroraW.png`,
    cooldown: [22, 21, 20, 19, 18], cost: [50, 50, 50, 50, 50],
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('stat.ms'), values: [0.2, 0.25, 0.3, 0.35, 0.4], percent: true }, // Realm Hopper (doubled while the invisibility would last)
    aim: 'move', castTime: 0.05, hop: 300, hopTime: 13 / 30, // spell2 lands on frame 13
    hopper: 4, msBonus: [0.2, 0.25, 0.3, 0.35, 0.4], msRank0: 0.15, boost: [1, 1.15, 1.3, 1.45, 1.6], // boost: the invisibility's span
  },
  E: {
    name: t('champion.aurora.E'), desc: t('champion.aurora.E.desc'), damageType: 'magic', maxRank: 5, anim: 'spell3_reblock3', icon: `${ICON}/spell/AuroraE.png`,
    cooldown: [10, 9.5, 9, 8.5, 8], cost: [50, 50, 50, 50, 50],
    damage: [80, 120, 160, 200, 240], apRatio: 0.7,
    range: 825, aim: 825, width: 175, castTime: 0.35, slow: 0.8, slowDuration: 1, recoil: 250,
  },
  R: {
    name: t('champion.aurora.R'), desc: t('champion.aurora.R.desc'), damageType: 'magic', maxRank: 3, anim: 'spell4_e', icon: `${ICON}/spell/AuroraR.png`,
    cooldown: [90, 80, 70], cost: [80, 80, 80],
    damage: [175, 275, 375], apRatio: 0.7, slow: 0.3, slowDuration: 2,
    aim: 700, castTime: 0.05, leap: 250, leapTime: 0.4,
    // AoESize 700 is the rift's radius (castRadius 750 is its indicator; the official clip shows a ring ~7.7x her height
    // across). Its ring meshes are authored ~340 across the radius, so the rift's systems play at radius / fxRadius.
    // The centre is 425 ahead of where she cast from, so she lands inside it. border: the edge's collision band
    ahead: 425, radius: 700, fxRadius: 340, expand: 0.75, border: 40,
    rift: [2.25, 2.75, 3.25], hopper: [3.25, 3.75, 4.25], borderSlow: 0.5, borderSlowDuration: [1.5, 1.75, 2],
    recastAfter: 1, travelTime: 0.4,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
} as const satisfies Record<string, Hit>;

export const AURORA: ChampionDef = {
  id: 'aurora', name: t('champion.aurora.name'), model: 'aurora', icon: `${ICON}/champion/Aurora.png`,
  title: t('champion.aurora.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aurora_0.jpg',
  roles: ['mage', 'assassin'], difficulty: 5,
  scale: SCALE,
  textures: { Weapon: 'aurora_weapon' }, // the skin's materialOverride: the wand has its own texture
  itemPool: 'ap',
  // OP.GG mid 16.21: Luden's Echo, Shadowflame, Rabadon's; then Void Staff, Stormsurge, Banshee's Veil
  build: ['6655', '4645', '3089', '3135', '4646', '3102'],
  base: {
    hp: 607, hpPerLevel: 110,
    hpRegen5: 6, hpRegen5PerLevel: 0.55,
    mana: 475, manaPerLevel: 30,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 53, adPerLevel: 3,
    attackSpeed: 0.668, attackSpeedPerLevel: 0.02,
    attackRange: 550,
    moveSpeed: 335,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 1750,
    radius: 65,
    armor: 23, armorPerLevel: 4.5,
  },
  skills: SKILLS,
  passive: { name: t('champion.aurora.passive'), icon: `${ICON}/passive/AuroraPassive.png` },
  // the animation graph: Idle1 is Idle_Base three times then the two variants; Attack1/Attack2 are attack6/attack8
  // split in parts of the same file, Crit is attack2
  anims: { idle: 'aurora_idle1', run: 'run_new_4', death: 'death', attacks: ['attack6', 'attack8'], crit: 'attack2' },
  sequences: { aurora_idle1: ['idle', 'idle', 'idle', 'idle_var1', 'idle_var3'] },
  vfx: { auto: 'Aurora_BA_mis', crit: 'Aurora_BA_mis', autoHit: 'Aurora_BA_tar', critHit: 'Aurora_BA_tar' },
  animVfx: true, // wand glows, W's jump/land dust and trail, E's and R's wand casts, R's body and beam
  kit: auroraKit,
};

/** One Spirit following Aurora. */
interface Spirit { actor: Actor | null; fx: ParticleSystem[]; slot: number; moving: boolean }
/** A Twofold Hex curse. */
interface Curse { until: number; fx: THREE.Object3D }
/** A curse drawn back to Aurora: hits what it passes through. */
interface Bolt { root: THREE.Object3D; update: (dt: number, dir: THREE.Vector3, travelled: number) => void; dir: THREE.Vector3; travelled: number; rank: number; hit: Set<Enemy> }
/** Between Worlds' rift. */
interface Rift {
  center: THREE.Vector3; rank: number;
  born: number; // run time of the shockwave
  until: number; // run time the rift closes
  hit: Set<Enemy>; // shockwave
  inside: Map<Enemy, boolean>; // enemies near the border: last side, for the once-per-crossing slow
  armed: boolean; // Aurora can jump the border again once she is off its band
  fx: THREE.Object3D; dir: THREE.Vector3; // dir: from the centre to Aurora
}

function auroraKit(g: Game): ChampionKit {
  loadModel('auroraspirits', ['SpiritB', 'SpiritC'], 'auroraspirits').catch(() => {}); // the skin's initialSubmeshToHide
  const near: Enemy[] = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  const elite = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';
  const toward = (point: THREE.Vector3) => {
    const dir = tmp.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize().clone();
  };
  const follow = (key: string, at: THREE.Vector3) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(0);
    g.scene.add(o);
    return o;
  };
  const wandFx = (key: string) => {
    const bone = g.player.bone(WAND);
    if (bone) g.vfx.playOn(key, bone, g.facing, g.player.root);
  };

  // ---- Spirit Abjuration ----
  const stacks = new Map<Enemy, { n: number; until: number; fx: THREE.Object3D | null }>();
  let markFx = 0;
  let manaReady = 0, spiritReady = 0;
  const spirits: Spirit[] = [];
  let spiritsUntil = 0, healTick = 1;

  const dropRing = (s: { fx: THREE.Object3D | null }) => {
    if (!s.fx) return;
    s.fx.removeFromParent();
    s.fx = null;
    markFx--;
  };
  const spiritFx = ['Aurora_P_SpiritBlue', 'Aurora_P_SpiritPurple', 'Aurora_P_SpiritRed'];
  const spiritMesh = ['SpiritA', 'SpiritB', 'SpiritC'];
  const spiritSpot = (slot: number, out: THREE.Vector3) => {
    // behind Aurora in a fan
    const a = g.facing + Math.PI + (slot - 1.5) * 0.6;
    return out.set(g.pos.x + Math.sin(a) * 140, 0, g.pos.z + Math.cos(a) * 140);
  };
  const freeSpirit = () => {
    spiritsUntil = g.time + PASSIVE.spiritDuration; // a new exorcism refreshes every Spirit
    if (spirits.length >= PASSIVE.maxSpirits) return;
    const slot = [0, 1, 2, 3].find((i) => !spirits.some((s) => s.slot === i))!;
    const kind = slot % 3;
    let actor: Actor | null = null;
    try {
      actor = new Actor('auroraspirits', SPIRIT_SCALE);
      for (const m of spiritMesh) actor.showSubmesh(m, m === spiritMesh[kind]);
      actor.conformToPath('Chest', 'Tail2'); // the skin's ConformToPathRigPoseModifierData
      spiritSpot(slot, actor.root.position);
      actor.root.rotation.y = g.facing;
      actor.play('idle2');
      g.scene.add(actor.root);
    } catch { actor = null; } // the model may still be downloading: the Spirit heals without its body
    const fx: ParticleSystem[] = [];
    if (actor) {
      const ear = actor.bone('R_EarA2');
      const at = actor.root.position;
      const q = facingQuat(g.facing);
      const overlay = ear && g.vfx.play('AuroraSpirits_Idle_AS_SpiritOverlay', ear.getWorldPosition(tmp2), q, { bone: ear, owner: actor.root, until: undefined });
      const glow = g.vfx.play(spiritFx[kind], at.clone(), q, { follow: actor.root, owner: actor.root, killOnStop: true });
      if (overlay) fx.push(overlay);
      if (glow) fx.push(glow);
      g.vfx.playAt('Aurora_P_SpiritPoof', at);
    }
    spirits.push({ actor, fx, slot, moving: false });
    audio.play('aurora_P_spirit');
  };
  const dismissSpirits = () => {
    for (const s of spirits) {
      for (const f of s.fx) f.stop();
      if (s.actor) {
        g.vfx.playAt('Aurora_P_SpiritPoof', s.actor.root.position);
        s.actor.dispose();
      }
    }
    if (spirits.length) audio.play('aurora_P_spirit_end');
    spirits.length = 0;
  };

  /** A stack on `e`; the third consumes them for bonus magic damage (returned). */
  const abjure = (e: Enemy) => {
    let s = stacks.get(e);
    if (!s) stacks.set(e, (s = { n: 0, until: 0, fx: null }));
    if (s.until <= g.time) s.n = 0;
    s.n++;
    s.until = g.time + PASSIVE.duration;
    if (s.n < PASSIVE.maxStacks) {
      if (!s.fx && markFx < PASSIVE.maxMarkFx) { s.fx = follow('Aurora_P_ring1', e.pos); markFx++; }
      return 0;
    }
    stacks.delete(e);
    dropRing(s);
    g.vfx.hit('Aurora_P_tar', e.pos.clone().setY(1), 0, { size: boundSize(e) });
    audio.play('aurora_P_debuff');
    if (elite(e) || g.time >= spiritReady) {
      if (!elite(e)) spiritReady = g.time + PASSIVE.spiritCooldown;
      freeSpirit();
    }
    const dmg = (PASSIVE.hpPct + PASSIVE.hpPctPerAp * g.ap) * e.maxHp;
    return e.def.tier === 'minion' ? dmg : Math.min(dmg, PASSIVE.monsterCapBase + PASSIVE.monsterCapPerLevel * g.level);
  };

  const restoreMana = (e: Enemy) => {
    if (!elite(e) && g.time < manaReady) return;
    if (!elite(e)) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, ...PASSIVE.manaRestore));
  };

  // ---- Realm Hopper (W and R) ----
  let hopperUntil = 0, boostUntil = 0, hopperMs = 0;
  const hopper = (seconds: number, ms: number) => {
    hopperMs = g.time < hopperUntil ? Math.max(hopperMs, ms) : ms;
    hopperUntil = Math.max(hopperUntil, g.time + seconds);
  };

  // ---- Twofold Hex ----
  const curses = new Map<Enemy, Curse>();
  const bolts: Bolt[] = [];
  let qRank = 0, qRecastFrom = 0, qAutoAt = 0;
  const uncurse = (e: Enemy) => {
    curses.get(e)?.fx.removeFromParent();
    curses.delete(e);
  };
  const curse = (e: Enemy) => {
    const c = curses.get(e);
    const until = g.time + SKILLS.Q.markDuration;
    if (c) { c.until = until; return; }
    if (!curses.size) qAutoAt = until; // the recast fires itself when the first curse runs out
    curses.set(e, { until, fx: follow(elite(e) ? 'Aurora_Q_Vulnerable_Enemy' : 'Aurora_Q_Vulnerable_Minion', e.pos) });
    audio.play('aurora_Q_mark');
  };
  /** Recast: every curse flies back to Aurora as a bolt. */
  const expunge = () => {
    if (!curses.size) return;
    for (const [e] of curses) {
      const fx = g.vfx.missile('Aurora_Q_misreturn');
      fx.root.position.copy(e.pos).setY(RETURN_HEIGHT);
      g.scene.add(fx.root);
      bolts.push({ ...fx, dir: new THREE.Vector3(), travelled: 0, rank: qRank, hit: new Set() });
      uncurse(e);
    }
    audio.play('aurora_Q_recast');
    audio.play('aurora_Q_return');
    g.gesture('spell1_recast'); // Spell1_Recast: the recast flick and the catch
  };
  const qStruck = new Set<Enemy>(); // enemies hit by a bolt of this recast: later bolts deal 20%
  const boltHit = (e: Enemy, b: Bolt) => {
    const Q = SKILLS.Q;
    const tierMod = elite(e) ? 1 : e.def.tier === 'minion' ? Q.minionMod : Q.monsterMod;
    const missing = 1 - Math.max(0, e.hp) / e.maxHp;
    const repeat = qStruck.has(e) ? Q.repeatMod : 1;
    qStruck.add(e);
    g.vfx.hit('Aurora_Q_tarreturn', e.pos, Math.atan2(b.dir.x, b.dir.z), { size: boundSize(e) });
    g.hurtEnemy(e, (Q.damage[b.rank] + Q.apRatio * g.ap) * tierMod * (1 + Q.missingHpBonus * missing) * repeat, HITS.Q);
  };
  const updateBolts = (dt: number) => {
    const Q = SKILLS.Q;
    const step = Q.returnSpeed * dt;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const hand = g.player.bone('R_Hand')?.getWorldPosition(tmp2) ?? tmp2.copy(g.pos).setY(RETURN_HEIGHT);
      const to = tmp.copy(hand).sub(b.root.position);
      const d = to.length();
      if (d > step && g.alive) {
        b.dir.copy(to).divideScalar(d);
        b.root.position.addScaledVector(b.dir, step);
        b.travelled += step;
        b.update(dt, b.dir, b.travelled);
        for (const e of g.enemiesNear(b.root.position, Q.width / 2, near)) {
          if (e.deadFor >= 0 || b.hit.has(e)) continue;
          if (Math.hypot(e.pos.x - b.root.position.x, e.pos.z - b.root.position.z) > e.def.radius + Q.width / 2) continue;
          b.hit.add(e);
          boltHit(e, b);
        }
        continue;
      }
      b.root.removeFromParent();
      bolts.splice(i, 1);
      if (g.alive) {
        const bone = g.player.bone('R_Hand');
        if (bone) g.vfx.playOn('Aurora_Q_backtar', bone, g.facing, g.player.root);
        audio.play('aurora_Q_return_hit');
      }
      if (!bolts.length) qStruck.clear();
    }
  };

  // ---- Between Worlds ----
  const riftFx = (key: string, at: THREE.Vector3, facing: number, opts?: Parameters<typeof g.vfx.play>[3]) => {
    const sys = g.vfx.play(key, at, facingQuat(facing), opts);
    if (sys) sys.scale = SKILLS.R.radius / SKILLS.R.fxRadius;
  };
  let rift: Rift | null = null;
  let pendingShock: { at: number; rank: number; dir: THREE.Vector3; from: THREE.Vector3 } | null = null;
  let traveling: { until: number; fx: THREE.Object3D } | null = null;
  const closeRift = (recast: boolean) => {
    if (!rift) return;
    rift.fx.removeFromParent();
    if (recast) riftFx('0x36a96cdb', rift.center, 0); // Aurora_Base_R_AoERingRecast, the allied (blue) close
    rift = null;
  };
  const shockwave = (rank: number, dir: THREE.Vector3, from: THREE.Vector3) => {
    const R = SKILLS.R;
    const center = from.clone().addScaledVector(dir, R.ahead).setY(0);
    const facing = Math.atan2(dir.x, dir.z);
    riftFx('Aurora_R_AoERingExpand', center, facing);
    audio.play('aurora_R_buff');
    closeRift(false);
    // the static ring lingers past the rift; removing its anchor stops it emitting and lets it fade out
    const fx = new THREE.Group();
    fx.position.copy(center);
    g.scene.add(fx);
    riftFx('Aurora_R_AoERingStatic', center, facing, { follow: fx, killOnStop: false });
    rift = {
      center, rank, born: g.time, until: g.time + R.expand + R.rift[rank], hit: new Set(), inside: new Map(),
      armed: false, fx, dir: new THREE.Vector3(),
    };
    hopper(R.hopper[rank], g.ranks.W > 0 ? SKILLS.W.msBonus[g.ranks.W - 1] : SKILLS.W.msRank0);
  };
  const updateRift = () => {
    if (pendingShock && g.time >= pendingShock.at) {
      shockwave(pendingShock.rank, pendingShock.dir, pendingShock.from);
      pendingShock = null;
    }
    const z = rift;
    if (!z) return;
    const R = SKILLS.R;
    if (g.time >= z.until || !g.alive) { closeRift(false); return; }
    // the shockwave grows from the centre to the edge over 0.75s
    const grown = Math.min(1, (g.time - z.born) / R.expand) * R.radius;
    for (const e of g.enemiesNear(z.center, R.radius + R.border, near)) {
      if (e.deadFor >= 0) continue;
      const d = Math.hypot(e.pos.x - z.center.x, e.pos.z - z.center.z);
      if (!z.hit.has(e) && d - e.def.radius <= grown) {
        z.hit.add(e);
        g.vfx.hit('Aurora_R_tar', e.pos, 0, { size: boundSize(e) });
        audio.play('aurora_R_hit');
        g.hurtEnemy(e, R.damage[z.rank] + R.apRatio * g.ap, HITS.R);
        if (e.deadFor < 0) g.slow(e, R.slow, R.slowDuration);
      }
      if (grown < R.radius) continue; // the border forms once the shockwave is out
      // crossing the border (either way) slows, once per crossing
      const inside = d < R.radius;
      const was = z.inside.get(e);
      z.inside.set(e, inside);
      if (was === undefined || was === inside) continue;
      g.slow(e, R.borderSlow, R.borderSlowDuration[z.rank]);
      g.vfx.hit('Aurora_R_Pushback_child', e.pos, 0, { size: boundSize(e) }); // the old border knockback's hit, kept for the slow
      audio.play('aurora_R_exit');
    }
    // Aurora on the border: she dashes to the diametrically opposite side
    z.dir.copy(g.pos).sub(z.center).setY(0);
    const dist = z.dir.length();
    if (dist > 0) z.dir.divideScalar(dist);
    if (traveling || g.dashing) return;
    const onBorder = Math.abs(dist - R.radius) <= R.border;
    if (!onBorder) { z.armed = true; return; }
    if (grown < R.radius || !z.armed) return;
    // walking into the border (from either side) jumps her across the rift, landing just inside the far edge
    const exit = z.center.clone().addScaledVector(z.dir, -(R.radius - R.border - 10));
    const across = exit.clone().sub(g.pos).setY(0);
    g.vfx.playAt('Aurora_R_TravelStart', g.pos.clone().setY(0), Math.atan2(across.x, across.z));
    audio.play('aurora_R_teleport');
    const len = across.length();
    g.dash(across, len, len / R.travelTime);
    const fx = g.vfx.attach('Aurora_R_traveler');
    fx.position.copy(g.pos);
    g.scene.add(fx);
    traveling = { until: g.time + R.travelTime, fx };
    z.armed = false;
  };

  const castVfx: Partial<Record<SkillKey, () => void>> = {
    Q: () => wandFx('Aurora_Q_CastWand'), // Spell1 has no particle event (its follow-ups carry the wand glow)
  };

  return {
    hud: () => t('champion.aurora.hud', { n: spirits.length, max: PASSIVE.maxSpirits }),

    moveSpeedBonus() {
      if (g.time >= hopperUntil) return 0;
      return g.time < boostUntil ? hopperMs * 2 : hopperMs;
    },
    ghosted: () => g.time < hopperUntil,

    moveAnims() {
      // the graph's Run: Run_Fast from 410 Move Speed (Realm Hopper), Run_Slow below
      return { idle: 'aurora_idle1', run: g.moveSpeed >= 410 ? 'run_fast_b' : 'run_new_4' };
    },

    attackStart() {
      wandFx('Aurora_BA_Wand');
      return undefined;
    },

    basicAttack(_target, _damage, crit) {
      audio.play(crit ? 'aurora_crit_launch' : 'aurora_auto_launch');
      return false; // the default missile (Aurora_BA_mis) flies
    },

    castStart(key) { castVfx[key]?.(); },

    canCast(key) {
      if (key === 'R') return !traveling;
      return true;
    },

    recast(key) {
      if (key === 'Q' && curses.size && g.time >= qRecastFrom) expunge();
      else if (key === 'R' && rift && g.time >= rift.born + SKILLS.R.recastAfter) {
        closeRift(true);
        audio.play('aurora_R_door');
      }
    },

    cast(key, r, point) {
      const dir = toward(point);
      if (key === 'Q') {
        const Q = SKILLS.Q;
        qRank = r;
        qRecastFrom = g.time + Q.recastDelay;
        // from the wand (mStartBoneName), straight along the cast direction
        const from = (g.player.bone('Buffbone_Glb_Weapon_1')?.getWorldPosition(tmp2) ?? tmp2.copy(g.pos)).setY(0);
        g.spawnMissile('Aurora_Q_backmis', from, from.clone().addScaledVector(dir, Q.range), {
          speed: Q.speed, range: Q.range, radius: Q.width / 2, damage: Q.damage[r] + Q.apRatio * g.ap, hit: HITS.Q,
          height: Q_HEIGHT, pierce: true, hitFx: 'Aurora_Q_tar', hitSound: 'aurora_Q_hit',
          onHit: (e, m) => {
            g.impact(e, m);
            if (e.deadFor < 0) curse(e);
          },
        });
        audio.play('aurora_Q_launch');
      } else if (key === 'W') {
        const W = SKILLS.W;
        g.vfx.playAt('Aurora_W_Portal', g.pos.clone().setY(0), Math.atan2(dir.x, dir.z));
        audio.play('aurora_W_portal');
        g.dash(dir, W.hop, W.hop / W.hopTime);
        const land = g.time + W.hopTime;
        hopper(W.hopper + W.hopTime, W.msBonus[r]);
        boostUntil = land + W.boost[r];
      } else if (key === 'E') {
        const E = SKILLS.E;
        const facing = Math.atan2(dir.x, dir.z);
        g.vfx.playAt('Aurora_E_beam2', g.pos.clone().setY(0), facing);
        audio.play('aurora_E_launch');
        const damage = E.damage[r] + E.apRatio * g.ap;
        const mid = tmp2.copy(g.pos).addScaledVector(dir, E.range / 2);
        let sounded = false;
        for (const e of g.enemiesNear(mid, E.range / 2 + E.width, near)) {
          if (e.deadFor >= 0) continue;
          const rel = tmp.copy(e.pos).sub(g.pos).setY(0);
          const along = rel.dot(dir);
          if (along < -e.def.radius || along > E.range + e.def.radius) continue;
          if (Math.abs(rel.x * dir.z - rel.z * dir.x) > E.width / 2 + e.def.radius) continue;
          g.vfx.hit(elite(e) ? 'Aurora_E_tar' : 'Aurora_E_tarPT', e.pos, facing, { size: boundSize(e) });
          if (!sounded) { audio.play('aurora_E_hit'); sounded = true; }
          g.hurtEnemy(e, damage, HITS.E);
          if (e.deadFor < 0) g.slow(e, E.slow, E.slowDuration, true);
        }
        // recoil: she hops back 250 at 150 + 200% of her Move Speed
        g.dash(dir.clone().negate(), E.recoil, 150 + 2 * g.moveSpeed);
      } else {
        const R = SKILLS.R;
        g.dash(dir, R.leap, R.leap / R.leapTime);
        pendingShock = { at: g.time + R.leapTime, rank: r, dir, from: g.pos.clone() };
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'item') return 0; // item burns are not attacks nor abilities
      return abjure(e);
    },

    onKill(e, hit) {
      if (hit.source === 'ability' || stacks.has(e) || curses.has(e)) restoreMana(e);
      if (elite(e)) g.cooldowns.W = 0; // Across the Veil's takedown reset
    },

    update(dt) {
      // stacks and curses
      for (const [e, s] of stacks) {
        if (e.deadFor >= 0 || s.until <= g.time) { dropRing(s); stacks.delete(e); }
        else s.fx?.position.copy(e.pos).setY(0);
      }
      for (const [e, c] of curses) {
        if (e.deadFor >= 0) uncurse(e);
        else c.fx.position.copy(e.pos).setY(0);
      }
      if (curses.size && g.time >= qAutoAt) expunge();
      updateBolts(dt);

      // spirits
      if (spirits.length && (g.time >= spiritsUntil || !g.alive)) dismissSpirits();
      if (spirits.length && (healTick -= dt) <= 0) {
        healTick += 1;
        g.heal(spirits.length * (lerpLevel(g.level, PASSIVE.healMin, PASSIVE.healMax) + PASSIVE.healApRatio * g.ap));
      } else if (!spirits.length) healTick = 1;
      for (const s of spirits) {
        const a = s.actor;
        if (!a) continue;
        const goal = spiritSpot(s.slot, tmp);
        const off = goal.sub(a.root.position).setY(0);
        const d = off.length();
        const moving = d > 30;
        if (moving) {
          a.root.position.addScaledVector(off.normalize(), Math.min(d, Math.max(g.moveSpeed, d * 3) * dt));
          a.root.rotation.y = Math.atan2(off.x, off.z);
        }
        if (moving !== s.moving) { s.moving = moving; a.play(moving ? 'walk7' : 'idle2'); }
        a.update(dt);
      }

      updateRift();
      if (traveling && g.time >= traveling.until && !g.dashing) {
        traveling.fx.removeFromParent();
        g.vfx.playAt('Aurora_R_TravelEnd', g.pos.clone().setY(0), g.facing);
        traveling = null;
      } else if (traveling) traveling.fx.position.copy(g.pos);
    },

    dispose() {
      for (const s of stacks.values()) dropRing(s);
      stacks.clear();
      for (const e of [...curses.keys()]) uncurse(e);
      for (const b of bolts) b.root.removeFromParent();
      bolts.length = 0;
      dismissSpirits();
      closeRift(false);
      traveling?.fx.removeFromParent();
      traveling = null;
      pendingShock = null;
    },
  };
}
