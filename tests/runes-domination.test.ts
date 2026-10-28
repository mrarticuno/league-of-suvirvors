import { expect, it } from 'vitest';
import { ABILITY, AUTO, enemy, fx, stubGame } from './runeStub';

it('Eletrocutar: fires once for 3 hits within 3s, then waits 4s', () => {
  const g = stubGame();
  const f = fx('electrocute', g);
  const e = enemy();
  f.onDealt!(e, AUTO, 10);
  f.onDealt!(e, ABILITY, 10);
  expect(g.hurtEnemy).not.toHaveBeenCalled();
  f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
  g.time = 1;
  for (let i = 0; i < 3; i++) f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
  g.time = 4.5;
  for (let i = 0; i < 3; i++) f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(2);
});

it('Eletrocutar: hits more than 3s apart do not add up', () => {
  const g = stubGame();
  const f = fx('electrocute', g);
  const e = enemy();
  f.onDealt!(e, AUTO, 10);
  f.onDealt!(e, AUTO, 10);
  g.time = 3.5;
  f.onDealt!(e, AUTO, 10);
  expect(g.hurtEnemy).not.toHaveBeenCalled();
});

it('Caçador de Tesouros: +1 rune point per elite/epic kill, capped at 5', () => {
  const g = stubGame();
  const f = fx('treasure-hunter', g);
  f.onKill!(enemy('minion'));
  expect(g.bonusRunePoints).toBe(0);
  for (let i = 0; i < 8; i++) f.onKill!(enemy('elite'));
  expect(g.bonusRunePoints).toBe(5);
});

it('Lembranças Aterrorizantes: +2 AD per big kill up to 20', () => {
  const f = fx('grisly-mementos', stubGame());
  for (let i = 0; i < 15; i++) f.onKill!(enemy('epic'));
  expect(f.stat!('ad')).toBe(20);
});

it('Sexto Sentido: horde gives a 10% max HP shield for 3s', () => {
  const g = stubGame();
  fx('sixth-sense', g).onHorde!();
  expect(g.addShield).toHaveBeenCalledWith(100, 3);
});
