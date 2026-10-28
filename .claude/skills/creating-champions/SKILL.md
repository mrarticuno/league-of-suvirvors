---
name: creating-champions
description: Use when adding a new playable champion (personagem) to League of Survivors, porting a LoL champion's kit (passive, Q/W/E/R), or changing how a champion's skills, passive, marks, stacks, animations, sounds or VFX work.
---

# Criando campeões

## Visão geral

Campeão = **dados** (`ChampionDef`) + **kit** (objeto criado a cada run com as regras próprias).
O `Game` (`src/game.ts`) já faz tudo que é genérico: movimento, ataque básico, crítico, recargas, mana, ranks, itens, pipeline de dano, HUD e level-up.
Regra central: **nada específico de um campeão entra em `game.ts`, `ui.ts` ou `vfx.ts`**. Se o kit precisa de algo que o `Game` não expõe, adicione um hook genérico em `src/champion.ts` (que outro campeão também usaria), nunca um `if (champ.id === ...)`.

Contrato completo e comentado: `src/champion.ts`. Exemplo de referência: `src/champions/ezreal.ts`.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/champions/<id>.ts` | **Novo.** Exporta o `ChampionDef` e a função do kit |
| `src/champions/index.ts` | Registrar em `CHAMPIONS` (e `DEFAULT_CHAMPION` para jogar com ele) |
| `tools/build_models.py` | Entrada em `MODELS` → `public/assets/models/<model>.glb/.png` |
| `tools/build_audio.py` | Entradas em `BANKS` com as chaves de som do campeão |
| `tools/extract_lol.py` | Extrair `Champions/<Champ>.wad.client` para `assets-raw/<id>` (antes de `build_models.py`) |
| `tools/build_vfx.py` | Rodar com `<id>` → `public/assets/vfx/<id>/systems.json` (+ `spells.json` com os números do LoL) |
| `src/particles.ts` + `src/vfx.ts` | **Hoje fixos no Ezreal:** `DIR = 'assets/vfx/ezreal/'` e a textura `enemyTex`. O segundo campeão exige `loadParticles(dir)` com a pasta do campeão (passada por `Game.load`) |
| `src/main.ts` | `new Game()` usa `DEFAULT_CHAMPION`; não há tela de seleção. Para jogar: `new Game(CHAMPIONS.<id>)` |
| `README.md` | "Regras implementadas" (kit) e "Pipeline de assets" (a regex de hashes e os comandos de extração citam `ezreal`: acrescente o campeão) |

Assets (`assets-raw/`, `public/assets/`) não vão para o git.

## ChampionDef: regras

- `id`: minúsculo; é o prefixo de **todos** os sons. O `Game` toca sozinho: `<id>_auto`, `<id>_auto2`, `<id>_crit`, `<id>_auto_hit`, `<id>_crit_hit`, `<id>_Q|W|E|R` (início do cast), `<id>_death`. Sons extras (impacto de skill etc.) o kit toca com `audio.play`. Chave ausente no manifest toca nada, sem erro.
- `model`: nome do `.glb`/`.png` em `public/assets/models/`.
- `base`: stats do LoL (fonte: Meraki Analytics / `spells.json`), regen **por 5 s**, `*PerLevel` usa a fórmula de crescimento do LoL. `windupPercent = attackCastTime / attackTotalTime`.
- `skills`: as 4 chaves `Q W E R`, cada uma com `name, maxRank, cooldown[], cost[], castTime, anim, icon`. Arrays com `maxRank` itens. Números próprios do kit (dano, ratios, alcance) ficam no mesmo objeto: declare com `as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>` e leia do objeto local no kit.
- `ultimateLevels`: só se o R não segue 6/11/16.
- `anims` / `skills[k].anim`: nomes exatos dos clips no `.glb`. Clip inexistente = sem animação, sem erro: confira os nomes.
- `vfx`: chaves de sistemas de partícula do ataque básico (`auto`, `crit`, `autoHit`, `critHit`), como no `ResourceResolver` da skin.
- `icon`: URL do Data Dragon (`.../img/spell/<Champ><K>.png`, `.../img/passive/...`).

## Kit: regras

```ts
function luxKit(g: Game): ChampionKit { /* estado da run aqui, em closures */ return { cast(key, rank, point) {...} }; }
```

- Estado do campeão (acúmulos, marcas, cargas) vive **no closure do kit**, nunca em `Game` ou em `Enemy`. Estado por inimigo: `Map<Enemy, ...>`, limpo em `update` quando `e.deadFor >= 0`.
- `cast(key, rank, point)`: chamado ao fim do `castTime`; `rank` é 0-based (`damage[rank]`). Fora de `cast` (`onDamage`, `update`), o rank é `g.ranks.<K> - 1`. `point` é o cursor no chão: skill com alvo usa `g.enemyAt(point) ?? g.nearestEnemy(point, r)`.
- `castTime` é a canalização (campeão parado). Atordoamento ou estase cancelam o cast sem avisar o kit: VFX longo de `castStart` deve se autodestruir (sistema com duração, não preso ao cast). Mana, recarga, animação, som `<id>_<K>` e hooks de item já foram aplicados.
- `castStart`: VFX de conjuração. `attackSpeedBonus`: fração. `hud`: texto curto da passiva.
- `onDamage(e, hit)`: roda em **todo** dano do campeão, antes da mitigação; retorna dano **mágico** extra. Ignore `hit.source === 'item'` se a passiva não deve reagir a queimaduras de item.
- `dispose`: remova da cena tudo que o kit criou (meshes de marca etc.). `update` roda todo frame depois dos inimigos.
- Cada hit declara um `Hit` (`type`, `source`, `skill`, `onHit`). Defina como constantes. `onHit: true` só se a skill aplica efeitos ao acertar no LoL. Sempre preencha `skill` em `source: 'ability'` (o tipo não obriga, mas reembolsos usam `g.costOf(hit.skill)`).
- Deslocamento (blink/dash): altere `g.pos` e chame `g.collidePlayer()`. Não existe dash ao longo do tempo nem clamp de arena para blink.
- Objetos de chão do campeão (armadilhas, zonas): meshes do kit em `g.scene`, checados no `update` com `g.enemiesNear`, removidos em `dispose`. `g.hazards` só fere o campeão (é dos chefes).

API pública do `Game` para o kit: `pos`, `facing`, `time`, `level`, `ranks`, `cooldowns`, `hp`/`maxHp`, `mana`/`maxMana`, `ad`/`baseAd`/`bonusAd`, `attackSpeed`, `critChance`, `items`, `costOf`, `spawnMissile`, `basicAttack`, `impact`, `hurtEnemy`, `float`, `enemyAt`, `nearestEnemy`, `enemiesNear`, `inAttackRange`, `collidePlayer`, `vfx` (`play`, `playAt`, `hit`, `attach`), `scene`.

## Mecânicas que ainda NÃO têm hook

Precisa de uma destas? Primeiro estenda o contrato de forma genérica (`src/champion.ts` + `src/game.ts`), depois escreva o kit. Não contorne com gambiarra no kit.

| Mecânica | O que falta | Forma genérica sugerida |
|---|---|---|
| Contar/alterar ataques básicos ao disparar (Headshot, "a cada N ataques") | Kit não tem `onAttack`; `onDamage` só soma dano **mágico** | Hook do kit `onAttack(target, damage, crit)` e/ou `onDamage` retornando `{ physical, magic }` |
| CC em inimigos (root, slow, stun) | `Enemy` não tem campo de CC; loop genérico e `EnemyAI` não param | `rootedUntil`/`slowUntil` genéricos em `Enemy` + `g.rootEnemy(e, s)`, respeitados no loop genérico e documentados para `EnemyAI` |
| Dash com duração | Só existe blink instantâneo | Movimento forçado no `updatePlayer` (vetor + tempo), respeitando arena e colisão |

CC em `Enemy` é estado **genérico** (qualquer campeão usa); a regra "estado no kit" vale para mecânicas exclusivas do campeão.

Projéteis: `g.spawnMissile(vfxKey, from, to, { speed, range, radius, damage, hit, target?, pierce?, height?, hitFx?, hitSound?, onHit? })`.
Sem `onHit`, o impacto padrão faz VFX, som e `hurtEnemy`. Com `onHit`, você faz tudo (use `g.impact(e, m)` para manter o padrão e acrescentar algo).
Busca de alvos: sempre `g.nearestEnemy`/`g.enemiesNear` (grade espacial). Nunca percorra `g.enemies` para achar alvos.

## Desempenho (obrigatório)

- Nada de `filter`/`map`/`clone` por frame em listas grandes; use `compact` (`src/util.ts`) e vetores de rascunho.
- `enemiesNear(p, r, out)` com array próprio se você chama outra busca dentro do laço (o array padrão é compartilhado).
- Hooks de hit e `update` são O(1) ou O(vizinhos); nada O(n) de inimigos por hit.

## Erros comuns

| Erro | Correção |
|---|---|
| `if (champ.id === 'x')` em `game.ts`/`ui.ts` | Hook genérico em `champion.ts` |
| Marca/acúmulo como campo de `Enemy` | `Map<Enemy, ...>` no kit |
| Esquecer `dispose` | Marcas ficam na cena após reiniciar |
| `damage[rank - 1]` dentro de `cast` | Lá `rank` já é 0-based; fora de `cast` use `g.ranks.<K> - 1` |
| VFX não aparece | `particles.ts`/`vfx.ts` só leem a pasta do Ezreal; chave errada não dá erro |
| Percorrer `g.enemies` para achar alvo | `g.nearestEnemy` / `g.enemiesNear` |
| Som mudo | Chave fora de `<id>_...` ou ausente em `BANKS` |

## Verificação

1. `npx tsc --noEmit` e `npx vitest run`.
2. `npm run dev`, console do navegador: `game` está em `window` (dev). Dê ranks (`game.ranks = {Q:5,W:5,E:5,R:3}`), feche o level-up e conjure cada skill com `game.cast('Q', alvo.pos)`. Confira dano, VFX, som, HUD da passiva e o console sem erros.
3. `game.reset()` não pode deixar meshes do kit na cena.
