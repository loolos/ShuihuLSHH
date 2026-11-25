// 选关定银子（§7.6）：手上没有存档时，每一关（原版关、主线插关、城镇）的默认银子都按章节表打到那里为止的期望收入，
// 除了最前面的序章和第一关，不能是 0。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chapterSequence, isInsertKey } from '../src/rules/chapters.ts';
import { exeTables, loadGameData, stageJson } from '../src/rules/load.ts';
import { mainlineGold, packStageGold } from '../src/rules/preset.ts';
import type { PackJson, PackStageJson } from '../src/packs/types.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('选关默认银子', () => {
  const files = new NodeFiles(DATA);
  const data = loadGameData(files);
  const stages = exeTables(files).stages.filter((s) => s.mapName && stageJson(files, s.mapName));
  const dir = path.resolve(import.meta.dirname, '../packs/mainline');
  const pack = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')) as PackJson;
  const packStages = new Map(pack.stages.map((p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')) as PackStageJson).map((s) => [`mainline/${s.id}`, s]));
  const insertGold = (ref: string) => { const s = packStages.get(ref.toLowerCase()); return s ? packStageGold(data, s) : 0; };
  const seq = chapterSequence().map((x) => x.key);
  const first = seq.findIndex((k) => !isInsertKey(k));

  it('第一关之后的每一项（原版关、插关）入场银子都大于 0', () => {
    const zero = seq.slice(first + 1).filter((k) => mainlineGold(files, data, stages, k, false, insertGold) <= 0);
    expect(zero).toEqual([]);
  });

  it('续篇城镇（插关之后的城镇）按打完那一段为止算，不是 0', () => {
    const towns = [...packStages.values()].filter((s) => s.townAfter).map((s) => `mainline/${s.id}`);
    expect(towns.length).toBeGreaterThan(0);
    for (const ref of towns) expect(mainlineGold(files, data, stages, ref, true, insertGold), ref).toBeGreaterThan(0);
  });

  it('插关的收入算进后面的关卡；越往后银子不减少（分路的两关除外）', () => {
    const g = seq.map((k) => mainlineGold(files, data, stages, k, false, insertGold));
    const alts = new Set(['n-add04b', 'n-add09b']);
    for (let i = first + 1; i < seq.length; i++) if (!alts.has(seq[i].toLowerCase()) && !alts.has(seq[i - 1].toLowerCase())) expect(g[i], seq[i]).toBeGreaterThanOrEqual(g[i - 1]);
    expect(g[seq.length - 1]).toBeGreaterThan(mainlineGold(files, data, stages, seq[seq.length - 1], false));
  });
});
