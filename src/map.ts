// Pure collision for the procedural map: no three.js, no game state.
import type { Obstacle } from './sessions';

/** Empurra `pos` para fora dos obstáculos, deslizando (LoL unit collision). Mutação in-place, sem NaN. */
export function resolveCircle(pos: { x: number; z: number }, radius: number, obstacles: readonly Obstacle[]): void {
  // 2 passes so corners between two boxes settle
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      if (o.kind === 'circle') {
        const d = Math.hypot(dx, dz), min = o.r + radius;
        if (d === 0) pos.x = o.x + min;
        else if (d < min) { pos.x = o.x + (dx / d) * min; pos.z = o.z + (dz / d) * min; }
      } else {
        const cx = Math.max(-o.hw, Math.min(o.hw, dx)), cz = Math.max(-o.hd, Math.min(o.hd, dz));
        if (cx === dx && cz === dz) {
          // center inside the box: push out through the nearest face
          if (o.hw - Math.abs(dx) < o.hd - Math.abs(dz)) pos.x = o.x + Math.sign(dx || 1) * (o.hw + radius);
          else pos.z = o.z + Math.sign(dz || 1) * (o.hd + radius);
        } else {
          const ex = dx - cx, ez = dz - cz, d = Math.hypot(ex, ez); // d > 0 here: center is outside
          if (d < radius) { pos.x = o.x + cx + (ex / d) * radius; pos.z = o.z + cz + (ez / d) * radius; }
        }
      }
    }
  }
}
