// Jungle buffs: killing the blue or red sentinel drops its buff on the ground; walking over it grants the buff.
// Each buff is an always-present ItemEffect that only works while its timer runs, so the Game needs no list juggling.
import type { Game } from './game';
import type { ItemEffect } from './itemEffects';
import { t } from './i18n';

export type BuffKey = 'blue' | 'red';

export const BUFF = {
  duration: 180, // seconds the buff lasts once collected
  dropLife: 10, // seconds the drop stays on the ground before vanishing
  names: { blue: t('buff.blue'), red: t('buff.red') } as Record<BuffKey, string>,
  colors: { blue: 0x3d8bff, red: 0xff4a2a } as Record<BuffKey, number>,
};

export const isBuffMonster = (model: string): model is BuffKey => model === 'blue' || model === 'red';

export function buffEffects(g: Game): ItemEffect[] {
  const on = (k: BuffKey) => g.time < g.buffs[k];
  const blue: ItemEffect = {
    // Crest of Insight: ability haste and mana regen (1% max mana/s)
    stat: (k) => (k === 'ah' && on('blue') ? 20 : 0),
    tick: (dt) => { if (on('blue')) g.mana = Math.min(g.maxMana, g.mana + 0.01 * g.maxMana * dt); },
  };
  const red: ItemEffect = {
    // Crest of Cinders: on-hit burn that scales with level, a short slow, and HP regen (0.5% max HP/s)
    tick: (dt) => { if (on('red')) g.heal(0.005 * g.maxHp * dt); },
    onHit: (e) => {
      if (!on('red')) return 0;
      g.slow(e, 0.1, 1.5);
      return 8 + 2 * g.level;
    },
  };
  return [blue, red];
}
