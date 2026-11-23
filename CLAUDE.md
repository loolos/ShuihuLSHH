# CLAUDE.md

《水浒传之梁山好汉》（1999）网页重制。技术栈：Phaser 4 + TypeScript + Vite。唯一的设计文档是 `docs/game-design.md`。

## 硬性规则

- **不运行原版 EXE**（包括 `ShuiHu.exe`、`Autorun.exe`），只允许只读的静态分析。
- 原版原件放在 `gamedata/original/`，不修改（只作对照，给格式测试和文档生成用；游戏运行时不读）。2026-11-19 负责人决定把原版拆开整合：关卡、地图、数据表导出成 JSON，图像导出成索引色 PNG，都在 `gamedata/` 下，是游戏实际用的数据，可以直接改：
  - `gamedata/stages/<关卡>.json`：原版关卡（地图名、剧本头、单位、剧本区块；文字为简体）。改原版关卡（加敌人、改台词、调等级、提前增援）直接改这里，不要再写载入时的补丁代码。
  - `gamedata/maps/<地图>.json`：原版地图（与 `packs/maps` 自拼地图同一种格式），新关卡用 `map.base` 引用或拿来改。
  - `gamedata/tables/`：EXE 静态表、职业（Human.hum）、道具（Goods.dab）、地形通行、繁→简对照。职业和道具的重制版改动目前仍在 `src/rules/data.ts`。
  - `gamedata/sprites/`（人物动画 `man/<职业>/<动作>.png`、特效 `effects/<组>.png`）、`gamedata/tiles/`（地图图块、格子光标）、`gamedata/portraits/`（头像）、`gamedata/icons/`（道具图标）：8 位索引色 PNG，调色板是原版 Default.pal（`tables/palette.json`），0 号透明。编辑时必须保持索引色和同一调色板（换色、透明色键都靠索引）。帧的格子大小和锚点在旁边的目录 JSON 里，格式见 `docs/binary-formats.md` §15。
- 临时的提取产物（预览 PNG、调试用 JSON 等）写到被忽略的 `extracted/`。要入库的导出数据只放在 `gamedata/` 下的约定目录（`stages/`、`maps/`、`tables/`、`sprites/`、`tiles/`、`portraits/`、`icons/`、`sound/`；3D 渲染精灵的原料（假人、动作库、服装底版、人物配方）在 `models/`，游戏运行时不读）。译文在 `gamedata/lang/<语言>/`（§10.3）；剧本指令上的 `"id"` 是译文用的固定编号，改对白时保留，复制指令时别带上。
- 仓库已于 2026-11-12 公开（为了 GitHub Pages），README 有免责声明；`gamedata/original/` 里的原版文件（含历史）负责人决定开发完成后再清理，不必再提。`gamedata/` 下的 JSON（关卡、地图、数据表、图像目录）随代码打包（`src/platform/gamedata-json.ts`）；PNG 图像不放进构建产物或 `public/`，网页版运行时按需从本仓库 main 分支的 `gamedata/` 下载（负责人 2026-11-12 决定从仓库下载），缓存在 IndexedDB。不再支持让玩家选本机原版目录，也不再有附带原版文件的内部试玩页面（`loadBundled`）。
- 涉及原版的结论要写明证据（文件、偏移、EXE 地址）；推测要标明。

## 文档约定

