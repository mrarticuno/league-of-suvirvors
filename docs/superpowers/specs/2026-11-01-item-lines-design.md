# Item lines: offers follow the build the player is making

## Why
Each champion has one fixed `build` (6 ids) and one `itemPool` ('ad' | 'ap'). Many champions are played several ways
(Teemo AP / on-hit / tank, Twitch AD / AP, Ezreal...), and the fixed pool forbids the other builds. Instead, every
champion gets the list of items real players buy on it, and the offers follow the line the player is choosing, so
any of the real builds can be completed.

## Goals
- Per champion, the items players buy on it (League of Graphs "Items" section), filtered to the items in the game.
- First item offer: one AD, one AP, one Tank item.
- From then on new-item offers follow the **proportion** of the types the player picked (2 AD + 1 Tank: about 2:1).
- A type the player never picked is not offered, even if it is the popular build (an AD Teemo never sees AP items),
  except after the player **declines** a list.
- "Recommended" tag: the most popular core build. Once the player takes an item outside it, the tag is gone for the
  rest of the run.

## Non-goals / anti-goals
- No change to boots (own slot, own flow), potions, blueprint, item levels or stats.
- Failure even if it works: AP items showing up for a player who took only AD without declining (unless the AD items of the list ran out); the tag pushing the
  core after the player left it.

## Data (approach A, chosen)
Approaches considered:
- **A (chosen)**: scrape with the user's Chrome (Claude extension) once per champion, commit a JSON. Re-run per patch.
  Costs the user's browser on each refresh.
- B: a build script that downloads the site. Bot protection blocks it; dropped.
- C: hand-written lists in each champion file, like `build` today. 15 files × 30+ ids with no popularity; dropped.

Source: `https://www.leagueofgraphs.com/champions/items/<champ>`, default filters (all roles, Platinum+, all regions).
The page is a set of `.lolg-panel`s; each row is `.lolg-table__row` with `data-sort-popularity`, and each item is an
`img[tooltip-var="item-<id>"]`. Used panels:
- **Items**: every row is one item and its popularity (Teemo: 36 rows, 31 in the game).
- **Core Build**: rows are 4-purchase sequences that include components (Scout's Slingshot > Statikk Shiv > Liandry's
  > Malignance). The **core** is the first (most popular) row, keeping only ids in `src/items.json` `items`, in order
  (Teemo: Statikk Shiv, Liandry's Torment, Malignance).

Files:
- `tools/lolgraphs/<champ>.json`: raw output of the browser snippet (`{ items: [[id, popularity]], core: [ids] }`,
  unfiltered), committed so the build step can be re-run without the browser.
- `tools/build_champion_items.py`: reads the raw files and `src/items.json`, drops ids not in `items` (components,
  boots, items not ported), writes `src/championItems.json`:
  `{ "patch": "16.21", "champions": { "<champ id>": { "items": [["<id>", <popularity>], ...], "core": ["<id>", ...] } } }`.
- The snippet is kept in the tool's docstring so the next patch is: open each page, run the snippet, save, run tool.

All 15 champions in `src/champions/index.ts` (champion ids map to the site's slug: `aurelionsol`, etc.).
Collection is the first implementation task: Claude drives the user's Chrome (the user authorized it), writes the
snippet, scrapes the 15 pages and commits the raw files before the offer code is written.

## Item types
Computed from stats (no hand list); an item can have several types:
- **AD**: any of `ad, as, crit, critDamage, armorPen, lethality` (the current `AD_STATS`).
- **AP**: any of `ap, magicPen, magicPenFlat`.
- **Tank**: any of `hp, armor, mr` (any defensive stat).

Consequences, accepted by the user: Liandry's / Rylai / Riftmaker are AP **and** Tank; Nashor's Tooth (AP + AS) and
Statikk Shiv are AD **and** AP; Wit's End is AD and Tank. Picking a hybrid counts for each of its types.

`ItemPool`, `poolsOf`, `Item.pools`, `ChampionDef.itemPool` and `ChampionDef.build` are removed.

## Offer rules
State per run: `count[type]` = number of owned slots (new picks; levelling an item does not count again) whose item
has that type. Derived from `g.slots`, nothing to store.

Candidates for new items: the champion's list only, minus owned items. Items not in the champion's list are never
offered.

1. **First item offer** (no slots): three new items, one per type AD / AP / Tank. Within a type, drawn weighted by
   popularity. The core's first item takes the slot of one of its types (so the recommended item is always there).
   An item can only fill one slot. A type with no candidate left: that card is the most popular remaining item of any
   type.
2. **Later offers** (3 cards, as today: levels of owned items below MAX_LEVEL and, while a slot is free, new items).
   Each new-item card draws a type with probability `count[type] / Σcount` (types with count 0 are out), then an item
   of that type weighted by popularity. When the picked types have no candidate left (an AD-only player owns every
   AD item of the list) and a slot is free, new-item cards come from the other types, weighted by popularity, with no
   decline needed (user's call).
3. **After a decline** (the player clicks "Decline items" on a list that had offers): the next offer has one new-item
   card from a type with `count == 0` (weighted by popularity across those types). Picking it makes that type
   count > 0, so it enters the proportion. Declining again repeats. With no zero-count type left, a decline changes
   nothing. (Claude's call:) the flag lasts for one list: it is set by the decline and cleared when the next list is
   shown, whatever the player takes. The zero-count card replaces one new-item card; the others follow rule 2.
4. Full inventory: only levels, as today.

## Recommended tag
- `onCore` = every owned item is in the champion's `core`. Derived from slots.
- While `onCore`: core items get the ×3 weight they have today and the best offer (`offerScore`, core items first,
  levelling before starting new ones) gets the "Recommended" tag and the "in build" note.
- Once an item outside the core is owned: no tag, no ×3, no note, until the run ends. Offers keep following the lines.
- The core has fewer than 6 items (Teemo: 3). Once the core is complete and `onCore`, the tag goes to levelling core
  items; new items get no tag.

## Constraints
- i18n: no new player-facing text is expected (`itemsel.recommended`, `itemsel.inBuild`, `levelup.declineItems`
  exist). Any new text is a key in the 4 locale files.
- Run save (`src/runSave.ts`): counts and `onCore` derive from slots; the "declined last list" flag goes in
  `RunSnapshot` (old saves without it load as `false`).
- Tests (`tests/items.test.ts`): types of known items (Liandry AP+Tank, Heartsteel Tank, Statikk AD+AP); first offer
  covers the three types and contains core[0]; an AD-only inventory never gets AP/Tank-only items without a decline while AD candidates remain, and gets them once they run out;
  a decline brings a zero-count type; off-core inventory gives no tag; every champion in `CHAMPIONS` has an entry in
  `championItems.json` with a non-empty core.

## Left to the builder
- The weighting between level-up cards and new-item cards (keep roughly today's balance).
- Function signatures (`rollOffers(slots, champItems, declined)` or similar) and where the decline flag lives on `Game`.
- Whether `tools/build_champion_items.py` is merged into `tools/build_items.py`.
