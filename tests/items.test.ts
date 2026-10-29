// Level-up item plans (src/items.ts planOffer/planScore): what each choice leads to, and which one the UI recommends.
import { describe, expect, it, vi } from 'vitest';
import { LINES, planOffer, planScore, statDelta, type Slot } from '../src/items';

vi.mock('../src/audio', () => ({ audio: {} }));

const finalOf = (path: string[]) => path.at(-1)!;

describe('planOffer', () => {
  it('a fresh base: one new-item plan with every finished item of its line', () => {
    const [p, ...rest] = planOffer([], '1029');
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ kind: 'new', slot: 0, done: 0, completes: false, dead: false, locks: [] });
    expect(p.finals.sort()).toEqual([...new Set(LINES['1029'].map(finalOf))].sort());
    expect(p.left).toBe(Math.min(...LINES['1029'].map((x) => x.length)));
  });

  it('an owned base also offers evolving it, one plan per open branch', () => {
    const plans = planOffer([{ base: '3070', path: [] }], '3070');
    const evolve = plans.filter((p) => p.kind === 'evolve');
    expect(evolve.map((p) => p.step).sort()).toEqual(['1027', '3024']);
    expect(evolve.every((p) => p.from === '3070' && p.done === 1)).toBe(true);
  });

  it('the last step completes the finished item', () => {
    const p = planOffer([{ base: '3070', path: ['1027'] }], '3070').find((x) => x.kind === 'evolve')!;
    expect(p).toMatchObject({ step: '3004', completes: true, left: 0, finals: ['3004'] });
  });

  it('a new line whose finished items are all taken can never be finished', () => {
    // Lágrima: both finals (3004, 3110) already owned elsewhere
    const slots: Slot[] = [{ base: '3070', path: ['1027', '3004'] }, { base: '3070', path: ['3024', '3110'] }];
    const fresh = planOffer(slots, '3070').find((p) => p.kind === 'new')!;
    expect(fresh.dead).toBe(true);
    expect(planScore(fresh, slots.length)).toBeLessThan(0);
  });

  it('flags a choice that takes the last finished item another slot was heading to', () => {
    // slot 0 (Lágrima) has only 3110 left, since slot 2 claims 3004; slot 1 (Couraça) stepping to 3082 claims 3110
    const slots: Slot[] = [{ base: '3070', path: [] }, { base: '1029', path: [] }, { base: '2022', path: ['3133'] }];
    const p = planOffer(slots, '1029').find((x) => x.kind === 'evolve' && x.step === '3082');
    expect(p?.locks).toEqual([0]);
    expect(planOffer(slots, '1029').find((x) => x.step === '2019')?.locks).toEqual([]);
  });

  it('recommends finishing an item over starting a new one', () => {
    const slots: Slot[] = [{ base: '3070', path: ['1027'] }];
    const plans = planOffer(slots, '3070');
    const best = plans.reduce((a, b) => (planScore(b, slots.length) > planScore(a, slots.length) ? b : a));
    expect(best.completes).toBe(true);
  });
});

it('statDelta: what an evolve step adds or removes', () => {
  expect(statDelta({ ad: 10 }, { ad: 25, as: 0.1 })).toEqual({ ad: 15, as: 0.1 });
  expect(statDelta({ hp: 150, ad: 5 }, { ad: 5 })).toEqual({ hp: -150 });
});
