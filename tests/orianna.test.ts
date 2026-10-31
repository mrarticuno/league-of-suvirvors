// Orianna (src/champions/orianna.ts): Clockwork Winding's stacks, Command: Attack's reduced damage past the first
// enemy, the Ball's leash and pick-up, Command: Protect's shield and resistances, buffered Shockwave.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { ORIANNA } from '../src/champions/orianna';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class { constructor() { throw new Error('no model'); } } }));

const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, facing: 0, shield: 0, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    ranks: { Q: 5, W: 5, E: 5, R: 3 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 }, champ: ORIANNA,
    vfx: {
      attach: () => new THREE.Group(), play: vi.fn(() => null), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: () => {} }),
    },
    player: { bone: () => null, root: new THREE.Group(), hideBone: vi.fn() },
    hurtEnemy: vi.fn(), slow: vi.fn(), knockBack: vi.fn(), addShield: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number) => enemies.filter((e) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= r + 50),
  };
  const kit = ORIANNA.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (x = 0, z = 0) => ({ def: { tier: 'minion', radius: 30 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(x, 0, z) }) as unknown as Enemy;

it('Clockwork Winding: 10 + 15% AP, +15% per stack on the same target (2 at most), reset by a new target or 4s', () => {
  const { g, kit, step } = rig();
  g.ap = 100;
  const a = enemy(), b = enemy();
  expect(kit.onDamage!(a, AUTO)).toBeCloseTo(25);
  expect(kit.onDamage!(a, AUTO)).toBeCloseTo(25 * 1.15);
  expect(kit.onDamage!(a, AUTO)).toBeCloseTo(25 * 1.3);
  expect(kit.onDamage!(a, AUTO)).toBeCloseTo(25 * 1.3); // capped at 2 stacks
  expect(kit.onDamage!(b, AUTO)).toBeCloseTo(25); // new target
  step(4.1);
  expect(kit.onDamage!(b, AUTO)).toBeCloseTo(25); // expired
  expect(kit.onDamage!(b, { type: 'magic', source: 'ability', skill: 'Q' })).toBe(0);
  g.level = 18;
  g.ap = 0;
  expect(kit.onDamage!(enemy(), AUTO)).toBeCloseTo(50);
});

it('Command: Attack hits the first enemy for full damage and the rest for 70%, then rests at the point', () => {
  const { g, kit, enemies, step } = rig();
  const near = enemy(300), far = enemy(600);
  enemies.push(near, far);
  kit.cast('Q', 4, new THREE.Vector3(600, 0, 0));
  step(1);
  const hits = g.hurtEnemy.mock.calls.map(([e, dmg]) => [e, dmg]);
  expect(hits).toEqual([[near, 180], [far, 180 * 0.7]]);
  expect(g.player.hideBone).toHaveBeenCalledWith('BallDown', true);
  // the Ball stays there: Dissonance now pulses at it, not around Orianna
  g.hurtEnemy.mockClear();
  kit.cast('W', 4, g.pos);
  expect(g.hurtEnemy.mock.calls.map(([e]) => e)).toEqual([far]);
});

it('Command: Attack travels at least 150 from Orianna and at most 825', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(150);
  enemies.push(e);
  kit.cast('Q', 0, new THREE.Vector3(10, 0, 0));
  step(1);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 60, expect.objectContaining({ skill: 'Q' }));
  const far = enemy(825);
  enemies.length = 0;
  enemies.push(far);
  g.hurtEnemy.mockClear();
  kit.cast('Q', 0, new THREE.Vector3(5000, 0, 0));
  step(1);
  expect(g.hurtEnemy).toHaveBeenCalledWith(far, 60, expect.anything());
});

it('the Ball snaps back past the 1290 leash (0.75s on Shockwave) and attaches when Orianna walks onto it', () => {
  const { g, kit, step } = rig();
  kit.cast('Q', 0, new THREE.Vector3(800, 0, 0));
  step(1);
  g.pos.set(-500, 0, 0); // 1300 away
  step(0.05);
  expect(g.cooldowns.R).toBeCloseTo(0.75);
  expect(g.player.hideBone).toHaveBeenLastCalledWith('BallUpper', false);
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 0)); // lands 500 from her
  step(1);
  g.player.hideBone.mockClear();
  g.pos.set(-150, 0, 0); // within the 135 pick-up (+ her radius)
  step(0.05);
  expect(g.player.hideBone).toHaveBeenLastCalledWith('BallUpper', false);
});

it('Command: Protect: instant shield on Orianna, else the Ball flies back hitting enemies; resistances while held', () => {
  const { g, kit, enemies, step } = rig();
  expect(kit.stat!('armor')).toBe(30);
  kit.cast('E', 4, g.pos);
  expect(g.addShield).toHaveBeenCalledWith(195, 2.5);
  kit.cast('Q', 0, new THREE.Vector3(800, 0, 0));
  step(1);
  expect(kit.stat!('mr')).toBe(0);
  const e = enemy(400);
  enemies.push(e);
  g.hurtEnemy.mockClear();
  g.addShield.mockClear();
  kit.cast('E', 4, g.pos);
  expect(kit.canCast!('Q')).toBe(false); // nothing while it flies to her
  step(1);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 180, expect.objectContaining({ skill: 'E' }));
  expect(g.addShield).toHaveBeenCalledWith(195, 2.5);
  expect(kit.stat!('armor')).toBe(30);
});

it('Shockwave pressed while the Ball flies goes off 0.5s after it lands, tossing enemies 325 toward it', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(900);
  enemies.push(e);
  kit.cast('Q', 0, new THREE.Vector3(700, 0, 0));
  expect(kit.canCast!('E')).toBe(false);
  kit.cast('R', 2, g.pos);
  step(0.45); // lands at 0.5s
  expect(g.knockBack).not.toHaveBeenCalled();
  step(0.6);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 475, expect.objectContaining({ skill: 'R' }));
  const [, offset, stun] = g.knockBack.mock.calls[0];
  expect(offset.x).toBeCloseTo(-325);
  expect(stun).toBe(0.75);
});
