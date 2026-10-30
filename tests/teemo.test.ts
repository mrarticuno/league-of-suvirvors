// Teemo (src/champions/teemo.ts): Guerrilla Warfare without stealth, Toxic Shot's poison, Noxious Trap's timed bomb.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { TEEMO } from '../src/champions/teemo';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class { constructor() { throw new Error('not loaded'); } } }));

const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, alive: true, stillFor: 0, facing: 0, ranks: { Q: 0, W: 0, E: 0, R: 0 },
    pos: new THREE.Vector3(), scene: new THREE.Scene(), player: { root: new THREE.Group() },
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn() },
    hurtEnemy: vi.fn(), slow: vi.fn(), enemiesNear: () => enemies, cooldowns: { Q: 0, W: 0, E: 0, R: 0 }, cooldownOf: () => 0.25,
    nearestEnemy: (_p: THREE.Vector3, _r: number, f: (e: Enemy) => boolean) => enemies.find(f) ?? null,
  };
  const kit = TEEMO.kit(g as unknown as Game);
  const step = (seconds: number, moving = false) => {
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      g.time += 0.05;
      g.stillFor = moving ? 0 : g.stillFor + 0.05;
      kit.update!(0.05);
    }
  };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion') =>
  ({ def: { tier, radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3() }) as unknown as Enemy;

it('standing still 2s grants Element of Surprise without stealth; it lasts 5s after moving', () => {
  const { g, kit, step } = rig();
  step(1.9);
  expect(kit.attackSpeedBonus!()).toBe(0);
  step(0.2);
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.2);
  expect(kit.moveAnims!()?.idle).toBe('idle_stealth_loop');
  step(4.9, true);
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.2);
  expect(kit.moveAnims!()).toBeUndefined();
  step(0.2, true);
  expect(kit.attackSpeedBonus!()).toBe(0);
  g.level = 10;
  step(2.1);
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.6);
});

it('Toxic Shot: autos add on-hit magic damage and poison for 4 ticks (145% against monsters)', () => {
  const { g, kit, step } = rig();
  const e = enemy();
  expect(kit.onDamage!(e, AUTO)).toBe(0); // not learned
  g.ranks.E = 1;
  expect(kit.onDamage!(e, AUTO)).toBe(9);
  expect(kit.onDamage!(e, { type: 'magic', source: 'ability', skill: 'Q' })).toBe(0);
  step(5, true);
  const ticks = g.hurtEnemy.mock.calls.filter(([x, , hit]) => x === e && hit.source === 'item').map(([, d]) => d);
  expect(ticks).toEqual([6, 6, 6, 6]);
  expect(kit.onDamage!(enemy('monster'), AUTO)).toBeCloseTo(9 * 1.45);
});

it('Noxious Trap: 3 charges recharged one at a time; a mushroom waits for an enemy to step on it', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy();
  e.pos.set(3000, 0, 0);
  enemies.push(e);
  g.ranks.R = 1;
  step(0.05, true);
  expect(kit.canCast!('R')).toBe(true); // learning it gives the first charge
  kit.castStart!('R', new THREE.Vector3());
  kit.cast('R', 0, new THREE.Vector3(300, 0, 0));
  expect(kit.canCast!('R')).toBe(false);
  expect(g.cooldowns.R).toBe(0);
  step(0.05, true);
  expect(g.cooldowns.R).toBeGreaterThan(29); // out of charges: the slot shows the recharge
  step(10, true);
  expect(g.hurtEnemy).not.toHaveBeenCalled(); // no fuse: it waits
  e.pos.set(300, 0, 100); // steps on it
  step(0.1, true);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 200, expect.objectContaining({ skill: 'R' }));
  expect(g.slow).toHaveBeenCalledWith(e, 0.3, 4);
  step(20, true);
  expect(kit.skillView!('R')?.badge).toBe('1');
  step(60, true);
  expect(kit.skillView!('R')?.badge).toBe('3'); // capped
});

it('a mushroom landing on another bounces forward', () => {
  const { g, kit, step } = rig();
  g.ranks.R = 1;
  kit.cast('R', 0, new THREE.Vector3(300, 0, 0));
  step(1, true);
  kit.cast('R', 0, new THREE.Vector3(300, 0, 0));
  step(1, true);
  expect(g.vfx.playAt).toHaveBeenCalledWith('Teemo_R_Mis_Bounce', expect.objectContaining({ x: 300 }));
  expect(g.vfx.playAt).toHaveBeenCalledWith('Teemo_R_GroundImpact_Dust', expect.objectContaining({ x: 650 })); // 350 further
});
