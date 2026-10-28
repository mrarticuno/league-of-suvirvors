// Procedural map: chunk streaming (3x3 window around the player), circle-vs-obstacle collision and the map asset loaders.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { propModel, loadModel } from './assets';
import { CHUNK, layoutSession, PIECES, PIECE_MODELS, randomKind, SESSION_KINDS } from './sessions';
import type { Obstacle, PieceModel, SessionKind, SessionLayout } from './sessions';

export { CHUNK } from './sessions';

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

const MAX_GEN = 2; // new chunks per ensureChunks call: amortizes generation spikes
const MARGIN_CELLS = 1; // keeps a 3x3 window around the player's chunk
const OBSTACLE_HEIGHT = 80; // obstacles are 2D colliders, so the fallback mesh height is arbitrary
const GROUND_TILE = 750; // world units per ground texture repeat
const WATER_TILE = 500;
const BLEND = 600; // half-width of the cross-fade band at a chunk border
const BANK = 150; // half-width of the soft river bank

// Ground of one chunk: world-space UVs (continuous across chunks), cross-faded with the neighbour kinds near the
// borders, plus the river band. Kinds are SESSION_KINDS indices; kinds[(dz + 1) * 3 + dx + 1] is the cell at (dx, dz).
const GROUND_VERT = /* glsl */ `
uniform vec2 origin;
varying vec2 vWorld;
varying vec2 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  vLocal = w.xz - origin;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GROUND_FRAG = /* glsl */ `
uniform sampler2D tRiver, tLane, tJungle, tBase, tWater;
uniform float kinds[9];
uniform vec2 water; // local x0, x1; x0 == x1 means no river
uniform float waterShift;
varying vec2 vWorld;
varying vec2 vLocal;
const float HALF = ${CHUNK / 2}.0;
vec4 oneHot(float k) { return vec4(equal(vec4(k), vec4(0.0, 1.0, 2.0, 3.0))); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
// anti-tiling: a second, rotated and rescaled read of the same texture, mixed in by low-frequency noise,
// breaks the mirror axes of MirroredRepeatWrapping
float gN;
vec3 tex(sampler2D t, vec2 uv) {
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.83 + 0.37;
  return mix(texture2D(t, uv).rgb, texture2D(t, uv2).rgb, gN);
}
void main() {
  // 0 inside, 0.5 at the border: the neighbour computes the mirror image, so both sides meet at 50/50
  float fx = 0.5 * clamp(1.0 - (HALF - abs(vLocal.x)) / ${BLEND}.0, 0.0, 1.0);
  float fz = 0.5 * clamp(1.0 - (HALF - abs(vLocal.y)) / ${BLEND}.0, 0.0, 1.0);
  int ix = vLocal.x < 0.0 ? 0 : 2, iz = vLocal.y < 0.0 ? 0 : 6;
  vec4 w = oneHot(kinds[4]) * (1.0 - fx) * (1.0 - fz) + oneHot(kinds[3 + ix]) * fx * (1.0 - fz)
         + oneHot(kinds[iz + 1]) * (1.0 - fx) * fz + oneHot(kinds[iz + ix]) * fx * fz;
  vec2 uv = vWorld / ${GROUND_TILE}.0;
  gN = smoothstep(0.3, 0.7, vnoise(vWorld / 1300.0));
  vec3 c = tex(tRiver, uv) * w.x + tex(tLane, uv) * w.y + tex(tJungle, uv) * w.z + tex(tBase, uv) * w.w;
  if (water.y > water.x) {
    float across = smoothstep(water.x - ${BANK}.0, water.x + ${BANK}.0, vLocal.x)
                 * (1.0 - smoothstep(water.y - ${BANK}.0, water.y + ${BANK}.0, vLocal.x));
    float along = 1.0 - smoothstep(HALF - 2.0 * ${BLEND}.0, HALF - ${BLEND}.0 * 0.5, abs(vLocal.y)); // pool tapers before the border
    vec3 wc = tex(tWater, vWorld / ${WATER_TILE}.0 + vec2(waterShift, 0.0));
    c = mix(c, wc, across * along);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

interface Chunk {
  kind: SessionKind;
  cx: number;
  cz: number;
  layout: SessionLayout;
  group: THREE.Group;
  geos: THREE.BufferGeometry[]; // owned by this chunk; textures and piece clones are shared
  mat: THREE.ShaderMaterial; // owned: per-chunk uniforms
}

// window offsets, nearest first, so the chunks under the player exist on the very first call
const OFFSETS: ReadonlyArray<readonly [number, number]> = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => [dx, dz] as const))
  .sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
const WINDOW = OFFSETS.length;
// numeric chunk keys (16 bits per axis): collideCircle runs per unit per frame and must not build strings
const cellKey = (cx: number, cz: number) => ((cx & 0xffff) << 16) | (cz & 0xffff);
const scratch = { x: 0, z: 0 };

export class WorldMap {
  private readonly chunks = new Map<number, Chunk>();
  // kinds outlive their chunk: a chunk's border blend needs its neighbours' kinds before they are built
  private readonly kinds = new Map<number, SessionKind>();
  private pcx = NaN; // chunk of the last ensureChunks call
  private pcz = NaN;
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly obstacleMat = new THREE.MeshBasicMaterial({ color: 0x2b2b2b });
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);

  constructor(
    private readonly scene: THREE.Scene,
    textures: Record<SessionKind, THREE.Texture>,
    private readonly pieces: Partial<Record<PieceModel, THREE.Object3D>>,
    private readonly rand: () => number = Math.random,
    water?: THREE.Texture,
  ) {
    const fallback = new THREE.DataTexture(new Uint8Array([47, 111, 181, 255]), 1, 1); // flat river blue
    fallback.needsUpdate = true;
    this.shared = {
      tRiver: { value: textures.river },
      tLane: { value: textures.lane },
      tJungle: { value: textures.jungle },
      tBase: { value: textures.base },
      tWater: { value: water ?? fallback },
      waterShift: { value: 0 },
    };
  }

  /** Generates at most 2 new chunks per call and drops everything outside the 3x3 window. */
  ensureChunks(pos: THREE.Vector3): void {
    const pcx = Math.floor(pos.x / CHUNK), pcz = Math.floor(pos.z / CHUNK);
    // steady state (same chunk, window complete): nothing to do
    if (pcx === this.pcx && pcz === this.pcz && this.chunks.size === WINDOW) return;
    this.pcx = pcx;
    this.pcz = pcz;
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > MARGIN_CELLS || Math.abs(c.cz - pcz) > MARGIN_CELLS) this.removeChunk(key);
    }
    let made = 0;
    for (const [dx, dz] of OFFSETS) {
      if (made >= MAX_GEN) break;
      const cx = pcx + dx, cz = pcz + dz, key = cellKey(cx, cz);
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, this.build(cx, cz));
      made++;
    }
  }

  /** Resolves only against the chunk containing `pos`; no-op when it is not loaded. */
  collideCircle(pos: THREE.Vector3, radius: number): void {
    const cx = Math.floor(pos.x / CHUNK), cz = Math.floor(pos.z / CHUNK);
    const c = this.chunks.get(cellKey(cx, cz));
    if (!c) return;
    // layouts are chunk-local (origin = chunk centre), so resolve there and shift back
    const ox = (cx + 0.5) * CHUNK, oz = (cz + 0.5) * CHUNK;
    const local = scratch;
    local.x = pos.x - ox;
    local.z = pos.z - oz;
    resolveCircle(local, radius, c.layout.obstacles);
    pos.x = local.x + ox;
    pos.z = local.z + oz;
  }

  update(dt: number): void {
    this.shared.waterShift.value += dt * 0.01;
  }

  kindAt(x: number, z: number): SessionKind | null {
    return this.chunks.get(cellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)))?.kind ?? null;
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
  }

  private build(cx: number, cz: number): Chunk {
    const kind = this.kindOf(cx, cz);
    const layout = layoutSession(kind, this.rand);
    const group = new THREE.Group();
    // chunk c covers world [c*CHUNK, (c+1)*CHUNK); layouts are centred on their chunk origin
    group.position.set((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
    const geos: THREE.BufferGeometry[] = [];

    const kinds: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) kinds.push(SESSION_KINDS.indexOf(this.kindOf(cx + dx, cz + dz)));
    const mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        ...this.shared, // same uniform objects: textures and the water scroll stay shared
        kinds: { value: kinds },
        origin: { value: new THREE.Vector2(group.position.x, group.position.z) },
        water: { value: new THREE.Vector2(layout.water?.x0 ?? 0, layout.water?.x1 ?? 0) },
      },
    });
    const groundGeo = new THREE.PlaneGeometry(CHUNK, CHUNK);
    const ground = new THREE.Mesh(groundGeo, mat);
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);
    geos.push(groundGeo);

    for (const p of layout.pieces) {
      const model = this.pieces[p.model];
      if (!model) continue; // obstacle fallback below covers the missing piece
      // SkeletonUtils.clone: plain Object3D.clone shares the source's skeleton, whose bones never get a matrixWorld update
      const mesh = clone(model);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.yaw;
      if (p.model.startsWith('rock_')) {
        // the rock is the visual for the box obstacle it stands on: stretch it over the box on the box's axes
        const box = layout.obstacles.find((o) => o.kind === 'box' && o.x === p.x && o.z === p.z);
        if (box?.kind === 'box') {
          const size = model.userData.size as THREE.Vector3 | undefined; // normalised footprint of the rock mesh
          if (size) {
            mesh.rotation.y = 0; // drop the layout yaw: the mesh axes must match the box axes or corners stay open
            mesh.scale.set((2 * box.hw) / size.x, 2 * Math.max(box.hw, box.hd), (2 * box.hd) / size.z);
          } else mesh.scale.setScalar(2 * Math.max(box.hw, box.hd));
        }
      }
      group.add(mesh);
    }

    // obstacles whose piece model was injected are already drawn; the rest get a simple shape.
    // invariant (sessions.ts layouts): a piece copies its obstacle's exact x/z, so equality pairs them
    const drawn = new Set(layout.pieces.filter((p) => this.pieces[p.model]).map((p) => `${p.x},${p.z}`));
    for (const o of layout.obstacles) {
      if (drawn.has(`${o.x},${o.z}`)) continue;
      const m = new THREE.Mesh(o.kind === 'box' ? this.boxGeo : this.cylGeo, this.obstacleMat);
      if (o.kind === 'box') m.scale.set(o.hw * 2, OBSTACLE_HEIGHT, o.hd * 2);
      else m.scale.set(o.r, OBSTACLE_HEIGHT, o.r);
      m.position.set(o.x, OBSTACLE_HEIGHT / 2, o.z);
      group.add(m);
    }

    this.scene.add(group);
    return { kind, cx, cz, layout, group, geos, mat };
  }

  private removeChunk(key: number): void {
    const c = this.chunks.get(key);
    if (!c) return;
    c.group.removeFromParent();
    for (const g of c.geos) g.dispose();
    c.mat.dispose();
    this.chunks.delete(key);
  }

  private kindOf(cx: number, cz: number): SessionKind {
    const key = cellKey(cx, cz);
    let kind = this.kinds.get(key);
    if (!kind) this.kinds.set(key, (kind = randomKind(this.rand)));
    return kind;
  }
}


