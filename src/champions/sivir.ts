// Sivir. Numbers mirror League of Legends (source: the DataValues of her spell bins, patch 26.20, cross-checked
// with the LoL wiki and Meraki Analytics).
// Fleet of Foot: basic attacks (on attack) and ability hits grant 55-75 flat Move Speed (by level) decaying over 1.5s.
// There are no enemy champions here, so every enemy counts (League: champions only).
// Boomerang Blade: the kit flies the crossblade itself: out 1250 units at 1450 u/s, then back to Sivir at 1200 u/s,
// hitting each enemy once per pass. Damage falls 15% per enemy hit (down to 40%) and resets when the blade turns.
// Ricochet: basic attacks of the next 4s bounce up to 8 times (each enemy at most twice) to the nearest new enemy
// within 500 units; bounces are proc damage (no on-hit or spell effects), 65% on minions, executed below 15 Health.
// Spell Shield: ChampionKit.blockSpell negates the next hostile ability (enemy missiles, hazards, boss attacks; melee
// hits pass) within 1.5s and heals 60-80% AD (+50% AP). No mana cost, like League.
// On the Hunt: 20/25/30% Move Speed for 8/10/12s; every basic attack cuts Q, W and E's cooldowns by 0.5s; an elite
// or epic takedown refreshes the duration (League: champion takedowns). The ally aura systems (Sivir_R_alliesbuf,
// Sivir_R_Allyboost, Sivir_R_mis) have no allies to reach and are left out; Sivir_E_manaback is the pre-rework mana
// refund, Sivir_Q_tar_bloodless the bloodless-region variant and Sivir_E_shield the older bubble (its sphere mesh
// does not render here; Sivir_E_Barrier is the golden shield the game shows).
// Mana costs are League's: Sivir lives off basic attacks, not skills.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const HEIGHT = 110; // missile height (Game.spawnMissile's default)
const BASE_MS = 335;
const WEAPON_BONE = 'Buffbone_Glb_Weapon_1';
const BODY_HEIGHT = 95; // Spell Shield's barrier is centred on the body
const PASSIVE = { ms: 55, msStep: 5, msLevels: [6, 11, 16, 18], duration: 1.5 }; // SivirPassive FlatMS breakpoints
const MAX_HIT_FX = 30; // Boomerang Blade impact systems per pass on a crowd

