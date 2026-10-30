<p align="center">
  <img src="docs/media/banner.png" alt="League of Survivors" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.pt-BR.md">Português</a> · <b>简体中文</b>
</p>

<p align="center">
  <b>浏览器中的 2.5D 幸存者类游戏，主角是英雄联盟的英雄。</b><br>
  俯视视角，使用英雄联盟原版 3D 模型和动画。在怪潮中存活，升级装备，并在第 20 分钟击败纳什男爵。
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E5%8E%9F%E5%9E%8B-c8aa6e">
</p>

<p align="center">
  <a href="https://league-of-survivors.gabriel-m-lyra.workers.dev"><b>▶ 在线试玩</b></a>
</p>

<p align="center">
  <img src="docs/media/ezreal.gif" alt="伊泽瑞尔对抗怪潮" width="80%">
</p>

> 游戏支持英语、葡萄牙语、西班牙语和简体中文，根据浏览器语言自动选择。

## 截图

| 英雄选择 | 符文页 |
|---|---|
| ![英雄选择：伊泽瑞尔的原画与技能](docs/media/champion-select.jpg) | ![符文页：精密 + 巫术与符文碎片](docs/media/rune-page.jpg) |

| 升级：技能 | 升级：装备 |
|---|---|
| ![技能卡片：伤害、冷却与推荐](docs/media/skill-pick.jpg) | ![装备卡片：等级、选择前后的属性与被动](docs/media/item-shop.jpg) |

| 莎弥拉 | 纳什男爵（20:00） |
|---|---|
| ![莎弥拉在峡谷迅捷蟹周围对抗怪潮](docs/media/samira.gif) | ![男爵竞技场与预警攻击](docs/media/baron.gif) |
| ![莎弥拉与风格计量条，对战峡谷迅捷蟹](docs/media/samira.jpg) | ![伊泽瑞尔躲避男爵的鞭击](docs/media/baron.jpg) |

| 胜利 | 手机（触控操作） |
|---|---|
| ![男爵倒下：过场动画与胜利界面](docs/media/victory.gif) | ![横屏触控界面：摇杆与技能按钮](docs/media/mobile.jpg) |

<sub>Logo 与横幅源文件：`docs/media/logo.html`（用 Chromium 打开并截取 `#logo` / `#banner`）。截图来自使用本地生成资源运行的原型。</sub>

## 运行

```bash
pnpm install
pnpm dev        # http://localhost:5173（在第一个界面选择英雄）
```

模型**不在仓库中**（属于 Riot 的资源）。请先在本地生成（见下文）。

## 资源管线（macOS，需已安装英雄联盟）

1. 工具：Python 3 和 .NET 8 SDK（无管理员权限时：`curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir ~/.dotnet`，之后使用 `~/.dotnet/dotnet`）。`l2g/` 已被 git 忽略：编译一次后保留即可。
   ```bash
   python3 -m venv .venv-tools && .venv-tools/bin/pip install xxhash zstandard pillow pygltflib
   git clone https://github.com/Crauzer/lol2gltf && cd lol2gltf/src/lol2gltf
   # csproj 固定为 win-x64：把 RuntimeIdentifier 改为 osx-arm64，关闭 PublishReadyToRun 和 RestorePackagesWithLockFile
   dotnet publish -c Release -o ../../../l2g
   ```
2. 哈希列表（游戏的 `.bin` 通过 xxh64 哈希引用纹理和动画）：
   ```bash
   curl -s https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt \
     | grep -E "assets/characters/(ezreal|samira|brand|aphelios|sru_|turret|inhibitor|nexus)" > assets-raw/hashes.filtered.txt
   ```
