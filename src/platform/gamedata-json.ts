// gamedata/ 下的关卡、地图、数据表 JSON 和图像目录（2026-11-19 由原版导出、可直接编辑），随代码打包；图像本身（PNG）按需下载。
// 路径键如 stages/n05.json（小写，不区分大小写取用）。只能在 Vite 里用（浏览器、Vitest），Node 工具读磁盘（tools/sim-lib.ts 的 NodeFiles）。
const mods = import.meta.glob(['/gamedata/{stages,maps,tables}/*.json', '/gamedata/sprites/*.json', '/gamedata/tiles/tiles.json', '/gamedata/portraits/portraits.json', '/gamedata/icons/icons.json'], { eager: true, import: 'default' }) as Record<string, unknown>;

export const GAMEDATA_JSON = new Map(Object.entries(mods).map(([p, v]) => [p.replace(/^\/gamedata\//, '').toLowerCase(), v]));
