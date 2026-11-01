// Veigar's Phenomenal Evil Power (src/champions/veigar.ts): stacks from Baleful Strike kills and elite/epic hits, AP per
// stack, Dark Matter's cooldown by stacks, mana on ability kills, Event Horizon's edge stun, Primordial Burst's execute.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { VEIGAR } from '../src/champions/veigar';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

const Q: Hit = { type: 'magic', source: 'ability', skill: 'Q' };
const W: Hit = { type: 'magic', source: 'ability', skill: 'W' };
const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, pos: new THREE.Vector3(), facing: 0, scene: new THREE.Scene(),
    ranks: { Q: 1, W: 1, E: 1, R: 1 },
    player: { bone: () => undefined, root: new THREE.Object3D() },
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), play: vi.fn(), hit: vi.fn(), playOn: vi.fn(), missile: () => ({ root: new THREE.Object3D(), update: () => {} }) },
    hurtEnemy: vi.fn(), stunEnemy: vi.fn(), enemiesNear: () => enemies, enemyAt: () => null,
    nearestEnemy: (_p: THREE.Vector3, _r: number, f?: (e: Enemy) => boolean) => enemies.find((e) => !f || f(e)) ?? null,
  };
  const kit = VEIGAR.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion', radius = 48, at = new THREE.Vector3()) =>
  ({ def: { tier, radius }, hp: 100, maxHp: 100, deadFor: -1, pos: at }) as unknown as Enemy;

it('Baleful Strike kills grant 1 stack, 3 for large minions and monsters; each stack is 1 AP', () => {
  const { kit } = rig();
  kit.onKill!(enemy(), Q);
  expect(kit.stat!('ap')).toBe(1);
  kit.onKill!(enemy('minion', 65), Q); // siege minion
  expect(kit.stat!('ap')).toBe(4);
  kit.onKill!(enemy(), W); // other abilities' kills: no stack from small enemies
  kit.onKill!(enemy(), AUTO);
  expect(kit.stat!('ap')).toBe(4);
});

it('ability hits on elite and epic monsters grant 1 stack, their takedowns 5', () => {
  const { kit } = rig();
  kit.onDamage!(enemy('elite', 70), W);
  kit.onDamage!(enemy(), W);
  kit.onDamage!(enemy('epic', 90), AUTO);
  expect(kit.stat!('ap')).toBe(1);
  kit.onKill!(enemy('epic', 90), W);
  expect(kit.stat!('ap')).toBe(6);
});

it("Dark Matter's 8s cooldown drops 10% per 50 stacks", () => {
  const { kit } = rig();
  expect(kit.cooldownBase!('W')).toBe(8);
  for (let i = 0; i < 49; i++) kit.onKill!(enemy(), Q);
  expect(kit.cooldownBase!('W')).toBe(8);
  kit.onKill!(enemy(), Q);
  expect(kit.cooldownBase!('W')).toBeCloseTo(7.2);
  for (let i = 0; i < 50; i++) kit.onKill!(enemy(), Q);
  expect(kit.cooldownBase!('W')).toBeCloseTo(6.48);
  expect(kit.cooldownBase!('Q')).toBeUndefined();
});

it('ability kills restore mana: once per second from small enemies, always from elite and epic ones', () => {
  const { g, kit } = rig();
  kit.onKill!(enemy(), Q);
  expect(g.mana).toBe(20);
  kit.onKill!(enemy(), W);
  expect(g.mana).toBe(20);
  kit.onKill!(enemy('elite', 70), W);
  expect(g.mana).toBe(40);
  g.time = 2;
  kit.onKill!(enemy(), AUTO);
  expect(g.mana).toBe(40);
});

it('Event Horizon erects after 0.5s and stuns enemies on its edge once, not those inside', () => {
  const { g, kit, enemies, step } = rig();
  const edge = enemy('minion', 48, new THREE.Vector3(350, 0, 0));
  const inside = enemy('minion', 48, new THREE.Vector3(100, 0, 0));
  enemies.push(edge, inside);
  kit.cast('E', 0, new THREE.Vector3());
  step(0.4);
  expect(g.stunEnemy).not.toHaveBeenCalled();
  step(0.2);
  expect(g.stunEnemy).toHaveBeenCalledWith(edge, 1.5);
  expect(g.stunEnemy).not.toHaveBeenCalledWith(inside, expect.anything());
  step(1);
  expect(g.stunEnemy).toHaveBeenCalledTimes(1); // once per cast
  inside.pos.set(300, 0, 0); // walks into the edge
  step(0.1);
  expect(g.stunEnemy).toHaveBeenCalledWith(inside, 1.5);
});

it('Primordial Burst deals up to double damage by missing Health', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy('minion', 48, new THREE.Vector3(300, 0, 0));
  e.hp = 50; // 50% missing: +75%
  enemies.push(e);
  kit.cast('R', 0, e.pos);
  step(1);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 175 * 1.75, expect.objectContaining({ skill: 'R' }));
  const low = enemy('minion', 48, new THREE.Vector3(300, 0, 0));
  low.hp = 10; // past 66.7% missing: double
  enemies.length = 0;
  enemies.push(low);
  kit.cast('R', 0, low.pos);
  step(1);
  expect(g.hurtEnemy).toHaveBeenCalledWith(low, 350, expect.objectContaining({ skill: 'R' }));
});