const SKILLS = {
  Q: {
    name: t('champion.sivir.Q'), desc: t('champion.sivir.Q.desc'), damageType: 'physical', maxRank: 5, anim: 'sivir_base_spell1', icon: `${ICON}/spell/SivirQ.png`,
    cooldown: [10, 9.5, 9, 8.5, 8], cost: [55, 60, 65, 70, 75],
    damage: [60, 85, 110, 135, 160], bonusAdRatio: 0.7, apRatio: 0.6, hits: 2,
    range: 1250, aim: 1250, speed: 1450, returnSpeed: 1200, width: 180, returnWidth: 200, castTime: 0.25,
    castCutPerAs: 0.5, castCutMax: 0.6, // cast time shrinks 50% of bonus attack speed, up to 60%
    critRatio: 0.4, critRatioPerCritDamage: 0.3, // +40% at 100% crit chance, +12% more with Infinity Edge's +40% crit damage
    falloff: 0.15, falloffMin: 0.4,
  },
  W: {
    name: t('champion.sivir.W'), desc: t('champion.sivir.W.desc'), damageType: 'physical', maxRank: 5, anim: 'sivir_base_spell4', icon: `${ICON}/spell/SivirW.png`,
    cooldown: [12, 12, 12, 12, 12], cost: [60, 60, 60, 60, 60],
    damage: [0, 0, 0, 0, 0], adRatio: [0.4, 0.425, 0.45, 0.475, 0.5], hits: 8,
    extra: { label: t('champion.sivir.attackSpeed'), values: [20, 25, 30, 35, 40], percent: true },
    aim: 'none', castTime: 0.05, duration: 4, attackSpeed: [0.2, 0.25, 0.3, 0.35, 0.4],
    bounces: 8, bounceRange: 500, bounceSpeed: 1000, minionMod: 0.65, execute: 15,
    critMult: 2, critMultPerCritDamage: 0.75, // crit bounces deal 200%, +30% with Infinity Edge
  },
  E: {
    name: t('champion.sivir.E'), desc: t('champion.sivir.E.desc'), damageType: 'physical', maxRank: 5, anim: 'sivir_base_attack_01', icon: `${ICON}/spell/SivirE.png`,
    cooldown: [24, 22.5, 21, 19.5, 18], cost: [0, 0, 0, 0, 0],
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('champion.sivir.heal'), values: [60, 65, 70, 75, 80], percent: true },
    aim: 'none', castTime: 0.05, duration: 1.5, healAdRatio: [0.6, 0.65, 0.7, 0.75, 0.8], healApRatio: 0.5, passiveDelay: 0.25,
  },
  R: {
    name: t('champion.sivir.R'), desc: t('champion.sivir.R.desc'), damageType: 'physical', maxRank: 3, anim: 'sivir_base_attack_01', icon: `${ICON}/spell/SivirR.png`,
    cooldown: [120, 100, 80], cost: [100, 100, 100],
    damage: [0, 0, 0],
    extra: { label: t('champion.sivir.moveSpeed'), values: [20, 25, 30], percent: true },
    aim: 'none', castTime: 0.25, duration: [8, 10, 12], moveSpeed: [0.2, 0.25, 0.3], cdRefund: 0.5,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'physical', source: 'ability', skill: 'Q' },
  // Ricochet bounces are proc damage: neither on-hit nor spell effects, which is what 'item' triggers
  W: { type: 'physical', source: 'item' },
  execute: { type: 'true', source: 'item' },
} as const satisfies Record<string, Hit>;

