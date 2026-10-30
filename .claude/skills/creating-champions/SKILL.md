---
name: creating-champions
description: Use when adding a new playable champion (personagem) to League of Survivors, porting a LoL champion's kit (passive, Q/W/E/R), or changing how a champion's skills, passive, marks, stacks, animations, sounds or VFX work.
---

# Criando campeões

## Visão geral

Campeão = **dados** (`ChampionDef`) + **kit** (objeto criado a cada run com as regras próprias).
O `Game` (`src/game.ts`) já faz tudo que é genérico: movimento, ataque básico, crítico, recargas, mana, ranks, itens, pipeline de dano, HUD e level-up.
Regra central: **nada específico de um campeão entra em `game.ts`, `ui.ts` ou `vfx.ts`**. Se o kit precisa de algo que o `Game` não expõe, adicione um hook genérico em `src/champion.ts` (que outro campeão também usaria), nunca um `if (champ.id === ...)`.

Contrato completo e comentado: `src/champion.ts`. Exemplos de referência: `src/champions/ezreal.ts` (atirador simples), `samira.ts` (corpo a corpo, medidor, canalização), `brand.ts` (mago AP: dano contínuo, marcas por inimigo, detonação em cadeia, mana em abates, `idleVfx`), `aphelios.ts` (várias formas: armas com ataque, Q, animações e ícones próprios, pontos que compram atributos, pet/torreta, HUD com munição e fila).

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/champions/<id>.ts` | **Novo.** Exporta o `ChampionDef` e a função do kit |
| `src/champions/index.ts` | Registrar em `CHAMPIONS` (e `DEFAULT_CHAMPION` para jogar com ele) |
| `tools/build_models.py` | Entrada em `MODELS` → `public/assets/models/<model>.glb/.png`. Rodar com `l2g/lol2gltf` (binário fica no repo, ignorado pelo git; não apagar nem recompilar) |
| `tools/build_audio.py` | Entradas em `BANKS` com as chaves de som do campeão |
| `tools/extract_lol.py` | Extrair `Champions/<Champ>.wad.client` para `assets-raw/<id>` (antes de `build_models.py`) |
| `tools/build_vfx.py` | Rodar com `<id>` → `public/assets/vfx/<id>/systems.json` (+ `spells.json` com os números do LoL) |
| `src/main.ts` | Nada a fazer: a tela de seleção lista `CHAMPIONS` e troca com `game.setChampion`. `?champ=<id>` na URL só escolhe o campeão carregado de início |
| `src/locales/{en,pt,es,zh}.json` | `champion.<id>.*` nos 4 idiomas (ver Textos) |
| `tests/<id>.test.ts` | Teste da passiva com um `Game` stub (modelo: `tests/brand.test.ts`) |
| `README.md`, `README.pt-BR.md`, `README.zh-CN.md` | "Regras implementadas" (kit) e "Pipeline de assets" (regex de hashes e comandos de extração/VFX citam os campeões: acrescente o novo) nos 3 READMEs |

Assets (`assets-raw/`, `public/assets/`) não vão para o git.

## ChampionDef: regras

- `id`: minúsculo; é o prefixo de **todos** os sons. O `Game` toca sozinho: `<id>_auto`, `<id>_auto2`, `<id>_crit`, `<id>_auto_hit`, `<id>_crit_hit`, `<id>_Q|W|E|R` (início do cast), `<id>_death`. Sons extras (impacto de skill etc.) o kit toca com `audio.play`. Chave ausente no manifest toca nada, sem erro.
- `model`: nome do `.glb`/`.png` em `public/assets/models/`. `scale`: multiplicador se o modelo exportado ficar menor que os outros (compare a altura com o Ezreal, ~183).
- `hide` / `textures`: submeshes escondidos (`initialSubmeshToHide`) e com textura própria (`materialOverride`, submesh -> stem do PNG em `public/assets/models/`), lidos do `skin0.bin` (`tools/read_bin.py`). A textura extra entra em `MODELS` com caminho `../<pasta>/<arquivo>.png` (ex.: `samira_weapons`).
- `base`: stats do LoL (fonte: Meraki Analytics / `spells.json`), regen **por 5 s**, `*PerLevel` usa a fórmula de crescimento do LoL. `windupPercent = attackCastTime / attackTotalTime`.
- `skills`: as 4 chaves `Q W E R`, cada uma com `name, maxRank, cooldown[], cost[], castTime, anim, icon, aim`. Arrays com `maxRank` itens. Números próprios do kit (dano, ratios, alcance) ficam no mesmo objeto: declare com `as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>` e leia do objeto local no kit.
- `aim` (obrigatório): mira ao se mover com as setinhas, quando o cursor não é usado. Número = alcance da mira automática (alvo marcado, senão o inimigo mais próximo): todo skillshot e todo dash/skill que precisa de alvo. `'move'` = na direção do movimento (dash/blink livre, ex.: E do Ezreal). `'none'` = skill que ignora o `point` (em volta de si, alvo escolhido pelo kit).
- `rankLevels`: nível de cada rank por skill, só se não segue o LoL (básicas 1/3/5/7/9, R 6/11/16). `autoRank`: skills que sobem sozinhas (sem ponto; R do Aphelios). `SkillDef.unlockLevel`: conjurável a partir do nível, independente do rank (os ranks então compram atributos via `stat`).
- `anims` / `skills[k].anim`: nomes exatos dos clips no `.glb`. Clip inexistente = sem animação, sem erro: confira os nomes.
- `vfx`: chaves de sistemas de partícula do ataque básico (`auto`, `crit`, `autoHit`, `critHit`), como no `ResourceResolver` da skin; `death`: pares `[sistema, osso]` tocados na morte (eventos da animação de morte no `animations/skin0.bin`).
- `idleVfx`: pares `[sistema, osso]` que ficam ligados a run toda (o `idleParticlesEffects` do `skin0.bin`, ex.: as chamas do Brand); param na morte. O bin às vezes omite o prefixo do osso (`BUFFBONE_GLB_CENTER_LOC` vs `C_BUFFBONE_GLB_CENTER_LOC`): confira no `.glb`.
- Mago: ratio de AP da skill em `apRatio` (o card mostra) e `g.ap` no kit; `itemPool: 'ap'` no `ChampionDef` para receber itens AP no level up.
- `build` (obrigatório): os 6 itens lendários recomendados, na ordem de compra de um site de builds (OP.GG/u.gg, patch atual), só ids que existem em `src/items.json` (sem ativas/suporte); o level up oferece esses itens com mais frequência e marca como recomendado.
- `icon`: URL do Data Dragon (`.../img/spell/<Champ><K>.png`, `.../img/passive/...`).
- `icon` do campeão: retrato do Data Dragon (`.../img/champion/<Champ>.png`), usado na seleção.
- **Textos nos 4 idiomas** (regra do `CLAUDE.md`, "Internacionalização"): nada de string no `ChampionDef`. `name: t('champion.<id>.name')`, `skills[k].name: t('champion.<id>.<K>')`, `passive.name: t('champion.<id>.passive')`, e `hud()`/popups/floaters com chaves `champion.<id>.*` e placeholders (ex. `t('champion.ezreal.hud', { stacks, max })`). Adicione as chaves nos 4 arquivos de `src/locales/`. Nomes oficiais vêm do Data Dragon (`data/{en_US,pt_BR,es_MX,zh_CN}/champion/<Champ>.json`; no zh o nome do campeão é o campo `title`). `tests/i18n.test.ts` já cobre `CHAMPIONS`.

## Kit: regras

```ts
function luxKit(g: Game): ChampionKit { /* estado da run aqui, em closures */ return { cast(key, rank, point) {...} }; }
```

- Estado do campeão (acúmulos, marcas, cargas) vive **no closure do kit**, nunca em `Game` ou em `Enemy`. Estado por inimigo: `Map<Enemy, ...>`, limpo em `update` quando `e.deadFor >= 0`.
- `cast(key, rank, point)`: chamado ao fim do `castTime`; `rank` é 0-based (`damage[rank]`). Fora de `cast` (`onDamage`, `update`), o rank é `g.ranks.<K> - 1`. `point` é o cursor no chão: skill com alvo usa `g.enemyAt(point) ?? g.nearestEnemy(point, r)`.
- `castTime` é a canalização (campeão parado). Atordoamento ou estase cancelam o cast sem avisar o kit: VFX longo de `castStart` deve se autodestruir (sistema com duração, não preso ao cast). Mana, recarga, animação, som `<id>_<K>` e hooks de item já foram aplicados.
- `castStart`: VFX de conjuração. `attackSpeedBonus`/`moveSpeedBonus`: fração. `canCast(key)`: condição extra antes de gastar mana/recarga (ex.: R que exige acúmulos). `disarmed()`: bloqueia ataque básico (canalização, giro). `hud`: texto curto da passiva. `gauge()`: medidor da passiva ao lado das skills (`label` grande, `fill` 0..1, `ready` brilha; ex.: grau de Estilo da Samira). `castAnim(key, point)`: anim da skill com mais de uma forma (ex.: Q da Samira, arma ou lâmina). `gauge().skill`: slot que brilha quando `ready`. `meleeAuto(target)`: true troca o ataque básico pelo corpo a corpo de `ChampionDef.melee` (anims, VFX, sons `<id>_melee*`, sem míssil).
- `castTime` precisa ser > 0 (o cast resolve quando a trava zera); skill instantânea usa `0.05`.
- `onKill(e, hit)`: o `hit` matou `e` (ex.: passiva que restaura mana em abates).
- `onDealt(e, hit, dealt)`: dano já mitigado (cura por % do dano, ex. Severum).
- Campeão com várias formas (armas, posturas): `stat(k)` (atributos próprios, somados aos de itens), `attackTarget(alvo)` (troca o alvo do ataque, pode estar fora do alcance), `attackStart(alvo, crit)` (clip, som e windup do ataque), `basicAttack(alvo, dano, crit, bolt)` (dispara o ataque no lugar do míssil padrão; `bolt` = Furacão de Runaan), `moveAnims()` (idle/run), `cooldownBase(k)`/`castTime(k)`, `skillView(k)` (ícone, nome e selo do slot) e `tray()` (ícones acima dos slots), `gauge().icon`. Mostrar/esconder submesh: `g.player.showSubmesh(nome, visível)`. `g.resetAttack()` zera o tempo do próximo ataque. `Hit.onHitMult`: efetividade dos efeitos ao atacar (Chacina: 0,25).
- Pet/torreta com modelo próprio: `loadModel(id, hide, id)` no início do kit e `new Actor(id, escala)` (dentro de `try`: o download pode não ter terminado); o modelo entra em `MODELS` (`OWN_MESH` se a textura é de outra pasta) e é extraído com o WAD do campeão.
- `onDamage(e, hit)`: roda em **todo** dano do campeão, antes da mitigação; retorna dano **mágico** extra. Ignore `hit.source === 'item'` se a passiva não deve reagir a queimaduras de item.
- `dispose`: remova da cena tudo que o kit criou (meshes de marca etc.). `update` roda todo frame depois dos inimigos.
- Cada hit declara um `Hit` (`type`, `source`, `skill`, `onHit`). Defina como constantes. `onHit: true` só se a skill aplica efeitos ao acertar no LoL. Sempre preencha `skill` em `source: 'ability'` (o tipo não obriga, mas reembolsos usam `g.costOf(hit.skill)`).
- Blink: altere `g.pos` e chame `g.collidePlayer()` (sem clamp de arena). Dash: `g.dash(dir, dist, speed)` (respeita arena e colisão, sem andar/atacar; CC interrompe); `g.dashing` diz se ainda corre (dano no caminho: cheque no `update`).
- Bloquear projéteis inimigos: `g.blockMissiles(p, r)` (retorna quantos).
- Objetos de chão do campeão (armadilhas, zonas): meshes do kit em `g.scene`, checados no `update` com `g.enemiesNear`, removidos em `dispose`. `g.hazards` só fere o campeão (é dos chefes).

API pública do `Game` para o kit: `pos`, `facing`, `time`, `level`, `ranks`, `cooldowns`, `hp`/`maxHp`, `mana`/`maxMana`, `ad`/`baseAd`/`bonusAd`, `ap`, `attackSpeed`, `critChance`, `items`, `slots` (`{ id, level }` dos itens), `costOf`, `spawnMissile`, `basicAttack`, `impact`, `hurtEnemy`, `float`, `enemyAt`, `nearestEnemy`, `enemiesNear`, `inAttackRange`, `collidePlayer`, `dash`/`dashing`, `blockMissiles`, `slow(e, pct, s)`/`isSlowed`, `stunEnemy(e, s)`, `rootEnemy(e, s)`, `resetAttack`, `learned(k)`, `player.bone(nome)`, `vfx` (`play`, `playAt`, `playOn`, `hit`, `attach`), `scene`.

- Dano contínuo (queimadura, veneno) e explosões de passiva: `Hit` com `source: 'item'`, para não disparar runas/itens de "acerto de habilidade" a cada tick. Aplique os acúmulos do próprio kit à mão.
- Itens reagem ao `Hit`: `source: 'ability'` + `skill` dispara Liandry, Rylai, Shojin, Luden, Serylda, Voltaic etc.; `onHit: true` aplica on-hit (Kraken, BotRK, Guinsoo, Nashor). Dano mágico é reduzido pela RM do inimigo e físico pela armadura; `type: 'true'` ignora os dois (procs de item).
- Ticks de dano: conte os ticks restantes (`ticks--`), não compare `g.time < fim`; o erro de ponto flutuante perde o último tick.
- Marca que segue inimigo: `g.vfx.attach(key)` + `g.scene.add(o)`, posição copiada no `update`, `removeFromParent()` ao acabar (o sistema morre junto).

## Mecânicas que ainda NÃO têm hook

Precisa de uma destas? Primeiro estenda o contrato de forma genérica (`src/champion.ts` + `src/game.ts`), depois escreva o kit. Não contorne com gambiarra no kit.

| Mecânica | O que falta | Forma genérica sugerida |
|---|---|---|
| Dano **físico** extra num acerto (Headshot) | `onDamage` só soma dano **mágico** (contar ataques já dá: `attackStart`/`basicAttack`) | `onDamage` retornando `{ physical, magic }` |

CC em `Enemy` é estado **genérico** (qualquer campeão usa); a regra "estado no kit" vale para mecânicas exclusivas do campeão.

Projéteis: `g.spawnMissile(vfxKey, from, to, { speed, range, radius, damage, hit, target?, pierce?, height?, hitFx?, hitSound?, onHit? })`.
Sem `onHit`, o impacto padrão faz VFX, som e `hurtEnemy`. Com `onHit`, você faz tudo (use `g.impact(e, m)` para manter o padrão e acrescentar algo).
Busca de alvos: sempre `g.nearestEnemy`/`g.enemiesNear` (grade espacial). Nunca percorra `g.enemies` para achar alvos.

## Mana (magos)

Custos do LoL são feitos para poucas skills por luta; aqui o campeão conjura sem parar contra hordas. Para campeão que vive de skill:
- Baixe os custos (Brand: Q 70→40, W/E ~30% menores, R 100→80) e mantenha recargas do LoL.
- Mana por abate (passiva do LoL ou adaptada) precisa de limite: abate de tropa/monstro pequeno com recarga interna (Brand: 1 s), elite/épico sempre. Sem isso a horda vira mana infinita.
- Conta de referência: gasto sustentado ≈ soma de `custo / recarga` (com AH). Deve ficar acima da regen base e abaixo de regen + mana por abates, para matar = sobreviver e luta de chefe (poucos abates) drenar.
- Registre as adaptações no comentário do topo do kit e no README.

## Pipeline de assets (passo a passo)

`G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"`. Ferramentas Python em `.venv-tools`.