const loader = new THREE.TextureLoader();
const loadTex = (name: string) =>
  new Promise<THREE.Texture>((ok, err) => loader.load(`assets/map/tex/${name}.png`, ok, undefined, err));

// The structure meshes stack their damaged variants and tower stages on the intact one, so only the base shows
const INTACT = ['Stage1', 'Stage2', 'Stage3', 'Rubble', 'Broken1', 'Broken2', 'Broken3', 'Destroyed'];

/** Rocks ship ~1 unit long; the long side becomes 1 so a placement can stretch it over its obstacle box. */
function unitRock(rock: THREE.Object3D): THREE.Object3D {
  const size = new THREE.Box3().setFromObject(rock).getSize(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.z);
  rock.scale.setScalar(k);
  const group = new THREE.Group(); // the wrapper keeps the normalisation when the placement scales it
  group.add(rock);
  group.userData.size = size.multiplyScalar(k); // per-axis footprint after normalising (rock_a is long in X, b/c in Z)
  return group;
}

const rockLoader = new GLTFLoader();

/** Rocks are the extracted map meshes: same unlit material and UV conventions as loadModel. */
async function loadRock(key: string): Promise<THREE.Object3D> {
  const [gltf, map] = await Promise.all([
    rockLoader.loadAsync(`assets/map/pieces/${key}.glb`),
    loader.loadAsync(`assets/map/pieces/${key}.png`),
  ]);
  map.flipY = false; // glTF UV convention
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.3 });
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = material;
  });
  return gltf.scene;
}

