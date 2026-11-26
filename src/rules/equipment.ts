// 己方默认配装表。原版依据：Goods.dab +0/+6；Human.hum 默认装备，见 docs/reference/data-tables.md。
// 每一列对应 LEVEL_BANDS。只在生成默认状态时使用，不在升级时覆盖玩家装备。
import { itemOf, SLOT_COUNT, type ClassDef, type GameData } from './data.ts';
export const LEVEL_BANDS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45] as const;
/**
 * 衣帽类别。负责人 2026-11-26：梅花榆葉甲、雁翎圈金甲（加体气、命中敏捷、移动）改归战袍；夜行衣单列；
 * 轻甲不扣敏捷、战盔扣得少（data.ts ITEM_OVERRIDES）。新货：鎖子甲 / 柳葉軟甲 / 爛銀盔（原版空道具位），
 * 錦繡衫 / 金線抹額 / 烏犀軟甲 / 烏油對嵌鎧 / 紫金盔（mainline 包，续篇商店分档）。
 */
export const EQUIPMENT_CATEGORIES: Record<string, string[]> = {
  "常服": ["布衣", "官服", "棋子布背心", "領皂沙背心", "麻布寬衫", "紅羅繡襖", "青紗衫子", "皂色繡襖", "錦繡衫"],
  "夜行衣": ["夜行衣"],
  "僧衣": ["僧服", "袈裟"],
  "蓑衣": ["綠蓑衣"],
  "战袍": ["戰袍", "虎皮戰袍", "金繡綠羅袍", "綠羅花戰袍", "梅花榆葉甲", "雁翎圈金甲"],
  "道袍": ["七星道袍"],
  "轻甲": ["掩心鐵", "護心鏡", "熟皮甲", "連環甲", "朱紅甲", "鎖子甲", "柳葉軟甲", "烏犀軟甲"],
  "重甲": ["裹金生鐵甲", "鑲銀生鐵甲", "魚鱗鐵甲", "狻猊甲", "鐵葉攢鎧", "烏油對嵌鎧"],
  "头巾": ["一字巾", "破頭巾", "絳紅巾", "乾紅凹面巾", "青紗頭巾", "萬字巾", "軟紗唐巾", "黑頭巾", "皂紗唐巾", "金線抹額"],
  "帽子": ["虎皮帽", "僧帽", "官帽", "貂鼠皮帽", "烏紗帽", "束髮紫金冠"],
  "斗笠": ["遮日黑箬笠", "青竹斗笠", "紅纓氈笠", "白范陽氈笠", "碧雲箬笠"],
  "战盔": ["熟鐵盔", "朱纓盔", "獅子盔", "熟鋼獅子盔", "耀日鑌鐵盔", "鳳翅金盔", "爛銀盔", "紫金盔"],
  "护符": ["玄武護符", "白虎護符", "青龍護符", "朱雀護符", "麒麟護符"],
  "花饰": ["青花錫飾", "水蓮鐵飾", "芙蓉銅飾", "牡丹銀飾", "菊花金飾"],
  "纹玉": ["百鳥紋玉", "萬獸紋玉", "猛虎紋玉", "鳳凰紋玉", "雙龍紋玉"],
  "兵书": ["鬼谷子兵法", "孫臏兵法", "孫子兵法", "黃石公兵法", "孔明兵法"],
  "特殊": ["108魔星草人"]
};
/** 商店里并成「其他」的小类（负责人 2026-11-26）：只有一两件、以后不扩展；配装表仍按原类别给人物。便帽、僧帽、官帽合成「帽子」（防低、每回合回体回气）；头饰的护符、花饰、纹玉、兵书也并进「其他」，不再扩充 */
export const SHOP_OTHER = new Set(['夜行衣', '僧衣', '蓑衣', '道袍', '护符', '花饰', '纹玉', '兵书', '特殊']);
/** 商店折叠列表里衣帽的二级分类名 */
export function shopGroup(name: string): string {
  const key = Object.keys(EQUIPMENT_CATEGORIES).find((k) => EQUIPMENT_CATEGORIES[k].includes(name));
  return !key || SHOP_OTHER.has(key) ? '其他' : key;
}
/** 每列对应 LEVEL_BANDS；35 级起的货只在续篇商店（mainline 包）有，原版数据里查不到时退回前一档（levelKit） */
export const GEAR_TABLE: Record<string, string[]> = {
  "常服": ["布衣", "官服", "棋子布背心", "領皂沙背心", "麻布寬衫", "青紗衫子", "皂色繡襖", "錦繡衫", "錦繡衫", "錦繡衫"],
  "僧衣": ["僧服", "僧服", "僧服", "僧服", "袈裟", "袈裟", "袈裟", "袈裟", "袈裟", "袈裟"],
  "蓑衣": ["綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣"],
  "战袍": ["戰袍", "戰袍", "虎皮戰袍", "金繡綠羅袍", "金繡綠羅袍", "金繡綠羅袍", "綠羅花戰袍", "梅花榆葉甲", "雁翎圈金甲", "雁翎圈金甲"],
  "道袍": ["七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍"],
  "轻甲": ["掩心鐵", "護心鏡", "護心鏡", "熟皮甲", "連環甲", "鎖子甲", "柳葉軟甲", "柳葉軟甲", "烏犀軟甲", "烏犀軟甲"],
  "重甲": ["裹金生鐵甲", "鑲銀生鐵甲", "魚鱗鐵甲", "狻猊甲", "鐵葉攢鎧", "鐵葉攢鎧", "鐵葉攢鎧", "鐵葉攢鎧", "烏油對嵌鎧", "烏油對嵌鎧"],
  "头巾": ["一字巾", "破頭巾", "乾紅凹面巾", "青紗頭巾", "萬字巾", "黑頭巾", "皂紗唐巾", "金線抹額", "金線抹額", "金線抹額"],
  "帽子": ["虎皮帽", "虎皮帽", "官帽", "官帽", "官帽", "貂鼠皮帽", "烏紗帽", "束髮紫金冠", "束髮紫金冠", "束髮紫金冠"],
  // 只给鲁智深的配装行（商店里归帽子）：出家人一直戴僧帽
  "僧帽": ["僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽"],
  "斗笠": ["遮日黑箬笠", "遮日黑箬笠", "遮日黑箬笠", "青竹斗笠", "紅纓氈笠", "白范陽氈笠", "白范陽氈笠", "碧雲箬笠", "碧雲箬笠", "碧雲箬笠"],
  "战盔": ["熟鐵盔", "朱纓盔", "獅子盔", "獅子盔", "熟鋼獅子盔", "耀日鑌鐵盔", "爛銀盔", "爛銀盔", "紫金盔", "紫金盔"],
};
export const WEAPON_TABLE: Record<number, string[]> = {
  "0": ["皮手套", "白銀手套", "烏金手套", "鐵拳", "精鋼拳", "精鋼刺拳", "金剛拳套", "伏虎鐵拳", "伏虎鐵拳", "伏虎鐵拳"],
  "1": ["杖", "木棍", "木棍", "水火棍", "熟銅棍", "純鋼鐵棍", "五郎棍", "蟠龍棍", "蟠龍棍", "蟠龍棍"],
  "2": ["雙刀", "日月刀", "子母刀", "子母刀", "陰陽刀", "鴛鴦刀", "冰火刀", "雪花雙戒刀", "雪花雙戒刀", "雪花雙戒刀"],
  "3": ["大杆刀", "朴刀", "屈刀", "眉尖刀", "鳳嘴刀", "掩月刀", "金龍大刀", "潑風大刀", "潑風大刀", "潑風大刀"],
  "4": ["長槍", "筆管槍", "綠沉槍", "鴉角槍", "白點鋼槍", "丈八點鋼矛", "透甲槍", "丈八蛇矛", "丈八蛇矛", "丈八蛇矛"],
  "5": ["水磨禪杖", "渾鐵禪杖", "渾鐵禪杖", "月牙鏟", "降魔鏟", "降魔鏟", "巨靈鏟", "鑌鐵月牙杖", "鑌鐵月牙杖", "鑌鐵月牙杖"],
  "6": ["鋼刀", "鋼刀", "鋼刀", "解腕尖刀", "四竅八環刀", "腰刀", "戒刀", "雁翎刀", "楊家寶刀", "楊家寶刀"],
  "7": ["鋼劍", "鋼劍", "鋼劍", "鋼劍", "鋼劍", "玄鐵劍", "龍泉劍", "松紋古定劍", "松紋古定劍", "松紋古定劍"],
  "8": ["雙劍", "雙劍", "兩儀劍", "兩儀劍", "兩儀劍", "鴛鴦劍", "雌雄寶劍", "七星雙劍", "七星雙劍", "七星雙劍"],
  "9": ["魚叉", "魚叉", "鋼叉", "鋼叉", "鋼叉", "飛魚叉", "飛魚叉", "三股鋼叉", "三股鋼叉", "三股鋼叉"],
  "10": ["木槳", "木槳", "鐵槳", "鐵槳", "鐵槳", "鑌鐵槳", "鑌鐵槳", "蛟龍鐵槳", "蛟龍鐵槳", "蛟龍鐵槳"],
  // 弓：原版没有，扩展包 mainline 新增（负责人 2026-11-15），只有花荣用
  "11": ["獵弓", "獵弓", "鵲畫弓", "鵲畫弓", "鵲畫弓", "寶雕弓", "寶雕弓", "鐵胎弓", "鐵胎弓", "鐵胎弓"],
  "12": ["", "", "", "", "", "", "", "", "", ""]
};
// 负责人 2026-11-26：原版人物也按原著打扮适当调整——朱武 重甲→战袍（军师）；林沖、白勝、阮小二 头巾→斗笠；陳達 头巾→战盔；公孫勝 头巾→帽子（道冠）
export const HERO_KITS: Record<number, { weapon: number; armor: string; head: string }> = {
  "0": {
    "weapon": 0,
    "armor": "常服",
    "head": "头巾"
  },
  "1": {
    "weapon": 1,
    "armor": "常服",
    "head": "头巾"
  },
  "2": {
    "weapon": 8,
    "armor": "道袍",
    "head": "帽子"
  },
  "3": {
    "weapon": 0,
    "armor": "常服",
    "head": "头巾"
  },
  "4": {
    "weapon": 6,
    "armor": "常服",
    "head": "斗笠"
  },
  "5": {
    "weapon": 2,
    "armor": "战袍",
    "head": "头巾"
  },
  "6": {
    "weapon": 0,
    "armor": "常服",
    "head": "帽子"
  },
  "7": {
    "weapon": 9,
    "armor": "常服",
    "head": "斗笠"
  },
  "8": {
    "weapon": 3,
    "armor": "常服",
    "head": "头巾"
  },
  "9": {
    "weapon": 10,
    "armor": "常服",
    "head": "斗笠"
  },
  "10": {
    "weapon": 7,
    "armor": "常服",
    "head": "头巾"
  },
  "11": {
    "weapon": 1,
    "armor": "战袍",
    "head": "斗笠"
  },
  "12": {
    "weapon": 0,
    "armor": "战袍",
    "head": "头巾"
  },
  "13": {
    "weapon": 4,
    "armor": "重甲",
    "head": "战盔"
  },
  "14": {
    "weapon": 6,
    "armor": "常服",
    "head": "斗笠"
  },
  "15": {
    "weapon": 3,
    "armor": "重甲",
    "head": "头巾"
  },
  "16": {
    "weapon": 5,
    "armor": "僧衣",
    "head": "僧帽"
  },
  "17": {
    "weapon": 6,
    "armor": "常服",
    "head": "头巾"
  }
};

