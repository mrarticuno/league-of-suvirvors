import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { Game, type Enemy } from '../src/game';
import type { ItemEffect } from '../src/itemEffects';

vi.mock('../src/audio', () => ({ audio: {} })); // the real one opens an AudioContext on import

const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
const PROC: Hit = { type: 'physical', source: 'item' };

/** hurtEnemy on a stand-in `this`: real damage pipeline, spied kill and heal. */
function rig(proc: ItemEffect) {
  const g = {
    itemFx: [proc], kit: {}, hp: 100, maxHp: 100, items: { omnivamp: 0, lifesteal: 0.5 },
    mitigate: (_e: Enemy, a: number) => a, fxStat: () => 0, float: () => {}, heal: vi.fn(),
    killEnemy: vi.fn((e: Enemy) => { e.deadFor = 0; }),
    hurtEnemy: Game.prototype.hurtEnemy,
  };
  return g;
}
const enemy = (hp: number) => ({ hp, maxHp: 100, deadFor: -1, pos: {}, def: { tier: 'minion' } }) as unknown as Enemy;

it('a rune proc that finishes the enemy kills it once', () => {
  const g = rig({ onDealt: (e, hit) => { if (hit.source !== 'item') g.hurtEnemy(e, 50, PROC); } });
  const e = enemy(60);
  g.hurtEnemy(e, 50, AUTO);
  expect(g.killEnemy).toHaveBeenCalledTimes(1);
});

it('a proc after the killing blow neither kills again nor heals a negative amount', () => {
  const g = rig({ onDealt: (e, hit) => { if (hit.source !== 'item') g.hurtEnemy(e, 50, PROC); } });
  const e = enemy(30);
  g.hurtEnemy(e, 50, AUTO);
  expect(g.killEnemy).toHaveBeenCalledTimes(1);
  for (const [v] of g.heal.mock.calls) expect(v).toBeGreaterThanOrEqual(0);
});

it('life steal heals from basic attacks and abilities, not from item procs', () => {
  const g = rig({});
  g.hurtEnemy(enemy(100), 40, AUTO);
  g.hurtEnemy(enemy(100), 40, { type: 'physical', source: 'ability', skill: 'Q' });
  g.hurtEnemy(enemy(100), 40, PROC);
  g.hurtEnemy(enemy(100), 40, { ...PROC, lifesteal: true }); // Sivir's ricochets
  expect(g.heal.mock.calls).toEqual([[20], [20], [20]]);
});

/** hurtPlayer on a stand-in `this`: armor 100 halves the hit before the standing-still multiplier and Plating. */
function player(stillFor: number, boots: string | null = null) {
  const desc = Object.getOwnPropertyDescriptor(Game.prototype, 'campingMult')!;
  const g = {
    alive: true, stasis: 0, armor: 100, mr: 0, itemFx: [], shield: 0, hp: 10000, time: 0, lastHurtAt: 0, stillFor, boots,
    float: () => {}, hurtPlayer: Game.prototype.hurtPlayer,
  };
  Object.defineProperty(g, 'campingMult', { get: desc.get });
  return g;
}

it('standing still multiplies damage taken (after armor) up to x5 after 5 seconds', () => {
  const taken = (g: ReturnType<typeof player>) => { g.hurtPlayer(100); return 10000 - g.hp; };
  expect(taken(player(0))).toBeCloseTo(50);
  expect(taken(player(2.5))).toBeCloseTo(150);
  expect(taken(player(5))).toBeCloseTo(250);
  expect(taken(player(30))).toBeCloseTo(250);
  expect(taken(player(0, '3047'))).toBeCloseTo(45); // Plating: physical hits deal 10% less
});

it('a fading slow decays to nothing over its length; a held slow stays whole', () => {
  const g = { time: 0, slow: Game.prototype.slow, isSlowed: Game.prototype.isSlowed, slowAmount: Game.prototype.slowAmount };
  const e = { slowPct: 0, slowUntil: 0, slowFade: 0 } as unknown as Enemy;
  g.slow(e, 0.4, 2, true);
  g.time = 1;
  expect(g.slowAmount(e)).toBeCloseTo(0.2);
  g.slow(e, 0.1, 1); // weaker than what is left: ignored
  expect(g.slowAmount(e)).toBeCloseTo(0.2);
  g.time = 2.1;
  expect(g.slowAmount(e)).toBe(0);
  g.slow(e, 0.3, 1);
  g.time = 2.9;
  expect(g.slowAmount(e)).toBeCloseTo(0.3);
});
