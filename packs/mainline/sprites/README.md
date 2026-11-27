# 武松打虎 · 精灵图条

《武松打虎》外传要用的新人物动画，由 `tools/render-sprites.py` 从 3D 模型渲染而来，制作流程见 `docs/game-design.md` §15.6。

## 格式

- 每个动作有正面（`-front`）和背面（`-back`）两条，另外两个朝向由游戏水平镜像。
- 每条图横排 8 帧，每帧 160×160，脚底锚点在 (80,120)。
- 颜色已经缩到原版 `Default.pal`，影子用第 159 色。
- `sprites.json` 记录每个动作的文件、帧数、每帧毫秒数，`source` 是模型里的动作原名。
- 接入扩展包时，再打包成 §15.2 说的图集。

| 目录 | 动作 |
|---|---|
| `wusong/` | idle 待机（抱臂，UAL2 `Idle_FoldArms_Loop`）、walk 走、hit-chest 受击、punch-jab / punch-cross 出拳、kick 右脚踢 / kick-four 左右交替踢（玉环鸳鸯脚）、death01 倒地、roll 翻滚（闪避）、crouch-idle 蹲伏（防御） |
| `likui/` | idle 待机（单手举斧，`Pistol_Idle_Loop`）、walk 走、hit-chest 受击、sword-attack 劈砍、punch-cross 连劈、crouch-idle 蹲伏（防御 / 运气）、death01 倒地、roll 翻滚 |
| `peiruhai/` | 裴如海（光头和尚）：idle 待机、walk 走、hit-chest 受击、punch-jab 出拳（念珠）、crouch-idle 蹲伏（防御）、death01 倒地。服装 `src/outfit-peiruhai.json`，`--height 1.72`，其余参数同武松 |
| `gudasao/` | 顾大嫂（女假人，双短刀）：idle、walk、hit-chest、defend 格挡、death01、roll、slash-a/b/c 单斩、slash-combo 连斩、heavy-combo 重斩连招、dash 冲刺斩、throw 飞刀。配方 `gamedata/models/characters/gudasao.json`；spin（Mixamo 斧包 360 度旋斩，母大虫旋刀） |
| `shixiu/` | 石秀（深蓝短褂、朴刀）：同顾大嫂的剑术动作（没有 throw），待机用 Sword_Idle。配方 `characters/shixiu.json` |
| `daizong/` | 戴宗（褐短褂、幞头、腿绑甲马）：idle、walk、hit-chest、crouch-idle（聚气 / 防御）、death01、roll、punch-jab、punch-two（×2）、punch-cross、kick-r / kick-l / kick-rl（左右踢）、ninja-jump 腾跃、slide 滑铲。配方 `characters/daizong.json` |
| `husanniang/` | 扈三娘步战造型（配色对齐骑马版：青绿战袍、红围巾、金盔红缨、日月双刀；女假人）：idle（双刀护身）、walk、hit-chest、defend、death01、roll、slash-a/b/c、slash-combo、heavy-combo、dash、crouch-idle。还没有职业用它（战斗里仍是骑兵 43 换色），配方 `characters/husanniang.json` |
| `sunli/` | 孙立（病尉迟：乌铁甲罩蓝紫战袍、紫抹额、络腮胡，右手竹节钢鞭；动作借 Mixamo 单手斧包 `AXE_`）：idle（持鞭站立）、walk、hit、defend（格挡）、strike（钢鞭下砸）、combo（单鞭连环）、battlecry（聚气）、leap（跃起砸地，病尉迟枪）、spin（旋身两鞭，鞭枪双绝）、shoot（左手持弓放箭，弯弓压阵；这一条另用 `characters/sunli-bow.json` 渲染，把钢鞭换成弓）。配方 `characters/sunli.json` |
| `jiezhen/` | 解珍（橙头巾、虎皮坎肩 / 虎皮裙、浑铁点钢叉）：idle（Spear_Idle）、walk、hit、defend、thrust、smash、sweep、two-head（刺 + 砸）、power-up（聚气）、shoot（窝弓药箭，`jiezhen-bow.json` 换弓渲染）。配方 `characters/jiezhen.json` |
| `jiebao/` | 解宝（绿头巾、豹斑皮坎肩、绿裤、钢叉）：idle（Staff_Idle）、walk、hit、defend、thrust、sweep、smash、two-tail（扫 + 砸）、chest-thump（聚气）。配方 `characters/jiebao.json` |
| `jiezhen-jia/`、`jiebao-jia/` | 带枷的解珍、解宝（去掉钢叉，脖子上套木枷）：idle、walk、hit、defend、ram（枷撞）、spin（枷打）。配方 `characters/jiezhen-jia.json`、`jiebao-jia.json` |
| `tiger/` | idle 待机、walk 走、attack 扑咬、attack-paw 拍击、hit-back 受击、go-to-sleep 伏下（倒地 / 伏低） |
| `wolf/`、`fox/` | 狼、狐狸：idle 待机、walk 走、attack 扑咬、pounce 飞扑（`Gallop_Jump`）、hit 受击、defend 低头伏身（`Idle_2_HeadLow`）、death 倒地 |
| `stag/`、`donkey/`、`cow/`、`bull/` | 鹿、驴、牛、公牛：idle、walk、headbutt 低头顶、kick 后踢、charge 奔跑（`Gallop`）、hit、defend 低头（`Idle_Headlow`）、death |
| `lion/` | 狮子：idle、walk、bite 扑咬（`Attack Jaw`）、paw 拍击（`Attack Right Paw`）、pounce 飞扑（`Jumping`，带前冲位移）、roar 吼（也当防御）、recoil 后退（`Walk Back`，当受击；模型没有受击动作）、death |
| `bear/` | 熊：idle（`Stand_Idle_01`）、walk（原动作带根位移，渲染后按身体质心逐帧对齐成原地走）、rear-swipe 人立拍击（`Attack_StandAngry_01_High`）、hit（`Hit_Stand_F01`）、defend（`StandAngry_Breathing_01`）、death（`Death_Stand_R01`）。模型里 `_L` / `_R`、`Attack_StandAngry_01_Low` 等动作中途会转身，没用 |
| `boar/` | 野猪：idle、walk（`Walk_F_IP`）、gore 拱（`Attack_F`）、gore-up 挑（`Attack_Up`）、charge 冲撞（`Attack_Run_IP`）、hit（也当防御）、death（`Death_L`） |

