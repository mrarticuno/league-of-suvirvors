// Aphelios' The Hitman and the Seer (src/champions/aphelios.ts): Moonlight ammo and the weapon queue, Phase, the stat
// points, Calibrum's marks and Severum's heal.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { APHELIOS } from '../src/champions/aphelios';
import type { Enemy, Game, MissileOpts } from '../src/game';

vi.mock('../src/audio', () => ({ audio: { play: vi.fn(), playAt: vi.fn() } }));
vi.mock('../src/assets', () => ({ loadModel: () => Promise.resolve(), Actor: class {} }));

function rig() {
  const missiles: { to: THREE.Vector3; o: MissileOpts }[] = [];
  const g = {
    time: 0, level: 9, ap: 0, ad: 100, bonusAd: 40, attackSpeed: 0.64, critChance: 0, items: { critDamage: 0 },
    hp: 500, maxHp: 1000, shield: 0, pos: new THREE.Vector3(), facing: 0, scene: new THREE.Scene(), alive: true, dashing: false,
    ranks: { Q: 0, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    player: { showSubmesh: vi.fn(), bone: () => undefined, root: new THREE.Group() },
    vfx: { attach: () => new THREE.Group(), play: () => null, missile: () => ({ root: new THREE.Object3D(), update: () => {} }), playAt: vi.fn(), playOn: vi.fn(), hit: vi.fn() },
    hurtEnemy: vi.fn(), heal: vi.fn(function (this: { hp: number }, n: number) { this.hp += n; }), addShield: vi.fn(), slow: vi.fn(), rootEnemy: vi.fn(),
    float: vi.fn(), resetAttack: vi.fn(), enemiesNear: () => [], nearestEnemy: () => null, inAttackRange: () => true,
    spawnMissile: (_fx: string, _from: THREE.Vector3, to: THREE.Vector3, o: MissileOpts) => missiles.push({ to, o }),
  };
  const kit = APHELIOS.kit(g as unknown as Game);
  const land = () => { for (const m of missiles.splice(0)) if (m.o.target) m.o.onHit?.(m.o.target, { pos: m.to } as never); }; // untargeted (split bolts) miss
  return { g, kit, missiles, land };
}
const enemy = (x = 300) => ({ def: { tier: 'minion', radius: 50 }, hp: 100, maxHp: 100, deadFor: -1, pos: new THREE.Vector3(x, 0, 0) }) as unknown as Enemy;
const icon = (kit: ReturnType<typeof rig>['kit']) => kit.skillView!('Q')!.icon!;
const attack = (r: ReturnType<typeof rig>, e: Enemy) => { r.kit.attackStart!(e, false); r.kit.basicAttack!(e, 100, false, false); };

it('50 attacks empty the main weapon: the next one in the queue is assembled, the spent one goes to the end', () => {
  const r = rig();
  const e = enemy();
  expect(icon(r.kit)).toMatch(/q_calibrum/);
  expect(r.kit.skillView!('E')!.icon).toMatch(/gravitum_l/);
  for (let i = 0; i < 49; i++) attack(r, e);
  expect(r.kit.skillView!('Q')!.badge).toBe('1');
  attack(r, e);
  expect(icon(r.kit)).toMatch(/q_gravitum/);
  expect(r.kit.skillView!('Q')!.badge).toBe('50');
  expect(r.kit.tray!().map((x) => x.icon.match(/(\w+)_u/)![1])).toEqual(['infernum', 'crescendum', 'calibrum']);
  expect(r.g.cooldowns.Q).toBeGreaterThanOrEqual(1.5);
  expect(r.kit.canCast!('W')).toBe(false); // no Phase while Alune assembles
  r.kit.update!(1.1);
  expect(r.kit.canCast!('W')).toBe(true);
});

it('Phase swaps the weapons, each keeping its own Q cooldown', () => {
  const r = rig();
  r.g.cooldowns.Q = 5;
  r.kit.cast('W', 0, new THREE.Vector3());
  expect(icon(r.kit)).toMatch(/q_severum/);
  expect(r.g.cooldowns.Q).toBe(0);
  r.kit.update!(2);
  r.kit.cast('W', 0, new THREE.Vector3());
  expect(icon(r.kit)).toMatch(/q_calibrum/);
  expect(r.g.cooldowns.Q).toBe(3);
});

it('skill points buy bonus AD, attack speed and lethality; Calibrum adds 100 range', () => {
  const r = rig();
  Object.assign(r.g.ranks, { Q: 2, W: 1, E: 3 });
  expect(r.kit.stat!('ad')).toBe(8);
  expect(r.kit.stat!('as')).toBeCloseTo(0.09);
  expect(r.kit.stat!('lethality')).toBeCloseTo(13.5);
  expect(r.kit.stat!('range')).toBe(100);
  r.kit.cast('W', 0, new THREE.Vector3());
  expect(r.kit.stat!('range')).toBe(0);
});

it('Moonshot marks; the next attack goes for a mark from afar and pops every mark', () => {
  const r = rig();
  const a = enemy(1500), b = enemy(1200), near = enemy(200);
  r.kit.castAnim!('Q', a.pos);
  r.kit.cast('Q', 0, a.pos);
  r.missiles.splice(0).forEach((m) => { m.o.onHit!(a, { pos: a.pos } as never); m.o.onHit!(b, { pos: b.pos } as never); });
  expect(r.kit.attackTarget!(near)).toBe(b); // nearest mark, out of range
  attack(r, b);
  r.land(); // the off-hand Severum strikes at once; the chain reaches the other mark
  const markHits = r.g.hurtEnemy.mock.calls.filter(([, , h]) => h.bolt && h.onHit);
  expect(markHits.map(([x, dmg]) => [x, dmg])).toEqual(expect.arrayContaining([[a, 15 + 0.15 * 40], [b, 15 + 0.15 * 40]]));
  expect(r.kit.attackTarget!(near)).toBe(near); // no marks left
});

it('Severum heals for part of its damage; healing past full health becomes a shield', () => {
  const r = rig();
  r.kit.cast('W', 0, new THREE.Vector3()); // Severum in hand
  const e = enemy();
  attack(r, e);
  const [, , h] = r.g.hurtEnemy.mock.calls.at(-1)!;
  r.kit.onDealt!(e, h, 1000);
  const pct = 0.02 + (0.051 * 8) / 17; // level 9
  expect(r.g.heal).toHaveBeenCalledWith(expect.closeTo(1000 * pct, 5));
  r.g.hp = r.g.maxHp;
  r.kit.onDealt!(e, h, 1000);
  expect(r.g.addShield).toHaveBeenCalled();
});

it('Crescendum: no attacks until the blade is caught, then the timer resets; only spectral chakrams stack', () => {
  const r = rig();
  const e = enemy(300);
  while (!icon(r.kit).includes('q_crescendum')) { attack(r, e); r.land(); r.kit.update!(0.5); }
  r.kit.update!(5); // earlier chakrams expire
  r.g.resetAttack.mockClear();
  attack(r, e);
  expect(r.kit.disarmed!()).toBe(true);
  r.land();
  for (let i = 0; i < 40 && r.kit.disarmed!(); i++) r.kit.update!(0.05);
  expect(r.kit.disarmed!()).toBe(false);
  expect(r.g.resetAttack).toHaveBeenCalled();
  expect(r.kit.hud!()).toBe(''); // catching Crescendum itself adds no chakram
});

it('Crescendum with chakrams: one throw per blade in hand, waiting only when all are out', () => {
  const r = rig();
  const e = enemy(300);
  while (!icon(r.kit).includes('q_crescendum')) { attack(r, e); r.land(); r.kit.update!(0.5); }
  r.kit.update!(5);
  (r.g as { enemiesNear: unknown }).enemiesNear = () => [e];
  r.kit.castStart!('R', e.pos);
  r.kit.cast('R', 0, e.pos); // Moonlight Vigil with Crescendum: 5 chakrams on the first hit
  r.kit.update!(0.1);
  r.missiles.splice(0);
  expect(r.kit.hud!()).toMatch(/5/);
  r.g.resetAttack.mockClear();
  for (let i = 0; i < 6; i++) { expect(r.kit.disarmed!()).toBe(false); attack(r, e); } // the weapon + 5 chakrams
  expect(r.g.resetAttack).toHaveBeenCalledTimes(5); // no attack timer while a chakram is in orbit
  expect(r.kit.hud!()).toMatch(/\b0\b/); // all thrown: none left in orbit
  expect(r.kit.disarmed!()).toBe(true);
  r.land();
  for (let i = 0; i < 40 && r.kit.disarmed!(); i++) r.kit.update!(0.05);
  expect(r.kit.disarmed!()).toBe(false);
  expect(r.kit.hud!()).toMatch(/5/); // thrown chakrams come back into the orbit, no new stacks
});
