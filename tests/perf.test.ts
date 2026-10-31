// Frame governor (src/perf.ts): the alive-enemy cap follows dropped frames.
import { expect, it } from 'vitest';
import { FrameGovernor, GOVERNOR } from '../src/perf';

/** Feeds `seconds` of frames at `period` ms, every `every`-th one stretched to `slow` ms. */
function run(gov: FrameGovernor, seconds: number, period: number, slow = period, every = Infinity, loaded = true) {
  const changes: number[] = [];
  let i = 0;
  for (let t = 0; t < seconds * 1000; ) {
    const ms = ++i % every === 0 ? slow : period;
    t += ms;
    const c = gov.sample(ms, loaded);
    if (c !== null) changes.push(c);
  }
  return changes;
}

it('steady 60Hz keeps the cap', () => {
  const gov = new FrameGovernor(260);
  expect(run(gov, 30, 16.7)).toEqual([]);
  expect(gov.cap).toBe(260);
});

it('a fifth of the frames dropped shrinks the cap each window, down to the floor', () => {
  const gov = new FrameGovernor(260);
  const changes = run(gov, 7, 16.7, 40, 5);
  expect(changes).toEqual([221, 188, 160]);
  run(gov, 120, 16.7, 40, 5);
  expect(gov.cap).toBe(GOVERNOR.minCap);
});

it('drops with few enemies alive do not touch the cap', () => {
  const gov = new FrameGovernor(260);
  expect(run(gov, 6, 16.7, 40, 5, false)).toEqual([]);
});

it('the cap creeps back once frames stay steady', () => {
  const gov = new FrameGovernor(260);
  run(gov, 2.5, 16.7, 40, 5);
  expect(gov.cap).toBe(221);
  const changes = run(gov, 25, 16.7);
  expect(changes).toEqual([231, 241]);
});

it('a stall (tab switch) is not a frame, and a short window is ignored', () => {
  const gov = new FrameGovernor(260);
  gov.sample(3000, true);
  expect(gov.sample(16.7, true)).toBeNull();
  // 10 frames of 300ms-ish gaps are stalls; the window then has too few frames to judge
  for (let i = 0; i < 10; i++) expect(gov.sample(200, true)).toBeNull();
  expect(gov.cap).toBe(260);
});
