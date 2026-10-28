# League of Survivors (protótipo)

Survivors-like 2.5D no navegador com campeões de League of Legends. Vista superior, modelos 3D e animações originais do LoL.
Stack: **TypeScript + Three.js + Vite**.

## Rodar

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Os modelos **não estão no repositório** (são assets da Riot). Gere-os localmente primeiro (abaixo).

## Pipeline de assets (macOS, com LoL instalado)

1. Ferramentas: Python 3 e .NET 8 SDK.
   ```bash
   python3 -m venv .venv-tools && .venv-tools/bin/pip install xxhash zstandard pillow
   git clone https://github.com/Crauzer/lol2gltf && cd lol2gltf/src/lol2gltf
   # o csproj vem fixo em win-x64: troque RuntimeIdentifier para osx-arm64, desligue PublishReadyToRun e RestorePackagesWithLockFile
   dotnet publish -c Release -o ../../../l2g
   ```
2. Lista de hashes (os `.bin` do jogo referenciam texturas/animações por hash xxh64):
   ```bash
   curl -s https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt \
     | grep -E "assets/characters/(ezreal|sru_)" > assets-raw/hashes.filtered.txt
   ```
3. Extrair dos WADs (`tools/extract_lol.py`) e converter para `.glb` (`tools/build_models.py`):
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt ezreal assets-raw/ezreal "$G/Champions/Ezreal.wad.client"
   for c in sru_chaosminion{melee,ranged,siege,super} sru_orderminionmelee sru_krug sru_murkwolf sru_razorbeak sru_razorbeakmini sru_gromp sru_blue sru_red sru_riftherald sru_baron sru_crab sru_dragon sru_dragon_{air,fire,earth,water,hextech,chemtech}; do
     .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Maps/Shipping/Map11.wad.client" "$G/Maps/Shipping/Common.wad.client"
   done
   .venv-tools/bin/python tools/build_models.py l2g/lol2gltf
   ```
   Saída: `public/assets/models/<id>.glb` + `<id>.png`. O PNG é aplicado em runtime porque o `lol2gltf` só embute `.tex/.dds`.
4. VFX das habilidades: sistemas de partículas do Ezreal lidos do `.bin` da skin, com todas as texturas e malhas que eles usam. Precisa das listas de hashes completas do CommunityDragon (`hashes.game.txt` e `hashes.bin{entries,fields,types,hashes}.txt` de `https://raw.communitydragon.org/data/hashes/lol/`) em `assets-raw/hashes/`:
   ```bash
   (cd tools && ../.venv-tools/bin/python build_vfx.py ../assets-raw/hashes ezreal ../public/assets/vfx/ezreal "$G")
   ```
   Gera `systems.json` (efeitos indexados pelas chaves do `ResourceResolver`, ex. `Ezreal_Q_mis`), `spells.json` (velocidade/largura/alcance dos mísseis) e os PNG/JSON dos assets. `tools/read_bin.py` sozinho converte qualquer `.bin` em JSON. O runtime dos emissores fica em `src/particles.ts`; `src/vfx.ts` só escolhe qual sistema tocar e onde.

## Controles

| Ação | Tecla |
|---|---|
| Mover | Botão direito no chão (segure para seguir o cursor) ou setas |
| Focar alvo (com ataque automático) | Botão direito no inimigo |
| Ligar/desligar ataque automático | `T` |
| Ataque manual (auto desligado) | Botão esquerdo no inimigo |
| Habilidades | `Q` `W` `E` `R` na direção do cursor |
| Escolher melhoria | Clique ou `1`–`9` |

WASD não é usado porque colide com Q/W/E.

## Regras implementadas

- **Ezreal fiel ao LoL** (dados da Meraki Analytics): stats por nível com a fórmula de crescimento do LoL, ataque com windup de 18,75%, projétil a 2000 u/s, crítico de 175%.
  - **Passiva (Rising Spell Force)**: +10% de velocidade de ataque por acerto de habilidade, até 5 acúmulos, dura 6 s.
  - **Q**: −1,5 s em todas as recargas ao acertar.
  - **W**: marca o alvo; a detonação devolve mana quando feita por habilidade.
  - **E**: blink de 475 + projétil teleguiado, priorizando o alvo marcado.
  - **R**: 1 s de conjuração, atravessa inimigos, 50% de dano em não-épicos.
- **Level-up em duas etapas**:
  1. Um rank de habilidade, pela regra do LoL: básicas nos níveis 1/3/5/7/9, R nos níveis 6/11/16. A etapa é pulada quando não há rank disponível.
  2. Um item entre 3 sorteados (ou uma poção, com a build completa).
