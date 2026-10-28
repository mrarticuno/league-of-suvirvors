# Páginas de Runas (meta-progressão) — Design

## Intenção

Dar ao jogador um motivo para começar outra partida. Cada run gera pontos de runa proporcionais aos abates. Os pontos
desbloqueiam, de forma permanente, nodes de uma página de runas no estilo do jogo base. Antes de cada run o jogador
escolhe o campeão e monta a página com o que já desbloqueou. Ele sente as duas coisas: progresso (fica mais forte com o
tempo) e escolha de build (qual combinação levar nesta run).

## Objetivos

- Seleção de campeão → página de runas → partida → fim de jogo (com pontos ganhos) → volta para a seleção de campeão.
- 5 árvores (Precisão, Dominação, Feitiçaria, Determinação, Inspiração) com os nodes do jogo base, adaptados ao survivors.
- Regras de montagem iguais às do jogo base. Assim o jogador nunca equipa tudo de uma vez.
- As primeiras runas saem em 1–2 runs. Desbloquear tudo leva ~100 runs completas.
- Progresso salvo localmente e mantido entre sessões do navegador.

## Não-objetivos

- Conta, servidor, sincronização entre dispositivos.
- Várias páginas salvas com nome. A página é única e fica lembrada por campeão (ver abaixo).
- Novos campeões. A seleção lista o que existe em `CHAMPIONS`, que hoje tem só Ezreal.
- Reembolso ou reset de pontos.
- Feitiços de invocador. A runa Flash Hextec cria o único "feitiço" (ver adaptação).

## Anti-objetivos

- Runas tão fortes que a run deixe de exigir habilidade. Uma página completa deve parecer um bom item, não um modo deus.
- Grind sem recompensa no começo. Uma run média (3–4 mil abates) sempre compra algo. Uma run curta, com menos de 800
  abates, pode não comprar nada; isso é aceito, porque os abates restantes acumulam para a próxima.
- Perder progresso por erro de storage. Falha de leitura ou escrita nunca zera dados já salvos.

## Regras de montagem (iguais ao jogo base)

- **Árvore primária:** 1 keystone + 1 runa de cada uma das 3 linhas.
- **Árvore secundária:** uma árvore diferente da primária, sem keystone. São 2 runas de linhas diferentes. Clicar numa
  3ª runa substitui a escolhida há mais tempo, como no cliente.
- **Fragmentos:** 3 linhas, 1 escolha por linha.
- Só nodes desbloqueados podem ser equipados. Uma página incompleta é válida: slot vazio não dá nada.
- Um node desbloqueado vale para qualquer campeão. A última página usada fica salva por campeão.

## Economia

- **Ganho:** 1 ponto a cada 100 abates. O resto (`kills % 100`) acumula para a próxima run. Uma run média tem 3–4 mil
  abates, o que dá ~35 pontos.
- **Custo crescente por árvore:** o n-ésimo node desbloqueado numa árvore custa `8 × n`. O contador é por árvore. A
  keystone não tem preço especial.
  - Árvore de 13 nodes: 728 pontos. Árvore de 12 nodes: 624 pontos.
  - Todas as árvores: 728 + 4 × 624 = 3.224 pontos.
- **Fragmentos:** desbloqueados por linha, com as 3 opções de uma vez: linha 1 = 20, linha 2 = 40, linha 3 = 60. A ordem é
  livre.
- **Total:** ~3.344 pontos, ou ~96 runs de 35 pontos.
- **Primeira run:** 35 pontos compram 2 nodes da mesma árvore (8 + 16) ou 3 nodes em árvores diferentes (8 + 8 + 8),
  mais a linha 1 de fragmentos se sobrar.
- Todos os números ficam como constantes num lugar só, para balancear depois.

## Persistência

