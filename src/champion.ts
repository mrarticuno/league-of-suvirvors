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
  name: string; // player-facing: t('champion.<id>.<K>')
  maxRank: number;
  cooldown: readonly number[];
  cost: readonly number[];
  castTime: number; // the champion stands still this long, then the kit resolves the skill
  anim: string;
  icon: string;
  /**
   * How the skill aims while moving with the arrow keys (the cursor is not being used then):
   * a number auto-aims at the marked target, else the nearest enemy within that range (skillshots, targeted dashes);
   * 'move' casts along the movement direction (free dashes and blinks); 'none' ignores the point (self casts).
   */
  aim: number | 'move' | 'none';
}

export interface ChampionDef {
  id: string; // prefix of the sound keys
  name: string; // player-facing: t('champion.<id>.name')
  icon: string; // portrait (Data Dragon img/champion/<Champ>.png)
  model: string;
  /** Submeshes hidden at load (the skin bin's initialSubmeshToHide). */
  hide?: readonly string[];
  /** Submeshes with their own texture (the skin bin's materialOverride): submesh name -> texture file stem. */
  textures?: Readonly<Record<string, string>>;
  base: BaseStats;
  skills: Readonly<Record<SkillKey, SkillDef>>;
  /** Levels that unlock each R rank (default LoL 6/11/16); basic skills follow the LoL rule. */
  ultimateLevels?: readonly number[];
  passive: { name: string; icon: string };
  anims: { idle: string; run: string; death: string; attacks: readonly string[]; crit: string };
  /** Particle systems of the basic attack (missile and impact, normal and crit). */
  vfx: { auto: string; crit: string; autoHit: string; critHit: string };
  /**
   * Close-range basic attack (e.g. a blade) used instead of the missile when the kit's `meleeAuto` says so:
   * no missile, the hit lands at the end of the windup. Sounds: `<id>_melee`, `_melee2`, `_melee_crit`, `_melee_hit`, `_melee_crit_hit`.
   */
  melee?: { attacks: readonly string[]; crit: string; vfx: { swing: readonly string[]; crit: string; hit: readonly string[]; critHit: string } };
  kit: (g: Game) => ChampionKit;
}

/** Per-run champion logic. Only `cast` is required. */
export interface ChampionKit {
  /** Resolves a skill once its cast time ends. `rank` is 0-based. */
  cast(key: SkillKey, rank: number, point: THREE.Vector3): void;
  /** Animation for this cast when the skill has more than one form (e.g. gun or blade); default `SkillDef.anim`. */
  castAnim?(key: SkillKey, point: THREE.Vector3): string | undefined;
  /** When the cast starts (cast VFX). */
  castStart?(key: SkillKey, point: THREE.Vector3): void;
  /** Bonus attack speed (fraction) from the champion's own mechanics. */
  attackSpeedBonus?(): number;
  /** Bonus (or, negative, reduced) movement speed (fraction) from the champion's own mechanics. */
  moveSpeedBonus?(): number;
  /** Extra cast condition checked before mana and cooldown are spent (e.g. an ultimate that needs stacks). */
  canCast?(key: SkillKey): boolean;
  /** True while the champion's own mechanics forbid basic attacks (e.g. a channel that replaces them). */
  disarmed?(): boolean;
  /** True when the basic attack about to start on `target` is the champion's melee one (`ChampionDef.melee`). */
  meleeAuto?(target: Enemy): boolean;
  /** Extra magic damage added to a hit on `e` before mitigation (e.g. a mark detonating). */
  onDamage?(e: Enemy, hit: Hit): number;
  update?(dt: number): void;
  dispose?(): void;
  /** Passive status line on the HUD. */
  hud?(): string;
  /** Passive gauge next to the skills (e.g. a stack grade): big label, fill 0..1, `ready` glows it and `skill`'s slot. */
  gauge?(): { label: string; fill: number; ready: boolean; skill?: SkillKey };
}
