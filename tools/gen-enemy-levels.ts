// 校验原版关卡的敌人等级：2026-11-19 起自有敌方等级直接写在 gamedata/stages/*.json 的 units[].level，
// 不再有单独的配置表（原 src/data/enemy-levels.json，见 git 历史）。这里只检查每个敌人都有正整数等级、职业号在职业表里。
// 保留 npm run gen:enemy-levels 作为旧命令的兼容入口。
import { stageJson, stageNames, loadGameData } from '../src/rules/load.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

const files = new NodeFiles(DATA);
const data = loadGameData(files);
let count = 0;
const names = stageNames(files);
for (const stage of names) {
  stageJson(files, stage)!.units.forEach((u, i) => {
    if (u.side !== 'enemy') return;
    if (!Number.isInteger(u.level) || u.level < 1) throw new Error(`${stage}: 敌方单位 ${i} 等级必须为正整数`);
    if (!data.classes[u.type]) throw new Error(`${stage}: 敌方单位 ${i} 职业号 ${u.type} 不在职业表里`);
    count++;
  });
}
console.log(`敌方等级校验通过：${names.length} 关，${count} 个敌人。修改等级后运行 npm run gen:levels。`);
