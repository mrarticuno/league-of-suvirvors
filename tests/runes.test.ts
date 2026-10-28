import { expect, it } from 'vitest';
import { RUNES, runesOf, SHARDS, TREES, type TreeId } from '../src/runes';

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