`localStorage`, uma chave versionada (por exemplo `los.runes.v1`):
`{ points, killRemainder, unlocked: string[], shardRows: number[], pages: Record<championId, Page> }`.
Leitura e escrita ficam em `try/catch`, no mesmo padrão de `src/audio.ts`. JSON inválido ou ausente vira estado vazio,
e o texto bruto ilegível é copiado para `los.runes.v1.bak` antes de qualquer escrita, para não ser destruído (decisão minha). Os pontos são creditados uma vez, no momento em
que `game.over` vira não nulo. Recarregar a página no meio da run não credita nada.

## Telas

1. **Seleção de campeão** (novo overlay). Mostra os cards de `CHAMPIONS`. Abre no início, depois do carregamento, e depois
   de cada fim de jogo.
2. **Página de runas** (novo overlay). Layout parecido com o do cliente e com o print de referência: árvore primária à
   esquerda, secundária à direita, fragmentos embaixo. Cada node mostra um de três estados: bloqueado (com custo),
   desbloqueado ou equipado. Uma faixa mostra os pontos disponíveis. Clicar num node bloqueado compra o node, se houver
   pontos. Clicar num node desbloqueado equipa o node. Um tooltip mostra a descrição adaptada. O botão "Jogar" inicia a
   run.
3. **Fim de jogo:** a tela atual (`Hud.showEnd`) ganha "+X pontos de runa" e o progresso até o próximo ponto. O botão leva
   para a seleção de campeão, não para `game.reset()` direto.

Ícones: Data Dragon, como os itens (`perk-images/...` de `runesReforged.json`). O caminho exato fica a cargo do builder.

## Integração com o jogo (decisões técnicas, minhas)

- Novo `src/runes.ts`: dados das árvores, nodes e fragmentos, descrições e fábricas de efeito, no mesmo formato de
  `src/itemEffects.ts`.
- Novo `src/progress.ts`: estado persistente e regras de compra, montagem e crédito. Funções puras, com teste em `tests/`.
- Os efeitos das runas reutilizam a interface `ItemEffect`. As runas entram na mesma lista de hooks que `Game` já chama,
  com stats somados aos de itens. Hooks novos, só os necessários: `onKill(e)`, multiplicador de dano causado
  `damageMult(e, hit)`, redução de dano recebido `onHurt(amount)` e `onStun(seconds)` para tenacidade.
- `Game.reset(page)` recebe a página equipada. Trocar de campeão em tempo de execução não é necessário enquanto só
  existir Ezreal.
- **Força adaptativa:** o jogo não tem AP. Força adaptativa vira DdA adicional (1 força adaptativa = 0,6 DdA, como no
  jogo base).

## Adaptações das runas (minhas; revisar)

Regra geral: "campeão inimigo" vira **elite ou épico** (`tier` `elite` ou `epic`), e "abate/participação" vira abate.
Números iniciais estão marcados para balanceamento.

### Precisão (13)

| Node | Adaptação |
|---|---|
| **Pressione o Ataque** (K) | 3 ataques seguidos no mesmo alvo causam dano adaptativo extra, e o alvo recebe +8% de dano por 6s. |
| **Ritmo Fatal** (K) | Atacar dá +6% de vel. de ataque por 6s (acumula 6x). Com 6 acúmulos, +30% de alcance de ataque. |
| **Agilidade nos Pés** (K) | Ataques acumulam Energia. Com 100, o próximo ataque cura 10 + 30% DdA adicional e dá +20% de vel. de movimento por 1s. |
| **Conquistador** (K) | Acertos acumulam DdA (máx. 12 acúmulos). No máximo, 8% do dano causado vira cura. |
| Absorver Vida | Abater cura 1% da Vida máxima (cooldown interno de 0,5s). |
| Triunfo | Abater elite ou épico cura 10% da Vida perdida. |
| Presença de Espírito | Abater devolve 1,5% da Mana máxima. |
| Lenda: Espontaneidade | +3% de vel. de ataque a cada 500 abates na run (máx. +15%). |
| Lenda: Aceleração | +1,5 de aceleração de habilidade a cada 500 abates (máx. +7,5). |
| Lenda: Linhagem | +0,5% de roubo de vida a cada 500 abates (máx. +3%). |
| Golpe de Misericórdia | +8% de dano contra inimigos abaixo de 40% da Vida. |
| Dilacerar | +8% de dano contra elites e épicos. |
| Até a Morte | +5% a +11% de dano quando a sua Vida está entre 60% e 30%. |

