// Aurelion Sol (src/champions/aurelionsol.ts): orbiting stars (rehit and minion execute), Celestial Expansion's mana drain, Starsurge's growth
// and detonation, Voice of Light's line, slow and knock-back.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AURELIONSOL } from '../src/champions/aurelionsol';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ap: 0, moveSpeed: 300, hp: 500, mana: 100, maxMana: 500, facing: 0, pos: new THREE.Vector3(), scene: new THREE.Scene(),
    ranks: { Q: 1, W: 1, E: 1, R: 1 },
    vfx: { attach: () => new THREE.Group(), play: vi.fn(), playAt: vi.fn(), playOn: vi.fn() },
    player: { bone: () => null, root: new THREE.Group() },
    hurtEnemy: vi.fn(), stunEnemy: vi.fn(), knockUp: vi.fn(), slow: vi.fn(), knockBack: vi.fn(),
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
  const e = enemy(0, 325);
  enemies.push(e);
  step(4.5); // stars pass over it 1.75s apart (the first one starts on it, back at 5.25s)
  expect(hitsOn(g, e, 'item')).toBe(3);
  const far = enemy(0, 650); // only the expanded orbit reaches it
  enemies.push(far);
  step(3);
  expect(hitsOn(g, far, 'item')).toBe(0);
});

it('stars execute minions left at 25 Health or less', () => {
  const { g, enemies, step } = rig();
  const e = enemy(0, 325);
  e.hp = 20;
  enemies.push(e);
  step(0.05);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 20, expect.objectContaining({ type: 'true' }));
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

it('Starsurge flies out and detonates past the Outer Limit, stunning longer the longer it travelled', () => {
  const { g, kit, enemies, step } = rig();
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 1000));
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.2); // while the star is out
  const e = enemy(0, 690);
  enemies.push(e);
  step(0.5); // 850 slowing to 600: still within 650
  expect(hitsOn(g, e, 'ability')).toBe(0);
  step(0.5); // past 650: detonates on the enemy
  expect(hitsOn(g, e, 'ability')).toBe(1);
  const stun = g.stunEnemy.mock.calls.find(([x]) => x === e)![1];
  expect(stun).toBeGreaterThan(0.55);
  expect(stun).toBeLessThan(2.2);
  expect(kit.moveSpeedBonus!()).toBe(0);
});

it('Starsurge can be recast to detonate early, after 0.25s', () => {
  const { g, kit, enemies, step } = rig();
  kit.cast('Q', 0, new THREE.Vector3(0, 0, 1000));
  const e = enemy(0, 200);
  enemies.push(e);
  step(0.1);
  kit.recast!('Q', new THREE.Vector3());
  expect(hitsOn(g, e, 'ability')).toBe(0); // too soon
  step(0.15);
  kit.recast!('Q', new THREE.Vector3());
  expect(hitsOn(g, e, 'ability')).toBe(1);
  expect(g.stunEnemy).toHaveBeenCalledWith(e, expect.closeTo(0.55 * (1 + 3 * 0.25 / 3), 2));
});

it('Voice of Light hits and slows the line, knocking near enemies back to the Outer Limit', () => {
  const { g, kit, enemies } = rig();
  const near = enemy(300), far = enemy(1400), aside = enemy(800, 400), behind = enemy(-300);
  enemies.push(near, far, aside, behind);
  kit.cast('R', 0, new THREE.Vector3(1000, 0, 0));
  expect(hitsOn(g, near, 'ability')).toBe(1);
  expect(hitsOn(g, far, 'ability')).toBe(1);
  expect(hitsOn(g, aside, 'ability')).toBe(0);
  expect(hitsOn(g, behind, 'ability')).toBe(0);
  expect(g.slow).toHaveBeenCalledWith(far, 0.4, 2);
  expect(g.knockBack).toHaveBeenCalledTimes(1);
  const [who, offset] = g.knockBack.mock.calls[0];
  expect(who).toBe(near);
  expect(offset.x).toBeCloseTo(350); // 300 out to 650
});

it('Comet of Legend flies high through walls and units, at Starsurge speed and unable to attack, for 3s', () => {
  const { g, kit, step } = rig();
  kit.cast('E', 0, new THREE.Vector3());
  expect(kit.ghost!()).toBe(true);
  expect(kit.disarmed!()).toBe(true);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(1); // 300 -> Starsurge's 600
  step(0.5);
  expect(g.player.root.position.y).toBe(150); // up in the sky
  step(2.6);
  expect(kit.ghost!()).toBe(false);
  expect(kit.moveSpeedBonus!()).toBe(0);
  step(0.5);
  g.player.root.position.y = 0; // the Game puts the root back on the ground each frame
  step(0.05);
  expect(g.player.root.position.y).toBe(0); // landed: the kit no longer lifts it
});

it('Comet of Legend keeps flying toward the cast point until a move order ends it', () => {
  const { kit } = rig();
  kit.cast('E', 0, new THREE.Vector3(300, 0, 0));
  expect(kit.steer!()?.x).toBeCloseTo(1);
  kit.onMoveOrder!();
  expect(kit.steer!()).toBeUndefined();
  expect(kit.ghost!()).toBe(false);
});
