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
| `wusong/` | idle 待机、walk 走、hit-chest 受击、punch-jab / punch-cross 出拳、kick 右脚踢 / kick-four 左右交替踢（玉环鸳鸯脚）、death01 倒地、roll 翻滚（闪避）、crouch-idle 蹲伏（防御） |
| `likui/` | idle 待机（持斧）、walk 走、hit-chest 受击、sword-attack 劈砍、punch-cross 连劈、crouch-idle 蹲伏（防御 / 运气）、death01 倒地、roll 翻滚 |
| `tiger/` | idle 待机、walk 走、attack 扑咬、attack-paw 拍击、hit-back 受击、go-to-sleep 伏下（倒地 / 伏低） |

## 来源与授权

- **武松**：Quaternius「Universal Animation Library」`UAL1_Standard.glb`。授权 CC0 1.0（公有领域）。衣服由 `src/outfit-wusong.json` 生成。
- **李逵**：同一个 `UAL1_Standard.glb`，CC0 1.0。坎肩、红腰带、宽裤、裹腿、发髻、络腮胡、两把板斧由 `src/outfit-likui.json` 生成（原在江州外传包，外传删除后搬到这里）。
- **老虎**：Sketchfab 上 planeta-elefante 的「Tiger」模型。授权 CC BY 4.0，**游戏里要署名**（制作人员名单写：Tiger model by planeta-elefante, CC BY 4.0）。

模型文件本身不入库。要重新渲染，先把模型下载到本地。

## 重新生成

```sh
uv venv --python 3.13 venv && uv pip install --python venv bpy==5.2.4
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/wusong --scale-by mesh --height 1.75 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-wusong.json \
  --actions Idle_Loop,Walk_Loop,Hit_Chest,Punch_Jab,Punch_Cross,Death01,Roll,Crouch_Idle_Loop
# 模型里没有踢腿：用 --poses 按关键帧自拼（Kick_R、Kick_L），渲染后 kick-rl = Kick_R 8 帧 + Kick_L 8 帧横向拼接
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/kick --scale-by mesh --height 1.75 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-wusong.json \
  --poses packs/mainline/sprites/src/poses-wusong.json --actions Kick_R,Kick_L
venv/bin/python tools/render-sprites.py tiger.glb out/tiger --length 2.2 --ppm 50 --frames 8 --samples 8 \
  --actions "Idle,Walk,Attack,Attack Paw,Hit Back,Go To Sleep"
```

李逵（`punch-cross` 双斧连劈单独用 `src/outfit-likui-thrust.json` 渲染，斧柄顺着手臂朝前；劈砍 `sword-attack` 每帧在 `sprites.json` 里改成 100 ms）：

```sh
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/likui --scale-by mesh --height 1.85 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/mainline/sprites/src/outfit-likui.json \
  --actions Sword_Idle,Walk_Loop,Hit_Chest,Sword_Attack,Punch_Cross,Crouch_Idle_Loop,Death01,Roll
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/likui-thrust ...同上参数... \
  --outfit packs/mainline/sprites/src/outfit-likui-thrust.json --actions Punch_Cross
```

渲染完要改文件名：动作名改成小写，用连字符连接，去掉 `_Loop`。
