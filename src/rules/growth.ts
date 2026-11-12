// 属性成长与敌兵模板【新】（负责人 2026-11-12 定，docs/game-design.md §3）。
// 原版：属性(L) = 基础值 × (成长%/100)^L，攻防等封顶 255、生命气力封顶 510（EXE 0x408540）。
// 防御、敏捷每级 ×1.10 而攻击只有 ×1.04–1.05，后期大家都顶到 255，好汉之间没有区别。
// 重制版：每升一级加"固定点数 + 初始值 × 百分比"，好汉和敌人同一套规则，不封顶。
import type { ClassDef } from './data.ts';

export type StatKey = 'hp' | 'mp' | 'attack' | 'defense' | 'hit' | 'agility' | 'crit';
export const STAT_KEYS: StatKey[] = ['hp', 'mp', 'attack', 'defense', 'hit', 'agility', 'crit'];

/** 每级成长：[固定点数, 初始值的百分比]。好汉平均值在 10 级时与原版接近 */
export const GROWTH: Record<StatKey, [number, number]> = {
  hp: [2, 2.5],
  mp: [2, 2],
  attack: [1.5, 3],
  defense: [2, 8],
  hit: [2, 4],
  agility: [1, 6],
  crit: [0.4, 3.5],
};

/** 杂兵模板（初始值）。同档同等级的兵属性完全一样，兵种之间只有移动力、武器和技能不同 */
export const GRUNT: Record<StatKey, number> = { hp: 55, mp: 45, attack: 50, defense: 20, hit: 55, agility: 22, crit: 0 };
/** 小头目模板：比杂兵硬一档（负责人 2026-11-12：我方约 3–3.5 下打倒一个） */
export const OFFICER: Record<StatKey, number> = { hp: 95, mp: 80, attack: 66, defense: 28, hit: 70, agility: 30, crit: 12 };
/** 模板兵的装备不加属性，改为每档固定加成（各关原版配装的平均值），不随等级成长 */
export const GRUNT_GEAR: Partial<Record<StatKey, number>> = { hp: 3, mp: 5, attack: 15, defense: 13, agility: 5 };
export const OFFICER_GEAR: Partial<Record<StatKey, number>> = { hp: 3, mp: 8, attack: 6, defense: 16, agility: 8 };

/** 职业号：士兵、囉嘍、莊客、漁人、官吏、家人、弓箭手、徒弟 */
export const GRUNT_CLASSES = new Set([19, 20, 21, 22, 23, 32, 33, 34, 36, 37, 40, 41, 44, 45, 67]);
/** 职业号：都頭、教頭、縣尉、騎兵、頭領、刺客 */
export const OFFICER_CLASSES = new Set([38, 39, 42, 43, 65, 66]);

export type Tier = 'grunt' | 'officer' | null;
export const tierOf = (cls: ClassDef): Tier => (GRUNT_CLASSES.has(cls.id) ? 'grunt' : OFFICER_CLASSES.has(cls.id) ? 'officer' : null);

/** 个别职业的初始值调整（职业号 → 属性），覆盖职业表原值 */
export const CLASS_OVERRIDES: Record<number, Partial<Record<StatKey, number>>> = {
  1: { attack: 80 }, // 王進：原版 70。改成新成长后前期显弱，负责人 2026-11-12 要求前期打兵伤害约 +15%
};

/**
 * 按职业的偏移【新】（负责人 2026-11-12 确认建议）：在模板或原版初始值上调整，成长公式不变，所以偏移会随等级放大。
 * pct：百分比（+8 表示 ×1.08）；add：直接加点数（必杀这类小数值用）。想调哪个敌人改这张表。
 */
export interface Tweak {
  pct?: Partial<Record<StatKey, number>>;
  add?: Partial<Record<StatKey, number>>;
}
export const CLASS_TWEAKS: Record<number, Tweak> = {
  // 小头目：都頭 38 是标准，不动
  39: { pct: { attack: 8, hit: 5 }, add: { crit: 5 } }, // 教頭
  42: { pct: { hit: 10, mp: 30, defense: -5 } }, // 縣尉
  43: { pct: { attack: 8, defense: -8, agility: 10 } }, // 騎兵
  65: { pct: { hp: 15, defense: 5 } }, // 頭領
  66: { pct: { agility: 25, hp: -15, defense: -10 }, add: { crit: 8 } }, // 刺客
  // 名将
  59: { pct: { attack: -30 } }, // 陳達：第 2 章约 2.2 下就能打倒我方（技能威力还在，-15% 不够）
  49: { pct: { hp: 25 } }, // 李吉
  63: { pct: { attack: 10 } }, // 富安
  71: { pct: { hp: 30 } }, // 洪教頭
  48: { pct: { attack: -18, hp: 10 } }, // 朱仝
  60: { pct: { attack: -8, hp: 10 } }, // 雷橫
  52: { pct: { attack: -12 } }, // 阮小七
  56: { pct: { hp: -15 }, add: { crit: -10 } }, // 高俅
  68: { pct: { agility: -15 } }, // 王倫
};

/** 初始值：模板兵用模板，其余（好汉、有名有姓的敌人、平民）用原版职业表（个别有调整） */
export function baseStat(cls: ClassDef, k: StatKey): number {
  const t = tierOf(cls);
  const v = t === 'grunt' ? GRUNT[k] : t === 'officer' ? OFFICER[k] : (CLASS_OVERRIDES[cls.id]?.[k] ?? cls[k].base);
  const tw = CLASS_TWEAKS[cls.id];
  return tw ? Math.max(0, Math.round(v * (1 + (tw.pct?.[k] ?? 0) / 100) + (tw.add?.[k] ?? 0))) : v;
}

/** 每级加多少（可以是小数，累计后取整） */
export function perLevel(cls: ClassDef, k: StatKey): number {
  const [fixed, pct] = GROWTH[k];
  return fixed + (baseStat(cls, k) * pct) / 100;
}

/** 属性(L) = floor(初始值 + L × (固定点数 + 初始值 × 百分比)) */
export function statAt(cls: ClassDef, k: StatKey, level: number): number {
  return Math.floor(baseStat(cls, k) + level * perLevel(cls, k));
}

export function tierGear(cls: ClassDef): Partial<Record<StatKey, number>> | null {
  const t = tierOf(cls);
  return t === 'grunt' ? GRUNT_GEAR : t === 'officer' ? OFFICER_GEAR : null;
}
