# Mapa Procedural Infinito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o plano único por um mapa infinito em chunks temáticos do Summoner's Rift (rio, rota, selva, base) gerados aleatoriamente, com obstáculos puramente físicos.

**Architecture:** `src/sessions.ts` (layout puro por tipo de sessão) + `src/map.ts` (streaming de chunks, construção de meshes, colisão círculo×AABB/círculo). `game.ts` consome só `ensureChunks`, `collideCircle` e `update`. Assets reais extraídos do `Map11.wad` por `tools/build_map.py` para `public/assets/map/` (não commitados, como o resto dos assets do LoL).

**Tech Stack:** TypeScript, Three.js, Vite, Vitest (novo, só devDependency), Python (WAD/PIL/pygltflib) para extração.

**Spec:** `docs/superpowers/specs/2026-10-28-procedural-sr-sessions-design.md`

## Global Constraints

- `CHUNK = 6000` unidades; carregar 3×3 chunks ao redor do chunk do jogador; descartar o resto.
- Tipo de sessão: sorteio uniforme em `['river','lane','jungle','base']` na primeira geração; sem persistência; repetição permitida.
- Obstáculos **só física**: jogador e inimigos colidem; mísseis, targeting, melee e blink atravessam/ignoram; água é andável.
- Nenhum pathfinding: inimigos deslizam em paredes.
- Obstáculos ficam inteiramente dentro do próprio chunk com margem `MARGIN = 400` (colisão só consulta o chunk do ponto — nunca precisa dos vizinhos).
- Render unlit (`MeshBasicMaterial`), sem luzes/sombras; assets do LoL ficam fora do git (`public/assets/` já ignorado).
- Scripts existentes `build` (`tsc --noEmit && vite build`) devem continuar passando; testes via `pnpm test`.

## Review Focus

Cada linha vira um teste na tarefa dona do código:

1. **Ponto dentro do obstáculo** (spawn/teleport/respawn de inimigos em cima de parede) — resolve empurra para fora sem NaN. → Task 2.
2. **Canto diagonal de AABB** — círculo encostando no canto não tunela nem “gruda”. → Task 2.
3. **Borda do chunk** — player parado na divisa: nenhum obstáculo cruza a fronteira (invariante de `MARGIN`). → Task 1.
4. **Revisitar chunk** — dispose + regenerar não duplica mesh nem obstáculo no scene. → Task 3.
5. **Layout vazio** — sessão sem obstáculos não quebra `collideCircle` nem o update. → Task 2.

---

### Task 1: Layouts de sessão + runner de testes

**Files:**
- Create: `src/sessions.ts`
- Create: `tests/sessions.test.ts`
- Modify: `package.json` (devDependency `vitest`, script `test`)

**Interfaces:**
- Consumes: nada (puro, só `Math`/`random` injetado).
- Produces (usado pelas Tasks 2, 3, 7):
```ts
export type SessionKind = 'river' | 'lane' | 'jungle' | 'base';
export const SESSION_KINDS: SessionKind[];
export interface BoxObstacle { kind: 'box'; x: number; z: number; hw: number; hd: number }
export interface CircleObstacle { kind: 'circle'; x: number; z: number; r: number }
export type Obstacle = BoxObstacle | CircleObstacle;
export const PIECES: readonly ['turret', 'inhibitor', 'nexus', 'rock_a', 'rock_b', 'rock_c'];
export type PieceModel = (typeof PIECES)[number];
export interface Piece { model: PieceModel; x: number; z: number; yaw: number }
export interface WaterBand { x0: number; x1: number }
export interface SessionLayout { kind: SessionKind; obstacles: Obstacle[]; pieces: Piece[]; water: WaterBand | null }
export const CHUNK = 6000;
export const MARGIN = 400;
export function randomKind(rand?: () => number): SessionKind;
export function layoutSession(kind: SessionKind, rand?: () => number): SessionLayout;
```

- [ ] **Step 1: Instalar vitest e criar teste falho**

```bash
pnpm add -D vitest
```
`package.json`: adicionar `"test": "vitest run"`.

`tests/sessions.test.ts` — asserções que pinam os números:
```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test`
Expected: FAIL — `src/sessions.ts` não existe.

- [ ] **Step 3: Implementar `src/sessions.ts`**

Layouts centrados no chunk (coordenadas locais ±3000), sempre dentro de `half = CHUNK/2 - MARGIN`:

