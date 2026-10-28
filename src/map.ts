// Pure collision for the procedural map: no three.js, no game state.
import * as THREE from 'three';
import { CHUNK, layoutSession, randomKind } from './sessions';
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
const repeatTexture = (t: THREE.Texture, r: number) => {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(r, r);
  return c;
};

interface Chunk {
  kind: SessionKind;
  cx: number;
  cz: number;
  layout: SessionLayout;
  group: THREE.Group;
  geos: THREE.BufferGeometry[]; // owned by this chunk; texture clones and piece clones are shared
}

export class WorldMap {
  private readonly chunks = new Map<string, Chunk>();
  private readonly groundMats: Record<SessionKind, THREE.MeshBasicMaterial>;
  private readonly waterMat: THREE.MeshBasicMaterial;
  private readonly waterTex: THREE.Texture | null;
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
    this.groundMats = {
      river: new THREE.MeshBasicMaterial({ map: repeatTexture(textures.river, 8) }),
      lane: new THREE.MeshBasicMaterial({ map: repeatTexture(textures.lane, 8) }),
      jungle: new THREE.MeshBasicMaterial({ map: repeatTexture(textures.jungle, 8) }),
      base: new THREE.MeshBasicMaterial({ map: repeatTexture(textures.base, 8) }),
    };
    this.waterTex = water ? repeatTexture(water, 4) : null;
    this.waterMat = new THREE.MeshBasicMaterial(this.waterTex ? { map: this.waterTex } : { color: 0x2f6fb5 });
  }

  /** Generates at most 2 new chunks per call and drops everything outside the 3x3 window. */
  ensureChunks(pos: THREE.Vector3): void {
    const pcx = Math.floor(pos.x / CHUNK), pcz = Math.floor(pos.z / CHUNK);
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > MARGIN_CELLS || Math.abs(c.cz - pcz) > MARGIN_CELLS) this.removeChunk(key);
    }
    // nearest first, so the chunks under the player exist on the very first call
    const offsets: Array<[number, number]> = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) offsets.push([dx, dz]);
    offsets.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
    let made = 0;
    for (const [dx, dz] of offsets) {
      if (made >= MAX_GEN) break;
      const cx = pcx + dx, cz = pcz + dz, key = `${cx},${cz}`;
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, this.build(cx, cz));
      made++;
    }
  }

  /** Resolves only against the chunk containing `pos`; no-op when it is not loaded. */
  collideCircle(pos: THREE.Vector3, radius: number): void {
    const cx = Math.floor(pos.x / CHUNK), cz = Math.floor(pos.z / CHUNK);
    const c = this.chunks.get(`${cx},${cz}`);
    if (!c) return;
    // layouts are chunk-local (origin = chunk centre), so resolve there and shift back
    const ox = (cx + 0.5) * CHUNK, oz = (cz + 0.5) * CHUNK;
    const local = { x: pos.x - ox, z: pos.z - oz };
    resolveCircle(local, radius, c.layout.obstacles);
    pos.x = local.x + ox;
    pos.z = local.z + oz;
  }

  update(dt: number): void {
    if (this.waterTex) this.waterTex.offset.x += dt * 0.01;
  }

  kindAt(x: number, z: number): SessionKind | null {
    return this.chunks.get(chunkKey(x, z))?.kind ?? null;
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
  }

  private build(cx: number, cz: number): Chunk {
    const kind = randomKind(this.rand);
    const layout = layoutSession(kind, this.rand);
    const group = new THREE.Group();
    // chunk c covers world [c*CHUNK, (c+1)*CHUNK); layouts are centred on their chunk origin
    group.position.set((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
    const geos: THREE.BufferGeometry[] = [];

    const groundGeo = new THREE.PlaneGeometry(CHUNK, CHUNK);
    const ground = new THREE.Mesh(groundGeo, this.groundMats[kind]);
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);
    geos.push(groundGeo);

    if (layout.water) {
      const { x0, x1 } = layout.water;
      const geo = new THREE.PlaneGeometry(x1 - x0, CHUNK);
      const waterMesh = new THREE.Mesh(geo, this.waterMat);
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.set((x0 + x1) / 2, 1, 0);
      group.add(waterMesh);
      geos.push(geo);
    }

    for (const p of layout.pieces) {
      const model = this.pieces[p.model];
      if (!model) continue; // obstacle fallback below covers the missing piece
      const mesh = model.clone();
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.yaw;
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
    return { kind, cx, cz, layout, group, geos };
  }

  private removeChunk(key: string): void {
    const c = this.chunks.get(key);
    if (!c) return;
    c.group.removeFromParent();
    for (const g of c.geos) g.dispose();
    this.chunks.delete(key);
  }
}

const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

const loader = new THREE.TextureLoader();
const loadTex = (name: string) =>
  new Promise<THREE.Texture>((ok, err) => loader.load(`assets/map/tex/${name}.png`, ok, undefined, err));

/** Loads the five chunk textures (SessionKind ground + river water). */
export async function loadMapTextures(): Promise<{ textures: Record<SessionKind, THREE.Texture>; water: THREE.Texture }> {
  const [river, lane, jungle, base, water] = await Promise.all(
    ['ground_river', 'ground_lane', 'ground_jungle', 'ground_base', 'water'].map(loadTex),
  );
  for (const t of [river, lane, jungle, base, water]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { textures: { river, lane, jungle, base }, water };
}
