// Item passives: the description shown on level up plus, when implemented, a factory for the effect's hooks.
// The Game creates one effect per owned item once its passive unlocks (items.ts PASSIVE_POWER) and calls its hooks;
// `power()` is the passive's current strength (0..1, 1 at max level): effects scale their numbers by it, all-or-nothing
// effects (revive, spell shield) their cooldown. The text shows the max-level numbers. Stats stay in items.json.
// Passives live in src/itemPassives/ (ad, ap, tank; shared mechanics in shared.ts). New passive: add an entry there;
// no Game change is needed unless it needs a brand new hook.
import type { Hit, SkillKey } from './champion';
import type { Enemy, Game } from './game';
import type { ItemStats } from './items';
import { AD_PASSIVES } from './itemPassives/ad';
import { AP_PASSIVES } from './itemPassives/ap';
import { TANK_PASSIVES } from './itemPassives/tank';

/** Stats an effect can add to (item stats plus rune-only ones). `range` is attack range in units; `*Haste` only count for R / Q W E. */
export type FxStat = keyof ItemStats | 'tenacity' | 'healMult' | 'range' | 'ultHaste' | 'basicHaste';

export interface ItemEffect {
  /** LoL "UNIQUE" passives: of several items in one group only the highest `rank` works. */
  unique?: string;
  rank?: number;
  bonusAd?(): number;
  /** A skill was cast. */
  onCast?(): void;
  /** Extra physical damage for hits that apply on-hit effects. */
  onHit?(e: Enemy, hit: Hit): number;
  /** Extra magic damage for hits that apply on-hit effects. */
  onHitMagic?(e: Enemy, hit: Hit): number;
  /** A basic attack was fired (not its bolts). */
  onAttack?(target: Enemy, damage: number, crit: boolean): void;
  /** `e` took physical damage. */
  onPhysical?(e: Enemy): void;
  /** `e` took magic damage. */
  onMagic?(e: Enemy): void;
  tick?(dt: number): void;
  /** Run save (src/runSave.ts): state that outlives a fight (permanent stacks), as JSON, and putting it back on load. */
  saved?(): unknown;
  restore?(v: unknown): void;
  /** The champion took lethal damage: return true if this effect saved them. */
  onLethal?(): boolean;
  /** Multiplier on the attack cooldown of an enemy `dist` units away when it starts an attack. */
  enemyAttackCooldown?(dist: number): number;
  /** A melee enemy's basic attack landed on the champion. */
  onStruck?(e: Enemy): void;
  /** Healing beyond max HP (Bloodthirster). */
  onOverheal?(excess: number): void;
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

/** `desc`: t('item.<id>.passive'), numbers at max level. `effect(g, power)`: power() is 0..1 (see top of file). */
export interface ItemPassive { desc: string; effect?: (g: Game, power: () => number) => ItemEffect }

export const ITEM_PASSIVES: Record<string, ItemPassive> = { ...AD_PASSIVES, ...AP_PASSIVES, ...TANK_PASSIVES };

export const PASSIVES: Record<string, string> = Object.fromEntries(Object.entries(ITEM_PASSIVES).map(([id, p]) => [id, p.desc]));
