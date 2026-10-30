// Mechanics several item passives share: Spellblade, Lifeline, spell shields, burns, Energized attacks.
import type { Hit } from '../champion';
import type { Enemy, Game } from '../game';
import type { ItemEffect } from '../itemEffects';

/** Item procs and damage over time: trigger no on-hit, spellblade nor ability effects. */
export const ITEM_MAGIC: Hit = { type: 'magic', source: 'item' };
export const ITEM_PHYSICAL: Hit = { type: 'physical', source: 'item' };
export const ITEM_TRUE: Hit = { type: 'true', source: 'item' };

/** The first-hand basic attack (not a Runaan's bolt). */
export const isAuto = (hit: Hit) => hit.source === 'auto' && !hit.bolt;
export const isBig = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';

/** Cooldown of an all-or-nothing passive: `seconds` at full power, longer while the item levels up. */
export const scaledCooldown = (seconds: number, power: () => number) => seconds / Math.max(0.01, power());

/**
 * Spellblade (UNIQUE): after a skill, the next auto deals `bonus` extra damage (physical, or magic when `magic`),
 * 1.5 s cooldown. `bonus` runs on the hit, so it can add side effects (e.g. Iceborn's slow field).
 */
export const spellblade = (rank: number, bonus: (e: Enemy) => number, magic = false): ItemEffect => {
  let armed = false, cd = 0;
  const proc = (e: Enemy, hit: Hit) => {
    if (!armed || !isAuto(hit)) return 0;
    armed = false;
    cd = 1.5;
    return bonus(e);
  };
  return {
    unique: 'spellblade', rank,
    tick: (dt) => { cd -= dt; },
    onCast: () => { if (cd <= 0) armed = true; },
    ...(magic ? { onHitMagic: proc } : { onHit: proc }),
  };
};

/**
 * Lifeline (UNIQUE): damage that would drop the champion below 30% HP first triggers `trigger` (usually a shield,
 * which then absorbs that same hit), once per `cooldown` seconds at full power.
 */
export const lifeline = (g: Game, power: () => number, rank: number, cooldown: number, trigger: () => void): ItemEffect => {
  let readyAt = 0;
  return {
    unique: 'lifeline', rank,
    onHurt: (amount) => {
      if (g.time >= readyAt && g.hp - amount + g.shield < 0.3 * g.maxHp) {
        readyAt = g.time + scaledCooldown(cooldown, power);
        trigger();
      }
      return amount;
    },
  };
};

/** Spell shield (UNIQUE, Banshee's / Edge of Night): blocks the next damage taken, then recharges. */
export const spellShield = (g: Game, power: () => number, rank: number, cooldown: number): ItemEffect => {
  let readyAt = 0;
  return {
    unique: 'annul', rank,
    onHurt: (amount) => {
      if (amount <= 0 || g.time < readyAt) return amount;
      readyAt = g.time + scaledCooldown(cooldown, power);
      g.float(g.pos, '0', 'taken');
      return 0;
    },
  };
};

/**
 * Burns: `apply(e, dps, seconds)` (re)starts a burn on `e`; `tick` deals each burn's damage once per second as item
 * magic damage. `count()` is how many enemies burn now.
 */
export function burns(g: Game) {
  const on = new Map<Enemy, { dps: number; until: number }>();
  let timer = 0;
  return {
    apply(e: Enemy, dps: number, seconds: number) { on.set(e, { dps, until: g.time + seconds }); },
    count: () => on.size,
    tick(dt: number) {
      if ((timer -= dt) > 0) return;
      timer += 1;
      for (const [e, b] of on) {
        if (e.deadFor >= 0 || g.time > b.until) on.delete(e);
        else g.hurtEnemy(e, b.dps, ITEM_MAGIC);
      }
    },
  };
}

/**
 * Energized (LoL): moving and attacking build charge (100 = ready: about 6 attacks, or 2400 units walked); the next
 * auto spends it and `proc` returns the extra damage of that hit (added as `kind` damage). `charge(n)` adds charge.
 */
export function energized(g: Game, kind: 'physical' | 'magic', proc: (e: Enemy) => number, perAttack = 18) {
  let charge = 0;
  const last = g.pos.clone();
  const hit = (e: Enemy, h: Hit) => {
    if (!isAuto(h)) return 0;
    if (charge < 100) {
      charge = Math.min(100, charge + perAttack);
      return 0;
    }
    charge = 0;
    return proc(e);
  };
  return {
    charge: (n: number) => { charge = Math.min(100, charge + n); },
    ready: () => charge >= 100,
    tick: () => {
      charge = Math.min(100, charge + g.pos.distanceTo(last) / 24);
      last.copy(g.pos);
    },
    onHit: kind === 'physical' ? hit : undefined,
    onHitMagic: kind === 'magic' ? hit : undefined,
  };
}

/** The champion dealt or took damage within `seconds` (LoL "in combat"). */
export function combat(g: Game, seconds = 3) {
  let dealtAt = -Infinity;
  return {
    onDealt: () => { dealtAt = g.time; },
    active: () => g.time - Math.max(dealtAt, g.lastHurtAt) <= seconds,
  };
}
