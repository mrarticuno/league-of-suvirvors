// Per-champion item lists (src/championItems.json, tools/build_champion_items.py): every champion has one, made of game items.
import { expect, it, vi } from 'vitest';
import data from '../src/championItems.json';
import { CHAMPIONS } from '../src/champions';
import { ITEMS } from '../src/items';

vi.mock('../src/audio', () => ({ audio: {} }));

it('every champion has a list of known items and a core from it', () => {
  for (const id of Object.keys(CHAMPIONS)) {
    const c = data.champions[id as keyof typeof data.champions];
    expect(c, id).toBeDefined();
    expect(c.core.length, id).toBeGreaterThan(0);
    for (const [item] of c.items) expect(ITEMS[item as string], `${id} ${item}`).toBeDefined();
    for (const item of c.core) expect(c.items.some(([i]) => i === item), `${id} core ${item}`).toBe(true);
  }
});
