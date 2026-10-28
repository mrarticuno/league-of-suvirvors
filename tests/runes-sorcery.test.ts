import { expect, it } from 'vitest';
import { ABILITY, AUTO, enemy, fx, stubGame } from './runeStub';

it('Avanço da Tempestade: 3 hits within 4s give +30% move speed for 3s, then 12s cooldown', () => {
  const g = stubGame();
  const f = fx('phase-rush', g);
  f.onDealt!(enemy(), AUTO, 10);
  g.time = 4.5;
  f.onDealt!(enemy(), AUTO, 10);
  f.onDealt!(enemy(), AUTO, 10);
  expect(f.stat!('msPct')).toBe(0);
  f.onDealt!(enemy(), AUTO, 10);
  expect(f.stat!('msPct')).toBeCloseTo(0.3);
  g.time = 8;
  expect(f.stat!('msPct')).toBe(0);
  for (let i = 0; i < 3; i++) f.onDealt!(enemy(), AUTO, 10);
  expect(f.stat!('msPct')).toBe(0);
});

it('Faixa de Fluxo de Mana: +25 max mana per ability hit, capped at 250, autos do nothing', () => {
  const f = fx('manaflow-band', stubGame());
  f.onDealt!(enemy(), AUTO, 10);
  expect(f.stat!('mana')).toBe(0);
  for (let i = 0; i < 20; i++) f.onDealt!(enemy(), ABILITY, 10);
  expect(f.stat!('mana')).toBe(250);
});

it('Cometa Arcano: an ability hit drops a comet, then 8s cooldown', () => {
  const g = stubGame();
  const target = enemy();
  g.enemiesNear.mockReturnValue([target]);
  const f = fx('arcane-comet', g);
  f.onDealt!(target, AUTO, 10);
  expect(g.hurtEnemy).not.toHaveBeenCalled();
  f.onDealt!(target, ABILITY, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
  f.onDealt!(target, ABILITY, 10);
  expect(g.hurtEnemy).toHaveBeenCalledTimes(1);
});

it('Arcanista do Axioma: +6% on R only', () => {
  const f = fx('axiom-arcanist', stubGame());
  expect(f.damageMult!(enemy(), { type: 'magic', source: 'ability', skill: 'R' })).toBeCloseTo(1.06);
  expect(f.damageMult!(enemy(), ABILITY)).toBe(1);
});
