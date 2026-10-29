// Rune catalog: LoL rune trees adapted to the survivors loop (see docs/superpowers/specs/2026-10-28-rune-pages-design.md).
// Each tree file exports its runes; an effect reuses the item hook interface (src/itemEffects.ts), so the Game runs
// rune effects in the same loops as item passives. Unlocking and page rules live in src/progress.ts.
import type { Game } from '../game';
import type { FxStat, ItemEffect } from '../itemEffects';
import type { Page } from '../progress';
import { ADAPTIVE_AD, IMG, type RuneDef, type TreeId } from './def';
import { DOMINATION } from './domination';
import { INSPIRATION } from './inspiration';
import { PRECISION } from './precision';
import { RESOLVE } from './resolve';
import { SORCERY } from './sorcery';
import { t, type Key } from '../i18n';

export { ADAPTIVE_AD, runeList, type RuneDef, type TreeId } from './def';

export const TREES: Record<TreeId, { name: string; icon: string }> = {
  precision: { name: t('tree.precision'), icon: `${IMG}Styles/7201_Precision.png` },
  domination: { name: t('tree.domination'), icon: `${IMG}Styles/7200_Domination.png` },
  sorcery: { name: t('tree.sorcery'), icon: `${IMG}Styles/7202_Sorcery.png` },
  resolve: { name: t('tree.resolve'), icon: `${IMG}Styles/7204_Resolve.png` },
  inspiration: { name: t('tree.inspiration'), icon: `${IMG}Styles/7203_Whimsy.png` },
};
export const TREE_IDS = Object.keys(TREES) as TreeId[];

export const RUNES: Record<string, RuneDef> = Object.fromEntries(
  [...PRECISION, ...DOMINATION, ...SORCERY, ...RESOLVE, ...INSPIRATION].map((r) => [r.id, r]),
);

export const runesOf = (tree: TreeId, row?: number) =>
  Object.values(RUNES).filter((r) => r.tree === tree && (row === undefined || r.row === row));


export type ShardStat = 'adaptive' | 'as' | 'ah' | 'ms' | 'hpScaling' | 'hp' | 'tenacity';
const shard = (stat: ShardStat, icon: string) => ({ name: t(`shard.${stat}` as Key), stat, icon: `${IMG}StatMods/${icon}.png` });
const ADAPTIVE = shard('adaptive', 'StatModsAdaptiveForceIcon');
const HP_SCALING = shard('hpScaling', 'StatModsHealthScalingIcon');
/** Stat shards: 3 rows (offense, flex, defense), one pick per row; rows are unlocked whole. */
export const SHARDS = [
  [ADAPTIVE, shard('as', 'StatModsAttackSpeedIcon'), shard('ah', 'StatModsCDRScalingIcon')],
  [ADAPTIVE, shard('ms', 'StatModsMovementSpeedIcon'), HP_SCALING],
  [shard('hp', 'StatModsHealthPlusIcon'), shard('tenacity', 'StatModsTenacityIcon'), HP_SCALING],
];

/** Stats granted by the picked shards at `level`. */
export function shardStats(shards: (number | null)[], level: number) {
  const out: Partial<Record<FxStat, number>> = {};
  const add = (k: FxStat, v: number) => { out[k] = (out[k] ?? 0) + v; };
  shards.forEach((pick, row) => {
    if (pick === null) return;
    const stat = SHARDS[row][pick]?.stat;
    if (stat === 'adaptive') add('ad', 9 * ADAPTIVE_AD);
    else if (stat === 'as') add('as', 0.1);
    else if (stat === 'ah') add('ah', 8);
    else if (stat === 'ms') add('msPct', 0.02);
    else if (stat === 'hpScaling') add('hp', 10 + (170 * (level - 1)) / 17);
    else if (stat === 'hp') add('hp', 65);
    else if (stat === 'tenacity') add('tenacity', 0.15);
  });
  return out;
}

/** Fresh effects (no state carried between runs) for the equipped runes, plus one for the shards. */
export function runeEffects(g: Game, page: Page): ItemEffect[] {
  const ids = [page.keystone, ...page.primaryRunes, ...page.secondaryRunes];
  const out: ItemEffect[] = [];
  for (const id of ids) {
    const make = id ? RUNES[id]?.effect : undefined;
    if (make) out.push(make(g));
  }
  out.push({ stat: (k) => shardStats(page.shards, g.level)[k] ?? 0 });
  return out;
}
