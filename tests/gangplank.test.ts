// Gangplank (src/champions/gangplank.ts): Trial by Fire's burn and speed, Powder Keg charges (halved recharge),
// decay, attack swings on kegs and the chain reaction, Remove Scurvy's heal, the Cannon Barrage upgrade picks.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { Choice, Enemy, Game } from '../src/game';
import { GANGPLANK } from '../src/champions/gangplank';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class { constructor() { throw new Error('not loaded'); } } }));

function rig() {
  const enemies: Enemy[] = [];
  const g = {
    time: 0, level: 1, ad: 64, bonusAd: 0, ap: 0, critChance: 0, alive: true, facing: 0, hp: 300, maxHp: 630, mana: 500,
    attackRange: 250, moveSpeed: 345, items: { critDamage: 0 }, ranks: { Q: 1, W: 1, E: 1, R: 1 },
    cooldowns: { Q: 0, W: 0, E: 0, R: 0 }, choices: [] as Choice[],
    pos: new THREE.Vector3(), scene: new THREE.Scene(), player: { bone: () => null, root: new THREE.Object3D() },
    vfx: {
      attach: () => new THREE.Group(), play: vi.fn(() => null), playAt: vi.fn(), hit: vi.fn(), playOn: vi.fn(),
      missile: () => ({ root: new THREE.Object3D(), update: vi.fn() }),
    },
    hurtEnemy: vi.fn(), heal: vi.fn(), slow: vi.fn(), spawnMissile: vi.fn(), attackEffects: vi.fn(), costOf: () => 0, maxMana: 1000,
    cooldownOf: () => 0.5, enemyAt: () => null,
    enemiesNear: (p: THREE.Vector3, r: number, out: Enemy[] = []) => {
      out.length = 0;
      for (const e of enemies) if (e.pos.distanceTo(p) <= r + e.def.radius) out.push(e);
      return out;
    },
    nearestEnemy: (p: THREE.Vector3, r: number, f?: (e: Enemy) => boolean) =>
      enemies.find((e) => e.pos.distanceTo(p) - e.def.radius <= r && (!f || f(e))) ?? null,
  };
  const kit = GANGPLANK.kit(g as unknown as Game);
  const step = (seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { g.time += 0.05; kit.update!(0.05); } };
  return { g, kit, enemies, step };
}
const enemy = (x: number, tier: Enemy['def']['tier'] = 'minion') =>
  ({ def: { tier, radius: 50 }, hp: 1000, maxHp: 1000, deadFor: -1, pos: new THREE.Vector3(x, 0, 0) }) as unknown as Enemy;
const hits = (g: ReturnType<typeof rig>['g'], source: string) =>
  g.hurtEnemy.mock.calls.filter(([, , hit]) => (hit.skill ?? hit.source) === source);

it('Trial by Fire: the empowered attack burns 50 true damage over 2.5s at level 1, grants 15% Move Speed, then waits 15s', () => {
  const { g, kit, step } = rig();
  const e = enemy(200);
  expect(kit.attackStart!(e, false)?.anim).toBe('gangplank_passive_attack');
  kit.basicAttack!(e, 64, false, false);
  expect(kit.moveSpeedBonus!()).toBeCloseTo(0.15);
  step(2.6);
  const burn = hits(g, 'item');
  expect(burn).toHaveLength(10);
  expect(burn.reduce((a, [, d]) => a + d, 0)).toBeCloseTo(50);
  expect(kit.moveSpeedBonus!()).toBe(0);
  expect(kit.attackStart!(e, false)).toBeUndefined(); // on cooldown
  step(12.5);
  expect(kit.attackStart!(e, false)?.anim).toBe('gangplank_passive_attack');
});

it('Powder Keg: one charge recharges in 8.5s at rank 1 (half of League), up to 3', () => {
  const { g, kit, step } = rig();
  expect(kit.skillView!('E')?.badge).toBe('1');
  kit.castStart!('E', g.pos);
  kit.cast('E', 0, new THREE.Vector3(300, 0, 0));
  expect(kit.canCast!('E')).toBe(false);
  step(8.4);
  expect(kit.skillView!('E')?.badge).toBe('0');
  step(0.2);
  expect(kit.skillView!('E')?.badge).toBe('1');
  step(30);
  expect(kit.skillView!('E')?.badge).toBe('3');
});

