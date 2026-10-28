// Procedural session layouts, one 6000x6000 chunk at a time. Pure: no three.js, no game state.
// Coordinates are chunk-local, centered at the origin, so Task 3 can offset whole sessions when streaming.

export type SessionKind = 'river' | 'lane' | 'jungle' | 'base';
export const SESSION_KINDS: SessionKind[] = ['river', 'lane', 'jungle', 'base'];
export interface BoxObstacle { kind: 'box'; x: number; z: number; hw: number; hd: number }
export interface CircleObstacle { kind: 'circle'; x: number; z: number; r: number }
export type Obstacle = BoxObstacle | CircleObstacle;
export const PIECES: readonly ['turret', 'inhibitor', 'nexus', 'rock_a', 'rock_b', 'rock_c'] =
  ['turret', 'inhibitor', 'nexus', 'rock_a', 'rock_b', 'rock_c'];
export type PieceModel = (typeof PIECES)[number];
/** Catalog key -> model id: structures come from `assets/models/<id>`, rocks from `assets/map/pieces/<id>`. */
export const PIECE_MODELS: Record<PieceModel, string> = {
  turret: 'sruap_orderturret',
  inhibitor: 'sruap_orderinhibitor',
  nexus: 'sruap_ordernexus',
  rock_a: 'rock_a',
  rock_b: 'rock_b',
  rock_c: 'rock_c',
};
export interface Piece { model: PieceModel; x: number; z: number; yaw: number }
export interface WaterBand { x0: number; x1: number }
export interface SessionLayout { kind: SessionKind; obstacles: Obstacle[]; pieces: Piece[]; water: WaterBand | null }
export const CHUNK = 6000;
export const MARGIN = 400;

const HALF = CHUNK / 2 - MARGIN; // playable half-extent; every obstacle stays inside it
const jitter = (rand: () => number, range: number) => (rand() * 2 - 1) * range;
// keeps [center - extent, center + extent] inside the playable area
const clamp = (v: number, extent: number) => Math.max(-HALF + extent, Math.min(HALF - extent, v));

export function randomKind(rand: () => number = Math.random): SessionKind {
  return SESSION_KINDS[Math.min(SESSION_KINDS.length - 1, Math.floor(rand() * SESSION_KINDS.length))];
}

function river(rand: () => number): SessionLayout {
  const x0 = -800 - rand() * 300, x1 = 800 + rand() * 300;
  const edge = Math.max(-x0, x1); // banks start past the wider side of the river
  const obstacles: Obstacle[] = [];
  const count = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const hw = 150 + rand() * 250, hd = 100 + rand() * 200;
    const x = (i % 2 ? -1 : 1) * (edge + hw + 50 + rand() * 600);
    obstacles.push({ kind: 'box', x, z: jitter(rand, HALF - hd), hw, hd });
  }
  return { kind: 'river', obstacles, pieces: [], water: { x0, x1 } };
}

function lane(rand: () => number): SessionLayout {
  const obstacles: Obstacle[] = [], pieces: Piece[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 1800 + jitter(rand, 200), z = sz * 2200 + jitter(rand, 200);
    obstacles.push({ kind: 'circle', x, z, r: 200 });
    pieces.push({ model: 'turret', x, z, yaw: rand() * Math.PI * 2 });
  }
  // no jungle edge boxes: the playable margin caps |z| at HALF - hd, so they cannot sit past z 2600
  return { kind: 'lane', obstacles, pieces, water: null };
}

function jungle(rand: () => number): SessionLayout {
  const cells: Array<[number, number]> = [];
  for (const cx of [-2000, 0, 2000]) for (const cz of [-2000, 0, 2000]) if (cx || cz) cells.push([cx, cz]);
  // fixed 2..7 walls keeps every session walled; the center cell stays empty so corridors always connect
  const count = 2 + Math.floor(rand() * 6);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const obstacles: Obstacle[] = [], pieces: Piece[] = [];
  for (const [cx, cz] of cells.slice(0, count)) {
    const hw = 200 + rand() * 400, hd = 150 + rand() * 150;
    const x = clamp(cx + jitter(rand, 200), hw), z = clamp(cz + jitter(rand, 200), hd);
    obstacles.push({ kind: 'box', x, z, hw, hd });
    if (rand() < 0.4) {
      const rock = PIECES[Math.min(PIECES.length - 1, 3 + Math.floor(rand() * 3))];
      pieces.push({ model: rock, x, z, yaw: rand() * Math.PI * 2 });
    }
  }
  return { kind: 'jungle', obstacles, pieces, water: null };
}

function base(rand: () => number): SessionLayout {
  const obstacles: Obstacle[] = [], pieces: Piece[] = [];
  obstacles.push({ kind: 'circle', x: 0, z: 0, r: 380 });
  pieces.push({ model: 'nexus', x: 0, z: 0, yaw: 0 });
  obstacles.push({ kind: 'circle', x: 0, z: -900, r: 260 });
  pieces.push({ model: 'inhibitor', x: 0, z: -900, yaw: 0 });
  const turrets = 2 + Math.floor(rand() * 2);
  const offset = rand() * Math.PI * 2;
  for (let i = 0; i < turrets; i++) {
    const a = offset + (i * Math.PI * 2) / turrets;
    const x = Math.cos(a) * 1600, z = Math.sin(a) * 1600;
    obstacles.push({ kind: 'circle', x, z, r: 200 });
    pieces.push({ model: 'turret', x, z, yaw: a + Math.PI }); // towers face the nexus
  }
  return { kind: 'base', obstacles, pieces, water: null };
}

export function layoutSession(kind: SessionKind, rand: () => number = Math.random): SessionLayout {
  switch (kind) {
    case 'river': return river(rand);
    case 'lane': return lane(rand);
    case 'jungle': return jungle(rand);
    case 'base': return base(rand);
  }
}
