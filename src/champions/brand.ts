// Brand. Numbers mirror League of Legends (source: Meraki Analytics champion JSON and the skin bins).
// Adapted for hordes: mana costs are lower (Q 40, W/E 45-65, R 80; the kit lives on its mana) and the mana Blaze
// restores on kills has a 1s cooldown against minions and small monsters (elite and epic kills always restore).
// Ablaze adds a flat part to its 2% max Health burn and ticks every 0.5s; the detonation works on any enemy (not only
// large monsters) and adds a flat part too. Pyroclasm never bounces back to Brand (it re-hits its target instead).
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const HAND = 'R_BUFFBONE_GLB_HAND_LOC';
const DEATH_BONE = 'C_BUFFBONE_GLB_LAYOUT_LOC';
const MARKS = ['', 'Brand_P_FireMark', 'Brand_P_FireMark2', 'Brand_P_FireMark3']; // one system per Ablaze stack count
const CAST_VFX: Partial<Record<SkillKey, string>> = { W: 'Brand_W_POF_cas', E: 'Brand_E_Conflagration_cas', R: 'Brand_R_Wildfire_cas' };

const PASSIVE = {
  maxStacks: 3, duration: 4, tick: 0.5,
  // burn per stack over its 4s: % of max Health (capped like LoL's per-tick monster caps) + flat by level + AP ratio
  burnPct: 0.02, burnCap: 160, burnCapEpic: 320, burnFlat: [8, 48], burnApRatio: 0.05,
  // detonation 2s after the 3rd stack: % of max Health (+2% per 100 AP, capped by level) + flat by level
  primeTime: 2, radius: 475, lockout: 4,
  detonatePct: [0.08, 0.12], detonatePctPerAp: 0.0002, detonateCap: [270, 525], detonateFlat: [30, 150], detonateApRatio: 0.2,
  manaRestore: [20, 40], manaCooldown: 1,
  maxMarkFx: 40, maxRings: 12, // particle budget: past these, enemies still burn and detonate without their own marks
};