export const SIVIR: ChampionDef = {
  id: 'sivir', name: t('champion.sivir.name'), model: 'sivir', icon: `${ICON}/champion/Sivir.png`,
  scale: 1.2, // the export's head stands at 134, Ezreal's at ~160
  title: t('champion.sivir.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Sivir_0.jpg',
  roles: ['marksman'], difficulty: 4,
  base: {
    hp: 600, hpPerLevel: 104,
    hpRegen5: 3.25, hpRegen5PerLevel: 0.55,
    mana: 340, manaPerLevel: 45,
    manaRegen5: 6, manaRegen5PerLevel: 0.8,
    ad: 60, adPerLevel: 2.5,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.02,
    attackRange: 500,
    moveSpeed: BASE_MS,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 1750,
    radius: 65,
    armor: 30, armorPerLevel: 4.45,
  },
  skills: SKILLS,
  // OP.GG 16.21: Essence Reaver, Navori Flickerblade, Infinity Edge; then Lord Dominik's, Bloodthirster, Guardian Angel
  build: ['3508', '6675', '3031', '3036', '3072', '3026'],
  passive: { name: t('champion.sivir.passive'), icon: `${ICON}/passive/Sivir_Passive.png` },
  // the animation graph: Attack1/Attack2 alternate, Crit is attack_02, Spell2 (E and R) is attack_01, Spell4 (W) spell4
  anims: {
    idle: 'sivir_base_idle', run: 'sivir_base_run', death: 'sivir_base_death',
    attacks: ['sivir_base_attack_01', 'sivir_base_attack_02'], crit: 'sivir_base_attack_02',
  },
  // the kit fires the basic attack itself (left and right-hand blades, Ricochet); these are the defaults
  vfx: { auto: 'Sivir_BasicAttack_mis', crit: 'Sivir_basicattack_mis_right', autoHit: 'Sivir_BA_tar_01', critHit: 'Sivir_BA_tar_crit_01' },
  kit: sivirKit,
};

/** Boomerang Blade in flight: out along `dir`, then back to Sivir; `hit` holds the enemies of the current pass. */
interface Blade { fx: MissileFx; dir: THREE.Vector3; travelled: number; back: boolean; damage: number; hit: Set<Enemy>; hits: number; fxCount: number }
/** One empowered attack's bounces: how many are left and how often each enemy was hit. */
interface Chain { left: number; hits: Map<Enemy, number>; damage: number }

function sivirKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const blades: Blade[] = [];
  let swing = 0; // basic attacks so far: hand and sound variant
  let fleetUntil = 0, fleetFx: THREE.Object3D | null = null, fleetAt = Infinity;
  let ricochetUntil = 0, ricochetFx: THREE.Object3D | null = null;
  let shieldUntil = 0, shieldFx: THREE.Object3D | null = null;
  let huntUntil = 0, huntFx: THREE.Object3D | null = null, boostFx: THREE.Object3D | null = null;

  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const follow = (key: string, at: THREE.Vector3, height = 0) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(height);
    g.scene.add(o);
    return o;
  };
  const drop = (o: THREE.Object3D | null) => { o?.removeFromParent(); return null; };
  const missile = (key: string, at: THREE.Vector3) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(at).setY(HEIGHT);
    g.scene.add(fx.root);
    return fx;
  };
  const big = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';

  // ---- Fleet of Foot ----
  const fleetMs = () => PASSIVE.ms + PASSIVE.msStep * PASSIVE.msLevels.filter((l) => g.level >= l).length;
  const fleetLeft = () => Math.max(0, fleetUntil - g.time) / PASSIVE.duration;
  const fleet = () => {
    if (g.time >= fleetUntil) {
      audio.play('sivir_passive_on');
      fleetFx = follow('Sivir_passivehaste', g.pos);
    }
    fleetUntil = g.time + PASSIVE.duration;
  };

  // ---- Ricochet ----
  const ricochet = () => g.time < ricochetUntil;
  const bounce = (chain: Chain, from: Enemy) => {
    const W = SKILLS.W;
    if (chain.left <= 0) return;
    // the nearest enemy not bounced to yet, else the nearest one bounced to once
    let best: Enemy | null = null, bestD = Infinity, bestNew = false;
    for (const e of g.enemiesNear(from.pos, W.bounceRange, near)) {
      if (e === from || e.deadFor >= 0) continue;
      const n = chain.hits.get(e) ?? 0;
      if (n >= 2) continue;
      const d = e.pos.distanceTo(from.pos) - e.def.radius;
      if (d > W.bounceRange) continue;
      const fresh = n === 0;
      if ((fresh && !bestNew) || (fresh === bestNew && d < bestD)) { best = e; bestD = d; bestNew = fresh; }
    }
    if (!best) return;
    const to = best;
    chain.left--;
    chain.hits.set(to, (chain.hits.get(to) ?? 0) + 1);
    const damage = chain.damage * (to.def.tier === 'minion' ? W.minionMod : 1);
    g.spawnMissile('Sivir_W_mis', from.pos, to.pos, {
      speed: W.bounceSpeed, range: 3000, radius: 10, damage, target: to, hit: HITS.W,
      hitFx: 'Sivir_W_Tar', hitSound: 'sivir_W_bounce_hit',
      onHit: (e, m) => {
        g.impact(e, m);
        if (e.deadFor < 0 && e.def.tier === 'minion' && e.hp < W.execute) g.hurtEnemy(e, e.hp, HITS.execute);
        fleet();
        bounce(chain, e);
      },
    });
  };

  // ---- Boomerang Blade ----
  const sweep = (b: Blade, radius: number) => {
    const Q = SKILLS.Q;
    const at = b.fx.root.position;
    for (const e of g.enemiesNear(at, radius + 100, near)) {
      if (e.deadFor >= 0 || b.hit.has(e)) continue;
      if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > e.def.radius + radius) continue;
      b.hit.add(e);
      const mult = Math.max(Q.falloffMin, 1 - Q.falloff * b.hits++);
      if (b.fxCount++ < MAX_HIT_FX) {
        g.vfx.hit('Sivir_Q_tar', e.pos, 0, { size: boundSize(e) });
        audio.play('sivir_Q_hit');
      }
      g.hurtEnemy(e, b.damage * mult, HITS.Q);
    }
  };
  const updateBlades = (dt: number) => {
    const Q = SKILLS.Q;
    for (let i = blades.length - 1; i >= 0; i--) {
      const b = blades[i];
      const root = b.fx.root;
      if (!b.back) {
        const step = Q.speed * dt;
        root.position.addScaledVector(b.dir, step);
        b.travelled += step;
        b.fx.update(dt, b.dir, b.travelled);
        sweep(b, Q.width / 2);
        if (b.travelled < Q.range) continue;
        // turn back: a fresh pass, the falloff resets
        root.removeFromParent();
        b.fx = missile('Sivir_Q_mis_return', root.position);
        b.back = true;
        b.hit.clear();
        b.hits = 0;
        b.fxCount = 0;
        audio.play('sivir_Q_return');
        continue;
      }
      if (!g.alive) { root.removeFromParent(); blades.splice(i, 1); continue; }
      const step = Q.returnSpeed * dt;
      const to = tmp.copy(g.pos).setY(HEIGHT).sub(root.position);
      const d = to.length();
      if (d > step) {
        b.dir.copy(to).divideScalar(d);
        root.position.addScaledVector(b.dir, step);
        b.travelled += step;
        b.fx.update(dt, b.dir, b.travelled);
        sweep(b, Q.returnWidth / 2);
        continue;
      }
      root.removeFromParent();
      blades.splice(i, 1);
      g.gesture('sivir_base_spell1_catch');
    }
  };

  // ---- Spell Shield ----
  const endShield = () => {
    shieldUntil = 0;
    shieldFx = drop(shieldFx);
    audio.play('sivir_E_off');
  };

  // ---- On the Hunt ----
  const hunting = () => g.time < huntUntil;
  const endHunt = () => {
    huntUntil = 0;
    huntFx = drop(huntFx);
    boostFx = drop(boostFx);
    audio.play('sivir_R_off');
  };

  return {
    attackSpeedBonus: () => (ricochet() ? SKILLS.W.attackSpeed[g.ranks.W - 1] : 0),
    moveSpeedBonus: () => (fleetMs() * fleetLeft()) / BASE_MS + (hunting() ? SKILLS.R.moveSpeed[g.ranks.R - 1] : 0),
    hud: () => t('champion.sivir.hud', { ms: Math.round(fleetMs() * fleetLeft()) }),

    castTime(key) {
      if (key !== 'Q') return undefined;
      const Q = SKILLS.Q;
      const bonusAs = Math.max(0, g.attackSpeed / SIVIR.base.attackSpeed - 1);
      return Q.castTime * (1 - Math.min(Q.castCutMax, bonusAs * Q.castCutPerAs));
    },

    attackStart(_target, crit) {
      fleet(); // on attack
      if (hunting()) for (const k of ['Q', 'W', 'E'] as const) g.cooldowns[k] = Math.max(0, g.cooldowns[k] - SKILLS.R.cdRefund);
      const right = swing++ % 2 === 1;
      const variant = (['sivir_auto', 'sivir_auto2', 'sivir_auto3', 'sivir_auto4'] as const)[swing % 4];
      return {
        anim: crit || right ? 'sivir_base_attack_02' : 'sivir_base_attack_01',
        sound: ricochet() ? 'sivir_W_attack' : crit ? 'sivir_crit' : variant,
      };
    },

    basicAttack(target, damage, crit, bolt) {
      if (bolt) return false; // Runaan's bolts neither ricochet nor pick a hand
      const empowered = ricochet();
      const right = swing % 2 === 0; // attackStart already advanced `swing`
      audio.play(empowered ? 'sivir_W_launch' : crit ? 'sivir_crit_launch' : 'sivir_auto_launch');
      let chain: Chain | null = null;
      if (empowered) {
        const W = SKILLS.W;
        const critMult = crit ? W.critMult + W.critMultPerCritDamage * g.items.critDamage : 1;
        chain = { left: W.bounces, hits: new Map([[target, 1]]), damage: W.adRatio[g.ranks.W - 1] * g.ad * critMult };
      }
      g.spawnMissile(empowered ? 'Sivir_W_mis' : right ? 'Sivir_basicattack_mis_right' : 'Sivir_BasicAttack_mis', g.pos, target.pos, {
        speed: SIVIR.base.missileSpeed, range: 3000, radius: 10, damage, target,
        hit: { type: 'physical', source: 'auto', onHit: true, crit },
        hitFx: crit ? 'Sivir_BA_tar_crit_01' : 'Sivir_BA_tar_01', hitSound: crit ? 'sivir_crit_hit' : 'sivir_auto_hit',
        onHit: chain ? (e, m) => { g.impact(e, m); bounce(chain, e); } : undefined,
      });
      return true;
    },

    castStart(key) {
      if (key === 'W') audio.play('sivir_W_marker');
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        const base = Q.damage[r] + Q.bonusAdRatio * g.bonusAd + Q.apRatio * g.ap;
        const damage = base * (1 + g.critChance * (Q.critRatio + Q.critRatioPerCritDamage * g.items.critDamage));
        blades.push({ fx: missile('Sivir_Q_mis', g.pos), dir: toward(point).clone(), travelled: 0, back: false, damage, hit: new Set(), hits: 0, fxCount: 0 });
        audio.play('sivir_Q_launch');
      } else if (key === 'W') {
        const W = SKILLS.W;
        if (!ricochet()) g.resetAttack(); // the attack reset only comes with a fresh buff
        ricochetUntil = g.time + W.duration;
        ricochetFx ??= follow('Sivir_W_Buff', g.pos, HEIGHT);
      } else if (key === 'E') {
        shieldUntil = g.time + SKILLS.E.duration;
        shieldFx = drop(shieldFx);
        shieldFx = follow('Sivir_E_Barrier', g.pos, BODY_HEIGHT);
      } else {
        huntUntil = g.time + SKILLS.R.duration[r];
        huntFx ??= follow('Sivir_R_buf', g.pos);
        boostFx ??= follow('Sivir_R_Boost', g.pos);
        audio.play('sivir_R_on');
      }
    },

    blockSpell() {
      if (g.time >= shieldUntil) return false;
      const E = SKILLS.E;
      endShield();
      g.vfx.playAt('Sivir_E_proc', g.pos.clone().setY(HEIGHT), g.facing);
      g.vfx.playAt('Sivir_E_SivirHeal', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
      g.heal(E.healAdRatio[g.ranks.E - 1] * g.ad + E.healApRatio * g.ap);
      fleetAt = g.time + E.passiveDelay;
      return true;
    },

    onDamage(_e, hit) {
      if (hit.source === 'ability') fleet();
      return 0;
    },

    onKill(e) {
      if (hunting() && big(e)) huntUntil = g.time + SKILLS.R.duration[g.ranks.R - 1];
    },

    update(dt) {
      updateBlades(dt);
      if (g.time >= fleetAt) { fleetAt = Infinity; fleet(); }
      if (fleetFx) {
        if (g.time >= fleetUntil) { fleetFx = drop(fleetFx); audio.play('sivir_passive_off'); }
        else fleetFx.position.copy(g.pos).setY(0);
      }
      if (ricochetFx) {
        if (!ricochet()) ricochetFx = drop(ricochetFx);
        else { const bone = g.player.bone(WEAPON_BONE); if (bone) bone.getWorldPosition(ricochetFx.position); else ricochetFx.position.copy(g.pos).setY(HEIGHT); }
      }
      if (shieldFx) {
        if (g.time >= shieldUntil) endShield();
        else shieldFx.position.copy(g.pos).setY(BODY_HEIGHT);
      }
      if (huntFx) {
        if (!hunting()) endHunt();
        else { huntFx.position.copy(g.pos).setY(0); boostFx?.position.copy(g.pos).setY(0); }
      }
    },

    dispose() {
      for (const b of blades) b.fx.root.removeFromParent();
      blades.length = 0;
      fleetFx = drop(fleetFx);
      ricochetFx = drop(ricochetFx);
      shieldFx = drop(shieldFx);
      huntFx = drop(huntFx);
      boostFx = drop(boostFx);
    },
  };
}
