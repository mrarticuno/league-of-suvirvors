// Brand's Blaze (src/champions/brand.ts): Ablaze stacks, the burn, the detonation and its lockout, mana on kills.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { BRAND } from '../src/champions/brand';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

const ABILITY: Hit = { type: 'magic', source: 'ability', skill: 'Q' };
const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn() },
    hurtEnemy: vi.fn(), enemiesNear: () => enemies,
  };
  const kit = BRAND.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < seconds / 0.05; i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion') =>
  ({ def: { tier, radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3() }) as unknown as Enemy;
const blazeHits = (g: ReturnType<typeof rig>['g'], e: Enemy) =>
  g.hurtEnemy.mock.calls.filter(([x, , hit]) => x === e && hit.source === 'item').map(([, dmg]) => dmg as number);

it('abilities stack Ablaze and it burns 2% max Health plus a flat part per stack over 4s', () => {
  const { g, kit, step } = rig();
  const e = enemy();
  kit.onDamage!(e, AUTO); // basic attacks do not ablaze
  step(1);
  expect(blazeHits(g, e)).toEqual([]);
  kit.onDamage!(e, ABILITY);
  step(4.5); // 8 ticks of 0.5s (the fixed 0.05s steps land each tick one step late)
  const total = blazeHits(g, e).reduce((a, b) => a + b, 0);
  expect(blazeHits(g, e)).toHaveLength(8);
  expect(total).toBeCloseTo(0.02 * 100 + 8); // level 1 flat part
  step(1);
  expect(blazeHits(g, e).reduce((a, b) => a + b, 0)).toBeCloseTo(total); // burnt out
});

it('the 3rd stack detonates after 2s, then the target can only hold 1 stack for 4s', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy();
  enemies.push(e);
  for (let i = 0; i < 3; i++) kit.onDamage!(e, ABILITY);
  step(1.9);
  expect(g.vfx.playAt).not.toHaveBeenCalledWith('Brand_P_Apoc_Detonate_big', expect.anything());
  step(0.2);
  expect(g.vfx.playAt).toHaveBeenCalledWith('Brand_P_Apoc_Detonate_big', expect.anything());
  const booms = () => g.vfx.playAt.mock.calls.filter(([k]) => k === 'Brand_P_Apoc_Detonate_big').length;
  for (let i = 0; i < 3; i++) kit.onDamage!(e, ABILITY);
  step(3);
  expect(booms()).toBe(1); // locked out: no second ring
});

it('kills restore mana: once per second from small enemies, always from elite and epic ones', () => {
  const { g, kit } = rig();
  kit.onKill!(enemy(), ABILITY);
  expect(g.mana).toBe(20);
  kit.onKill!(enemy(), ABILITY);
  expect(g.mana).toBe(20);
  kit.onKill!(enemy('elite'), ABILITY);
  expect(g.mana).toBe(40);
  kit.onKill!(enemy(), AUTO); // not ablazed, not an ability: nothing
  g.time = 2;
  kit.onKill!(enemy(), AUTO);
  expect(g.mana).toBe(40);
});
