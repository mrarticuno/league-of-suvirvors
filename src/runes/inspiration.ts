import type { Enemy } from '../game';
import { itemIcon } from '../items';
import { IMG, isBig, runeList } from './def';

const SPELLBOOK = [
  { name: '+15 DdA', stat: 'ad', value: 15, icon: 'StatMods/StatModsAdaptiveForceIcon.png' },
  { name: '+15% Vel. de Ataque', stat: 'as', value: 0.15, icon: 'StatMods/StatModsAttackSpeedIcon.png' },
  { name: '+15 Aceleração de Habilidade', stat: 'ah', value: 15, icon: 'StatMods/StatModsCDRScalingIcon.png' },
] as const;

export const INSPIRATION = runeList('inspiration', [
  ['glacial-augment', 'Aprimoramento Glacial', 0, 'Styles/Inspiration/GlacialAugment/GlacialAugment.png',
    'O primeiro ataque em um alvo o deixa 30% mais lento por 2s.'],
  ['unsealed-spellbook', 'Livro de Feitiços Deslacrado', 0, 'Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png',
    'A cada 2 min, escolha o atributo bônus da partida: DdA, Vel. de Ataque ou Aceleração de Habilidade.'],
  ['first-strike', 'Primeiro Ataque', 0, 'Styles/Inspiration/FirstStrike/FirstStrike.png',
    'Causar o primeiro dano a um elite ou épico concede +7% de dano contra ele por 3s.'],
  ['hextech-flashtraption', 'Flashtração Hextec', 1, 'Styles/Inspiration/HextechFlashtraption/HextechFlashtraption.png',
    'Habilita Flash na tecla D: avança 400 unidades até o cursor. Recarga de 120s.'],
  ['magical-footwear', 'Calçados Mágicos', 1, 'Styles/Inspiration/MagicalFootwear/MagicalFootwear.png',
    'Aos 6 min, +10% de Vel. de Movimento permanente; cada 300 abates antecipa o bônus em 30s.'],
  ['cash-back', 'Reembolso', 1, 'Styles/Inspiration/CashBack/CashBack2.png',
    '+10% de XP dos abates.'],
  ['triple-tonic', 'Tônico Triplo', 2, 'Styles/Inspiration/PerfectTiming/AlchemistCabinet.png',
    'Nos níveis 3, 6 e 9, escolha uma poção grátis.'],
  ['time-warp-tonic', 'Tônico de Distorção no Tempo', 2, 'Styles/Inspiration/TimeWarpTonic/TimeWarpTonic.png',
    'Poções concedem +5% de Vel. de Movimento por 2s.'],
  ['biscuit-delivery', 'Entrega de Biscoitos', 2, 'Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png',
    'A cada 2 min até os 6 min, restaura 8% da Vida e da Mana faltantes e concede +10 de Mana máxima.'],
  ['cosmic-insight', 'Perspicácia Cósmica', 3, 'Styles/Inspiration/CosmicInsight/CosmicInsight.png',
    '+18 de Aceleração de Habilidade.'],
  ['approach-velocity', 'Velocidade de Aproximação', 3, 'Styles/Resolve/ApproachVelocity/ApproachVelocity.png',
    '+7,5% de Vel. de Movimento ao andar em direção a um inimigo lento ou ao alvo em foco.'],
  ['jack-of-all-trades', 'Quebra-galho', 3, 'Styles/Inspiration/JackOfAllTrades/JackofAllTrades2.png',
    '+1 de Aceleração de Habilidade por atributo diferente nos itens. Com 5 atributos, +10 de DdA; com 10, +25.'],
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
          title: 'Livro de Feitiços Deslacrado — escolha o atributo',
          options: SPELLBOOK.map((o) => ({ name: o.name, text: 'Substitui a escolha anterior.', icon: IMG + o.icon, run: () => { picked = o; } })),
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
        title: 'Tônico Triplo — poção grátis',
        options: [
          { name: 'Poção de Vida', text: 'Restaura 20% da Vida máxima.', icon: itemIcon('2003'), run: () => g.drinkPotion('hp') },
          { name: 'Poção de Mana', text: 'Restaura 20% da Mana máxima.', icon: itemIcon('2031'), run: () => g.drinkPotion('mana') },
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
