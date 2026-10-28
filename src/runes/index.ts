// Rune catalog: LoL rune trees adapted to the survivors loop (see docs/superpowers/specs/2026-10-28-rune-pages-design.md).
// Each tree file exports its runes; an effect reuses the item hook interface (src/itemEffects.ts), so the Game runs
// rune effects in the same loops as item passives. Unlocking and page rules live in src/progress.ts.
import { IMG, type RuneDef, type TreeId } from './def';
import { DOMINATION } from './domination';
import { INSPIRATION } from './inspiration';
import { PRECISION } from './precision';
import { RESOLVE } from './resolve';
import { SORCERY } from './sorcery';

export { runeList, type RuneDef, type TreeId } from './def';

export const TREES: Record<TreeId, { name: string; icon: string }> = {
  precision: { name: 'Precisão', icon: `${IMG}Styles/7201_Precision.png` },
  domination: { name: 'Dominação', icon: `${IMG}Styles/7200_Domination.png` },
  sorcery: { name: 'Feitiçaria', icon: `${IMG}Styles/7202_Sorcery.png` },
  resolve: { name: 'Determinação', icon: `${IMG}Styles/7204_Resolve.png` },
  inspiration: { name: 'Inspiração', icon: `${IMG}Styles/7203_Whimsy.png` },
};
export const TREE_IDS = Object.keys(TREES) as TreeId[];

export const RUNES: Record<string, RuneDef> = Object.fromEntries(
  [...PRECISION, ...DOMINATION, ...SORCERY, ...RESOLVE, ...INSPIRATION].map((r) => [r.id, r]),
);

export const runesOf = (tree: TreeId, row?: number) =>
  Object.values(RUNES).filter((r) => r.tree === tree && (row === undefined || r.row === row));

export const ADAPTIVE_AD = 0.6; // no AP in this game: adaptive force is bonus AD at LoL's conversion

export type ShardStat = 'adaptive' | 'as' | 'ah' | 'ms' | 'hpScaling' | 'hp' | 'tenacity';
const shard = (name: string, stat: ShardStat, icon: string) => ({ name, stat, icon: `${IMG}StatMods/${icon}.png` });
const ADAPTIVE = shard('Força adaptativa +9', 'adaptive', 'StatModsAdaptiveForceIcon');
const HP_SCALING = shard('Vida +10–180 (por nível)', 'hpScaling', 'StatModsHealthScalingIcon');
/** Stat shards: 3 rows (offense, flex, defense), one pick per row; rows are unlocked whole. */
export const SHARDS = [
  [ADAPTIVE, shard('Vel. de ataque +10%', 'as', 'StatModsAttackSpeedIcon'), shard('Aceleração de habilidade +8', 'ah', 'StatModsCDRScalingIcon')],
  [ADAPTIVE, shard('Vel. de movimento +2%', 'ms', 'StatModsMovementSpeedIcon'), HP_SCALING],
  [shard('Vida +65', 'hp', 'StatModsHealthPlusIcon'), shard('Tenacidade +15%', 'tenacity', 'StatModsTenacityIcon'), HP_SCALING],
];
