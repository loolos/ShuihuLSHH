// 生成 src/data/enemy-levels.json：每场战役敌人等级的修正值（src/rules/enemy-level.ts）。
// 用法：node --experimental-transform-types tools/gen-enemy-levels.ts（约 4 分钟）；之后要再跑 npm run gen:levels。
// 做法：关掉修正，用原版经验规则（EXP_RULES.mode = 'original'，整体节奏按原版，§5.1）沿主线模拟 SEEDS 个种子，
// 每关取我方进关、出关平均等级的中点（各种子平均）作为「主角团等级」T；敌人（2 级以上）平均等级 F 高于 T 时修正值 = round(T − F)，否则 0。
// 训练关（陪练王進）、过场关不改。小径的关照抄同一标题的大道关。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { ROUTES } from '../src/rules/campaign.ts';
import { ENEMY_LEVEL } from '../src/rules/enemy-level.ts';
import { EXP_RULES } from '../src/rules/exp.ts';
import { stageUnits } from '../src/rules/preset.ts';
import { DATA, NodeFiles, simulate } from './sim-lib.ts';

const SEEDS = 8;
ENEMY_LEVEL.enabled = false;
EXP_RULES.mode = 'original';

const files = new NodeFiles(DATA);
const stages = readExeTables(files.get('ShuiHu.exe')).stages.filter((s) => s.mapName && files.has(`Map/${s.mapName}.act`));
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

const party = new Map<string, number[]>();
for (let k = 1; k <= SEEDS; k++) {
  for (const s of simulate({ seed: k * 10, heal: 'low' })) {
    const enter = [...s.entry.values()];
    const exit = s.battle.units.filter((u) => u.side === 'player').map((u) => u.level);
    if (!enter.length) continue;
    const key = s.map.toLowerCase();
    (party.get(key) ?? party.set(key, []).get(key)!).push((avg(enter) + avg(exit)) / 2);
  }
  console.error(`种子 ${k}/${SEEDS}`);
}

const shift: Record<string, number> = {};
const rows: string[] = [];
for (const s of stages) {
  const key = s.mapName.toLowerCase();
  if (/^(act|train)/i.test(key)) continue;
  const foes = stageUnits(files, s).filter((u) => u.side === 'enemy' && u.level > 1).map((u) => u.level);
  const t = party.get(key);
  if (!foes.length || !t) continue;
  const T = avg(t);
  const F = avg(foes);
  const d = Math.min(0, Math.round(T - F));
  if (d) shift[key] = d;
  rows.push(`${s.mapName.padEnd(10)} 主角团 ${T.toFixed(1).padStart(4)}  敌均 ${F.toFixed(1).padStart(4)}  修正 ${d}`);
}
for (const { alt } of Object.values(ROUTES)) {
  const a = stages.find((s) => s.index === alt);
  const main = stages.find((s) => s.index === alt - 1);
  if (a && main && shift[main.mapName.toLowerCase()] !== undefined && shift[a.mapName.toLowerCase()] === undefined) shift[a.mapName.toLowerCase()] = shift[main.mapName.toLowerCase()];
}
console.log(rows.join('\n'));

const out = path.resolve(import.meta.dirname, '../src/data/enemy-levels.json');
fs.writeFileSync(out, `{\n  "note": "tools/gen-enemy-levels.ts 生成：每场战役敌人等级修正值（只降不升），让敌人平均等级接近按原版节奏升级的主角团等级",\n  "shift": ${JSON.stringify(shift)}\n}\n`);
console.error(`写入 ${out}（${Object.keys(shift).length} 关有修正）`);
