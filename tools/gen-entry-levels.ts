// 生成 src/data/entry-levels.json：测试用跳关时每关每个我方人物的入场等级（src/rules/preset.ts jumpTo）。
// 用法：node --experimental-transform-types tools/gen-entry-levels.ts（不到 1 秒）
// 做法：用 tools/est-exp.ts 的期望值模型沿主线（大道）估算每个人进每关时的等级（假定敌人全部打倒、经验平均分给出场的人，
// 新入伙的人按队伍平均等级入队，和正常游玩一样）。
// 以前用 AI 对打模拟（tools/sim-lib.ts），但 AI 不会放技能、常在护送 / 限时关提前判负（N-add08、N08、N11、N13 等开打几回合就输），
// 后期我方比正常游玩低 5 级左右（N14 平均 22，敌人平均 26），所以改用估算。
// 再夹在两条线之间：不低于「这一关敌人平均等级 + MARGIN」（跳关时我方不比敌人弱，负责人 2026-11-13），
// 不超过「到这一关为止原版敌人平均等级的最高值 + CAP」；不低于剧本里写的等级。
// 小径的关（N-add04b、N-add09b）估算不到，照抄同一标题的大道关。改了经验规则或敌人等级后要重新生成。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { ROUTES } from '../src/rules/campaign.ts';
import { foeLevel, stageUnits } from '../src/rules/preset.ts';
import { estimate } from './est-exp.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

const CAP = 3;
const MARGIN = 1;

const files = new NodeFiles(DATA);
const stages = readExeTables(files.get('ShuiHu.exe')).stages.filter((s) => s.mapName && files.has(`Map/${s.mapName}.act`));
const units = stages.map((s) => stageUnits(files, s));
const rows = new Map(estimate().map((r) => [r.map.toLowerCase(), r]));

const levels: Record<string, Record<string, number>> = {};
// 上限按到这一关为止（关卡表顺序）敌人平均等级的最高值，免得一场敌人偏弱的支线（如 N-add10 林沖独斗）把全队压下去
let hardest = 1;
stages.forEach((s, pos) => {
  // 训练关（Train1/2）的敌人是陪练，等级远高于同期，不算
  if (!/^train/i.test(s.mapName)) hardest = Math.max(hardest, foeLevel(stages.length, pos, (i) => units[i]));
  const r = rows.get(s.mapName.toLowerCase());
  if (!r) return;
  const cap = hardest + CAP;
  // 战役关（有 2 级以上敌人、不是陪练）：我方不低于修正后敌人平均 + MARGIN；第一关（新游戏）照剧本
  const floor = pos > 0 && r.design && r.foes && r.foeAvg > 1 ? Math.ceil(r.foeAvg) + MARGIN : 0;
  const row: Record<string, number> = {};
  for (const [id, lv] of [...r.entry].sort((a, b) => a[0] - b[0])) {
    const script = Math.max(1, ...units[pos].filter((u) => u.side === 'player' && u.type === id).map((u) => u.level));
    row[id] = Math.max(script, floor, Math.min(cap, lv));
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
fs.writeFileSync(out, `{\n  "note": "tools/gen-entry-levels.ts 生成：主线期望值估算（tools/est-exp.ts）的入场等级，不低于该关敌人平均 + ${MARGIN}，不超过到该关为止原版敌人平均等级的最高值 + ${CAP}，不低于剧本等级",\n  "levels": {\n${body}\n  }\n}\n`);
console.error(`写入 ${out}（${Object.keys(levels).length} 关）`);
