// Ziggs (src/champions/ziggs.ts): Short Fuse's damage, cooldown and refunds, Bouncing Bomb, Satchel Charge, Minefield.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { fuseDamage, ZIGGS } from '../src/champions/ziggs';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const reach = (e: Enemy, p: THREE.Vector3, r: number) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= r;
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, hp: 100, stunned: 0, facing: 0, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    champ: ZIGGS, player: { bone: () => new THREE.Object3D(), root: new THREE.Object3D() },
    vfx: {
      attach: () => new THREE.Group(), playAt: vi.fn(), hit: vi.fn(), play: () => ({ stop: vi.fn() }),
      missile: () => ({ root: new THREE.Object3D(), update: () => {} }),
    },
    spawnMissile: vi.fn(), impact: vi.fn(), hurtEnemy: vi.fn(), slow: vi.fn(), knockBack: vi.fn(), dash: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number) => enemies.filter((e) => reach(e, p, r + 50)),
    nearestEnemy: (_p: THREE.Vector3, _r: number, f: (e: Enemy) => boolean) => enemies.find(f) ?? null,
  };
  const kit = ZIGGS.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (x: number, z = 0) =>
  ({ def: { tier: 'minion', radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(x, 0, z) }) as unknown as Enemy;
const damageTo = (g: ReturnType<typeof rig>['g'], e: Enemy, skill: string) =>
  g.hurtEnemy.mock.calls.filter(([x, , hit]) => x === e && hit.skill === skill).map(([, dmg]) => dmg as number);

it('Short Fuse deals 20-160 by level breakpoints (+4, then +8 from 7, +12 from 13)', () => {
  expect([1, 6, 7, 12, 13, 18].map(fuseDamage)).toEqual([20, 40, 48, 88, 100, 160]);
});

it('Short Fuse empowers one attack every 12s and each cast takes 4s (6s from level 13) off', () => {
  const { g, kit } = rig();
  const target = enemy(300);
  const fired = () => g.spawnMissile.mock.calls.at(-1)![0];
  kit.basicAttack!(target, 50, false, false);
  expect(fired()).toBe('Ziggs_P_mis');
  kit.basicAttack!(target, 50, false, false);
  expect(fired()).toBe('Ziggs_BA_mis');
  kit.castStart!('Q', new THREE.Vector3());
  g.time = 7.9;
  kit.basicAttack!(target, 50, false, false);
  expect(fired()).toBe('Ziggs_BA_mis');
  g.time = 8;
  kit.basicAttack!(target, 50, false, false);
  expect(fired()).toBe('Ziggs_P_mis');
  g.level = 13;
  kit.castStart!('W', new THREE.Vector3());
  g.time = 14;
  kit.basicAttack!(target, 50, false, false);
  expect(fired()).toBe('Ziggs_P_mis');
});

it('Bouncing Bomb bounces twice over empty ground and explodes early next to an enemy', () => {
  const { g, kit, enemies, step } = rig();
  kit.cast('Q', 0, new THREE.Vector3(850, 0, 0));
  step(2);
  const bounces = () => g.vfx.playAt.mock.calls.filter(([k]) => k === 'Ziggs_Q_bounce_01');
  const booms = () => g.vfx.playAt.mock.calls.filter(([k]) => k === 'Ziggs_Q_explosion');
  expect(bounces()).toHaveLength(2);
  expect(booms()[0][1].x).toBeCloseTo(850 + 325 + 225); // 1400 at max range
  const e = enemy(850 + 100);
  enemies.push(e);
  kit.cast('Q', 0, new THREE.Vector3(850, 0, 0));
  step(1);
  expect(bounces()).toHaveLength(2); // exploded on its first landing
  expect(damageTo(g, e, 'Q')).toEqual([80]);
});

it('Satchel Charge throws enemies out to 500 from the center and Ziggs out to 775', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(500);
  enemies.push(e);
  kit.cast('W', 0, new THREE.Vector3(300, 0, 0));
  kit.recast!('W', new THREE.Vector3());
  step(0.5); // detonates on landing
  expect(damageTo(g, e, 'W')).toEqual([70]);
  expect(g.knockBack.mock.calls[0][1].x).toBeCloseTo(300); // 200 from the center -> 500
  expect(g.dash).toHaveBeenCalledWith(expect.anything(), 475, 950, expect.any(Number)); // 300 from the center -> 775
});

it('Hexplosive Minefield: later mines of the same cast deal 40% to an enemy already hit', () => {
  const { g, kit, enemies, step } = rig();
  kit.cast('E', 0, new THREE.Vector3(600, 0, 0));
  step(1.3); // cluster flies, mines land and arm (0.5s), nobody there yet
  const e = enemy(600);
  enemies.push(e);
  step(0.1);
  const hits = damageTo(g, e, 'E');
  expect(hits.length).toBeGreaterThan(1);
  expect(hits[0]).toBeCloseTo(30);
  expect(hits.slice(1).every((d) => Math.abs(d - 12) < 1e-9)).toBe(true);
  expect(g.slow).toHaveBeenCalledWith(e, 0.1, 1.5);
});
