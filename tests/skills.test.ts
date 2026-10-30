// Level-up skill numbers (src/champion.ts skillNumbers/skillScore): what the skill card shows and recommends.
import { expect, it, vi } from 'vitest';
import { dpsGain, skillNumbers, skillScore, type SkillDef } from '../src/champion';

vi.mock('../src/audio', () => ({ audio: {} }));

const skill = (over: Partial<SkillDef> = {}): SkillDef => ({
  name: 'x', desc: 'x', maxRank: 5, cooldown: [10, 8, 6, 4, 2], cost: [10, 20, 30, 40, 50], castTime: 0, anim: '', icon: '', aim: 'none',
  damageType: 'physical', damage: [100, 150, 200, 250, 300], ...over,
});
const st = { ad: 200, bonusAd: 100, ap: 300, haste: 0 };

it('damage adds the AD ratios, per hit and per cast', () => {
  const n = skillNumbers(skill({ adRatio: 1, bonusAdRatio: 0.5, hits: 2 }), 0, st);
  expect(n.perHit).toBe(100 + 200 + 50);
  expect(n.damage).toBe(700);
  expect(n.dps).toBe(70);
});

it('damage adds the AP ratio', () => {
  expect(skillNumbers(skill({ apRatio: 0.6 }), 0, st).perHit).toBe(100 + 0.6 * 300);
});

it('per-rank AD ratios and ability haste', () => {
  const n = skillNumbers(skill({ adRatio: [1, 2, 3, 4, 5] }), 2, { ...st, haste: 100 });
  expect(n.perHit).toBe(200 + 3 * 200);
  expect(n.cooldown).toBe(3);
});

it('recommends the ultimate, then a new skill, then the biggest damage per second gain', () => {
  expect(skillScore('R', skill(), 1, st)).toBeGreaterThan(skillScore('Q', skill(), 0, st));
  expect(skillScore('W', skill(), 0, st)).toBeGreaterThan(skillScore('Q', skill(), 3, st));
  expect(dpsGain(skill(), 1, st)).toBeCloseTo(((150 / 8 - 100 / 10) / (100 / 10)) * 100);
  expect(dpsGain(skill({ cooldown: [0, 0, 0, 0, 0] }), 1, st)).toBe(0);
});