3. 从 WAD 中提取（`tools/extract_lol.py`）并转换为 `.glb`（`tools/build_models.py`）：
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt ezreal assets-raw/ezreal "$G/Champions/Ezreal.wad.client"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt samira assets-raw/samira "$G/Champions/Samira.wad.client"
   .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt brand assets-raw/brand "$G/Champions/Brand.wad.client"
   # 厄斐琉斯和折镜的驻灵（同一 WAD 中的独立角色）
   for c in aphelios apheliosturret; do .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Champions/Aphelios.wad.client"; done
   for c in sru_chaosminion{melee,ranged,siege,super} sru_orderminionmelee sru_krug sru_murkwolf sru_razorbeak sru_razorbeakmini sru_gromp sru_blue sru_red sru_riftherald sru_baron sru_crab sru_dragon sru_dragon_{air,fire,earth,water,hextech,chemtech}; do
     .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Maps/Shipping/Map11.wad.client" "$G/Maps/Shipping/Common.wad.client"
   done
   # 召唤师峡谷建筑（地图场景）：角色文件夹为 turret/inhibitor/nexus
   for c in turret inhibitor nexus; do
     .venv-tools/bin/python tools/extract_lol.py assets-raw/hashes.filtered.txt $c assets-raw/$c "$G/Maps/Shipping/Map11.wad.client" "$G/Maps/Shipping/Common.wad.client"
   done
   .venv-tools/bin/python tools/build_models.py l2g/lol2gltf
   ```
   输出：`public/assets/models/<id>.glb` + `<id>.png`。PNG 在运行时应用，因为 `lol2gltf` 只嵌入 `.tex/.dds`。
   建筑在 `tools/build_models.py` 中有固定条目（`sruap_orderturret|orderinhibitor|ordernexus`，`own_anm=False`，因为它们是静态场景），输出为 `public/assets/models/sruap_*.glb|png`。
4. 地图：地形和岩石纹理，从 `Map11.wad.client` 提取。先把 CommunityDragon 的完整哈希列表（`https://raw.communitydragon.org/data/hashes/lol/` 下的 `hashes.game.txt` 和 `hashes.bin{entries,fields,types,hashes}.txt`）下载到 `assets-raw/hashes/`：`textures` 用 `hashes.game.txt` 作为名称表，`pieces` 需要 `.bin*` 列表，`read_bin` 才能解析 `.mapgeo` 中的名称。
   ```bash
   G="/Applications/League of Legends.app/Contents/LoL/Game/DATA/FINAL"
   .venv-tools/bin/python tools/build_map.py textures assets-raw/hashes/hashes.game.txt public/assets/map "$G/Maps/Shipping/Map11.wad.client"
   .venv-tools/bin/python tools/build_map.py pieces assets-raw/hashes/hashes.game.txt public/assets/map "$G/Maps/Shipping/Map11.wad.client"
   ```
   输出：`public/assets/map/tex/{ground_river,ground_lane,ground_jungle,ground_base,water}.png`（从召唤师峡谷图集裁剪的约 400 px 纹理）和 `public/assets/map/pieces/rock_{a,b,c}.glb|png`（`base.mapgeo` 中最大的三块岩石/悬崖，归一化为 1 个单位，再缩放到覆盖障碍物的包围盒）。
   `pieces` 是一个有限的 `.mapgeo` v14 解析器：如果跳过或失败（格式版本不同、缺少 WAD），运行时会根据布局障碍物绘制深色方块/圆柱。不会出错。
5. 技能特效：从皮肤的 `.bin` 读取伊泽瑞尔的粒子系统，以及它们使用的所有纹理和网格。使用第 4 步下载的哈希列表：
   ```bash
   for c in ezreal samira brand aphelios; do (cd tools && ../.venv-tools/bin/python build_vfx.py ../assets-raw/hashes $c ../public/assets/vfx/$c "$G"); done
   ```
   生成 `systems.json`（按 `ResourceResolver` 键索引的特效，例如 `Ezreal_Q_mis`）、`spells.json`（飞弹速度/宽度/射程）以及资源的 PNG/JSON。`tools/read_bin.py` 可以单独把任意 `.bin` 转为 JSON。发射器运行时位于 `src/particles.ts`；`src/vfx.ts` 只负责选择播放哪个系统以及在哪里播放。

