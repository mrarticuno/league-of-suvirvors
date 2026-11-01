// blendMode 2 ("Subtract*" layers under a glow) darkens what is behind it in proportion: dst × (1 − src), so the ground
// keeps its detail. A plain subtraction (dst − src) crushed the dark map to black over the whole quad (Kayle's R).
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { blendOf, premultiplied } from '../src/particles';

// GL blending of one channel: src is the fragment the shader writes (premultiplied by alpha for blendMode 2)
function blend(mode: number, dst: number, rgb: number, a: number) {
  const p = blendOf(mode);
  const src = premultiplied(mode) ? rgb * a : rgb;
  const f = (k: THREE.BlendingDstFactor | undefined) =>
    k === THREE.ZeroFactor ? 0 : k === THREE.OneFactor ? 1 : k === THREE.SrcAlphaFactor ? a
      : k === THREE.OneMinusSrcColorFactor ? 1 - src : NaN;
  expect(p.blending).toBe(THREE.CustomBlending);
  const s = src * f(p.blendSrc), d = dst * f(p.blendDst);
  return p.blendEquation === THREE.ReverseSubtractEquation ? d - s : s + d;
}

it('blendMode 2 darkens in proportion instead of subtracting to black', () => {
  expect(blend(2, 0.25, 0.5, 1)).toBeCloseTo(0.125); // half the ground's brightness, not max(0, 0.25 − 0.5)
  expect(blend(2, 0.25, 1, 0.5)).toBeCloseTo(0.125); // the colour's alpha scales the darkening
  expect(blend(2, 0.25, 0.02, 1)).toBeCloseTo(0.245); // the glow's faint edge leaves the ground almost as it was
});
