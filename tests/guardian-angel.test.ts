// Guardian Angel (src/itemPassives/ad.ts) and Game.banish: the revive clears the mobs around the champion without rewards.
import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Game, type Enemy } from '../src/game';
import { ITEM_PASSIVES } from '../src/itemEffects';

vi.mock('../src/audio', () => ({ audio: {} }));

const enemy = (x: number, tier: string, radius = 10) =>
  ({ deadFor: -1, pos: new THREE.Vector3(x, 0, 0), def: { tier, radius } }) as unknown as Enemy;

it('banish kills alive non-epic enemies within the radius, without XP, kills or procs', () => {
  const near = enemy(100, 'minion'), edge = enemy(705, 'elite'), far = enemy(800, 'minion');
  const baron = enemy(50, 'epic'), dead = enemy(0, 'minion');
  dead.deadFor = 1;
  const g = {
    pos: new THREE.Vector3(), enemies: [near, edge, far, baron, dead], markDead: vi.fn(), killEnemy: vi.fn(), gainXp: vi.fn(),
    banish: Game.prototype.banish,
  };
  g.banish(700);
  expect(g.markDead.mock.calls.map(([e]) => e)).toEqual([near, edge]);
  expect(g.killEnemy).not.toHaveBeenCalled();
  expect(g.gainXp).not.toHaveBeenCalled();
});

it('Guardian Angel banishes nearby enemies before the revive, then waits 300s', () => {
  const g = { time: 0, baseHp: 1000, maxMana: 500, hp: 0, mana: 0, banish: vi.fn(), enterStasis: vi.fn((_s: number, end: () => void) => end()) };
  const fx = ITEM_PASSIVES['3026'].effect(g as unknown as Game, () => 1);
  expect(fx.onLethal!()).toBe(true);
  expect(g.enterStasis).toHaveBeenCalledWith(4, expect.any(Function));
  expect(g.banish).toHaveBeenCalledWith(700);
  expect(g.hp).toBe(500);
  expect(g.mana).toBe(500);
  expect(fx.onLethal!()).toBe(false);
  g.time = 301;
  expect(fx.onLethal!()).toBe(true);
});
