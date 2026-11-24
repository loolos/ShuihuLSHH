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
| `gudasao/` | 顾大嫂（女假人，双短刀）：idle、walk、hit-chest、defend 格挡、death01、roll、slash-a/b/c 单斩、slash-combo 连斩、heavy-combo 重斩连招、dash 冲刺斩、throw 飞刀。配方 `gamedata/models/characters/gudasao.json` |
| `shixiu/` | 石秀（深蓝短褂、朴刀）：同顾大嫂的剑术动作（没有 throw），待机用 Sword_Idle。配方 `characters/shixiu.json` |
| `daizong/` | 戴宗（褐短褂、幞头、腿绑甲马）：idle、walk、hit-chest、crouch-idle（聚气 / 防御）、death01、roll、punch-jab、punch-two（×2）、punch-cross、kick-r / kick-l / kick-rl（左右踢）、ninja-jump 腾跃、slide 滑铲。配方 `characters/daizong.json` |
| `husanniang/` | 扈三娘步战造型（配色对齐骑马版：青绿战袍、红围巾、金盔红缨、日月双刀；女假人）：idle（双刀护身）、walk、hit-chest、defend、death01、roll、slash-a/b/c、slash-combo、heavy-combo、dash、crouch-idle。还没有职业用它（战斗里仍是骑兵 43 换色），配方 `characters/husanniang.json` |
| `sunli/` | 孙立（病尉迟：乌铁甲罩蓝紫战袍、紫抹额、络腮胡，右手竹节钢鞭；动作借 Mixamo 单手斧包 `AXE_`）：idle（持鞭站立）、walk、hit、defend（格挡）、strike（钢鞭下砸）、combo（单鞭连环）、battlecry（聚气）、leap（跃起砸地，病尉迟枪）、spin（旋身两鞭，鞭枪双绝）。配方 `characters/sunli.json` |
| `tiger/` | idle 待机、walk 走、attack 扑咬、attack-paw 拍击、hit-back 受击、go-to-sleep 伏下（倒地 / 伏低） |

## 来源与授权

- **武松**：Quaternius「Universal Animation Library」`UAL1_Standard.glb`。授权 CC0 1.0（公有领域）。衣服由 `src/outfit-wusong.json` 生成。
- **李逵**：同一个 `UAL1_Standard.glb`，CC0 1.0。坎肩、红腰带、宽裤、裹腿、发髻、络腮胡、两把板斧由 `src/outfit-likui.json` 生成（原在江州外传包，外传删除后搬到这里）。
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
