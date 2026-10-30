// Passives of the tank items (src/itemEffects.ts explains `power`).
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ItemEffect, ItemPassive } from '../itemEffects';
import { ITEM_MAGIC, combat, isAuto, isBig, lifeline, spellblade } from './shared';

const IMMOLATE_RANGE = 400;
const inRange = (g: Game, e: Enemy, r: number) => e.deadFor < 0 && e.pos.distanceTo(g.pos) - e.def.radius <= r;
const bonusHp = (g: Game) => g.maxHp - g.baseHp;

/** Immolate (UNIQUE): 15 + 3 per level + 2% item Health magic damage per second to enemies within IMMOLATE_RANGE. */
function immolate(g: Game, power: () => number, rank: number): ItemEffect {
  let timer = 0;
  const near: Enemy[] = [];
  return {
    unique: 'immolate', rank,
    tick: (dt) => {
      if ((timer -= dt) > 0) return;
      timer = 1;
      const dmg = (15 + 3 * g.level + 0.02 * g.items.hp) * power();
      for (const e of g.enemiesNear(g.pos, IMMOLATE_RANGE, near)) if (inRange(g, e, IMMOLATE_RANGE)) g.hurtEnemy(e, dmg, ITEM_MAGIC);
    },
  };
}

export const TANK_PASSIVES: Record<string, ItemPassive> = {
  '3110': { // Frozen Heart: attacks take 25% longer = 20% less attack speed
    desc: t('item.3110.passive'),
    effect: (_g, power) => ({ enemyAttackCooldown: (dist) => (dist < 700 ? 1 + 0.25 * power() : 1) }),
  },
  '3068': { // Sunfire Aegis
    desc: t('item.3068.passive'),
    effect: (g, power) => immolate(g, power, 0),
  },
  '6664': { // Hollow Radiance
    desc: t('item.6664.passive'),
    effect: (g, power) => ({
      ...immolate(g, power, 1),
      onKill: (dead) => {
        if (dead.pos.distanceTo(g.pos) - dead.def.radius > IMMOLATE_RANGE) return;
        const dmg = (20 + 0.01 * g.items.hp) * power();
        // fresh array: kills here re-enter onKill
        for (const e of g.enemiesNear(dead.pos, 300, [])) {
          if (e.deadFor < 0 && e.pos.distanceTo(dead.pos) - e.def.radius <= 300) g.hurtEnemy(e, dmg, ITEM_MAGIC);
        }
      },
    }),
  },
  '2502': { // Unending Despair
    desc: t('item.2502.passive'),
    effect: (g, power) => {
      const fight = combat(g);
      let timer = 0;
      const near: Enemy[] = [];
      return {
        onDealt: fight.onDealt,
        tick: (dt) => {
          if ((timer -= dt) > 0 || !fight.active()) return;
          timer = 4;
          const dmg = (20 + 0.03 * bonusHp(g)) * power();
          let hit = false;
          for (const e of g.enemiesNear(g.pos, 450, near)) if (inRange(g, e, 450)) { g.hurtEnemy(e, dmg, ITEM_MAGIC); hit = true; }
          if (hit) g.heal(2.5 * dmg); // one enemy's worth: hordes would make it per-enemy absurd
        },
      };
    },
  },
  '3742': { // Dead Man's Plate: no slows hit the champion, so Unsinkable is Tenacity
    desc: t('item.3742.passive'),
    effect: (g, power) => {
      let momentum = 0; // 0..1, full after 1500 units walked
      const last = g.pos.clone();
      return {
        tick: () => {
          momentum = Math.min(1, momentum + g.pos.distanceTo(last) / 1500);
          last.copy(g.pos);
        },
        stat: (k) => (k === 'msPct' ? 0.06 * momentum * power() : k === 'tenacity' ? 0.15 * power() : 0),
        onHit: (_e, hit) => {
          if (!isAuto(hit)) return 0;
          const dmg = (40 + g.baseAd) * momentum * power();
          momentum = 0;
          return dmg;
        },
      };
    },
  },
  '6333': { // Death's Dance
    desc: t('item.6333.passive'),
    effect: (g, power) => {
      let parts: { left: number; perSec: number }[] = [];
      let timer = 0, bleeding = false, healPerSec = 0, healUntil = 0;
      return {
        onHurt: (amount) => {
          if (bleeding || amount <= 0) return amount;
          const later = 0.3 * power() * amount;
          parts.push({ left: later, perSec: later / 3 });
          return amount - later;
        },
        tick: (dt) => {
          if (g.time < healUntil) g.heal(healPerSec * dt);
          if ((timer -= dt) > 0) return;
          timer += 0.5;
          let dmg = 0;
          for (const p of parts) { const d = Math.min(p.left, p.perSec * 0.5); p.left -= d; dmg += d; }
          parts = parts.filter((p) => p.left > 0.01);
          if (dmg <= 0) return;
          // through hurtPlayer so the bleed can kill (and Guardian Angel can save); armor already applied, so undo it
          bleeding = true;
          g.hurtPlayer((dmg * (100 + Math.max(0, g.armor))) / 100);
          bleeding = false;
        },
        onKill: (e) => {
          if (!isBig(e)) return;
          parts = [];
          healPerSec = (0.15 * g.maxHp * power()) / 2;
          healUntil = g.time + 2;
        },
      };
    },
  },
  '4401': { // Force of Nature: onHurt does not know the damage type, so any damage counts
    desc: t('item.4401.passive'),
    effect: (g, power) => {
      let stacks = 0, until = 0;
      return {
        onHurt: (amount) => {
          if (amount > 0) {
            stacks = g.time < until ? Math.min(8, stacks + 1) : 1;
            until = g.time + 6;
          }
          return amount;
        },
        stat: (k) => (stacks < 8 || g.time >= until ? 0 : k === 'mr' ? 70 * power() : k === 'msPct' ? 0.06 * power() : 0),
      };
    },
  },
  '3084': { // Heartsteel: elite and epic monsters only, so hordes can't farm the max Health
    desc: t('item.3084.passive'),
    effect: (g, power) => {
      let charge = 0, gained = 0;
      return {
        tick: (dt) => { charge = g.nearestEnemy(g.pos, 700, isBig) ? charge + dt : 0; },
        onHit: (e, hit) => {
          if (charge < 3 || !isAuto(hit) || !isBig(e)) return 0;
          charge = 0;
          const dmg = (70 + 0.06 * g.maxHp) * power();
          gained += 0.1 * dmg;
          g.hp += 0.1 * dmg;
          return dmg;
        },
        stat: (k) => (k === 'hp' ? gained : 0),
      };
    },
  },
  '6665': { // Jak'Sho, The Protean
    desc: t('item.6665.passive'),
    effect: (g, power) => {
      const fight = combat(g);
      let since = Infinity;
      return {
        onDealt: fight.onDealt,
        tick: () => { since = fight.active() ? Math.min(since, g.time) : Infinity; },
        stat: (k) => (g.time - since < 5 ? 0 : k === 'armor' ? 0.3 * power() * g.items.armor : k === 'mr' ? 0.3 * power() * g.items.mr : 0),
      };
    },
  },
  '2504': { // Kaenic Rookern: any damage counts (onHurt does not know the type); its own pool, not g.shield, so it never expires
    desc: t('item.2504.passive'),
    effect: (g, power) => {
      let shield = 0;
      return {
        tick: () => { if (shield <= 0 && g.time - g.lastHurtAt >= 15) shield = 0.18 * g.maxHp * power(); },
        onHurt: (amount) => {
          const absorbed = Math.min(shield, amount);
          shield -= absorbed;
          return amount - absorbed;
        },
      };
    },
  },
  '2525': { // Protoplasm Harness
    desc: t('item.2525.passive'),
    effect: (g, power) => {
      let extra = 0, until = 0;
      const on = () => g.time < until;
      return {
        ...lifeline(g, power, 1, 90, () => {
          extra = (150 + 30 * g.level) * power();
          until = g.time + 5;
        }),
        tick: (dt) => { if (on()) g.heal((extra / 5) * dt); },
        stat: (k) => (!on() ? 0 : k === 'hp' ? extra : k === 'msPct' ? 0.1 : k === 'tenacity' ? 0.25 : 0),
      };
    },
  },
  '3065': { // Spirit Visage
    desc: t('item.3065.passive'),
    effect: (_g, power) => ({ stat: (k) => (k === 'healMult' ? 0.25 * power() : 0) }),
  },
  '3075': { // Thornmail
    desc: t('item.3075.passive'),
    effect: (g, power) => ({
      onStruck: (e) => g.hurtEnemy(e, (20 + 0.1 * (g.items.armor + g.fxStat('armor'))) * power(), ITEM_MAGIC),
    }),
  },
  '3083': { // Warmog's Armor
    desc: t('item.3083.passive'),
    effect: (g, power) => ({
      tick: (dt) => { if (bonusHp(g) >= 2000 && g.time - g.lastHurtAt >= 8) g.heal(0.05 * power() * g.maxHp * dt); },
      stat: (k) => (k === 'hp' ? 0.12 * power() * g.items.hp : 0),
    }),
  },
  '3119': { // Winter's Approach (Fimbulwinter at max level)
    desc: t('item.3119.passive'),
    effect: (g, power) => {
      let readyAt = 0;
      return {
        stat: (k) => (k === 'hp' ? 0.08 * power() * g.maxMana : 0),
        // casting stands in for LoL's "immobilize or slow a champion"; an elite or epic nearby replaces "more than one enemy"
        onCast: () => {
          if (power() < 1 || g.time < readyAt || !g.nearestEnemy(g.pos, 500)) return;
          readyAt = g.time + 8;
          g.addShield((100 + 0.055 * g.mana) * (g.nearestEnemy(g.pos, 500, isBig) ? 1.8 : 1), 3);
        },
      };
    },
  },
  '6662': { // Iceborn Gauntlet
    desc: t('item.6662.passive'),
    effect: (g, power) => {
      const fields: { pos: Enemy['pos']; until: number }[] = [];
      const near: Enemy[] = [];
      const blade = spellblade(1, (target) => {
        fields.push({ pos: target.pos.clone(), until: g.time + 2 });
        return g.baseAd * power();
      });
      return {
        ...blade,
        tick: (dt) => {
          blade.tick!(dt);
          while (fields.length && fields[0].until <= g.time) fields.shift();
          for (const f of fields) {
            for (const e of g.enemiesNear(f.pos, 250, near)) {
              if (e.deadFor < 0 && e.pos.distanceTo(f.pos) - e.def.radius <= 250) g.slow(e, 0.25 * power(), 0.3);
            }
          }
        },
      };
    },
  },
};
