# League of Survivors

## Internacionalização (obrigatório)

O jogo é publicado em **4 idiomas**: inglês (`en`), português do Brasil (`pt`), espanhol (`es`) e chinês simplificado (`zh`).
O idioma vem do navegador (`navigator.languages`, primeiro idioma suportado); sem nenhum suportado, inglês. Código: `src/i18n.ts`.

Regras para **tudo** que for implementado daqui pra frente:

- Todo texto que o jogador vê (HUD, menus, popups, nomes de campeão/skill/passiva/item/runa/monstro/buff, descrições, floaters, `title`/tooltips, mensagens de loading) nasce nos 4 idiomas com `L({ en, pt, es, zh })` de `src/i18n.ts`. Nunca uma string solta em um idioma só.
- Texto com números: `L({ en: (n: number) => \`${n} kills\`, pt: ..., es: ..., zh: ... })(n)`. Não monte frases concatenando pedaços traduzidos (a ordem das palavras muda entre idiomas).
- Texto estático do `index.html`: atributo `data-i18n="<chave>"` + entrada em `STATIC` em `src/main.ts`.
- Nomes oficiais do LoL vêm do Data Dragon (`en_US`, `pt_BR`, `es_MX`, `zh_CN`): campeões (zh usa o campo `title`, ex. 伊泽瑞尔), skills e passivas (`data/<loc>/champion/<Champ>.json`), itens (`tools/build_items.py` já gera os 4), runas (`runesReforged.json`). Não invente tradução para nome que o Riot já traduziu.
- Descrições próprias do jogo (efeitos adaptados) são traduzidas à mão, com o mesmo conteúdo e os mesmos números nos 4 idiomas. Use o glossário abaixo.
- `tests/i18n.test.ts` carrega os catálogos em cada idioma e falha se algum texto estiver vazio ou `TODO`. Ao criar um catálogo novo de texto (outro arquivo de dados), acrescente-o ao teste.
- Identificadores internos (ids, chaves de som, nomes de clip, comentários de código) continuam em inglês e não são traduzidos.

Glossário (abreviações do HUD entre parênteses):

| en | pt | es | zh |
|---|---|---|---|
| Attack Damage (AD) | Dano de Ataque (DdA) | Daño de Ataque (DA) | 攻击力 |
| Attack Speed (AS) | Velocidade de Ataque (VA) | Velocidad de Ataque (VA) | 攻击速度 (攻速) |
| Ability Haste (AH) | Aceleração de Habilidade (AH) | Aceleración de Habilidad (AH) | 技能急速 |
| Move Speed (MS) | Velocidade de Movimento (VM) | Velocidad de Movimiento (VM) | 移动速度 (移速) |
| Health | Vida | Vida | 生命值 |
| Mana | Mana | Maná | 法力值 |
| Armor | Armadura | Armadura | 护甲 |
| Critical Strike | Acerto Crítico | Golpe Crítico | 暴击 |
| Life Steal / Omnivamp | Roubo de Vida / Vampirismo | Robo de Vida / Omnivampirismo | 生命偷取 / 全能吸血 |
| Tenacity | Tenacidade | Tenacidad | 韧性 |
| Shield | Escudo | Escudo | 护盾 |
| Slow / Stun | Lentidão / Atordoamento | Ralentización / Aturdimiento | 减速 / 眩晕 |
| kill(s) | abate(s) | asesinato(s) | 击杀 |
| elite / epic monster | elite / épico | élite / épico | 精英 / 史诗 |
| horde | horda | horda | 怪潮 |
| stack(s) | acúmulo(s) | acumulación(es) | 层 |
| rune points | pontos de runa | puntos de runa | 符文点数 |
| level up | subir de nível | subir de nivel | 升级 |
| seconds (6s) | 6s | 6 s | 6秒 |

Decimais: `1.5` em en/zh, `1,5` em pt/es.
