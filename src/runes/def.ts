// Rune definition types, shared by the catalog (index.ts) and the tree files (kept apart to avoid an import cycle).
import type { Hit } from '../champion';
import type { Enemy, Game } from '../game';
import type { ItemEffect } from '../itemEffects';

export type TreeId = 'precision' | 'domination' | 'sorcery' | 'resolve' | 'inspiration';

export interface RuneDef {
  id: string;
  name: string;
  tree: TreeId;
  row: 0 | 1 | 2 | 3; // 0 = keystone
  icon: string;
  desc: string;
  effect?: (g: Game) => ItemEffect;
}

export const ADAPTIVE_AD = 0.6; // no AP in this game: adaptive force is bonus AD at LoL's conversion
export const IMG = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/';

/** Builds a tree's rune list; `icon` is the path under perk-images/, `effects` maps rune id to its effect. */
export const runeList = (
  tree: TreeId,
  list: [id: string, name: string, row: RuneDef['row'], icon: string, desc: string][],
  effects: Record<string, (g: Game) => ItemEffect> = {},
) => list.map(([id, name, row, icon, desc]): RuneDef => ({ id, name, tree, row, icon: IMG + icon, desc, effect: effects[id] }));

/** Rune damage: its own source, so rune procs never count as hits for other runes (no proc loops). */
export const RUNE_HIT: Hit = { type: 'physical', source: 'item' };
export const RUNE_MAGIC: Hit = { type: 'magic', source: 'item' }; // no magic resist here: magic acts as true damage
/** "Champion" in a LoL rune: elite and epic monsters. */
export const isBig = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic';
/** A hit from the champion's own attacks or skills (not item or rune procs). */
export const isOwnHit = (hit: Hit) => hit.source !== 'item';

