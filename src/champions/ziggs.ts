// Ziggs. Numbers mirror League of Legends: the installed client's spell bins (DataValues, cooldowns, costs, missile
// specs) and the LoL Wiki for what the bins leave to scripts. Every bomb is lobbed like the bins' GravityHeightSolver
// missiles: the arc peak is gravity * time² / 8 (Bouncing Bomb 7000/5000/3000, Satchel 5000, Minefield 4000/3000,
// Mega Inferno Bomb 4000 within 2700 units, then 2500/1300/650).
// Short Fuse: every 12s the next basic attack throws a bigger bomb for bonus magic damage; casting an ability takes
// 4/5/6s (levels 1/7/13) off that cooldown at the start of the cast.
// Adapted for hordes: mana costs are lower (Q 30-40, W 55, E 50-75, R 80, the same cuts as Brand) and an enemy killed
// by an ability restores 10-30 mana (by level; 1s cooldown against minions and small monsters, elite and epic kills
// always restore), like Lux. Satchel Charge's recast uses ChampionKit.recast: pressing W while it is on cooldown
// detonates the charge (on landing when it is still flying). Hexplosive Minefield's inner ring radius is in neither the
// bin nor the wiki (the outer 8 mines sit 200 out): 100 is an estimate. The bins' thresholds between Mega Inferno
// Bomb's Medium/Long/ExtraLong missiles are script-side too: the 2700-5000 span is split in thirds.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const HAND = 'R_BUFFBONE_GLB_HAND_LOC';
const THROW_HEIGHT = 110; // missiles leave the hand at Game.spawnMissile's default height
const LAND_HEIGHT = 60; // the bins' mTargetHeightAugment: bombs come down onto a point 60 above the ground
const SATCHEL_HEIGHT = 100; // Satchel Charge's systems are authored ~90-100 above their origin (satchel, rings at y -90/-100)
const peak = (gravity: number, time: number) => (gravity * time * time) / 8;

const PASSIVE = {
  cooldown: 12, // static: ability haste does not shorten it
  // bonus magic damage: 20 at level 1, +4 per level, +8 from level 7, +12 from level 13 (160 at 18) + 50% AP
  damage: 20, perLevel: [4, 8, 12], breakpoints: [7, 13], apRatio: 0.5,
  refund: [4, 5, 6], // seconds off the cooldown per ability cast (levels 1/7/13)
  speed: 1500, gravity: 5000, // ZiggsPassiveAttack / ZiggsBasicAttack missile
  manaRestore: [10, 30], manaCooldown: 1, // adapted: ability kills restore mana
};

