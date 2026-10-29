# League of Survivors

## Internacionalização (obrigatório)

O jogo é publicado em **4 idiomas**: inglês (`en`), português do Brasil (`pt`), espanhol (`es`) e chinês simplificado (`zh`).
O idioma vem do navegador (`navigator.languages`, primeiro idioma disponível); sem nenhum disponível, inglês.

Como funciona (`src/i18n.ts`):

- Um arquivo por idioma: `src/locales/<código>.json`, um mapa plano `chave -> texto`. Só o arquivo do idioma do jogador é carregado.
- No código: `t('hud.kills', { n })`. Placeholders `{nome}` são preenchidos pelo segundo argumento. A chave é tipada a partir de `en.json`.
- Chaves derivadas de ids (sem string no código de dados): `rune.<id>.name`/`.desc`, `item.<id>` (nome), `item.<id>.passive`, `tree.<id>`, `shard.<stat>`, `enemy.<model>`, `buff.<key>`, `champion.<id>.name`/`.passive`/`.Q|W|E|R`, `stat.<stat>`.
- Texto estático do `index.html`: `data-i18n="<chave>"` (ex. `static.play`).
- `meta.tag` de cada arquivo é a tag BCP 47 usada no `<html lang>`.
- **Novo idioma**: criar `src/locales/<código>.json` com todas as chaves de `en.json` (e o locale do Data Dragon em `LOCALES` de `tools/build_items.py` para os nomes dos itens). Nenhum código muda.

Regras para **tudo** que for implementado daqui pra frente:

- Todo texto que o jogador vê (HUD, menus, popups, nomes de campeão/skill/passiva/item/runa/monstro/buff, descrições, floaters, `title`/tooltips, loading) é uma chave em `src/locales`, adicionada **nos 4 arquivos** no mesmo commit. Nunca uma string solta no código.
- Frase com números ou nomes é uma chave só com placeholders (`"Level {level} — choose an item"`). Não monte frases concatenando pedaços traduzidos (a ordem das palavras muda entre idiomas). Variações (ligado/desligado) são chaves separadas.
- Nomes oficiais do LoL vêm do Data Dragon (`en_US`, `pt_BR`, `es_MX`, `zh_CN`): campeões (zh usa o campo `title`, ex. 伊泽瑞尔), skills e passivas (`data/<loc>/champion/<Champ>.json`), itens (`tools/build_items.py` escreve `item.<id>` nos locales), runas (`runesReforged.json`). Não invente tradução para nome que o Riot já traduziu.
- Descrições próprias do jogo (efeitos adaptados) são traduzidas à mão, com o mesmo conteúdo e os mesmos números nos 4 idiomas. Use o glossário abaixo.
- `tests/i18n.test.ts` falha se um arquivo de idioma não tiver exatamente as chaves de `en.json`, se um texto estiver vazio/`TODO`, se os placeholders divergirem, se um texto chinês não tiver caracteres chineses, ou se o código usar uma chave inexistente. Catálogo novo com chaves derivadas de id: acrescente-o ao último teste.
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
