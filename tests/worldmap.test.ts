import * as THREE from 'three';
import { expect, it } from 'vitest';
import { WorldMap, CHUNK } from '../src/map';
import type { SessionKind } from '../src/sessions';

const tex = () => { const t = new THREE.Texture(); return t; };
const textures = { river: tex(), lane: tex(), jungle: tex(), base: tex() } as Record<SessionKind, THREE.Texture>;
const seed = () => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

it('loads a 3x3 block within a few calls and reports the kind of the centre', () => {
  const scene = new THREE.Scene();
  const map = new WorldMap(scene, textures, {}, seed());
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(0, 0, 0));
  expect(map.kindAt(0, 0)).not.toBeNull();
  expect(map.kindAt(CHUNK * 10, 0)).toBeNull(); // fora do 3×3
});

it('moves the window with the player and drops everything outside', () => {
  const scene = new THREE.Scene();
  const map = new WorldMap(scene, textures, {}, seed());
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(0, 0, 0));
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(CHUNK * 2, 0, 0));
  expect(map.kindAt(CHUNK * 2 + 10, 10)).not.toBeNull();
  expect(map.kindAt(0, 0)).toBeNull();
});

it('dispose removes every mesh and is safe to call twice', () => {
  const scene = new THREE.Scene();
  const map = new WorldMap(scene, textures, {}, seed());
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(0, 0, 0));
  expect(scene.children.length).toBeGreaterThan(0);
  map.dispose(); map.dispose();
  expect(scene.children.length).toBe(0);
  expect(map.kindAt(0, 0)).toBeNull();
});

it('colliding against an unloaded chunk is a no-op', () => {
  const map = new WorldMap(new THREE.Scene(), textures, {}, seed());
  const p = new THREE.Vector3(99999, 0, 99999);
  expect(() => map.collideCircle(p, 30)).not.toThrow();
});