### Dominação (12)

| Node | Adaptação |
|---|---|
| **Eletrocutar** (K) | 3 acertos distintos (ataque ou habilidade) no mesmo alvo em 3s causam dano adaptativo extra. CD 4s. |
| **Colheita Sombria** (K) | Acertar um inimigo abaixo de 50% da Vida causa dano extra que cresce com almas (+1 a cada 50 abates). CD 1,5s. |
| **Chuva de Lâminas** (K) | Os 3 primeiros ataques depois de 4s sem atacar ganham +110% de vel. de ataque. |
| Golpe Desleal | +dano verdadeiro contra inimigos atordoados ou lentos. Enquanto não houver lentidão, vale contra elites e épicos. CD 4s. |
| Gosto de Sangue | Causar dano a elite ou épico cura 16 + 5% DdA. CD 20s. |
| Impacto Repentino | Por 4s depois de usar o E (mobilidade), causa +7% de dano. |
| Sexto Sentido | Quando uma horda surge, ganha um escudo de 10% da Vida máxima por 3s (o HUD já avisa hordas; decisão minha). |
| Lembranças Macabras | Abater elite ou épico dá +2 DdA permanente na run (máx. +20). |
| Ward Profunda | +6% de dano contra inimigos a mais de 500 unidades (não existe sistema de visão; decisão minha). |
| Caçador de Tesouros | Cada abate de elite ou épico dá +1 ponto de runa ao fim da run (máx. +5). |
| Caçador Implacável | +1% de vel. de movimento a cada 200 abates (máx. +10%). |
| Caçador Supremo | +2 de aceleração de habilidade no R a cada 500 abates (máx. +15). |

### Feitiçaria (12)

| Node | Adaptação |
|---|---|
| **Invocar Aery** (K) | Acertos mandam Aery causar dano adaptativo extra ao alvo. CD 2s. |
| **Cometa Arcano** (K) | Acertar uma habilidade lança um cometa na posição do alvo, com dano em área. CD 8s, reduzido por acertos. |
| **Ímpeto Gradual** (K) | 3 acertos distintos em 4s dão +30% de vel. de movimento por 3s. CD 12s. |
| Arcanista Axiomático | +6% de dano do R. |
| Faixa de Fluxo de Mana | Acertar habilidade dá +25 de Mana máxima (máx. 250). No máximo, regenera 1% da Mana faltante a cada 5s. |
| Manto de Nimbus | Usar o R dá +25% de vel. de movimento por 2,5s. |
| Transcendência | +5 de aceleração de habilidade no nível 5 e +5 no nível 8. No nível 11, abater reduz o CD das habilidades em 20% do restante. |
| Celeridade | +1% de vel. de movimento, e bônus de vel. de movimento ficam 7% mais fortes. |
| Foco Absoluto | +DdA adaptativo (até 10 no nível 18) enquanto a Vida estiver acima de 70%. |
| Chamuscar | A próxima habilidade que acerta queima o alvo: dano mágico de 1s. CD 10s. |
| Caminhar sobre as Águas | No rio (`water` da sessão): +10% de vel. de movimento e +DdA adaptativo. |
| Tempestade Crescente | A cada 2 min de run: +DdA adaptativo crescente. |

### Determinação (12)

