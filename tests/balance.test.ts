import { expect, it } from 'vitest';
import { enemyDamageScale } from '../src/data';
import { describeStats, ITEMS } from '../src/items';

it('enemy damage is flat until 2:00, then grows, and a crowd multiplies it', () => {
  expect(enemyDamageScale(0)).toBe(1);
  expect(enemyDamageScale(120)).toBe(1);
  expect(enemyDamageScale(600)).toBe(3);
  expect(enemyDamageScale(120, 3)).toBe(1);
  expect(enemyDamageScale(120, 8)).toBeCloseTo(1.5);
  expect(enemyDamageScale(120, 100)).toBe(2.5);
});

it('item life steal and omnivamp are 1% of the LoL value (10% -> 0.1%)', () => {
  expect(ITEMS['3153'].stats.lifesteal).toBeCloseTo(0.001);
  expect(ITEMS['2517'].stats.omnivamp).toBeCloseTo(0.0005);
  expect(describeStats({ lifesteal: 0.0007 })).toContain('0.07%');
});
