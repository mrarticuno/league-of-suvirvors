// Level-up item offers and item levels (src/items.ts): what can be offered, how stats grow, which offer is recommended.
import { describe, expect, it, vi } from 'vitest';
import { PASSIVES } from '../src/itemEffects';
import {
  buildComplete, ITEMS, MAX_ITEMS, MAX_LEVEL, offerScore, PASSIVE_POWER, rollOffers, STAT_SCALE, sumStats, type Slot,
} from '../src/items';

vi.mock('../src/audio', () => ({ audio: {} }));

const slots = (...ids: string[]): Slot[] => ids.map((id) => ({ id, level: 1 }));

describe('rollOffers', () => {
  it('offers distinct items of the champion pool, never an owned item as new', () => {
    const own = slots('3078');
    for (let i = 0; i < 50; i++) {
      const offers = rollOffers(own, 'ad');
      expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
      for (const o of offers) {
        if (o.kind === 'new') {
          expect(ITEMS[o.id].pools).toContain('ad');
          expect(o.id).not.toBe('3078');
          expect(o.slot).toBe(1);
        } else expect(o).toEqual({ id: '3078', slot: 0, kind: 'level' });
      }
    }
  });

  it('with a full inventory only levels owned items, and never past the max level', () => {
    const full = slots('3078', '3004', '3161', '6694', '2517', '3026');
    full[0].level = MAX_LEVEL;
    for (let i = 0; i < 30; i++) {
      for (const o of rollOffers(full, 'ad')) {
        expect(o.kind).toBe('level');
        expect(o.id).not.toBe('3078');
      }
    }
    expect(rollOffers(full.map((s) => ({ ...s, level: MAX_LEVEL })), 'ad')).toEqual([]);
  });

  it('pools: AP items go to AP champions, attack items to AD ones, tanks and hybrids to both', () => {
    expect(ITEMS['3089'].pools).toEqual(['ap']); // Rabadon's
    expect(ITEMS['3031'].pools).toEqual(['ad']); // Infinity Edge
    expect(ITEMS['3068'].pools).toEqual(['ad', 'ap']); // Sunfire Aegis
    expect(ITEMS['3124'].pools).toEqual(['ad', 'ap']); // Guinsoo's
  });
});

it('stats grow with the level; the blueprint slot gets +50%', () => {
  const one = sumStats([{ id: '3031', level: 1 }]);
  expect(one.ad).toBeCloseTo(75 * STAT_SCALE[0]);
  expect(sumStats([{ id: '3031', level: MAX_LEVEL }]).ad).toBe(75);
  expect(sumStats([{ id: '3031', level: MAX_LEVEL }], 0).ad).toBe(112.5);
  // armor penetration keeps the best source
  expect(sumStats([{ id: '3036', level: MAX_LEVEL }, { id: '6694', level: MAX_LEVEL }]).armorPen).toBe(0.35);
});

it('passives unlock partway and reach full strength at the max level', () => {
  expect(PASSIVE_POWER[0]).toBe(0);
  expect(PASSIVE_POWER[MAX_LEVEL - 1]).toBe(1);
});

it('recommends levelling a build item, then a new build item, over anything else', () => {
  const build = ['3078', '3004'];
  const own = slots('3078', '3031');
  const level = { id: '3078', slot: 0, kind: 'level' } as const;
  const fresh = { id: '3004', slot: 2, kind: 'new' } as const;
  const other = { id: '3031', slot: 1, kind: 'level' } as const;
  expect(offerScore(level, own, build)).toBeGreaterThan(offerScore(fresh, own, build));
  expect(offerScore(fresh, own, build)).toBeGreaterThan(offerScore(other, own, build));
});

it('the build is complete with every slot at max level', () => {
  const full = Array.from({ length: MAX_ITEMS }, (_, i): Slot => ({ id: Object.keys(ITEMS)[i], level: MAX_LEVEL }));
  expect(buildComplete(full)).toBe(true);
  expect(buildComplete(full.map((s, i) => (i ? s : { ...s, level: MAX_LEVEL - 1 })))).toBe(false);
});

it('every item has a passive text', () => {
  for (const id of Object.keys(ITEMS)) expect(PASSIVES[id], id).toBeTruthy();
});
