/**
 * 章节表：主线分几章、每章叫什么、每章有哪些关、按什么顺序打（docs/game-design.md §15.8「章节表」）。
 *
 * 这是主线分章和插关位置的唯一来源：
 * - 章号 = 在表里的位置（第一项是第一章）；选关分组、开章短曲、存档摘要都按这张表；
 * - stages 里写原版地图名（如 'N-add06'），或主线插关 / 续篇的 '<包>/<关卡 id>'（如 'mainline/wawasi'）；
 * - 插关打在表里它后面的那一个原版关卡之前（城镇之后）；排在最后一个原版关卡后面的是终章续篇，
 *   通关后按表里的顺序接着打；同一位置的几段也按表里的顺序一段接一段；
 * - 原版关卡之间的先后由剧本头决定（下一关、城镇、分路），表里只能照原版顺序写，不能调换（validateChapters 会查）；
 * - 城镇不用写：自动列在进城前那一关后面。
 *
 * 加新插关：在 packs/mainline 写关卡 JSON、登记到 pack.json，然后把 '<包>/<关卡>' 写进这里想要的位置。
 * 新开一章：在表里加一项。
 */

export interface ChapterDef {
  /** 章名（3–6 个字，不带"第N章"） */
  name: string;
  stages: string[];
}

export const CHAPTERS: ChapterDef[] = [
  { name: '私走延安府', stages: ['N01', 'N-add01'] },
  { name: '九纹龙史进', stages: ['N-add02', 'Act2-2', 'Act2-3', 'N02', 'N-add03', 'Act3-1', 'Act3-2', 'Act3-3'] },
  { name: '夜走华阴县', stages: ['N03', 'Act3-4', 'N-add04a', 'N-add04b', 'Act5-1a'] },
  { name: '大闹桃花村', stages: ['N-add05', 'Act4-2', 'Act4-3', 'N04', 'Act5-1'] },
  { name: '东京遇林冲', stages: ['mainline/wawasi', 'N-add06', 'Train1', 'N-add07', 'Act5-2', 'Act5-3', 'N05', 'Act6-1', 'Act6-2'] },
  { name: '误入白虎堂', stages: ['N-add08', 'Act6-3', 'N06', 'Act7-1', 'mainline/zhizhulin', 'Act7-1a'] },
  { name: '大闹野猪林', stages: ['N07'] },
  { name: '柴门招豪客', stages: ['N-add09a', 'N-add09b', 'Act8-1', 'N-add10', 'N08', 'Act9-1'] },
  { name: '风雪山神庙', stages: ['N09'] },
  { name: '青面兽杨志', stages: ['N-add11', 'mainline/chifagui', 'mainline/sanruan', 'Act10-1', 'Act10-2', 'N-add12', 'Act11-1a', 'N10', 'Act11-1', 'Act11-2'] },
  { name: '认义东溪村', stages: ['N-add13', 'N11'] },
  { name: '义释晁天王', stages: ['N-add14', 'N12', 'Act13-1'] },
  { name: '石碣村三雄', stages: ['N-add15', 'Act13-2', 'N13', 'Act14-1'] },
  { name: '投奔梁山泊', stages: ['N-add16', 'Train2', 'Act14-2', 'Act14-3'] },
  { name: '梁山泊聚义', stages: ['N14', 'mainline/songjiang-yanshixi', 'mainline/songjiazhuang'] },
  { name: '景阳冈打虎', stages: ['mainline/chaijin-liubin', 'mainline/jingyanggang', 'mainline/tiaolian', 'mainline/shizilou'] },
  { name: '孟州风雨', stages: ['mainline/shizipo', 'mainline/anpingzhai', 'mainline/kuaihuolin', 'mainline/zhangfu'] },
  { name: '血溅鸳鸯楼', stages: ['mainline/feiyunpu', 'mainline/yuanyanglou'] },
];

const DIGITS = '零一二三四五六七八九';
/** 1–99 的中文数字 */
export function cnNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  const t = Math.floor(n / 10), u = n % 10;
  return `${t === 1 ? '' : DIGITS[t]}十${u ? DIGITS[u] : ''}`;
}

/** 表里的一项：插关是 '<包>/<关卡>'，原版关卡是地图名 */
export const isInsertKey = (key: string) => key.includes('/');

