# Item evolution (replaces recipe combining)

## Why
Recipe combining merged items without the player asking, and components consumed by off-screen recipes kept granting
stats without showing in the inventory. Builds were hard to plan.

## Rules
- Level up offers 3 random **base items** (Espada Longa, Adaga, Partícula Brilhante, Cristal de Rubi, Couraça de Pano,
  Lágrima da Deusa, Capa da Agilidade). The player takes one as a new item, uses it to evolve, or skips all.
- A copy of a base can **evolve** one owned item of the same line one step; the player picks the slot and the branch.
  Keeping duplicates is allowed (e.g. two Adagas). Full inventory: only evolving is possible, and only bases that can
  evolve something are offered.
- Lines are fixed paths (`LINES` in `src/items.ts`). After the first branch the path narrows. Total copies needed is
  the path length (base included): Gume do Infinito 5; Força da Trindade, Colhedor de Essência, Espada do Rei Destruído,
  Mata-Cráquens, Rancor de Serylda, Cutelo Negro, Anjo Guardião 4; Fome Eterna, Lança de Shojin, Manamune,
  Coração Congelado 3.
- A slot only gives the stats of its current stage.
- Finished items are unique. A branch is blocked when its final item is owned, or reserved by another slot whose
  remaining paths all end in it. An item with no open branch is **locked**: stays in the slot, cannot evolve or be removed.
- Nothing can be discarded or sold.
- Same passive on several items (Lâmina Arcana: Fulgor, Força da Trindade, Colhedor de Essência) triggers once.
- The UI shows each line's full tree, which branches are blocked, and the copy cost of each final item.
- **Build complete**: 6 slots, each finished or locked. Level up then offers potions instead: vida (+20% max HP) or
  mana (+20% max mana).
- **Blueprint**: with the build complete, each kill has 1% to drop a blue scroll on the ground (max 1 per run).
  Picking it up turns a random finished item **Lendário**: +50% of its stats. Only 1 legendary item per run.
- Naming: in the UI, finished items are "completos"; "Lendário" is reserved for the blueprint upgrade.