1. Hashes: `grep "assets/characters/<id>/" assets-raw/hashes/hashes.game.txt >> assets-raw/hashes.filtered.txt`.
2. Modelo: `.venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt <id> assets-raw/<id> "$G/Champions/<Champ>.wad.client"`, entrada em `MODELS` e só esse modelo: `.venv-tools/bin/python -c "import sys; sys.path.insert(0,'tools'); import build_models as b; b.build('l2g/lol2gltf','<id>',*b.MODELS['<id>'])"`. Sem `l2g/lol2gltf`: README passo 1 (o .NET instala sem sudo com `dotnet-install.sh` em `~/.dotnet`).
3. VFX: `(cd tools && ../.venv-tools/bin/python build_vfx.py ../assets-raw/hashes <id> ../public/assets/vfx/<id> "$G")`.
4. Som: nomes dos eventos estão no bin (`grep -o '"Play_sfx_<Champ>[^"]*"'` no dump do `skin0.bin`). Entradas em `BANKS`, WAD do campeão na lista `wads` do `main`, e rode o script inteiro (ele reescreve o `sounds.json`) com caminho **absoluto** do wwiser: `(cd tools && ../.venv-tools/bin/python build_audio.py "$PWD/../assets-raw/wwiser/wwiser.py" ../public/assets/sfx "$G")`. Evento que imprime `no event` não existe mais no banco: tire a chave.
5. Números: stats e skills da Meraki (`https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/<Champ>.json`); `spells.json` (gerado no passo 3) tem velocidade/largura/alcance de míssil e `DataValues`. Nomes nos 4 idiomas: Data Dragon.

