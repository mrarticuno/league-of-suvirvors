<p align="center">
  <img src="docs/media/banner.png" alt="League of Survivors" width="100%">
</p>

<p align="center">
  <b>English</b> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <b>A 2.5D survivors-like for the browser, starring League of Legends champions.</b><br>
  Top-down view with the original LoL 3D models and animations. Survive the hordes, level up your items and take down Baron Nashor at 20 minutes.
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-prototype-c8aa6e">
</p>

<p align="center">
  <a href="https://league-of-survivors.gabriel-m-lyra.workers.dev"><b>▶ Play the demo</b></a>
</p>

<p align="center">
  <img src="docs/media/ezreal.gif" alt="Ezreal fighting a horde" width="80%">
</p>

> The game is in English, Portuguese, Spanish and Simplified Chinese, picked from the browser language.

## Gallery

| Champion select | Rune page |
|---|---|
| ![Champion select with Ezreal's splash art and kit](docs/media/champion-select.jpg) | ![Rune page: Precision + Sorcery with shards](docs/media/rune-page.jpg) |

| Level-up: abilities | Level-up: items |
|---|---|
| ![Ability cards with damage, cooldown and a recommendation](docs/media/skill-pick.jpg) | ![Item cards with the level, stats now and after the pick, and the passive](docs/media/item-shop.jpg) |

| Samira | Baron Nashor (20:00) |
|---|---|
| ![Samira fighting a horde around the Rift Scuttler](docs/media/samira.gif) | ![Baron arena with telegraphed attacks](docs/media/baron.gif) |
| ![Samira with the Style gauge against the Rift Scuttler](docs/media/samira.jpg) | ![Ezreal dodging Baron's whip](docs/media/baron.jpg) |

| Victory | Phone (touch controls) |
|---|---|
| ![Baron falls: cinematic and victory screen](docs/media/victory.gif) | ![Touch HUD with joystick and skill buttons in landscape](docs/media/mobile.jpg) |

<sub>Logo and banner source: `docs/media/logo.html` (open it in Chromium and capture `#logo` / `#banner`). Screenshots are from the prototype running with locally generated assets.</sub>

## Running

```bash
pnpm install
pnpm dev        # http://localhost:5173 (pick the champion on the first screen)
```

The models are **not in the repository** (they are Riot assets). Generate them locally first (below).

## Asset pipeline (macOS, with LoL installed)

1. Tools: Python 3 and the .NET 8 SDK (without admin rights: `curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir ~/.dotnet`, then call `~/.dotnet/dotnet`). `l2g/` is git-ignored: build it once and keep it.
   ```bash
   python3 -m venv .venv-tools && .venv-tools/bin/pip install xxhash zstandard pillow pygltflib
   git clone https://github.com/Crauzer/lol2gltf && cd lol2gltf/src/lol2gltf
   # the csproj is pinned to win-x64: set RuntimeIdentifier to osx-arm64, turn off PublishReadyToRun and RestorePackagesWithLockFile
   dotnet publish -c Release -o ../../../l2g
   ```
2. Hash list (the game's `.bin` files reference textures/animations by xxh64 hash):
   ```bash
   curl -s https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt \
     | grep -E "assets/characters/(ezreal|samira|brand|aphelios|sru_|turret|inhibitor|nexus)" > assets-raw/hashes.filtered.txt
   ```
3. Extract from the WADs (`tools/extract_lol.py`) and convert to `.glb` (`tools/build_models.py`):
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt ezreal assets-raw/ezreal "$G/Champions/Ezreal.wad.client"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt samira assets-raw/samira "$G/Champions/Samira.wad.client"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt brand assets-raw/brand "$G/Champions/Brand.wad.client"
   # Aphelios and Crescendum's sentry (a character of its own in the same WAD)
   for c in aphelios apheliosturret; do .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Champions/Aphelios.wad.client"; done
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
   for c in ezreal samira brand aphelios; do (cd tools && ../.venv-tools/bin/python build_vfx.py ../assets-raw/hashes $c ../public/assets/vfx/$c "$G"); done
   ```
   Generates `systems.json` (effects indexed by `ResourceResolver` keys, e.g. `Ezreal_Q_mis`), `spells.json` (missile speed/width/range) and the asset PNG/JSON files. `tools/read_bin.py` alone converts any `.bin` into JSON. The emitter runtime lives in `src/particles.ts`; `src/vfx.ts` only picks which system to play and where.

6. Sounds and music: Wwise banks (`.bnk`/`.wpk`) for Ezreal, the monsters, the HUD and the Map11 music. Needs `brew install vgmstream ffmpeg` and [wwiser](https://github.com/bnnm/wwiser):
   ```bash
   git clone --depth 1 https://github.com/bnnm/wwiser assets-raw/wwiser
   (cd tools && ../.venv-tools/bin/python build_audio.py "$PWD/../assets-raw/wwiser/wwiser.py" ../public/assets/sfx "$G")
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
- **Samira** (Meraki Analytics data): 500 range, 175% crit.
  - **Passive (Daredevil Impulse)**: a hit of a different type than the previous one (shot, blade, Q, W, E, R) raises the Style grade by one (E→S, 6 s, +2–3.5% movement speed per grade). Attacks within 200 range use the blade: bonus magic damage (2–19 + 3.5–10.5% AD), up to doubled by the target's missing health; W, E and the Q slash also apply it.
  - **Q**: shot at the first enemy; with an enemy ahead within 340, a cone slash. Can crit (125%).
  - **W**: two area slashes (325), at the start and after 0.75 s; destroys enemy projectiles in the area. No basic attacks while spinning.
  - **E**: 600 dash toward the cursor, magic damage to everyone passed through, +20–40% attack speed for 5 s.
  - **R**: only at Style S with an enemy within 600. 10 volleys over 2 s against everyone around (25% vs. minions), can crit; −30% movement speed, consumes Style.
  - Not from LoL: Style counts any enemy; no Q explosives during E; no attack on immobilized targets (not implemented yet).
- **Brand** (Meraki Analytics data and the skin bins): the first AP champion; 550 range. Every particle system of his kit is used (body flames, Ablaze marks, detonation ring and blast, every cast/missile/impact).
  - **Passive (Blaze)**: abilities apply Ablaze (up to 3 stacks, 4 s): a burn of 2% max health + 8–48 (level) + 5% AP per stack. The 3rd stack primes a ring that explodes after 2 s (radius 475): 8–12% max health (+2% per 100 AP, capped at 270–525) + 30–150 + 20% AP, and ablazes everyone hit. A detonated enemy holds at most 1 stack for 4 s. A kill by an ability or of an ablazed enemy restores 20–40 mana (once per second from minions and small monsters, always from elites and epics).
  - **Q**: fireball at the first enemy hit; stuns an ablazed target for 1.5 s.
  - **W**: after 0.627 s, area damage (260) at the target point; +25% against ablazed enemies.
  - **E**: targeted blast that spreads its damage to enemies within 300 of the target (600 if it was ablazed).
  - **R**: fireball that bounces up to 4 times (600), an ablazed enemy first; slows ablazed enemies 30–60% for 0.25 s.
  - Not from LoL (mana balance for hordes): costs Q 40, W/E 45–65, R 80; the burn and the detonation have a flat part and the detonation works on any enemy; the burn ticks every 0.5 s; R never bounces back to Brand.
- **Aphelios** (client spell data from `aphelios.bin`, Meraki Analytics for base stats): 550 range. Five weapons with their own HUD: the main weapon's icon and Moonlight next to the abilities, Q = the main weapon's ability (named after the off-hand: e.g. Resurgent Moonshot), W = the off-hand and its Moonlight, E = the next weapon, the reserve queue above the slots.
  - **Passive (The Hitman and the Seer)**: starts with Calibrum (main) and Severum (off-hand), Gravitum, Infernum and Crescendum in reserve. 50 Moonlight per weapon: 1 per attack, 10 per Q (less than 10 left: the Q takes the rest). An empty main weapon goes to the end of the queue and the next one is assembled (no Phase for 1 s, its Q on at least 1.5 s cooldown). Skill points buy stats instead of ranks (Q +4 bonus AD, W +9% attack speed, E +4.5 lethality, rank 6 at level 9 at the earliest); Q unlocks at level 2, W and E at 1, R ranks up on its own at 6/11/16.
  - **Weapons**: Calibrum +100 range, ability hits mark for 4.5 s; the next attack on a mark (up to 1800 away) uses the off-hand weapon and pops every mark for 15 + 15% bonus AD each. Severum strikes at once and heals 2–7.1% of the damage (×2.5 from abilities); overheal becomes a shield (10–140 + 6% max health, 30 s). Gravitum slows 30% decaying to 10% (2.5 s). Infernum deals 110% AD and splits into 4 bolts behind the target (6 on crit, wider), 75%/100% (level 9) of the damage, 30% of that vs. minions. Crescendum is thrown and comes back (no attacks until caught, then the attack timer resets); each catch adds a chakram (up to 20, 5 s): +15% AD for the first, down to +5% each.
  - **Q (by main weapon, 60 mana, numbers by level 1–13)**: Moonshot (70–160 + 42–60% bonus AD + 100% AP, 1450 range, marks); Onslaught (1.75 s, 6 attacks +2 per 100% bonus AS alternating off-hand and Severum, 20–41% AD each, on-hit at 25%, +25% movement speed); Binding Eclipse (only with a Gravitum target: 50–140 + 32–50% bonus AD + 70% AP magic damage and 1 s root on every slowed enemy); Duskwave (40° cone of 650: 20–110 + 15–21% bonus AD + 70% AP, then an off-hand attack on each enemy hit); Sentry (thrown within 475, arms after 0.35 s, lasts 20 s or 4 s once an enemy is within 500, attacks with the off-hand weapon at Aphelios' attack speed for 35–125 + 34–52% bonus AD + 50% AP).
  - **W (Phase)**: swaps main and off-hand; each weapon keeps its own Q cooldown.
  - **R (Moonlight Vigil)**: a beam (1300) stops on the first enemy and blasts 300 around for 125/175/225 + 20% bonus AD + 100% AP, then an attack of the main weapon falls on each target: Calibrum marks for 50/80/110, Severum heals 250/350/450, Gravitum slows 99% (Binding Eclipse roots it 1.35 s), Infernum +50/100/150 + 25% bonus AD and a ring of bolts, Crescendum +5 chakrams plus one per target.
  - Not from LoL: what targets champions targets any enemy (the R beam stops on the first enemy, Severum's R heal and Crescendum's chakram refresh); enemies do not attack the sentry (it lasts its timer).
- **Two-step level-up**:
  1. One ability rank, by LoL's rule: basic abilities at levels 1/3/5/7/9, R at levels 6/11/16 (Aphelios: stat points, see above). The step is skipped when no rank is available.
  2. One item out of 3 rolled (or a potion, once the build is complete).
- **Items**: real Data Dragon data (stats, names, icons), generated by `tools/build_items.py` into `src/items.json`; passives in `src/itemPassives/`.
  - No recipes: a level-up offers a finished legendary item or one more level for an item you own, like the weapons of a survivors game. Inventory of at most 6 items; items cannot be discarded.
  - Every item has 5 levels. Stats grow from 40% (level 1) to 100% (level 5); the passive unlocks at level 3 at 60% strength, 80% at level 4, 100% at level 5. Manamune, Archangel's Staff and Winter's Approach gain their transformed passive (Muramana, Seraph's Embrace, Fimbulwinter) at level 5.
  - Pool: every Summoner's Rift legendary except items with an active (Zhonya's, Youmuu's, the Hydras...), support items, anti-heal items (Mortal Reminder, Chempunk, Morellonomicon; Thornmail keeps only its reflect) and passives that need vision or champion shields (Umbral Glaive, Serpent's Fang). AD champions get attack items, AP champions ability power items, both get tanks and hybrids.
  - Passives adapted to hordes: "champion" triggers become elite/epic monster kills; spell shields block the next damage taken.
  - Recommended build per champion (OP.GG, patch 16.21): offered three times as often and tagged "Recommended". Ezreal: Trinity Force, Manamune, Spear of Shojin, Serylda's Grudge, Endless Hunger, Guardian Angel. Samira: The Collector, Infinity Edge, Lord Dominik's Regards, Immortal Shieldbow, Bloodthirster, Guardian Angel. Brand: Blackfire Torch, Rylai's, Liandry's, Shadowflame, Rabadon's, Void Staff. Aphelios: The Collector, Infinity Edge, Lord Dominik's Regards, Runaan's Hurricane, Guardian Angel, Bloodthirster.
  - Complete build (6 items at level 5): level-ups offer a Health or Mana Potion (20% of max), and each kill has a 1% chance to drop a blueprint (blue scroll, 1 per run) that makes a random item Legendary (+50% stats).
  - Resistances: physical damage is reduced by the enemy's armor (armor penetration, lethality), magic damage by its magic resist (magic penetration; monsters have half their armor as MR, minions none). Ranged enemies' projectiles deal magic damage (reduced by your MR), melee hits physical damage.
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
  - New champion: create `src/champions/<name>.ts` (templates: `ezreal.ts`; `brand.ts` for an AP mage with damage over time and per-enemy marks) and register it in `src/champions/index.ts`. Sounds follow `<id>_auto`, `<id>_Q`, `<id>_death`... Step-by-step guide: `.claude/skills/creating-champions/SKILL.md`.
  - Kit hooks: `cast` (required), `castStart`, `castAnim`, `canCast`, `attackSpeedBonus`/`moveSpeedBonus`, `disarmed`, `meleeAuto`, `onDamage` (extra magic damage before mitigation, e.g. detonating the W mark), `onKill` (e.g. Blaze's mana on kills), `onDealt` (damage after mitigation, e.g. Severum's heal), `update`, `dispose`, `hud`, `gauge`. Champions with more than one form (Aphelios' weapons): `stat` (own stats, e.g. points bought), `attackTarget`/`attackStart`/`basicAttack` (target, clip, sound and windup of the basic attack, firing it), `moveAnims`, `cooldownBase`/`castTime` (per form), `skillView` (slot icon, name and badge) and `tray` (small icons above the slots).
  - `ChampionDef` extras: `idleVfx` (systems riding bones all run long, e.g. Brand's flames), `vfx.death`, `scale` (model size), `itemPool: 'ap'` for mages (skills scale with `apRatio`), `build` (the 6 recommended legendaries from a build site, offered more often and tagged on level up), `rankLevels` (level of each rank), `autoRank` (skills ranked without a point) and `SkillDef.unlockLevel` (castable from a level, whatever its ranks).
  - Crowd control on enemies: `game.slow(e, pct, s)`, `game.stunEnemy(e, s)` and `game.rootEnemy(e, s)` (no moving, still attacks) (generic loop only; boss AIs ignore them).
  - Projectiles: `game.spawnMissile(vfx, from, to, { hit, target | pierce, onHit, ... })`. Without `onHit`, the default impact applies VFX, sound and damage.
- **Item passives** (`src/itemEffects.ts` hooks, entries in `src/itemPassives/ad.ts`, `ap.ts`, `tank.ts`): each entry has the description (max-level numbers) and a hook factory `effect(g, power)` (`onHit`, `onHitMagic`, `onAttack`, `onCast`, `onDealt`, `onKill`, `onHurt`, `onStruck`, `onOverheal`, `tick`, `onLethal`, `stat`, `damageMult`...). `power()` is the passive's strength at the item's level (0.6/0.8/1): effects multiply their numbers by it, all-or-nothing ones (revive, spell shield) stretch their cooldown. Shared mechanics in `src/itemPassives/shared.ts`: Spellblade, Lifeline, spell shield, burns, Energized. `unique` + `rank` reproduce LoL's UNIQUE passives (only the best one works). Stats stay in `items.json`.
- **Enemies** (`src/data.ts` + `src/enemies/`): a regular enemy only needs an `EnemyDef`. Custom behavior registers an AI in `AI`; timeline events with special rules (rolled dragon, Baron arena) register a spawner in `SPAWNERS`. `src/hazards.ts` has the ground markers and eruptions for bosses.
- **Performance**: enemies live in a spatial grid (`src/spatial.ts`), so unit collision, targeting, projectiles and auras only query neighbors (collision used to be O(n²)). Per-frame lists are filtered in place (`compact`), spawn/kill windows are amortized O(1), the map rebuilds nothing while the player stays in the same chunk, and the HUD only writes to the DOM when a value changes. Enemies far from the champion update their animation every 3 frames.

## Known limitations / next steps

- Particles: child particle sets (`childParticleSetDefinition`) are not spawned; kits play the child system themselves (e.g. Brand's `Brand_P_redring_Ignition_Child`). `VfxPrimitiveRay`, `VfxPrimitiveAttachedMesh` (the owner's skinned mesh redrawn as a glow or frozen-pose afterimage), force fields (acceleration, drag, attraction) and `FlexShapeDefinition` (scaled to the target's size) are supported. Not implemented: orbital/noise fields, `VfxPrimitiveBeam`, distortion; attached meshes ignore birth scale, UV scroll and erosion. Cast effects ride the bone named by the skin's animation events (`Actor.bone`, `Vfx.playOn`). `blendMode` missing/4 = additive, 1 = alpha (inferred from the textures, not documented).
- The source `.glb` files are heavy (Ezreal 29 MB, Baron 45 MB); `pnpm build:prod` (`tools/optimize.mjs`) drops clips the code never names, resamples and meshopt-compresses them (Ezreal 1.9 MB, Baron 1.9 MB).
- Each enemy is a SkinnedMesh with its own mixer, capped at 260 alive (`MAX_ENEMIES`). For bigger hordes: texture-baked animation + instancing.
- Dragons: animations shared from `sru_dragon`. Infernal and Mountain use the Cloud mesh (`sru_dragon_air`) with their own texture, as in the game (`EnemyDef.mesh`).

## Legal notice

Non-commercial fan project, under Riot Games' "Legal Jibber Jabber" policy. League of Legends and all its assets belong to Riot Games, Inc. Do not distribute the extracted models.
