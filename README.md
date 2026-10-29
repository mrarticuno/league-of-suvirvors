<p align="center">
  <img src="docs/media/banner.png" alt="League of Survivors" width="100%">
</p>

<p align="center">
  <b>English</b> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <b>A 2.5D survivors-like for the browser, starring League of Legends champions.</b><br>
  Top-down view with the original LoL 3D models and animations. Survive the hordes, evolve your items and take down Baron Nashor at 20 minutes.
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-prototype-c8aa6e">
</p>

<p align="center">
  <img src="docs/media/ezreal.gif" alt="Ezreal fighting a horde" width="80%">
</p>

> The in-game UI is in Brazilian Portuguese.

## Gallery

| Samira (`?champ=samira`) | Baron Nashor (20:00) |
|---|---|
| ![Samira: Style rising to S, Blade Whirl and Inferno Trigger](docs/media/samira.gif) | ![Baron arena with telegraphed attacks](docs/media/baron.gif) |
| ![Samira with the Style gauge against the Rift Scuttler](docs/media/samira.jpg) | ![Baron's cone whip](docs/media/baron.jpg) |

| Level-up: item evolution | Rune page |
|---|---|
| ![Item choice with the evolution tree](docs/media/item-shop.jpg) | ![Rune page between runs](docs/media/rune-page.jpg) |

<sub>Logo and banner source: `docs/media/logo.html` (open it in Chromium and capture `#logo` / `#banner`). Screenshots are from the prototype running with locally generated assets.</sub>

## Running

```bash
pnpm install
pnpm dev        # http://localhost:5173 (Ezreal); /?champ=samira plays as Samira
```

The models are **not in the repository** (they are Riot assets). Generate them locally first (below).

## Asset pipeline (macOS, with LoL installed)

1. Tools: Python 3 and the .NET 8 SDK.
   ```bash
   python3 -m venv .venv-tools && .venv-tools/bin/pip install xxhash zstandard pillow pygltflib
   git clone https://github.com/Crauzer/lol2gltf && cd lol2gltf/src/lol2gltf
   # the csproj is pinned to win-x64: set RuntimeIdentifier to osx-arm64, turn off PublishReadyToRun and RestorePackagesWithLockFile
   dotnet publish -c Release -o ../../../l2g
   ```
2. Hash list (the game's `.bin` files reference textures/animations by xxh64 hash):
   ```bash
   curl -s https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt \
     | grep -E "assets/characters/(ezreal|samira|sru_|turret|inhibitor|nexus)" > assets-raw/hashes.filtered.txt
   ```
3. Extract from the WADs (`tools/extract_lol.py`) and convert to `.glb` (`tools/build_models.py`):
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt ezreal assets-raw/ezreal "$G/Champions/Ezreal.wad.client"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt samira assets-raw/samira "$G/Champions/Samira.wad.client"
   for c in sru_chaosminion{melee,ranged,siege,super} sru_orderminionmelee sru_krug sru_murkwolf sru_razorbeak sru_razorbeakmini sru_gromp sru_blue sru_red sru_riftherald sru_baron sru_crab sru_dragon sru_dragon_{air,fire,earth,water,hextech,chemtech}; do
     .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Maps/Shipping/Map11.wad.client" "$G/Maps/Shipping/Common.wad.client"
   done
   # SR structures (map scenery): the character folder is turret/inhibitor/nexus
   for c in turret inhibitor nexus; do
     .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Maps/Shipping/Map11.wad.client" "$G/Maps/Shipping/Common.wad.client"
   done
   .venv-tools/bin/python tools/build_models.py l2g/lol2gltf
   ```
   Output: `public/assets/models/<id>.glb` + `<id>.png`. The PNG is applied at runtime because `lol2gltf` only embeds `.tex/.dds`.
   The structures have a fixed line in `tools/build_models.py` (`sruap_orderturret|orderinhibitor|ordernexus`, `own_anm=False` because they are static scenery) and come out as `public/assets/models/sruap_*.glb|png`.
4. Map: terrain and rock textures, extracted from `Map11.wad.client`. First download the full CommunityDragon hash lists (`hashes.game.txt` and `hashes.bin{entries,fields,types,hashes}.txt` from `https://raw.communitydragon.org/data/hashes/lol/`) into `assets-raw/hashes/`: `textures` uses `hashes.game.txt` as its name table, and `pieces` needs the `.bin*` lists so `read_bin` can resolve the `.mapgeo` names.
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/build_map.py textures assets-raw/hashes/hashes.game.txt public/assets/map "$G/Maps/Shipping/Map11.wad.client"
   .venv-tools/bin/python tools/build_map.py pieces assets-raw/hashes/hashes.game.txt public/assets/map "$G/Maps/Shipping/Map11.wad.client"
   ```
   Output: `public/assets/map/tex/{ground_river,ground_lane,ground_jungle,ground_base,water}.png` (~400 px crops of the SR atlases) and `public/assets/map/pieces/rock_{a,b,c}.glb|png` (the three largest rock/cliff sections of `base.mapgeo`, normalized to 1 unit and scaled to cover the obstacle box).
   `pieces` is a limited `.mapgeo` v14 parser: if it is skipped or fails (different format version, missing WAD), the runtime draws dark boxes/cylinders from the layout obstacles. Nothing breaks.
5. Ability VFX: Ezreal's particle systems read from the skin `.bin`, with every texture and mesh they use. Uses the hash lists downloaded in step 4:
   ```bash
   for c in ezreal samira; do (cd tools && ../.venv-tools/bin/python build_vfx.py ../assets-raw/hashes $c ../public/assets/vfx/$c "$G"); done
   ```
   Generates `systems.json` (effects indexed by `ResourceResolver` keys, e.g. `Ezreal_Q_mis`), `spells.json` (missile speed/width/range) and the asset PNG/JSON files. `tools/read_bin.py` alone converts any `.bin` into JSON. The emitter runtime lives in `src/particles.ts`; `src/vfx.ts` only picks which system to play and where.

6. Sounds and music: Wwise banks (`.bnk`/`.wpk`) for Ezreal, the monsters, the HUD and the Map11 music. Needs `brew install vgmstream ffmpeg` and [wwiser](https://github.com/bnnm/wwiser):
   ```bash
   git clone --depth 1 https://github.com/bnnm/wwiser assets-raw/wwiser
   (cd tools && ../.venv-tools/bin/python build_audio.py ../assets-raw/wwiser/wwiser.py ../public/assets/sfx "$G")
   ```
   wwiser generates one `.txtp` per event, vgmstream renders it and ffmpeg converts it to mp3. Events are found by id (FNV-1 of the name; the names come from the characters' `.bin` files, the table is `BANKS` in the script). Random containers become up to 4 variations (`<key>_<n>.mp3`), picked at runtime. Output: `public/assets/sfx/*.mp3` + `sounds.json`. Without the folder, the game runs muted.
   Events not found (silent): minion deaths and the Ocean/Hextech/Chemtech dragon attacks. The music is the main SR event with no known name (id `3832820115`); each switch state becomes one track.

## Procedural map

The world has no edge and no invisible walls: `src/sessions.ts` describes the layout of a 6000×6000 session (`CHUNK`) and `src/map.ts` keeps a 3×3 window of chunks around the player (`WorldMap.ensureChunks`). Each call generates at most 2 new chunks and drops everything that leaves the window; fog (`THREE.Fog`, 5000–9500) hides the loaded edge.

Each chunk rolls a type when generated, with repeats allowed and no persistence (leaving and coming back can give another type):

- `river`: a river with walkable water banks and brush boxes on both banks.
- `lane`: 4 turrets in the corners.
- `jungle`: 2–7 rock walls; ~40% of them get a decorative rock.
- `base`: nexus in the center, inhibitor and 2–3 turrets around it.

Obstacles are **pure physics**: turrets, inhibitors and the nexus neither attack nor can be attacked (right click still only focuses real units) and do not block projectiles — missiles, the E blink and water pass over them. Only bodies (player and enemies) collide, sliding along the obstacle (`resolveCircle`); there is no pathfinding: enemies walk straight at Ezreal and go around whatever they touch.

The assets come from step 4 of the pipeline: one texture per chunk type (the water also scrolls its offset) and pieces loaded by `loadMapPieces()`. A missing piece, or one that fails to load, falls back to the obstacle's dark box/cylinder. Nothing breaks.

## Controls

| Action | Key |
|---|---|
| Move | Right click on the ground (hold to follow the cursor) or arrow keys |
| Focus target (with auto attack) | Right click on an enemy |
| Toggle auto attack | `T` |
| Manual attack (auto off) | Left click on an enemy |
| Abilities | `Q` `W` `E` `R` toward the cursor |
| Pick an upgrade | Click or `1`–`9` |
| Pause / toggle music and effects | `Esc` |

WASD is not used because it clashes with Q/W/E.

## Implemented rules

- **Ezreal true to LoL** (Meraki Analytics data): per-level stats with LoL's growth formula, attack windup of 18.75%, projectile at 2000 u/s, 175% crit.
  - **Passive (Rising Spell Force)**: +10% attack speed per ability hit, up to 5 stacks, lasts 6 s.
  - **Q**: −1.5 s on all cooldowns on hit.
  - **W**: marks the target; detonating it with an ability refunds mana.
  - **E**: 475 blink + homing projectile, prioritizing the marked target.
  - **R**: 1 s cast, passes through enemies, 50% damage to non-epic units.
- **Samira** (`?champ=samira`, Meraki Analytics data): 500 range, 175% crit.
  - **Passive (Daredevil Impulse)**: a hit of a different type than the previous one (shot, blade, Q, W, E, R) raises the Style grade by one (E→S, 6 s, +2–3.5% movement speed per grade). Attacks within 200 range use the blade: bonus magic damage (2–19 + 3.5–10.5% AD), up to doubled by the target's missing health; W, E and the Q slash also apply it.
  - **Q**: shot at the first enemy; with an enemy ahead within 340, a cone slash. Can crit (125%).
  - **W**: two area slashes (325), at the start and after 0.75 s; destroys enemy projectiles in the area. No basic attacks while spinning.
  - **E**: 600 dash toward the cursor, magic damage to everyone passed through, +20–40% attack speed for 5 s.
  - **R**: only at Style S with an enemy within 600. 10 volleys over 2 s against everyone around (25% vs. minions), can crit; −30% movement speed, consumes Style.
  - Not from LoL: Style counts any enemy; no Q explosives during E; no attack on immobilized targets (enemies are not affected by CC).
- **Two-step level-up**:
  1. One ability rank, by LoL's rule: basic abilities at levels 1/3/5/7/9, R at levels 6/11/16. The step is skipped when no rank is available.
  2. One item out of 3 rolled (or a potion, once the build is complete).
- **Items**: real Data Dragon data (pt-BR, icons), generated by `tools/build_items.py` into `src/items.json`. Full rules in `docs/superpowers/specs/2026-10-28-item-evolution-design.md`.
  - Only basic starting items are offered. A new copy can become a new item or evolve an item of the same line by one step; the player picks the slot and the branch (`LINES` in `src/items.ts`).
  - Finished items cost 3 to 5 copies of the basic item and are unique. Branches whose finished item you already own (or is reserved by another slot) are blocked; an item with no free branch is locked.
  - Inventory of at most 6 items; items cannot be discarded. Each offer shows the line's tree (what you have, what is blocked, the cost of each finished item).
  - Complete build (6 finished or locked items): level-ups offer a Health or Mana Potion (20% of max), and each kill has a 1% chance to drop a blueprint (blue scroll, 1 per run) that makes a random finished item Legendary (+50% stats).
  - Finished items: Ezreal's current builds (Trinity Force, Manamune, Spear of Shojin, Endless Hunger, Serylda's Grudge, Frozen Heart, Guardian Angel) and the on-hit/crit build (Kraken Slayer, Blade of The Ruined King, Infinity Edge, Essence Reaver, Black Cleaver).
  - Implemented passives: Spellblade (Sheen/Trinity/Essence Reaver), Awe (Manamune), Bring It Down (Kraken Slayer), Mist's Edge (Ruined King), crit damage (Infinity Edge), Carve (Black Cleaver), Rebirth (Guardian Angel), Winter's Caress (Frozen Heart), armor penetration, life steal and omnivamp.
  - Armor: physical damage (basic attack, Q, on-hit effects) is reduced by the enemy's armor. Magic damage (W, E, R) is not.
- **Ranged enemies**: fire straight-line skillshots aimed where Ezreal was, with limited range. They can be dodged.
- **Difficulty curve**: early on, 1 basic attack or 1 ability kills.
  - Health: base × `(1 + 0.08 × (level − 1)) × (1 + time / 900 s)`.
  - Damage: base × `(1 + time / 600 s)`.
  - Epic monsters have fixed health.
  - Tune in `enemyHpScale` / `enemyDamageScale` (`src/data.ts`).
- **XP**: absorbed automatically on kill.
- **Floating text**: damage dealt (white = physical, blue = magic, orange = crit), damage taken (red) and XP gained (purple).
- **Spawn director**: enemies per second = `0.45 + 0.04×(level−1) + time/450`.
  - That value is multiplied by 0.6–1.3 depending on the fraction of the last 20 s of enemies the player killed.
  - The number of living enemies is capped: `12 + 2×level + time/8`.
  - Tune in `DIRECTOR` (`src/data.ts`).
- **Horde**: every 2 min, a ring of `15 + 2×level` weak enemies closes around the player, with a 90° gap to escape. The warning shows 6 s before.
- **Progression (survivors style)**:
  - 0–5 min: minions.
  - From 3 min: raptors, wolves, krugs, gromp.
  - Bosses: Rift Scuttler (5:00), Dragon (10:00, element rolled among Mountain, Cloud, Ocean, Hextech, Infernal and Chemtech; buffs not implemented yet), Rift Herald (15:00), Baron Nashor (20:00).
  - Elites between bosses: Blue Sentinel (7:30), Red Brambleback (12:30), both together (17:30).
  - Tune in `EVENTS` (`src/data.ts`).
- **Baron Nashor (20:00)**: nearly impossible to kill (150k health). Killing him wins the run.
  - When he spawns, every other enemy dies and nothing else spawns (not even hordes).
  - A circular arena (radius 1500) closes around Ezreal and the Baron. You cannot walk out.
  - If Ezreal leaves (e.g. Arcane Shift over the wall), a tentacle pulls him back.
  - Abilities with cast time and a ground marker:
    - Ground circles: after 1 s, knock up and stun (up to ~500 damage, never kills).
    - A tentacle bursting from the ground where Ezreal was: kills.
    - Acid spit in a line: kills.
  - Near the Baron: 33% chance of a bite (swallows, instant, cannot be dodged). Otherwise, a cone whip: 75% of max health, never kills.
  - Tune in `BARON` (`src/data.ts`); behavior in `src/enemies/baron.ts`.

## Architecture (where to add content)

- **Champions** (`src/champion.ts`, `src/champions/`): a champion is a `ChampionDef` (base stats, skills with ranks/costs/cooldowns/animation/icon, animations, basic attack VFX) plus a `kit`, created each run, which resolves the skills and keeps their quirks (stacks, marks...). `Game` handles the generic parts: movement, basic attack, cooldowns, mana, items and the damage pipeline.
  - New champion: create `src/champions/<name>.ts` (template: `ezreal.ts`) and register it in `src/champions/index.ts`. Sounds follow `<id>_auto`, `<id>_Q`, `<id>_death`...
  - Kit hooks: `cast` (required), `castStart`, `attackSpeedBonus`, `onDamage` (extra magic damage before mitigation, e.g. detonating the W mark), `update`, `dispose`, `hud`.
  - Projectiles: `game.spawnMissile(vfx, from, to, { hit, target | pierce, onHit, ... })`. Without `onHit`, the default impact applies VFX, sound and damage.
- **Item passives** (`src/itemEffects.ts`): each entry has the description and, if implemented, a hook factory (`onHit`, `onAttack`, `onCast`, `onPhysical`, `tick`, `onLethal`, `bonusAd`, `enemyAttackCooldown`). `unique` + `rank` reproduce LoL's UNIQUE passives (e.g. Spellblade: only the best one works). Stats stay in `items.json`.
- **Enemies** (`src/data.ts` + `src/enemies/`): a regular enemy only needs an `EnemyDef`. Custom behavior registers an AI in `AI`; timeline events with special rules (rolled dragon, Baron arena) register a spawner in `SPAWNERS`. `src/hazards.ts` has the ground markers and eruptions for bosses.
- **Performance**: enemies live in a spatial grid (`src/spatial.ts`), so unit collision, targeting, projectiles and auras only query neighbors (collision used to be O(n²)). Per-frame lists are filtered in place (`compact`), spawn/kill windows are amortized O(1), the map rebuilds nothing while the player stays in the same chunk, and the HUD only writes to the DOM when a value changes. Enemies far from the champion update their animation every 3 frames.

## Known limitations / next steps

- Particles: not implemented: `VfxPrimitiveRay`, `VfxPrimitiveAttachedMesh` (meshes attached to the skeleton, e.g. the E avatar), force fields (`fieldCollectionDefinition`) and `FlexShapeDefinition`. Cast effects attached to bones come out of a fixed point at the hand. `blendMode` missing/4 = additive, 1 = alpha (inferred from the textures, not documented).
- The `.glb` files are heavy (Ezreal 29 MB, Baron 45 MB, uncompressed). Next step: `gltf-transform resample/quantize` and removing unused clips (recall, dance).
- Each enemy is a SkinnedMesh with its own mixer, capped at 220 alive. For bigger hordes: texture-baked animation + instancing.
- Dragons: animations shared from `sru_dragon`. Infernal and Mountain use the Cloud mesh (`sru_dragon_air`) with their own texture, as in the game (`EnemyDef.mesh`).

## Legal notice

Non-commercial fan project, under Riot Games' "Legal Jibber Jabber" policy. League of Legends and all its assets belong to Riot Games, Inc. Do not distribute the extracted models.
