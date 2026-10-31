// Twitch. Numbers mirror League of Legends: the DataValues of his spell bins (patch 26.21), cross-checked with the
// LoL wiki (V26.16); Meraki's copy (25.08) is older (Q 45-65% AS, E 30% AP).
// Deadly Venom: basic attacks (on-hit: also Runaan's bolts and every enemy a Spray and Pray bolt pierces) and Venom
// Cask apply a stack for 6s (refreshed, up to 6) that deals 1/2/3/4/5 (levels 1/5/9/13/17) +3% AP true damage per
// stack every second. Proc damage over time ('item' hits), like League.
// Ambush: there is no invisibility here, so the cast only grants its buffs: 10% Move Speed for the camouflage's
// 10-14s and 40-60% Attack Speed for 6s, both at once. Killing an elite or epic monster resets its cooldown
// (League: an enemy champion dying while poisoned). The stealth systems (Twitch_Q_Cas_Invisible, Twitch_Q_Invisible,
// Twitch_Q_Camouflage_Ring(_Decay), Twitch_Q_Invisiible_Outro) and the empty Twitch_Q_Buff_Canister are left out.
// Venom Cask: a cask lobbed up to 950 units (1400 u/s, gravity 4000) bursts in a 300 radius: a stack and a 30-50%
// (+6% per 100 AP) slow; the venom pool stays 3s, slowing enemies inside and adding a stack each second (at most 4
// stacks per enemy per cask).
// Contaminate: needs a poisoned enemy within 1200. A toxin flies to each one (TwitchEParticle: 3000 u/s, gravity
// 3000) and deals 20-60 physical +15-35 (+35% bonus AD) physical and +35% AP magic per stack it had when the cast began.
// Spray and Pray: 6s of +30/45/60 AD and +300 attack range; basic attacks become bolts (5000 u/s, 120 wide) flying to
// the attack range + 250 (League: 1100 + bonus range) that hit every enemy in line with on-hit effects, 10% less per
// enemy hit, down to 60%. Runaan's bolts keep the bonus range but do not pierce.
// Twitch_E_Range_Indicator (a range ring of the HUD) and the recall systems are left out. Mana costs are League's
// except Contaminate's.
// Buffed for wave clear (not from LoL): Deadly Venom deals twice League's damage (2/4/6/8/10 +3% AP per stack) and
// spreads when a poisoned enemy dies: its stacks go to every enemy within 300. Contaminate hits harder (40-120
// physical +25-55 (+50% bonus AD) physical and +50% AP magic per stack; League: 20-60, 15-35, 35%, 35%), recharges in
// 9/8/7/6/5s (12-8s) and costs 40-60 mana (50-90). Venom Cask recharges in 10/9/8/7/6s (13-9s).
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { FxStat } from '../itemEffects';
import type { MissileFx } from '../vfx';
import type { ParticleSystem } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const PASSIVE = { maxStacks: 6, duration: 6, dps: [1, 5, 9, 13, 17], dpsPerTier: 2, apRatio: 0.03, spread: 300 }; // dps: +2 per stack at these levels (League: +1)
const MAX_MARKS = 40; // poisoned enemies showing their stack icons at once (hordes)
const MAX_SLOW_FX = 30; // Venom Cask debuff systems at once
const MAX_HIT_FX = 30; // Spray and Pray impacts per bolt
const CASK_HEIGHT = 60; // TwitchVenomCaskMissile: mOffsetInitialTargetHeight
const TOXIN_HEIGHT = 100; // TwitchEParticle: mOffsetInitialTargetHeight

