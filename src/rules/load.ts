// 从原版文件组装 GameData 与 StageInput（浏览器与 Node 共用）。
import { parseAct } from '../formats/act.ts';
import { readExeTables } from '../formats/exe.ts';
import { parseGoods } from '../formats/goo.ts';
import { parseHuman } from '../formats/hum.ts';
import { parseMap } from '../formats/map.ts';
import { parsePasBlocks, parsePasHeader } from '../formats/pas.ts';
import { Board } from './board.ts';
import { adjustEnemies } from './enemy-level.ts';
import type { StageInput } from './battle.ts';
import { buildClasses, withItemOverrides, type ClassDef, type GameData } from './data.ts';
import { statAt, tierGear } from './growth.ts';

export interface FileSource {
  get(path: string): Buffer;
  has(path: string): boolean;
  list(dir: string, ext: string): string[];
}

/**
 * 繁→简对照：原版每个 .pab（Big5）都有一份结构完全相同的 .pas（GB2312，简体），
 * 逐字对齐两份文本即可得到剧本中出现过的全部字的对照。没出现过的字保持原样。
 */
export function buildT2S(files: FileSource): (s: string) => string {
  // 逐字投票：.pas 偶有错字（如把"得"写成"的"），取出现次数最多的对应（含不变）
  const votes = new Map<string, Map<string, number>>();
  for (const pab of files.list('Map', '.pab')) {
    const pas = pab.replace(/\.pab$/, '.pas');
    if (!files.has(pas)) continue;
    const a = parsePasBlocks(files.get(pab), 'big5');
    const b = parsePasBlocks(files.get(pas), 'gbk');
    if (a.length !== b.length) continue;
    a.forEach((blk, i) =>
      blk.ops.forEach((op, k) => {
        const t = b[i].ops[k]?.text;
        if (!op.text || !t || [...op.text].length !== [...t].length) return;
        const x = [...op.text], y = [...t];
        x.forEach((c, j) => {
          if (c.charCodeAt(0) < 0x2e80) return;
          const v = votes.get(c) ?? new Map<string, number>();
          v.set(y[j], (v.get(y[j]) ?? 0) + 1);
          votes.set(c, v);
        });
      }),
    );
  }
  const map = new Map<string, string>();
  for (const [c, v] of votes) {
    const best = [...v].sort((a, b) => b[1] - a[1])[0][0];
    if (best !== c) map.set(c, best);
  }
  return (s) => [...s].map((c) => map.get(c) ?? c).join('');
}

export function loadGameData(files: FileSource, tr: (s: string) => string = (s) => s): GameData {
  const exe = readExeTables(files.get('ShuiHu.exe'));
  const classes = capSkillCosts(buildClasses(parseHuman(files.get('Data/Human.hum')), exe.characterNames, exe.skillNames));
  return { classes, items: withItemOverrides(parseGoods(files.get('Data/Goods.dab'))), charNames: exe.characterNames, effectTriggers: exe.effectTriggers, heroName: tr(exe.characterNames[0]), heroNickname: tr(exe.nicknames[0] ?? ''), prompts: exe.prompts.map((q) => ({ ...q, question: tr(q.question), options: [tr(q.options[0]), tr(q.options[1])], replies: [{ ...q.replies[0], text: tr(q.replies[0].text) }, { ...q.replies[1], text: tr(q.replies[1].text) }] })) };
}

/**
 * 技能耗气不超过习得那一级的最大气（不算装备）【新】（负责人 2026-11-13）。
 * 气力改成线性成长（growth.ts）后，有几招刚学会时气力上限不够放：武龍 千軍萬馬LV3 200（15 级气 160）、
 * 史進 天龍出雲LV3 160（18 级 144）、龍騰九天 210（22 级 159），敌方版白勝、吳用的几招也是。只压这几招，别的不动。
 */
export function capSkillCosts(classes: ClassDef[]): ClassDef[] {
  for (const cls of classes) {
    if (!cls) continue;
    for (const s of cls.skills.slice(1)) {
      const mp = statAt(cls, 'mp', s.learnLevel) + (tierGear(cls)?.mp ?? 0);
      if (s.mpCost > mp) s.mpCost = mp;
    }
  }
  return classes;
}

export function findStageFile(files: FileSource, stage: string, ext: string): string | undefined {
  return files.list('Map', ext).find((p) => p.toLowerCase().endsWith(`/${stage.toLowerCase()}${ext}`));
}

export function loadStage(files: FileSource, data: GameData, stage: string, opts: { simplified?: boolean; seed?: number; text?: (s: string) => string; party?: StageInput['party']; joinLevel?: number } = {}): StageInput {
  const mapFile = findStageFile(files, stage, '.map');
  if (!mapFile) throw new Error(`找不到地图 ${stage}`);
  const map = parseMap(files.get(mapFile), mapFile);
  const att = (f: string) => new Uint8Array(files.get(f).subarray(8));
  const board = Board.fromMap(map, att('Data/Ground.att'), att('Data/Upper.att'));
  const actFile = mapFile.replace(/\.map$/i, '.act');
  const pabFile = findStageFile(files, stage, '.pab');
  const pasFile = findStageFile(files, stage, '.pas');
  return {
    name: stage,
    board,
    units: files.has(actFile) ? adjustEnemies(stage, parseAct(files.get(actFile), actFile)) : [],
    blocks: pabFile ? parsePasBlocks(files.get(pabFile), 'big5') : [],
    header: pabFile ? parsePasHeader(files.get(pabFile)) : undefined,
    displayBlocks: opts.simplified && pasFile ? parsePasBlocks(files.get(pasFile), 'gbk') : undefined,
    data,
    seed: opts.seed,
    text: opts.text,
    party: opts.party,
    joinLevel: opts.joinLevel,
  };
}

