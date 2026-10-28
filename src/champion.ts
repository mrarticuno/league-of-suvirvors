// Champion contract. A champion is data (ChampionDef: stats, skill ranks, animations, VFX keys) plus a kit: the
// per-run object that resolves its skills and owns its peculiarities (passive stacks, marks, ...). The Game runs the
// generic parts (movement, auto attacks, cooldowns, mana, items, damage pipeline) and calls the kit's hooks.
// New champion: add src/champions/<name>.ts exporting a ChampionDef and register it in src/champions/index.ts.
// Sound keys follow `${id}_<event>`: _auto, _auto2, _crit, _auto_hit, _crit_hit, _<Q|W|E|R>, _death.
import type * as THREE from 'three';
import type { Enemy, Game } from './game';

export type SkillKey = 'Q' | 'W' | 'E' | 'R';
export const SKILL_KEYS: readonly SkillKey[] = ['Q', 'W', 'E', 'R'];
export const MAX_CHAMPION_LEVEL = 18;

export type DamageType = 'physical' | 'magic';

/** What a hit is: decides mitigation, which item effects apply and what the champion's passives react to. */
export interface Hit {
  type: DamageType;
  source: 'auto' | 'ability' | 'item';
  skill?: SkillKey;
  onHit?: boolean; // applies on-hit item effects (autos do; some abilities too, e.g. Mystic Shot)
  crit?: boolean;
  bolt?: boolean; // secondary auto (Runaan's Hurricane): on-hit applies, "on attack" effects don't
}

/** LoL base stats; `*PerLevel` values use the LoL growth formula. */
export interface BaseStats {
  hp: number; hpPerLevel: number;
  hpRegen5: number; hpRegen5PerLevel: number; // per 5 seconds, like LoL
  mana: number; manaPerLevel: number;
  manaRegen5: number; manaRegen5PerLevel: number;
  ad: number; adPerLevel: number;
  attackSpeed: number; attackSpeedPerLevel: number;
  attackRange: number;
  moveSpeed: number;
  critDamage: number;
  windupPercent: number; // attackCastTime / attackTotalTime
  missileSpeed: number;
  radius: number;
  armor: number; armorPerLevel: number;
}

export interface SkillDef {
  name: string;
  maxRank: number;
  cooldown: readonly number[];
  cost: readonly number[];
  castTime: number; // the champion stands still this long, then the kit resolves the skill
  anim: string;
  icon: string;
}

export interface ChampionDef {
  id: string; // prefix of the sound keys
  name: string;
  model: string;
  base: BaseStats;
  skills: Readonly<Record<SkillKey, SkillDef>>;
  /** Levels that unlock each R rank (default LoL 6/11/16); basic skills follow the LoL rule. */
  ultimateLevels?: readonly number[];
  passive: { name: string; icon: string };
  anims: { idle: string; run: string; death: string; attacks: readonly string[]; crit: string };
  /** Particle systems of the basic attack (missile and impact, normal and crit). */
  vfx: { auto: string; crit: string; autoHit: string; critHit: string };
  kit: (g: Game) => ChampionKit;
}

/** Per-run champion logic. Only `cast` is required. */
export interface ChampionKit {
  /** Resolves a skill once its cast time ends. `rank` is 0-based. */
  cast(key: SkillKey, rank: number, point: THREE.Vector3): void;
  /** When the cast starts (cast VFX). */
  castStart?(key: SkillKey, point: THREE.Vector3): void;
  /** Bonus attack speed (fraction) from the champion's own mechanics. */
  attackSpeedBonus?(): number;
  /** Extra magic damage added to a hit on `e` before mitigation (e.g. a mark detonating). */
  onDamage?(e: Enemy, hit: Hit): number;
  update?(dt: number): void;
  dispose?(): void;
  /** Passive status line on the HUD. */
  hud?(): string;
}