const SKILLS = {
  Q: {
    name: t('champion.twitch.Q'), desc: t('champion.twitch.Q.desc'), damageType: 'physical', maxRank: 5, anim: 'twitch_idle1', icon: `${ICON}/spell/TwitchHideInShadows.png`,
    cooldown: [16, 16, 16, 16, 16], cost: [40, 40, 40, 40, 40],
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('champion.twitch.attackSpeed'), values: [40, 45, 50, 55, 60], percent: true },
    aim: 'none', castTime: 0.05, attackSpeed: [0.4, 0.45, 0.5, 0.55, 0.6], attackSpeedDuration: 6,
    moveSpeed: 0.1, moveSpeedDuration: [10, 11, 12, 13, 14],
  },
  W: {
    name: t('champion.twitch.W'), desc: t('champion.twitch.W.desc'), damageType: 'magic', maxRank: 5, anim: 'twitch_base_spell2', icon: `${ICON}/spell/TwitchVenomCask.png`,
    cooldown: [10, 9, 8, 7, 6], cost: [70, 70, 70, 70, 70], // League: 13-9s
    damage: [0, 0, 0, 0, 0],
    extra: { label: t('champion.twitch.slow'), values: [30, 35, 40, 45, 50], percent: true },
    range: 950, aim: 950, castTime: 0.25, speed: 1400, gravity: 4000, radius: 300,
    slow: [30, 35, 40, 45, 50], slowPerAp: 0.06, duration: 3, maxStacks: 4,
  },
  E: {
    name: t('champion.twitch.E'), desc: t('champion.twitch.E.desc'), damageType: 'physical', maxRank: 5, anim: 'twitch_base_spell3', icon: `${ICON}/spell/TwitchExpunge.png`,
    cooldown: [9, 8, 7, 6, 5], cost: [40, 45, 50, 55, 60], // League: 12-8s, 50-90 mana
    damage: [190, 250, 310, 370, 430], bonusAdRatio: 3, apRatio: 3, // the card shows 6 stacks
    extra: { label: t('champion.twitch.perStack'), values: [25, 32.5, 40, 47.5, 55] },
    aim: 'none', castTime: 0.25, range: 1200, speed: 3000, gravity: 3000,
    base: [40, 60, 80, 100, 120], perStack: [25, 32.5, 40, 47.5, 55], bonusAdPerStack: 0.5, apPerStack: 0.5, // League: 20-60, 15-35, 35%, 35%
  },
  R: {
    name: t('champion.twitch.R'), desc: t('champion.twitch.R.desc'), damageType: 'physical', maxRank: 3, anim: 'twitch_base_spell3', icon: `${ICON}/spell/TwitchFullAutomatic.png`,
    cooldown: [90, 90, 90], cost: [100, 100, 100],
    damage: [0, 0, 0],
    extra: { label: t('champion.twitch.bonusAd'), values: [30, 45, 60] },
    aim: 'none', castTime: 0.05, duration: 6, bonusAd: [30, 45, 60], bonusRange: 300,
    speed: 5000, width: 120, overshoot: 250, falloff: 0.1, falloffMin: 0.6,
    windupPercent: 0.3889 / 1.3334, // TwitchSprayAndPrayAttack: spellCastTime / spellTotalTime
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  venom: { type: 'true', source: 'item' }, // Deadly Venom: proc damage over time
  E: { type: 'physical', source: 'ability', skill: 'E' },
  E_ap: { type: 'magic', source: 'item' }, // Contaminate's AP share: one ability hit per target, not two
} as const satisfies Record<string, Hit>;

