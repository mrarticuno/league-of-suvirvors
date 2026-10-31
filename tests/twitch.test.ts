// Twitch (src/champions/twitch.ts): Deadly Venom's stacks and ticks, Ambush's buffs and reset, Venom Cask's pool,
// Contaminate's per-stack damage and Spray and Pray's piercing bolts.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { TWITCH } from '../src/champions/twitch';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ad: 60, bonusAd: 0, ap: 0, attackRange: 550, facing: 0,
    ranks: { Q: 1, W: 1, E: 1, R: 1 }, cooldowns: { Q: 10, W: 0, E: 0, R: 0 },
    pos: new THREE.Vector3(), scene: new THREE.Scene(), player: { bone: () => null, root: new THREE.Object3D() },
    vfx: {
      attach: () => new THREE.Group(), play: vi.fn(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: vi.fn() }),
    },
    hurtEnemy: vi.fn(), spawnMissile: vi.fn(), slow: vi.fn(),
    enemiesNear: (p: THREE.Vector3, r: number, out: Enemy[] = []) => {
      out.length = 0;
      for (const e of enemies) if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= r + e.def.radius) out.push(e);
      return out;
    },
    nearestEnemy: (p: THREE.Vector3, r: number, f?: (e: Enemy) => boolean) =>
      enemies.find((e) => e.pos.distanceTo(p) <= r + e.def.radius && (!f || f(e))) ?? null,
  };
  const kit = TWITCH.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (z: number, tier: Enemy['def']['tier'] = 'minion') =>
  ({ def: { tier, radius: 50 }, hp: 5000, deadFor: -1, pos: new THREE.Vector3(0, 0, z) }) as unknown as Enemy;
const auto = { type: 'physical', source: 'auto', onHit: true } as const;
const venomTicks = (g: ReturnType<typeof rig>['g']) => g.hurtEnemy.mock.calls.filter(([, , h]) => h.type === 'true').map(([, d]) => d);

it('Deadly Venom: on-hit stacks up to 6, 1 true damage per stack each second for 6s after the last stack', () => {
  const { g, kit, step } = rig();
  const e = enemy(300);
  for (let i = 0; i < 8; i++) kit.onDamage!(e, auto);
  kit.onDamage!(e, { type: 'physical', source: 'ability', skill: 'Q' }); // abilities do not poison
  step(6.5);
  expect(venomTicks(g)).toEqual([6, 6, 6, 6, 6, 6]);
  step(2);
  expect(venomTicks(g)).toHaveLength(6); // expired
});

it('Ambush: Attack Speed for 6s, Move Speed for the camouflage, cooldown reset on an elite kill', () => {
  const { g, kit, step } = rig();
  kit.cast('Q', 0, g.pos);
  expect(kit.attackSpeedBonus!()).toBe(0.4);
  expect(kit.moveSpeedBonus!()).toBe(0.1);
  step(7);
  expect(kit.attackSpeedBonus!()).toBe(0);
  expect(kit.moveSpeedBonus!()).toBe(0.1); // 10s at rank 1
  kit.onKill!(enemy(0), auto);
  expect(g.cooldowns.Q).toBe(10);
  kit.onKill!(enemy(0, 'elite'), auto);
  expect(g.cooldowns.Q).toBe(0);
});

it('Venom Cask: a stack and a slow on impact, a stack each second in the pool, at most 4 per cask', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(500);
  enemies.push(e);
  kit.cast('W', 0, new THREE.Vector3(0, 0, 500));
  step(0.5); // 500 units at 1400 u/s
  expect(g.slow).toHaveBeenCalledWith(e, 0.3, expect.any(Number));
  step(4);
  g.hurtEnemy.mockClear();
  step(1); // 4 stacks tick for 4
  expect(venomTicks(g)).toEqual([4]);
});

it('Contaminate: needs a poisoned enemy; base plus per-stack damage when the toxin lands', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy(600);
  enemies.push(e);
  expect(kit.canCast!('E')).toBe(false);
  for (let i = 0; i < 3; i++) kit.onDamage!(e, auto);
  expect(kit.canCast!('E')).toBe(true);
  kit.castStart!('E', g.pos);
  kit.cast('E', 0, g.pos);
  step(0.3); // 600 units at 3000 u/s
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 20 + 3 * 15, expect.objectContaining({ skill: 'E' }));
});

it('Spray and Pray: bonus AD and range; attacks become piercing bolts losing 10% per enemy, down to 60%', () => {
  const { g, kit } = rig();
  kit.cast('R', 0, g.pos);
  expect(kit.stat!('ad')).toBe(30);
  expect(kit.stat!('range')).toBe(300);
  const target = enemy(300);
  expect(kit.basicAttack!(target, 100, false, false)).toBe(true);
  const [key, , , o] = g.spawnMissile.mock.calls[0];
  expect(key).toBe('Twitch_R_mis');
  expect(o.pierce).toBe(true);
  const m = { pos: new THREE.Vector3(0, 110, 0), dir: new THREE.Vector3(0, 0, 1), hit: o.hit };
  for (let i = 0; i < 6; i++) o.onHit(enemy(100 * i), m);
  expect(g.hurtEnemy.mock.calls.map(([, d]) => Math.round(d))).toEqual([100, 90, 80, 70, 60, 60]);
  expect(kit.basicAttack!(target, 100, false, true)).toBe(false); // Runaan's bolts do not pierce
});
