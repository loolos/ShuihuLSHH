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
| `wusong/` | idle 待机、walk 走、hit-chest 受击、punch-jab / punch-cross 出拳、death01 倒地、roll 翻滚（闪避）、crouch-idle 蹲伏（防御） |
| `tiger/` | idle 待机、walk 走、attack 扑咬、attack-paw 拍击、hit-back 受击、go-to-sleep 伏下（倒地 / 伏低） |

## 来源与授权

- **武松**：Quaternius「Universal Animation Library」`UAL1_Standard.glb`。授权 CC0 1.0（公有领域）。衣服由 `src/outfit-wusong.json` 生成。
- **老虎**：Sketchfab 上 planeta-elefante 的「Tiger」模型。授权 CC BY 4.0，**游戏里要署名**（制作人员名单写：Tiger model by planeta-elefante, CC BY 4.0）。

模型文件本身不入库。要重新渲染，先把模型下载到本地。

## 重新生成

```sh
uv venv --python 3.13 venv && uv pip install --python venv bpy==5.2.4
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/wusong --scale-by mesh --height 1.75 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/wusong/sprites/src/outfit-wusong.json \
  --actions Idle_Loop,Walk_Loop,Hit_Chest,Punch_Jab,Punch_Cross,Death01,Roll,Crouch_Idle_Loop
venv/bin/python tools/render-sprites.py tiger.glb out/tiger --length 2.2 --ppm 50 --frames 8 --samples 8 \
  --actions "Idle,Walk,Attack,Attack Paw,Hit Back,Go To Sleep"
```

渲染完要改文件名：动作名改成小写，用连字符连接，去掉 `_Loop`。
