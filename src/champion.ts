// Champion contract. A champion is data (ChampionDef: stats, skill ranks, animations, VFX keys) plus a kit: the
// per-run object that resolves its skills and owns its peculiarities (passive stacks, marks, ...). The Game runs the
// generic parts (movement, auto attacks, cooldowns, mana, items, damage pipeline) and calls the kit's hooks.
// New champion: add src/champions/<name>.ts exporting a ChampionDef and register it in src/champions/index.ts.
// Sound keys follow `${id}_<event>`: _auto, _auto2, _crit, _auto_hit, _crit_hit, _<Q|W|E|R>, _death.
import type * as THREE from 'three';
import type { Enemy, Game } from './game';
import type { FxStat } from './itemEffects';
import type { ItemPool } from './items';

export type SkillKey = 'Q' | 'W' | 'E' | 'R';
export const SKILL_KEYS: readonly SkillKey[] = ['Q', 'W', 'E', 'R'];
export const MAX_CHAMPION_LEVEL = 18;

export type DamageType = 'physical' | 'magic';

/** What a hit is: decides mitigation, which item effects apply and what the champion's passives react to. */
export interface Hit {
  type: DamageType | 'true'; // true damage ignores armor and MR (item procs)
  source: 'auto' | 'ability' | 'item'; // 'item': procs and damage over time (item burns, Brand's Blaze) that trigger nothing
  skill?: SkillKey;
  onHit?: boolean; // applies on-hit item effects (autos do; some abilities too, e.g. Mystic Shot)
  crit?: boolean;
  bolt?: boolean; // secondary auto (Runaan's Hurricane): on-hit applies, "on attack" effects don't
  onHitMult?: number; // on-hit item damage effectiveness (default 1; Onslaught: 0.25)
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
  /** Castable from this champion level regardless of its ranks (champions whose skill points buy stats, e.g. Aphelios). */
  unlockLevel?: number;
  /** Level-up card (src/ui.ts): what the skill does, t('champion.<id>.<K>.desc'), and the numbers it shows per rank. */
  desc: string;
  damageType: DamageType;
  damage: readonly number[]; // base damage per rank (per hit)
  adRatio?: number | readonly number[]; // total AD ratio (per rank when a list)
  bonusAdRatio?: number;
  apRatio?: number; // ability power ratio
  hits?: number; // damage instances per cast (Blade Whirl: 2, Inferno Trigger: 10 volleys)
  extra?: { label: string; values: readonly number[]; percent?: boolean }; // one more per-rank number (a buff)
}

/** The champion stats a skill's numbers depend on. */
export interface SkillStats { ad: number; bonusAd: number; ap: number; haste: number }

/** One cast at rank index `r` (0-based): damage per hit and per cast, cooldown after ability haste, damage per second. */
export function skillNumbers(s: SkillDef, r: number, st: SkillStats) {
  const ratio = typeof s.adRatio === 'number' ? s.adRatio : (s.adRatio?.[r] ?? 0);
  const perHit = s.damage[r] + ratio * st.ad + (s.bonusAdRatio ?? 0) * st.bonusAd + (s.apRatio ?? 0) * st.ap;
  const damage = perHit * (s.hits ?? 1);
  const cooldown = s.cooldown[r] * (100 / (100 + st.haste));
  return { perHit, damage, cooldown, cost: s.cost[r], dps: cooldown > 0 ? damage / cooldown : 0 };
}

/**
 * Level-up advice, higher is better: the ultimate first, then a skill not learned yet, then the rank that adds the
 * largest share of damage per second. `rank` is the current rank (0 = not learned).
 */
export function skillScore(key: SkillKey, s: SkillDef, rank: number, st: SkillStats) {
  if (key === 'R') return 1000;
  if (rank === 0) return 500;
  return dpsGain(s, rank, st);
}

/** Percent of damage per second the next rank adds (0 for a skill not learned yet). */
export function dpsGain(s: SkillDef, rank: number, st: SkillStats) {
  if (rank === 0) return 0;
  const now = skillNumbers(s, rank - 1, st).dps, next = skillNumbers(s, rank, st).dps;
  return now > 0 ? ((next - now) / now) * 100 : 0;
}

export const ROLES = ['marksman', 'assassin', 'fighter', 'mage', 'tank', 'support'] as const;
/** Champion class (role.<id> in src/locales). */
export type Role = (typeof ROLES)[number];

/** A particle system key and the bone it rides. */
export type BoneVfx = readonly [key: string, bone: string];

