// 一次性迁移（2026-11-19）：把原版关卡、地图和数据表导出成 gamedata/ 下可直接编辑的 JSON。
// 关卡导出的是"重制版实际用的样子"：已经并入当时代码里的关卡补丁（自有敌人等级、加敌人/提前增援、改触发回合、改台词、插原著引文、
// 黄泥冈与柳树下的改写）。导出之后 JSON 就是关卡的唯一来源，补丁代码随之删除，这个脚本也不再保留（见 git 历史）。
// 用法：node --experimental-transform-types tools/export-original.ts <原版目录>
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { parseGoods } from '../src/formats/goo.ts';
import { parseHuman } from '../src/formats/hum.ts';
import { parseMap } from '../src/formats/map.ts';
import { parsePasBlocks } from '../src/formats/pas.ts';
import { t2sTable, buildT2S, loadGameData, loadStage, type FileSource } from '../src/rules/load.ts';
import { encounterMap } from '../src/rules/willow-encounter.ts';
import { stageTune } from '../src/rules/stage-tune.ts';
import { NodeFiles } from './sim-lib.ts';
import { formatStageJson, formatMapJson } from '../src/formats/stage-json.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.resolve(process.argv[2] ?? path.join(ROOT, 'gamedata/shuihu'));
const files: FileSource = new NodeFiles(SRC);
const OUT = path.join(ROOT, 'gamedata');
const write = (rel: string, text: string) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

// 数据表
const table = t2sTable(files);
write('tables/t2s.json', JSON.stringify(table, null, 0).replace(/","/g, '",\n"').replace('{', '{\n').replace(/}$/, '\n}') + '\n');
const exe = readExeTables(files.get('ShuiHu.exe'));
write('tables/exe.json', JSON.stringify(exe, null, 1) + '\n');
write('tables/human.json', JSON.stringify(parseHuman(files.get('Data/Human.hum')), null, 1) + '\n');
write('tables/goods.json', '[\n' + parseGoods(files.get('Data/Goods.dab')).map((it) => JSON.stringify(it)).join(',\n') + '\n]\n');
const att = (f: string) => [...files.get(f).subarray(8)];
write('tables/terrain.json', `{\n"ground": ${JSON.stringify(att('Data/Ground.att'))},\n"upper": ${JSON.stringify(att('Data/Upper.att'))}\n}\n`);

// 地图
const names = files.list('Map', '.map').map((p) => path.basename(p, '.map'));
const real = (n: string) => fs.readdirSync(path.join(SRC, 'Map')).find((f) => f.toLowerCase() === `${n}.map`)!.replace(/\.map$/i, '');
for (const n of names) {
  const name = real(n);
  write(`maps/${name}.json`, formatMapJson(parseMap(files.get(`Map/${name}.map`), name)));
}

// 关卡
const tr = buildT2S(files);
const data = loadGameData(files, tr);
for (const n of names) {
  const name = real(n);
  const st = loadStage(files, data, name, { simplified: true, text: tr });
  const disp = st.displayBlocks;
  if (disp && disp.length !== st.blocks.length) throw new Error(`${name}: 简繁剧本区块数不同`);
  const blocks = st.blocks.map((b, i) => {
    if (b.index !== i) throw new Error(`${name}: 区块号 ${b.index} ≠ ${i}`);
    return {
      ...b,
      ops: b.ops.map((o, k) => {
        const d = disp?.[i].ops[k];
        if (disp && d!.op !== o.op) throw new Error(`${name}: 区块 ${i} 指令 ${k} 简繁不同`);
        // 显示用简体（.pas）；没有简体版的（柳树下）沿用原文
        return o.text !== undefined ? { ...o, value: 0, text: d?.text ?? o.text } : o;
      }),
    };
  });
  const tune = stageTune(name);
  const rules = tune && (tune.rushOnDeath !== undefined || tune.clearAllWaves || tune.rushText)
    ? { rushOnDeath: tune.rushOnDeath, clearAllWaves: tune.clearAllWaves, rushText: tune.rushText }
    : undefined;
  st.units.forEach((u, i) => {
    if (u.index !== i) throw new Error(`${name}: 单位号 ${u.index} ≠ ${i}`);
  });
  write(
    `stages/${name}.json`,
    formatStageJson({
      map: encounterMap(name),
      header: st.header!,
      units: st.units,
      blocks,
      names: st.names,
      enemyRanks: name.toLowerCase() === 'act5-2' ? st.enemyRanks : undefined,
      spectators: st.spectators,
      clearGold: st.clearGold,
      rules,
    }),
  );
}
// 检查：pab 与 pas 都能读（确认导出覆盖全部关卡）
for (const n of names) parsePasBlocks(files.get(`Map/${real(n)}.pab`));
console.log(`导出 ${names.length} 关、${names.length} 张地图和 5 张数据表到 gamedata/`);
