// Heimerdinger (src/champions/heimerdinger.ts): Turret Kits, Hextech Affinity, UPGRADE!!!'s free empowered cast and
// cooldown, mana on ability kills, the turrets' 3s priority mark.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { HEIMERDINGER } from '../src/champions/heimerdinger';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class { constructor() { throw new Error('no model'); } } }));

const W: Hit = { type: 'magic', source: 'ability', skill: 'W' };
const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, hp: 500, abilityHaste: 0, pos: new THREE.Vector3(), facing: 0, scene: new THREE.Scene(),
    ranks: { Q: 1, W: 1, E: 1, R: 1 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    cooldownOf: () => 100,
    player: { bone: () => undefined, root: new THREE.Object3D(), showSubmesh: vi.fn() },
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), play: vi.fn(), hit: vi.fn(), playOn: vi.fn(), missile: () => ({ root: new THREE.Object3D(), update: () => {} }) },
    hurtEnemy: vi.fn(), stunEnemy: vi.fn(), slow: vi.fn(), spawnMissile: vi.fn(), enemiesNear: () => enemies, enemyAt: () => null,
    nearestEnemy: (_p: THREE.Vector3, _r: number, f?: (e: Enemy) => boolean) => enemies.find((e) => !f || f(e)) ?? null,
  };
  const kit = HEIMERDINGER.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion', at = new THREE.Vector3()) =>
  ({ def: { tier, radius: 48 }, hp: 100, maxHp: 100, deadFor: -1, pos: at }) as unknown as Enemy;
const place = (kit: ReturnType<typeof rig>['kit'], at = new THREE.Vector3(100, 0, 0)) => { kit.castStart!('Q', at); kit.cast('Q', 0, at); };

it('turrets use Turret Kits: 3 at most, one back every 20s', () => {
  const { kit, step } = rig();
  expect(kit.gauge!().label).toBe('3');
  for (let i = 0; i < 3; i++) place(kit);
  expect(kit.gauge!().label).toBe('0');
  expect(kit.canCast!('Q')).toBe(false);
  step(19.9);
  expect(kit.gauge!().label).toBe('0');
  step(0.2);
  expect(kit.gauge!().label).toBe('1');
  expect(kit.canCast!('Q')).toBe(true);
});

it('Hextech Affinity: 20% Move Speed within 300 of a turret', () => {
  const { g, kit } = rig();
  expect(kit.moveSpeedBonus!()).toBe(0);
  place(kit, new THREE.Vector3(200, 0, 0));
  expect(kit.moveSpeedBonus!()).toBe(0.2);
  g.pos.set(600, 0, 0);
  expect(kit.moveSpeedBonus!()).toBe(0);
});

it('UPGRADE!!! makes the next basic ability free, then goes on its full cooldown; recast only cancels', () => {
  const { g, kit } = rig();
  expect(kit.cooldownBase!('R')).toBe(3); // recastable after 3s
  kit.cast('R', 0, g.pos);
  expect(kit.cost!('W')).toBe(0);
  expect(kit.skillView!('W')?.name).toBeDefined();
  kit.castStart!('W', g.pos);
  expect(g.cooldowns.R).toBe(100);
  expect(kit.cost!('W')).toBeUndefined();
  // cancelling keeps the 3s cooldown the cast pipeline set
  kit.cast('R', 0, g.pos);
  g.cooldowns.R = 3;
  kit.cast('R', 0, g.pos);
  expect(kit.cost!('E')).toBeUndefined();
  expect(g.cooldowns.R).toBe(3);
});

it('the Apex Turret spends no Turret Kit', () => {
  const { g, kit } = rig();
  for (let i = 0; i < 3; i++) place(kit);
  kit.cast('R', 0, g.pos);
  expect(kit.canCast!('Q')).toBe(true);
  place(kit);
  expect(kit.gauge!().label).toBe('0');
});

it('ability kills restore mana: once per second from small enemies, always from elite and epic ones', () => {
  const { g, kit } = rig();
  kit.onKill!(enemy(), W);
  expect(g.mana).toBe(10);
  kit.onKill!(enemy(), W);
  expect(g.mana).toBe(10);
  kit.onKill!(enemy('elite'), W);
  expect(g.mana).toBe(20);
  g.time = 2;
  kit.onKill!(enemy(), AUTO);
  expect(g.mana).toBe(20);
});

it('turrets shoot the enemy Heimerdinger hit in the last 3s first', () => {
  const { g, kit, enemies, step } = rig();
  const near = enemy('minion', new THREE.Vector3(150, 0, 0));
  const hit = enemy('minion', new THREE.Vector3(400, 0, 0));
  enemies.push(near, hit);
  place(kit, new THREE.Vector3(100, 0, 0));
  kit.onDamage!(hit, AUTO);
  step(1.6); // spawn, then the first shot's windup
  expect(g.spawnMissile).toHaveBeenCalled();
  expect(g.spawnMissile.mock.calls[0][3].target).toBe(hit);
});
