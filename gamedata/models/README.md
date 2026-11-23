# 通用人物模型（3D 渲染精灵的原料）

新人物的动画用 3D 假人 + 分层服装渲染（`docs/game-design.md` §15.6）。这里放可以反复用的原料：身体、动作库、服装底版、每个人物的配方。游戏运行时不读这个目录。

## 文件

| 文件 | 内容 |
|---|---|
| `UAL1_Standard.glb` | Quaternius「Universal Animation Library」：男性假人 + 43 个动作（待机、走、跑、出拳、单手剑、受击、倒地、翻滚、蹲伏…） |
| `UAL2_Standard.glb` | Quaternius「Universal Animation Library 2」：男性假人 + 43 个动作（剑术连招、格挡、冲刺、跳跃、投掷、击退…） |
| `Mannequin_F.glb` | UAL2 附带的女性假人，没有动作；骨骼和 UAL1 / UAL2 完全相同，两个库的动作都能直接用 |
| `LICENSE-Quaternius.txt` | 授权：CC0 1.0（公有领域），不用署名 |
| `outfits/male-base.json` | 男性服装底版（头巾、白中衣、交领短褂、腰带、宽裤、裹腿、发髻） |
| `outfits/female-base.json` | 女性服装底版（短袄、围裙、长裙、发髻、金钗、头花、镯子） |
| `outfits/weapon-*.json` | 兵器：`weapon-knives` 双短刀，`weapon-podao` 朴刀 |
| `outfits/weapon-spear\|staff\|dadao\|bow.json` | 双手兵器（长枪、齐眉棍、长柄大刀、弓）：写在服装的 `weapon` 里，渲染时会在骨架上加兵器骨骼（见下） |
| `poses/weapons.json` | 自拼的兵器动作：`Spear_` / `Staff_` / `Blade_` 加 `Idle`、`Thrust`（突刺）、`Sweep`（横扫）、`Smash`（下劈），`Bow_Shoot`（拉弓放箭） |
| `characters/<id>.json` | 人物配方 |

所有动作名：`python3 -c "import json,struct;d=open('gamedata/models/UAL2_Standard.glb','rb').read();n=struct.unpack('<I',d[12:16])[0];print([a['name'] for a in json.loads(d[20:20+n])['animations']])"`，也可以在 <https://quaternius.com/animviewer.html> 里看。

## 人物配方

```json
{
 "name": "石秀",
 "body": "male",                         // male = UAL1 假人，female = Mannequin_F
 "height": 1.78,                         // 身高（米）
 "outfit": ["outfits/male-base.json", "outfits/weapon-podao.json"],   // 底版，可写多个，依次叠加
 "remove": ["头巾"],                      // 去掉底版里的部件（按 name）
 "colors": {                             // 换色（按 name）；"skin" 是皮肤
   "短褂": {"color": [46, 54, 100], "colors": [[28, 32, 64], null, null]},   // 主色 + 第 i 条包边色（null = 不改）
   "腰带": [150, 118, 76]
 },
 "add": {"layers": [...], "props": [...], "rules": [...]},   // 追加部件，写法同 render-sprites.py --outfit
 "poses": "packs/mainline/sprites/src/poses-wusong.json",    // 自拼动作（踢腿等），可省
 "out": "packs/mainline/sprites/shixiu",
 "frames": 8,
 "actions": {"idle": "Sword_Idle", "slash-combo": {"from": "Sword_Regular_Combo", "frames": 12, "ms": 80}},
 "concat": {"kick-rl": {"of": ["kick-r", "kick-l"]}},        // 几条拼成一条
 "alias": {"slash-two": {"of": "slash-a", "ms": 85, "cycles": 2}},  // 同一条图换速度 / 重复
 "render": {"toonRange": [0.75, 1.15]}   // 可省：平涂明暗最暗 / 最亮档（默认 0.55 / 1.05），调高人物整体更亮
}
```

