import { expect, it } from 'vitest';
import { AUTO, enemy, fx, stubGame } from './runeStub';

it('Guardião: shields when a hit would drop below 30% HP, then waits 70s', () => {
  const g = stubGame({ hp: 400, maxHp: 1000, baseHp: 600 });
  const f = fx('guardian', g);
  expect(f.onHurt!(50)).toBe(50);
  expect(g.addShield).not.toHaveBeenCalled();
  expect(f.onHurt!(150)).toBe(150);
  expect(g.addShield).toHaveBeenCalledWith(90, 2);
  g.time = 60;
  f.onHurt!(150);
  expect(g.addShield).toHaveBeenCalledTimes(1);
  g.time = 71;
  f.onHurt!(150);
  expect(g.addShield).toHaveBeenCalledTimes(2);
});

it('Inabalável: +20% tenacity', () => {
  expect(fx('unflinching', stubGame()).stat!('tenacity')).toBeCloseTo(0.2);
});

it('Osso Revestido: after a hit, the next 3 hits within 1.5s are reduced, then 55s cooldown', () => {
  const g = stubGame();
  const f = fx('bone-plating', g);
  expect(f.onHurt!(100)).toBe(100);
  expect(f.onHurt!(100)).toBe(70);
  f.onHurt!(100);
  f.onHurt!(100);
  expect(f.onHurt!(100)).toBe(100);
});

it('Aperto dos Mortos-Vivos: every 4s an auto deals 3.5% max HP, heals and adds permanent HP', () => {
  const g = stubGame();
  const f = fx('grasp-of-the-undying', g);
  const e = enemy();
  f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
  expect(f.stat!('hp')).toBe(5);
  f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
  g.time = 4;
  f.onDealt!(e, AUTO, 10);
  expect(f.stat!('hp')).toBe(10);
});

it('Revitalizar: +5% healing, +10% below 40% HP', () => {
  expect(fx('revitalize', stubGame({ hp: 500 })).stat!('healMult')).toBeCloseTo(0.05);
  expect(fx('revitalize', stubGame({ hp: 300 })).stat!('healMult')).toBeCloseTo(0.1);
});