6. 音效与音乐：伊泽瑞尔、野怪、HUD 的 Wwise 音频库（`.bnk`/`.wpk`）以及 Map11 的音乐。需要 `brew install vgmstream ffmpeg` 和 [wwiser](https://github.com/bnnm/wwiser)：
   ```bash
   git clone --depth 1 https://github.com/bnnm/wwiser assets-raw/wwiser
   (cd tools && ../.venv-tools/bin/python build_audio.py "$PWD/../assets-raw/wwiser/wwiser.py" ../public/assets/sfx "$G")
   ```
   wwiser 为每个事件生成一个 `.txtp`，vgmstream 渲染，ffmpeg 转为 mp3。事件按 id 查找（名称的 FNV-1；名称来自角色的 `.bin`，表在脚本中的 `BANKS`）。随机容器最多生成 4 个变体（`<key>_<n>.mp3`），运行时随机播放。输出：`public/assets/sfx/*.mp3` + `sounds.json`。没有该文件夹时游戏静音运行。
   未找到的事件（静音）：小兵死亡，以及海洋/海克斯科技/化学科技亚龙的攻击。音乐是召唤师峡谷中名称未知的主事件（id `3832820115`），每个 switch 状态成为一首曲目。

## 程序化地图

世界没有边界，也没有空气墙：`src/sessions.ts` 描述一个 6000×6000 的会话布局（`CHUNK`），`src/map.ts` 在玩家周围维护一个 3×3 的区块窗口（`WorldMap.ensureChunks`）。每次调用最多生成 2 个新区块，并丢弃离开窗口的所有内容；雾（`THREE.Fog`，5000–9500）遮住已加载的边缘。

每个区块在生成时随机一个类型，允许重复且不持久化（离开再回来可能变成另一种类型）：

- `river`：河流，两岸是可行走的浅水，并有草丛方块。
- `lane`：四角各有一座防御塔。
- `jungle`：2–7 面岩墙；约 40% 带有装饰岩石。
- `base`：中心是水晶枢纽，周围是召唤水晶和 2–3 座防御塔。

障碍物**只有物理碰撞**：防御塔、召唤水晶和水晶枢纽不会攻击，也不能被攻击（右键仍只会锁定真实单位），也不阻挡投射物——飞弹、E 的闪烁和水都能越过它们。只有实体（玩家和敌人）会碰撞，并沿障碍物滑动（`resolveCircle`）；没有寻路：敌人径直走向伊泽瑞尔，碰到障碍就绕开。

资源来自管线第 4 步：每种区块类型一张纹理（水面还会滚动偏移）和由 `loadMapPieces()` 加载的模型。缺失或加载失败的模型会回退为障碍物的深色方块/圆柱。不会出错。

## 操作

| 动作 | 按键 |
|---|---|
| 移动 | 右键点击地面（按住跟随光标）或方向键 |
| 锁定目标（自动攻击） | 右键点击敌人 |
| 开关自动攻击 | `T` |
| 手动攻击（关闭自动时） | 左键点击敌人 |
| 技能 | `Q` `W` `E` `R`，朝光标方向释放 |
| 选择升级 | 点击或 `1`–`9` |
| 暂停 / 开关音乐和音效 | `Esc` |

不使用 WASD，因为与 Q/W/E 冲突。

## 已实现的规则

- **伊泽瑞尔忠于原作**（Meraki Analytics 数据）：按英雄联盟成长公式计算各等级属性，攻击前摇 18.75%，弹道速度 2000 u/s，暴击 175%。
  - **被动（Rising Spell Force）**：技能每次命中 +10% 攻击速度，最多 5 层，持续 6 秒。
  - **Q**：命中时所有技能冷却 −1.5 秒。
  - **W**：标记目标；用技能引爆时返还法力。
  - **E**：475 距离闪烁 + 追踪弹，优先攻击被标记的目标。
  - **R**：1 秒施法，穿透敌人，对非史诗单位造成 50% 伤害。
- **莎弥拉**（Meraki Analytics 数据）：射程 500，暴击 175%。
  - **被动（Daredevil Impulse）**：与上一次类型不同的命中（射击、刀刃、Q、W、E、R）使风格评级提升一级（E→S，6 秒，每级 +2–3.5% 移动速度）。200 距离内的攻击使用刀刃：额外魔法伤害（2–19 + 3.5–10.5% 攻击力），根据目标已损失生命值最多翻倍；W、E 和 Q 的斩击也会触发。
  - **Q**：射击第一个敌人；若前方 340 内有敌人，则改为锥形斩击。可暴击（125%）。
  - **W**：两次范围斩击（325），开始时一次，0.75 秒后一次；摧毁范围内的敌方投射物。旋转期间不能普攻。
  - **E**：朝光标方向冲刺 600，对路径上的敌人造成魔法伤害，5 秒内 +20–40% 攻击速度。
  - **R**：仅在风格为 S 且 600 内有敌人时可用。2 秒内对周围所有敌人进行 10 轮射击（对小兵 25%），可暴击；−30% 移动速度，消耗风格。
  - 与原作不同：任何敌人都计入风格；E 期间没有 Q 的爆炸；没有对被定身目标的攻击（尚未实现）。
- **布兰德**（Meraki Analytics 数据和皮肤 bin）：第一位法术强度英雄；射程 550。使用其技能组的全部粒子系统（身上的火焰、灼烧标记、引爆光环与爆炸、所有施法/弹道/命中特效）。
  - **被动（炽热之焰）**：技能施加灼烧（最多 3 层，4 秒）：每层灼烧造成 2% 最大生命值 + 8–48（等级）+ 5% 法术强度。第 3 层会形成光环，2 秒后爆炸（半径 475）：8–12% 最大生命值（每 100 法术强度 +2%，上限 270–525）+ 30–150 + 20% 法术强度，并使所有被命中者灼烧。被引爆的敌人 4 秒内最多只能有 1 层。技能击杀或击杀灼烧中的敌人恢复 20–40 法力值（对小兵和小型野怪每秒最多一次；精英和史诗总是恢复）。
  - **Q**：火球命中第一个敌人；灼烧中的目标被眩晕 1.5 秒。
  - **W**：0.627 秒后在目标点造成范围伤害（260）；对灼烧中的敌人 +25%。
  - **E**：对目标造成伤害并蔓延至其 300 码内的敌人（目标灼烧时为 600）。
  - **R**：火球最多弹跳 4 次（600），优先灼烧中的敌人；使灼烧中的敌人减速 30–60%，持续 0.25 秒。
  - 与原作不同（为怪潮平衡法力）：消耗 Q 40、W/E 45–65、R 80；灼烧和引爆有固定伤害部分，引爆对任何敌人生效；灼烧每 0.5 秒结算一次；R 不会弹回布兰德。
- **厄斐琉斯**（客户端 `aphelios.bin` 中的技能数据，基础属性来自 Meraki Analytics）：射程 550。五把武器和专属 HUD：技能旁是主手武器的图标和弹药，Q = 主手武器的技能（名称由副手决定，例如还魂月闪），W = 副手武器及其弹药，E = 下个武器，技能栏上方是储备队列。
  - **被动（传知者与真知者）**：开局主手通碧、副手断魄，坠明、荧焰、折镜在储备中。每把武器 50 弹药：每次攻击 1，每次 Q 10（不足 10 时 Q 用掉剩余）。主手武器耗尽后回到队列末尾，组装下个武器（1 秒内不能月相轮转，其 Q 冷却至少 1.5 秒）。技能点用于购买属性而非技能等级（Q +4 额外攻击力，W +9% 攻击速度，E +4.5 穿甲，最早 9 级达到 6 级）；Q 在 2 级解锁，W 和 E 在 1 级，R 在 6/11/16 级自动升级。
  - **武器**：通碧 +100 射程，技能命中施加 4.5 秒标记；对标记目标的下次攻击（最远 1800）使用副手武器并引爆所有标记，每个 15 + 15% 额外攻击力。断魄立即命中，回复伤害的 2–7.1%（技能为 2.5 倍）；溢出的治疗转为护盾（10–140 + 6% 最大生命值，30 秒）。坠明造成 30% 减速，衰减到 10%（2.5 秒）。荧焰造成 110% 攻击力，并在目标后方分裂为 4 发弹丸（暴击时 6 发且更宽），造成 75%/100%（9 级）的伤害，对小兵为其 30%。折镜被掷出，在目标处停留 0.2 秒后以 600（+750% 额外攻击速度）返回：每个飞轮刃环绕厄斐琉斯，相当于多一把可投掷的刃：攻击先掷出武器本身，再连续掷出环绕的飞轮刃，不受攻击计时限制（只有前摇，像机枪一样；HUD 显示环绕中的数量），只有所有刃都在外时才需等待接住（接住后重置攻击计时，因此目标越近越快）。技能掷出幻影飞轮刃，每接住一个获得一个新的飞轮刃（最多 20 个，5 秒，接住或折镜攻击时刷新）：第一个 +15% 攻击力，之后逐个降到 +5%。
  - **Q（取决于主手武器，60 法力，数值随 1–13 级成长）**：月闪（70–160 + 42–60% 额外攻击力 + 100% 法术强度，射程 1450，施加标记）；对影（1.75 秒，6 次攻击，每 100% 额外攻速 +2，副手与断魄交替，每次 20–41% 攻击力，攻击特效 25%，+25% 移动速度）；地霜暗蚀（需要坠明目标：对所有被减速的敌人造成 50–140 + 32–50% 额外攻击力 + 70% 法术强度的魔法伤害并禁锢 1 秒）；暝涌（40° 650 码锥形：20–110 + 15–21% 额外攻击力 + 70% 法术强度，随后副手武器攻击每个被命中的敌人）；驻灵（掷到 475 码内，0.35 秒后启动，持续 20 秒，敌人进入 500 码后变为 4 秒，以厄斐琉斯的攻击速度用副手武器攻击，造成 35–125 + 34–52% 额外攻击力 + 50% 法术强度）。
  - **W（月相轮转）**：交换主手和副手；每把武器保留自己的 Q 冷却。
  - **R（清辉夜凝）**：0.5 秒后一团月光（速度 2050，1300 码，武器拖出一道月光光束）在第一个敌人处停下，对周围 300 码造成 125/175/225 + 20% 额外攻击力 + 100% 法术强度的伤害，随后厄斐琉斯用主手武器攻击每个目标：通碧施加 50/80/110 的标记，断魄回复 250/350/450，坠明造成 99% 减速（地霜暗蚀禁锢 1.35 秒），荧焰 +50/100/150 + 25% 额外攻击力和一圈弹丸，折镜 +5 个飞轮刃并每个目标再加一个。
  - 非英雄联盟原版：针对英雄的效果对任何敌人生效（R 的光束在第一个敌人处停下、断魄 R 的治疗、飞轮刃的刷新）；敌人不会攻击驻灵（持续到时间结束）。
- **两步升级**：
  1. 按英雄联盟规则提升一个技能等级：基础技能在 1/3/5/7/9 级，R 在 6/11/16 级（厄斐琉斯：属性点，见上文）。没有可升级的技能时跳过此步。
  2. 从随机的 3 件装备中选 1 件（出装完成后改为药水）。
- **装备**：Data Dragon 的真实数据（属性、名称、图标），由 `tools/build_items.py` 生成到 `src/items.json`；被动在 `src/itemPassives/`。
  - 没有合成：升级时提供一件传说成装，或为已有装备提升一级，就像幸存者类游戏的武器。背包最多 6 件装备；不能丢弃。
  - 每件装备有 5 级。属性从 40%（1 级）成长到 100%（5 级）；被动在 3 级解锁，强度 60%，4 级 80%，5 级 100%。魔宗、大天使之杖和凛冬之临在 5 级获得转化后的被动（魔切、炽天使之拥、末日寒冬）。
  - 装备池：召唤师峡谷的全部传说装备，除了带主动效果的装备（中娅沙漏、幽梦之灵、九头蛇系列……）、辅助装备、重伤装备（凡性的提醒、炼金朋克链锯剑、莫雷洛秘典；荆棘之甲只保留反伤）以及需要视野或英雄护盾的被动（暗行者之爪、毒蛇之牙）。物理英雄获得攻击装备，法术英雄获得法强装备，坦克和混合装备两者都有。
  - 被动针对怪潮调整："英雄"触发改为击杀精英 / 史诗野怪；法术护盾格挡下一次受到的伤害。
  - 每个英雄的推荐出装（OP.GG，16.21 版本）：出现概率为三倍，并标记为“推荐”。伊泽瑞尔：三相之力、魔宗、朔极之矛、赛瑞尔达的怨恨、无穷饥渴、守护天使。莎弥拉：收集者、无尽之刃、多米尼克领主的致意、不朽盾弓、饮血剑、守护天使。布兰德：黑焰火炬、瑞莱的冰晶节杖、兰德里的折磨、影焰、灭世者的死亡之帽、虚空之杖。厄斐琉斯：收集者、无尽之刃、多米尼克领主的致意、卢安娜的飓风、守护天使、饮血剑。
  - 出装完成（6 件装备均为 5 级）：升级时提供生命药水或法力药水（恢复 5% 最大值），每次击杀有 1% 概率掉落图纸（蓝色卷轴，每局 1 张），使随机一件装备变为传说（属性 +50%；该格获得动态金色光环与“传说”标签）。
  - 鞋子：六格之外的第 7 格。5:00 获得鞋子（+25 移动速度）；击杀峡谷迅捷蟹后可选择一双二级鞋（镀甲之靴带镀层：物理攻击造成的伤害降低 10%）；击杀小龙后升级为三级鞋（仅属性）。
  - 节奏：整局游戏从 0:00 的 x1 逐渐加速到 5:00 的 x2，之后保持 x2。
  - 站立不动：受到的伤害（护甲减免后）在 5 秒不移动后最多提高到 x5。
  - ESC 菜单：显示英雄全部属性以及每件装备的属性与被动。
  - 抗性：物理伤害被敌人的护甲减免（护甲穿透、穿甲），魔法伤害被魔法抗性减免（法术穿透；野怪的魔抗为护甲的一半，小兵没有）。远程敌人的弹道造成魔法伤害（被你的魔抗减免），近战攻击造成物理伤害。
- **远程敌人**：沿直线发射技能弹，瞄准伊泽瑞尔先前的位置，射程有限。可以躲避。
- **难度曲线**：开局时，1 次普攻或 1 个技能就能击杀。
  - 生命值：基础 × `(1 + 0.08 × (等级 − 1)) × (1 + 时间 / 900 s)`。
  - 伤害：基础 × `(1 + 时间 / 600 s)`。
  - 史诗野怪生命值固定。
  - 在 `enemyHpScale` / `enemyDamageScale`（`src/data.ts`）中调整。
- **经验**：击杀时自动吸收。
- **浮动文字**：造成的伤害（白色 = 物理，蓝色 = 魔法，橙色 = 暴击）、受到的伤害（红色）和获得的经验（紫色）。
- **刷怪导演**：每秒敌人数 = `0.45 + 0.04×(等级−1) + 时间/450`。
  - 该值再乘以 0.6–1.3，取决于玩家击杀了最近 20 秒内出现敌人的比例。
  - 存活敌人数量有上限：`12 + 2×等级 + 时间/8`。
  - 在 `DIRECTOR`（`src/data.ts`）中调整。
- **怪潮**：每 2 分钟，`15 + 2×等级` 个弱小敌人组成的圆环在玩家周围收拢，留有 90° 的缺口用于逃脱。提前 6 秒出现警告。
- **进程（幸存者风格）**：
  - 0–5 分钟：小兵。
  - 3 分钟起：锋喙鸟、暗影狼、石甲虫、魔沼蛙。
  - 首领：峡谷迅捷蟹（5:00）、亚龙（10:00，元素从山脉、云端、海洋、海克斯科技、炼狱和化学科技中随机；增益尚未实现）、峡谷先锋（15:00）、纳什男爵（20:00）。
  - 首领之间的精英：蓝色哨兵（7:30）、红色树精（12:30）、两者同时出现（17:30）。
  - 在 `EVENTS`（`src/data.ts`）中调整。
- **纳什男爵（20:00）**：几乎不可能击杀（15 万生命值）。击杀它即赢得本局。
  - 它出现时，其他所有敌人死亡，之后不再刷新任何敌人（包括怪潮）。
  - 一个圆形竞技场（半径 1500）在伊泽瑞尔和男爵周围合拢。无法走出去。
  - 如果伊泽瑞尔离开（例如用奥术跃迁越过墙），触手会把他拉回来。
  - 有施法时间和地面标记的技能：
    - 地面圆圈：1 秒后击飞并眩晕（最多约 500 伤害，不会致死）。
    - 从伊泽瑞尔先前位置钻出的触手：致死。
    - 直线酸液喷吐：致死。
  - 靠近男爵时：33% 概率撕咬（吞噬，瞬发，无法躲避）。否则为锥形鞭击：75% 最大生命值，不会致死。
  - 在 `BARON`（`src/data.ts`）中调整；行为在 `src/enemies/baron.ts`。

## 架构（在哪里添加内容）

- **英雄**（`src/champion.ts`、`src/champions/`）：一个英雄由 `ChampionDef`（基础属性、技能的等级/消耗/冷却/动画/图标、动画、普攻特效）加一个每局创建的 `kit` 组成，`kit` 负责处理技能及其特殊机制（层数、标记等）。`Game` 负责通用部分：移动、普攻、冷却、法力、装备和伤害管线。
  - 新英雄：创建 `src/champions/<name>.ts`（模板：`ezreal.ts`；法术强度法师、持续伤害和逐敌标记参考 `brand.ts`），并在 `src/champions/index.ts` 中注册。音效命名遵循 `<id>_auto`、`<id>_Q`、`<id>_death`……分步指南：`.claude/skills/creating-champions/SKILL.md`。
  - kit 钩子：`cast`（必需）、`castStart`、`castAnim`、`canCast`、`attackSpeedBonus`/`moveSpeedBonus`、`disarmed`、`meleeAuto`、`onDamage`（减免前的额外魔法伤害，例如引爆 W 的标记）、`onKill`（例如炽热之焰的击杀回蓝）、`onDealt`（减免后的伤害，例如断魄的治疗）、`update`、`dispose`、`hud`、`gauge`。有多种形态的英雄（厄斐琉斯的武器）：`stat`（自身属性，例如购买的属性点）、`attackTarget`/`attackStart`/`basicAttack`（普攻的目标、动画、音效、前摇以及发射）、`moveAnims`、`cooldownBase`/`castTime`（按形态）、`skillView`（技能栏图标、名称和角标）和 `tray`（技能栏上方的小图标）。
  - `ChampionDef` 扩展：`idleVfx`（整局附着在骨骼上的系统，例如布兰德的火焰）、`vfx.death`、`scale`（模型大小）、法师使用 `itemPool: 'ap'`（技能用 `apRatio` 缩放）、`build`（出装网站推荐的 6 件传说装备，升级时出现概率更高并带标记）、`rankLevels`（每个技能等级的解锁等级）、`autoRank`（无需技能点自动升级的技能）和 `SkillDef.unlockLevel`（从某个等级起可施放，与技能等级无关）。
  - 对敌人的控制：`game.slow(e, pct, s)`、`game.stunEnemy(e, s)` 和 `game.rootEnemy(e, s)`（不能移动，仍可攻击）（仅通用循环；首领 AI 忽略后两者）。
  - 投射物：`game.spawnMissile(vfx, from, to, { hit, target | pierce, onHit, ... })`。没有 `onHit` 时，默认命中效果会应用特效、音效和伤害。
- **装备被动**（钩子在 `src/itemEffects.ts`，条目在 `src/itemPassives/ad.ts`、`ap.ts`、`tank.ts`）：每个条目包含描述（最高等级的数值）和钩子工厂 `effect(g, power)`（`onHit`、`onHitMagic`、`onAttack`、`onCast`、`onDealt`、`onKill`、`onHurt`、`onStruck`、`onOverheal`、`tick`、`onLethal`、`stat`、`damageMult`……）。`power()` 是被动在装备当前等级的强度（0.6/0.8/1）：效果的数值乘以它，全有或全无的效果（复活、法术护盾）则延长冷却。通用机制在 `src/itemPassives/shared.ts`：咒刃、救主灵刃、法术护盾、灼烧、充能。`unique` + `rank` 复现英雄联盟的唯一被动（只有最强的一个生效）。属性仍在 `items.json` 中。
- **敌人**（`src/data.ts` + `src/enemies/`）：普通敌人只需要一个 `EnemyDef`。自定义行为在 `AI` 中注册；有特殊规则的时间线事件（随机亚龙、男爵竞技场）在 `SPAWNERS` 中注册生成器。`src/hazards.ts` 包含首领用的地面标记和喷发效果。
- **性能**：敌人存放在空间网格中（`src/spatial.ts`），因此单位碰撞、目标选择、投射物和光环只查询邻近单位（以前的碰撞是 O(n²)）。每帧列表原地过滤（`compact`），刷怪/击杀窗口为均摊 O(1)，玩家停留在同一区块时地图不做任何重建，HUD 只在数值变化时写入 DOM。远离英雄的敌人每 3 帧更新一次动画。

## 已知限制 / 下一步

- 粒子：子粒子集（`childParticleSetDefinition`）跟随父粒子，生成在粒子蒙皮网格的骨骼上（`.skn` 以绑定姿势静态绘制，`.skl` 骨骼由 `build_vfx.py` 导出）。已支持 `VfxPrimitiveBeam`（从粒子到系统的 `target`，或到自身的目标偏移；网格沿 Z 轴拉伸；地面层光束贴在地面上）、`VfxPrimitiveRay`、`VfxPrimitiveAttachedMesh`（把所属模型的蒙皮网格重绘为光效或定格姿势的残影）、力场（加速度、阻力、吸引）和 `FlexShapeDefinition`（按目标大小缩放）。未实现：环绕/噪声力场、扭曲；附着网格忽略出生缩放、UV 滚动和溶解。施法特效跟随皮肤动画事件指定的骨骼（`Actor.bone`、`Vfx.playOn`）；设置 `ChampionDef.animVfx` 后由游戏自动播放这些事件（`build_vfx.py` 生成的 `events.json`：每个动画片段的粒子事件；被多个效果不同的变体共用的片段文件交给 kit 处理）。`blendMode` 缺失/4 = 加法混合，1 = alpha（根据纹理推断，无文档）。
- 源 `.glb` 文件很大（伊泽瑞尔 29 MB，男爵 45 MB）；`pnpm build:prod`（`tools/optimize.mjs`）会移除代码未使用的动画片段，重采样并用 meshopt 压缩（伊泽瑞尔 1.9 MB，男爵 1.9 MB）。
- 每个敌人都是带独立 mixer 的 SkinnedMesh，存活上限 260（`MAX_ENEMIES`）。要支持更大的怪潮：烘焙到纹理的动画 + 实例化。
- 亚龙：动画共用 `sru_dragon`。炼狱亚龙和山脉亚龙使用云端亚龙的网格（`sru_dragon_air`）配自己的纹理，与原游戏一致（`EnemyDef.mesh`）。

## 法律声明

非商业的粉丝项目，遵循 Riot Games 的 "Legal Jibber Jabber" 政策。英雄联盟及其所有资源归 Riot Games, Inc. 所有。请勿分发提取出的模型。