export interface ChampionDef {
  id: string; // prefix of the sound keys
  name: string; // player-facing: t('champion.<id>.name')
  icon: string; // portrait (Data Dragon img/champion/<Champ>.png)
  title: string; // epithet under the name on champion select: t('champion.<id>.title') (Data Dragon `title`, zh: `name`)
  splash: string; // champion select art (Data Dragon img/champion/splash/<Champ>_0.jpg)
  roles: readonly Role[]; // champion select filters: the Data Dragon tags
  difficulty: number; // Data Dragon info.difficulty, 1-10
  model: string;
  /** Model size multiplier, for exports smaller than the other champions (default 1). */
  scale?: number;
  /** Submeshes hidden at load (the skin bin's initialSubmeshToHide). */
  hide?: readonly string[];
  /** Submeshes with their own texture (the skin bin's materialOverride): submesh name -> texture file stem. */
  textures?: Readonly<Record<string, string>>;
  base: BaseStats;
  skills: Readonly<Record<SkillKey, SkillDef>>;
  /** Champion level that unlocks each rank of a skill (default LoL: basic 1/3/5/7/9, R 6/11/16). */
  rankLevels?: Partial<Record<SkillKey, readonly number[]>>;
  /** Skills ranked automatically when their rank level comes, without a skill point (Aphelios' R). */
  autoRank?: readonly SkillKey[];
  passive: { name: string; icon: string };
  anims: { idle: string; run: string; death: string; attacks: readonly string[]; crit: string };
  /** Particle systems of the basic attack (missile and impact, normal and crit) and of the death animation. */
  vfx: { auto: string; crit: string; autoHit: string; critHit: string; death?: readonly BoneVfx[] };
  /** Systems riding bones for the whole run (the skin's idleParticlesEffects, e.g. a body of flames); stop on death. */
  idleVfx?: readonly BoneVfx[];
  /** Items offered on level up (src/items.ts ItemPool): attack or ability power items; default 'ad'. */
  itemPool?: ItemPool;
  /** Recommended items (current build-site core, in buy order): offered more often and marked on level up. */
  build: readonly string[];
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
  /** Stats from the champion's own mechanics, on top of items and runes (e.g. points spent on attack damage). */
  stat?(k: FxStat): number;
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
  /** Target for the next basic attack given the default pick (null: none in range); may be out of range (long-range marks). */
  attackTarget?(target: Enemy | null): Enemy | null;
  /** The basic attack starting on `target`: animation, cast sound and windup share when it changes (e.g. per weapon). */
  attackStart?(target: Enemy, crit: boolean): { anim?: string; sound?: string; windupPercent?: number } | undefined;
  /** Fires the ranged basic attack (also secondary `bolt`s) instead of the default missile; false keeps the default. */
  basicAttack?(target: Enemy, damage: number, crit: boolean, bolt: boolean): boolean;
  /** Idle and run animations right now, when they change (e.g. per weapon); default `ChampionDef.anims`. */
  moveAnims?(): { idle: string; run: string } | undefined;
  /** Base cooldown of the next cast (before ability haste) when it is not `SkillDef.cooldown` (e.g. per weapon). */
  cooldownBase?(key: SkillKey): number | undefined;
  /** Cast time of the next cast when it is not `SkillDef.castTime` (e.g. per weapon). */
  castTime?(key: SkillKey): number | undefined;
  /** Extra magic damage added to a hit on `e` before mitigation (e.g. a mark detonating). */
  onDamage?(e: Enemy, hit: Hit): number;
  /** `hit` killed `e` (e.g. a passive that restores mana on kills). */
  onKill?(e: Enemy, hit: Hit): void;
  /** `hit` dealt `dealt` to `e` after mitigation (e.g. healing for a share of it). */
  onDealt?(e: Enemy, hit: Hit, dealt: number): void;
  update?(dt: number): void;
  dispose?(): void;
  /** Passive status line on the HUD. */
  hud?(): string;
  /** Passive gauge next to the skills (e.g. a stack grade): big label, fill 0..1, `ready` glows it and `skill`'s slot; `icon` replaces the passive's. */
  gauge?(): { label: string; fill: number; ready: boolean; skill?: SkillKey; icon?: string };
  /** A skill slot's look right now when it changes (e.g. per weapon): icon, name (tooltip) and a small badge (ammo). */
  skillView?(key: SkillKey): { icon?: string; name?: string; badge?: string } | undefined;
  /** Small icons shown above the skills (e.g. a weapon queue). */
  tray?(): readonly { icon: string; title: string; label?: string }[];
}
