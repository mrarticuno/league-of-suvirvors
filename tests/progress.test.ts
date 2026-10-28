import { describe, expect, it } from 'vitest';
import {
  choosePrimary, chooseSecondary, credit, emptyPage, emptyProgress, equipRune, equipShard, loadProgress, nodeCost, saveProgress, unlockRune, unlockShardRow,
  type Progress,
} from '../src/progress';

const withPoints = (points: number, unlocked: string[] = []): Progress => ({ ...emptyProgress(), points, unlocked });
const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
};
const ALL = ['press-the-attack', 'conqueror', 'electrocute', 'absorb-life', 'legend-alacrity', 'coup-de-grace',
  'cheap-shot', 'sixth-sense', 'treasure-hunter', 'taste-of-blood', 'summon-aery'];

describe('economy', () => {
  it('the n-th node of a tree costs 8 × n, counted per tree', () => {
    const p = emptyProgress();
    expect(nodeCost(p, 'precision')).toBe(8);
    const one = { ...p, unlocked: ['conqueror'] };
    expect(nodeCost(one, 'precision')).toBe(16);
    expect(nodeCost(one, 'sorcery')).toBe(8);
  });

  it('unlocking spends points, refuses when short or already unlocked', () => {
    expect(unlockRune(withPoints(7), 'conqueror')).toBeNull();
    const a = unlockRune(withPoints(35), 'conqueror')!;
    const b = unlockRune(a, 'absorb-life')!;
    expect(b.points).toBe(11);
    expect(b.unlocked).toEqual(['conqueror', 'absorb-life']);
    expect(unlockRune(b, 'conqueror')).toBeNull();
  });

  it('shard rows cost 20/40/60 and unlock once', () => {
    const p = unlockShardRow(withPoints(60), 2)!;
    expect(p.points).toBe(0);
    expect(p.shardRows).toEqual([2]);
    expect(unlockShardRow(withPoints(100, []), 9)).toBeNull();
    expect(unlockShardRow({ ...withPoints(100), shardRows: [0] }, 0)).toBeNull();
  });

  it('credit gives a point per 100 kills, carries the rest and adds bonus points', () => {
    const r = credit({ ...emptyProgress(), killRemainder: 50 }, 3460);
    expect(r.gained).toBe(35);
    expect(r.progress.killRemainder).toBe(10);
    expect(r.progress.points).toBe(35);
    expect(credit(emptyProgress(), 299).gained).toBe(2);
    expect(credit(emptyProgress(), 0, 3).gained).toBe(3);
  });
});

describe('page rules', () => {
  it('a keystone sets the primary; another tree keystone switches primary and clears its picks', () => {
    let page = equipRune(emptyPage(), 'conqueror', ALL);
    page = equipRune(page, 'absorb-life', ALL);
    expect(page.primary).toBe('precision');
    expect(page.keystone).toBe('conqueror');
    expect(page.primaryRunes).toEqual(['absorb-life', null, null]);
    page = equipRune(page, 'electrocute', ALL);
    expect(page.primary).toBe('domination');
    expect(page.primaryRunes).toEqual([null, null, null]);
  });

  it('secondary keeps the last two picks of different rows; same row replaces', () => {
    let page = equipRune(emptyPage(), 'conqueror', ALL);
    for (const id of ['cheap-shot', 'sixth-sense', 'treasure-hunter']) page = equipRune(page, id, ALL);
    expect(page.secondary).toBe('domination');
    expect(page.secondaryRunes).toEqual(['sixth-sense', 'treasure-hunter']);
    page = equipRune(page, 'taste-of-blood', ALL);
    page = equipRune(page, 'cheap-shot', ALL);
    expect(page.secondaryRunes).toEqual(['treasure-hunter', 'cheap-shot']);
  });

  it("picking the secondary tree's keystone moves it to primary and empties the secondary", () => {
    let page = equipRune(emptyPage(), 'conqueror', ALL);
    page = equipRune(page, 'cheap-shot', ALL);
    page = equipRune(page, 'electrocute', ALL);
    expect(page.primary).toBe('domination');
    expect(page.secondary).toBeNull();
    expect(page.secondaryRunes).toEqual([]);
  });

  it('a minor rune with no primary goes to the secondary; locked runes change nothing', () => {
    const page = equipRune(emptyPage(), 'absorb-life', ALL);
    expect(page.primary).toBeNull();
    expect(page.secondary).toBe('precision');
    expect(equipRune(emptyPage(), 'conqueror', [])).toEqual(emptyPage());
  });

  it('shards equip only in unlocked rows', () => {
    expect(equipShard(emptyPage(), 1, 2, []).shards).toEqual([null, null, null]);
    expect(equipShard(emptyPage(), 1, 2, [1]).shards).toEqual([null, 2, null]);
  });
});

describe('tree tabs', () => {
  it('choosing a primary tree clears the old picks; taking the secondary tree empties the secondary', () => {
    let page = equipRune(emptyPage(), 'conqueror', ALL);
    page = equipRune(page, 'cheap-shot', ALL);
    expect(choosePrimary(page, 'precision')).toBe(page);
    page = choosePrimary(page, 'domination');
    expect(page).toMatchObject({ primary: 'domination', keystone: null, primaryRunes: [null, null, null], secondary: null, secondaryRunes: [] });
  });

  it('choosing a secondary tree clears its picks and never takes the primary tree', () => {
    let page = choosePrimary(emptyPage(), 'precision');
    expect(chooseSecondary(page, 'precision')).toBe(page);
    page = chooseSecondary(page, 'sorcery');
    expect(page.secondary).toBe('sorcery');
    page = equipRune(page, 'cheap-shot', ALL);
    expect(chooseSecondary(page, 'domination')).toBe(page);
    expect(chooseSecondary(page, 'resolve').secondaryRunes).toEqual([]);
  });
});

describe('persistence', () => {
  it('round-trips', () => {
    const s = memory();
    const p = { ...withPoints(9, ['conqueror']), pages: { ezreal: equipRune(emptyPage(), 'conqueror', ['conqueror']) } };
    saveProgress(p, s);
    expect(loadProgress(s)).toEqual(p);
  });

  it('bad JSON loads empty and the raw text is kept in the backup key before the next save', () => {
    const s = memory({ 'los.runes.v1': '{oops' });
    expect(loadProgress(s)).toEqual(emptyProgress());
    expect(s.getItem('los.runes.v1.bak')).toBe('{oops');
    saveProgress(emptyProgress(), s);
    expect(s.getItem('los.runes.v1.bak')).toBe('{oops');
  });

  it('drops unknown rune ids from unlocked and pages', () => {
    const page = { ...emptyPage(), primary: 'precision', keystone: 'gone', primaryRunes: ['absorb-life', 'old', null], secondaryRunes: ['nope'] };
    const s = memory({ 'los.runes.v1': JSON.stringify({ ...emptyProgress(), unlocked: ['conqueror', 'gone'], pages: { ezreal: page } }) });
    const p = loadProgress(s);
    expect(p.unlocked).toEqual(['conqueror']);
    expect(p.pages.ezreal.keystone).toBeNull();
    expect(p.pages.ezreal.primaryRunes).toEqual(['absorb-life', null, null]);
    expect(p.pages.ezreal.secondaryRunes).toEqual([]);
  });

  it('a storage that throws gives an empty progress and no exception', () => {
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadProgress(boom)).toEqual(emptyProgress());
    expect(() => saveProgress(emptyProgress(), boom)).not.toThrow();
  });
});
