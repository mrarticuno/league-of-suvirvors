# Páginas de Runas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meta-progression: kills earn rune points that permanently unlock LoL-style rune nodes. The player equips a
page (primary tree, secondary tree, shards) before each run.

**Architecture:** There are three layers.
- **Rune catalog:** `src/runes/`, which holds data and effect factories, one file per tree.
- **Persistence and rules:** `src/progress.ts`, with pure functions and the storage passed in, so it can be tested in
  vitest/node.
- **Game integration:** rune effects reuse the `ItemEffect` hook interface. The interface gains a few hooks, and `Game`
  runs rune effects in the same loops as item effects.

Two new DOM overlays, champion select and rune page, change the flow in `main.ts`.

**Tech Stack:** TypeScript, three.js, vite, vitest (`pnpm test`), `localStorage`.

**Spec:** `docs/superpowers/specs/2026-10-28-rune-pages-design.md`. It has the adaptation tables per tree, with the
effect text and numbers. Effect descriptions (`desc`) are copied from those tables verbatim.

## Global Constraints

- UI copy is in Portuguese (pt-BR). Code comments are in English, in the style of the surrounding code.
- Economy constants live together in `src/progress.ts`:
  - `KILLS_PER_POINT = 100`
  - `NODE_COST_STEP = 8`: the n-th node unlocked in a tree costs `8 × n`, with a separate counter per tree.
  - `SHARD_ROW_COST = [20, 40, 60]`
- Storage key `los.runes.v1`. If the stored text can't be read, copy it raw to `los.runes.v1.bak` before any write.
  Every storage access is wrapped in try/catch, the same way as `src/audio.ts`.
- Credit points only once per run, when `game.over` becomes non-null. A short run (<800 kills) may buy nothing. That is
  intended.
- "Champion" in a LoL rune means an `elite` or `epic` tier enemy (`e.def.tier`).
- Adaptive force means bonus AD: `ADAPTIVE_AD = 0.6` per adaptive force point. The game has no AP.
- No new dependencies.
- Deviation from the spec: the spec names one file, `src/runes.ts`. This plan uses the folder `src/runes/` instead,
  because 61 effects would not fit well in one file. The folder mirrors `src/champions/`.

## Review Focus

1. Corrupt or foreign data in `localStorage` (bad JSON, unknown rune ids from an older catalog). Load must give a valid,
   cleaned state and keep the raw text in `.bak`. Covered by tests in Task 2.
2. Changing the primary tree while a secondary is set:
   - picking the current secondary as primary clears the secondary;
   - switching the primary clears the old primary's picks.
   Covered by tests in Task 2.
3. Starting a run with an empty or partial page must work, and empty slots grant nothing. Covered by tests in Task 3
   (`runeEffects` with an empty page).
4. Effect state must not leak between runs: stacks like Lembranças Macabras restart at 0 after `reset`. Covered by a test
   in Task 3: effects are built fresh per `reset`.
5. The end screen must not credit twice, even if it is drawn again or the player reloads. Covered by the `credited` flag
   check in Task 9 (manual step).

---

### Task 1: Rune catalog

**Files:**
- Create: `src/runes/index.ts`
- Test: `tests/runes.test.ts`

**Interfaces:**
- Produces:
  - `type TreeId = 'precision' | 'domination' | 'sorcery' | 'resolve' | 'inspiration'`
  - `interface RuneDef { id: string; name: string; tree: TreeId; row: 0 | 1 | 2 | 3; icon: string; desc: string; effect?: (g: Game) => ItemEffect }`
    Row 0 is the keystone row.
  - `TREES: Record<TreeId, { name: string; icon: string }>`. The names are Precisão, Dominação, Feitiçaria, Determinação
    and Inspiração.
  - `RUNES: Record<string, RuneDef>`. It is built from the per-tree arrays exported by `./precision`, `./domination`,
    `./sorcery`, `./resolve` and `./inspiration`. Each of those files exports `<TREE>: RuneDef[]`. In this task they hold
    data only, with `effect` left undefined.
  - `runesOf(tree: TreeId, row?: number): RuneDef[]`
  - `SHARDS: { name: string; stat: ShardStat }[][]`, 3 rows of 3, where
    `type ShardStat = 'adaptive' | 'as' | 'ah' | 'ms' | 'hpScaling' | 'hp' | 'tenacity'`. The values come from the
    spec's shard table.
  - `ADAPTIVE_AD = 0.6`