- **river:** `water = { x0: -800-random*300, x1: 800+random*300 }`; obstáculos só com `|x| > |water|+200` (bancos): 2–4 boxes nos cantos das margens; `pieces: []`.
- **lane:** corredor livre ao longo de x; torres em `x = ±1800`, `z = ±2200` (2 por par, jitter ±200) como `CircleObstacle r=200` + `Piece 'turret'` no mesmo ponto; 0–2 boxes de “borda de selva” com `|z| > 2600`.
- **jungle:** grade 3×3 de células de 2000: por célula, `random() < 0.55` coloca um box de `hw 200–600`, `hd 150–300` centrado na célula com jitter ±200 (célula central sempre vazia → corredores garantidos); porção de “rocks” vira `Piece` `rock_a|rock_b|rock_c` no centro do box (só visual).
- **base:** `nexus` em (0,0) com `CircleObstacle r=380`; `inhibitor` em (0, -900) com círculo `r=260`; 2–3 `turret` em anel `r≈1600` com círculo `r=200`; nenhum outro obstáculo.
- `randomKind`: `SESSION_KINDS[Math.floor(rand() * 4)]`; default `Math.random`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/sessions.ts tests/sessions.test.ts
git commit -m "feat: session layouts for procedural SR map"
```

---

### Task 2: Colisão pura círculo × obstáculos

**Files:**
- Create: `src/map.ts` (só o resolve nesta tarefa)
- Create: `tests/collision.test.ts`

**Interfaces:**
- Consumes: `Obstacle`, `CHUNK` de `src/sessions.ts`.
- Produces (usado pelas Tasks 3, 5):
```ts
/** Empurra `pos` para fora dos obstáculos, deslizando (LoL unit collision). Mutação in-place, sem NaN. */
export function resolveCircle(pos: { x: number; z: number }, radius: number, obstacles: readonly Obstacle[]): void;
```

- [ ] **Step 1: Escrever teste falho**

`tests/collision.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- tests/collision.test.ts`
Expected: FAIL — `resolveCircle` não exportado.

- [ ] **Step 3: Implementar em `src/map.ts`**

Um passe por obstáculo, com 2 iterações para assentar cantos entre dois boxes:
- **box:** ponto mais próximo via clamp em `x ± hw`, `z ± hd`; se o centro está dentro do box, empurra pelo eixo de menor penetração (`hw - |x|` vs `hd - |z|`); senão, se `dist² < radius²`, empurra pelo vetor `(pos - closest)` normalizado até `radius`.
- **circle:** `d = hypot(dx, dz)`; se `d === 0`, empurra em +x; senão até `r + radius`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- tests/collision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map.ts tests/collision.test.ts
git commit -m "feat: slide collision against box and circle obstacles"
```

---

### Task 3: `WorldMap` — streaming de chunks

**Files:**
- Modify: `src/map.ts`
- Create: `tests/worldmap.test.ts`

**Interfaces:**
- Consumes: `resolveCircle` (Task 2), `layoutSession/randomKind/CHUNK/SessionKind/Piece` (Task 1).
- Produces (usado pela Task 5):
```ts
export class WorldMap {
  /** textures: uma THREE.Texture por kind (injetada — testes usam new THREE.Texture()). pieces: templates clonados por piece.model; ausente = box fallback. */
  constructor(scene: THREE.Scene, textures: Record<SessionKind, THREE.Texture>,
              pieces: Partial<Record<PieceModel, THREE.Object3D>>, rand?: () => number, water?: THREE.Texture);
  ensureChunks(pos: THREE.Vector3): void;      // gera ≤ 2 chunks novos por chamada; descarta fora do 3×3
  collideCircle(pos: THREE.Vector3, radius: number): void; // resolve só contra o chunk que contém pos
  update(dt: number): void;                    // scroll da água
  kindAt(x: number, z: number): SessionKind | null;
  dispose(): void;                             // remove todos os meshes do scene
}
```

- [ ] **Step 1: Escrever teste falho**

`tests/worldmap.test.ts` — cobre Review Focus 4:
```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- tests/worldmap.test.ts`
Expected: FAIL — `WorldMap` não existe.

- [ ] **Step 3: Implementar `WorldMap` em `src/map.ts`**

