// Passives of the ability power items (src/itemEffects.ts explains `power`).
import type * as THREE from 'three';
import type { Hit } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ItemPassive } from '../itemEffects';
import { VAMP_MULT } from '../items';
import { ITEM_MAGIC, burns, combat, isBig, lifeline, spellShield, spellblade } from './shared';

const isAbility = (hit: Hit) => hit.source === 'ability';

/** Alive enemies whose edge is within `r` of `p`; own `out` array, as hurtEnemy may run other effects that query. */
const within = (g: Game, p: THREE.Vector3, r: number, out: Enemy[]) =>
  g.enemiesNear(p, r, out).filter((e) => e.deadFor < 0 && e.pos.distanceTo(p) - e.def.radius <= r);

/** Seconds the champion has been in combat (Liandry's / Riftmaker's ramping damage). */
function combatTime(g: Game) {
  const c = combat(g);
  let s = 0;
  return { onDealt: c.onDealt, tick: (dt: number) => { s = c.active() ? s + dt : 0; }, seconds: () => s };
}

export const AP_PASSIVES: Record<string, ItemPassive> = {
  '8020': { // Abyssal Mask
    desc: t('item.8020.passive'),
    effect: (g, power) => ({
      damageMult: (e, hit) => (hit.type === 'magic' && e.pos.distanceTo(g.pos) - e.def.radius <= 550 ? 1 + 0.12 * power() : 1),
    }),
  },
  '3003': { // Archangel's Staff (Seraph's Embrace at max level)
    desc: t('item.3003.passive'),
    effect: (g, power) => {
      const seraph = lifeline(g, power, 2, 90, () => g.addShield(200 + 0.2 * g.mana, 3));
      return {
        ...seraph,
        // only Seraph's has Lifeline: below max level the staff must not take the UNIQUE slot from Maw/Sterak's
        get unique() { return power() >= 1 ? seraph.unique : undefined; },
        onHurt: (amount) => (power() >= 1 ? seraph.onHurt!(amount) : amount),
        stat: (k) => (k === 'ap' ? 0.02 * power() * g.items.mana : 0),
      };
    },
  },
  '3102': { // Banshee's Veil
    desc: t('item.3102.passive'),
    effect: (g, power) => spellShield(g, power, 1, 40),
  },
  '2503': { // Blackfire Torch
    desc: t('item.2503.passive'),
    effect: (g, power) => {
      const blaze = burns(g);
      const big = new Map<Enemy, number>();
      return {
        tick: blaze.tick,
        onDealt: (e, hit) => {
          if (!isAbility(hit)) return;
          blaze.apply(e, (20 + 0.02 * g.ap) * power(), 3);
          if (isBig(e)) big.set(e, g.time + 3);
        },
        stat: (k) => {
          if (k !== 'ap') return 0;
          let n = 0;
          for (const [e, until] of big) if (e.deadFor < 0 && g.time <= until) n++; else big.delete(e);
          return 0.04 * power() * n * g.items.ap; // items.ap, not g.ap: g.ap reads this stat
        },
      };
    },
  },
  '8010': { // Bloodletter's Curse
    desc: t('item.8010.passive'),
    effect: (g, power) => ({
      onDealt: (e, hit) => {
        if (hit.type !== 'magic' || hit.source === 'auto') return;
        e.mrShred = e.mrShredUntil > g.time ? Math.min(Math.round(4 * power()), e.mrShred + 1) : 1;
        e.mrShredUntil = g.time + 6;
      },
    }),
  },
  '4629': { // Cosmic Drive
    desc: t('item.4629.passive'),
    effect: (g, power) => {
      let until = 0;
      return {
        onDealt: (_e, hit) => { if (hit.type !== 'physical') until = g.time + 4; },
        stat: (k) => (k === 'msPct' && g.time < until ? 0.08 * power() : 0),
      };
    },
  },
  '3137': { // Cryptbloom
    desc: t('item.3137.passive'),
    effect: (g, power) => ({ onKill: (e) => { if (isBig(e)) g.heal((150 + 0.2 * g.ap) * power()); } }),
  },
  '6653': { // Liandry's Torment
    desc: t('item.6653.passive'),
    effect: (g, power) => {
      const torment = burns(g), fight = combatTime(g);
      return {
        tick: (dt) => { torment.tick(dt); fight.tick(dt); },
        onDealt: (e, hit) => {
          fight.onDealt();
          // capped on epic monsters so Baron and the dragons don't melt
          if (isAbility(hit)) torment.apply(e, Math.min(e.def.tier === 'epic' ? 60 : Infinity, 0.02 * e.maxHp) * power(), 3);
        },
        damageMult: () => 1 + Math.min(0.06, 0.02 * Math.floor(fight.seconds())) * power(),
      };
    },
  },
  '6655': { // Luden's Echo
    desc: t('item.6655.passive'),
    effect: (g, power) => {
      let readyAt = 0;
      const near: Enemy[] = [];
      return {
        onDealt: (e, hit) => {
          if (!isAbility(hit) || g.time < readyAt) return;
          readyAt = g.time + 10;
          const echo = (50 + 0.05 * g.ap) * power();
          const others = within(g, e.pos, 400, near).filter((x) => x !== e).slice(0, 5);
          g.hurtEnemy(e, echo * (1 + 0.2 * (5 - others.length)), ITEM_MAGIC);
          for (const x of others) g.hurtEnemy(x, echo, ITEM_MAGIC);
        },
      };
    },
  },
  '3118': { // Malignance
    desc: t('item.3118.passive'),
    effect: (g, power) => {
      const fogs: { pos: THREE.Vector3; until: number }[] = [];
      const near: Enemy[] = [];
      let readyAt = 0, timer = 0;
      return {
        stat: (k) => (k === 'ultHaste' ? 20 * power() : 0),
        onDealt: (e, hit) => {
          if (hit.skill !== 'R' || !isAbility(hit) || g.time < readyAt) return;
          readyAt = g.time + 3;
          fogs.push({ pos: e.pos.clone(), until: g.time + 3 });
        },
        tick: (dt) => {
          if ((timer -= dt) > 0) return;
          timer += 1;
          for (let i = fogs.length - 1; i >= 0; i--) {
            if (g.time > fogs[i].until) { fogs.splice(i, 1); continue; }
            for (const x of within(g, fogs[i].pos, 200, near)) g.hurtEnemy(x, (60 + 0.05 * g.ap) * power(), ITEM_MAGIC);
          }
        },
      };
    },
  },
  '3089': { // Rabadon's Deathcap: items.ap, as g.ap reads this stat
    desc: t('item.3089.passive'),
    effect: (g, power) => ({ stat: (k) => (k === 'ap' ? 0.3 * power() * g.items.ap : 0) }),
  },
  '4633': { // Riftmaker
    desc: t('item.4633.passive'),
    effect: (g, power) => {
      const fight = combatTime(g);
      return {
        tick: fight.tick,
        onDealt: fight.onDealt,
        damageMult: () => 1 + Math.min(0.08, 0.02 * Math.floor(fight.seconds())) * power(),
        stat: (k) => (k === 'ap' ? 0.02 * power() * g.items.hp : k === 'omnivamp' && fight.seconds() >= 4 ? 0.1 * VAMP_MULT * power() : 0),
      };
    },
  },
  '6657': { // Rod of Ages
    desc: t('item.6657.passive'),
    effect: (g, power) => {
      let owned = 0;
      const stacks = () => Math.min(10, Math.floor(owned / 60));
      return {
        tick: (dt) => { owned += dt; },
        saved: () => owned,
        restore: (v) => { owned = Number(v) || 0; },
        stat: (k) => stacks() * power() * (k === 'hp' ? 10 : k === 'mana' ? 30 : k === 'ap' ? 3 : 0),
        onHurt: (amount) => {
          g.mana = Math.min(g.maxMana, g.mana + 0.1 * power() * amount);
          return amount;
        },
        onCastResolved: (key) => g.heal(0.25 * power() * g.costOf(key)),
      };
    },
  },
  '3116': { // Rylai's Crystal Scepter
    desc: t('item.3116.passive'),
    effect: (g, power) => ({ onDealt: (e, hit) => { if (isAbility(hit)) g.slow(e, 0.3 * power(), 1); } }),
  },
  '4645': { // Shadowflame
    desc: t('item.4645.passive'),
    effect: (_g, power) => ({ damageMult: (e, hit) => (hit.type !== 'physical' && e.hp < 0.4 * e.maxHp ? 1 + 0.2 * power() : 1) }),
  },
  '4646': { // Stormsurge
    desc: t('item.4646.passive'),
    effect: (g, power) => {
      // per-enemy damage windows; one Squall every 10 s (LoL's per-champion cooldown means nothing against hordes)
      const dealt = new Map<Enemy, { sum: number; start: number }>();
      const near: Enemy[] = [];
      let readyAt = 0;
      let squall: { e: Enemy; pos: THREE.Vector3; at: number } | null = null;
      return {
        onDealt: (e, _hit, amount) => {
          if (squall || g.time < readyAt) return;
          let w = dealt.get(e);
          if (!w || g.time - w.start > 2.5) dealt.set(e, (w = { sum: 0, start: g.time }));
          if ((w.sum += amount) < 0.25 * e.maxHp) return;
          squall = { e, pos: e.pos.clone(), at: g.time + 2 };
          readyAt = g.time + 10;
          dealt.clear();
        },
        tick: () => {
          if (dealt.size > 200) dealt.clear();
          if (!squall || g.time < squall.at) return;
          const { e, pos } = squall;
          squall = null;
          const damage = (150 + 0.15 * g.ap) * power();
          if (e.deadFor < 0) g.hurtEnemy(e, damage, ITEM_MAGIC);
          else for (const x of within(g, pos, 350, near)) g.hurtEnemy(x, damage, ITEM_MAGIC);
        },
      };
    },
  },
  '3135': { // Void Staff: the bonus is the magicPen stat
    desc: t('item.3135.passive'),
  },
  '3115': { // Nashor's Tooth
    desc: t('item.3115.passive'),
    effect: (g, power) => ({ onHitMagic: () => (15 + 0.2 * g.ap) * power() }),
  },
  '2510': { // Dusk and Dawn
    desc: t('item.2510.passive'),
    effect: (g, power) => {
      let again: Enemy | null = null;
      return {
        ...spellblade(2, (e) => {
          g.heal((20 + 0.1 * g.ap) * power());
          again = e;
          return (40 + 0.2 * g.ap) * power();
        }, true),
        // the second on-hit pass runs after this hit resolved (its kill check), never inside it
        onDealt: (e) => {
          if (again !== e) return;
          again = null;
          g.hurtEnemy(e, 0, { type: 'magic', source: 'auto', onHit: true, bolt: true });
        },
      };
    },
  },
  '3100': { // Lich Bane
    desc: t('item.3100.passive'),
    effect: (g, power) => spellblade(3, () => (0.75 * g.baseAd + 0.45 * g.ap) * power(), true),
  },
  '4628': { // Horizon Focus: vision has no use here, so long-range hits deal more instead
    desc: t('item.4628.passive'),
    effect: (g, power) => ({
      damageMult: (e, hit) => (isAbility(hit) && e.pos.distanceTo(g.pos) >= 600 ? 1 + 0.1 * power() : 1),
    }),
  },
};