换个颜色做新人物：复制一份配方，改 `colors` 和 `out`，再渲染一次。

## 双手兵器

UAL 两个库只有刀剑、拳脚、投掷类动作。枪、棍、大刀、弓用 `poses/weapons.json` 自拼：服装里写了 `weapon` 时，`render-sprites.py` 会在骨架上加两根兵器骨骼——普通动作（走、待机、受击）里兵器挂在手上；带 `weapon` 的自拼动作里兵器按世界坐标单独摆（`at` 握点、`dir` 兵器指向、`up`），两只手的前臂用 IK 自动去握 `grips` 指定的位置（数字 = 沿兵器轴离握点多远；弓的右手写 `[横, 沿弓轴, 前后]`）。要用这些动作，配方里写 `"poses": "poses/weapons.json"`，再在 `actions` 里映射，如 `"spear-thrust": "Spear_Thrust"`。新动作照 `weapons.json` 的写法加关键帧。

## Mixamo 动作（不进 repo）

Mixamo（Adobe 免费动捕库）的授权不许公开原文件，所以原文件和转好的动作库都放项目文件夹 `/mnt/project-files/shuihu-design/models/mixamo/`（每个云端 thread 都能读），repo 里只放渲染出来的图条。

| 动作库 | 前缀 | 内容 |
|---|---|---|
| `mixamo/mixamo-great-sword.glb` | `GS_` | Great Sword Pack：双手大剑待机、劈砍 ×5、旋身斩、跳劈、滑步斩、格挡、受击、倒地… |
| `mixamo/mixamo-sword-shield.glb` | `SS_` | Sword and Shield Pack：单手刀（盾）攻击 ×4、劈砍 ×4、格挡、踢、受击、倒地… |
| `mixamo/mixamo-longbow.glb` | `BOW_` | Pro Longbow Pack：拉弓瞄准、放箭后坐、抽箭、闪避、近身踢打、受击、倒地… |
| `mixamo/mixamo-axe.glb` | `AXE_` | Pro Melee Axe Pack：下劈、横斩、反手、360 旋斩（高 / 低）、三种连击、跳斩、战吼、格挡、受击… |

动作名 = 前缀 + 原文件名（小写、符号换成下划线），如 `GS_great_sword_slash_4`、`AXE_standing_melee_attack_downward`。配方里加 `"extraAnims": ["mixamo/mixamo-axe.glb"]` 就能用（`render-character.py` 会到项目文件夹找；别的位置用环境变量 `SHUIHU_PRIVATE_MODELS` 指定）。

新下载的 Mixamo 包（FBX、With Skin、30 fps）先放进同一个文件夹，再转换：

```sh
python tools/retarget-mixamo.py /mnt/project-files/shuihu-design/models/mixamo/mixamo-<名字>.glb 解压目录/*.fbx --prefix XX_
```

转换时人原地做动作（去掉骨盆的水平位移，免得跑出格子）；要保留冲刺位移加 `--keep-travel`。

## 渲染

```sh
pip install bpy            # 或 uv venv --python 3.13 venv && uv pip install --python venv bpy
python tools/render-character.py gamedata/models/characters/shixiu.json                 # 全部动作，8 帧
python tools/render-character.py gamedata/models/characters/shixiu.json --only idle,walk --frames 3 --samples 8 --out /tmp/try   # 试渲染
```

输出 `<动作>-front.png` / `<动作>-back.png` 和 `sprites.json`，格式同 `packs/mainline/sprites/README.md`。职业里写 `"sprite": {"sheet": "sprites/shixiu", "idle": "idle", ...}`，技能 `anim` 用这里的动作名。

服装坐标是假人静止姿势下的世界坐标（米，正面朝 −Y，右手在 −X，Z 向上）：骨盆 0.92、胸 1.31、颈 1.49、头 1.57、头顶 1.83；手 x≈±0.80, z≈1.43；膝 0.53，踝 0.10。女假人略矮，底版已经按它调过。
