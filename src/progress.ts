// Rune meta-progression: points earned from kills, permanent unlocks and the page equipped per champion.
// Pure functions (they return new objects); storage is passed in so tests run without a browser.
import { RUNES, type TreeId } from './runes';

export const KILLS_PER_POINT = 100;
export const NODE_COST_STEP = 8; // the n-th node unlocked in a tree costs 8 × n
export const SHARD_ROW_COST = [20, 40, 60];
const KEY = 'los.runes.v1';

export interface Page {
  primary: TreeId | null;
  keystone: string | null;
  primaryRunes: (string | null)[]; // rows 1-3 of the primary tree
  secondary: TreeId | null;
  secondaryRunes: string[]; // up to 2, oldest first
  shards: (number | null)[]; // picked index per shard row
}

export interface Progress {
  points: number;
  killRemainder: number;
  unlocked: string[];
  shardRows: number[];
  pages: Record<string, Page>; // last page used, per champion id
}

export const emptyPage = (): Page => ({
  primary: null, keystone: null, primaryRunes: [null, null, null], secondary: null, secondaryRunes: [], shards: [null, null, null],
});
export const emptyProgress = (): Progress => ({ points: 0, killRemainder: 0, unlocked: [], shardRows: [], pages: {} });

export const nodeCost = (p: Progress, tree: TreeId) =>
  NODE_COST_STEP * (p.unlocked.filter((id) => RUNES[id]?.tree === tree).length + 1);

export function unlockRune(p: Progress, id: string): Progress | null {
  const rune = RUNES[id];
  if (!rune || p.unlocked.includes(id)) return null;
  const cost = nodeCost(p, rune.tree);
  if (p.points < cost) return null;
  return { ...p, points: p.points - cost, unlocked: [...p.unlocked, id] };
}

export function unlockShardRow(p: Progress, row: number): Progress | null {
  const cost = SHARD_ROW_COST[row];
  if (cost === undefined || p.shardRows.includes(row) || p.points < cost) return null;
  return { ...p, points: p.points - cost, shardRows: [...p.shardRows, row] };
}

export function credit(p: Progress, kills: number, bonusPoints = 0) {
  const total = p.killRemainder + kills;
  const gained = Math.floor(total / KILLS_PER_POINT) + bonusPoints;
  return { progress: { ...p, points: p.points + gained, killRemainder: total % KILLS_PER_POINT }, gained };
}

/** LoL page rules: keystone picks the primary tree; minor runes of another tree fill the secondary (2, different rows). */
export function equipRune(page: Page, id: string, unlocked: string[]): Page {
  const rune = RUNES[id];
  if (!rune || !unlocked.includes(id)) return page;
  const p = { ...page, primaryRunes: [...page.primaryRunes], secondaryRunes: [...page.secondaryRunes] };
  if (rune.row === 0) {
    if (rune.tree === p.secondary) Object.assign(p, { secondary: null, secondaryRunes: [] });
    if (rune.tree !== p.primary) Object.assign(p, { primary: rune.tree, primaryRunes: [null, null, null] });
    p.keystone = id;
  } else if (rune.tree === p.primary) {
    p.primaryRunes[rune.row - 1] = id;
  } else if (rune.tree !== p.secondary) {
    Object.assign(p, { secondary: rune.tree, secondaryRunes: [id] });
  } else {
    const same = p.secondaryRunes.findIndex((r) => RUNES[r].row === rune.row);
    if (same >= 0) p.secondaryRunes.splice(same, 1);
    p.secondaryRunes.push(id);
    if (p.secondaryRunes.length > 2) p.secondaryRunes.shift();
  }
  return p;
}

/** Primary tree tab: a new tree starts empty; taking the secondary's tree empties the secondary. */
export function choosePrimary(page: Page, tree: TreeId): Page {
  if (page.primary === tree) return page;
  const p = { ...page, primary: tree, keystone: null, primaryRunes: [null, null, null] };
  return tree === page.secondary ? { ...p, secondary: null, secondaryRunes: [] } : p;
}

/** Secondary tree tab: never the primary tree; a new tree starts empty. */
export function chooseSecondary(page: Page, tree: TreeId): Page {
  if (page.secondary === tree || page.primary === tree) return page;
  return { ...page, secondary: tree, secondaryRunes: [] };
}

/** Reads and writes localStorage lazily, so a blocked storage only throws inside load/save's try blocks. */
export const browserStorage: Store = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
};

export function equipShard(page: Page, row: number, index: number, shardRows: number[]): Page {
  if (!shardRows.includes(row)) return page;
  return { ...page, shards: page.shards.map((s, i) => (i === row ? index : s)) };
}

const known = (id: unknown): id is string => typeof id === 'string' && id in RUNES;

/** Keeps only well-formed fields and known rune ids (the catalog may change between versions). */
function sanitize(raw: Partial<Progress>): Progress {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const pages: Record<string, Page> = {};
  for (const [champ, pg] of Object.entries(raw.pages ?? {})) {
    const e = emptyPage();
    pages[champ] = {
      primary: pg.primary ?? null,
      keystone: known(pg.keystone) ? pg.keystone : null,
      primaryRunes: e.primaryRunes.map((_, i) => (known(pg.primaryRunes?.[i]) ? pg.primaryRunes[i] : null)),
      secondary: pg.secondary ?? null,
      secondaryRunes: (pg.secondaryRunes ?? []).filter(known).slice(-2),
      shards: e.shards.map((_, i) => (typeof pg.shards?.[i] === 'number' ? pg.shards[i] : null)),
    };
  }
  return {
    points: num(raw.points),
    killRemainder: num(raw.killRemainder),
    unlocked: (raw.unlocked ?? []).filter(known),
    shardRows: (raw.shardRows ?? []).filter((r) => SHARD_ROW_COST[r] !== undefined),
    pages,
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadProgress(storage: Store): Progress {
  let text: string | null = null;
  try {
    text = storage.getItem(KEY);
    return text ? sanitize(JSON.parse(text)) : emptyProgress();
  } catch {
    // unreadable save: keep the raw text so the next write doesn't destroy it
    try { if (text) storage.setItem(`${KEY}.bak`, text); } catch { /* not persisted */ }
    return emptyProgress();
  }
}

export function saveProgress(p: Progress, storage: Store) {
  try { storage.setItem(KEY, JSON.stringify(p)); } catch { /* not persisted */ }
}