export const TWITCH: ChampionDef = {
  id: 'twitch', name: t('champion.twitch.name'), model: 'twitch', icon: `${ICON}/champion/Twitch.png`,
  title: t('champion.twitch.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Twitch_0.jpg',
  roles: ['marksman', 'assassin'], difficulty: 6,
  hide: ['Twitch_Cheese_Mat'], // the joke's cheese
  conformPath: ['Tail1', 'Tail10'], // his tail trails the path he walked
  base: {
    hp: 630, hpPerLevel: 98,
    hpRegen5: 3.75, hpRegen5PerLevel: 0.6,
    mana: 300, manaPerLevel: 40,
    manaRegen5: 7.25, manaRegen5PerLevel: 0.7,
    ad: 59, adPerLevel: 3,
    attackSpeed: 0.679, attackSpeedPerLevel: 0.03,
    attackRange: 550,
    moveSpeed: 330,
    critDamage: 1.75,
    windupPercent: 0.3 - 0.098084, // attackCastTime 0.3 + mAttackDelayCastOffsetPercent
    missileSpeed: 2500,
    radius: 65,
    armor: 27, armorPerLevel: 4,
  },
  skills: SKILLS,
  // OP.GG 16.21: Blade of the Ruined King, Guinsoo's Rageblade, Runaan's Hurricane; then Infinity Edge, Lord Dominik's, Guardian Angel
  build: ['3153', '3124', '3085', '3031', '3036', '3026'],
  passive: { name: t('champion.twitch.passive'), icon: `${ICON}/passive/Twitch_Passive.png` },
  // the animation graph: Attack1 and Attack2 are both attack1, Spell1 (Q) is idle1, Spell3 serves E and R, Spell4 is the R attack
  anims: {
    idle: 'twitch_base_idle1', run: 'twitch_base_run', death: 'twitch_base_death',
    attacks: ['twitch_base_attack1'], crit: 'twitch_base_crit',
  },
  vfx: { auto: 'Twitch_AA_mis', crit: 'Twitch_AA_mis', autoHit: 'Twitch_AA_tar', critHit: 'Twitch_AA_crit_tar' },
  idleVfx: [['Twitch_Idle', 'Root']],
  animVfx: true, // Twitch_AA_cas, Twitch_Crit_cas and Twitch_R_cas on the Arrow bone
  kit: twitchKit,
};

/** Deadly Venom on one enemy: stacks, ticks left (6 after the last application) and its marks. */
interface Venom { stacks: number; ticks: number; next: number; icons: THREE.Object3D | null; smoke: THREE.Object3D | null }
/** A thrown missile the kit flies itself (cask, toxin): straight on the ground plane plus a gravity arc. */
interface Lob { fx: MissileFx; from: THREE.Vector3; to: THREE.Vector3; dir: THREE.Vector3; age: number; time: number; peak: number; land: () => void; target?: Enemy }
/** A venom pool: ticks left, stacks it gave each enemy, debuff systems on the enemies inside. */
interface Pool { at: THREE.Vector3; slow: number; ticks: number; next: number; stacks: Map<Enemy, number>; fx: Map<Enemy, THREE.Object3D> }

const STACK_FX = ['Twitch_P_Stack_01', 'Twitch_P_Stack_02', 'Twitch_P_Stack_03', 'Twitch_P_Stack_04', 'Twitch_P_Stack_05', 'Twitch_P_Stack_06'] as const;

function twitchKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const venom = new Map<Enemy, Venom>();
  const lobs: Lob[] = [];
  const pools: Pool[] = [];
  const snapshot = new Map<Enemy, number>(); // Contaminate: stacks when the cast began
  let marks = 0, slowFx = 0;
  let asUntil = 0, msUntil = 0, rUntil = 0;
  let hands: (ParticleSystem | null)[] = [], bows: (ParticleSystem | null)[] = [];
  let haste: THREE.Object3D | null = null, rBuff: THREE.Object3D | null = null;

  const big = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';
  const inReach = (e: Enemy, at: THREE.Vector3, r: number) => Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= r + e.def.radius;
  const follow = (key: string, at: THREE.Vector3, y = 0) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(y);
    g.scene.add(o);
    return o;
  };
  const drop = (o: THREE.Object3D | null) => { o?.removeFromParent(); return null; };
  /** A system riding one of Twitch's bones until stopped. */
  const onBone = (key: string, bone: string) => {
    const b = g.player.bone(bone);
    return b ? g.vfx.play(key, b.getWorldPosition(new THREE.Vector3()), new THREE.Quaternion(), { bone: b, owner: g.player.root, until: undefined }) ?? null : null;
  };
  const stop = (list: (ParticleSystem | null)[]) => { for (const s of list) s?.stop(); return []; };
  const overhead = (e: Enemy) => 40 + e.def.radius * 2.5;
  const lob = (key: string, from: THREE.Vector3, to: THREE.Vector3, speed: number, gravity: number, land: () => void, target?: Enemy) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(from);
    g.scene.add(fx.root);
    const dir = to.clone().sub(from).setY(0);
    const d = dir.length();
    if (d < 1e-3) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    const time = Math.max(d / speed, 0.05);
    lobs.push({ fx, from: from.clone(), to: to.clone(), dir: dir.normalize(), age: 0, time, peak: (gravity * time * time) / 8, land, target });
  };

  // ---- Deadly Venom ----
  const dps = () => PASSIVE.dpsPerTier * PASSIVE.dps.filter((l) => g.level >= l).length + PASSIVE.apRatio * g.ap;
  const spreadNear: Enemy[] = [];
  /** A poisoned enemy died: its stacks spread to every enemy within PASSIVE.spread (wave clear, not from LoL). */
  const spread = (dead: Enemy) => {
    const n = venom.get(dead)?.stacks ?? 0;
    if (n === 0) return;
    for (const e of g.enemiesNear(dead.pos, PASSIVE.spread, spreadNear)) {
      if (e === dead || e.deadFor >= 0 || !inReach(e, dead.pos, PASSIVE.spread)) continue;
      for (let i = 0; i < n && stacksOf(e) < PASSIVE.maxStacks; i++) poison(e);
    }
  };
  const unmark = (v: Venom) => {
    if (v.icons) marks--;
    v.icons = drop(v.icons);
    v.smoke = drop(v.smoke);
  };
  const poison = (e: Enemy) => {
    if (e.deadFor >= 0) return;
    let v = venom.get(e);
    if (!v) venom.set(e, v = { stacks: 0, ticks: 0, next: g.time + 1, icons: null, smoke: null });
    else if (v.stacks === PASSIVE.maxStacks) g.vfx.hit('Twitch_P_Impact_Stack_06', e.pos.clone().setY(overhead(e)), 0, { size: boundSize(e) });
    v.ticks = PASSIVE.duration;
    if (v.stacks === PASSIVE.maxStacks) return;
    v.stacks++;
    // the icon systems show a fixed count: swap them as stacks grow
    if (v.icons) { v.icons = drop(v.icons); marks--; }
    if (marks < MAX_MARKS) {
      v.icons = follow(STACK_FX[v.stacks - 1], e.pos, overhead(e));
      marks++;
      v.smoke ??= follow(e.def.tier === 'minion' ? 'Twitch_P_Minion' : 'Twitch_P_Smoke', e.pos);
    }
  };
  const stacksOf = (e: Enemy) => venom.get(e)?.stacks ?? 0;
  const updateVenom = () => {
    for (const [e, v] of venom) {
      if (e.deadFor >= 0) { unmark(v); venom.delete(e); continue; }
      if (g.time >= v.next) {
        v.next += 1;
        g.hurtEnemy(e, v.stacks * dps(), HITS.venom);
        if (--v.ticks <= 0 || e.deadFor >= 0) { unmark(v); venom.delete(e); continue; }
      }
      v.icons?.position.set(e.pos.x, overhead(e), e.pos.z);
      v.smoke?.position.set(e.pos.x, 0, e.pos.z);
    }
  };

  // ---- Venom Cask ----
  const caskSlow = (r: number) => (SKILLS.W.slow[r] + SKILLS.W.slowPerAp * g.ap) / 100;
  const contaminate = (p: Pool) => {
    const W = SKILLS.W;
    for (const e of g.enemiesNear(p.at, W.radius, near)) {
      if (e.deadFor >= 0 || !inReach(e, p.at, W.radius)) continue;
      const n = p.stacks.get(e) ?? 0;
      if (n >= W.maxStacks) continue;
      p.stacks.set(e, n + 1);
      poison(e);
    }
  };
  const updatePools = (dt: number) => {
    const W = SKILLS.W;
    for (let i = pools.length - 1; i >= 0; i--) {
      const p = pools[i];
      if (g.time >= p.next) {
        p.next += 1;
        if (p.ticks-- <= 0) {
          for (const o of p.fx.values()) { o.removeFromParent(); slowFx--; }
          pools.splice(i, 1);
          continue;
        }
        contaminate(p);
      }
      // slowed while inside; the debuff system follows each slowed enemy
      for (const [e, o] of p.fx) {
        if (e.deadFor >= 0 || !inReach(e, p.at, W.radius)) { o.removeFromParent(); p.fx.delete(e); slowFx--; }
        else o.position.set(e.pos.x, 0, e.pos.z);
      }
      for (const e of g.enemiesNear(p.at, W.radius, near)) {
        if (e.deadFor >= 0 || !inReach(e, p.at, W.radius)) continue;
        g.slow(e, p.slow, dt + 0.1);
        if (!p.fx.has(e) && slowFx < MAX_SLOW_FX) { p.fx.set(e, follow('Twitch_W_Debuff_buf', e.pos)); slowFx++; }
      }
    }
  };
  const burst = (at: THREE.Vector3, r: number) => {
    g.vfx.playAt('Twitch_W_Tar', at, g.facing);
    g.vfx.playAt('Twitch_W_Persist', at); // lasts the pool's 3s
    g.vfx.playAt('Twitch_W_indicator_ally_01', at);
    audio.playAt('twitch_W_hit', at, g.pos);
    const p: Pool = { at, slow: caskSlow(r), ticks: SKILLS.W.duration, next: g.time + 1, stacks: new Map(), fx: new Map() };
    pools.push(p);
    contaminate(p);
  };

  // ---- Spray and Pray ----
  const spraying = () => g.time < rUntil;
  const endSpray = () => {
    rUntil = 0;
    bows = stop(bows);
    rBuff = drop(rBuff);
    audio.play('twitch_R_off');
  };
  const bolt = (target: Enemy, damage: number, crit: boolean) => {
    const R = SKILLS.R;
    let hits = 0;
    audio.play('twitch_R_launch');
    g.spawnMissile('Twitch_R_mis', g.pos, target.pos, {
      speed: R.speed, range: g.attackRange + R.overshoot, radius: R.width / 2, damage, pierce: true,
      hit: { type: 'physical', source: 'auto', onHit: true, crit },
      onHit: (e, m) => {
        if (hits < MAX_HIT_FX) {
          g.vfx.hit('Twitch_R_Tar', e.pos.clone().setY(m.pos.y), Math.atan2(m.dir.x, m.dir.z), { size: boundSize(e) }); // chest height
          audio.play('twitch_R_hit');
        }
        g.hurtEnemy(e, damage * Math.max(R.falloffMin, 1 - R.falloff * hits++), m.hit!);
      },
    });
  };

  return {
    attackSpeedBonus: () => (g.time < asUntil ? SKILLS.Q.attackSpeed[g.ranks.Q - 1] : 0),
    moveSpeedBonus: () => (g.time < msUntil ? SKILLS.Q.moveSpeed : 0),
    stat: (k: FxStat) => (!spraying() ? 0 : k === 'ad' ? SKILLS.R.bonusAd[g.ranks.R - 1] : k === 'range' ? SKILLS.R.bonusRange : 0),
    hud: () => t('champion.twitch.hud', { n: venom.size }),

    canCast(key) {
      if (key !== 'E') return true;
      return g.nearestEnemy(g.pos, SKILLS.E.range, (e) => stacksOf(e) > 0 && inReach(e, g.pos, SKILLS.E.range)) !== null;
    },

    attackStart(_target, crit) {
      if (spraying()) return { anim: 'twitch_base_spell4', sound: 'twitch_R_attack', windupPercent: SKILLS.R.windupPercent };
      return { sound: crit ? 'twitch_crit' : 'twitch_auto' };
    },

    basicAttack(target, damage, crit, isBolt) {
      if (spraying() && !isBolt) { bolt(target, damage, crit); return true; }
      if (!isBolt) audio.play(crit ? 'twitch_crit_launch' : 'twitch_auto_launch');
      return false;
    },

    castStart(key) {
      if (key !== 'E') return;
      snapshot.clear();
      for (const [e, v] of venom) snapshot.set(e, v.stacks);
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        g.vfx.playAt('Twitch_Q_Bamf', g.pos.clone().setY(0), g.facing);
        asUntil = g.time + Q.attackSpeedDuration;
        msUntil = g.time + Q.moveSpeedDuration[r];
        stop(hands);
        hands = [onBone('Twitch_Q_Buff_Hands', 'L_Buffbone_Glb_Hand_Loc'), onBone('Twitch_Q_Buff_Hands', 'R_Buffbone_Glb_Hand_Loc')];
        haste ??= follow('Twitch_Q_Haste', g.pos);
      } else if (key === 'W') {
        const W = SKILLS.W;
        const dir = point.clone().sub(g.pos).setY(0);
        const d = Math.min(dir.length(), W.range);
        if (d < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
        const to = g.pos.clone().addScaledVector(dir.normalize(), d).setY(0);
        g.vfx.playAt('Twitch_W_cas', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
        audio.play('twitch_W_launch');
        lob('Twitch_W_Mis', g.pos.clone().setY(CASK_HEIGHT), to, W.speed, W.gravity, () => burst(to, r));
      } else if (key === 'E') {
        const E = SKILLS.E;
        const arrow = g.player.bone('Arrow');
        if (arrow) g.vfx.playOn('Twitch_E_cas', arrow, g.facing, g.player.root);
        audio.play('twitch_E_launch');
        const perStack = E.perStack[r] + E.bonusAdPerStack * g.bonusAd, apPerStack = E.apPerStack * g.ap, base = E.base[r];
        for (const [e, stacks] of snapshot) {
          if (e.deadFor >= 0 || !inReach(e, g.pos, E.range)) continue;
          lob('Twitch_E_Mis', g.pos.clone().setY(TOXIN_HEIGHT), e.pos.clone().setY(TOXIN_HEIGHT), E.speed, E.gravity, () => {
            if (e.deadFor >= 0) return;
            g.vfx.playAt('Twitch_E_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
            audio.playAt('twitch_E_hit', e.pos, g.pos);
            g.hurtEnemy(e, base + stacks * perStack, HITS.E);
            if (apPerStack > 0) g.hurtEnemy(e, stacks * apPerStack, HITS.E_ap);
          }, e);
        }
        snapshot.clear();
      } else {
        rUntil = g.time + SKILLS.R.duration;
        stop(bows);
        bows = [onBone('Twitch_R_Weapon_Glow_L', 'L_Bow'), onBone('Twitch_R_Weapon_Glow_R', 'R_Bow')];
        rBuff ??= follow('Twitch_R_Buff', g.pos);
        audio.play('twitch_R_on');
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'auto' && hit.onHit) poison(e); // Deadly Venom is on-hit
      return 0;
    },

    onKill(e) {
      spread(e);
      if (big(e)) g.cooldowns.Q = 0; // Ambush resets on elite and epic kills
    },

    update(dt) {
      for (let i = lobs.length - 1; i >= 0; i--) {
        const b = lobs[i];
        b.age += dt;
        if (b.target && b.target.deadFor < 0) b.to.set(b.target.pos.x, b.to.y, b.target.pos.z); // the toxin homes in
        const k = Math.min(1, b.age / b.time);
        b.fx.root.position.lerpVectors(b.from, b.to, k);
        b.fx.root.position.y += b.peak * 4 * k * (1 - k);
        b.fx.update(dt, b.dir, k);
        if (k < 1) continue;
        b.fx.root.removeFromParent();
        lobs.splice(i, 1);
        b.land();
      }
      updatePools(dt);
      updateVenom();
      if (g.time >= asUntil && hands.length) hands = stop(hands);
      if (haste) {
        if (g.time >= msUntil) haste = drop(haste);
        else haste.position.copy(g.pos).setY(0);
      }
      if (rBuff) {
        if (!spraying()) endSpray();
        else rBuff.position.copy(g.pos).setY(0);
      }
    },

    dispose() {
      for (const v of venom.values()) unmark(v);
      venom.clear();
      for (const b of lobs) b.fx.root.removeFromParent();
      for (const p of pools) for (const o of p.fx.values()) o.removeFromParent();
      lobs.length = pools.length = 0;
      marks = slowFx = 0;
      hands = stop(hands);
      bows = stop(bows);
      haste = drop(haste);
      rBuff = drop(rBuff);
    },
  };
}