/**
 * 默认药品，按 LEVEL_BANDS 分档（负责人 2026-11-25）：高等级不再全给顶级药，最好的情况只有
 * 天山雪蓮、大還金丹各 1 个（25 级起至少 1 个天山雪蓮），其余是中小药，每档最多 4 件；20 级起留 1 个只回气的包子。
 */
export const MEDICINE_TABLE = [
  ['狗皮膏藥', '狗皮膏藥', '跌打藥'],
  ['跌打藥', '跌打藥', '跌打藥'],
  ['跌打藥', '跌打藥', '銀創藥'],
  ['跌打藥', '跌打藥', '銀創藥', '銀創藥'],
  ['銀創藥', '銀創藥', '大還銀丹', '豬肉包子'],
  ['銀創藥', '金創藥', '天山雪蓮', '豬肉包子'],
  ['金創藥', '大還金丹', '天山雪蓮', '牛肉包子'],
  ['萬靈藥', '大還金丹', '天山雪蓮', '牛肉包子'],
  ['回春丹', '大還金丹', '天山雪蓮', '牛肉包子'],
  ['回春丹', '大還金丹', '天山雪蓮', '牛肉包子'],
];
/** 高于这个等级的默认药品另加 1 个 STUN_CURE（负责人 2026-11-26） */
export const STUN_CURE_LEVEL = 20;
export const STUN_CURE = '解昏迷草藥';
export function kitBand(level: number): number {
  return Math.max(0, LEVEL_BANDS.filter((min) => level >= min).length - 1);
}
/**
 * 扩展包好汉按原著改的类别（负责人 2026-11-25，对照原著出场描写；原版 18 人照原版不改）：按职业名查，没列的按初始衣服 / 头饰推断。
 * 武将披挂出阵 → 重甲 / 战盔；花荣「战袍金翠绣」→ 战袍；卖药的薛永、裁缝侯健、开酒店的朱贵 → 常服。
 */
