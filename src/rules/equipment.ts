// 己方默认配装表。原版依据：Goods.dab +0/+6；Human.hum 默认装备，见 docs/reference/data-tables.md。
// 每一列对应 LEVEL_BANDS。只在生成默认状态时使用，不在升级时覆盖玩家装备。
import { itemOf, SLOT_COUNT, type ClassDef, type GameData } from './data.ts';
export const LEVEL_BANDS = [1, 5, 10, 15, 20, 25, 30] as const;
export const EQUIPMENT_CATEGORIES: Record<string, string[]> = {
  "常服": ["布衣", "官服", "棋子布背心", "夜行衣", "領皂沙背心", "麻布寬衫", "紅羅繡襖", "青紗衫子", "皂色繡襖"],
  "僧衣": ["僧服", "袈裟"],
  "蓑衣": ["綠蓑衣"],
  "战袍": ["戰袍", "虎皮戰袍", "金繡綠羅袍", "綠羅花戰袍"],
  "道袍": ["七星道袍"],
  "轻甲": ["掩心鐵", "護心鏡", "熟皮甲", "連環甲", "朱紅甲"],
  "重甲": ["裹金生鐵甲", "鑲銀生鐵甲", "魚鱗鐵甲", "狻猊甲", "鐵葉攢鎧", "梅花榆葉甲", "雁翎圈金甲"],
  "头巾": ["一字巾", "破頭巾", "絳紅巾", "乾紅凹面巾", "青紗頭巾", "萬字巾", "軟紗唐巾", "黑頭巾", "皂紗唐巾"],
  "便帽": ["虎皮帽"],
  "僧帽": ["僧帽"],
  "官帽": ["官帽", "烏紗帽"],
  "斗笠": ["遮日黑箬笠", "紅纓氈笠", "碧雲箬笠"],
  "战盔": ["熟鐵盔", "朱纓盔", "獅子盔", "熟鋼獅子盔", "耀日鑌鐵盔", "鳳翅金盔"],
  "护符": ["玄武護符", "白虎護符", "青龍護符", "朱雀護符", "麒麟護符"],
  "花饰": ["青花錫飾", "水蓮鐵飾", "芙蓉銅飾", "牡丹銀飾", "菊花金飾"],
  "纹玉": ["百鳥紋玉", "萬獸紋玉", "猛虎紋玉", "鳳凰紋玉", "雙龍紋玉"],
  "兵书": ["鬼谷子兵法", "孫臏兵法", "孫子兵法", "黃石公兵法", "孔明兵法"],
  "特殊": ["108魔星草人"]
};
export const GEAR_TABLE: Record<string, string[]> = {
  "常服": ["布衣", "官服", "夜行衣", "領皂沙背心", "麻布寬衫", "青紗衫子", "皂色繡襖"],
  "僧衣": ["僧服", "僧服", "僧服", "僧服", "袈裟", "袈裟", "袈裟"],
  "蓑衣": ["綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣", "綠蓑衣"],
  "战袍": ["戰袍", "戰袍", "虎皮戰袍", "金繡綠羅袍", "金繡綠羅袍", "金繡綠羅袍", "綠羅花戰袍"],
  "道袍": ["七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍", "七星道袍"],
  "轻甲": ["掩心鐵", "護心鏡", "護心鏡", "熟皮甲", "連環甲", "連環甲", "朱紅甲"],
  "重甲": ["裹金生鐵甲", "鑲銀生鐵甲", "魚鱗鐵甲", "狻猊甲", "鐵葉攢鎧", "梅花榆葉甲", "雁翎圈金甲"],
  "头巾": ["一字巾", "破頭巾", "乾紅凹面巾", "青紗頭巾", "萬字巾", "黑頭巾", "皂紗唐巾"],
  "便帽": ["虎皮帽", "虎皮帽", "虎皮帽", "虎皮帽", "虎皮帽", "虎皮帽", "虎皮帽"],
  "僧帽": ["僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽", "僧帽"],
  "官帽": ["官帽", "官帽", "官帽", "官帽", "烏紗帽", "烏紗帽", "烏紗帽"],
  "斗笠": ["遮日黑箬笠", "遮日黑箬笠", "紅纓氈笠", "紅纓氈笠", "紅纓氈笠", "碧雲箬笠", "碧雲箬笠"],
  "战盔": ["熟鐵盔", "朱纓盔", "獅子盔", "獅子盔", "熟鋼獅子盔", "耀日鑌鐵盔", "鳳翅金盔"],
};
export const WEAPON_TABLE: Record<number, string[]> = {
  "0": ["皮手套", "白銀手套", "烏金手套", "鐵拳", "精鋼拳", "精鋼刺拳", "鐵甲拳"],
  "1": ["杖", "木棍", "熟銅棍", "鑌鐵棍", "純鋼鐵棍", "五郎棍", "羅漢棍"],
  "2": ["雙刀", "日月刀", "子母刀", "子母刀", "陰陽刀", "鴛鴦刀", "冰火刀"],
  "3": ["大杆刀", "朴刀", "屈刀", "眉尖刀", "鳳嘴刀", "掩月刀", "金龍大刀"],
  "4": ["長槍", "筆管槍", "綠沉槍", "鴉角槍", "白點鋼槍", "丈八點鋼矛", "透甲槍"],
  "5": ["水磨禪杖", "渾鐵禪杖", "渾鐵禪杖", "月牙鏟", "降魔鏟", "降魔鏟", "巨靈鏟"],
  "6": ["鋼刀", "解腕尖刀", "解腕尖刀", "腰刀", "戒刀", "戒刀", "三尖兩刃刀"],
  "7": ["鋼劍", "鋼劍", "闊劍", "錕吾劍", "錕吾劍", "錕吾劍", "龍泉劍"],
  "8": ["雙劍", "雙劍", "兩儀劍", "兩儀劍", "兩儀劍", "鴛鴦劍", "鴛鴦劍"],
  "9": ["魚叉", "魚叉", "鋼叉", "鋼叉", "鋼叉", "飛魚叉", "飛魚叉"],
  "10": ["木槳", "木槳", "鐵槳", "鐵槳", "鐵槳", "鑌鐵槳", "鑌鐵槳"],
  // 弓：原版没有，扩展包 mainline 新增（负责人 2026-11-15），只有花荣用
  "11": ["獵弓", "獵弓", "鵲畫弓", "鵲畫弓", "鵲畫弓", "寶雕弓", "寶雕弓"],
  "12": ["", "", "", "", "", "", ""]
};
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
    "head": "头巾"
  },
  "3": {
    "weapon": 0,
    "armor": "常服",
    "head": "头巾"
  },
  "4": {
    "weapon": 6,
    "armor": "常服",
    "head": "头巾"
  },
  "5": {
    "weapon": 2,
    "armor": "重甲",
    "head": "头巾"
  },
  "6": {
    "weapon": 0,
    "armor": "常服",
    "head": "官帽"
  },
  "7": {
    "weapon": 9,
    "armor": "常服",
    "head": "头巾"
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
    "head": "头巾"
  },
  "12": {
    "weapon": 0,
    "armor": "战袍",
    "head": "头巾"
  },
  "13": {
    "weapon": 4,
    "armor": "重甲",
    "head": "头巾"
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
];
export function kitBand(level: number): number {
  return Math.max(0, LEVEL_BANDS.filter((min) => level >= min).length - 1);
}
/** 原版人物有显式标定；扩展人物按初始衣服/头饰归类，缺省常服/头巾。 */
export function kitProfile(data: GameData, cls: ClassDef) {
  const category = (slot: number, fallback: string) => {
    const name = itemOf(data, cls.defaultItems[slot])?.name;
    return Object.keys(EQUIPMENT_CATEGORIES).find((key) => name && EQUIPMENT_CATEGORIES[key].includes(name)) ?? fallback;
  };
  return HERO_KITS[cls.id] ?? { armor: category(1, '常服'), head: category(2, '头巾') };
}
export function levelKit(data: GameData, cls: ClassDef, level: number, slots: number[], keep: (id: number) => boolean = () => false): void {
  while (slots.length < SLOT_COUNT) slots.push(0);
  const band = kitBand(level), profile = kitProfile(data, cls);
  // 默认武器优先遵照出场武器的类型（阮小五等职业表和初始武器不一致）。
  const weaponType = HERO_KITS[cls.id]?.weapon ?? itemOf(data, cls.defaultItems[0])?.type ?? cls.weaponType;
  const names = [WEAPON_TABLE[weaponType]?.[band], GEAR_TABLE[profile.armor]?.[band], GEAR_TABLE[profile.head]?.[band]];
  // 剧本（或职业默认）给的装备比表里这一档好就留着（负责人 2026-11-15）：武器比攻击，衣服、头饰比防御
  const score = (id: number, k: number) => { const it = itemOf(data, id); return it ? (k === 0 ? it.attack : it.defense) : -1; };
  names.forEach((name, k) => {
    if (!name || keep(slots[k])) return; // 弓手类（11、12）表里没有武器，别误配到无名的空道具
    const id = data.items.findIndex((it) => it.name === name) + 1;
    if (id && score(slots[k], k) <= score(id, k)) slots[k] = id;
  });
  // 清掉旧药品（含解毒、抗性、增益药），重新发本档药；非药品剧情物品保留。
  for (let k = 3; k < slots.length; k++) {
    const it = itemOf(data, slots[k]);
    if (it && it.type >= 15 && it.type <= 22) slots[k] = 0;
  }
  for (const name of MEDICINE_TABLE[band]) {
    const id = data.items.findIndex((it) => it.name === name) + 1;
    const empty = slots.findIndex((v, k) => k >= 3 && !v);
    if (id && empty >= 0) slots[empty] = id;
  }
}
