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
| `tools/build_vfx.py` | Rodar com `<id>` → `public/assets/vfx/<id>/systems.json` (+ `spells.json` com os números do LoL) |
| `src/particles.ts` | **Hoje só carrega `assets/vfx/ezreal/`** (`DIR`). O segundo campeão exige `loadParticles` aceitar a pasta do campeão (passar de `Game.load`) |
| `README.md` | Seção "Regras implementadas": kit do campeão |

Assets (`assets-raw/`, `public/assets/`) não vão para o git. Comandos de extração: README, "Pipeline de assets".

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
- `cast(key, rank, point)`: chamado ao fim do `castTime`; `rank` é 0-based (`damage[rank]`). Mana, recarga, animação, som `<id>_<K>` e hooks de item já foram aplicados.
- `castStart`: VFX de conjuração. `attackSpeedBonus`: fração. `hud`: texto curto da passiva.
- `onDamage(e, hit)`: roda em **todo** dano do campeão, antes da mitigação; retorna dano **mágico** extra. Ignore `hit.source === 'item'` se a passiva não deve reagir a queimaduras de item.
- `dispose`: remova da cena tudo que o kit criou (meshes de marca etc.). `update` roda todo frame depois dos inimigos.
- Cada hit declara um `Hit` (`type`, `source`, `skill`, `onHit`). Defina como constantes. `onHit: true` só se a skill aplica efeitos ao acertar no LoL. `skill` é obrigatório em `source: 'ability'` (reembolsos usam `g.costOf(hit.skill)`).

API do `Game` para o kit: `pos`, `facing`, `time`, `ranks`, `cooldowns`, `mana`/`maxMana`, `ad`/`baseAd`/`bonusAd`, `costOf`, `spawnMissile`, `impact`, `hurtEnemy`, `nearestEnemy`, `enemiesNear`, `inAttackRange`, `collidePlayer`, `vfx` (`play`, `playAt`, `hit`, `attach`), `scene`.

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
| `damage[rank - 1]` | `rank` já é 0-based |
| VFX não aparece | `particles.ts` só lê a pasta do Ezreal; chave errada não dá erro |
| Som mudo | Chave fora de `<id>_...` ou ausente em `BANKS` |

## Verificação

1. `npx tsc --noEmit` e `npx vitest run`.
2. `npm run dev`, console do navegador: `game` está em `window` (dev). Dê ranks (`game.ranks = {Q:5,W:5,E:5,R:3}`), feche o level-up e conjure cada skill com `game.cast('Q', alvo.pos)`. Confira dano, VFX, som, HUD da passiva e o console sem erros.
3. `game.reset()` não pode deixar meshes do kit na cena.
