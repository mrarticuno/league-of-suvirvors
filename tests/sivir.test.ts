// Sivir (src/champions/sivir.ts): Fleet of Foot, the boomerang's two passes and falloff, Ricochet's bounces, the
// spell shield's block and heal, On the Hunt's cooldown refunds and refresh.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { SIVIR } from '../src/champions/sivir';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

const BASE_MS = 335;

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ad: 60, bonusAd: 0, ap: 0, critChance: 0, attackSpeed: 0.625, alive: true,
    items: { critDamage: 0 }, ranks: { Q: 1, W: 1, E: 1, R: 1 }, cooldowns: { Q: 5, W: 5, E: 5, R: 50 },
    pos: new THREE.Vector3(), facing: 0, scene: new THREE.Scene(), player: { bone: () => null, root: new THREE.Object3D() },
    vfx: {
      attach: () => new THREE.Group(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: vi.fn() }),
    },
    hurtEnemy: vi.fn(), heal: vi.fn(), spawnMissile: vi.fn(), impact: vi.fn(), resetAttack: vi.fn(), gesture: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number, out: Enemy[] = []) => {
      out.length = 0;
      for (const e of enemies) if (e.pos.distanceTo(p) <= r + e.def.radius) out.push(e);
      return out;
    },
  };
  const kit = SIVIR.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < seconds / 0.05; i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (z: number, tier: Enemy['def']['tier'] = 'minion', hp = 1000) =>
  ({ def: { tier, radius: 50 }, hp, maxHp: hp, deadFor: -1, pos: new THREE.Vector3(0, 0, z) }) as unknown as Enemy;
const target = () => enemy(300);
const bonusMs = (kit: ReturnType<typeof rig>['kit']) => kit.moveSpeedBonus!() * BASE_MS;

it('Fleet of Foot: an attack grants 55 move speed that decays over 1.5s', () => {
  const { kit, step } = rig();
  expect(bonusMs(kit)).toBe(0);
  kit.attackStart!(target(), false);
  expect(bonusMs(kit)).toBeCloseTo(55);
  step(0.75);
  expect(bonusMs(kit)).toBeCloseTo(27.5);
  step(0.8);
  expect(bonusMs(kit)).toBe(0);
});

it('Boomerang Blade hits each enemy once per pass, 15% weaker per enemy hit, and the falloff resets on the way back', () => {
  const { g, kit, enemies, step } = rig();
  const a = enemy(200), b = enemy(400), c = enemy(600);
  enemies.push(a, b, c);
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 1000));
  step(3); // out 1250 units at 1450 u/s and back at 1200 u/s
  const hits = g.hurtEnemy.mock.calls.map(([e, dmg]) => [e, Math.round(dmg as number)]);
  expect(hits).toEqual([[a, 60], [b, 51], [c, 42], [c, 60], [b, 51], [a, 42]]);
  expect(g.gesture).toHaveBeenCalledWith('sivir_base_spell1_catch'); // caught
});

it('Ricochet: empowered attacks bounce to the nearest enemy, each enemy at most twice, 65% on minions', () => {
  const { g, kit, enemies } = rig();
  const a = enemy(300), b = enemy(500);
  enemies.push(a, b);
  kit.cast('W', 0, g.pos);
  expect(g.resetAttack).toHaveBeenCalled();
  expect(kit.attackSpeedBonus!()).toBe(0.2);
  kit.attackStart!(a, false);
  expect(kit.basicAttack!(a, 60, false, false)).toBe(true);
  // land every missile in flight: the attack, then each bounce spawns the next
  for (let i = 0; i < g.spawnMissile.mock.calls.length; i++) {
    const [key, , , o] = g.spawnMissile.mock.calls[i];
    expect(key).toBe('Sivir_W_mis');
    o.onHit(o.target, { pos: o.target.pos, dir: new THREE.Vector3(0, 0, 1) });
  }
  const bounces = g.spawnMissile.mock.calls.slice(1).map(([, , , o]) => [o.target, Math.round(o.damage * 10) / 10]);
  expect(bounces).toEqual([[b, 15.6], [a, 15.6], [b, 15.6]]); // 40% AD x 65%; a and b were hit twice each
});

it('Spell Shield blocks one hostile ability within 1.5s, heals 60% AD and triggers Fleet of Foot 0.25s later', () => {
  const { g, kit, step } = rig();
  expect(kit.blockSpell!()).toBe(false);
  kit.cast('E', 0, g.pos);
  step(1);
  expect(kit.blockSpell!()).toBe(true);
  expect(g.heal).toHaveBeenCalledWith(36);
  expect(kit.blockSpell!()).toBe(false); // consumed
  expect(bonusMs(kit)).toBe(0);
  step(0.3);
  expect(bonusMs(kit)).toBeGreaterThan(50);
  kit.cast('E', 0, g.pos);
  step(1.6);
  expect(kit.blockSpell!()).toBe(false); // expired
});

it('On the Hunt: 20% move speed, each attack refunds 0.5s of Q, W and E, an elite takedown refreshes it', () => {
  const { g, kit, step } = rig();
  kit.cast('R', 0, g.pos);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.2);
  kit.attackStart!(target(), false);
  expect(g.cooldowns).toEqual({ Q: 4.5, W: 4.5, E: 4.5, R: 50 });
  step(7);
  kit.onKill!(enemy(0, 'elite'), { type: 'physical', source: 'auto' });
  step(7);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.2); // refreshed to 8s at 7s
  step(1.5);
  expect(kit.moveSpeedBonus!()).toBe(0);
});
