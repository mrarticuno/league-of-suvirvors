import { expect, it } from 'vitest';
import type { Game } from '../src/game';
import { emptyPage } from '../src/progress';
import { RUNES, runeEffects, runesOf, SHARDS, shardStats, TREES, type TreeId } from '../src/runes';

it('catalog matches the spec: 13 precision, 12 in each other tree, keystones 4/3/3/3/3, 3 runes per minor row', () => {
  expect(runesOf('precision').length).toBe(13);
  for (const t of ['domination', 'sorcery', 'resolve', 'inspiration'] as const) expect(runesOf(t).length).toBe(12);
  expect(runesOf('precision', 0).length).toBe(4);
  for (const t of Object.keys(TREES) as TreeId[]) for (const r of [1, 2, 3]) expect(runesOf(t, r).length).toBe(3);
  expect(Object.keys(RUNES).length).toBe(61);
  expect(SHARDS.map((r) => r.length)).toEqual([3, 3, 3]);
});

it('every rune has a description and an icon url, and its key matches its id', () => {
  for (const [id, r] of Object.entries(RUNES)) {
    expect(r.id).toBe(id);
    expect(r.desc.length).toBeGreaterThan(10);
    expect(r.icon).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/img\/perk-images\//);
  }
});

it('shard stats: adaptive is bonus AD, health scaling grows 10 to 180 over 18 levels', () => {
  const s = shardStats([0, 2, 1], 18);
  expect(s.ad).toBeCloseTo(5.4);
  expect(s.hp).toBeCloseTo(180);
  expect(s.tenacity).toBeCloseTo(0.15);
  expect(shardStats([null, 2, null], 1).hp).toBeCloseTo(10);
  expect(shardStats([null, null, null], 1)).toEqual({});
});

it('an empty page gives only the shard effect, which grants nothing', () => {
  const fx = runeEffects({ level: 1 } as unknown as Game, emptyPage());
  expect(fx.length).toBe(1);
  expect(fx[0].stat!('ad')).toBe(0);
});

it('rune effects are built fresh on every call (no state shared between runs)', () => {
  const page = { ...emptyPage(), keystone: 'conqueror', primary: 'precision' as const };
  const made: object[] = [];
  RUNES.conqueror.effect = () => { const fx = {}; made.push(fx); return fx; };
  runeEffects({ level: 1 } as unknown as Game, page);
  runeEffects({ level: 1 } as unknown as Game, page);
  expect(made.length).toBe(2);
  expect(made[0]).not.toBe(made[1]);
});
