# Item Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Level-up item offers come from each champion's real item list (League of Graphs) and follow, in proportion, the item types (AD / AP / Tank) the player picks; "Recommended" marks the most popular core only while the player stays on it.

**Architecture:** Raw scrapes in `tools/lolgraphs/` are turned by a Python tool into `src/championItems.json`. `src/items.ts` gets item types from stats and a new `rollOffers` driven by the champion's list, the owned slots and a one-list "declined" flag kept on `Game`. `ChampionDef.build` / `itemPool` go away; `ui.ts` reads the champion's entry instead.

**Tech Stack:** TypeScript, Vite, Vitest, Python 3 (tools), Chrome via the Claude extension (scraping).

**Spec:** `docs/superpowers/specs/2026-11-01-item-lines-design.md`

## Global Constraints

- Types from stats: AD = any of `ad, as, crit, critDamage, armorPen, lethality`; AP = any of `ap, magicPen, magicPenFlat`; Tank = any of `hp, armor, mr`. An item can have several types.
- Only items of the champion's list are ever offered as new items.
- No change to boots, potions, blueprint, item levels or stats.
- All player-facing text is an i18n key in the 4 locales (`en`, `pt`, `es`, `zh`); no new text is expected.
- Code identifiers and comments in English.
- Run `npx vitest run` green before every commit.

## Review Focus

1. A champion whose list has no item of some type, or fewer than 3 candidates: the first offer has no duplicates and no crash (test in Task 3).
2. A core id missing from the champion's "Items" panel: it must still be offerable (tool adds it; test in Task 1).
3. The list runs out while slots are free: only level-ups, no crash, no empty card (test in Task 3).
4. Declining with a full inventory: nothing changes, levels only (test in Task 3).
5. An old run save without the declined flag loads with the flag `false` (test in Task 4).

---

### Task 1: Champion item data

**Files:**
- Create: `tools/build_champion_items.py`, `tools/lolgraphs/<champ>.json` (15 files), `src/championItems.json`
- Test: `tests/championItems.test.ts`

**Interfaces:**
- Produces: `src/championItems.json` = `{ "patch": "16.21", "champions": { "<champ id>": { "items": [["<id>", <popularity 0..1>], ...], "core": ["<id>", ...] } } }`, items sorted by popularity desc, every id a key of `src/items.json` `items`, every core id also in `items`.

- [ ] **Step 1: Scrape the 15 champions with the user's Chrome**

Champion ids = keys of `CHAMPIONS` in `src/champions/index.ts`; URL `https://www.leagueofgraphs.com/champions/items/<id>`. On each page run this snippet (javascript_tool) and save the returned JSON verbatim to `tools/lolgraphs/<id>.json`:

```js
const panel = (t) => [...document.querySelectorAll('.lolg-panel')].find((p) => p.querySelector('.lolg-panel__title')?.textContent.trim() === t);
const ids = (row) => [...row.querySelectorAll('img[tooltip-var]')].map((i) => i.getAttribute('tooltip-var').replace('item-', ''));
JSON.stringify({
  items: [...panel('Items').querySelectorAll('.lolg-table__row')].map((r) => [ids(r)[0], +r.dataset.sortPopularity]),
  core: ids(panel('Core Build').querySelector('.lolg-table__row')),
});
```

Close the tab when done. Check: 15 files, each with a non-empty `items` and a 4-id `core`.

- [ ] **Step 2: Write `tools/build_champion_items.py`**

Usage `python tools/build_champion_items.py <patch>`. For each `tools/lolgraphs/*.json`: keep `items` ids present in `src/items.json` `items`; keep `core` ids present there, in order; append any kept core id missing from `items` with popularity `0`. Write `src/championItems.json` (indent 1, like `items.json`). The module docstring holds the snippet above and the refresh steps. Exit non-zero if a champion ends with an empty `core`.

- [ ] **Step 3: Run it**

Run: `python tools/build_champion_items.py 16.21`
Expected: writes `src/championItems.json` with 15 champions; Teemo's core is `["3087", "6653", "3118"]`.

- [ ] **Step 4: Write `tests/championItems.test.ts`**

