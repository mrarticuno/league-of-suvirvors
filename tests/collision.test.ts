import { expect, it } from 'vitest';
import { resolveCircle } from '../src/map';
const box = { kind: 'box' as const, x: 0, z: 0, hw: 100, hd: 100 };
const dist = (p: { x: number; z: number }) => Math.hypot(
  Math.max(Math.abs(p.x) - 100, 0), Math.max(Math.abs(p.z) - 100, 0));

it('leaves a free point untouched', () => {
  const p = { x: 500, z: 0 };
  resolveCircle(p, 30, [box]);
  expect(p).toEqual({ x: 500, z: 0 });
});

it('pushes a circle overlapping a face straight out', () => {
  const p = { x: 120, z: 0 };
  resolveCircle(p, 30, [box]);
  expect(p.x).toBeCloseTo(130); expect(p.z).toBeCloseTo(0); expect(dist(p)).toBeGreaterThanOrEqual(30 - 1e-6);
});

it('pushes a circle at a corner out along the diagonal without NaN', () => {
  const p = { x: 110, z: 110 };
  resolveCircle(p, 30, [box]);
  expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  expect(dist(p)).toBeGreaterThanOrEqual(30 - 1e-6);
});

it('pushes a center inside the box out through the nearest face', () => {
  const p = { x: 0, z: 40 };
  resolveCircle(p, 30, [box]);
  expect(p.z).toBeCloseTo(130); expect(dist(p)).toBeGreaterThanOrEqual(30 - 1e-6);
});

it('separates overlapping circle obstacles', () => {
  const p = { x: 20, z: 0 };
  resolveCircle(p, 30, [{ kind: 'circle', x: 0, z: 0, r: 100 }]);
  expect(Math.hypot(p.x, p.z)).toBeCloseTo(130);
});

it('is a no-op on an empty layout', () => {
  const p = { x: 1, z: 2 };
  expect(() => resolveCircle(p, 30, [])).not.toThrow();
  expect(p).toEqual({ x: 1, z: 2 });
});
