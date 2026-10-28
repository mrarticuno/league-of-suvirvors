import { describe, expect, it } from 'vitest';
import { CHUNK, MARGIN, SESSION_KINDS, layoutSession, randomKind } from '../src/sessions';

const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const half = CHUNK / 2 - MARGIN;

describe('layoutSession', () => {
  it.each(SESSION_KINDS)('%s keeps every obstacle inside the chunk margin', (kind) => {
    for (let s = 1; s <= 200; s++) {
      for (const o of layoutSession(kind, rng(s)).obstacles) {
        const extentX = o.kind === 'box' ? o.hw : o.r, extentZ = o.kind === 'box' ? o.hd : o.r;
        expect(Math.abs(o.x) + extentX).toBeLessThanOrEqual(half);
        expect(Math.abs(o.z) + extentZ).toBeLessThanOrEqual(half);
      }
    }
  });

  it('river has a water band overlapping no obstacle', () => {
    for (let s = 1; s <= 200; s++) {
      const l = layoutSession('river', rng(s));
      expect(l.water).not.toBeNull();
      const w = l.water!;
      expect(w.x0).toBeGreaterThan(-half);
      expect(w.x1).toBeLessThan(half);
      for (const o of l.obstacles) {
        const lo = o.x - (o.kind === 'box' ? o.hw : o.r), hi = o.x + (o.kind === 'box' ? o.hw : o.r);
        expect(hi < w.x0 || lo > w.x1).toBe(true);
      }
    }
  });

  it('jungle walls sit on a 3x3 cell grid and never overlap each other', () => {
    for (let s = 1; s <= 200; s++) {
      const walls = layoutSession('jungle', rng(s)).obstacles.filter((o) => o.kind === 'box');
      expect(walls.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i] as any, b = walls[j] as any;
        const overlap = Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.z - b.z) < a.hd + b.hd;
        expect(overlap).toBe(false);
      }
    }
  });

  it('lane has tower pieces paired with circle obstacles', () => {
    const l = layoutSession('lane', rng(7));
    const towers = l.pieces.filter((p) => p.model === 'turret');
    expect(towers.length).toBeGreaterThanOrEqual(2);
    for (const t of towers) expect(l.obstacles.some((o) => o.kind === 'circle' && o.x === t.x && o.z === t.z)).toBe(true);
  });

  it('base has exactly one nexus, at least one inhibitor and two turrets', () => {
    for (let s = 1; s <= 50; s++) {
      const l = layoutSession('base', rng(s));
      expect(l.pieces.filter((p) => p.model === 'nexus').length).toBe(1);
      expect(l.pieces.filter((p) => p.model === 'inhibitor').length).toBeGreaterThanOrEqual(1);
      expect(l.pieces.filter((p) => p.model === 'turret').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('randomKind reaches all four kinds', () => {
    const r = rng(3); const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(randomKind(r));
    expect([...seen].sort()).toEqual(['base', 'jungle', 'lane', 'river']);
  });
});
