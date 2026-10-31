// Udyr (src/champions/udyr.ts): Bridge Between's stances, empowered attacks, global cooldown, the Awaken recast and
// Awakened Spirit's cooldown with Monk Training refunds, Claw's lightning, Stampede's stun, the storm and mana on kills.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { UDYR } from '../src/champions/udyr';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ad: 62, bonusAd: 0, ap: 0, abilityHaste: 0, alive: true, facing: 0, hp: 600, maxHp: 664, mana: 100, maxMana: 300, moveSpeed: 350,
    ranks: { Q: 1, W: 1, E: 1, R: 1 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    pos: new THREE.Vector3(), scene: new THREE.Scene(),
    player: { bone: () => null, root: new THREE.Object3D(), showSubmesh: vi.fn() },
    vfx: { attach: () => new THREE.Group(), play: vi.fn(() => null), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn() },
    hurtEnemy: vi.fn(), heal: vi.fn(), addShield: vi.fn(), slow: vi.fn(), stunEnemy: vi.fn(), dash: vi.fn(), gesture: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number, out: Enemy[] = []) => {
      out.length = 0;
      for (const e of enemies) if (e.pos.distanceTo(p) <= r + e.def.radius) out.push(e);
      return out;
    },
    nearestEnemy: (p: THREE.Vector3, r: number) => enemies.find((e) => e.deadFor < 0 && e.pos.distanceTo(p) - e.def.radius <= r) ?? null,
  };
  const kit = UDYR.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  const attack = (e: Enemy) => { kit.attackStart!(e, false); kit.basicAttack!(e, g.ad, false, false); };
  return { g, kit, enemies, step, attack };
}
const enemy = (x: number, tier: Enemy['def']['tier'] = 'minion', maxHp = 1000) =>
  ({ def: { tier, radius: 50 }, hp: maxHp, maxHp, deadFor: -1, pos: new THREE.Vector3(x, 0, 0) }) as unknown as Enemy;
const dealt = (g: ReturnType<typeof rig>['g'], e: Enemy) => g.hurtEnemy.mock.calls.filter(([x]) => x === e).map(([, d]) => d as number);

it('a stance empowers two attacks, puts the other stances on a 1.5s global cooldown and refunds Awakened Spirit', () => {
  const { g, kit, step, attack } = rig();
  const e = enemy(100);
  kit.cast('Q', 0, g.pos);
  expect(g.cooldowns).toEqual({ Q: 0, W: 1.5, E: 1.5, R: 1.5 });
  expect(kit.skillView!('Q')?.badge).toBe('2');
  expect(kit.stat!('range')).toBe(50); // Claw reach
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.3 + 0.2); // Monk Training + Claw rank 1
  step(0.5);
  attack(e);
  // rank 1 Claw: 3% max Health on the empowered attack plus the 4s on-hit bonus (6 at rank 1)
  expect(dealt(g, e)[0]).toBeCloseTo(62 + 6 + 0.03 * 1000);
  attack(e);
  expect(kit.skillView!('Q')).toBeUndefined();
  expect(kit.stat!('range')).toBe(0);
  attack(e);
  expect(dealt(g, e)[2]).toBeCloseTo(62 + 6); // no more empowered attacks, the on-hit bonus still runs
  // Awakened Spirit starts on full cooldown (50s at level 1); two Monk Training attacks refunded 5% each
  expect(kit.gauge!().label).toBe(`${Math.ceil(50 - 5 - 0.5)}s`);
});

it('Awaken: the stance recast 0.25-5s after entering it, once per Awakened Spirit; the Claw lightning strikes 6 times', () => {
  const { g, kit, enemies, step, attack } = rig();
  const e = enemy(100), f = enemy(300);
  enemies.push(e, f);
  step(50.1); // Awakened Spirit ready
  expect(kit.gauge!().label).toBe('✦');
  kit.cast('Q', 0, g.pos);
  kit.recast!('Q', g.pos); // too early
  expect(kit.gauge!().label).toBe('✦');
  step(0.3);
  g.cooldowns.W = 0; // the stub never runs cooldowns down
  kit.recast!('Q', g.pos);
  expect(kit.gauge!().label).not.toBe('✦');
  expect(g.cooldowns.W).toBe(0.5); // the Awaken cast's shorter global cooldown
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.3 + 0.2 + 0.2); // + 20% at level 1
  attack(e);
  step(1.1);
  const strikes = g.hurtEnemy.mock.calls.filter(([, , h]) => h.skill === 'Q');
  expect(strikes).toHaveLength(6);
  for (const [, d] of strikes) expect(d).toBe(40); // 1.5% of 1000 is floored at 40 against minions
});

it('Stampede stuns once per target every 6s at rank 1 and Mantle heals on its empowered hits', () => {
  const { g, kit, step, attack } = rig();
  const e = enemy(100);
  kit.cast('E', 0, g.pos);
  expect(kit.ghost!()).toBe(true);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.25);
  step(1.5);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.25 * 0.3); // decayed to 30%
  attack(e);
  attack(e);
  expect(g.stunEnemy).toHaveBeenCalledTimes(1);
  step(3);
  expect(kit.ghost!()).toBe(false);
  kit.cast('W', 0, g.pos);
  expect(g.addShield).toHaveBeenCalledWith(45 + 0.02 * 664, 4);
  attack(e);
  expect(g.heal).toHaveBeenCalledWith(expect.closeTo(0.012 * 664 * 0.6, 3)); // 60% against minions
  kit.onDealt!(e, g.hurtEnemy.mock.calls.at(-1)![2], 100);
  expect(g.heal).toHaveBeenLastCalledWith(expect.closeTo(15, 3)); // 15% life steal
});

it('the blizzard ticks 8 times over 4s around Udyr, slows, and kills by the storm restore mana once a second', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(200, 'monster');
  enemies.push(e);
  kit.cast('R', 0, g.pos);
  step(4.1);
  const ticks = g.hurtEnemy.mock.calls.filter(([, , h]) => h.skill === 'R');
  expect(ticks).toHaveLength(8);
  expect(ticks[0][1]).toBeCloseTo(10); // 20 / 2 per tick at rank 1, no AP
  expect(g.slow).toHaveBeenCalledWith(e, 0.15, 2);
  kit.onKill!(e, ticks[0][2]);
  expect(g.mana).toBe(110);
  kit.onKill!(enemy(0), ticks[0][2]);
  expect(g.mana).toBe(110); // within the second
  step(1.05);
  kit.onKill!(enemy(0), ticks[0][2]);
  expect(g.mana).toBe(120);
});