- Chave de chunk `"cx,cz"` com `cx = Math.floor(x / CHUNK)`; chunk = `{ kind, layout, group: THREE.Group, water?: THREE.Mesh, obstacles }`.
- `ensureChunks` mantém no máximo `MAX_GEN = 2` novos chunks por chamada (amortização) e remove os fora de `|dx| <= 1, |dz| <= 1`; `group.removeFromParent()` + dispose de geometria.
- Geração: `kind = randomKind(rand)`, `layout = layoutSession(kind, rand)`; ground = `PlaneGeometry(CHUNK, CHUNK)` com `textures[kind]` (clone com `repeat` alto e `wrap` repetido); water mesh só no river com `textures` de água opcional (parâmetro extra opcional `water?: THREE.Texture` — se ausente, usa `MeshBasicMaterial` azul); pieces via `pieces[model]?.clone()` (escala/rotação pelo placement), fallback = caixa texturizada escura no ponto do box quando o modelo não foi passado.
- `collideCircle`: consulta o chunk de `pos` e chama `resolveCircle`.
- `update(dt)`: `water.material.map.offset.x += dt * 0.01` quando houver.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS (todos os suites).

- [ ] **Step 5: Commit**

```bash
git add src/map.ts tests/worldmap.test.ts
git commit -m "feat: streamed chunk world with kind lookup and collision"
```

---

### Task 4: Extração das texturas reais do SR

**Files:**
- Create: `tools/build_map.py`
- Create (gerado, fora do git): `public/assets/map/tex/{ground_river,ground_lane,ground_jungle,ground_base,water}.png`

**Interfaces:**
- Consumes: `Wad` de `tools/extract_lol.py` (import local; já lê zstd/gzip e converte DDS→PNG com PIL).
- Produces: os 5 PNGs em nomes canônicos (contrato que a Task 5 consome); `TEXTURE_MAP` no topo do tool mapeando nome canônico → caminho de origem dentro do WAD.

- [ ] **Step 1: Inspecionar as texturas candidatas**

Run:
```bash
grep -oE "levels/map11/scene/textures/[a-z0-9_/]+\.(dds|tex|png)" assets-raw/hashes/hashes.game.txt | sort -u | grep -iE "grass|ground|dirt|stone|water|river|lane|base|floor|plaza" | head -60
```
Expected: lista de candidatas; abrir as 5 escolhidas (extrair uma amostra e olhar) e anotar os caminhos exatos em `TEXTURE_MAP`. Critério: grass para `jungle`/`river` (podem ser a mesma origem), pedra/terra para `lane`/`base`, uma textura de água corrente para `water`.

- [ ] **Step 2: Escrever o tool (parte texturas)**

Uso: `python tools/build_map.py textures assets-raw/hashes/hashes.game.txt public/assets/map "/Applications/.../Map11.wad.client"`.
Lê cada origem do `TEXTURE_MAP`, extrai bytes do WAD, converte DDS→PNG se necessário (mesma lógica do `extract_lol.py`), salva com o nome canônico. Fonte ausente = `print` de aviso e `exit 1` (contrato quebrado não passa silencioso).

- [ ] **Step 3: Rodar e verificar as saídas**

Run:
```bash
.venv-tools/bin/python tools/build_map.py textures assets-raw/hashes/hashes.game.txt public/assets/map "/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client"
ls -la public/assets/map/tex/
```
Expected: 5 PNGs, cada um > 50 KB; abrir `ground_jungle.png` e `water.png` e confirmar visual de SR (verde de grama, água legível).

- [ ] **Step 4: Commit**

```bash
git add tools/build_map.py
git commit -m "feat: extract SR ground and water textures from Map11.wad"
```

---

### Task 5: Integração no jogo (sem peças reais ainda)

**Files:**
- Modify: `src/map.ts` (loader de texturas)
- Modify: `src/game.ts` (~L134 `makeGround()`; `update` L260; `updatePlayer` L325; `updateEnemies` L703; `reset` L140; `load` L124)
- Modify: `src/main.ts` (só se fog exigir)

**Interfaces:**
- Consumes: `WorldMap` (Task 3), PNGs canônicos (Task 4).
- Produces: `export async function loadMapTextures(): Promise<{ textures: Record<SessionKind, THREE.Texture>; water: THREE.Texture }>` em `src/map.ts`.

- [ ] **Step 1: Implementar o loader e a integração**