- **Itens**: dados reais do Data Dragon (pt-BR, ícones), gerados por `tools/build_items.py` em `src/items.json`. Regras completas em `docs/superpowers/specs/2026-10-28-item-evolution-design.md`.
  - Só itens básicos de origem são ofertados. Uma cópia nova pode virar item novo ou evoluir um passo um item da mesma linha; o jogador escolhe o slot e o ramo (`LINES` em `src/items.ts`).
  - Itens completos custam de 3 a 5 cópias do básico e são únicos. Ramos cujo item completo já é seu (ou está reservado por outro slot) ficam bloqueados; um item sem ramo livre fica travado.
  - Inventário de no máximo 6 itens; não é possível descartar. Cada oferta mostra a árvore da linha (o que você tem, o que está bloqueado, o custo de cada item completo).
  - Build completa (6 itens completos ou travados): o level-up oferece Poção de Vida ou de Mana (20% do máximo), e cada abate tem 1% de chance de derrubar um blueprint (pergaminho azul, 1 por run) que torna um item completo aleatório Lendário (+50% dos stats).
  - Itens completos: builds atuais do Ezreal (Força da Trindade, Manamune, Lança de Shojin, Fome Eterna, Rancor de Serylda, Coração Congelado, Anjo Guardião) e a build on-hit/crítico (Mata-Cráquens, Espada do Rei Destruído, Gume do Infinito, Colhedor de Essência, Cutelo Negro).
  - Passivas implementadas: Lâmina Arcana (Fulgor/Trindade/Colhedor), Fascínio (Manamune), Derrubar (Mata-Cráquens), Gume da Névoa (Rei Destruído), dano crítico (Gume do Infinito), Talhar (Cutelo Negro), Renascimento (Anjo Guardião), Carícia do Inverno (Coração Congelado), penetração de armadura, roubo de vida e vampirismo.
  - Armadura: dano físico (ataque básico, Q, efeitos ao acertar) é reduzido pela armadura do inimigo. O dano mágico (W, E, R) não.
- **Inimigos à distância**: disparam skillshots em linha reta, mirados onde o Ezreal estava, com alcance limitado. Dá para desviar.
- **Curva de dificuldade**: no início, 1 ataque básico ou 1 habilidade mata.
  - Vida: base × `(1 + 0,08 × (nível − 1)) × (1 + tempo / 900 s)`.
  - Dano: base × `(1 + tempo / 600 s)`.
  - Monstros épicos têm vida fixa.
  - Ajuste em `enemyHpScale` / `enemyDamageScale` (`src/data.ts`).
- **XP**: absorvida automaticamente ao matar.
- **Textos flutuantes**: dano causado (branco = físico, azul = mágico, laranja = crítico), dano recebido (vermelho) e XP ganha (roxo).
- **Diretor de spawn**: inimigos por segundo = `0,45 + 0,04×(nível−1) + tempo/450`.
  - Esse valor é multiplicado por 0,6–1,3 conforme a fração dos inimigos dos últimos 20 s que o jogador matou.
  - O número de inimigos vivos tem teto: `12 + 2×nível + tempo/8`.
  - Ajuste em `DIRECTOR` (`src/data.ts`).
- **Horda**: a cada 2 min, um anel de `15 + 2×nível` inimigos fracos se fecha ao redor do jogador, com uma abertura de 90° para fugir. O aviso aparece 6 s antes.
- **Progressão (estilo survivors)**:
  - 0–5 min: minions.
  - A partir de 3 min: raptors, lobos, krugs, gromp.
  - Chefes: Aronguejo (5:00), Dragão (10:00, elemento sorteado entre Montanha, Nuvens, Oceano, Hextech, Infernal e Quimtech; buffs ainda não implementados), Arauto do Vale (15:00), Barão Na'Shor (20:00).
  - Elites entre os chefes: Sentinela Azul (7:30), Brutamontes Vermelho (12:30), os dois juntos (17:30).
  - Ajustes em `EVENTS` (`src/data.ts`).
- **Barão Na'Shor (20:00)**: quase impossível de matar (150 mil de vida). Matá-lo vence a run.
  - Ao nascer, todos os outros inimigos morrem e nada mais nasce (nem hordas).
  - Uma arena circular (raio 1500) se fecha em volta do Ezreal e do Barão. Andando não dá para sair.
  - Se o Ezreal sair (ex.: Arcane Shift por cima da parede), um tentáculo o puxa de volta.
  - Habilidades com tempo de conjuração e marcador no chão:
    - Círculos no chão: depois de 1 s, arremessam para cima e atordoam (até ~500 de dano, não mata).
    - Tentáculo saindo do chão onde o Ezreal estava: mata.
    - Cuspe ácido em linha: mata.
  - Perto do Barão: 33% de chance de mordida (engole, instantânea, impossível de esquivar). Senão, chicotada em cone: 75% da vida máxima, nunca mata.
  - Ajustes em `BARON` (`src/data.ts`).

## Limitações conhecidas / próximos passos

- Partículas: não implementados `VfxPrimitiveRay`, `VfxPrimitiveAttachedMesh` (malhas presas ao esqueleto, ex. avatar do E), campos de força (`fieldCollectionDefinition`) e `FlexShapeDefinition`. Efeitos de cast presos a ossos saem de um ponto fixo na mão. `blendMode` ausente/4 = aditivo, 1 = alpha (inferido das texturas, não documentado).
- Os `.glb` são pesados (Ezreal 29 MB, Barão 45 MB, sem compressão). Próximo passo: `gltf-transform resample/quantize` e remover clips não usados (recall, dance).
- Cada inimigo é um SkinnedMesh com o próprio mixer, com limite de 220 vivos. Para hordas maiores: animação baked em textura + instancing.
- Dragões: animações compartilhadas do `sru_dragon`. Infernal e Montanha usam a malha do Nuvens (`sru_dragon_air`) com a própria textura, como no jogo (`EnemyDef.mesh`).

## Aviso legal

Projeto de fã, não comercial, conforme a política "Legal Jibber Jabber" da Riot Games. League of Legends e todos os assets pertencem à Riot Games, Inc. Não distribua os modelos extraídos.
