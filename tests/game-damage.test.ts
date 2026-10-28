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