- `loadMapTextures()`: `THREE.TextureLoader` nos 5 PNGs (`assets/map/tex/...`), `wrapS/T = RepeatWrapping`, `colorSpace = SRGBColorSpace`.
- `Game`: campo `map!: WorldMap`; em `load()` após os modelos: `const { textures, water } = await loadMapTextures(); this.map = new WorldMap(this.scene, textures, {}, Math.random, water);`
- Remover `this.scene.add(makeGround())` (L134) e deletar `makeGround()` (L973–995); o `WorldMap` cobre o chão.
- `scene.fog = new THREE.Fog(0x0b1410, 5000, 9500)` (mesmo valor de `scene.background`).
- `update(dt, move)`: primeira linha após o early-return: `this.map.ensureChunks(this.pos);`
- `updateEnemies`: após `this.separate()` (L703), para cada inimigo vivo: `this.map.collideCircle(e.pos, e.def.radius)`.
- `updatePlayer`: logo após o clamp da arena (L331): `this.map.collideCircle(this.pos, B.radius)`.
- `reset()`: chamar `this.map.dispose()` antes de reposicionar (o próximo `ensureChunks` regenera).
- `update(...)`: chamar `this.map.update(dt)` junto de `this.vfx.update(dt)`.

- [ ] **Step 2: Verificar tipos e testes**

Run: `pnpm build && pnpm test`
Expected: build sem erro; testes PASS.

- [ ] **Step 3: Verificação manual no navegador**

Run: `pnpm dev`
Checklist:
- Chão visual com textura real em todas as direções (sem plano procedural antigo).
- Andar >1 chunk em cada direção: novas sessões aparecem, antigas somem, fog esconde a borda carregada.
- Água do rio andável e animada; nenhuma barreira invisível em lugar algum.
- Inimigos deslizam em paredes/torres e nunca ficam dentro de obstáculo visível.
- E para dentro de uma parede → o Ezreal é empurrado para fora ao pousar.
- Baron: arena continua fechando e puxando o jogador de volta.

- [ ] **Step 4: Commit**

```bash
git add src/game.ts src/map.ts src/main.ts
git commit -m "feat: procedural chunk map replaces the single ground plane"
```

---

### Task 6: Parser de paredes/rochas do mapgeo (limitado, com fallback)

**Files:**
- Modify: `tools/build_map.py` (subcomando `pieces`)
- Create (gerado, fora do git): `public/assets/map/pieces/rock_{a,b,c}.glb` + `.png`
- Reference de formato: `https://github.com/floh22/lol-map-renderer` (`MapGeometry.java`, `MapObject.java`) — ler antes de codar.

**Interfaces:**
- Produces: até 3 GLBs de rocha/parede em `public/assets/map/pieces/`; se o parser não produzir nenhuma seção legível, **a tarefa termina sem GLBs** e o fallback de caixa texturizada (Task 3) é o resultado final — registrar isso no README na Task 8.
- `pygltflib` (venv de tools) para escrever GLB estático com UV + textura.

- [ ] **Step 1: Extrair e inspecionar o `base.mapgeo`**

Run:
```bash
.venv-tools/bin/python - <<'PY'
import sys; sys.path.insert(0, 'tools')
from extract_lol import Wad
w = Wad('/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client')
d = w.read('data/maps/mapgeometry/map11/base.mapgeo')
print(len(d), d[:16])
PY
```
Expected: arquivo > 1 MB; magic/textura conforme a referência do `lol-map-renderer`. Inspecionar `base.materials.bin` para mapear material → textura (`levels/map11/scene/textures/...`).

- [ ] **Step 2: Implementar `pieces` no `build_map.py`**

Parsear **só** o necessário: cabeçalho → seções (vertex buffers + índices + ranges de material); exportar as 3 maiores seções cujo material tenha textura de rocha/penhasco como GLB (unlit, UV como no arquivo; textura extraída e convertida para PNG ao lado, mesmo padrão dos personagens).

- [ ] **Step 3: Rodar e verificar**

Run: `python tools/build_map.py pieces assets-raw/hashes/hashes.game.txt public/assets/map ".../Map11.wad.client"`
Expected: `ls public/assets/map/pieces/` mostra `rock_a.glb`… com > 10 KB cada e PNG ao lado. Visualizar no https://gltf-viewer.com ou inspecionar bounds via script; se o parser falhar em ≤2 iterações de formato: **parar**, não sair GLBs, seguir para a Task 7 usando caixas (fallback da Task 3).

- [ ] **Step 4: Commit**

```bash
git add tools/build_map.py
git commit -m "feat: extract SR rock and wall meshes from map geometry"
```

---

### Task 7: Ligar as peças reais (estruturas + rochas) e ajuste fino

**Files:**
- Modify: `src/assets.ts` (`propModel`)
- Modify: `src/sessions.ts` (nomes reais por `PieceModel` em `PIECE_MODELS`)
- Modify: `src/game.ts` (`load` ids)
- Modify: `src/map.ts` (loader das peças)