const SKILLS = {
  Q: {
    name: t('champion.brand.Q'), desc: t('champion.brand.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'brand_spell1', icon: `${ICON}/spell/BrandQ.png`,
    cooldown: [8, 7.5, 7, 6.5, 6], cost: [40, 40, 40, 40, 40],
    damage: [70, 100, 130, 160, 190], apRatio: 0.65, stun: 1.5,
    range: 1100, aim: 1100, speed: 1600, width: 120, castTime: 0.25,
  },
  W: {
    name: t('champion.brand.W'), desc: t('champion.brand.W.desc'), damageType: 'magic', maxRank: 5, anim: 'brand_spell2', icon: `${ICON}/spell/BrandW.png`,
    cooldown: [10, 9.5, 9, 8.5, 8], cost: [45, 50, 55, 60, 65],
    damage: [75, 120, 165, 210, 255], apRatio: 0.6, ablazeBonus: 0.25,
    range: 900, aim: 900, radius: 260, delay: 0.627, castTime: 0.25,
  },
  E: {
    name: t('champion.brand.E'), desc: t('champion.brand.E.desc'), damageType: 'magic', maxRank: 5, anim: 'brand_spell3', icon: `${ICON}/spell/BrandE.png`,
    cooldown: [13, 12, 11, 10, 9], cost: [45, 50, 55, 60, 65],
    damage: [55, 80, 105, 130, 155], apRatio: 0.6,
    range: 675, aim: 675, spread: 300, spreadAblaze: 600, speed: 1800, maxMissiles: 8, castTime: 0.25,
  },
  R: {
    name: t('champion.brand.R'), desc: t('champion.brand.R.desc'), damageType: 'magic', hits: 5, maxRank: 3, anim: 'brand_spell4', icon: `${ICON}/spell/BrandR.png`,
    cooldown: [110, 100, 90], cost: [80, 80, 80],
    damage: [100, 175, 250], apRatio: 0.25, slow: [0.3, 0.45, 0.6], slowDuration: 0.25,
    range: 750, aim: 750, bounceRange: 600, speed: 1500, castTime: 0.25,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  blaze: { type: 'magic', source: 'item' }, // burn ticks and the detonation apply their stacks themselves
} as const satisfies Record<string, Hit>;

export const BRAND: ChampionDef = {
  id: 'brand', name: t('champion.brand.name'), model: 'brand', icon: `${ICON}/champion/Brand.png`,
  scale: 1.45, // the export stands ~125 tall, Ezreal ~183
  title: t('champion.brand.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Brand_0.jpg',
  roles: ['mage', 'support'], difficulty: 4,
  itemPool: 'ap',
  // OP.GG mid 16.21: Blackfire Torch, Rylai's, Liandry's; then Shadowflame, Rabadon's, Void Staff (Zhonya's has an active)
  build: ['2503', '3116', '6653', '4645', '3089', '3135'],
  base: {
    hp: 570, hpPerLevel: 105,
    hpRegen5: 5.5, hpRegen5PerLevel: 0.55,
    mana: 469, manaPerLevel: 21,
    manaRegen5: 9, manaRegen5PerLevel: 0.6,
    ad: 57, adPerLevel: 3,
    attackSpeed: 0.681, attackSpeedPerLevel: 0.02,
    attackRange: 550,
    moveSpeed: 340,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 2000,
    radius: 65,
    armor: 27, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.brand.passive'), icon: `${ICON}/passive/BrandP.png` },
  anims: {
    idle: 'brand_idle1', run: 'brand_run', death: 'brand_death',
    attacks: ['brand_attack1', 'brand_attack2'], crit: 'brand_crit',
  },
  vfx: {
    auto: 'Brand_BasicAttack_mis', crit: 'Brand_CritAttack_mis', autoHit: 'Brand_BasicAttack_tar', critHit: 'Brand_CritAttack_tar',
    death: [['Brand_Death', DEATH_BONE], ['Brand_DeathFlame', DEATH_BONE]],
  },
  // the skin's idleParticlesEffects: Brand's hair, hands and body are made of fire
  idleVfx: [
    ['Brand_I_Fire_Hair', 'BUFFBONE_CSTM_HAIR'],
    ['Brand_I_Fire_Hand', 'BUFFBONE_CSTM_HANDFLAME1'],
    ['Brand_I_Fire_Hand_extension', 'BUFFBONE_CSTM_HANDFLAME2'],
    ['Brand_I_Fire_Hand_extension', 'BUFFBONE_CSTM_HANDFLAME3'],
    ['Brand_I_Fire_Hand', 'BUFFBONE_CSTM_HANDFLAME4'],
    ['Brand_I_Fire_Hand_extension', 'BUFFBONE_CSTM_HANDFLAME5'],
    ['Brand_I_Fire_Hand_extension', 'BUFFBONE_CSTM_HANDFLAME6'],
    ['Brand_I_Avatar_01', 'C_BUFFBONE_GLB_CENTER_LOC'],
  ],
  kit: brandKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

/** Ablaze on one enemy. Kept past the burn while its detonation lockout or pending explosion lasts. */
interface Burn {
  stacks: number;
  ticks: number; // burn ticks left (counted, not timed: float drift would drop the last one)
  tick: number; // seconds to the next burn tick
  lockUntil: number; // after a detonation it can only hold 1 stack until then
  primedAt: number; // run time the 3rd stack primed the detonation, -1 when not primed
  at: THREE.Vector3; // where it explodes (follows the enemy while alive)
  mark: THREE.Object3D | null;
  markLevel: number;
  ring: THREE.Object3D[];
}

function brandKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const burns = new Map<Enemy, Burn>();
  // short-lived systems riding an enemy (Conflagration's burn, Sear's stun)
  const timed: { fx: THREE.Object3D; e: Enemy; until: number }[] = [];
  // Pillars of Flame waiting to erupt
  const pillars: { at: THREE.Vector3; rank: number; erupt: number }[] = [];
  let marks = 0, rings = 0, burning = 0;
  let manaReady = 0; // run time the minion/monster mana restore is ready again

  const ap = () => g.ap;
  const ablazed = (e: Enemy) => {
    const b = burns.get(e);
    return !!b && b.stacks > 0 && b.ticks > 0;
  };
  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  /** Target of a targeted skill: the enemy under the cursor if in range, else the one nearest the cursor in range. */
  const targetFor = (point: THREE.Vector3, range: number) => {
    const at = g.enemyAt(point);
    if (at && inReach(at, g.pos, range)) return at;
    return g.nearestEnemy(point, 3000, (e) => inReach(e, g.pos, range));
  };
  const follow = (key: string, e: Enemy) => {
    const o = g.vfx.attach(key);
    o.position.copy(e.pos).setY(0);
    g.scene.add(o);
    return o;
  };
  const attachFor = (key: string, e: Enemy, seconds: number) => timed.push({ fx: follow(key, e), e, until: g.time + seconds });

  const setMark = (e: Enemy, b: Burn, level: number) => {
    if (b.markLevel === level) return;
    if (b.mark) { b.mark.removeFromParent(); marks--; }
    b.mark = null;
    b.markLevel = level;
    if (level > 0 && marks < PASSIVE.maxMarkFx) { b.mark = follow(MARKS[level], e); marks++; }
  };
  const clearRing = (b: Burn) => {
    if (b.ring.length) rings--;
    for (const o of b.ring) o.removeFromParent();
    b.ring = [];
  };

  /** One Ablaze stack: refreshes the burn, the 3rd stack primes the detonation. */
  const ablaze = (e: Enemy) => {
    let b = burns.get(e);
    if (!b) {
      b = { stacks: 0, ticks: 0, tick: 0, lockUntil: 0, primedAt: -1, at: e.pos.clone(), mark: null, markLevel: 0, ring: [] };
      burns.set(e, b);
    }
    if (b.stacks === 0 || b.ticks === 0) { b.stacks = 0; b.tick = PASSIVE.tick; }
    const max = g.time < b.lockUntil ? 1 : PASSIVE.maxStacks;
    b.stacks = Math.min(max, b.stacks + 1);
    b.ticks = PASSIVE.duration / PASSIVE.tick;
    setMark(e, b, b.stacks);
    if (b.stacks === PASSIVE.maxStacks && b.primedAt < 0) {
      b.primedAt = g.time;
      b.at.copy(e.pos).setY(0);
      if (rings < PASSIVE.maxRings) {
        rings++;
        b.ring = [follow('Brand_P_redring', e), follow('Brand_P_Timer', e)]; // the ring spawns its Ignition child itself
      }
    }
  };

  const detonate = (e: Enemy, b: Burn) => {
    const P = PASSIVE;
    const at = b.at;
    clearRing(b);
    b.primedAt = -1;
    b.stacks = 0;
    b.lockUntil = g.time + P.lockout;
    setMark(e, b, 0);
    g.vfx.playAt('Brand_P_Apoc_Detonate_big', at);
    g.vfx.playAt('Brand_PHScorchGround', at);
    audio.playAt('brand_detonate', at, g.pos);
    const pct = lerpLevel(g.level, P.detonatePct) + P.detonatePctPerAp * ap();
    const cap = lerpLevel(g.level, P.detonateCap);
    const flatDmg = lerpLevel(g.level, P.detonateFlat) + P.detonateApRatio * ap();
    for (const x of g.enemiesNear(at, P.radius, near)) {
      if (!inReach(x, at, P.radius)) continue;
      ablaze(x); // before the damage: a kill by the explosion counts as an ablazed kill
      g.hurtEnemy(x, Math.min(cap, pct * x.maxHp) + flatDmg, HITS.blaze);
    }
  };

  const restoreMana = (e: Enemy) => {
    const big = e.def.tier === 'elite' || e.def.tier === 'epic';
    if (!big && g.time < manaReady) return;
    if (!big) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.manaRestore));
  };

  const erupt = (p: { at: THREE.Vector3; rank: number }) => {
    const w = SKILLS.W;
    g.vfx.playAt('Brand_W_POF_tar', p.at);
    audio.playAt('brand_W_hit', p.at, g.pos);
    const damage = w.damage[p.rank] + w.apRatio * ap();
    for (const e of g.enemiesNear(p.at, w.radius, near)) {
      if (!inReach(e, p.at, w.radius)) continue;
      g.hurtEnemy(e, damage * (ablazed(e) ? 1 + w.ablazeBonus : 1), HITS.W);
    }
  };

  /** Pyroclasm hit on `e`, then the next bounce (an ablazed enemy first) while bounces are left. */
  const pyroclasm = (from: THREE.Vector3, target: Enemy, rank: number, left: number, first: boolean) => {
    const R = SKILLS.R;
    g.spawnMissile('Brand_R_Wildfire_mis', from, target.pos, {
      speed: R.speed, range: 4000, radius: 10, damage: R.damage[rank] + R.apRatio * ap(), target, hit: HITS.R,
      hitFx: 'Brand_R_Wildfire_tar', hitSound: 'brand_R_hit',
      onHit: (e, m) => {
        if (ablazed(e)) g.slow(e, R.slow[rank], R.slowDuration);
        g.impact(e, m);
        if (left <= 0) return;
        const other = (x: Enemy) => x !== e && inReach(x, e.pos, R.bounceRange);
        const next = g.nearestEnemy(e.pos, R.bounceRange, (x) => other(x) && ablazed(x)) ?? g.nearestEnemy(e.pos, R.bounceRange, other)
          ?? (e.deadFor < 0 ? e : null);
        if (next) pyroclasm(m.pos, next, rank, left - 1, false);
      },
    });
    audio.play(first ? 'brand_R_launch' : 'brand_R_bounce');
  };

  return {
    hud: () => t('champion.brand.hud', { n: burning }),

    canCast(key) {
      if (key === 'E') return g.nearestEnemy(g.pos, SKILLS.E.range) !== null;
      if (key === 'R') return g.nearestEnemy(g.pos, SKILLS.R.range) !== null;
      return true;
    },

    castStart(key) {
      const fx = CAST_VFX[key];
      const bone = g.player.bone(HAND);
      if (fx && bone) g.vfx.playOn(fx, bone, g.facing, g.player.root);
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const q = SKILLS.Q;
        g.spawnMissile('Brand_Q_Blaze_mis', g.pos, g.pos.clone().add(toward(point)), {
          speed: q.speed, range: q.range, radius: q.width / 2, damage: q.damage[r] + q.apRatio * ap(), hit: HITS.Q,
          hitFx: 'Brand_Q_Blaze_tar', hitSound: 'brand_Q_hit',
          onHit: (e, m) => {
            const stun = ablazed(e); // checked before this hit adds its own stack
            g.impact(e, m);
            if (!stun || e.deadFor >= 0) return;
            g.stunEnemy(e, q.stun);
            g.vfx.hit('Brand_PHguardian_tar', e.pos, 0, { size: boundSize(e) });
            attachFor('Brand_P_hotfoot', e, q.stun);
          },
        });
        audio.play('brand_Q_launch');
      } else if (key === 'W') {
        const w = SKILLS.W;
        const off = flat.copy(point).sub(g.pos).setY(0);
        if (off.length() > w.range) off.setLength(w.range);
        const at = g.pos.clone().add(off).setY(0);
        g.vfx.playAt('Brand_W_POF_charge', at);
        g.vfx.playAt('Brand_W_POF_tar_green', at);
        audio.playAt('brand_W_charge', at, g.pos);
        pillars.push({ at, rank: r, erupt: g.time + w.delay });
      } else if (key === 'E') {
        const E = SKILLS.E;
        const target = targetFor(point, E.range);
        if (!target) return;
        const radius = ablazed(target) ? E.spreadAblaze : E.spread;
        const damage = E.damage[r] + E.apRatio * ap();
        g.vfx.hit('Brand_E_Conflagration_tar', target.pos, 0, { size: boundSize(target) });
        g.vfx.playAt(radius === E.spread ? 'Brand_E_Range_Ring' : 'Brand_E_Range_Ring_ext', target.pos.clone().setY(0));
        attachFor('Brand_E_Conflagration_buf', target, 1);
        audio.play('brand_E_hit');
        const from = target.pos.clone();
        let missiles = 0;
        for (const e of g.enemiesNear(from, radius, near)) {
          if (e === target || !inReach(e, from, radius)) continue;
          // hordes: the first few spreads fly as visible flames, the rest burn at once
          if (missiles++ < E.maxMissiles) {
            g.spawnMissile('Brand_E_Conflagration_mis', from, e.pos, {
              speed: E.speed, range: 3000, radius: 10, damage, target: e, hit: HITS.E,
              hitFx: 'Brand_E_Conflagration_tar', hitSound: 'brand_E_spread_hit',
            });
          } else g.hurtEnemy(e, damage, HITS.E);
        }
        if (missiles) audio.play('brand_E_spread');
        g.hurtEnemy(target, damage, HITS.E);
      } else {
        const target = targetFor(point, SKILLS.R.range);
        if (target) pyroclasm(g.pos, target, r, SKILLS.R.hits - 1, true);
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'ability') ablaze(e);
      return 0;
    },

    onKill(e, hit) {
      if (hit.source === 'ability' || ablazed(e)) restoreMana(e);
    },

    update(dt) {
      for (let i = pillars.length - 1; i >= 0; i--) {
        if (g.time < pillars[i].erupt) continue;
        erupt(pillars[i]);
        pillars.splice(i, 1);
      }

      for (let i = timed.length - 1; i >= 0; i--) {
        const x = timed[i];
        if (x.e.deadFor >= 0 || g.time >= x.until) {
          x.fx.removeFromParent();
          timed.splice(i, 1);
        } else x.fx.position.copy(x.e.pos).setY(0);
      }

      burning = 0;
      for (const [e, b] of burns) {
        const alive = e.deadFor < 0;
        if (alive) {
          b.at.copy(e.pos).setY(0);
          b.mark?.position.copy(b.at);
          for (const o of b.ring) o.position.copy(b.at);
        }
        // the explosion still goes off if the target died meanwhile
        if (b.primedAt >= 0 && g.time >= b.primedAt + PASSIVE.primeTime) detonate(e, b);
        if (alive && b.stacks > 0 && b.ticks > 0) {
          burning++;
          if ((b.tick -= dt) <= 0) {
            b.tick += PASSIVE.tick;
            b.ticks--;
            const P = PASSIVE;
            const cap = e.def.tier === 'epic' ? P.burnCapEpic : P.burnCap;
            const perStack = Math.min(cap, P.burnPct * e.maxHp) + lerpLevel(g.level, P.burnFlat) + P.burnApRatio * ap();
            g.hurtEnemy(e, (b.stacks * perStack * P.tick) / P.duration, HITS.blaze);
          }
        } else if (b.stacks > 0 && b.primedAt < 0) {
          b.stacks = 0;
          setMark(e, b, 0);
        }
        if (b.primedAt < 0 && b.stacks === 0 && (!alive || g.time >= b.lockUntil)) {
          setMark(e, b, 0);
          burns.delete(e);
        }
      }
    },

    dispose() {
      for (const b of burns.values()) { b.mark?.removeFromParent(); for (const o of b.ring) o.removeFromParent(); }
      for (const x of timed) x.fx.removeFromParent();
      burns.clear();
      timed.length = 0;
      pillars.length = 0;
    },
  };
}
