# 江州好汉 · 精灵图条

| 目录 | 动作 |
|---|---|
| `likui/` | idle 待机（持斧）、walk 走、hit-chest 受击、sword-attack 劈砍、punch-cross 连劈、crouch-idle 蹲伏（防御 / 运气）、death01 倒地、roll 翻滚 |

戴宗没有新图：借原版都頭（38）的动画换色，见 `pack.json` 和 `docs/game-design.md` §15.2。

格式同 `packs/wusong/sprites/README.md`（每帧 160×160，锚点 (80,120)，正面 / 背面两条）。

## 来源与授权

- **李逵**：Quaternius「Universal Animation Library」`UAL1_Standard.glb`，CC0 1.0。坎肩、红腰带、宽裤、裹腿、发髻、络腮胡、两把板斧由 `src/outfit-likui.json` 生成。

## 重新生成

```sh
venv/bin/python tools/render-sprites.py UAL1_Standard.glb out/likui --scale-by mesh --height 1.85 --ppm 50 \
  --frames 8 --samples 12 --ambient 0.5 --sun 3.5 --toon 3 --outline --outfit packs/jiangzhou/sprites/src/outfit-likui.json \
  --actions Sword_Idle,Walk_Loop,Hit_Chest,Sword_Attack,Punch_Cross,Crouch_Idle_Loop,Death01,Roll
```

渲染完改文件名：动作名小写、连字符连接、去掉 `_Loop`，`Sword_Idle` 改叫 `idle`。