| Node | Adaptação |
|---|---|
| **Aperto dos Mortos-Vivos** (K) | A cada 4s em combate, o próximo ataque causa +3,5% da Vida máxima como dano, cura 1,3% e dá +5 de Vida permanente na run. |
| **Pós-Choque** (K) | Ao atordoar ou ser atordoado, ganha +35 de armadura por 2,5s e depois explode em área. CD 20s. |
| **Guardião** (K) | Abaixo de 30% da Vida, ganha um escudo de 50 + 10% da Vida adicional por 2s. CD 70s. |
| Demolir | +dano contra épicos (estruturas não existem): +10% no primeiro acerto a cada 45s. |
| Nascente da Vida | Acertar um elite ou épico com habilidade cura 1% da sua Vida máxima ao longo de 2s. |
| Golpe de Escudo | Ganhar escudo (Guardião, itens) faz o próximo ataque causar dano extra. |
| Condicionamento | Depois de 5 min de run: +8 de armadura e +3% de armadura. |
| Ventos Revigorantes | Depois de receber dano de um inimigo, regenera 4 + 3% da Vida faltante ao longo de 10s. |
| Osso Revestido | Depois de receber dano, os próximos 3 golpes em até 1,5s têm dano reduzido em 30–60. CD 55s. |
| Crescimento Excessivo | +3 de Vida máxima a cada 100 abates. A partir de 1.200 abates, mais +3,5% de Vida máxima. |
| Revitalizar | +5% de cura e escudos recebidos (+10% abaixo de 40% da Vida). |
| Inabalável | +20% de tenacidade (atordoamentos duram menos). |

### Inspiração (12)

| Node | Adaptação |
|---|---|
| **Aprimoramento Glacial** (K) | O 1º ataque em um alvo o deixa lento em 30% por 2s. Isso também habilita Golpe Desleal. |
| **Grimório Desselado** (K) | A cada 2 min, troca o atributo bônus da run: DdA, vel. de ataque ou aceleração. É escolhido pelo jogador num popup. |
| **Primeiro Ataque** (K) | Causar o primeiro dano a um elite ou épico dá +7% de dano contra ele por 3s. |
| Flash Hextec | Habilita Flash na tecla D: blink de 400 unidades, CD 120s. |
| Calçados Mágicos | Aos 6 min, ganha +10% de vel. de movimento permanente. Cada 300 abates antecipam o bônus em 30s. |
| Reembolso | +10% de XP dos abates. |
| Tônico Triplo | Aos níveis 3, 6 e 9: uma poção grátis do popup de poções. |
| Tônico da Distorção Temporal | Poções restauram instantaneamente e dão +5% de vel. de movimento por 2s. |
| Entrega de Biscoitos | A cada 2 min até 6 min: restaura 8% da Vida e da Mana faltantes, e dá +10 de Mana máxima. |
| Percepção Cósmica | +18 de aceleração de habilidade. |
| Velocidade de Aproximação | +7,5% de vel. de movimento ao andar em direção a um inimigo lento ou ao alvo em foco. |
| Pau para Toda Obra | +1 de aceleração de habilidade por stat diferente nos itens. Com 5 stats: +10 DdA adicional. Com 10 stats: +25 DdA adicional. |

### Fragmentos (3 linhas, desbloqueio por linha)

| Linha | Opções |
|---|---|
| 1 (ofensa) — 20 pts | Força adaptativa +9 (5,4 DdA) · Vel. de ataque +10% · Aceleração de habilidade +8 |
| 2 (flex) — 40 pts | Força adaptativa +9 · Vel. de movimento +2% · Vida escalonada +10–180 (por nível) |
| 3 (defesa) — 60 pts | Vida +65 · Tenacidade +15% · Vida escalonada +10–180 |

## O que fica com o builder

- Visual exato dos overlays e da árvore. O CSS deve seguir `index.html`.
- Os números de balanceamento das adaptações acima. São ponto de partida; o que importa é a mecânica.
- Se uma adaptação depender de um sistema que não existe (por exemplo, lentidão em inimigos), o builder pode implementar
  o mínimo desse sistema ou simplificar a runa. Toda simplificação fica anotada para a revisão do usuário.
