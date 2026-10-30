// Lux (src/champions/lux.ts): Illumination's marks and detonation, mana on illuminated kills, Light Binding's two
// roots, Lucent Singularity's slow and recast.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { LUX } from '../src/champions/lux';
import type { Enemy, Game, MissileOpts } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

const Q: Hit = { type: 'magic', source: 'ability', skill: 'Q' };
const R: Hit = { type: 'magic', source: 'ability', skill: 'R' };
const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
const BURN: Hit = { type: 'magic', source: 'item' };

function rig() {
  const enemies: Enemy[] = [];
  const missiles: MissileOpts[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, facing: 0, alive: true, shield: 0, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    vfx: {
      attach: () => new THREE.Group(), play: vi.fn(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: () => {} }),
    },
    player: { bone: () => null, root: new THREE.Group() },
    hurtEnemy: vi.fn(), slow: vi.fn(), rootEnemy: vi.fn(), addShield: vi.fn(), impact: vi.fn(),
    spawnMissile: (_fx: string, _from: THREE.Vector3, _to: THREE.Vector3, o: MissileOpts) => missiles.push(o),
    enemiesNear: (p: THREE.Vector3, r: number) => enemies.filter((e) => e.pos.distanceTo(p) <= r + 50),
  };
  const kit = LUX.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, missiles, step };
}
const enemy = (x = 0, tier: Enemy['def']['tier'] = 'minion') =>
  ({ def: { tier, radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(x, 0, 0) }) as unknown as Enemy;

it('abilities illuminate; the next basic attack consumes the mark for 30 + 30% AP bonus magic damage', () => {
  const { g, kit } = rig();
  const e = enemy();
  expect(kit.onDamage!(e, AUTO)).toBe(0); // no mark yet
  expect(kit.onDamage!(e, Q)).toBe(0); // marks, no bonus on the ability itself
  expect(kit.onDamage!(e, Q)).toBe(0); // another ability only refreshes it
  expect(kit.hud!()).toContain('1');
  g.ap = 100;
  expect(kit.onDamage!(e, AUTO)).toBeCloseTo(30 + 30);
  expect(kit.onDamage!(e, AUTO)).toBe(0); // consumed
  expect(kit.onDamage!(e, BURN)).toBe(0); // item burns neither mark nor detonate
});

it('the bonus grows with level to 200 at 18', () => {
  const { g, kit } = rig();
  const e = enemy();
  g.level = 18;
  kit.onDamage!(e, Q);
  expect(kit.onDamage!(e, AUTO)).toBeCloseTo(200);
});

it('Final Spark detonates the mark and illuminates again', () => {
  const { kit } = rig();
  const e = enemy();
  kit.onDamage!(e, Q);
  expect(kit.onDamage!(e, R)).toBeCloseTo(30);
  expect(kit.onDamage!(e, AUTO)).toBeCloseTo(30); // marked again by the beam
});

it('the mark fades after 6s', () => {
  const { kit, step } = rig();
  const e = enemy();
  kit.onDamage!(e, Q);
  step(5.9);
  expect(kit.hud!()).toContain('1');
  step(0.2);
  expect(kit.hud!()).toContain('0');
  expect(kit.onDamage!(e, AUTO)).toBe(0);
});

it('illuminated kills restore mana: once a second from minions, always from elite and epic monsters', () => {
  const { g, kit, step } = rig();
  const kill = (e: Enemy, hit: Hit) => { kit.onDamage!(e, hit); kit.onKill!(e, hit); };
  kill(enemy(), AUTO); // not illuminated
  expect(g.mana).toBe(0);
  kill(enemy(), Q);
  expect(g.mana).toBeCloseTo(10);
  kill(enemy(), Q); // minion within the cooldown
  expect(g.mana).toBeCloseTo(10);
  kill(enemy(0, 'elite'), Q);
  expect(g.mana).toBeCloseTo(20);
  step(1.05);
  const marked = enemy();
  kit.onDamage!(marked, Q);
  kill(marked, AUTO); // the detonating attack kills it
  expect(g.mana).toBeCloseTo(30);
});

it('Light Binding roots the first two enemies and stops', () => {
  const { g, kit, missiles } = rig();
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 1000));
  const m = missiles[0];
  expect(m.pierce).toBe(true);
  const sphere = { travelled: 0, range: m.range } as unknown as Parameters<NonNullable<MissileOpts['onHit']>>[1];
  const [a, b, c] = [enemy(), enemy(), enemy()];
  for (const e of [a, b, c]) m.onHit!(e, sphere);
  expect(g.rootEnemy.mock.calls.map(([e]) => e)).toEqual([a, b]);
  expect(g.impact).toHaveBeenCalledTimes(2);
  expect(sphere.travelled).toBe(m.range);
});

it('Lucent Singularity slows inside, detonates on recast and by itself after 5s', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(600);
  enemies.push(e);
  kit.cast('E', 0, new THREE.Vector3(600, 0, 0));
  kit.recast!('E', new THREE.Vector3()); // still flying (0.5s): goes off on arrival
  step(0.3);
  expect(g.hurtEnemy).not.toHaveBeenCalled();
  step(0.3);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 65, expect.objectContaining({ skill: 'E' }));
  expect(g.slow).toHaveBeenCalledWith(e, 0.25, 1);

  g.hurtEnemy.mockClear();
  kit.cast('E', 0, new THREE.Vector3(600, 0, 0));
  step(1);
  expect(g.slow).toHaveBeenLastCalledWith(e, 0.25, 1); // standing in the area
  expect(g.hurtEnemy).not.toHaveBeenCalled();
  step(4.6); // lands at 0.5s, lasts 5s
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
});