## 来源与授权

- **武松**：Quaternius「Universal Animation Library」`UAL1_Standard.glb`。授权 CC0 1.0（公有领域）。衣服由 `src/outfit-wusong.json` 生成。
- **李逵**：同一个 `UAL1_Standard.glb`，CC0 1.0。坎肩、红腰带、宽裤、裹腿、发髻、络腮胡、两把板斧由 `src/outfit-likui.json` 生成（原在江州外传包，外传删除后搬到这里）。
- **狼、狐狸、鹿、驴、牛、公牛**：Quaternius「Ultimate Animated Animals」，CC0 1.0。模型在 `gamedata/models/animals/`。渲染参数：`--frames 8 --length 1.6`（狼）/ `1.0`（狐）/ `1.7`（鹿）/ `1.5`（驴）/ `1.9`（牛）/ `2.1`（公牛），其余默认（不用 `--outfit`，模型自带纯色材质）；`--actions` 只渲染上表用到的动作，再按上表改名。
- **狮子**：Sketchfab「Lion」by planeta-elefante（和老虎同一作者），CC BY 4.0，`--yaw 180 --length 1.7`。
- **熊**：Sketchfab「Realistic Animated Bear 3D Model」by WildMesh 3D，CC BY 4.0，`--yaw 0 --length 1.4`。
- **野猪**：Sketchfab「Wild Boar - Male」by Dakta.Grower.Nzl，CC BY 4.0。原文件没有贴图（全白），把材质 `baseColorFactor` 改成深棕 (0.08, 0.055, 0.04) 再渲染，`--yaw 45 --length 1.1`。
- 这三个原始模型较大（熊 14 MB、野猪 16 MB），只放在项目文件夹 `shuihu-design/models/animals/`，不入库；三者都要在游戏里署名（已写进 pack.json 的 credits）。
- 注意：一次渲染多个动作时，狮子的 idle 正面条第一次渲染成了倒地姿势（紧跟在 Death 后面），单独重渲 `--actions Idle` 就正常；渲完要逐条看一眼。
- **老虎**：Sketchfab 上 planeta-elefante 的「Tiger」模型。授权 CC BY 4.0，**游戏里要署名**（制作人员名单写：Tiger model by planeta-elefante, CC BY 4.0）。

2026-11-23 起通用假人和动作库已入库（`gamedata/models/`），新人物按配方用 `tools/render-character.py` 渲染，见 `gamedata/models/README.md`。

## 重新生成

```sh
uv venv --python 3.13 venv && uv pip install --python venv bpy==5.2.4
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/wusong --anims UAL1_Standard.glb,UAL2_Standard.glb --scale-by mesh --height 1.75 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-wusong.json \
  --actions Idle_FoldArms_Loop,Walk_Loop,Hit_Chest,Punch_Jab,Punch_Cross,Death01,Roll,Crouch_Idle_Loop
# 模型里没有踢腿：用 --poses 按关键帧自拼（Kick_R、Kick_L），渲染后 kick-rl = Kick_R 8 帧 + Kick_L 8 帧横向拼接
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/kick --scale-by mesh --height 1.75 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-wusong.json \
  --poses packs/mainline/sprites/src/poses-wusong.json --actions Kick_R,Kick_L
venv/bin/python tools/render-sprites.py tiger.glb out/tiger --length 2.2 --ppm 50 --frames 8 --samples 8 \
  --actions "Idle,Walk,Attack,Attack Paw,Hit Back,Go To Sleep"
```

李逵（`punch-cross` 双斧连劈单独用 `src/outfit-likui-thrust.json` 渲染，斧柄顺着手臂朝前；劈砍 `sword-attack` 每帧在 `sprites.json` 里改成 100 ms）：

```sh
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/likui --anims UAL1_Standard.glb,UAL2_Standard.glb --scale-by mesh --height 1.85 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-likui.json \
  --actions Pistol_Idle_Loop,Walk_Loop,Hit_Chest,Sword_Attack,Punch_Cross,Crouch_Idle_Loop,Death01,Roll
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/likui-thrust ...同上参数... \
  --outfit packs/mainline/sprites/src/outfit-likui-thrust.json --actions Punch_Cross
```

渲染完要改文件名：动作名改成小写，用连字符连接，去掉 `_Loop`。
