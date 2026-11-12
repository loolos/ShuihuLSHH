// GOO 道具表（Goods.dab）：11 B 头 + 200 × 198 B。字段说明见 docs/binary-formats.md §9。
import { decodeBig5, expectMagic } from './bytes.ts';

export const GOO_RECORD = 198;

export interface Item {
  id: number;
  type: number; // +0 类型码：0–12 武器类、13 衣服、14 头饰、≥15 消耗品/特殊
  category: number; // +1 大类
  icon: number; // +2 图标编号（Object.lib 帧号）
  name: string; // +6
  description: string; // +26
  moveBonus: number; // +104 移动力加成
  /** 装备加成与消耗品效果（全部 s16，见 binary-formats §9） */
  attack: number; // +76 装备攻击；消耗品为增益值（+78 回合）
  attackTurns: number; // +78 消耗品：攻击增益的回合数
  attackStep: number; // +80 每次打铁提升的攻击
  attackSteps: number; // +82 可提升次数
  defense: number; // +84
  defenseStep: number; // +88
  defenseSteps: number; // +90
  hit: number; // +92
  agility: number; // +96
  crit: number; // +100
  range: number; // +108 射程加成
  maxHp: number; // +110 装备：生命上限加成
  maxMp: number; // +112
  healHp: number; // +114 消耗品：回复生命（−1 = 全满）
  healMp: number; // +116
  regenHp: number; // +118 装备：每回合回复生命
  regenMp: number; // +120
  curePoison: number; // +126
  cureStun: number; // +128
  poison: number; // +134 装备：攻击附带中毒 %
  stun: number; // +136 装备：攻击附带昏迷 %
  buyPrice: number; // +142
  sellPrice: number; // +144
  params: number[]; // +86 起 27 个 s16，语义大多未解
  seqA: number[]; // +146 起 13 个 u16
  seqB: number[]; // +172 起 13 个 u16
}

export function parseGoods(buf: Buffer): Item[] {
  expectMagic(buf, 'GOO\0', 'Goods.dab');
  const n = buf.readUInt16LE(5);
  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const o = 11 + i * GOO_RECORD;
    const str = (a: number, len: number) => decodeBig5(buf.subarray(o + a, o + a + len)).replace(/\0.*$/s, '');
    const s16 = (a: number) => buf.readInt16LE(o + a);
    const params: number[] = [];
    for (let k = 0; k < 27; k++) params.push(buf.readInt16LE(o + 86 + 2 * k));
    const seq = (a: number) => Array.from({ length: 13 }, (_, k) => buf.readUInt16LE(o + a + 2 * k));
    items.push({
      id: i,
      type: buf[o],
      category: buf[o + 1],
      icon: buf.readUInt16LE(o + 2),
      name: str(6, 20),
      description: str(26, 60).trim(),
      moveBonus: buf.readInt16LE(o + 104),
      attack: s16(76),
      attackTurns: s16(78),
      attackStep: s16(80),
      attackSteps: s16(82),
      defense: s16(84),
      defenseStep: s16(88),
      defenseSteps: s16(90),
      hit: s16(92),
      agility: s16(96),
      crit: s16(100),
      range: s16(108),
      maxHp: s16(110),
      maxMp: s16(112),
      healHp: s16(114),
      healMp: s16(116),
      regenHp: s16(118),
      regenMp: s16(120),
      curePoison: s16(126),
      cureStun: s16(128),
      poison: s16(134),
      stun: s16(136),
      buyPrice: buf.readUInt16LE(o + 142),
      sellPrice: buf.readUInt16LE(o + 144),
      params,
      seqA: seq(146),
      seqB: seq(172),
    });
  }
  if (11 + n * GOO_RECORD !== buf.length) throw new Error('Goods.dab: 长度与记录数不符');
  return items;
}

export const WEAPON_TYPES = ['手套/拳', '棍', '雙刀', '大刀', '槍', '禪杖/鏟', '刀', '劍', '雙劍', '叉', '槳', '(11，疑為弓)', '(12)'];
export const ITEM_TYPE_NAMES: Record<number, string> = {
  13: '衣服',
  14: '頭飾/書籍',
  15: '回復體力',
  16: '回復氣力',
  17: '同時回復',
  18: '解毒',
  19: '解昏迷',
  20: '抗毒',
  21: '抗昏',
  22: '限時增益',
  23: '財寶',
};
export function itemTypeName(t: number): string {
  return t <= 12 ? `武器·${WEAPON_TYPES[t]}` : (ITEM_TYPE_NAMES[t] ?? `類型${t}`);
}