- Rune ids are kebab-case English names, for example `press-the-attack` or `coup-de-grace`.
- `icon` is a full Data Dragon URL. Get the paths from
  `https://ddragon.leagueoflegends.com/cdn/<version>/data/pt_BR/runesReforged.json`, using the version in
  `src/items.json`. Prefix each path with `https://ddragon.leagueoflegends.com/cdn/img/`. If a rune is missing from
  that file, for example Deep Ward on an older version, use its tree's icon.

- [ ] **Step 1: Write the failing test**

```ts
it('catalog matches the spec: 13 precision, 12 in each other tree, keystones 4/3/3/3/3, 3 runes per minor row', () => {
  expect(runesOf('precision').length).toBe(13);
  for (const t of ['domination', 'sorcery', 'resolve', 'inspiration'] as const) expect(runesOf(t).length).toBe(12);
  expect(runesOf('precision', 0).length).toBe(4);
  for (const t of Object.keys(TREES) as TreeId[]) for (const r of [1, 2, 3]) expect(runesOf(t, r).length).toBe(3);
  expect(Object.keys(RUNES).length).toBe(61);
  expect(SHARDS.map((r) => r.length)).toEqual([3, 3, 3]);
});
```

- [ ] **Step 2:** Run `pnpm test tests/runes.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the catalog: the 61 entries, with names in pt-BR and `desc` from the spec tables.
- [ ] **Step 4:** Run `pnpm test tests/runes.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: rune catalog`.

---

### Task 2: Progress — economy, page rules, persistence

**Files:**
- Create: `src/progress.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Consumes: `RUNES`, `TreeId` and `runesOf` from Task 1.
- Produces:
  - `interface Page { primary: TreeId | null; keystone: string | null; primaryRunes: (string | null)[]; secondary: TreeId | null; secondaryRunes: string[]; shards: (number | null)[] }`
    - `primaryRunes` has length 3, one entry per row 1–3.
    - `secondaryRunes` has length ≤ 2, oldest first.
    - `shards` has length 3: the chosen index in each row, or null.
  - `interface Progress { points: number; killRemainder: number; unlocked: string[]; shardRows: number[]; pages: Record<string, Page> }`
  - `emptyPage(): Page`
  - `emptyProgress(): Progress`
  - `nodeCost(p: Progress, tree: TreeId): number`. Returns `NODE_COST_STEP * (unlocked count in tree + 1)`.
  - `unlockRune(p: Progress, id: string): Progress | null`. Returns null when the rune is already unlocked or the points
    are not enough.
  - `unlockShardRow(p: Progress, row: number): Progress | null`
  - `credit(p: Progress, kills: number, bonusPoints = 0): { progress: Progress; gained: number }`
    - `gained = floor((killRemainder + kills) / 100) + bonusPoints`
    - the new `killRemainder` is the rest of that division.
  - `equipRune(page: Page, id: string, unlocked: string[]): Page`. It applies the rules below.
  - `equipShard(page: Page, row: number, index: number, shardRows: number[]): Page`
  - `loadProgress(storage: Pick<Storage, 'getItem' | 'setItem'>): Progress`
  - `saveProgress(p: Progress, storage: Pick<Storage, 'getItem' | 'setItem'>): void`
- All functions are pure. They return new objects and never mutate their input.

`equipRune` rules. A rune that is not unlocked returns the page unchanged.

1. Keystones (row 0):
   - if `rune.tree` is the current secondary, clear the secondary and its runes;
   - if `rune.tree` differs from the primary, set it as primary and clear `primaryRunes`;
   - then set `keystone`.
2. Minor rune of the primary tree: set `primaryRunes[row - 1]`.
3. Minor rune of another tree:
   - if that tree differs from the secondary, set it as secondary with `[id]`;
   - else, if a rune of the same row is already picked, replace it;
   - else push the rune and drop the oldest when there are more than 2.
4. A minor rune can't start a primary tree: if `primary` is null, the rune goes to the secondary under rule 3.

- [ ] **Step 1: Write failing tests**

These are the assertions:
- **Costs:**
  - `nodeCost(empty, 'precision') === 8`
  - after one precision unlock: `nodeCost(p, 'precision') === 16` and `nodeCost(p, 'sorcery') === 8`
- **Unlocking:**
  - `unlockRune` with 7 points returns `null`
  - with 35 points, unlocking 2 precision runes leaves `points === 11`
  - unlocking the same id twice returns `null` the second time
  - `unlockShardRow(p, 2)` costs 60
- **Credit:**
  - `credit({ killRemainder: 50 }, 3460)` gives `gained === 35` and `killRemainder === 10`
  - `credit(p, 299)` gives `gained === 2`
  - `credit(p, 0, 3)` gives `gained === 3`
