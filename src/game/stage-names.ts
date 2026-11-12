/**
 * 关卡选择器里显示的章名、关名和城镇名（重制版新起的名字，原版只有"第N章 戰役N"）。
 * 章名多借原著回目；关名按各关剧本内容起；城镇名按城镇传闻文字推出的地点（EXE 0x445f50 城镇传闻表），
 * 其中 5、9、12、13 号城镇没有点明地名，按剧情路线推测。
 */

/** 第 1–15 章（下标 = 章号） */
export const CHAPTER_NAMES = [
  '',
  '私走延安府',
  '九纹龙史进',
  '夜走华阴县',
  '大闹桃花村',
  '东京遇林冲',
  '误入白虎堂',
  '大闹野猪林',
  '柴门招豪客',
  '风雪山神庙',
  '青面兽杨志',
  '认义东溪村',
  '义释晁天王',
  '石碣村三雄',
  '投奔梁山泊',
  '梁山泊聚义',
];

/** 地图名（小写）→ 关名 */
export const STAGE_NAMES: Record<string, string> = {
  n01: '护母突围',
  'n-add01': '山道救母',
  'n-add02': '力服九纹龙',
  'act2-2': '史进拜师',
  'act2-3': '少华山聚议',
  n02: '活捉跳涧虎',
  'n-add03': '伏截喽啰',
  'act3-1': '朱武苦肉计',
  'act3-2': '义释陈达',
  'act3-3': '李吉告密',
  n03: '血战史家庄',
  'act3-4': '结义闯天下',
  'n-add04a': '官道遇伏兵',
  'n-add04b': '山径斗毛贼',
  'act5-1a': '夜投桃花村',
  'n-add05': '误斗庄客',
  'act4-2': '小霸王抢亲',
  'act4-3': '花和尚现身',
  n04: '力保桃花村',
  'act5-1': '智深话往事',
  'n-add06': '此路是我开',
  train1: '延安府练武',
  'n-add07': '反劫剪径贼',
  'act5-2': '酒楼结豪杰',
  'act5-3': '岳庙逢恶少',
  n05: '痛打高衙内',
  'act6-1': '富安献毒计',
  'act6-2': '识破鸿门宴',
  'n-add08': '强闯太尉府',
  'act6-3': '白虎节堂',
  n06: '力战高太尉',
  'act7-1': '林冲别妻',
  'act7-1a': '陆谦拦路',
  n07: '野猪林破伏',
  'n-add09a': '关前遇盘查',
  'n-add09b': '护送林夫人',
  'act8-1': '初会柴大官人',
  'n-add10': '棒打洪教头',
  n08: '洪教头寻仇',
  'act9-1': '沧州设毒计',
  n09: '火烧草料场',
  'n-add11': '摆脱追骑',
  'act10-1': '智取生辰纲',
  'act10-2': '冈上遇杨志',
  'n-add12': '强闯二龙山',
  'act11-1a': '邓龙分赃',
  n10: '力擒金眼虎',
  'act11-1': '追问生辰纲',
  'act11-2': '何涛追赃',
  'n-add13': '叫阵晁家庄',
  n11: '斗托塔天王',
  'n-add14': '大破何涛',
  n12: '东溪村突围',
  'act13-1': '何涛扑空',
  'n-add15': '断后阻追兵',
  'act13-2': '阮氏设伏',
  n13: '诱敌蓼儿洼',
  'act14-1': '共议上梁山',
  'n-add16': '山下破埋伏',
  train2: '再访延安府',
  'act14-2': '王伦设宴',
  'act14-3': '王伦拒贤',
  n14: '火并王伦',
};

/** 城镇号（剧本头 +9）→ 地名 */
export const TOWN_NAMES: Record<number, string> = {
  1: '华阴县',
  2: '桃花山下',
  3: '延安府道',
  4: '东京城',
  5: '沧州道',
  6: '沧州城',
  7: '黄泥冈前',
  8: '郓城县',
  9: '东溪村外',
  10: '石碣村',
  11: '梁山泊畔',
  12: '沧州城',
  13: '野猪林前',
};

const DIGITS = '零一二三四五六七八九';
/** 1–99 的中文数字 */
export function cnNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  const t = Math.floor(n / 10), u = n % 10;
  return `${t === 1 ? '' : DIGITS[t]}十${u ? DIGITS[u] : ''}`;
}

export interface StageLabel {
  /** 章号（取自 EXE 关卡表标题"第N章"；取不到为 0） */
  chapter: number;
  /** 例："第三章 夜走华阴县" */
  chapterLabel: string;
  /** 战役一 / 训练 / 剧情 */
  kind: string;
  /** 关名；没有起名时退回原版标题 */
  name: string;
  /** 例："战役二 山径斗毛贼" */
  short: string;
  /** 例："第三章 战役二 · 山径斗毛贼" */
  full: string;
}

/** 由 EXE 关卡表标题（繁体，如"第3章 戰役2""第5章 訓練""第2章"）和地图名拼出显示用名字 */
export function stageLabel(title: string, mapName: string): StageLabel {
  const ch = Number(/第\s*(\d+)\s*章/.exec(title)?.[1] ?? 0);
  const battle = /戰役\s*(\d+)/.exec(title);
  const kind = battle ? `战役${cnNumber(Number(battle[1]))}` : /訓練/.test(title) ? '训练' : '剧情';
  const name = STAGE_NAMES[mapName.toLowerCase()] ?? (title || mapName);
  const chapterLabel = ch ? `第${cnNumber(ch)}章 ${CHAPTER_NAMES[ch] ?? ''}`.trim() : '';
  const short = `${kind} ${name}`;
  return { chapter: ch, chapterLabel, kind, name, short, full: ch ? `第${cnNumber(ch)}章 ${kind} · ${name}` : short };
}

export function townName(town: number): string {
  return TOWN_NAMES[town] ?? `城镇 ${town}`;
}