export interface SequenceItem {
  /** 原版地图名，或插关 '<包>/<关卡>' */
  key: string;
  /** 章号（从 1 起） */
  chapter: number;
}

/** 整条主线（按表里的顺序展开） */
export function chapterSequence(chapters: ChapterDef[] = CHAPTERS): SequenceItem[] {
  return chapters.flatMap((c, i) => c.stages.map((key) => ({ key, chapter: i + 1 })));
}

/** 某一关（原版地图名或插关 ref，不分大小写）所在的章号；不在表里为 0 */
export function chapterOf(key: string, chapters: ChapterDef[] = CHAPTERS): number {
  const k = key.toLowerCase();
  return chapterSequence(chapters).find((x) => x.key.toLowerCase() === k)?.chapter ?? 0;
}

/** 例："第十六章 景阳冈打虎"；章号不在表里时为空串 */
export function chapterLabel(n: number, chapters: ChapterDef[] = CHAPTERS): string {
  const c = chapters[n - 1];
  return c ? `第${cnNumber(n)}章 ${c.name}` : '';
}

/** 插关的位置：before = 打在哪个原版关卡前面；after = 排在最后一个原版关卡之后（终章续篇） */
export interface InsertPlace {
  ref: string;
  before?: string;
  after?: string;
}

/** 由章节表算出每个插关的位置，按表里的顺序 */
export function insertPlaces(chapters: ChapterDef[] = CHAPTERS): InsertPlace[] {
  const seq = chapterSequence(chapters);
  const lastOriginal = [...seq].reverse().find((x) => !isInsertKey(x.key))?.key;
  return seq.flatMap((x, i) => {
    if (!isInsertKey(x.key)) return [];
    const next = seq.slice(i + 1).find((y) => !isInsertKey(y.key))?.key;
    return [next ? { ref: x.key, before: next } : { ref: x.key, after: lastOriginal }];
  });
}

/**
 * 检查章节表：
 * - originals：原版关卡的地图名，按原版顺序（EXE 关卡表 = 剧本头串起来的顺序）；表里要一个不漏、不重复、顺序一致；
 * - inserts：已登记的主线插关 ref（packs/mainline 等 entry = mainline 的包）；表里要一个不漏、不重复、不多写；
 * - 章名不能为空，每章至少一关。
 * 返回问题列表（空 = 没问题）。
 */
export function validateChapters(originals: string[], inserts: string[], chapters: ChapterDef[] = CHAPTERS): string[] {
  const errors: string[] = [];
  const seq = chapterSequence(chapters);
  const seen = new Set<string>();
  for (const x of seq) {
    const k = x.key.toLowerCase();
    if (seen.has(k)) errors.push(`${x.key} 在章节表里重复`);
    seen.add(k);
  }
  chapters.forEach((c, i) => {
    if (!c.name.trim()) errors.push(`第 ${i + 1} 章没有章名`);
    if (!c.stages.length) errors.push(`第 ${i + 1} 章「${c.name}」没有关卡`);
  });
  const orig = originals.map((m) => m.toLowerCase());
  const tableOrig = seq.filter((x) => !isInsertKey(x.key)).map((x) => x.key.toLowerCase());
  for (const m of orig) if (!tableOrig.includes(m)) errors.push(`原版关卡 ${m} 不在章节表里`);
  for (const m of tableOrig) if (!orig.includes(m)) errors.push(`章节表里的 ${m} 不是原版关卡`);
  const common = tableOrig.filter((m) => orig.includes(m));
  const want = orig.filter((m) => common.includes(m));
  const bad = common.findIndex((m, i) => m !== want[i]);
  if (bad >= 0) errors.push(`原版关卡顺序不能调换：章节表第 ${bad + 1} 个原版关卡是 ${common[bad]}，原版是 ${want[bad]}`);
  const ins = new Set(inserts.map((r) => r.toLowerCase()));
  const tableIns = seq.filter((x) => isInsertKey(x.key)).map((x) => x.key.toLowerCase());
  for (const r of ins) if (!tableIns.includes(r)) errors.push(`插关 ${r} 已登记但不在章节表里`);
  for (const r of tableIns) if (!ins.has(r)) errors.push(`章节表里的插关 ${r} 没有登记（包没启用或关卡 id 写错）`);
  return errors;
}
