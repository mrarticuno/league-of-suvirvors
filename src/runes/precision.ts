import type { Enemy } from '../game';
import { ADAPTIVE_AD, isBig, isOwnHit, RUNE_HIT, runeList } from './def';

const tiers = (kills: number, every: number, max: number) => Math.min(max, Math.floor(kills / every));

export const PRECISION = runeList('precision', [
  ['press-the-attack', 0, 'Styles/Precision/PressTheAttack/PressTheAttack.png'],
  ['lethal-tempo', 0, 'Styles/Precision/LethalTempo/LethalTempoTemp.png'],
  ['fleet-footwork', 0, 'Styles/Precision/FleetFootwork/FleetFootwork.png'],
  ['conqueror', 0, 'Styles/Precision/Conqueror/Conqueror.png'],
  ['absorb-life', 1, 'Styles/Precision/AbsorbLife/AbsorbLife.png'],
  ['triumph', 1, 'Styles/Precision/Triumph.png'],
  ['presence-of-mind', 1, 'Styles/Precision/PresenceOfMind/PresenceOfMind.png'],
  ['legend-alacrity', 2, 'Styles/Precision/LegendAlacrity/LegendAlacrity.png'],
  ['legend-haste', 2, 'Styles/Precision/LegendHaste/LegendHaste.png'],
  ['legend-bloodline', 2, 'Styles/Precision/LegendBloodline/LegendBloodline.png'],
  ['coup-de-grace', 3, 'Styles/Precision/CoupDeGrace/CoupDeGrace.png'],
  ['cut-down', 3, 'Styles/Precision/CutDown/CutDown.png'],
  ['last-stand', 3, 'Styles/Sorcery/LastStand/LastStand.png'],
], {
  'press-the-attack': (g) => {
    let target: Enemy | null = null, count = 0;
    const exposed = new WeakMap<Enemy, number>(); // enemy -> time the +8% ends
    return {
      onDealt: (e, hit) => {
        if (hit.source !== 'auto' || hit.bolt) return;
        count = e === target ? count + 1 : 1;
        target = e;
        if (count < 3) return;
        count = 0;
        g.hurtEnemy(e, ADAPTIVE_AD * (40 + 10 * g.level), RUNE_HIT);
        exposed.set(e, g.time + 6);
      },
      damageMult: (e) => ((exposed.get(e) ?? 0) > g.time ? 1.08 : 1),
    };
  },
  'lethal-tempo': (g) => {
    let stacks = 0, until = 0;
    const active = () => (until > g.time ? stacks : 0);
    return {
      onDealt: (_e, hit) => {
        if (hit.source !== 'auto' || hit.bolt) return;
        stacks = Math.min(6, active() + 1);
        until = g.time + 6;
      },
      stat: (k) => (k === 'as' ? 0.06 * active() : k === 'range' && active() === 6 ? 0.3 * g.champ.base.attackRange : 0),
    };
  },
  'fleet-footwork': (g) => {
    let attacks = 0, fastUntil = 0;
    return {
      onAttack: () => { attacks = Math.min(6, attacks + 1); }, // 6 attacks fill the 100 energy
      onDealt: (_e, hit) => {
        if (hit.source !== 'auto' || hit.bolt || attacks < 6) return;
        attacks = 0;
        g.heal(10 + 0.3 * g.bonusAd);
        fastUntil = g.time + 1;
      },
      stat: (k) => (k === 'msPct' && fastUntil > g.time ? 0.2 : 0),
    };
  },
  conqueror: (g) => {
    let stacks = 0, until = 0;
    const active = () => (until > g.time ? stacks : 0);
    return {
      onDealt: (_e, hit, dealt) => {
        if (!isOwnHit(hit)) return;
        stacks = Math.min(12, active() + (hit.source === 'ability' ? 2 : 1));
        until = g.time + 5;
        if (stacks === 12) g.heal(0.08 * dealt);
      },
      stat: (k) => (k === 'ad' ? active() * ADAPTIVE_AD * (2 + 0.12 * (g.level - 1)) : 0),
    };
  },
  'absorb-life': (g) => {
    let ready = 0;
    return {
      onKill: () => {
        if (g.time < ready) return;
        ready = g.time + 0.5;
        g.heal(0.01 * g.maxHp);
      },
    };
  },
  triumph: (g) => ({ onKill: (e) => { if (isBig(e)) g.heal(0.1 * (g.maxHp - g.hp)); } }),
  'presence-of-mind': (g) => ({ onKill: () => { g.mana = Math.min(g.maxMana, g.mana + 0.015 * g.maxMana); } }),
  'legend-alacrity': (g) => ({ stat: (k) => (k === 'as' ? 0.03 * tiers(g.kills, 500, 5) : 0) }),
  'legend-haste': (g) => ({ stat: (k) => (k === 'ah' ? 1.5 * tiers(g.kills, 500, 5) : 0) }),
  'legend-bloodline': (g) => ({ stat: (k) => (k === 'lifesteal' ? 0.005 * tiers(g.kills, 500, 6) : 0) }),
  'coup-de-grace': () => ({ damageMult: (e) => (e.hp / e.maxHp < 0.4 ? 1.08 : 1) }),
  'cut-down': () => ({ damageMult: (e) => (isBig(e) ? 1.08 : 1) }),
  'last-stand': (g) => ({
    damageMult: () => {
      const r = g.hp / g.maxHp;
      return r >= 0.6 ? 1 : 1.05 + 0.06 * Math.min(1, (0.6 - r) / 0.3);
    },
  }),
});
