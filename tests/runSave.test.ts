import { expect, it, vi } from 'vitest';
import { ENEMIES, EVENTS } from '../src/data';
import { Game, type RunSnapshot } from '../src/game';
import { emptyPage } from '../src/progress';
import { clearRun, loadRun, saveRun } from '../src/runSave';

vi.mock('../src/audio', () => ({ audio: {} })); // the real one opens an AudioContext on import

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const state = { time: 400, level: 9, slots: [{ id: '3084', level: 2 }], fx: { items: { 3084: 12 }, runes: [null] } } as unknown as RunSnapshot;

it('a saved run loads back until cleared', () => {
  const s = store();
  expect(saveRun({ champ: 'ezreal', page: emptyPage(), state }, s)).toBe(true);
  expect(loadRun(s)?.state.fx.items).toEqual({ 3084: 12 });
  clearRun(s);
  expect(loadRun(s)).toBeNull();
});

it('a save for an unknown champion or a malformed one is ignored', () => {
  const s = store();
  saveRun({ champ: 'nobody', page: emptyPage(), state }, s);
  expect(loadRun(s)).toBeNull();
  s.m.set('los.run.v1', '{not json');
  expect(loadRun(s)).toBeNull();
});

it('a boss alive at save time is fought again; a buff monster alive respawns; stacks are kept', () => {
  const baron = EVENTS.findIndex((e) => e.enemy === 'baron');
  const g = {
    time: 1250, nextEvent: baron + 1, dragon: 'dragon_fire', ranks: {}, cooldowns: {}, buffs: {}, slots: [{ id: '3084', level: 1 }],
    buffSpawnAt: { blue: Infinity, red: 1300 }, blueprintDropped: true, blueprint: {},
    enemies: [{ deadFor: -1, def: ENEMIES.baron }],
    fxCache: new Map([['3084', { saved: () => 30 }]]), runeFx: [{}, { saved: () => 4 }],
    eventEnemy: (k: string) => k,
  };
  const s = Game.prototype.snapshot.call(g as unknown as Game);
  expect(s.nextEvent).toBe(baron);
  expect(s.buffSpawnAt).toEqual({ blue: 1250, red: 1250 });
  expect(s.blueprintDropped).toBe(false); // the scroll was still on the ground
  expect(s.fx).toEqual({ items: { 3084: 30 }, runes: [null, 4] });
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
});

it('the item decline is kept; an old save without it loads with none pending', () => {
  const fake = (declinedItems: boolean) => ({
    declinedItems, slots: [], fxCache: new Map(), runeFx: [], maxHp: 100, maxMana: 100, ranks: {}, cooldowns: {}, buffs: {},
    buffSpawnAt: { blue: 0, red: 0 }, enemies: [], eventEnemy: (k: string) => k, setSlots(this: { slots: unknown }, s: unknown) { this.slots = s; },
  });
  const g = fake(true);
  expect(Game.prototype.snapshot.call(g as unknown as Game).declinedItems).toBe(true);
  const old = { ...state, hp: 50, mana: 50 } as RunSnapshot;
  const fresh = fake(false);
  Game.prototype.restore.call(fresh as unknown as Game, old);
  expect(fresh.declinedItems).toBe(false);
  Game.prototype.restore.call(fresh as unknown as Game, { ...old, declinedItems: true });
  expect(fresh.declinedItems).toBe(true);
});
