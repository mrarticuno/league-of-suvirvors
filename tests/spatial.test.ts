import { expect, it } from 'vitest';
import { SpatialGrid } from '../src/spatial';
import { compact, TimeWindow } from '../src/util';

const unit = (x: number, z: number) => ({ pos: { x, z } });

it('grid query returns every item near the point, including negative coordinates, and skips far ones', () => {
  const g = new SpatialGrid<ReturnType<typeof unit>>(150);
  const near = [unit(10, 10), unit(-140, 90), unit(160, -20)];
  const far = [unit(2000, 0), unit(-900, -900)];
  for (const u of [...near, ...far]) g.insert(u);
  const out = g.query(0, 0, 200, []);
  expect(new Set(out)).toEqual(new Set(near));
  g.clear();
  expect(g.query(0, 0, 200, out)).toEqual([]);
});

it('compact filters in place and keeps order', () => {
  const list = [1, 2, 3, 4, 5, 6];
  const ref = list;
  compact(list, (x) => x % 2 === 0);
  expect(list).toBe(ref);
  expect(list).toEqual([2, 4, 6]);
});

it('time window counts only timestamps younger than its span', () => {
  const w = new TimeWindow(20);
  for (let t = 0; t < 2000; t++) w.push(t * 0.1); // 0 .. 199.9
  expect(w.count(199.9)).toBe(200); // (179.9, 199.9]
  expect(w.count(1000)).toBe(0);
  w.push(1000);
  expect(w.count(1000)).toBe(1);
});