Dump de um bin para consulta: `read_linked(Names('../assets-raw/hashes'), [Wad(...)], 'data/characters/<id>/skins/skin0.bin')` (`tools/build_vfx.py`), salvo em JSON no scratchpad. O que procurar:
- `SkinCharacterDataProperties.idleParticlesEffects`: `idleVfx` (`effectKey` + `boneName`).
- `data/characters/<id>/animations/skin0.bin`, `ParticleEventData`: VFX presos à animação (ataque, morte) e o osso (`mBoneName`).
- `ResourceResolver`: todas as chaves de sistema. Liste-as com o número de emissores para escolher.

## Escolhendo VFX

- Use **todos** os sistemas de gameplay do `systems.json`: cast (`_cas`, na mão via `playOn`), míssil (`_mis`), impacto (`_tar`), zona/indicador, marcas por acúmulo, buff no alvo (`_buf`), idle e morte. Mago depende do visual.
- Ignore: sistemas sem emissores (só `particleName`), os `*_Audio` (só som), emotes (`Dance`, `Joke`, `Taunt`), variantes de outro modo (`DoomBots_*`) e chaves de outros campeões (`*_BV2`).
- Par `_green`/`_red`: indicador por time; o jogador é aliado, use `_green`.
- Emissor com `childParticleSetDefinition` (filho) não é criado pelo runtime: toque o sistema filho junto (ex. `Brand_P_redring` + `Brand_P_redring_Ignition_Child`).
- Sistema que o jogo atual não usa (sobra de versão antiga) pode virar feedback (ex. `Brand_PHguardian_tar` no atordoamento do Q). Comente no kit.
- Orçamento: marcas por inimigo em horda custam caro. Limite as simultâneas (Brand: 40 marcas, 12 anéis); acima disso a mecânica roda sem o visual.

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
| VFX não aparece | Chave errada não dá erro. Sistemas que o `ResourceResolver` só nomeia por hash ficam como `0x...` no `systems.json` (identifique pelo `particleName`) |
| Percorrer `g.enemies` para achar alvo | `g.nearestEnemy` / `g.enemiesNear` |
| Som mudo | Chave fora de `<id>_...` ou ausente em `BANKS` |
| Osso não encontrado (VFX idle some) | O bin às vezes omite o prefixo (`BUFFBONE_GLB_CENTER_LOC` vs `C_BUFFBONE_GLB_CENTER_LOC`): liste os nós do `.glb` |
| Campeão pequeno/grande demais | Compare a altura da cabeça com o Ezreal (~180 com cabeça em ~160) e ajuste `scale` |
| `build_audio.py` quebra no wwiser | Caminho relativo do `wwiser.py`: use absoluto (o script roda o wwiser com `cwd` temporário) |
| Último tick de dano some | Contar ticks, não comparar tempo |
| Mana infinita em horda | Recarga interna na mana por abate |
| Item da `build` nunca aparece | Id fora de `src/items.json` (itens com ativa, suporte e corta-cura não existem no jogo): troque pelo próximo item do site de builds |

## Verificação

1. `npx tsc --noEmit` e `npx vitest run`.
2. `npm run dev`, console do navegador: `game` está em `window` (dev). Dê ranks (`game.ranks = {Q:5,W:5,E:5,R:3}`), feche o level-up e conjure cada skill com `game.cast('Q', alvo.pos)`. Confira dano, VFX, som, HUD da passiva e o console sem erros.
3. `game.reset()` não pode deixar meshes do kit na cena (conte os `Group` vazios em `game.scene.children` antes e depois).
4. Teste de altura: `game.player.bone('head').getWorldPosition(new THREE.Vector3()).y` perto dos outros campeões.
5. Itens: `game.takeItem('<id>')` e `game.levelItem(slot)` até o nível 5 nos itens da `build`; confira que as passivas reagem às skills (queimadura, lentidão, on-hit) e que o card de level-up marca a build como recomendada.
6. Contra horda: `game.hurtPlayer = () => {}`, spawne ~30 `minion_melee` com vida alta e confira mana gasta por skill, marcas e FPS.