- **Equip:**
  - a keystone sets the primary tree
  - a second keystone from another tree switches the primary and clears `primaryRunes`
  - three secondary picks in rows 1, 2, 3 keep the last two
  - two picks in the same secondary row replace each other
  - picking the secondary tree's keystone moves that tree to primary and empties the secondary
  - an id that is not unlocked leaves the page unchanged
- **Persistence:**
  - `loadProgress` over a fake storage holding `'{oops'` returns `emptyProgress()`, and `getItem('los.runes.v1.bak')` is
    `'{oops'` before the next save
  - load drops unknown rune ids from `unlocked` and from pages
  - `saveProgress` then `loadProgress` round-trips the data
  - a storage that throws on access gives `emptyProgress()` and no exception

- [ ] **Step 2:** Run `pnpm test tests/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/progress.ts`.
- [ ] **Step 4:** Run `pnpm test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat: rune progress economy and page rules`.

---

### Task 3: Game hooks, shards and page application

**Files:**
- Modify: `src/itemEffects.ts` (add the new optional hooks to `ItemEffect`)
- Modify: `src/game.ts`
  - derived-stat getters at lines ~227–237
  - `hurtEnemy` ~572
  - `hurtPlayer` ~600
  - `stun` ~630
  - `killEnemy` ~644
  - `horde`, `gainXp`
  - enemy movement ~817