it('kegs decay to 1 Health; a swing destroys it and the chain blows connected kegs 0.3s apart, each enemy hit once', () => {
  const { g, kit, enemies, step } = rig();
  step(20); // stock 3 kegs
  const a = enemy(400), b = enemy(700), c = enemy(5000);
  enemies.push(a, b, c);
  for (const x of [200, 600]) { kit.castStart!('E', g.pos); kit.cast('E', 0, new THREE.Vector3(x, 0, 0)); }
  step(4.1); // 3 -> 1 Health (every 2s at level 1)
  const prop = kit.attackProp!(null);
  expect(prop?.pos.x).toBe(200); // the keg in reach whose chain reaches enemies
  prop!.struck(64, false);
  const first = hits(g, 'E');
  expect(first.map(([e]) => e)).toEqual([a]); // a is within 360 of the first keg, b is not
  expect(first[0][2].armorPen).toBe(0.4);
  expect(g.slow).toHaveBeenCalledWith(a, 0.4, 2);
  step(0.25);
  expect(hits(g, 'E')).toHaveLength(1);
  step(0.1);
  expect(hits(g, 'E').map(([e]) => e)).toEqual([a, b]); // the connected keg 400 away, not a again
  expect(kit.attackProp!(null)).toBeNull();
});

it('a keg needs as many swings as its Health; elite and epic monsters take the bonus damage', () => {
  const { g, kit, enemies, step } = rig();
  const big = enemy(250, 'elite');
  enemies.push(big);
  kit.castStart!('E', g.pos);
  kit.cast('E', 0, new THREE.Vector3(200, 0, 0));
  const prop = kit.attackProp!(null)!;
  prop.struck(64, false);
  prop.struck(64, false);
  expect(hits(g, 'E')).toHaveLength(0);
  prop.struck(64, false);
  expect(hits(g, 'E')[0][1]).toBeCloseTo(64 + 75);
  expect(kit.attackStart!(big, false)?.anim).toBe('gangplank_passive_attack'); // an explosion resets Trial by Fire
  step(0.05);
});

it('Remove Scurvy heals 45 + 90% AP + 13% missing Health at rank 1 and is a cleanse', () => {
  const { g, kit } = rig();
  g.ap = 100;
  kit.cast('W', 0, g.pos);
  expect(g.heal).toHaveBeenCalledWith(45 + 90 + 0.13 * (630 - 300));
  expect(GANGPLANK.skills.W.cleanse).toBe(true);
});

it('Cannon Barrage upgrades: a pick at level 11 out of three, another at 16 out of the two left', () => {
  const { g, step } = rig();
  g.level = 10;
  step(0.1);
  expect(g.choices).toHaveLength(0);
  g.level = 11;
  step(0.1);
  expect(g.choices).toHaveLength(1);
  expect(g.choices[0].options).toHaveLength(3);
  g.choices[0].options[1].run(); // Fire at Will
  g.level = 16;
  step(0.1);
  expect(g.choices).toHaveLength(2);
  expect(g.choices[1].options.map((o) => o.icon)).toEqual([expect.stringContaining('3902'), expect.stringContaining('3903')]);
});

it('Cannon Barrage: 12 waves in 4 clusters of 3; Fire at Will makes it 18', () => {
  const run = (fire: boolean) => {
    const { g, kit, enemies, step } = rig();
    enemies.push(enemy(1000));
    if (fire) { g.level = 11; step(0.05); g.choices[0].options[1].run(); }
    kit.cast('R', 0, new THREE.Vector3(1000, 0, 0));
    step(9);
    return hits(g, 'R').length;
  };
  expect(run(false)).toBe(12);
  expect(run(true)).toBe(18);
});

it('Parrrley triggers on-attack effects; Parrrley and keg kills restore mana, once a second from minions', () => {
  const { g, kit, enemies } = rig();
  const e = enemy(300);
  enemies.push(e);
  g.mana = 0;
  kit.cast('Q', 0, e.pos);
  expect(g.attackEffects).toHaveBeenCalledWith(e, 10 + 64, false);
  kit.onKill!(e, { type: 'physical', source: 'ability', skill: 'Q' });
  expect(g.mana).toBeCloseTo(10);
  kit.onKill!(e, { type: 'physical', source: 'ability', skill: 'E' });
  expect(g.mana).toBeCloseTo(10); // lockout
  kit.onKill!(enemy(0, 'epic'), { type: 'physical', source: 'ability', skill: 'E' });
  expect(g.mana).toBeCloseTo(20); // elite and epic always
  kit.onKill!(enemy(0, 'epic'), { type: 'physical', source: 'auto' });
  expect(g.mana).toBeCloseTo(20); // basic attacks do not
});
