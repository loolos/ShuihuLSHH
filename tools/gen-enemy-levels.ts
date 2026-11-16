// 校验自有敌方等级配置，绝不按原剧本等级或模拟结果覆盖人工配置。
// 保留 npm run gen:enemy-levels 作为旧命令的兼容入口。
import { parseAct } from '../src/formats/act.ts';
import { adjustEnemies } from '../src/rules/enemy-level.ts';
import table from '../src/data/enemy-levels.json' with { type: 'json' };
import { DATA, NodeFiles } from './sim-lib.ts';

const files = new NodeFiles(DATA);
const stages: Record<string, Record<string, { classId: number; level: number }>> = table.stages;
const seen = new Set<string>();
let count = 0;
for (const file of files.list('Map', '.act')) {
  const stage = file.split('/').pop()!.replace(/\.act$/i, '').toLowerCase();
  const units = parseAct(files.get(file), file);
  adjustEnemies(stage, units); // 检查缺项、职业身份和等级合法性；不依赖原 level
  const indices = new Set(units.filter(u => u.side === 'enemy').map(u => String(u.index)));
  for (const index of Object.keys(stages[stage] ?? {})) {
    if (!indices.has(index)) throw new Error(`${stage}: 多余的敌方单位等级配置 ${index}`);
  }
  seen.add(stage);
  count += indices.size;
}
for (const stage of Object.keys(stages)) {
  if (!seen.has(stage)) throw new Error(`等级配置引用了不存在的关卡 ${stage}`);
}
console.log(`自有敌方等级校验通过：${seen.size} 关，${count} 个敌人。修改配置后运行 npm run gen:levels。`);
