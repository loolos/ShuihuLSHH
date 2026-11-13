# CLAUDE.md

《水浒传之梁山好汉》（1999）网页重制。技术栈：Phaser 4 + TypeScript + Vite。唯一的设计文档是 `docs/game-design.md`。

## 硬性规则

- **不运行原版 EXE**（包括 `ShuiHu.exe`、`Autorun.exe`），只允许只读的静态分析。
- **不修改 `gamedata/shuihu/` 里的任何文件。**
- 从原版提取的产物（PNG、JSON、音频）只写到被忽略的 `extracted/`，不入库。
- 仓库已于 2026-11-12 公开（为了 GitHub Pages），但 `gamedata/shuihu/` 里仍有原版文件（含历史）；负责人决定开发完成后再清理，不必再提。不要把原版素材放进构建产物或 `public/`；网页版运行时直接从本仓库 main 分支的 `gamedata/shuihu` 下载（`loadFromRepo`，负责人 2026-11-12 决定），不再让玩家选自己的文件。例外：负责人同意（2026-11-11）内部试玩页面（私有 Artifact）可以附带原版文件，以 base64 文本块放在页面的 `gamedata/` 下，由 `loadBundled` 读取。
- 涉及原版的结论要写明证据（文件、偏移、EXE 地址）；推测要标明。

## 文档约定

- 设计改动只写进 `docs/game-design.md`，不要新开设计文档。
- 文件格式和字段写进 `docs/binary-formats.md`。
- `docs/reference/` 由 `npm run gen:docs` 生成，不要手改。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器。开发模式会直接读取仓库里的 `gamedata/shuihu`，不用选目录 |
| `npm run build` | 类型检查 + 生产构建（`dist/`，只含代码） |
| `npm test` | Vitest 单元测试（没有 `gamedata/` 时自动跳过解析测试） |
| `npm run typecheck` | 只做类型检查 |
| `npm run gen:docs` | 重新生成 `docs/reference/` |
| `npm run gen:manifest` | 重新生成 `src/data/manifest.json`（原版文件清单与 SHA256）和 `src/data/frame-alias.json`（重复帧表） |
| `npm run gen:enemy-levels` | 用原版经验规则沿主线模拟（8 个种子，约 4 分钟），重新生成每关敌人等级修正 `src/data/enemy-levels.json`（要在 `gen:levels` 之前跑） |
| `npm run gen:levels` | 按期望值估算主线（不到 1 秒），重新生成跳关用的入场等级表 `src/data/entry-levels.json`（改了经验规则或敌人等级后要跑） |
| `node --experimental-transform-types tools/sim-exp.ts [original\|new]` | 双方 AI 跑一遍主线，打印每关我方等级（校准经验值） |
| `node --experimental-transform-types tools/est-exp.ts` | 不跑战斗、按期望值估算每关经验总量和我方等级（0.1 秒；假定敌人全部打倒，对照列「设计」= 修正后敌人平均 + 1） |
| `node tools/gen-sound.ts <原版 Sound 目录>` | 把原版音效压成 MP3（去重）写到 `gamedata/sound/`（需要 ffmpeg；负责人 2026-11-12 同意入库） |
| `node --experimental-transform-types tools/measure-assets.ts` | 统计网页版每关下载量、重复文件和重复帧 |
| `npm run render:maps` | 把地图渲染成 PNG 预览，写到 `extracted/maps/` |

Node 22 可以直接运行 `.ts`（类型剥离），`tools/` 下的脚本不需要编译。

## 目录

```
src/formats/   原版格式解析器，浏览器与 Node 共用（使用 Buffer 接口；浏览器里由 src/platform/buffer-shim.ts 提供）
src/platform/  选择原版目录、校验、IndexedDB 缓存
src/game/      Phaser 场景与表现层
src/rules/     纯 TypeScript 规则引擎（属性、棋盘、战斗、AI、PAS 事件），不依赖 Phaser
src/data/      manifest.json 等生成的数据
tools/         Node 工具脚本
tests/         Vitest 测试
```

## 工作方式

- 在指定的功能分支上开发，按里程碑开 PR。负责人允许 Claude 自己合并 PR。
- 合并前跑 `npm run build` 和 `npm test`；改了画面就用 Playwright 截图看一眼（电脑和手机两种尺寸）。
- 目标平台：电脑浏览器；界面也要能在手机屏幕尺寸下浏览。
- 部署：推送到 `main` 后由 `.github/workflows/pages.yml` 发布到 GitHub Pages（需要仓库 Settings → Pages 的 Source 设为 GitHub Actions；负责人 2026-11-11 选择自己开启）。
