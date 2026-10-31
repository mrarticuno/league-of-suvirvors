import { expect, it } from 'vitest';
import { AUTO, enemy, fx, stubGame } from './runeStub';

it('Golpe de Misericórdia: +8% below 40% HP only', () => {
  const f = fx('coup-de-grace', stubGame());
  expect(f.damageMult!(enemy('minion', 39), AUTO)).toBeCloseTo(1.08);
  expect(f.damageMult!(enemy('minion', 41), AUTO)).toBe(1);
});

it('Conquistador: heals 0.8% of damage dealt only at 12 stacks', () => {
  const g = stubGame();
  const f = fx('conqueror', g);
  const e = enemy();
  for (let i = 0; i < 11; i++) f.onDealt!(e, AUTO, 100);
  expect(g.heal).not.toHaveBeenCalled();
  f.onDealt!(e, AUTO, 100);
  expect(g.heal.mock.calls[0][0]).toBeCloseTo(0.8);
  expect(f.stat!('ad')).toBeGreaterThan(0);
});

it('Lenda: Espontaneidade caps at +15% attack speed', () => {
  expect(fx('legend-alacrity', stubGame({ kills: 600 })).stat!('as')).toBeCloseTo(0.06);
  expect(fx('legend-alacrity', stubGame({ kills: 3000 })).stat!('as')).toBeCloseTo(0.15);
});

it('Dilacerar: +8% only against elites and epics', () => {
  const f = fx('cut-down', stubGame());
  expect(f.damageMult!(enemy('elite'), AUTO)).toBeCloseTo(1.08);
  expect(f.damageMult!(enemy('monster'), AUTO)).toBe(1);
});

it('Ritmo Fatal: 6 stacks give +36% attack speed and bonus range', () => {
  const g = stubGame();
  const f = fx('lethal-tempo', g);
  for (let i = 0; i < 6; i++) f.onDealt!(enemy(), AUTO, 10);
  expect(f.stat!('as')).toBeCloseTo(0.36);
  expect(f.stat!('range')).toBeCloseTo(165);
  g.time = 7;
  expect(f.stat!('as')).toBe(0);
});
