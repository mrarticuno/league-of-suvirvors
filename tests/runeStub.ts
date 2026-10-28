// Minimal Game stand-in for rune effect tests: only what the effects read, plus spies for what they call.
import { vi } from 'vitest';
import type { Hit } from '../src/champion';
import type { Enemy, Game } from '../src/game';
import { RUNES } from '../src/runes';

export const AUTO: Hit = { type: 'physical', source: 'auto', onHit: true };
export const ABILITY: Hit = { type: 'magic', source: 'ability', skill: 'Q' };

export function stubGame(over: Record<string, unknown> = {}) {
  const g = {
    time: 0, kills: 0, level: 1, hp: 500, maxHp: 1000, baseHp: 600, mana: 100, maxMana: 400, bonusAd: 50, ad: 110,
    items: { msPct: 0 }, pos: { x: 0, z: 0 }, bonusRunePoints: 0, choices: [], cooldowns: { Q: 4, W: 4, E: 4, R: 40 },
    champ: { base: { attackRange: 550, armor: 24 } }, focus: null,
    hurtEnemy: vi.fn(), heal: vi.fn(), addShield: vi.fn(), slow: vi.fn(), isSlowed: vi.fn(() => false),
    enemiesNear: vi.fn(() => []), inWater: vi.fn(() => false), drinkPotion: vi.fn(),
    ...over,
  };
  return g as typeof g & Game;
}

export const enemy = (tier: Enemy['def']['tier'] = 'minion', hp = 100, maxHp = 100) =>
  ({ def: { tier, radius: 50 }, hp, maxHp, pos: { x: 0, z: 0, distanceTo: () => 0 } }) as unknown as Enemy;

export const fx = (id: string, g: Game) => RUNES[id].effect!(g);