```ts
it('every champion has a list of known items and a core from it', () => {
  for (const id of Object.keys(CHAMPIONS)) {
    const c = data.champions[id as keyof typeof data.champions];
    expect(c, id).toBeDefined();
    expect(c.core.length, id).toBeGreaterThan(0);
    for (const [item] of c.items) expect(ITEMS[item], `${id} ${item}`).toBeDefined();
    for (const item of c.core) expect(c.items.some(([i]) => i === item), `${id} core ${item}`).toBe(true);
  }
});
```

- [ ] **Step 5: Run `npx vitest run tests/championItems.test.ts`** — Expected: PASS.

- [ ] **Step 6: Commit** — `feat(items): per-champion item lists from League of Graphs`

### Task 2: Item types

**Files:**
- Modify: `src/items.ts` (replace `ItemPool`, `poolsOf`, `Item.pools`)
- Test: `tests/items.test.ts` (replace the `pools:` test)

**Interfaces:**
- Produces: `export type ItemType = 'ad' | 'ap' | 'tank'`; `export const ITEM_TYPES: readonly ItemType[] = ['ad', 'ap', 'tank']`; `Item.types: ItemType[]` (in `ITEM_TYPES` order); `export function typesOf(s: ItemStats): ItemType[]`.

- [ ] **Step 1: Failing test**

```ts
it('types come from stats; hybrids have several', () => {
  expect(ITEMS['6653'].types).toEqual(['ap', 'tank']); // Liandry's
  expect(ITEMS['3084'].types).toEqual(['tank']); // Heartsteel
  expect(ITEMS['3087'].types).toEqual(['ad', 'ap']); // Statikk Shiv
  expect(ITEMS['3115'].types).toEqual(['ad', 'ap']); // Nashor's (AS)
  expect(ITEMS['3091'].types).toEqual(['ad', 'tank']); // Wit's End
  expect(ITEMS['3089'].types).toEqual(['ap']); // Rabadon's
  for (const it of Object.values(ITEMS)) expect(it.types.length, it.id).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run, expect FAIL** (`types` undefined).
- [ ] **Step 3: Implement `typesOf`** with the Global Constraints stat lists; drop `ItemPool`/`poolsOf`/`pools`. `ChampionDef.itemPool` (src/champion.ts) still imports `ItemPool`: leave `rollOffers` and the champion field compiling by keeping a temporary `type ItemPool = 'ad' | 'ap'` export until Task 4 removes it.
- [ ] **Step 4: Run `npx vitest run tests/items.test.ts`** — Expected: new test PASS (old `rollOffers` tests still using `pools` are rewritten in Task 3; delete the `pools` assertions from the first `rollOffers` test now).
- [ ] **Step 5: Commit** — `feat(items): AD/AP/Tank item types from stats`

### Task 3: Offers follow the player's lines

**Files:**
- Modify: `src/items.ts` (`rollOffers`, `offerScore` docs; add `CHAMP_ITEMS`, `onCore`)
- Test: `tests/items.test.ts` (rewrite the `rollOffers` describe; keep the `offerScore` test with `core`)

**Interfaces:**
- Consumes: `ItemType`, `ITEM_TYPES`, `Item.types` (Task 2); `src/championItems.json` (Task 1).
- Produces:
  - `export interface ChampItems { items: readonly (readonly [string, number])[]; core: readonly string[] }`
  - `export const CHAMP_ITEMS: Record<string, ChampItems>` (from the JSON's `champions`)
  - `export const onCore = (slots: Slot[], core: readonly string[]) => boolean` — every owned id is in `core` (true for no slots)
  - `export function rollOffers(slots: Slot[], champ: ChampItems, declined = false, count = 3): Offer[]`
  - `offerScore(o, slots, core)` keeps its current signature and scores.

Rules (`cand` = champ items not owned, only while `slots.length < MAX_ITEMS`; `pop(c)` its popularity; `count[t]` = owned slots whose item has type `t`):

1. **No slots:** for each type in `ITEM_TYPES` order fill one card: core[0] takes the first of its types; every other type draws from `cand` with that type, not yet chosen, weighted by `pop`; a type with no such candidate takes the most popular unchosen candidate of any type. Return up to `count` distinct cards. (Treat `pop` 0 as 0.001 so zero-popularity items can still be drawn.)
2. **Otherwise**, candidates as today: levels of owned slots below `MAX_LEVEL` with `w = 2`. Eligible types `E` = types with `count > 0` that have a `cand`; if `E` is empty, `E` = every type that has a `cand` (the list of the picked types ran out). `share(t) = count[t] / Σ_{E} count`, or `1 / |E|` when that sum is 0. Each `cand` `c` with a type in `E` gets `w(c) = N · Σ_{t ∈ types(c) ∩ E} share(t) · pop(c) / Σ_{c' ∈ cand with t} pop(c')`, `N` = number of such candidates (keeps today's level/new balance). While `onCore`, any candidate in `core` gets `w *= 3`. Draw `count` without replacement, as today.
3. **`declined` and a free slot:** `Z` = types with `count == 0` that have a `cand` not already drawn. If `Z` is non-empty, draw one `cand` having a type in `Z` and no type with `count > 0` (if none, any `cand` with a type in `Z`), weighted by `pop`, and put it in place of the last `new` offer drawn, else of the last offer, else push it.

- [ ] **Step 1: Failing tests** — use a synthetic `ChampItems` so tests don't depend on the patch:

```ts
const champ: ChampItems = {
  items: [['6653', 0.24], ['3087', 0.22], ['3118', 0.19], ['4645', 0.08], ['3153', 0.01], ['3302', 0.01], ['6672', 0.01], ['3084', 0.01], ['2504', 0.01]],
  core: ['3087', '6653', '3118'],
};
const isOnly = (id: string, t: ItemType) => ITEMS[id].types.length === 1 && ITEMS[id].types[0] === t;

