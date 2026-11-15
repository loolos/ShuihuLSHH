// 从原版文件组装 GameData 与 StageInput（浏览器与 Node 共用）。
import { parseAct } from '../formats/act.ts';
import { readExeTables } from '../formats/exe.ts';
import { parseGoods } from '../formats/goo.ts';
import { parseHuman } from '../formats/hum.ts';
import { cropMap, parseMap, type MapData } from '../formats/map.ts';
import { parsePasBlocks, parsePasHeader, type PasBlock } from '../formats/pas.ts';
import { Board } from './board.ts';
import { adjustEnemies } from './enemy-level.ts';
import { tuneBlocks, tuneUnits } from './stage-tune.ts';
import { applyStoryQuotes } from './story-quotes.ts';
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

/**
 * 主线关卡剧本的重制版改动【新】（只改触发条件，不改原版文件）。
 * N13 诱敌蓼儿洼：伏兵区块原版条件「回合 = 10」（第 11 回合开始登场），负责人 2026-11-14 嫌太晚，改成「回合 = 7」（第 8 回合开始；先定第 7 回合，负责人嫌少又改第 8）。
 */
export const STAGE_TURN_TRIGGERS: Record<string, Record<number, number>> = { N13: { 10: 7 } };

/** 林沖刺配沧州后由好汉暗中护送；不改原版文件，只替换剧情文字。 */
export const STAGE_STORY_TEXT: Record<string, Record<string, string>> = {
  'act7-1': {
    '啊...我不会这么容易就被小人陷害。娘子，我现在已经变成通缉犯了；高俅那厮必定在四处张贴通告悬赏我的人头。你要是跟着我，一定是过着朝不保夕、被人追杀的生活；我可以写下休书，你也不用跟着我受苦...如果有适当的人选，不如再嫁了吧...':
      '高俅虽败，仍借白虎节堂一事定我罪，判我刺配沧州。娘子，这一去不知几时才能回来……',
    '相公！小女子又没有做过什么玷污相公名声的事，为何把我休了？！':
      '相公蒙冤受屈，小女子怎会因而埋怨？我在东京等你回来！',
    '唉...现在时局很乱；我也是一番好意，不希望耽误了你的大好青春...':
      '这一路凶险，不能带你同行；等我在沧州安顿下来，再设法接你过去。',
    '不！我不要！': '相公保重，我和锦儿在东京等你。',
    '唉！罢了！罢了！我不再提这件事了。锦儿，你与夫人就先找个地方躲起来吧！等到时局安定后，我再去迎接你们...首先，叫家人们开始收拾行李...':
      '锦儿，你照顾好夫人；此去沧州，我会小心。等我离开后，你们寻处安身，莫要叫高府的人找到。',
    '动作怎么这么快？！': '董超、薛霸二位公人也已到门外？林冲这便随二位起程。',
    '只是今后该往何处安身，林冲心中实在没有主意啊！':
      '娘子珍重。董超、薛霸两位公人押我去沧州，诸位不必明着相送。',
    '总之这里是片刻也不能停留了，如今只得暂且走一步算一步了。':
      '二位公人这就押林教头起程。我们不能明着同行，待他们走远，便暗中跟上，护他一路去沧州。',
    '林冲被小人陷害,该往何处安身?': '董超、薛霸押着林冲离去。众人忧心忡忡，悄悄出城，远远跟上。',
  },
  'act7-1a': {
    '这里就是『野猪林』了，大家小心点！': '董超、薛霸和那伙强人已被打退。林教头无恙，众人仍暗中护送他去沧州。',
  },
};

/** 对逻辑剧本与简体显示剧本同时替换文字，保持两份区块结构一致。 */
export function adjustStoryText(stage: string, blocks: PasBlock[], text: (s: string) => string = (s) => s): PasBlock[] {
  return applyStoryQuotes(stage, replaceStoryText(stage, blocks, text), text).blocks;
}

function replaceStoryText(stage: string, blocks: PasBlock[], text: (s: string) => string): PasBlock[] {
  const overrides = STAGE_STORY_TEXT[stage.toLowerCase()];
  if (!overrides) return blocks;
  return blocks.map((block) => ({
    ...block,
    ops: block.ops.map((op) => {
      if (!op.text) return op;
      const replacement = overrides[text(op.text)];
      return replacement ? { ...op, text: replacement } : op;
    }),
  }));
}

export function adjustBlocks(stage: string, blocks: PasBlock[]): PasBlock[] {
  const map = STAGE_TURN_TRIGGERS[stage.toUpperCase()];
  if (!map) return blocks;
  return blocks.map((b) => (b.trigger.kind === 'turn' && map[b.trigger.turn] !== undefined ? { ...b, trigger: { ...b.trigger, turn: map[b.trigger.turn] } } : b));
}

export function findStageFile(files: FileSource, stage: string, ext: string): string | undefined {
  return files.list('Map', ext).find((p) => p.toLowerCase().endsWith(`/${stage.toLowerCase()}${ext}`));
}

/** 关卡地图名，可带截取范围「名字@x,y,宽,高」（扩展包借原版大地图的一角，见 PackStageJson.map.crop） */
export function stageMapName(map: { base: string; crop?: readonly number[] }): string {
  return map.crop ? `${map.base}@${map.crop.join(',')}` : map.base;
}

/** 按地图名（可带 @截取范围）读地图；file 是原版 .map 文件路径 */
export function loadStageMap(files: FileSource, name: string): { file: string; map: MapData } | undefined {
  const [base, crop] = name.split('@');
  const file = findStageFile(files, base, '.map');
  if (!file) return undefined;
  const map = parseMap(files.get(file), file);
  if (!crop) return { file, map };
  const [x, y, w, h] = crop.split(',').map(Number);
  return { file, map: cropMap(map, x, y, w, h) };
}

export function loadStage(files: FileSource, data: GameData, stage: string, opts: { simplified?: boolean; seed?: number; text?: (s: string) => string; party?: StageInput['party']; joinLevel?: number } = {}): StageInput {
  const loaded = loadStageMap(files, stage);
  if (!loaded) throw new Error(`找不到地图 ${stage}`);
  const { file: mapFile, map } = loaded;
  const att = (f: string) => new Uint8Array(files.get(f).subarray(8));
  const board = Board.fromMap(map, att('Data/Ground.att'), att('Data/Upper.att'));
  const actFile = mapFile.replace(/\.map$/i, '.act');
  const pabFile = findStageFile(files, stage, '.pab');
  const pasFile = findStageFile(files, stage, '.pas');
  // 后期关卡追加的敌人和增援（stage-tune.ts）
  const units = files.has(actFile) ? tuneUnits(stage, adjustEnemies(stage, parseAct(files.get(actFile), actFile)), board) : [];
  return {
    name: stage,
    board,
    units,
    blocks: pabFile
      ? tuneBlocks(stage, adjustStoryText(stage, adjustBlocks(stage, parsePasBlocks(files.get(pabFile), 'big5')), opts.text), units, 'big5')
      : [],
    header: pabFile ? parsePasHeader(files.get(pabFile)) : undefined,
    displayBlocks: opts.simplified && pasFile
      ? tuneBlocks(stage, adjustStoryText(stage, parsePasBlocks(files.get(pasFile), 'gbk')), units, 'gbk')
      : undefined,
    data,
    seed: opts.seed,
    text: opts.text,
    party: opts.party,
    joinLevel: opts.joinLevel,
  };
}