**Interfaces:**
- Consumes: `loadModel`/`templates` de `assets.ts`; GLBs da Task 6; estruturas via pipeline existente.
- Produces:
```ts
// src/assets.ts
export function propModel(id: string): THREE.Object3D; // clone estático do template carregado
// src/sessions.ts
export const PIECE_MODELS: Record<PieceModel, string>; // chave de catálogo → id do modelo
// src/map.ts
export async function loadMapPieces(): Promise<Partial<Record<PieceModel, THREE.Object3D>>>;
```

- [ ] **Step 1: Extrair as estruturas via pipeline existente**

Run (adaptar lista após `grep sruap_ assets-raw/hashes/hashes.game.txt`):
```bash
for c in sruap_orderinhibitor sruap_chaosinhibitor sruap_ordernexus sruap_chaosnexus sruap_orderturret sruap_chaosturret; do
  .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c ".../Map11.wad.client" || echo "faltou $c"
done
.venv-tools/bin/python tools/build_models.py l2g/lol2gltf
```
Expected: `public/assets/models/sruap_*.glb|png` (nomes exatos a confirmar no grep). `PIECE_MODELS` → `turret: 'sruap_orderturret'`, `inhibitor: 'sruap_orderinhibitor'`, `nexus: 'sruap_ordernexus'`, `rock_*: 'rock_a|b|c'` (ou remover `rock_*` se a Task 6 parou).

- [ ] **Step 2: Implementar `propModel`, `PIECE_MODELS` e `loadMapPieces`**

- `propModel`: `clone(templates.get(id).scene)` (import `clone` já existe); erro se não carregado.
- `loadMapPieces`: `loadModel(id)` dos ids de `PIECE_MODELS` presentes + GLBs de rocha via `GLTFLoader` direto (`assets/map/pieces/x.glb` + PNG vizinho, mesmo `MeshBasicMaterial` unlit), retornando o mapa por `PieceModel`; modelo ausente → `undefined` (fallback de caixa).
- `Game.load()`: `this.map = new WorldMap(..., await loadMapPieces(), ...)`.

- [ ] **Step 3: Ajuste fino (calls do builder)**

Escala/altura das peças no `map.ts` para casar com o Ezreal (altura visual ~350–500 unidades para torres/inibidor, 150–250 para rocks); `yaw`/jitter por placement; água com repeat coerente; verificar custo de draw calls (9 chunks × ~15 meshes ≈ 135, aceitável).

- [ ] **Step 4: Verificar**

Run: `pnpm build && pnpm test && pnpm dev`
Checklist: torres/inibidores/nexus reais na base; torres na rota; rochas na selva (se houver GLBs); **torres não atacam nem são clicáveis/atacáveis** (direito no inimigo continua focando só unidades reais); colisão alinhada ao visual das estruturas.

- [ ] **Step 5: Commit**

```bash
git add src/assets.ts src/sessions.ts src/game.ts src/map.ts
git commit -m "feat: real SR structures and rocks as session scenery"
```

---

### Task 8: Documentação e verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Documentar**

`README.md`, seção de assets: pipeline do mapa (`build_map.py textures|pieces` + extração das estruturas), nomes canônicos gerados, comportamento de fallback (caixas se mapgeo não parsear), e nota de que `sessions.ts`/`map.ts` são o sistema de mapa (CHUNK, 3×3, colisão física pura).

- [ ] **Step 2: Verificação final**

Run: `pnpm build && pnpm test`
Expected: PASS. Checagem manual do checklist da Task 5 uma última vez.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: procedural map pipeline and asset extraction"
```

---

## Self-review

- **Cobertura do spec:** streaming infinito (T3/T5) ✓, 4 tipos + repetição (T1) ✓, assets reais: texturas (T4), estruturas (T7), paredes/rochas com fallback (T6) ✓, física pura incl. mísseis/targeting/blink ignorando cenário (física só aplica a corpos; T5) ✓, sem bordas (T3 janela móvel) ✓, módulo `src/map.ts` com API mínima (T3/T5) ✓, água andável (T1/T3) ✓, fog (T5) ✓, decoração sem modelos de monstros (T1 só estruturas/rochas) ✓.
- **Tipos:** `PieceModel`/`Obstacle` definidos uma vez em `sessions.ts` e reusados; `resolveCircle`/`WorldMap`/`loadMapTextures`/`loadMapPieces`/`propModel` com nomes estáveis entre tarefas.
- **Review Focus:** 1→T2, 2→T2, 3→T1, 4→T3, 5→T2 (todos com teste).
- **Proporção:** corpo de código só nos testes e nas assinaturas; algoritmos com uma linha de descrição.
