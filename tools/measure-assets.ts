// 网页版下载量统计：启动时的头像和图标、每关进关前下载的图、开打后后台下载的技能动画。
// 用法：node --experimental-transform-types tools/measure-assets.ts
// 只统计、不写文件。图像都是 gamedata/ 下的 PNG（按需下载，下载过的存在浏览器 IndexedDB 里）。
// 按关卡表顺序累计时，前面关卡下载过的图不再计入。
import { loadAssets, preloadStage, prefetchSkills, startupImages } from '../src/game/assets.ts';
import { stageUnits } from '../src/formats/stage-json.ts';
import { stageJson } from '../src/rules/load.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { nodeGameFiles } from './sim-lib.ts';

const MB = (n: number) => (n / 1048576).toFixed(2).padStart(6);
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** 单独进这一关（缓存为空）时下载哪些图 */
async function solo(stage: string, units: { type: number; level: number }[]) {
  const got = new Map<string, number>();
  const A = loadAssets(nodeGameFiles((p, n) => got.set(p, n)));
  await preloadStage(A, stage);
  const core = new Map(got);
  await prefetchSkills(A, units.map((a) => ({ classId: a.type, skills: learnedSkills({ classId: a.type, level: a.level } as Unit, A.data) })));
  return { core, bg: new Map([...got].filter(([p]) => !core.has(p))) };
}

const start = new Map<string, number>();
const probe = loadAssets(nodeGameFiles((p, n) => start.set(p, n)));
await probe.files.ensure(startupImages(probe));
console.log(`启动时下载头像、图标、格子光标 ${start.size} 张：${MB(sum(start))} MB`);

const stages = probe.exe.stages.filter((s) => s.mapName && stageJson(probe.files, s.mapName));
const seen = new Set<string>();
let coreMax = 0, bgMax = 0, total = sum(start);
console.log('\n关卡            进关前   开打后后台   按顺序玩新增');
for (const s of stages) {
  const acts = stageUnits(stageJson(probe.files, s.mapName)!).filter((a) => a.side !== 'object' && a.side !== 'unknown' && a.type < probe.data.classes.length);
  // 已学会的技能按关卡里的等级算（主角按 99 级，偏多）
  const { core, bg } = await solo(s.mapName, [{ type: 0, level: 99 }, ...acts]);
  let fresh = 0;
  for (const [p, n] of [...core, ...bg]) if (!seen.has(p)) (seen.add(p), (fresh += n));
  total += fresh;
  coreMax = Math.max(coreMax, sum(core));
  bgMax = Math.max(bgMax, sum(bg));
  console.log(`${String(s.index).padStart(3)} ${s.mapName.padEnd(10)} ${MB(sum(core))} MB  ${MB(sum(bg))} MB  ${MB(fresh)} MB`);
}
console.log(`\n单关进关前最多 ${MB(coreMax)} MB，开打后后台最多 ${MB(bgMax)} MB；主线全部玩完共下载约 ${MB(total)} MB`);
