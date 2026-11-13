// 生成 src/data/entry-levels.json：测试用跳关时每关每个我方人物的入场等级（src/rules/preset.ts jumpTo）。
// 用法：node --experimental-transform-types tools/gen-entry-levels.ts
// 做法：用 tools/sim-lib.ts 沿主线（大道）从头打到尾，跑 SEEDS 个随机种子，取每个人进每关时等级的平均值（四舍五入）。
// 模拟里我方体力低于 40% 才回满（像玩家吃药、休息）。模拟中后期会比正常游玩高出不少（AI 对打回合多，挨打、闪避经验偏多），
// 所以再限制在「到这一关为止敌人平均等级的最高值 + CAP」以内；不低于剧本里写的等级（新入伙的人按剧本等级，和正常游玩一样）。
// 小径的关（N-add04b、N-add09b）模拟不到，照抄同一标题的大道关。改了经验规则后要重新生成。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { ROUTES } from '../src/rules/campaign.ts';
import { foeLevel, stageUnits } from '../src/rules/preset.ts';
import { DATA, NodeFiles, simulate } from './sim-lib.ts';

const SEEDS = 8;
const CAP = 3;

const files = new NodeFiles(DATA);
const stages = readExeTables(files.get('ShuiHu.exe')).stages.filter((s) => s.mapName && files.has(`Map/${s.mapName}.act`));
const units = stages.map((s) => stageUnits(files, s));

const sums = new Map<string, Map<number, number[]>>();
for (let k = 1; k <= SEEDS; k++) {
  for (const s of simulate({ seed: k * 10, heal: 'low' })) {
    const m = sums.get(s.map.toLowerCase()) ?? sums.set(s.map.toLowerCase(), new Map()).get(s.map.toLowerCase())!;
    for (const [id, lv] of s.entry) (m.get(id) ?? m.set(id, []).get(id)!).push(lv);
  }
  console.error(`种子 ${k}/${SEEDS}`);
}

const levels: Record<string, Record<string, number>> = {};
// 上限按到这一关为止（关卡表顺序）敌人平均等级的最高值，免得一场敌人偏弱的支线（如 N-add10 林沖独斗）把全队压下去
let hardest = 1;
stages.forEach((s, pos) => {
  // 训练关（Train1/2）的敌人是陪练，等级远高于同期，不算
  if (!/^train/i.test(s.mapName)) hardest = Math.max(hardest, foeLevel(stages.length, pos, (i) => units[i]));
  const m = sums.get(s.mapName.toLowerCase());
  if (!m) return;
  const cap = hardest + CAP;
  const row: Record<string, number> = {};
  for (const [id, lvs] of [...m].sort((a, b) => a[0] - b[0])) {
    const script = Math.max(1, ...units[pos].filter((u) => u.side === 'player' && u.type === id).map((u) => u.level));
    row[id] = Math.max(script, Math.min(cap, Math.round(lvs.reduce((a, b) => a + b, 0) / lvs.length)));
  }
  levels[s.mapName.toLowerCase()] = row;
});
for (const { alt } of Object.values(ROUTES)) {
  const a = stages.find((s) => s.index === alt);
  const main = stages.find((s) => s.index === alt - 1);
  if (a && main && levels[main.mapName.toLowerCase()]) levels[a.mapName.toLowerCase()] = { ...levels[main.mapName.toLowerCase()] };
}

const out = path.resolve(import.meta.dirname, '../src/data/entry-levels.json');
const body = Object.entries(levels).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(out, `{\n  "note": "tools/gen-entry-levels.ts 生成：主线模拟 ${SEEDS} 个种子的平均入场等级，不超过到该关为止敌人平均等级的最高值 + ${CAP}，不低于剧本等级",\n  "levels": {\n${body}\n  }\n}\n`);
console.error(`写入 ${out}（${Object.keys(levels).length} 关）`);
