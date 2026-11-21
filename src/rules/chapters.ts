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
  { name: '误入白虎堂', stages: ['N-add08', 'Act6-3', 'N06', 'Act7-1'] },
  // 负责人 2026-11-15（#234）：野猪林义援、陆谦拦路、关前遇盘查（及其后的城镇 沧州城）归第七章
  { name: '大闹野猪林', stages: ['mainline/zhizhulin', 'Act7-1a', 'N07', 'N-add09a'] },
  { name: '柴门招豪客', stages: ['N-add09b', 'Act8-1', 'N-add10', 'N08'] },
  // 负责人 2026-11-15：沧州设毒计、摆脱追骑（及中间的城镇 黄泥冈前）归第九章
  { name: '风雪山神庙', stages: ['Act9-1', 'N09', 'N-add11'] },
  { name: '青面兽杨志', stages: ['mainline/daming-duel', 'mainline/chifagui', 'mainline/sanruan', 'Act10-1', 'Act10-2', 'N-add12', 'Act11-1a', 'N10', 'Act11-1', 'Act11-2'] },
  { name: '认义东溪村', stages: ['N-add13', 'N11'] },
  { name: '义释晁天王', stages: ['N-add14', 'N12', 'Act13-1'] },
  { name: '石碣村三雄', stages: ['N-add15', 'Act13-2', 'N13', 'Act14-1'] },
  { name: '投奔梁山泊', stages: ['N-add16', 'Train2', 'Act14-2', 'Act14-3'] },
  { name: '梁山泊聚义', stages: ['N14', 'mainline/songjiang-yanshixi', 'mainline/songjiazhuang'] },
  { name: '景阳冈打虎', stages: ['mainline/chaijin-liubin', 'mainline/jingyanggang', 'mainline/tiaolian', 'mainline/shizilou'] },
  // 负责人 2026-11-15：十字坡到鸳鸯楼合成一章（原第十七章 孟州风雨、第十八章 血溅鸳鸯楼）
  { name: '血溅鸳鸯楼', stages: ['mainline/shizipo', 'mainline/anpingzhai', 'mainline/kuaihuolin', 'mainline/zhangfu', 'mainline/feiyunpu', 'mainline/yuanyanglou'] },
  // 负责人 2026-11-16：鸳鸯楼后众人散去，武龙、李逵、花荣随武松；十字坡扮行者为开场剧情，蜈蚣岭夜战（原著第 31–32 回）；
  // 接着村店醉打孔亮一场仗，落溪被擒、孔家庄相认、瑞龙镇分路为剧情（原著第 32 回，方案 A）。
  // 负责人 2026-11-16 把原第十八章 夜走蜈蚣岭、第十九章 醉打孔亮 合成一章
  { name: '行者武松', stages: ['mainline/xingzhe', 'mainline/wugongling', 'mainline/kongliang', 'mainline/kongjiazhuang'] },
  // 负责人 2026-11-16：清风寨上半（原著第 32–34 回）：清风山被擒相认、元宵被诬、花荣抢人、掷盏为号、劫囚车（二龙山三人来援）
  { name: '大闹清风寨', stages: ['mainline/qingfengshan', 'mainline/xingjiutang', 'mainline/yuanxiao', 'mainline/qianghuarong', 'mainline/zhizhan', 'mainline/jieqiuche'] },
  // 负责人 2026-11-16：清风寨下半（原著第 34–35 回）：夜困秦明、夜说秦明与许婚、攻破清风寨（秦明劝降黄信，新）、对影山射戟、石勇送信与梁山聚义
  { name: '霹雳火秦明', stages: ['mainline/yekun', 'mainline/yeshuo', 'mainline/gongpo', 'mainline/duiyingshan', 'mainline/liufeng', 'mainline/shiyong'] },
  // 负责人 2026-11-19：宋江刺配江州（原著第 36 回）：奔丧归庄（选项）、梁山截路（宋江劝住）、梁山送别、揭阳岭（限时救人）；武龙受吴用之托一路暗中护送
  { name: '刺配江州', stages: ['mainline/bensang', 'mainline/toushou', 'mainline/liangshan-jielu', 'mainline/liangshan-songbie', 'mainline/jieyangling', 'mainline/jieyangzhen', 'mainline/mujiazhuang', 'mainline/chuanhuoer'] },
  { name: '浔阳江头', stages: ['mainline/jiangzhou-laocheng', 'mainline/dufang', 'mainline/pipating', 'mainline/xunyanglou'] },
  // 负责人 2026-11-19：戴宗送信上东京（原著第 39 回）：朱贵酒店、梁山定计、赚萧让金大坚、假信被识破；新好汉朱贵、萧让、金大坚
  { name: '戴宗传假信', stages: ['mainline/zhuguidian', 'mainline/liangshan-dingji', 'mainline/zhuanshang', 'mainline/jiaxin'] },
  { name: '江州劫法场', stages: ['mainline/fachang', 'mainline/bailongmiao'] },
  // 负责人 2026-11-21：智取无为军（原著第 41 回）：薛永、侯健、白胜潜入城中摸清两座黄宅，侯健骗开黄文炳家大门，武龙、晁盖杀入放火；
  // 江上擒黄文炳只用对白，穆家庄割黄文炳为过场；黄门山收四人先不做
  { name: '智取无为军', stages: ['mainline/wuweijun', 'mainline/jiehuang'] },
  // 负责人 2026-11-21：还道村受天书（原著第 42 回）：宋江独自回乡被赵能、赵得追进还道村玄女庙，黑尘怪风吹散土兵，
  // 玄女授三卷天书；李逵、刘唐、石勇、李立和黄门山的欧鹏、陶宗旺（友军）杀进庙来
  { name: '还道村受天书', stages: ['mainline/huandaocun'] },
];

/**
 * 序章（负责人 2026-11-20，§15.26）：第一章之前的教学关，不占章号（章号 0，标签「序章 禁军教头」）。
 * 只能放插关；新开战役时先演这里，打完接第一章的第一关。
 */
export const PROLOGUE: ChapterDef = { name: '禁军教头', stages: ['mainline/jiaochang', 'mainline/xihuamen'] };

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
  /** 章号（从 1 起；序章是 0） */
  chapter: number;
}

/** 整条主线（按表里的顺序展开）；用正式章节表时序章排在最前（章号 0） */
export function chapterSequence(chapters: ChapterDef[] = CHAPTERS, prologue: ChapterDef | null = chapters === CHAPTERS ? PROLOGUE : null): SequenceItem[] {
  return [...(prologue?.stages.map((key) => ({ key, chapter: 0 })) ?? []), ...chapters.flatMap((c, i) => c.stages.map((key) => ({ key, chapter: i + 1 })))];
}

/** 某一关（原版地图名或插关 ref，不分大小写）所在的章号；不在表里为 0（序章也是 0，用 chapterSequence 区分） */
export function chapterOf(key: string, chapters: ChapterDef[] = CHAPTERS): number {
  const k = key.toLowerCase();
  return chapterSequence(chapters).find((x) => x.key.toLowerCase() === k)?.chapter ?? 0;
}

/** 例："第十六章 景阳冈打虎"；章号不在表里时为空串 */
export function chapterLabel(n: number, chapters: ChapterDef[] = CHAPTERS): string {
  if (n === 0 && chapters === CHAPTERS) return `序章 ${PROLOGUE.name}`;
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
