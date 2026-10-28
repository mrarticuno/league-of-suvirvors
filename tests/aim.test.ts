import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { Game, type Enemy } from '../src/game';

vi.mock('../src/audio', () => ({ audio: {} })); // the real one opens an AudioContext on import

const enemy = (x: number) => ({ deadFor: -1, pos: new THREE.Vector3(x, 0, 0), def: { radius: 50 } }) as unknown as Enemy;
const RIGHT = new THREE.Vector3(1, 0, 0);

/** aimPoint/aimTarget on a stand-in `this`: nearestEnemy returns the given enemy. */
function rig(nearest: Enemy | null, over: Record<string, unknown> = {}) {
  return {
    pos: new THREE.Vector3(), autoAttack: true, focus: null, manualTarget: null,
    champ: { skills: { Q: { aim: 1200 }, W: { aim: 'none' }, E: { aim: 'move' } } },
    nearestEnemy: vi.fn(() => nearest),
    aimTarget: Game.prototype.aimTarget,
    aimPoint: Game.prototype.aimPoint,
    ...over,
  };
}

it('aims at the marked target in range, else the nearest enemy', () => {
  const near = enemy(300), marked = enemy(1000);
  expect(rig(near, { focus: marked }).aimTarget(1200)).toBe(marked);
  expect(rig(near, { focus: enemy(2000) }).aimTarget(1200)).toBe(near); // marked one out of range
  expect(rig(near, { autoAttack: false, manualTarget: marked }).aimTarget(1200)).toBe(marked);
  expect(rig(near).aimTarget(1200)).toBe(near);
});

it('aimed skills fall back to the movement direction when nobody is in range', () => {
  expect(rig(enemy(300)).aimPoint('Q', RIGHT)!.x).toBe(300);
  expect(rig(null).aimPoint('Q', RIGHT)!.x).toBe(1200);
});

it("'move' casts along the movement direction even with enemies around; 'none' keeps the cursor", () => {
  const g = rig(enemy(-300));
  expect(g.aimPoint('E', RIGHT)!.x).toBeGreaterThan(0);
  expect(g.aimPoint('W', RIGHT)).toBeNull();
});
