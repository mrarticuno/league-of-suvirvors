// Rune definition types, shared by the catalog (index.ts) and the tree files (kept apart to avoid an import cycle).
import type { Game } from '../game';
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

export const IMG = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/';

/** Builds a tree's rune list; `icon` is the path under perk-images/. */
export const runeList = (tree: TreeId, list: [id: string, name: string, row: RuneDef['row'], icon: string, desc: string][]) =>
  list.map(([id, name, row, icon, desc]): RuneDef => ({ id, name, tree, row, icon: IMG + icon, desc }));