export const PACK_KITS: Record<string, { armor?: string; head?: string }> = {
  秦明: { armor: '重甲', head: '战盔' },
  黄信: { armor: '重甲', head: '战盔' },
  李应: { armor: '重甲', head: '战盔' },
  孙立: { armor: '重甲', head: '战盔' },
  花荣: { armor: '战袍' },
  薛永: { armor: '常服' },
  侯健: { armor: '常服', head: '帽子' },
  朱贵: { armor: '常服', head: '帽子' }, // 开酒店
  // 负责人 2026-11-26：常服 + 头巾的人太多，按原著身份分散开（原版 18 人不动）
  杨雄: { armor: '轻甲', head: '帽子' }, // 两院押狱兼刽子手
  孙新: { armor: '轻甲', head: '帽子' }, // 军官孙立之弟，学得哥哥枪法
  顾大嫂: { armor: '轻甲' }, // 母大虫，开酒店也会使刀弄枪
  解珍: { armor: '轻甲', head: '帽子' }, // 登州猎户，虎皮帽
  解宝: { armor: '轻甲', head: '帽子' },
  杜兴: { armor: '轻甲', head: '帽子' }, // 李家庄主管，随李应厮杀
  王英: { armor: '战袍', head: '战盔' }, // 清风山头领
  马麟: { armor: '战袍', head: '战盔' }, // 黄门山头领
  邹渊: { armor: '战袍', head: '战盔' }, // 登云山头领
  武松: { head: '斗笠' }, // 原著行路「头戴毡笠儿」
  李俊: { armor: '战袍', head: '斗笠' }, // 揭阳岭、浔阳江上的水上好汉
  张横: { head: '斗笠' },
  童威: { head: '斗笠' },
  戴宗: { armor: '轻甲', head: '帽子' }, // 江州两院押牢节级
  乐和: { head: '帽子' }, // 登州牢子
  // 负责人 2026-11-26 第二轮：常服 28、头巾 33 仍太多，再分散（衣服、头饰各自定，不必一一对应）
  石秀: { armor: '轻甲' }, // 和杨雄一起
  邹润: { armor: '战袍' }, // 登云山头领，同邹渊
  燕顺: { head: '战盔' }, // 清风山头领
  吕方: { head: '战盔' }, // 红甲戟将
  郭盛: { head: '战盔' }, // 白甲戟将
  朱富: { head: '帽子' }, // 开酒店
  张顺: { head: '斗笠' }, // 浪里白条，水军
};
/** 原版人物有显式标定；扩展人物按 PACK_KITS 或初始衣服/头饰归类，缺省常服/头巾。 */
export function kitProfile(data: GameData, cls: ClassDef) {
  const category = (slot: number, fallback: string) => {
    const name = itemOf(data, cls.defaultItems[slot])?.name;
    return Object.keys(EQUIPMENT_CATEGORIES).find((key) => name && EQUIPMENT_CATEGORIES[key].includes(name)) ?? fallback;
  };
  const pack = PACK_KITS[cls.name];
  return HERO_KITS[cls.id] ?? { armor: pack?.armor ?? category(1, '常服'), head: pack?.head ?? category(2, '头巾') };
}
const itemId = (data: GameData, name: string) => data.items.findIndex((it) => it?.name === name) + 1;
/** 表里这一档的道具号；这档的货只在扩展包里（原版数据查不到）就往前找 */
function findBack(data: GameData, row: string[], band: number): number {
  for (let b = band; b >= 0; b--) {
    const id = row[b] ? itemId(data, row[b]) : 0;
    if (id) return id;
  }
  return 0;
}
export function levelKit(data: GameData, cls: ClassDef, level: number, slots: number[], keep: (id: number) => boolean = () => false): void {
  while (slots.length < SLOT_COUNT) slots.push(0);
  const band = kitBand(level), profile = kitProfile(data, cls);
  // 默认武器优先遵照出场武器的类型（阮小五等职业表和初始武器不一致）。
  const weaponType = HERO_KITS[cls.id]?.weapon ?? itemOf(data, cls.defaultItems[0])?.type ?? cls.weaponType;
  const names = [WEAPON_TABLE[weaponType]?.[band], GEAR_TABLE[profile.armor]?.[band], GEAR_TABLE[profile.head]?.[band]];
  // 剧本（或职业默认）给的装备比表里这一档好就留着（负责人 2026-11-15）：武器比攻击；
  // 衣服、头饰比买价（买价按全部效果定，斗笠、帽子不会因为防御低被跳过；负责人 2026-11-26），商店不卖的特殊装备（买价 0）仍比防御
  const score = (id: number, k: number, other: number) => {
    const it = itemOf(data, id), o = itemOf(data, other);
    if (!it) return -1;
    if (k === 0) return it.attack;
    return it.buyPrice > 0 && (o?.buyPrice ?? 0) > 0 ? it.buyPrice : it.defense;
  };
  const rows = [WEAPON_TABLE[weaponType], GEAR_TABLE[profile.armor], GEAR_TABLE[profile.head]];
  names.forEach((name, k) => {
    if (!name || keep(slots[k])) return; // 弓手类（11、12）表里没有武器，别误配到无名的空道具
    const id = findBack(data, rows[k] ?? [], band);
    if (id && score(slots[k], k, id) <= score(id, k, slots[k])) slots[k] = id;
  });
  // 清掉旧药品（含解毒、抗性、增益药），重新发本档药；非药品剧情物品保留。
  for (let k = 3; k < slots.length; k++) {
    const it = itemOf(data, slots[k]);
    if (it && it.type >= 15 && it.type <= 22) slots[k] = 0;
  }
  // 高于 20 级每人另带 1 个解昏迷草藥（负责人 2026-11-26），不算在每档 4 件里。
  // 续篇的药（回春丹）原版数据里没有：同一格往前一档找
  const meds = MEDICINE_TABLE[band].map((_, i) => MEDICINE_TABLE.slice(0, band + 1).map((row) => row[i]).reverse().find((n) => n && itemId(data, n)) ?? '');
  for (const name of [...meds, ...(level > STUN_CURE_LEVEL ? [STUN_CURE] : [])]) {
    const id = itemId(data, name);
    const empty = slots.findIndex((v, k) => k >= 3 && !v);
    if (id && empty >= 0) slots[empty] = id;
  }
}
