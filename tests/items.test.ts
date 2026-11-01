// Level-up item offers and item levels (src/items.ts): what can be offered, how stats grow, which offer is recommended.
import { describe, expect, it, vi } from 'vitest';
import { PASSIVES } from '../src/itemEffects';
import {
  BOOT_UPGRADES, BOOTS, BOOTS_FIRST, buildComplete, ITEM_TYPES, ITEMS, MAX_ITEMS, MAX_LEVEL, offerScore, onCore, PASSIVE_POWER, rollOffers, STAT_SCALE, sumStats,
  type ChampItems, type ItemType, type Slot,
} from '../src/items';

vi.mock('../src/audio', () => ({ audio: {} }));

const slots = (...ids: string[]): Slot[] => ids.map((id) => ({ id, level: 1 }));
const isOnly = (id: string, t: ItemType) => ITEMS[id].types.length === 1 && ITEMS[id].types[0] === t;

const champ: ChampItems = {
  items: [['6653', 0.24], ['3087', 0.22], ['3118', 0.19], ['4645', 0.08], ['3153', 0.01], ['3302', 0.01], ['6672', 0.01], ['3084', 0.01], ['2504', 0.01]],
  core: ['3087', '6653', '3118'],
};

describe('rollOffers', () => {
  it('offers distinct items of the champion list, never an owned item as new', () => {
    const own = slots('3153');
    const list = champ.items.map(([id]) => id);
    for (let i = 0; i < 50; i++) {
      const offers = rollOffers(own, champ);
      expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
      for (const o of offers) {
        if (o.kind === 'new') {
          expect(list).toContain(o.id);
          expect(o.id).not.toBe('3153');
          expect(o.slot).toBe(1);
        } else expect(o).toEqual({ id: '3153', slot: 0, kind: 'level' });
      }
    }
  });

  it('first offer: one card per type, the first core item among them, no duplicates', () => {
    for (let i = 0; i < 50; i++) {
      const o = rollOffers([], champ);
      expect(o).toHaveLength(3);
      expect(new Set(o.map((x) => x.id)).size).toBe(3);
      expect(o.map((x) => x.id)).toContain('3087');
      for (const t of ITEM_TYPES) expect(o.some((x) => ITEMS[x.id].types.includes(t)), t).toBe(true);
    }
  });

  it('first offer with a list missing a type still gives distinct cards', () => {
    const o = rollOffers([], { items: [['3089', 0.5], ['4645', 0.3]], core: ['3089'] });
    expect(o.map((x) => x.id).sort()).toEqual(['3089', '4645']);
  });

  it('an AD-only inventory never gets items without AD while AD candidates remain', () => {
    for (let i = 0; i < 100; i++) for (const o of rollOffers(slots('3153'), champ)) expect(ITEMS[o.id].types).toContain('ad');
  });

  it('once the AD candidates run out, other types are offered without a decline', () => {
    const own = slots('3153', '3302', '6672', '3087'); // every AD item of the list
    const ids = new Set(Array.from({ length: 50 }, () => rollOffers(own, champ)).flat().filter((o) => o.kind === 'new').map((o) => o.id));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(ITEMS[id].types).not.toContain('ad');
  });

  it('a decline brings one card of a type never picked', () => {
    for (let i = 0; i < 50; i++) {
      const o = rollOffers(slots('3153'), champ, true);
      expect(o.filter((x) => x.kind === 'new' && !ITEMS[x.id].types.includes('ad'))).toHaveLength(1);
    }
  });

  it('declining with a full inventory only levels', () => {
    const full = slots('6653', '3087', '3118', '4645', '3153', '3302');
    for (const o of rollOffers(full, champ, true)) expect(o.kind).toBe('level');
  });

  it('an exhausted list with free slots only levels', () => {
    const small: ChampItems = { items: champ.items.slice(0, 5), core: champ.core };
    const own = slots(...small.items.map(([id]) => id));
    for (const o of rollOffers(own, small, true)) expect(o.kind).toBe('level');
  });

  it('picks follow the proportion of the types owned', () => {
    // 2 AD + 1 Tank owned: new cards with AD outnumber new Tank cards without AD; AP-only never shows
    const own = slots('3153', '3302', '3084');
    const news = Array.from({ length: 400 }, () => rollOffers(own, champ)).flat().filter((o) => o.kind === 'new');
    const ad = news.filter((o) => ITEMS[o.id].types.includes('ad')).length;
    const tank = news.filter((o) => ITEMS[o.id].types.includes('tank') && !ITEMS[o.id].types.includes('ad')).length;
    expect(ad).toBeGreaterThan(tank);
    expect(tank).toBeGreaterThan(0);
    expect(news.some((o) => isOnly(o.id, 'ap'))).toBe(false);
  });

  it('onCore: every owned item is in the core', () => {
    expect(onCore([], champ.core)).toBe(true);
    expect(onCore(slots('6653', '3087'), champ.core)).toBe(true);
    expect(onCore(slots('6653', '3153'), champ.core)).toBe(false);
  });

  it('with a full inventory only levels owned items, and never past the max level', () => {
    const full = slots('3078', '3004', '3161', '6694', '2517', '3026');
    full[0].level = MAX_LEVEL;
    for (let i = 0; i < 30; i++) {
      for (const o of rollOffers(full, champ)) {
        expect(o.kind).toBe('level');
        expect(o.id).not.toBe('3078');
      }
    }
    expect(rollOffers(full.map((s) => ({ ...s, level: MAX_LEVEL })), champ)).toEqual([]);
  });

  it('types come from stats; hybrids have several', () => {
    expect(ITEMS['6653'].types).toEqual(['ap', 'tank']); // Liandry's
    expect(ITEMS['3084'].types).toEqual(['tank']); // Heartsteel
    expect(ITEMS['3087'].types).toEqual(['ad', 'ap']); // Statikk Shiv
    expect(ITEMS['3115'].types).toEqual(['ad', 'ap']); // Nashor's (AS)
    expect(ITEMS['3091'].types).toEqual(['ad', 'tank']); // Wit's End
    expect(ITEMS['3089'].types).toEqual(['ap']); // Rabadon's
    for (const it of Object.values(ITEMS)) expect(it.types.length, it.id).toBeGreaterThan(0);
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

it('recommends levelling a core item, then a new core item, over anything else', () => {
  const core = ['3078', '3004'];
  const own = slots('3078', '3031');
  const level = { id: '3078', slot: 0, kind: 'level' } as const;
  const fresh = { id: '3004', slot: 2, kind: 'new' } as const;
  const other = { id: '3031', slot: 1, kind: 'level' } as const;
  expect(offerScore(level, own, core)).toBeGreaterThan(offerScore(fresh, own, core));
  expect(offerScore(fresh, own, core)).toBeGreaterThan(offerScore(other, own, core));
});

it('the build is complete with every slot at max level', () => {
  const full = Array.from({ length: MAX_ITEMS }, (_, i): Slot => ({ id: Object.keys(ITEMS)[i], level: MAX_LEVEL }));
  expect(buildComplete(full)).toBe(true);
  expect(buildComplete(full.map((s, i) => (i ? s : { ...s, level: MAX_LEVEL - 1 })))).toBe(false);
});

it('every item has a passive text', () => {
  for (const id of Object.keys(ITEMS)) expect(PASSIVES[id], id).toBeTruthy();
});

it('boots add their stats outside the six slots; every tier 2 has a tier 3', () => {
  expect(sumStats([], -1, BOOTS_FIRST).ms).toBe(25);
  expect(sumStats([{ id: '3031', level: MAX_LEVEL }], -1, '3006')).toMatchObject({ ad: 75, as: 0.3, ms: 45 });
  for (const [t2, t3] of Object.entries(BOOT_UPGRADES)) expect([BOOTS[t2], BOOTS[t3]]).not.toContain(undefined);
});
