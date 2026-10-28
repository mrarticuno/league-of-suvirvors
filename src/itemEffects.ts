// Item passives: the description shown in the shop plus, when implemented, a factory for the effect's hooks.
// The Game creates one effect per owned item (kept across evolutions of other slots, so cooldowns like Guardian
// Angel's survive) and calls its hooks; an item with no hooks only shows its text. Stats stay in items.json.
// New passive: add an entry here; no Game change is needed unless it needs a brand new hook.
import type { Hit, SkillKey } from './champion';
import type { Enemy, Game } from './game';
import type { ItemStats } from './items';

/** Stats an effect can add to (item stats plus rune-only ones). `range` is attack range in units. */
export type FxStat = keyof ItemStats | 'tenacity' | 'healMult' | 'range';

export interface ItemEffect {
  /** LoL "UNIQUE" passives: of several items in one group only the highest `rank` works. */
  unique?: string;
  rank?: number;
  bonusAd?(): number;
  /** A skill was cast. */
  onCast?(): void;
  /** Extra physical damage for hits that apply on-hit effects. */
  onHit?(e: Enemy, hit: Hit): number;
  /** A basic attack was fired (not its bolts). */
  onAttack?(target: Enemy, damage: number, crit: boolean): void;
  /** `e` took physical damage. */
  onPhysical?(e: Enemy): void;
  tick?(dt: number): void;
  /** The champion took lethal damage: return true if this effect saved them. */
  onLethal?(): boolean;
  /** Multiplier on the attack cooldown of an enemy `dist` units away when it starts an attack. */
  enemyAttackCooldown?(dist: number): number;
  // ---- hooks added for runes (src/runes) ----
  /** Additive bonus to a stat, read every time the stat is derived. */
  stat?(k: FxStat): number;
  /** Multiplier on all damage dealt to `e` by this hit. */
  damageMult?(e: Enemy, hit: Hit): number;
  /** Damage was dealt to `e` (after mitigation). */
  onDealt?(e: Enemy, hit: Hit, dealt: number): void;
  onKill?(e: Enemy): void;
  /** The champion is about to take `amount` (after armor, before shields): return the reduced amount. */
  onHurt?(amount: number): number;
  onStunned?(): void;
  onShield?(): void;
  onHorde?(): void;
  onLevel?(): void;
  /** A skill finished its cast and resolved. */
  onCastResolved?(key: SkillKey): void;
  xpMult?(): number;
  /** Multiplier on what a potion restores. */
  potionMult?(): number;
}

interface ItemPassive { desc: string; effect?: (g: Game) => ItemEffect }

/** Spellblade (Sheen line): after a skill, the next auto deals bonus physical damage. */
const spellblade = (rank: number, bonus: (g: Game) => number) => (g: Game): ItemEffect => {
  let armed = false, cd = 0;
  return {
    unique: 'spellblade', rank,
    tick: (dt) => { cd -= dt; },
    onCast: () => { if (cd <= 0) armed = true; },
    onHit: (_e, hit) => {
      if (!armed || hit.source !== 'auto' || hit.bolt) return 0;
      armed = false;
      cd = 1.5;
      return bonus(g);
    },
  };
};

const SUNFIRE_RANGE = 400;
const BURN: Hit = { type: 'magic', source: 'item' };