/**
 * Loads the scenery pieces by catalog key. A model that is missing or fails to load resolves to `undefined`,
 * so a chunk keeps drawing the obstacle placeholder instead of breaking (same as an unset piece).
 */
export async function loadMapPieces(): Promise<Partial<Record<PieceModel, THREE.Object3D>>> {
  const pieces: Partial<Record<PieceModel, THREE.Object3D>> = {};
  await Promise.all(PIECES.map(async (key) => {
    const id = PIECE_MODELS[key];
    try {
      if (key.startsWith('rock_')) {
        pieces[key] = unitRock(await loadRock(id));
      } else {
        await loadModel(id, INTACT);
        pieces[key] = propModel(id); // League units: already Ezreal-scaled with its feet at y = 0
      }
    } catch (err) {
      console.warn(`[map] piece ${key} (${id}) failed to load, using the obstacle fallback`, err);
      pieces[key] = undefined;
    }
  }));
  return pieces;
}

/** Loads the five chunk textures (SessionKind ground + river water). */
export async function loadMapTextures(): Promise<{ textures: Record<SessionKind, THREE.Texture>; water: THREE.Texture }> {
  const [river, lane, jungle, base, water] = await Promise.all(
    ['ground_river', 'ground_lane', 'ground_jungle', 'ground_base', 'water'].map(loadTex),
  );
  for (const t of [river, lane, jungle, base, water]) {
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; // the crops are not tileable: mirroring hides the repeat seams
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { textures: { river, lane, jungle, base }, water };
}