- Modify: `src/runes/index.ts` (add `runeEffects` and `shardStats`)
- Modify: `src/map.ts` (add `WorldMap.inWater(p: { x: number; z: number }): boolean` from the chunk's `water` band)
- Test: `tests/runes.test.ts`

**Interfaces:**
- Consumes: `Page` from Task 2, and `RUNES` and `SHARDS` from Task 1.
- Produces. New optional `ItemEffect` hooks, which every later task uses:
  - `stat?(k: keyof ItemStats | 'tenacity' | 'healMult'): number`. Additive bonus. It is read by the getters `maxHp`,
    `attackSpeed`, `moveSpeed`, `armor`, `abilityHaste`, `critChance` and lifesteal, and by `bonusAd` through
    `stat('ad')`. The existing `bonusAd` hook stays.
  - `damageMult?(e: Enemy, hit: Hit): number`. Multiplicative, applied to the total in `hurtEnemy` before HP is removed.
  - `onDealt?(e: Enemy, hit: Hit, dealt: number): void`. Called after damage is dealt.
  - `onKill?(e: Enemy): void`
  - `onHurt?(amount: number): number`. Returns the reduced amount. Called in `hurtPlayer` after armor and before the
    shield.
  - `onHorde?(): void`
  - `onLevel?(): void`
  - `onCastResolved?(key: SkillKey): void`
  - `xpMult?(): number`
- New `Game` members:
  - `page: Page`
  - `shield = 0`. Absorbed first in `hurtPlayer`. It decays to 0 when `shieldUntil` passes.
  - `addShield(amount: number, seconds: number): void`
  - `heal(amount: number): void`. Applies `1 + stat('healMult')`. Lifesteal in `hurtEnemy` also goes through it.
  - `slow(e: Enemy, pct: number, seconds: number): void`. `Enemy` gains `slowPct` and `slowUntil`. Enemy movement
    multiplies its speed by `1 - slowPct` while slowed.
  - `isSlowed(e: Enemy): boolean`
  - `choices: { title: string; options: { name: string; text: string; icon: string; run: () => void }[] }[]`. A queue of
    popups that runes request. Task 9 shows them.
  - `bonusRunePoints = 0`. Caçador de Tesouros adds to it.
  - `inWater(): boolean`
  - `reset(page: Page = emptyPage())`. Stores the page and rebuilds the rune effects fresh.
- Tenacity: `stun(seconds)` multiplies the duration by `1 - min(0.8, stat('tenacity'))`.
- `runeEffects(g: Game, page: Page): ItemEffect[]`
  - It returns one effect per equipped rune that has an `effect`.
  - It also returns one shard effect, whose `stat` returns `shardStats(page.shards, g.level)[k]`.
- `shardStats(shards: (number | null)[], level: number): Partial<Record<…, number>>`
  - `adaptive` gives `ad: 9 * ADAPTIVE_AD`
  - `as` gives `0.10`
  - `ah` gives `8`
  - `ms` gives `msPct: 0.02`
  - `hpScaling` gives `hp: 10 + (170 * (level - 1)) / 17`
  - `hp` gives `65`
  - `tenacity` gives `0.15`
- `Game.itemFx` becomes item effects plus rune effects. `activeEffects()` appends `this.runeFx`, which is built in
  `reset` and never cached across runs.

- [ ] **Step 1: Write failing tests**

These are the assertions:
- `shardStats([0, 2, 1], 18)` gives `{ ad: 5.4, hp: 180, tenacity: 0.15 }` (rounded compare)
- `shardStats([null, null, null], 1)` gives `{}`
- `runeEffects(fakeGame, emptyPage())` gives a single shard effect, and that effect's `stat('ad')` is `0`

Here `fakeGame` is `{ level: 1 } as unknown as Game`.

- [ ] **Step 2:** Run `pnpm test tests/runes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the hooks in `game.ts`, `shardStats` and `runeEffects`, and `inWater`.
- [ ] **Step 4:** Run `pnpm test`. Then run `pnpm build`. Expected: tests PASS and tsc reports no errors.
- [ ] **Step 5:** Commit `feat: rune hooks, shields, slows, tenacity and shards in Game`.

---

### Tasks 4–8: Effects per tree

There is one task per tree file:
- Task 4: `src/runes/precision.ts`
- Task 5: `src/runes/domination.ts`
- Task 6: `src/runes/sorcery.ts`
- Task 7: `src/runes/resolve.ts`
- Task 8: `src/runes/inspiration.ts`

Each task adds `effect` factories to its tree's entries. It follows the numbers and behavior in the spec table for that
tree, and uses only the hooks from Task 3. The pattern is the same as `ITEM_PASSIVES` in `src/itemEffects.ts`: a closure
holds the per-run state.

**Interfaces (all five):**
- Consumes: the Task 3 hooks and `Game` members.
- Run-scaled stacks ("a cada N abates") read `g.kills`.
- "Dano adaptativo" is physical damage dealt through `g.hurtEnemy(e, amount, { type: 'physical', source: 'item' })`.
- AoE uses `g.enemiesNear`.

**Tree-specific decisions that the hooks don't settle:**
- **Precisão:**
  - Ritmo Fatal's range bonus needs a new `stat('range')` read by `inAttackRange` and `attackReach`. Add it in this task.
  - Agilidade nos Pés's Energy builds by 1 per attack. It is full at 100 / 6 attacks; use 6 attacks.
- **Dominação:**
  - Golpe Desleal fires when `g.isSlowed(e) || tier is elite/epic`.
  - Caçador de Tesouros adds 1 to `g.bonusRunePoints` per elite or epic kill, up to 5.
  - Sexto Sentido uses `onHorde` and `g.addShield(0.1 * g.maxHp, 3)`.
- **Feitiçaria:**
  - Cometa Arcano triggers on `hurtEnemy` with `hit.source === 'ability'`.
  - "Acertos reduzem CD" means each ability hit cuts 20% of the remaining CD.
  - Caminhar sobre as Águas uses `g.inWater()`.
- **Determinação:**
  - Pós-Choque triggers on the champion being stunned. The game has no player CC on enemies, so add `onStunned` to
    `stun()`: an `ItemEffect` hook `onStunned?(): void`.
  - Golpe de Escudo arms when `addShield` is called. Have `addShield` notify a new hook `onShield?(): void`.
- **Inspiração:**
  - Flash Hextec adds `Game.flash(point)`: a 400-unit blink with 120s CD that respects `collidePlayer`. `main.ts` binds
    the `d` key to it, only when the rune is equipped (`g.page`).
  - Grimório Desselado and Tônico Triplo push into `g.choices`.
  - Tônico da Distorção Temporal modifies `drinkPotion`: add a hook or read the page directly in `drinkPotion`.
  - Reembolso uses `xpMult`.
  - Pau para Toda Obra counts the distinct keys in `g.items` with a value above 0.

**Steps for each task:**

- [ ] **Step 1: Write failing tests** in `tests/runes-<tree>.test.ts`, using a stub `Game`. Cover the stack or threshold
  logic of each keystone, plus at least two minor runes with a condition. The stub only needs the members the effect
  reads, cast as `unknown as Game`, with `hurtEnemy` and `heal` as `vi.fn()`.

  Required assertions:
  - **Precisão:**
    - Golpe de Misericórdia `damageMult` gives 1.08 at 39% HP and 1 at 41%
    - Conquistador at 12 stacks heals 8% of `dealt`
    - Lenda: Espontaneidade caps at +15% with `kills = 5000`
  - **Dominação:**
    - Eletrocutar fires once for 3 distinct hits within 3s, and not again before 4s
    - Caçador de Tesouros caps at 5
  - **Feitiçaria:**
    - Ímpeto Gradual needs 3 distinct hits within 4s
    - Faixa de Fluxo de Mana caps at 250
  - **Determinação:**
    - Guardião shields below 30% HP, then waits 70s
    - Inabalável `stat('tenacity')` gives 0.2
  - **Inspiração:**
    - Percepção Cósmica `stat('ah')` gives 18
    - Reembolso `xpMult` gives 1.1
    - Tônico Triplo pushes a choice at levels 3, 6 and 9 only
- [ ] **Step 2:** Run `pnpm test tests/runes-<tree>.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the effects.
- [ ] **Step 4:** Run `pnpm test`, then `pnpm build`. Expected: tests PASS and tsc reports no errors.
- [ ] **Step 5:** Commit `feat: <tree> rune effects`.

---

### Task 9: Champion select, rune page screen, run flow

**Files:**
- Create: `src/runePage.ts`. It renders the `#select` and `#runes` overlays. It keeps `ui.ts` from growing.
- Modify: `index.html`. Add the `#select` and `#runes` overlay markup and CSS, in the style of the `#levelup` and `#end`
  overlays already there.
- Modify: `src/ui.ts`
  - `showEnd(g, gained, progress, onContinue)`: shows `+X pontos de runa` and `kills restantes até o próximo ponto`.
    The button text becomes "Continuar".
  - Add `choice(c, done)` to show a `g.choices` entry. It reuses `#levelup` and `bindChoices`, like `potionStep`.
- Modify: `src/main.ts`, for the flow and the `d` key.

**Interfaces:**
- Consumes: `loadProgress`, `saveProgress`, `unlockRune`, `unlockShardRow`, `equipRune`, `equipShard`, `nodeCost`,
  `credit` and `emptyPage` from Task 2; `RUNES`, `TREES`, `runesOf` and `SHARDS` from Task 1; and
  `Game.reset(page)`, `Game.choices` and `Game.bonusRunePoints` from Task 3.
- Produces:
  - `showChampionSelect(onPick: (champ: ChampionDef) => void): void`. It lists `CHAMPIONS` as cards.
  - `showRunePage(champId: string, onPlay: (page: Page) => void): void`. It loads progress itself and saves after each
    purchase or equip. The page is saved to `progress.pages[champId]`.

**Rune page behavior:**
- Primary column, secondary column, shard rows, and a points banner.
- **Clicking a node:**
  - locked node: buy it if `points >= nodeCost` and show the cost on hover; if the points are not enough, show it greyed;
  - unlocked node: `equipRune`.
- **Shard rows:**
  - locked row: one buy button with the row cost;
  - unlocked row: 3 selectable options.
- **Tree selection:** a tree tab bar picks the primary. The secondary bar excludes the primary.
- **Tooltip:** shows `desc`.
- **"Jogar" button:** always enabled.

**Flow in main.ts:**
1. After `game.load` resolves, the loop starts but does not simulate while `inMenu` is true. The select screen opens.
2. Pick a champion: the rune page opens.
3. Press Jogar: `game.reset(page)`, then `inMenu = false`.
4. In `checkPrompts`, when `game.over` is set and `credited === false`:
   - `credit(progress, game.kills, game.bonusRunePoints)`
   - save
   - `credited = true`
   - `hud.showEnd(...)`
5. Press Continuar: `inMenu = true`, `credited = false`, and the select screen opens.
6. In `checkPrompts`, when `!game.over && game.choices.length && !hud.choosing`: pause the game, shift the first choice,
   and call `hud.choice`. This works the same way as level-ups.

- [ ] **Step 1:** Implement the overlays, `runePage.ts`, the `ui.ts` changes and the `main.ts` flow.
- [ ] **Step 2:** Run `pnpm test`, then `pnpm build`. Expected: tests PASS and the build has no errors.
- [ ] **Step 3: Manual check** with `pnpm dev`:
  - Clear storage with `localStorage.removeItem('los.runes.v1')`.
  - On load, the select screen appears, then the rune page with 0 points and every node locked.
  - Play with an empty page. In the console, set `game.kills = 3500` and call `game.hurtPlayer(1e9)`.
  - The end screen shows `+35 pontos de runa`. Reopen the end screen or wait a few frames: the points are still 35,
    not 70.
  - Press Continuar, then pick the champion.
  - Buy 2 precision runes: 11 points remain. Equip them.
  - Reload the page: the purchases and the page persist.
  - Press Jogar: the HUD stats reflect the equipped shards and runes.
- [ ] **Step 4:** Commit `feat: champion select and rune page screens, run flow with rune points`.