export const ITEM_PASSIVES: Record<string, ItemPassive> = {
  '3057': { // Sheen
    desc: 'Lâmina Arcana: após usar uma habilidade, o próximo ataque causa +100% do DdA base.',
    effect: spellblade(0, (g) => g.baseAd),
  },
  '3078': { // Trinity Force
    desc: 'Lâmina Arcana: após usar uma habilidade, o próximo ataque causa +200% do DdA base.',
    effect: spellblade(2, (g) => 2 * g.baseAd),
  },
  '3508': { // Essence Reaver
    desc: 'Lâmina Arcana: próximo ataque após habilidade causa +100% DdA base +40% DdA adicional e restaura mana.',
    effect: spellblade(1, (g) => {
      g.mana = Math.min(g.maxMana, g.mana + 0.1 * (g.maxMana - g.mana));
      return g.baseAd + 0.4 * g.bonusAd;
    }),
  },
  '3004': { // Manamune
    desc: 'Fascínio: recebe DdA adicional igual a 2,5% da Mana máxima.',
    effect: (g) => ({ bonusAd: () => 0.025 * g.maxMana }),
  },
  '6672': { // Kraken Slayer
    desc: 'Derrubar: a cada 3 ataques, causa dano físico adicional (maior contra alvos feridos).',
    effect: (g) => {
      let count = 0;
      return {
        onHit: (e, hit) => (hit.source !== 'auto' || hit.bolt || ++count % 3 ? 0
          : (140 + 0.45 * g.bonusAd) * (1 + 0.75 * (1 - e.hp / e.maxHp))),
      };
    },
  },
  '3153': { // Blade of the Ruined King
    desc: 'Gume da Névoa: ataques causam 6% da Vida atual do alvo como dano físico.',
    effect: () => ({ onHit: (e) => Math.min(e.def.tier === 'epic' ? Infinity : 100, 0.06 * e.hp) }),
  },
  '3031': { desc: '+30% de dano de acerto crítico.' }, // Infinity Edge: the bonus is the critDamage stat
  '3071': { // Black Cleaver
    desc: 'Talhar: dano físico reduz a Armadura do alvo em 6% (acumula 5x).',
    effect: (g) => ({
      onPhysical: (e) => {
        e.shred = e.shredUntil > g.time ? Math.min(5, e.shred + 1) : 1;
        e.shredUntil = g.time + 6;
      },
    }),
  },
  '3026': { // Guardian Angel
    desc: 'Renascimento: ao sofrer dano letal, revive com 50% da Vida base (1x a cada 5 min).',
    effect: (g) => {
      let readyAt = 0;
      return {
        onLethal: () => {
          if (g.time < readyAt) return false;
          readyAt = g.time + 300;
          g.enterStasis(4, () => {
            g.hp = 0.5 * g.baseHp;
            g.mana = g.maxMana;
          });
          return true;
        },
      };
    },
  },
  '3110': { // Frozen Heart
    desc: 'Carícia do Inverno: inimigos próximos atacam 20% mais devagar.',
    effect: () => ({ enemyAttackCooldown: (dist) => (dist < 700 ? 1.25 : 1) }),
  },
  '3085': { // Runaan's Hurricane
    desc: 'Fúria do Vento: ataques disparam projéteis em até 2 inimigos próximos, causando 55% do dano e efeitos ao acertar.',
    effect: (g) => ({
      onAttack: (target, damage, crit) => {
        let last = target;
        for (let i = 0; i < 2; i++) {
          const extra = g.nearestEnemy(g.pos, g.attackReach, (e) => e !== target && e !== last && g.inAttackRange(e));
          if (!extra) break;
          last = extra;
          g.basicAttack(extra, 0.55 * damage, crit, true);
        }
      },
    }),
  },
  '3068': { // Sunfire Aegis
    desc: 'Imolação: queima inimigos próximos, causando dano mágico por segundo (aumenta com nível e Vida adicional).',
    effect: (g) => {
      let timer = 0;
      const near: Enemy[] = [];
      return {
        tick: (dt) => {
          if ((timer -= dt) > 0) return;
          timer = 1;
          const dmg = 15 + 3 * g.level + 0.02 * g.items.hp;
          for (const e of g.enemiesNear(g.pos, SUNFIRE_RANGE, near)) {
            if (e.deadFor < 0 && e.pos.distanceTo(g.pos) - e.def.radius <= SUNFIRE_RANGE) g.hurtEnemy(e, dmg, BURN);
          }
        },
      };
    },
  },
};

export const PASSIVES: Record<string, string> = Object.fromEntries(Object.entries(ITEM_PASSIVES).map(([id, p]) => [id, p.desc]));
