// Aurora's Spirit Abjuration (src/champions/aurora.ts): stacks, the 3rd-stack proc and its monster cap, Spirits and their
// heal, mana on kills, and Twofold Hex's recast damage modifiers.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { AURORA } from '../src/champions/aurora';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class { constructor() { throw new Error('no model'); } } }));

const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
const ITEM: Hit = { type: 'magic', source: 'item' };
const Q_HIT: Hit = { type: 'magic', source: 'ability', skill: 'Q' };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, alive: true, facing: 0, moveSpeed: 335,
    pos: new THREE.Vector3(), scene: new THREE.Scene(), ranks: { Q: 5, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 5, E: 0, R: 0 },
    player: { bone: () => undefined },
    vfx: {
      attach: () => new THREE.Group(), hit: vi.fn(), playAt: vi.fn(), playOn: vi.fn(), play: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: () => {} }),
    },
    hurtEnemy: vi.fn(), heal: vi.fn(), gesture: vi.fn(), spawnMissile: vi.fn(), impact: vi.fn(),
    enemiesNear: () => enemies,
  };
  const kit = AURORA.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion', maxHp = 1000) =>
  ({ def: { tier, radius: 50 }, hp: maxHp, maxHp, deadFor: -1, pos: new THREE.Vector3() }) as unknown as Enemy;

it('the third stack within 4s deals 1% (+2.7% per 100 AP) max Health; item damage does not stack', () => {
  const { g, kit, step } = rig();
  const e = enemy('minion', 10000);
  expect(kit.onDamage!(e, ITEM)).toBe(0);
  expect(kit.onDamage!(e, AUTO)).toBe(0);
  expect(kit.onDamage!(e, AUTO)).toBe(0);
  g.ap = 100;
  expect(kit.onDamage!(e, AUTO)).toBeCloseTo(0.037 * 10000);
  // stacks expire after 4s
  kit.onDamage!(e, AUTO);
  kit.onDamage!(e, AUTO);
  step(4.1);
  expect(kit.onDamage!(e, AUTO)).toBe(0);
});

it('the proc is capped at 100-270 (by level) against monsters, not minions', () => {
  const { kit } = rig();
  const m = enemy('monster', 100000);
  for (let i = 0; i < 2; i++) kit.onDamage!(m, AUTO);
  expect(kit.onDamage!(m, AUTO)).toBe(100); // level 1: 90 + 10
  const minion = enemy('minion', 100000);
  for (let i = 0; i < 2; i++) kit.onDamage!(minion, AUTO);
  expect(kit.onDamage!(minion, AUTO)).toBeCloseTo(1000);
});

it('procs free Spirits (small enemies once per 5s, elites always) that heal every second and leave after 4s', () => {
  const { g, kit, step } = rig();
  const proc = (e: Enemy) => { for (let i = 0; i < 3; i++) kit.onDamage!(e, AUTO); };
  proc(enemy());
  proc(enemy()); // within 5s: no second Spirit from a minion
  expect(kit.hud!()).toContain('1/4');
  proc(enemy('elite'));
  expect(kit.hud!()).toContain('2/4');
  step(1.05);
  expect(g.heal).toHaveBeenCalledWith(2 * 3); // 2 Spirits x 3 at level 1
  step(3.1);
  expect(kit.hud!()).toContain('0/4');
});

it('kills by abilities restore 10 mana at level 1, once per second from minions', () => {
  const { g, kit, step } = rig();
  kit.onKill!(enemy(), Q_HIT);
  kit.onKill!(enemy(), Q_HIT);
  expect(g.mana).toBe(10);
  kit.onKill!(enemy('epic'), Q_HIT);
  expect(g.mana).toBe(20);
  expect(g.cooldowns.W).toBe(0); // Across the Veil resets on an elite/epic kill
  step(1.05);
  kit.onKill!(enemy(), AUTO); // no stacks, not an ability: nothing
  expect(g.mana).toBe(20);
});

it('the recast bolts deal 40% to minions, scaled up to +50% by missing Health, and 20% on later bolts', () => {
  const { g, kit, enemies, step } = rig();
  const a = enemy('minion'), b = enemy('minion');
  a.pos.set(0, 0, 600); b.pos.set(0, 0, 600);
  a.hp = 500; // 50% missing: +25%
  enemies.push(a, b);
  kit.cast('Q', 4, new THREE.Vector3(0, 0, 600));
  const onHit = g.spawnMissile.mock.calls[0][3].onHit;
  onHit(a, {}); onHit(b, {});
  step(0.2);
  kit.recast!('Q', new THREE.Vector3());
  step(1);
  const bolts = g.hurtEnemy.mock.calls.filter(([e, , hit]) => hit.skill === 'Q' && (e === a || e === b)).map(([e, dmg]) => [e === a ? 'a' : 'b', Math.round(dmg)]);
  const full = 145 * 0.4;
  expect(bolts).toContainEqual(['a', Math.round(full * 1.25)]);
  expect(bolts).toContainEqual(['b', Math.round(full)]);
  expect(bolts).toContainEqual(['a', Math.round(full * 1.25 * 0.2)]);
});