it('first offer: one card per type, the first core item among them, no duplicates', () => {
  for (let i = 0; i < 50; i++) {
    const o = rollOffers([], champ);
    expect(o).toHaveLength(3);
    expect(new Set(o.map((x) => x.id)).size).toBe(3);
    expect(o.map((x) => x.id)).toContain('3087');
    for (const t of ITEM_TYPES) expect(o.some((x) => ITEMS[x.id].types.includes(t)), t).toBe(true);
  }
});
it('first offer with a list missing a type still gives distinct cards', () => {
  const o = rollOffers([], { items: [['3089', 0.5], ['4645', 0.3]], core: ['3089'] });
  expect(o.map((x) => x.id).sort()).toEqual(['3089', '4645']);
});
it('an AD-only inventory never gets items without AD while AD candidates remain', () => {
  for (let i = 0; i < 100; i++) for (const o of rollOffers(slots('3153'), champ)) expect(ITEMS[o.id].types).toContain('ad');
});
it('once the AD candidates run out, other types are offered without a decline', () => {
  const own = slots('3153', '3302', '6672', '3087'); // every AD item of the list
  const ids = new Set(Array.from({ length: 50 }, () => rollOffers(own, champ)).flat().filter((o) => o.kind === 'new').map((o) => o.id));
  expect(ids.size).toBeGreaterThan(0);
  for (const id of ids) expect(ITEMS[id].types).not.toContain('ad');
});
it('a decline brings one card of a type never picked', () => {
  for (let i = 0; i < 50; i++) {
    const o = rollOffers(slots('3153'), champ, true);
    expect(o.filter((x) => x.kind === 'new' && !ITEMS[x.id].types.includes('ad'))).toHaveLength(1);
  }
});
it('declining with a full inventory only levels', () => {
  const full = slots('6653', '3087', '3118', '4645', '3153', '3302');
  for (const o of rollOffers(full, champ, true)) expect(o.kind).toBe('level');
});
it('an exhausted list with free slots only levels', () => {
  const own = slots(...champ.items.map(([id]) => id).slice(0, 5));
  const small: ChampItems = { items: champ.items.slice(0, 5), core: champ.core };
  for (const o of rollOffers(own, small, true)) expect(o.kind).toBe('level');
});
it('picks follow the proportion of the types owned', () => {
  // 2 AD + 1 Tank owned: new cards with AD outnumber new Tank cards without AD; AP-only never shows
  const own = slots('3153', '3302', '3084');
  const news = Array.from({ length: 400 }, () => rollOffers(own, champ)).flat().filter((o) => o.kind === 'new');
  const ad = news.filter((o) => ITEMS[o.id].types.includes('ad')).length;
  const tank = news.filter((o) => ITEMS[o.id].types.includes('tank') && !ITEMS[o.id].types.includes('ad')).length;
  expect(ad).toBeGreaterThan(tank);
  expect(news.some((o) => isOnly(o.id, 'ap'))).toBe(false);
});
it('onCore: every owned item is in the core', () => {
  expect(onCore([], champ.core)).toBe(true);
  expect(onCore(slots('6653', '3087'), champ.core)).toBe(true);
  expect(onCore(slots('6653', '3153'), champ.core)).toBe(false);
});
```

Keep the existing "full inventory only levels / never past max" test, calling `rollOffers(full, champ)`; rename the `offerScore` test's `build` to `core`.

- [ ] **Step 2: Run `npx vitest run tests/items.test.ts`** — Expected: FAIL (`ChampItems`/`onCore` not exported).
- [ ] **Step 3: Implement** per the rules above.
- [ ] **Step 4: Run** — Expected: PASS. (`ui.ts` still calls the old signature: `npx tsc --noEmit` may fail until Task 4; tests run through Vitest only.)
- [ ] **Step 5: Commit** — `feat(items): offers follow the item types the player picks`

### Task 4: Wire into the game

**Files:**
- Modify: `src/ui.ts:343-370` (`itemStep`), `src/ui.ts:~603` (`itemCard` `why`), `src/game.ts` (`declinedItems` field, `reset()`, `RunSnapshot`, `snapshot()`), `src/champion.ts:155-158` (remove `itemPool`, `build`), the 15 `src/champions/*.ts` (remove `itemPool:` / `build:` lines and the comment above `build`), `src/items.ts` (remove temporary `ItemPool`)
- Test: `tests/runSave.test.ts`

**Interfaces:**
- Consumes: `CHAMP_ITEMS`, `rollOffers`, `onCore`, `offerScore` (Task 3).
- Produces: `Game.declinedItems: boolean` (false after `reset()`), saved in `RunSnapshot.declinedItems?: boolean`.

- [ ] **Step 1: Failing test** in `tests/runSave.test.ts`: a snapshot JSON without `declinedItems` passes `loadRun`, and after `g.reset(); g.restore(state)` `g.declinedItems` is `false`; a snapshot with `declinedItems: true` restores `true`. (Follow how the file already builds a snapshot.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**
  - `game.ts`: field `declinedItems = false`, reset in `reset()`, written in `snapshot()`; `restore` already `Object.assign`s it.
  - `itemStep`: `const champ = CHAMP_ITEMS[g.champ.id]`; `const offers = rollOffers(g.slots, champ, g.declinedItems); g.declinedItems = false;` `continue.onclick` sets `g.declinedItems = offers.some((o) => o.kind === 'new')` before `done()`. `best` is computed only when `onCore(g.slots, champ.core)` and is shown only if `champ.core.includes(best.id)`; else `null`.
  - `itemCard` `why`: `best && CHAMP_ITEMS[g.champ.id].core.includes(o.id)` (best is already null off core).
  - Remove `build`/`itemPool` from `ChampionDef` and all champions; `npx tsc --noEmit` clean.
- [ ] **Step 4: Run `npx vitest run && npx tsc --noEmit`** — Expected: all PASS, no type errors.
- [ ] **Step 5: Play check** — start Vite on a free port (`npx vite --port 5199`), play Teemo to the first item offer (headless: step `game.update` by hand per memory note): 3 cards, Statikk tagged "Recommended". Take a BotRK: next offers only items with AD, no tag. Decline once: next list has one non-AD card. Stop Vite (`pkill -f "vite.js --port 5199"`).
- [ ] **Step 6: Commit** — `feat(items): level-up offers use the champion's item lines`
