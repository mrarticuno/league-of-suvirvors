// Kayle's Divine Ascent and Starfire Spellblade (src/champions/kayle.ts): range per form, Zeal, Exalted, the on-hit damage
// and the empowered attack's missing-Health bonus, Radiant Blast's resistance shred.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { KAYLE } from '../src/champions/kayle';
import type { Enemy, Game } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
const ABILITY: Hit = { type: 'magic', source: 'ability', skill: 'Q' };

function rig(level = 1) {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level, ap: 0, bonusAd: 0, attackSpeed: 0.625, critChance: 0, facing: 0,
    items: { critDamage: 0 }, ranks: { Q: 0, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    pos: new THREE.Vector3(), scene: new THREE.Scene(),
    player: {
      root: new THREE.Group(), currentName: '', bone: () => undefined, showSubmesh: vi.fn(),
    },
    vfx: { attach: () => new THREE.Group(), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(), play: vi.fn() },
    gesture: vi.fn(), resetAttack: vi.fn(), heal: vi.fn(), hurtEnemy: vi.fn(), slow: vi.fn(), spawnMissile: vi.fn(),
    enemiesNear: () => enemies, learned: (k: 'Q' | 'W' | 'E' | 'R') => g.ranks[k] > 0,
  };
  const kit = KAYLE.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < seconds / 0.05; i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (tier: Enemy['def']['tier'] = 'minion', hp = 1000, maxHp = 1000) =>
  ({ def: { tier, radius: 50 }, hp, maxHp, deadFor: -1, pos: new THREE.Vector3(100, 0, 0), actor: { root: new THREE.Group() } }) as unknown as Enemy;

it('melee until Arisen (250 here, League 175), then 525, then 625 when Transcendent', () => {
  const { g, kit } = rig();
  expect(250 + kit.stat!('range')).toBe(250);
  g.level = 6;
  expect(250 + kit.stat!('range')).toBe(525);
  g.level = 16;
  expect(250 + kit.stat!('range')).toBe(625);
});

it('each attack adds a Zeal stack (6% attack speed for 5s); five make her Exalted (+10% move speed)', () => {
  const { kit, step } = rig();
  const e = enemy();
  for (let i = 0; i < 4; i++) { kit.attackStart!(e, false); kit.basicAttack!(e, 50, false, false); }
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.24);
  expect(kit.moveSpeedBonus!()).toBe(0);
  kit.attackStart!(e, false); kit.basicAttack!(e, 50, false, false);
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.3);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.1);
  step(5.1);
  expect(kit.attackSpeedBonus!()).toBe(0); // all stacks drop at once
});

it('Transcendent is always Exalted', () => {
  const { kit } = rig(16);
  expect(kit.attackSpeedBonus!()).toBeCloseTo(0.3);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.1);
});

it('Starfire Spellblade: on-hit magic damage, and the empowered strike adds missing Health (capped at 400 on monsters)', () => {
  const { g, kit } = rig(6);
  g.ranks.E = 5;
  const minion = enemy('minion', 1000, 11000), monster = enemy('monster', 1000, 11000);
  expect(kit.onDamage!(minion, ABILITY)).toBe(0);
  expect(kit.onDamage!(minion, AUTO)).toBe(35);
  kit.cast('E', 4, new THREE.Vector3());
  kit.attackStart!(minion, false);
  kit.basicAttack!(minion, 50, false, false);
  // the empowered attack is a missile: its hit resolves the strike
  const [, , , opts] = g.spawnMissile.mock.calls.at(-1)!;
  g.hurtEnemy.mockImplementation((e: Enemy, _d: number, hit: Hit) => {
    (e as unknown as { bonus: number }).bonus = kit.onDamage!(e, hit);
  });
  opts.onHit(minion);
  expect((minion as unknown as { bonus: number }).bonus).toBeCloseTo(35 + 0.1 * 10000);
  kit.cast('E', 4, new THREE.Vector3());
  kit.attackStart!(monster, false);
  kit.basicAttack!(monster, 50, false, false);
  g.spawnMissile.mock.calls.at(-1)![3].onHit(monster);
  expect((monster as unknown as { bonus: number }).bonus).toBeCloseTo(35 + 400);
});

it('Radiant Blast shreds 15% armor and magic resist for 4s', () => {
  const { g, kit, enemies, step } = rig();
  const e = enemy();
  enemies.push(e);
  g.ranks.Q = 1;
  kit.castStart!('Q', new THREE.Vector3(500, 0, 0));
  step(0.3); // the sword leaves the portal after 0.25s
  const [key, , , opts] = g.spawnMissile.mock.calls[0];
  expect(key).toBe('Kayle_Q_Mis');
  opts.onHit(e, { pos: e.pos.clone() });
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 60, ABILITY);
  expect(kit.resistShred!(e, 'magic')).toBe(0.15);
  step(4.1);
  expect(kit.resistShred!(e, 'physical')).toBe(0);
});

it('Divine Judgment: invulnerable for 2.5s, then the swords strike every enemy around her', () => {
  const { g, kit, enemies, step } = rig(6);
  const e = enemy();
  enemies.push(e);
  kit.cast('R', 0, new THREE.Vector3());
  expect(kit.invulnerable!()).toBe(true);
  step(2.4);
  expect(g.hurtEnemy).not.toHaveBeenCalled();
  step(0.2);
  expect(kit.invulnerable!()).toBe(false);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, 200, { type: 'magic', source: 'ability', skill: 'R' });
});
