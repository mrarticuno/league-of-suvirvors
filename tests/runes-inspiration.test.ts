import { expect, it } from 'vitest';
import { AUTO, enemy, fx, stubGame } from './runeStub';

it('Perspicácia Cósmica: +18 ability haste', () => {
  expect(fx('cosmic-insight', stubGame()).stat!('ah')).toBe(18);
});

it('Reembolso: +10% XP', () => {
  expect(fx('cash-back', stubGame()).xpMult!()).toBeCloseTo(1.1);
});

it('Tônico Triplo: a potion choice at levels 3, 6 and 9 only', () => {
  const g = stubGame();
  const f = fx('triple-tonic', g);
  for (let lvl = 2; lvl <= 12; lvl++) { g.level = lvl; f.onLevel!(); }
  expect(g.choices.length).toBe(3);
  (g.choices[0] as { options: { run: () => void }[] }).options[0].run();
  expect(g.drinkPotion).toHaveBeenCalledWith('hp');
});

it('Aprimoramento Glacial: slows each enemy on its first auto only', () => {
  const g = stubGame();
  const f = fx('glacial-augment', g);
  const e = enemy();
  f.onDealt!(e, AUTO, 10);
  f.onDealt!(e, AUTO, 10);
  expect(g.slow).toHaveBeenCalledTimes(1);
  expect(g.slow).toHaveBeenCalledWith(e, 0.3, 2);
});

it('Livro de Feitiços: offers a stat pick every 2 min and keeps the latest pick', () => {
  const g = stubGame();
  const f = fx('unsealed-spellbook', g);
  f.tick!(0.1);
  expect(g.choices.length).toBe(1);
  const pick = (i: number) => (g.choices.at(-1) as { options: { run: () => void }[] }).options[i].run();
  pick(0);
  expect(f.stat!('ad')).toBeGreaterThan(0);
  f.tick!(0.1);
  expect(g.choices.length).toBe(1);
  g.time = 120;
  f.tick!(0.1);
  expect(g.choices.length).toBe(2);
  pick(2);
  expect(f.stat!('ad')).toBe(0);
  expect(f.stat!('ah')).toBeGreaterThan(0);
});

it('Quebra-galho: haste per distinct item stat, AD at 5 and 10 stats', () => {
  const items = { ad: 10, as: 0.1, hp: 100, mana: 0, crit: 0.2, armor: 20, msPct: 0 };
  const f = fx('jack-of-all-trades', stubGame({ items }));
  expect(f.stat!('ah')).toBe(5);
  expect(f.stat!('ad')).toBe(10);
});
