import type { Enemy } from '../game';
import { itemIcon, POTIONS } from '../items';
import { IMG, isBig, runeList } from './def';
import { t } from '../i18n';

const SPELLBOOK = [
  { name: t('rune.unsealed-spellbook.ad'), stat: 'ad', value: 15, icon: 'StatMods/StatModsAdaptiveForceIcon.png' },
  { name: t('rune.unsealed-spellbook.as'), stat: 'as', value: 0.15, icon: 'StatMods/StatModsAttackSpeedIcon.png' },
  { name: t('rune.unsealed-spellbook.ah'), stat: 'ah', value: 15, icon: 'StatMods/StatModsCDRScalingIcon.png' },
] as const;

export const INSPIRATION = runeList('inspiration', [
  ['glacial-augment', 0, 'Styles/Inspiration/GlacialAugment/GlacialAugment.png'],
  ['unsealed-spellbook', 0, 'Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png'],
  ['first-strike', 0, 'Styles/Inspiration/FirstStrike/FirstStrike.png'],
  ['hextech-flashtraption', 1, 'Styles/Inspiration/HextechFlashtraption/HextechFlashtraption.png'],
  ['magical-footwear', 1, 'Styles/Inspiration/MagicalFootwear/MagicalFootwear.png'],
  ['cash-back', 1, 'Styles/Inspiration/CashBack/CashBack2.png'],
  ['triple-tonic', 2, 'Styles/Inspiration/PerfectTiming/AlchemistCabinet.png'],
  ['time-warp-tonic', 2, 'Styles/Inspiration/TimeWarpTonic/TimeWarpTonic.png'],
  ['biscuit-delivery', 2, 'Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png'],
  ['cosmic-insight', 3, 'Styles/Inspiration/CosmicInsight/CosmicInsight.png'],
  ['approach-velocity', 3, 'Styles/Resolve/ApproachVelocity/ApproachVelocity.png'],
  ['jack-of-all-trades', 3, 'Styles/Inspiration/JackOfAllTrades/JackofAllTrades2.png'],
], {
  'glacial-augment': (g) => {
    const hit = new WeakSet<Enemy>();
    return {
      onDealt: (e, h) => {
        if (h.source !== 'auto' || hit.has(e)) return;
        hit.add(e);
        g.slow(e, 0.3, 2);
      },
    };
  },
  'unsealed-spellbook': (g) => {
    let next = 0, picked: (typeof SPELLBOOK)[number] | null = null;
    return {
      tick: () => {
        if (g.time < next) return;
        next += 120;
        g.choices.push({
          title: t('rune.unsealed-spellbook.title'),
          options: SPELLBOOK.map((o) => ({ name: o.name, text: t('rune.unsealed-spellbook.option'), icon: IMG + o.icon, run: () => { picked = o; } })),
        });
      },
      stat: (k) => (picked?.stat === k ? picked.value : 0),
    };
  },
  'first-strike': (g) => {
    const until = new WeakMap<Enemy, number>();
    return {
      onDealt: (e) => { if (isBig(e) && !until.has(e)) until.set(e, g.time + 3); },
      damageMult: (e) => ((until.get(e) ?? 0) > g.time ? 1.07 : 1),
    };
  },
  // Flashtração Hextec has no hooks: Game.flash checks the page
  'magical-footwear': (g) => ({
    stat: (k) => (k === 'msPct' && g.time >= 360 - 30 * Math.floor(g.kills / 300) ? 0.1 : 0),
  }),
  'cash-back': () => ({ xpMult: () => 1.1 }),
  'triple-tonic': (g) => ({
    onLevel: () => {
      if (![3, 6, 9].includes(g.level)) return;
      g.choices.push({
        title: t('rune.triple-tonic.title'),
        options: [
          { name: POTIONS.hp.name, text: POTIONS.hp.text, icon: itemIcon(POTIONS.hp.icon), run: () => g.drinkPotion('hp') },
          { name: POTIONS.mana.name, text: POTIONS.mana.text, icon: itemIcon(POTIONS.mana.icon), run: () => g.drinkPotion('mana') },
        ],
      });
    },
  }),
  'time-warp-tonic': (g) => {
    let until = 0;
    return {
      potionMult: () => { until = g.time + 2; return 1; }, // read once per potion: doubles as the "drank" signal
      stat: (k) => (k === 'msPct' && until > g.time ? 0.05 : 0),
    };
  },
  'biscuit-delivery': (g) => {
    let next = 120, mana = 0;
    return {
      tick: () => {
        if (next > 360 || g.time < next) return;
        next += 120;
        mana += 10;
        g.heal(0.08 * (g.maxHp - g.hp));
        g.mana = Math.min(g.maxMana, g.mana + 0.08 * (g.maxMana - g.mana));
      },
      stat: (k) => (k === 'mana' ? mana : 0),
    };
  },
  'cosmic-insight': () => ({ stat: (k) => (k === 'ah' ? 18 : 0) }),
  // shortcut: having a focus target counts, whatever the walking direction; refine if it feels off
  'approach-velocity': (g) => ({ stat: (k) => (k === 'msPct' && g.focus ? 0.075 : 0) }),
  'jack-of-all-trades': (g) => ({
    stat: (k) => {
      const n = Object.values(g.items).filter((v) => v > 0).length;
      return k === 'ah' ? n : k === 'ad' ? (n >= 10 ? 25 : n >= 5 ? 10 : 0) : 0;
    },
  }),
});