- 设计改动只写进 `docs/game-design.md`，不要新开设计文档。先读文首导航与当前状态；修改所属主题的当前规范，并同步状态，不在文末追加重复规则。
- 保留现有章节编号与引用。候选、历史方案和已实现记录须明确区分；方案落地后回填实际差异，避免标题“未实现”而正文已完成。
- 文件格式和字段写进 `docs/binary-formats.md`。
- `docs/reference/` 由 `npm run gen:docs` 生成，不要手改。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器。开发模式直接读取仓库里的 `gamedata/` |
| `npm run build` | 类型检查 + 生产构建（`dist/`，只含代码） |
| `npm test` | Vitest 单元测试（没有 `gamedata/` 时自动跳过解析测试） |
| `npm run typecheck` | 只做类型检查 |
| `npm run gen:docs` | 重新生成 `docs/reference/` |
| `npm run check:enemy-levels` | 校验 `gamedata/stages` 里每个敌人的等级（正整数）和职业号；`gen:enemy-levels` 为兼容别名 |
| `npm run gen:levels` | 按期望值估算主线（不到 1 秒），重新生成跳关用的入场等级表 `src/data/entry-levels.json`（改了经验规则或敌人等级后要跑） |
| `node --experimental-transform-types tools/sim-exp.ts [original\|new]` | 双方 AI 跑一遍主线，打印每关我方等级（校准经验值） |
| `node --experimental-transform-types tools/est-exp.ts` | 不跑战斗、按期望值估算每关经验总量和我方等级（0.1 秒；假定敌人全部打倒，对照列「设计」= 自有敌人基础等级平均 + 1） |
| `node tools/gen-sound.ts <原版 Sound 目录>` | 把原版音效压成 MP3（去重）写到 `gamedata/sound/`（需要 ffmpeg；负责人 2026-11-12 同意入库） |
| `node --experimental-transform-types tools/measure-assets.ts` | 统计网页版启动和每关要下载的图像 |
| `node --experimental-transform-types tools/sim-pack.ts [包名] [关卡] [局数]` | 扩展包关卡试打：双方都交给 AI，打印胜率、回合数、剧情触发 |
| `node --experimental-transform-types tools/check-facing.ts [--side] [--fix]` | 查关卡开场朝向：开场就在场上的人背对最近的对手就列出来（扩展包关卡、改过的原版关卡；原版本来的朝向、潜行哨兵不算），`--fix` 直接改 JSON（负责人 2026-11-21：士兵要看着要抓的人） |
| `node --experimental-transform-types tools/sim-cuju.ts [局数]` | 蹴鞠外传试打：双方都交给蹴鞠 AI，打印胜率、比分、出界 / 拦截次数（§15.25） |
| `node --experimental-transform-types tools/sim-royale.ts [局数] [玩家职业号]` | 好汉聚义（吃鸡外传）试打：玩家也交给吃鸡 AI，打印吃鸡率、名次、回合数、毒死 / 开宝箱数（§15.31；`WATCH=1` 玩家倒下后打完整局） |
| `node --experimental-transform-types tools/charge-anim.ts [--all]` | 列出所有职业（原版 + 扩展包）集气技的施放时长（默认只列被加快的） |
| `npm run i18n -- ids\|sync\|check …` | 多语言（`docs/game-design.md` §10.3）：给关卡剧本文字分配固定编号、同步 `gamedata/lang/<语言>/` 的译文文件、列出未翻 / 过期句数 |
| `python tools/render-character.py gamedata/models/characters/<人物>.json [--only 动作 --frames 3 --samples 8 --out 目录]` | 按人物配方用 3D 假人渲染整套精灵图条（需要 `bpy`；配方和换色写法见 `gamedata/models/README.md`） |
| `npm run render:maps` | 把地图渲染成 PNG 预览，写到 `extracted/maps/` |
| `node --experimental-transform-types tools/compose-map.ts [名字]` | 按 `tools/map-recipes/` 的配方拼新地图，写 `packs/maps/*.json`（§15.15，见配方目录的 README） |

Node 22 可以直接运行 `.ts`（类型剥离），`tools/` 下的脚本不需要编译。

## 目录

```
src/formats/   原版格式解析器，浏览器与 Node 共用（使用 Buffer 接口；浏览器里由 src/platform/buffer-shim.ts 提供）
src/platform/  gamedata 的 JSON 与图像加载（按需下载、IndexedDB 缓存）
src/game/      Phaser 场景与表现层
src/rules/     纯 TypeScript 规则引擎（属性、棋盘、战斗、AI、PAS 事件），不依赖 Phaser
src/data/      entry-levels.json 等生成的数据
tools/         Node 工具脚本
tests/         Vitest 测试
```

## 工作方式

- 在指定的功能分支上开发，按里程碑开 PR。负责人允许 Claude 自己合并 PR。
- 合并前跑 `npm run build` 和 `npm test`；改了画面就用 Playwright 截图看一眼（电脑和手机两种尺寸）。
- 目标平台：电脑浏览器；界面也要能在手机屏幕尺寸下浏览。
- 部署：推送到 `main` 后由 `.github/workflows/pages.yml` 发布到 GitHub Pages（需要仓库 Settings → Pages 的 Source 设为 GitHub Actions；负责人 2026-11-11 选择自己开启）。
