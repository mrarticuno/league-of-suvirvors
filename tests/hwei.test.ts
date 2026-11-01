// Hwei (src/champions/hwei.ts): moods route the keys to their spells, Wash Brush, Signature of the Visionary and
// Stirring Lights' mana.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Hit } from '../src/champion';
import { HWEI } from '../src/champions/hwei';
import type { Enemy, Game, MissileOpts } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));

function rig() {
  const enemies: Enemy[] = [];
  const missiles: MissileOpts[] = [];
  const g = {
    time: 0, level: 1, ap: 0, mana: 0, maxMana: 500, stunned: 0, facing: 0, alive: true, moveSpeed: 330,
    pos: new THREE.Vector3(), scene: new THREE.Scene(), ranks: { Q: 1, W: 1, E: 1, R: 1 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    player: { bone: () => undefined, root: new THREE.Group() },
    vfx: { play: vi.fn(() => null), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn() },
    learned: () => true, gesture: vi.fn(), slow: vi.fn(), hurtEnemy: vi.fn(), enemiesNear: () => enemies,
    spawnMissile: vi.fn((_fx: string, _from: THREE.Vector3, _to: THREE.Vector3, o: MissileOpts) => missiles.push(o)),
  };
  const kit = HWEI.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < seconds / 0.05; i++) { g.time += 0.05; kit.update!(0.05); } };
  /** Presses the mood key then the spell key, and resolves the cast like the Game does. */
  const cast = (mood: 'Q' | 'W' | 'E', spell: 'Q' | 'W' | 'E', at = new THREE.Vector3(0, 0, 300)) => {
    expect(kit.press!(mood, at)).toBeNull();
    const key = kit.press!(spell, at)!;
    expect(key).toBe(mood);
    kit.castStart!(key, at);
    kit.cast(key, 0, at);
  };
  return { g, kit, enemies, missiles, step, cast };
}
const enemy = () => ({ def: { tier: 'minion', radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(0, 0, 300) }) as unknown as Enemy;
const procs = (g: ReturnType<typeof rig>['g']) => g.hurtEnemy.mock.calls.filter(([, , hit]) => (hit as Hit).source === 'item');

it('a mood key opens its spells: the next key casts one with the mood\'s rank, cost and cooldown; R washes it', () => {
  const { kit, g } = rig();
  const at = new THREE.Vector3();
  expect(kit.press!('Q', at)).toBeNull();
  expect(kit.skillView!('W')).toMatchObject({ as: 'Q' });
  expect(kit.skillView!('R')).toMatchObject({ as: null });
  expect(kit.aim!('W')).toBe(1900); // Severing Bolt's range
  expect(kit.press!('R', at)).toBeNull(); // Wash Brush
  expect(kit.skillView!('W')).toBeUndefined();
  expect(kit.press!('R', at)).toBeUndefined(); // out of a mood, R is Spiraling Despair
  g.cooldowns.E = 3;
  expect(kit.press!('E', at)).toBeNull(); // a mood on cooldown does not open
  expect(kit.skillView!('Q')).toBeUndefined();
});

it('a mark left by one spell is consumed by a different one: an explosion 0.85s later where the enemy stood', () => {
  const { g, enemies, missiles, step, cast } = rig();
  const e = enemy();
  enemies.push(e);
  cast('Q', 'W'); // Severing Bolt strikes after 1s and marks
  step(1.05);
  expect(g.hurtEnemy).toHaveBeenCalledWith(e, expect.any(Number), expect.objectContaining({ skill: 'Q', source: 'ability' }));
  expect(g.vfx.playAt).not.toHaveBeenCalledWith('Hwei_Passive_Detonate_Warning', expect.anything());
  cast('Q', 'Q'); // Devastating Fire: a different spell consumes the mark
  missiles[0].onHit!(e, { pos: e.pos.clone(), dir: new THREE.Vector3(0, 0, 1) } as never);
  expect(g.vfx.playAt).toHaveBeenCalledWith('Hwei_Passive_Detonate_Warning', expect.anything());
  expect(procs(g)).toHaveLength(0);
  step(0.9);
  expect(procs(g)).toHaveLength(1); // 40 (+35% AP) at level 1
  expect(procs(g)[0][1]).toBeCloseTo(40);
});

it('the same spell twice only refreshes the mark', () => {
  const { g, enemies, step, cast } = rig();
  enemies.push(enemy());
  cast('Q', 'W');
  step(1.05);
  g.cooldowns.Q = 0;
  cast('Q', 'W');
  step(1.05);
  expect(g.vfx.playAt).not.toHaveBeenCalledWith('Hwei_Passive_Detonate_Warning', expect.anything());
});

it('Stirring Lights: each basic attack spends a flare that restores mana, three at most', () => {
  const { g, kit, missiles, cast } = rig();
  cast('W', 'E');
  const auto: Hit = { type: 'physical', source: 'auto', onHit: true };
  for (let i = 0; i < 4; i++) kit.onDamage!(enemy(), auto);
  expect(missiles).toHaveLength(3); // three flares fly to the targets
  expect(g.mana).toBe(3 * 45); // rank 1: 45 mana each
});
