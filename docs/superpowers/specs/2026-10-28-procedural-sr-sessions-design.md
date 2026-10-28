# Mapa Procedural Infinito — Sessões do Summoner's Rift

**Data:** 2026-10-28 · **Status:** aguardando aprovação
**Contexto:** League of Survivors (survivors-like 2.5D, TypeScript + Three.js + Vite), mapa atual = plano único 60000×60000 com textura procedural tileada, sem streaming, sem colisão de cenário.

## Intent

Substituir o mundo fixo por um **mapa infinito em "sessões"** (chunks temáticos do Summoner's Rift) gerados aleatoriamente conforme o jogador avança em qualquer direção, usando **assets reais extraídos do Map11.wad** (texturas de terreno, paredes, estruturas). Obstáculos interagem com os personagens **apenas por física** — bloqueiam movimento, não atacam nem são atacáveis. Nunca há barreiras de fim de mundo: chegar à borda de uma sessão gera a próxima.

## Goals

1. **Streaming infinito por grid de chunks** — chunks de 6000×6000 unidades; manter carregados os 3×3 ao redor do chunk do jogador (span 18000 > far plane 10000); descartar todo o resto. Fog no match do `scene.background` para esconder pop-in.
2. **4 tipos de sessão** gerados aleatoriamente na primeira geração de cada chunk, **com repetição permitida** (inclusive vizinhos), sem persistência — revisitar regenera: **rio, rota, selva, base**:
   - **Rio:** faixa central de água (textura real de água do SR, animada por offset), margens abertas, poucas paredes.
   - **Rota (lane):** corredor limpo com fileiras de torres de inibidor como obstáculos circulares.
   - **Selva:** denso — paredes/rochas reais formando corredores, decoração de vegetação.
   - **Base:** estruturas reais no centro (inibidor + torres + nexus como cenário), praça aberta ao redor.
3. **Obstáculos só com física:** paredes (AABB), estruturas (círculos). Bloqueiam jogador **e** inimigos por deslize; mísseis ignoram cenário (projéteis do LoL não colidem com terreno). Torres não atacam, não são atacáveis, inibidor não é destruível.
4. **Assets reais do Map11.wad** (2,4 GB, presente em `/Applications/League of Legends.app/.../Map11.wad.client`):
   - Texturas de terreno: `levels/map11/scene/textures` (933 arquivos) → PNG para chão/água por tipo de sessão.
   - Estruturas como personagens via pipeline existente: `sruap_orderinhibitor`, `sruap_chaosinhibitor`, `nexus`, torres (`sruap_*turret` a confirmar na extração).
   - Paredes/props de cenário: **parser parcial** de `data/maps/mapgeometry/map11/*.mapgeo` extraindo seções de wall/rock como peças soltas (referência de formato: `floh22/lol-map-renderer`). **Fallback explícito:** se uma peça não parsear, gera geometria extrudada com textura real — degradação graciosa, nunca bloqueia o build.

## Non-goals

- Pathfinding dos inimigos (deslizam em paredes, podem encalhar — aceito).
- Gameplay por sessão: spawn director, XP, loot e progressão continuam globais; cenário é decorativo + físico.
- Reconstruir o layout original do SR (não é o mapa de verdade — é composição procedural).
- Minimapa, iluminação avançada, sombras.

## Anti-goals (falha mesmo funcionando)

- Hitch de FPS na geração/descarte de chunks (geração deve ser amortizada, 1–2 chunks/frame máx).
- Jogador ou inimigo spawnando dentro de obstáculo (resolve de colisão no spawn).
- Sessões indistinguíveis entre si.

## Constraints

- `game.ts` (arquivo único ~1000 linhas) não deve crescer: sistema de mapa em **módulo novo `src/map.ts`** com API mínima consumida pelo `game.ts` (`ensureChunks(pos)`, `collideCircle(pos, radius)`, `dispose()`).
- Colisão de unidades atual: `separate()` empurra pares de unidades; paredes entram como um resolve a mais no mesmo passo de física.
- Renderização: `MeshBasicMaterial` (padrão do projeto), sem luzes.
- Pipeline de assets em Python (`tools/extract_lol.py` já lê WAD/zstd/gzip e converte texturas; `tools/build_models.py` converte personagens via lol2gltf).

## Approaches considerados

| | Descrição | Trade-off |
|---|---|---|
| 1. Fatia real do SR | Parsear `room.wgeo` + `base.mapgeo` + placements e fatiar o mapa real em 4 templates | 100% fiel, mas parser completo (maior risco técnico), terreno pesado, layout fixo repetido — contraria "geração aleatória" |
| **2. Kit-bashing (escolhido)** | Peças reais (texturas, paredes de mapgeo, estruturas como personagens), composição procedural por tipo de sessão | Visual fiel onde importa + variedade infinita real + memória leve; custo: parser parcial de mapgeo |
| 3. Texturas reais + geometria procedural | Chão real, paredes como geometria simples texturizada | Zero parser novo, mas cenário visualmente aproximado |

**Por que 2:** o pedido central é geração aleatória com repetição — só o kit-bashing combina assets reais com variedade infinita real. O parser fica parcial (só paredes/rochas) e com fallback, contendo o risco.

## Decisões fechadas (calls do design)

- **Aleatoriedade:** tipo da sessão sorteado uniformemente na primeira geração do chunk; sem seed por coordenada (o usuário pediu explicitamente "pode repetir a sessão anterior" — não-persistente é o comportamento desejado).
- **Colisão:** círculo×AABB (paredes) e círculo×círculo (estruturas), resolução por deslize; jogador e inimigos colidem; mísseis não.
- **Decoração:** props de cenário vindos do mapgeo/scene; **não** reusar modelos de monstros como decoração estática (confusão visual com inimigos reais).
- **Chunk 6000; 3×3 carregados; resto descartado**; geração amortizada.
- **Escala:** unidades atuais do jogo mantidas (spawn radius 1800 vs chunk 6000 — inimigos sempre spawnam dentro de chunks carregados).
- **Casos de borda (builder check):** alvos/ataque melee ignoram paredes (regra física única; "inimigo atrás da parede acertando você" é aceito pelo non-goal de pathfinding); blink (E) atravessa paredes como no LoL e o pouso recebe o mesmo resolve de spawn; **água é andável** (rio é visual); sobreposição cosmética da arena do Baron com cenário é aceita (o clamp da arena sobrepõe colisão de parede durante a luta).

## Deixado para o builder

- Especificação exata do parser mapgeo (seguir spec de referência da comunidade; começar pelas seções de wall/rock; fallback geometria + textura).
- Seleção final das texturas por tipo de sessão (nomes em `levels/map11/scene/textures` a inspecionar na extração).
- Padrões de layout por sessão (frequência/espessura de paredes na selva, nº de torres na rota, composição da base, largura do rio e margens).
- Água: textura real com offset animado (barato) ou estática.
- Integração no `main.ts` (loop de ensure/dispose por frame) e ordem de update vs física.
