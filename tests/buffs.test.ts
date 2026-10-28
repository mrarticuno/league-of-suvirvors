import { expect, it } from 'vitest';
import { buffEffects } from '../src/buffs';
import { AUTO, enemy, stubGame } from './runeStub';

it('jungle buffs only work while their timer runs', () => {
  const g = stubGame({ buffs: { blue: 0, red: 0 }, level: 5 });
  const [blue, red] = buffEffects(g);
  const e = enemy();
  expect(blue.stat!('ah')).toBe(0);
  expect(red.onHit!(e, AUTO)).toBe(0);
  expect(g.slow).not.toHaveBeenCalled();

  g.buffs = { blue: 180, red: 180 };
  expect(blue.stat!('ah')).toBe(20);
  blue.tick!(1);
  expect(g.mana).toBe(104); // +1% of 400 max mana
  expect(red.onHit!(e, AUTO)).toBe(18);
  expect(g.slow).toHaveBeenCalledWith(e, 0.1, 1.5);

  g.time = 180;
  expect(blue.stat!('ah')).toBe(0);
});
