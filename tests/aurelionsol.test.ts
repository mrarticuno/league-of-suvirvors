// Aurelion Sol (src/champions/aurelionsol.ts): orbiting stars, Celestial Expansion's mana drain, Starsurge's growth
// and detonation, Falling Star's knock-up.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AURELIONSOL } from '../src/champions/aurelionsol';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, hp: 500, mana: 100, maxMana: 500, facing: 0, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    ranks: { Q: 1, W: 1, E: 1, R: 1 },
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), playOn: vi.fn() },
    player: { bone: () => null, root: new THREE.Group() },
    hurtEnemy: vi.fn(), stunEnemy: vi.fn(), knockUp: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number) => enemies.filter((e) => e.pos.distanceTo(p) <= r + 50),
    nearestEnemy: () => enemies[0] ?? null,
  };
  const kit = AURELIONSOL.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (x: number, z = 0) =>
  ({ def: { tier: 'minion', radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(x, 0, z) }) as unknown as Enemy;
const hitsOn = (g: ReturnType<typeof rig>['g'], e: Enemy, source: string) =>
  g.hurtEnemy.mock.calls.filter(([x, , hit]) => x === e && hit.source === source).length;

it('stars sweep the orbit and hit an enemy on it once per pass', () => {
  const { g, enemies, step } = rig();
  const e = enemy(0, 250);
  enemies.push(e);
  step(2.5); // stars pass over it 1s apart (the first one starts on it, back at 3s)
  expect(hitsOn(g, e, 'item')).toBe(3);
  const far = enemy(0, 650); // only the expanded orbit reaches it
  enemies.push(far);
  step(3);
  expect(hitsOn(g, far, 'item')).toBe(0);
});

it('Celestial Expansion widens the orbit, drains mana every second and switches off when it runs dry', () => {
  const { g, kit, enemies, step } = rig();
  const far = enemy(0, 650);
  enemies.push(far);
  kit.cast('W', 0, new THREE.Vector3());
  g.mana = 20;
  step(2);
  expect(g.mana).toBeCloseTo(8); // 6 per second
  expect(hitsOn(g, far, 'item')).toBeGreaterThan(0);
  step(2); // runs dry: stars come back
  expect(kit.hud!()).not.toContain('−');
});

it('Starsurge grows while Aurelion stays close and detonates once he leaves, stunning what it covers', () => {
  const { g, kit, enemies, step } = rig();
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 1000));
  g.pos.z = 0;
  const e = enemy(0, 900);
  enemies.push(e);
  step(1); // star at z=600, still within 650: grows, no blast
  expect(hitsOn(g, e, 'ability')).toBe(0);
  step(0.5); // z=900: too far from Aurelion, detonates on the enemy
  expect(hitsOn(g, e, 'ability')).toBe(1);
  expect(g.stunEnemy).toHaveBeenCalledWith(e, expect.any(Number));
});

it('Falling Star lands after 1s and knocks up enemies in its area', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(300);
  enemies.push(e);
  kit.cast('R', 0, new THREE.Vector3(300, 0, 0));
  step(0.9);
  expect(g.knockUp).not.toHaveBeenCalled();
  step(0.2);
  expect(hitsOn(g, e, 'ability')).toBe(1);
  expect(g.knockUp).toHaveBeenCalledWith(e, 1);
});

it('Comet of Legend flies through walls and units, faster and unable to attack, for 3s', () => {
  const { kit, step } = rig();
  kit.cast('E', 0, new THREE.Vector3());
  expect(kit.ghost!()).toBe(true);
  expect(kit.disarmed!()).toBe(true);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.6);
  step(3.1);
  expect(kit.ghost!()).toBe(false);
  expect(kit.moveSpeedBonus!()).toBe(0);
});
