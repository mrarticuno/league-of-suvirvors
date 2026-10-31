// Instanced enemies (src/horde.ts): the per-instance pose rows an InstancedActor hands the shader.
import { expect, it, vi } from 'vitest';
import { BAKE_FPS, type Horde, InstancedActor } from '../src/horde';

vi.mock('../src/assets', () => ({ template: () => { throw new Error('not loaded'); } }));

/** A horde stub: two baked clips, run (1s, rows 0..30) and death (0.5s, rows 31..46). */
function actor() {
  const clips = new Map([
    ['run', { row: 0, frames: 31, duration: 1 }],
    ['death', { row: 31, frames: 16, duration: 0.5 }],
  ]);
  const horde = { bake: { clips }, free: vi.fn() } as unknown as Horde;
  return { a: new InstancedActor(horde, 0, 1), horde };
}
const pose = (a: InstancedActor) => { const out = new Float32Array(4); a.writePose(out, 0); return [...out].slice(0, 3); };

it('a looping clip blends neighbouring rows and wraps to its first row', () => {
  const { a } = actor();
  a.play('run');
  expect(pose(a)).toEqual([0, 1, 0]);
  a.update(0.5 / BAKE_FPS);
  expect(pose(a)).toEqual([0, 1, 0.5]);
  a.update(1 - 0.5 / BAKE_FPS); // back to the start of the loop
  expect(pose(a)[0]).toBe(0);
  a.update(30 / BAKE_FPS - 0.001);
  expect(pose(a).slice(0, 2)).toEqual([29, 30]); // the last row is the clip's end pose, which a loop rejoins at row 0
});

it('a one-shot clip holds its last row; `duration` stretches it', () => {
  const { a } = actor();
  a.play('death', { loop: false, duration: 1 });
  a.update(2);
  expect(pose(a)).toEqual([46, 46, 0]);
  expect(a.currentName).toBe('death');
  expect(a.duration('death')).toBe(0.5);
});

it('switching clips fades from the previous pose, then settles on the new clip', () => {
  const { a } = actor();
  a.play('run');
  a.update(0.5);
  a.play('death', { loop: false, fade: 0.1 });
  expect(pose(a)).toEqual([31, 15, 1]);
  a.update(0.05);
  const mid = pose(a);
  expect(mid[1]).toBeGreaterThanOrEqual(15);
  expect(mid[2]).toBeCloseTo(0.5);
  a.update(0.1);
  expect(pose(a)[2]).toBeLessThan(1);
  expect(pose(a)[0]).toBeGreaterThan(31);
});

it('replaying the same clip is a no-op unless restarted; dispose frees the slot', () => {
  const { a, horde } = actor();
  a.play('run');
  a.update(0.5);
  a.play('run');
  expect(pose(a)[0]).toBe(15);
  a.play('run', { restart: true });
  expect(pose(a)[0]).toBe(0);
  a.play('missing');
  expect(a.currentName).toBe('run');
  a.dispose();
  expect(horde.free).toHaveBeenCalledWith(a);
});
