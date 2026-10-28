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

it('revisiting a chunk does not duplicate meshes', () => {
  const scene = new THREE.Scene();
  const map = new WorldMap(scene, textures, {}, seed());
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(0, 0, 0));
  const first = scene.children.length;
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(CHUNK * 2, 0, 0));
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(0, 0, 0));
  expect(first).toBe(9);
  expect(scene.children.length).toBe(first);
});

// rand >= 0.75 makes every kind 'base', whose layout has a nexus circle obstacle at local (0, 0)
it('collides at the rendered position of a chunk outside the origin', () => {
  const map = new WorldMap(new THREE.Scene(), textures, {}, () => 0.8);
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(CHUNK * 1.5, 0, CHUNK * 0.5));
  const cx = CHUNK * 1.5, cz = CHUNK * 0.5; // chunk (1, 0) origin; nexus r 380
  expect(map.kindAt(cx + 10, cz + 10)).toBe('base');
  const p = new THREE.Vector3(cx + 300, 0, cz);
  map.collideCircle(p, 30);
  expect(Math.hypot(p.x - cx, p.z - cz)).toBeGreaterThan(400); // pushed to 380 + 30
});

// rand >= 0.75 makes every kind 'base'; -1.5*CHUNK lands in chunk (-2, -1) — pins Math.floor on the negative side
it('generates chunks at negative coordinates', () => {
  const map = new WorldMap(new THREE.Scene(), textures, {}, () => 0.8);
  for (let i = 0; i < 5; i++) map.ensureChunks(new THREE.Vector3(-1.5 * CHUNK, 0, -0.5 * CHUNK));
  expect(map.kindAt(-1.5 * CHUNK + 10, -0.5 * CHUNK + 10)).toBe('base');
});

it('colliding against an unloaded chunk is a no-op', () => {
  const map = new WorldMap(new THREE.Scene(), textures, {}, seed());
  const p = new THREE.Vector3(99999, 0, 99999);
  expect(() => map.collideCircle(p, 30)).not.toThrow();
});
