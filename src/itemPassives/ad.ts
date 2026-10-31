// Passives of the attack damage items (src/itemEffects.ts explains `power`).
import type { Hit } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { ItemPassive } from '../itemEffects';
import { VAMP_MULT } from '../items';
import { combat, energized, isAuto, isBig, ITEM_MAGIC, ITEM_PHYSICAL, ITEM_TRUE, lifeline, scaledCooldown, spellblade, spellShield } from './shared';

const VAMP = VAMP_MULT; // passive vamp is scaled like item vamp stats
const critMult = (g: Game) => g.champ.base.critDamage + g.items.critDamage;
/** LoL "a–b based on level" (levels 1..18). */
const byLevel = (g: Game, a: number, b: number) => a + ((b - a) * (Math.min(g.level, 18) - 1)) / 17;
const bonusHp = (g: Game) => g.maxHp - g.baseHp;
const GA_CLEAR_RADIUS = 700; // about an ADC's attack range plus a step: room to walk out after the revive
// lets an ability spend Voltaic's Energized charge through its on-hit
const AUTO_PROBE: Hit = { type: 'physical', source: 'auto' };

export const AD_PASSIVES: Record<string, ItemPassive> = {
  '3078': { // Trinity Force
    desc: t('item.3078.passive'),
    effect: (g, power) => {
      let quickUntil = 0;
      return {
        ...spellblade(2, () => 2 * g.baseAd * power()),
        onAttack: () => { quickUntil = g.time + 2; },
        stat: (k) => (k === 'msPct' && g.time < quickUntil ? 0.06 * power() : 0),
      };
    },
  },
  '3508': { // Essence Reaver
    desc: t('item.3508.passive'),
    effect: (g, power) => spellblade(1, () => {
      g.mana = Math.min(g.maxMana, g.mana + 0.1 * power() * (g.maxMana - g.mana));
      return (g.baseAd + 0.4 * g.bonusAd) * power();
    }),
  },
  '3004': { // Manamune (Muramana at max level)
    desc: t('item.3004.passive'),
    effect: (g, power) => ({
      bonusAd: () => 0.025 * power() * g.maxMana,
      onHit: (_e, hit) => (power() >= 1 && isAuto(hit) ? 0.015 * g.maxMana : 0),
    }),
  },
  '6672': { // Kraken Slayer
    desc: t('item.6672.passive'),
    effect: (g, power) => {
      let count = 0;
      return {
        onHit: (e, hit) => (!isAuto(hit) || ++count % 3 ? 0
          : (140 + 0.45 * g.bonusAd) * power() * (1 + 0.75 * (1 - e.hp / e.maxHp))),
      };
    },
  },
  '3153': { // Blade of the Ruined King
    desc: t('item.3153.passive'),
    effect: (_g, power) => ({ onHit: (e: Enemy) => Math.min(e.def.tier === 'epic' ? Infinity : 100, 0.06 * power() * e.hp) }),
  },
  '3031': { // Infinity Edge: the bonus is the critDamage stat
    desc: t('item.3031.passive'),
  },
  '3071': { // Black Cleaver
    desc: t('item.3071.passive'),
    effect: (g, power) => {
      let fervorUntil = 0;
      return {
        onPhysical: (e) => {
          e.shred = e.shredUntil > g.time ? Math.min(Math.round(5 * power()), e.shred + 1) : 1;
          e.shredUntil = g.time + 6;
          fervorUntil = g.time + 2;
        },
        stat: (k) => (k === 'msPct' && g.time < fervorUntil ? 0.06 * power() : 0),
      };
    },
  },
  '3026': { // Guardian Angel: enemies around the revive vanish without XP (epics stay)
    desc: t('item.3026.passive'),
    effect: (g, power) => {
      let readyAt = 0;
      return {
        onLethal: () => {
          if (g.time < readyAt) return false;
          readyAt = g.time + scaledCooldown(300, power);
          g.enterStasis(4, () => {
            g.banish(GA_CLEAR_RADIUS); // otherwise the revive lands inside the pile that killed us
            g.hp = 0.5 * g.baseHp;
            g.mana = g.maxMana;
          });
          return true;
        },
      };
    },
  },
  '3085': { // Runaan's Hurricane
    desc: t('item.3085.passive'),
    effect: (g, power) => ({
      onAttack: (target, damage, crit) => {
        let last = target;
        for (let i = 0; i < 2; i++) {
          const extra = g.nearestEnemy(g.pos, g.attackReach, (e) => e !== target && e !== last && g.inAttackRange(e));
          if (!extra) break;
          last = extra;
          g.basicAttack(extra, 0.55 * power() * damage, crit, true);
        }
      },
    }),
  },
  '6696': { // Axiom Arc: champion takedowns become elite/epic kills, plus a sliver per horde kill
    desc: t('item.6696.passive'),
    effect: (g, power) => ({
      onKill: (e) => { g.cooldowns.R = Math.max(0, g.cooldowns.R - (isBig(e) ? 0.15 : 0.005) * power() * g.cooldownOf('R')); },
    }),
  },
  '2520': { // Bastionbreaker
    desc: t('item.2520.passive'),
    effect: (g, power) => {
      let sabotage = false;
      return {
        onDealt: (e, hit) => {
          if (hit.source === 'ability' && isBig(e)) g.hurtEnemy(e, (40 + 0.15 * g.bonusAd) * power(), ITEM_TRUE);
          else if (sabotage && isAuto(hit) && isBig(e)) {
            sabotage = false;
            g.hurtEnemy(e, (200 + 0.5 * g.bonusAd) * power(), ITEM_TRUE);
          }
        },
        onKill: (e) => { if (isBig(e)) sabotage = true; },
      };
    },
  },
  '3072': { // Bloodthirster
    desc: t('item.3072.passive'),
    effect: (g, power) => ({
      onOverheal: (excess) => {
        const room = byLevel(g, 50, 350) * power() - g.shield;
        if (room > 0) g.addShield(Math.min(excess, room), 10);
      },
    }),
  },
  '6692': { // Eclipse: any enemy hit twice, the cooldown keeps hordes from chaining it
    desc: t('item.6692.passive'),
    effect: (g, power) => {
      let last: Enemy | null = null, lastAt = 0, readyAt = 0;
      return {
        onDealt: (e, hit) => {
          if (hit.source === 'item') return;
          if (e === last && g.time - lastAt <= 2 && g.time >= readyAt) {
            readyAt = g.time + 6;
            const melee = g.attackRange <= 300;
            g.addShield(((melee ? 160 : 80) + (melee ? 0.4 : 0.2) * g.bonusAd) * power(), 2);
          }
          last = e;
          lastAt = g.time;
        },
      };
    },
  },
  '3814': { // Edge of Night
    desc: t('item.3814.passive'),
    effect: (g, power) => spellShield(g, power, 1, 40),
  },
  '2517': { // Endless Hunger
    desc: t('item.2517.passive'),
    effect: (g, power) => {
      let feastUntil = 0;
      return {
        stat: (k) => (k === 'ah' ? 0.1 * g.bonusAd * power()
          : k === 'omnivamp' && g.time < feastUntil ? 0.15 * VAMP * power() : 0),
        onKill: (e) => { if (isBig(e)) feastUntil = g.time + 8; },
      };
    },
  },
  '3073': { // Experimental Hexplate
    desc: t('item.3073.passive'),
    effect: (g, power) => {
      let until = 0;
      return {
        stat: (k) => power() * (k === 'ultHaste' ? 30 : g.time >= until ? 0 : k === 'as' ? 0.3 : k === 'msPct' ? 0.15 : 0),
        onCastResolved: (key) => { if (key === 'R') until = g.time + 8; },
      };
    },
  },
  '2512': { // Fiendhunter Bolts
    desc: t('item.2512.passive'),
    effect: (g, power) => {
      let left = 0, until = 0;
      const active = () => left > 0 && g.time < until;
      return {
        stat: (k) => (k === 'ultHaste' ? 30 * power() : k === 'as' && active() ? 0.5 * power() : 0),
        onCastResolved: (key) => {
          if (key !== 'R') return;
          left = 3;
          until = g.time + 8;
        },
        onHit: (e, hit) => {
          if (!isAuto(hit) || !active()) return 0;
          left--;
          if (!hit.crit) return Math.max(0, 0.8 * critMult(g) - 1) * g.ad * power();
          g.hurtEnemy(e, 0.15 * critMult(g) * g.ad * power(), ITEM_TRUE);
          return 0;
        },
      };
    },
  },
  '3124': { // Guinsoo's Rageblade
    desc: t('item.3124.passive'),
    effect: (g, power) => {
      let stacks = 0, until = 0, count = 0;
      // a bolt-flagged echo applies every on-hit effect once more without counting as an attack
      const echo: Hit = { type: 'physical', source: 'auto', onHit: true, bolt: true };
      return {
        onHitMagic: () => 30 * power(),
        onAttack: () => {
          stacks = g.time < until ? Math.min(4, stacks + 1) : 1;
          until = g.time + 4;
        },
        stat: (k) => (k === 'as' && g.time < until ? 0.08 * stacks * power() : 0),
        onDealt: (e, hit) => {
          if (isAuto(hit) && stacks === 4 && g.time < until && ++count % 3 === 0) g.hurtEnemy(e, 0, echo);
        },
      };
    },
  },
  '2523': { // Hexoptics C44
    desc: t('item.2523.passive'),
    effect: (g, power) => {
      let aimUntil = 0;
      return {
        damageMult: (e, hit) => (hit.source === 'auto' ? 1 + 0.1 * power() * Math.min(1, e.pos.distanceTo(g.pos) / 500) : 1),
        stat: (k) => (k === 'range' && g.time < aimUntil ? 100 * power() : 0),
        onKill: (e) => { if (isBig(e)) aimUntil = g.time + 8; },
      };
    },
  },
  '6697': { // Hubris
    desc: t('item.6697.passive'),
    effect: (g, power) => {
      let trophies = 0, until = 0;
      return {
        stat: (k) => (k === 'ad' && g.time < until ? (15 + 2 * trophies) * power() : 0),
        onKill: (e) => {
          if (!isBig(e)) return;
          trophies++;
          until = g.time + 90;
        },
      };
    },
  },
  '3181': { // Hullbreaker: there are no allies, so Boarding Party arms the champion instead
    desc: t('item.3181.passive'),
    effect: (g, power) => {
      let count = 0;
      return {
        onHit: (_e, hit) => (!isAuto(hit) || ++count % 5 ? 0 : (1.5 * g.baseAd + 0.07 * g.maxHp) * power()),
        stat: (k) => (k === 'armor' || k === 'mr' ? 20 * power() : 0),
      };
    },
  },
  '6673': { // Immortal Shieldbow
    desc: t('item.6673.passive'),
    effect: (g, power) => lifeline(g, power, 2, 90, () => g.addShield(byLevel(g, 250, 700), 3)),
  },
  '3036': { // Lord Dominik's Regards: monsters have no bonus Health, so it compares their max Health with the champion's
    desc: t('item.3036.passive'),
    effect: (g, power) => ({
      damageMult: (e) => 1 + 0.15 * power() * Math.min(1, Math.max(0, e.maxHp - g.maxHp) / 1500),
    }),
  },
  '3156': { // Maw of Malmortius: any damage (enemies deal mostly physical)
    desc: t('item.3156.passive'),
    effect: (g, power) => {
      const fight = combat(g);
      let vamp = false;
      return {
        ...lifeline(g, power, 1, 90, () => {
          g.addShield(150 + g.bonusAd, 3);
          vamp = true;
        }),
        onDealt: fight.onDealt,
        tick: () => { if (vamp && !fight.active()) vamp = false; },
        stat: (k) => (k === 'omnivamp' && vamp ? 0.1 * VAMP : 0),
      };
    },
  },
  '2501': { // Overlord's Bloodmail
    desc: t('item.2501.passive'),
    effect: (g, power) => {
      const tyranny = () => 0.025 * bonusHp(g) * power();
      return {
        // base + item AD instead of g.ad: g.ad reads this hook
        bonusAd: () => tyranny() + 0.12 * power() * Math.min(1, (1 - g.hp / g.maxHp) / 0.7) * (g.baseAd + g.items.ad + tyranny()),
      };
    },
  },
  '3046': { // Phantom Dancer: the champion already walks through enemies, so the waltz is a burst of speed
    desc: t('item.3046.passive'),
    effect: (g, power) => {
      let until = 0;
      return {
        onAttack: () => { until = g.time + 2; },
        stat: (k) => (k === 'msPct' && g.time < until ? 0.07 * power() : 0),
      };
    },
  },
  '3094': { // Rapid Firecannon
    desc: t('item.3094.passive'),
    effect: (g, power) => {
      const en = energized(g, 'magic', () => 40 * power());
      return {
        tick: en.tick, onHitMagic: en.onHitMagic,
        stat: (k) => (k === 'range' && en.ready() ? 0.35 * g.champ.base.attackRange * power() : 0),
      };
    },
  },
  '6694': { // Serylda's Grudge
    desc: t('item.6694.passive'),
    effect: (g, power) => ({
      onDealt: (e, hit) => { if (hit.source === 'ability' && e.hp < 0.5 * e.maxHp) g.slow(e, 0.3 * power(), 1); },
    }),
  },
  '3161': { // Spear of Shojin
    desc: t('item.3161.passive'),
    effect: (g, power) => {
      let stacks = 0, until = 0;
      return {
        stat: (k) => (k === 'basicHaste' ? 25 * power() : 0),
        damageMult: (_e, hit) => (hit.source === 'ability' && g.time < until ? 1 + 0.03 * stacks * power() : 1),
        onDealt: (_e, hit) => {
          if (hit.source !== 'ability') return;
          stacks = g.time < until ? Math.min(4, stacks + 1) : 1;
          until = g.time + 6;
        },
      };
    },
  },
  '3087': { // Statikk Shiv
    desc: t('item.3087.passive'),
    effect: (g, power) => {
      const near: Enemy[] = [];
      const en = energized(g, 'magic', (target) => {
        let left = 4;
        for (const e of g.enemiesNear(target.pos, 500, near)) {
          if (left > 0 && e !== target && e.deadFor < 0 && e.pos.distanceTo(target.pos) - e.def.radius <= 500) {
            left--;
            g.hurtEnemy(e, 60 * power(), ITEM_MAGIC);
          }
        }
        return 60 * power();
      }, 27);
      return { tick: en.tick, onHitMagic: en.onHitMagic };
    },
  },
  '3053': { // Sterak's Gage
    desc: t('item.3053.passive'),
    effect: (g, power) => ({
      ...lifeline(g, power, 3, 90, () => g.addShield(0.6 * bonusHp(g), 4.5)),
      stat: (k) => (k === 'ad' ? 0.45 * g.baseAd * power() : 0),
    }),
  },
  '3095': { // Stormrazor
    desc: t('item.3095.passive'),
    effect: (g, power) => {
      let fastUntil = 0;
      const en = energized(g, 'magic', () => {
        fastUntil = g.time + 1.5;
        return 100 * power();
      });
      return {
        tick: en.tick, onHitMagic: en.onHitMagic,
        stat: (k) => (k === 'msPct' && g.time < fastUntil ? 0.45 * power() : 0),
      };
    },
  },
  '6610': { // Sundered Sky: first hit on each elite/epic monster, and on a cooldown against the horde
    desc: t('item.6610.passive'),
    effect: (g, power) => {
      const struck = new WeakSet<Enemy>();
      let readyAt = 0;
      return {
        onHit: (e, hit) => {
          const first = isBig(e) && !struck.has(e);
          if (!isAuto(hit) || (!first && g.time < readyAt)) return 0;
          if (first) struck.add(e);
          else readyAt = g.time + 8;
          g.heal((g.baseAd + 0.06 * (g.maxHp - g.hp)) * power());
          return hit.crit ? 0 : (critMult(g) - 1) * g.ad * power();
        },
      };
    },
  },
  '3302': { // Terminus
    desc: t('item.3302.passive'),
    effect: (g, power) => {
      let dark = false, light = 0, shadow = 0, until = 0;
      return {
        onHitMagic: () => 30 * power(),
        onAttack: () => {
          if (g.time >= until) light = shadow = 0;
          if (dark) shadow = Math.min(3, shadow + 1);
          else light = Math.min(3, light + 1);
          dark = !dark;
          until = g.time + 5;
        },
        stat: (k) => (k === 'armor' || k === 'mr' ? 6 * light * power()
          : k === 'armorPen' || k === 'magicPen' ? 0.1 * shadow * power() : 0),
      };
    },
  },
  '6676': { // The Collector: gold becomes XP
    desc: t('item.6676.passive'),
    effect: (g, power) => ({
      onDealt: (e) => { if (e.deadFor < 0 && e.hp < 0.05 * power() * e.maxHp) g.hurtEnemy(e, e.hp, ITEM_TRUE); },
      xpMult: () => 1 + 0.1 * power(),
    }),
  },
  '6699': { // Voltaic Cyclosword
    desc: t('item.6699.passive'),
    effect: (g, power) => {
      let sharpUntil = 0;
      const en = energized(g, 'physical', (e) => {
        sharpUntil = g.time + 4;
        return 0.06 * power() * e.hp;
      });
      return {
        tick: en.tick, onHit: en.onHit,
        onDealt: (e, hit) => { if (hit.source === 'ability' && en.ready()) g.hurtEnemy(e, en.onHit!(e, AUTO_PROBE), ITEM_PHYSICAL); },
        stat: (k) => (k === 'lethality' && g.time < sharpUntil ? 10 * power() : 0),
      };
    },
  },
  '3032': { // Yun Tal Wildarrows
    desc: t('item.3032.passive'),
    effect: (g, power) => {
      let practice = 0, flurryUntil = 0, cd = 0;
      return {
        onAttack: (_t, _d, crit) => {
          practice = Math.min(0.25, practice + 0.005);
          if (cd <= 0) {
            cd = 30;
            flurryUntil = g.time + 6;
          } else cd -= crit ? 2 : 1;
        },
        stat: (k) => (k === 'crit' ? practice * power() : k === 'as' && g.time < flurryUntil ? 0.3 * power() : 0),
        tick: (dt) => { cd -= dt; },
      };
    },
  },
  '3091': { // Wit's End
    desc: t('item.3091.passive'),
    effect: (_g, power) => ({ onHitMagic: () => 45 * power() }),
  },
  '6675': { // Navori Flickerblade
    desc: t('item.6675.passive'),
    effect: (g, power) => ({
      onAttack: () => { for (const k of ['Q', 'W', 'E'] as const) g.cooldowns[k] *= 1 - 0.15 * power(); },
    }),
  },
};