const SKILLS = {
  Q: {
    name: t('champion.ziggs.Q'), desc: t('champion.ziggs.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'ziggs_spell1', icon: `${ICON}/spell/ZiggsQ.png`,
    cooldown: [6, 5.5, 5, 4.5, 4], cost: [30, 30, 35, 35, 40],
    damage: [80, 130, 180, 230, 280], apRatio: [0.6, 0.65, 0.7, 0.75, 0.8],
    range: 850, aim: 850, castTime: 0.25,
    throwSpeed: 1700, throwGravity: 7000, // ZiggsQSpell
    bounces: [325, 225], bounceTime: 0.48, bounceGravity: [5000, 3000], // ZiggsQSpell2/3, bounce lengths at max range
    trigger: 180, radius: 240, maxHitFx: 30,
  },
  W: {
    name: t('champion.ziggs.W'), desc: t('champion.ziggs.W.desc'), damageType: 'magic', maxRank: 5, anim: 'ziggs_spell2', icon: `${ICON}/spell/ZiggsW.png`,
    cooldown: [20, 18, 16, 14, 12], cost: [55, 55, 55, 55, 55],
    damage: [70, 105, 140, 175, 210], apRatio: 0.5,
    range: 1000, aim: 1000, castTime: 0.25, speed: 1750, gravity: 5000, duration: 4,
    radius: 325, knockback: 500, selfKnockback: 775, knockbackTime: 0.5, selfJump: 200, // jump peak: visual only
    maxHitFx: 30,
  },
  E: {
    name: t('champion.ziggs.E'), desc: t('champion.ziggs.E.desc'), damageType: 'magic', maxRank: 5, anim: 'ziggs_spell3', icon: `${ICON}/spell/ZiggsE.png`,
    cooldown: [16, 16, 16, 16, 16], cost: [50, 55, 65, 70, 75],
    damage: [30, 70, 110, 150, 190], apRatio: [0.25, 0.3, 0.35, 0.4, 0.45],
    slow: [0.1, 0.2, 0.3, 0.4, 0.5], slowDuration: 1.5, subsequent: 0.4,
    extra: { label: t('champion.ziggs.slow'), values: [0.1, 0.2, 0.3, 0.4, 0.5], percent: true },
    range: 900, aim: 900, castTime: 0.25, speed: 1550, gravity: 4000, // ZiggsE2: the cluster
    scatterTime: 0.3, scatterGravity: 3000, // ZiggsE3: each mine
    inner: 3, innerRadius: 100, outer: 8, outerRadius: 200, arm: 0.5, life: 10, trigger: 135,
  },
  R: {
    name: t('champion.ziggs.R'), desc: t('champion.ziggs.R.desc'), damageType: 'magic', maxRank: 3, anim: 'ziggs_spell4', icon: `${ICON}/spell/ZiggsR.png`,
    cooldown: [120, 95, 70], cost: [80, 80, 80],
    damage: [300, 500, 700], apRatio: 1, outer: 0.65,
    range: 5000, aim: 5000, castTime: 0.375,
    fixedRange: 2700, fixedTime: 1.2, fixedGravity: 4000, speed: 2250, gravities: [2500, 1300, 650],
    indicatorLead: 0.65, // ZiggsRTimer's travel time: the closing indicator shows up this long before the blast
    radius: 525, epicenter: 250, maxHitFx: 30,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  fuse: { type: 'magic', source: 'item' }, // Short Fuse's bonus rides the basic attack, which applies the on-hit effects
} as const satisfies Record<string, Hit>;

export const ZIGGS: ChampionDef = {
  id: 'ziggs', name: t('champion.ziggs.name'), model: 'ziggs', icon: `${ICON}/champion/Ziggs.png`,
  scale: 1.45, // Brand's: the exports share League's units (Ziggs ~110 tall, Brand ~125), so they keep the game's proportion
  title: t('champion.ziggs.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ziggs_0.jpg',
  roles: ['mage'], difficulty: 4,
  itemPool: 'ap',
  // OP.GG 16.21: Luden's Echo, Shadowflame, Rabadon's; then Void Staff, Banshee's Veil, Horizon Focus (Zhonya's has an active)
  build: ['6655', '4645', '3089', '3135', '3102', '4628'],
  base: {
    hp: 606, hpPerLevel: 106,
    hpRegen5: 6.5, hpRegen5PerLevel: 0.6,
    mana: 480, manaPerLevel: 23.5,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 55, adPerLevel: 3.1,
    attackSpeed: 0.656, attackSpeedPerLevel: 0.02,
    attackRange: 550,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: 0.2,
    missileSpeed: PASSIVE.speed,
    radius: 55,
    armor: 21, armorPerLevel: 4.7,
  },
  skills: SKILLS,
  passive: { name: t('champion.ziggs.passive'), icon: `${ICON}/passive/ZiggsPassiveReady.png` },
  anims: {
    idle: 'ziggs_idle1', run: 'ziggs_run', death: 'ziggs_death',
    attacks: ['ziggs_attack1', 'ziggs_attack2'], crit: 'ziggs_crit',
  },
  // ZiggsBasicAttack / ZiggsCritAttack (the kit fires them lobbed, see basicAttack)
  vfx: { auto: 'Ziggs_BA_mis', crit: 'Ziggs_BA_mis', autoHit: 'Ziggs_BA_tar', critHit: 'Ziggs_BA_crit_tar' },
  // the skin's idleParticlesEffects: the fuses of the bomb on his back spark and smoke
  idleVfx: [
    ['Ziggs_Z_BombSparks', 'BUFFBONE_CSTM_WICKR'],
    ['Ziggs_Z_BombSparks', 'BUFFBONE_CSTM_WICKL'],
    ['Ziggs_Z_BombSparks', 'BUFFBONE_CSTM_WICKB'],
    ['Ziggs_Z_BombSmoke', 'BUFFBONE_CSTM_WICKB'],
  ],
  animVfx: true, // the death clip lights the fuse (Ziggs_DeathSmoke) and blows the bomb up at its end (Ziggs_Death)
  kit: ziggsKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;
/** Short Fuse's bonus damage before AP (ByCharLevelBreakpoints of the bin). */
export function fuseDamage(level: number) {
  const P = PASSIVE;
  let d = P.damage;
  for (let l = 2; l <= Math.min(level, 18); l++) d += l >= P.breakpoints[1] ? P.perLevel[2] : l >= P.breakpoints[0] ? P.perLevel[1] : P.perLevel[0];
  return d;
}
const tier = (level: number) => (level >= PASSIVE.breakpoints[1] ? 2 : level >= PASSIVE.breakpoints[0] ? 1 : 0);

/** A bomb in the air: straight line on the ground plus a parabola, `land` when it comes down. */
interface Lob {
  fx: MissileFx;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dir: THREE.Vector3;
  age: number;
  time: number;
  peak: number;
  land: () => void;
}

interface Satchel { at: THREE.Vector3; rank: number; flying: boolean; detonate: boolean; until: number; fx: THREE.Object3D[]; tick?: () => void }
interface Mine { at: THREE.Vector3; rank: number; armAt: number; until: number; cast: Set<Enemy>; fx: THREE.Object3D | null }

function ziggsKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const lobs: Lob[] = [];
  const mines: Mine[] = [];
  const fields: { fx: THREE.Object3D; mines: Mine[] }[] = []; // a Minefield's area glow, gone with its last mine
  const pending: { at: number; run: () => void }[] = [];
  let satchel: Satchel | null = null;
  let fuseReady = 0; // run time Short Fuse is ready again (ready at the start)
  let fuseFx: ParticleSystem | null = null;
  let manaReady = 0;

  const ap = () => g.ap;
  const ratio = (s: { apRatio: number | readonly number[] }, r: number) => (typeof s.apRatio === 'number' ? s.apRatio : s.apRatio[r]);
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) =>
    e.deadFor < 0 && Math.hypot(e.pos.x - from.x, e.pos.z - from.z) - e.def.radius <= r;
  /** Ground point toward `point`, clamped to `range`, and its distance. */
  const aimAt = (point: THREE.Vector3, range: number) => {
    const off = flat.copy(point).sub(g.pos).setY(0);
    if (off.lengthSq() < 1) off.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    if (off.length() > range) off.setLength(range);
    return g.pos.clone().add(off).setY(0);
  };
  const ground = (p: THREE.Vector3, y = 0) => p.clone().setY(y);
  const follow = (key: string, at: THREE.Vector3) => {
    const o = g.vfx.attach(key);
    o.position.copy(at);
    g.scene.add(o);
    return o;
  };

  const lob = (key: string, from: THREE.Vector3, to: THREE.Vector3, time: number, gravity: number, land: () => void) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(from);
    g.scene.add(fx.root);
    const dir = to.clone().sub(from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    lobs.push({ fx, from: from.clone(), to: to.clone(), dir: dir.normalize(), age: 0, time: Math.max(time, 0.05), peak: peak(gravity, time), land });
  };

  /** Damage to every enemy within `radius` of `at`, with an impact on each (capped per cast). */
  const blast = (at: THREE.Vector3, radius: number, damage: (e: Enemy) => number, hit: Hit, hitFx: string, maxFx: number, each?: (e: Enemy) => void) => {
    let fx = 0;
    for (const e of g.enemiesNear(at, radius, near)) {
      if (!inReach(e, at, radius)) continue;
      if (fx++ < maxFx) g.vfx.hit(hitFx, e.pos, 0, { size: boundSize(e) });
      each?.(e);
      g.hurtEnemy(e, damage(e), hit);
    }
  };

  // ---- Q: Bouncing Bomb ----
  const bounce = (at: THREE.Vector3, dir: THREE.Vector3, rank: number, scale: number, stage: number) => {
    const Q = SKILLS.Q;
    const last = stage >= Q.bounces.length;
    if (!last && !g.nearestEnemy(at, Q.trigger + 300, (e) => inReach(e, at, Q.trigger))) {
      g.vfx.playAt('Ziggs_Q_bounce_01', ground(at), Math.atan2(dir.x, dir.z));
      audio.playAt('ziggs_Q_bounce', at, g.pos);
      const to = at.clone().addScaledVector(dir, Q.bounces[stage] * scale);
      lob(stage === 0 ? 'Ziggs_Q_mis_02' : 'Ziggs_Q_mis_03', at, to, Q.bounceTime, Q.bounceGravity[stage], () => bounce(to, dir, rank, scale, stage + 1));
      return;
    }
    g.vfx.playAt('Ziggs_Q_explosion', ground(at));
    audio.playAt('ziggs_Q_hit', at, g.pos);
    const damage = Q.damage[rank] + ratio(Q, rank) * ap();
    blast(at, Q.radius, () => damage, HITS.Q, 'Ziggs_Q_tar', Q.maxHitFx);
  };

  // ---- W: Satchel Charge ----
  const detonate = (s: Satchel) => {
    const W = SKILLS.W;
    if (satchel === s) satchel = null;
    for (const o of s.fx) o.removeFromParent();
    s.tick?.(); // the countdown sound runs past 4s: cut it like Play_sfx_Ziggs_ZiggsW_hit_stop
    const at = s.at;
    g.vfx.playAt('Ziggs_W_tar', ground(at, SATCHEL_HEIGHT));
    audio.playAt('ziggs_W_hit', at, g.pos);
    const push = new THREE.Vector3();
    blast(at, W.radius, () => W.damage[s.rank] + W.apRatio * ap(), HITS.W, 'Ziggs_W_hit', W.maxHitFx, (e) => {
      // thrown out to 500 from the center (straight up when right on top of it)
      push.copy(e.pos).sub(at).setY(0);
      const d = push.length();
      push.setLength(d > 1 ? Math.max(0, W.knockback - d) : 0);
      g.knockBack(e, push, W.knockbackTime);
    });
    // Ziggs inside the blast jumps out to 775 from the center
    const off = flat.copy(g.pos).sub(at).setY(0);
    const d = off.length();
    if (d - g.champ.base.radius <= W.radius && d > 1 && g.stunned <= 0) {
      const dist = Math.max(0, W.selfKnockback - d);
      g.dash(off, dist, dist / W.knockbackTime, W.selfJump);
    }
  };

  // ---- E: Hexplosive Minefield ----
  const mineHit = (m: Mine) => {
    const E = SKILLS.E;
    m.fx?.removeFromParent();
    m.fx = null;
    g.vfx.playAt('Ziggs_E_mine', ground(m.at));
    audio.playAt('ziggs_E_hit', m.at, g.pos);
    const full = E.damage[m.rank] + ratio(E, m.rank) * ap();
    for (const e of g.enemiesNear(m.at, E.trigger, near)) {
      if (!inReach(e, m.at, E.trigger)) continue;
      const first = !m.cast.has(e); // later mines of the same cast deal 40%
      m.cast.add(e);
      g.slow(e, E.slow[m.rank], E.slowDuration);
      g.hurtEnemy(e, first ? full : full * E.subsequent, HITS.E);
    }
  };
  const scatter = (center: THREE.Vector3, rank: number) => {
    const E = SKILLS.E;
    g.vfx.playAt('Ziggs_E_mineScatter', ground(center));
    audio.playAt('ziggs_E_land', center, g.pos);
    const cast = new Set<Enemy>();
    const field = { fx: follow('Ziggs_E_aoe_green', ground(center)), mines: [] as Mine[] };
    fields.push(field);
    const rings = [[E.inner, E.innerRadius], [E.outer, E.outerRadius]] as const;
    for (const [n, radius] of rings) {
      const start = Math.random() * Math.PI * 2; // random turn each cast, mines equally spaced
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * Math.PI * 2;
        const at = new THREE.Vector3(center.x + Math.sin(a) * radius, 0, center.z + Math.cos(a) * radius);
        lob('Ziggs_E_mis_small', ground(center, LAND_HEIGHT), ground(at, LAND_HEIGHT), E.scatterTime, E.scatterGravity, () => {
          g.vfx.playAt('Ziggs_E_mis_groundhit', at);
          const m: Mine = { at, rank, armAt: g.time + E.arm, until: g.time + E.life, cast, fx: follow('Ziggs_E_placedMine', at) };
          mines.push(m);
          field.mines.push(m);
        });
      }
    }
  };

  // ---- R: Mega Inferno Bomb ----
  const megaBlast = (at: THREE.Vector3, rank: number, zone: THREE.Object3D) => {
    const R = SKILLS.R;
    zone.removeFromParent();
    g.vfx.playAt('Ziggs_R_explosion', at);
    audio.playAt('ziggs_R_hit', at, g.pos);
    const damage = R.damage[rank] + R.apRatio * ap();
    blast(at, R.radius, (e) => (inReach(e, at, R.epicenter) ? damage : damage * R.outer), HITS.R, 'Ziggs_R_tar', R.maxHitFx);
  };

  // ---- Short Fuse ----
  const fuseIsReady = () => g.time >= fuseReady;
  const restoreMana = (e: Enemy) => {
    const big = e.def.tier === 'elite' || e.def.tier === 'epic';
    if (!big && g.time < manaReady) return;
    if (!big) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.manaRestore));
  };
  const arc = (target: Enemy) => peak(PASSIVE.gravity, Math.hypot(target.pos.x - g.pos.x, target.pos.z - g.pos.z) / PASSIVE.speed);

  return {
    gauge() {
      const left = Math.max(0, fuseReady - g.time);
      return { label: left > 0 ? String(Math.ceil(left)) : '', fill: 1 - left / PASSIVE.cooldown, ready: left === 0 };
    },

    castStart() {
      fuseReady -= PASSIVE.refund[tier(g.level)];
    },

    attackStart() {
      return fuseIsReady() ? { sound: 'ziggs_P_auto' } : undefined;
    },

    basicAttack(target, damage, crit, bolt) {
      const fuse = fuseIsReady() && !bolt;
      if (fuse) {
        fuseReady = g.time + PASSIVE.cooldown;
        fuseFx?.stop();
        fuseFx = null;
      }
      const bonus = fuseDamage(g.level) + PASSIVE.apRatio * ap();
      g.spawnMissile(fuse ? 'Ziggs_P_mis' : 'Ziggs_BA_mis', g.pos, target.pos, {
        speed: PASSIVE.speed, range: 3000, radius: 10, damage, target, arc: arc(target),
        hit: { type: 'physical', source: 'auto', onHit: true, crit, bolt },
        hitFx: fuse ? 'Ziggs_P_tar' : crit ? 'Ziggs_BA_crit_tar' : 'Ziggs_BA_tar',
        hitSound: fuse ? 'ziggs_P_hit' : crit ? 'ziggs_crit_hit' : 'ziggs_auto_hit',
        onHit: fuse ? (e, m) => { g.impact(e, m); g.hurtEnemy(e, bonus, HITS.fuse); } : undefined,
      });
      return true;
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        const to = aimAt(point, Q.range);
        const d = Math.hypot(to.x - g.pos.x, to.z - g.pos.z);
        const dir = to.clone().sub(g.pos).setY(0).normalize();
        lob('Ziggs_Q_mis_01', ground(g.pos, THROW_HEIGHT), ground(to, LAND_HEIGHT), d / Q.throwSpeed, Q.throwGravity,
          () => bounce(ground(to, LAND_HEIGHT), dir, r, d / Q.range, 0));
        audio.play('ziggs_Q_launch');
      } else if (key === 'W') {
        const W = SKILLS.W;
        const to = aimAt(point, W.range);
        const d = Math.hypot(to.x - g.pos.x, to.z - g.pos.z);
        const s: Satchel = { at: to, rank: r, flying: true, detonate: false, until: Infinity, fx: [] };
        if (satchel && !satchel.flying) detonate(satchel); // only one charge at a time (enough haste outpaces its 4s)
        else if (satchel) satchel.detonate = true;
        satchel = s;
        lob('Ziggs_W_mis', ground(g.pos, SATCHEL_HEIGHT), ground(to, SATCHEL_HEIGHT), d / W.speed, W.gravity, () => {
          s.flying = false;
          if (s.detonate) return detonate(s);
          s.until = g.time + W.duration;
          s.fx = [follow('Ziggs_W_Countdown', ground(to, SATCHEL_HEIGHT)), follow('Ziggs_W_AOE_Green', ground(to, SATCHEL_HEIGHT))];
          s.tick = audio.playAt('ziggs_W_land', to, g.pos);
        });
        audio.play('ziggs_W_launch');
      } else if (key === 'E') {
        const E = SKILLS.E;
        const to = aimAt(point, E.range);
        const d = Math.hypot(to.x - g.pos.x, to.z - g.pos.z);
        lob('Ziggs_E_Mis_Cluster', ground(g.pos, THROW_HEIGHT), ground(to, LAND_HEIGHT), d / E.speed, E.gravity, () => scatter(to, r));
        audio.play('ziggs_E_launch');
      } else {
        const R = SKILLS.R;
        const to = aimAt(point, R.range);
        const d = Math.hypot(to.x - g.pos.x, to.z - g.pos.z);
        const band = Math.min(2, Math.floor(((d - R.fixedRange) / (R.range - R.fixedRange)) * 3));
        const time = d <= R.fixedRange ? R.fixedTime : d / R.speed;
        const zone = follow('Ziggs_R_landingZone_green', to);
        pending.push({ at: g.time + Math.max(0, time - R.indicatorLead), run: () => g.vfx.playAt('Ziggs_R_flames_green', to) });
        lob('Ziggs_R_mis', ground(g.pos, THROW_HEIGHT), ground(to, LAND_HEIGHT), time, d <= R.fixedRange ? R.fixedGravity : R.gravities[band],
          () => megaBlast(to, r, zone));
        audio.play('ziggs_R_launch');
        audio.playAt('ziggs_R_fall', to, g.pos);
      }
    },

    recast(key) {
      if (key !== 'W' || !satchel) return;
      if (satchel.flying) satchel.detonate = true;
      else detonate(satchel);
    },

    onKill(e, hit) {
      if (hit.source === 'ability') restoreMana(e);
    },

    update(dt) {
      // Short Fuse ready: the bomb in his hand glows until the empowered attack throws it
      if (fuseIsReady() && !fuseFx && g.hp > 0) {
        const bone = g.player.bone(HAND);
        if (bone) {
          fuseFx = g.vfx.play('Ziggs_P_buf', bone.getWorldPosition(new THREE.Vector3()), new THREE.Quaternion(), { bone, owner: g.player.root, until: undefined }) ?? null;
          audio.play('ziggs_P_ready');
        }
      }

      for (let i = pending.length - 1; i >= 0; i--) {
        if (g.time < pending[i].at) continue;
        pending[i].run();
        pending.splice(i, 1);
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

      if (satchel && !satchel.flying && g.time >= satchel.until) detonate(satchel);

      const E = SKILLS.E;
      for (let i = mines.length - 1; i >= 0; i--) {
        const m = mines[i];
        if (g.time >= m.until) {
          m.fx?.removeFromParent();
          mines.splice(i, 1);
        } else if (g.time >= m.armAt && g.nearestEnemy(m.at, E.trigger + 300, (e) => inReach(e, m.at, E.trigger))) {
          mineHit(m);
          mines.splice(i, 1);
        }
      }
      for (let i = fields.length - 1; i >= 0; i--) {
        if (fields[i].mines.some((m) => m.fx)) continue;
        if (fields[i].mines.length < E.inner + E.outer) continue; // mines still landing
        fields[i].fx.removeFromParent();
        fields.splice(i, 1);
      }
    },

    dispose() {
      for (const b of lobs) b.fx.root.removeFromParent();
      for (const m of mines) m.fx?.removeFromParent();
      for (const f of fields) f.fx.removeFromParent();
      for (const o of satchel?.fx ?? []) o.removeFromParent();
      satchel?.tick?.();
      fuseFx?.stop();
      lobs.length = mines.length = fields.length = pending.length = 0;
      satchel = null;
      fuseFx = null;
    },
  };
}
