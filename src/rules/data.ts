// 规则引擎使用的数据：由原版解析结果整理而来，不依赖 Phaser。
import type { ClassRecord, ClassSkill } from '../formats/hum.ts';
import type { Item } from '../formats/goo.ts';
import type { ExePrompt } from '../formats/exe.ts';

export interface SkillDef extends ClassSkill {
  name: string;
}

export interface ClassDef {
  id: number;
  name: string;
  hp: { base: number; growth: number };
  mp: { base: number; growth: number };
  attack: { base: number; growth: number };
  defense: { base: number; growth: number };
  hit: { base: number; growth: number };
  agility: { base: number; growth: number };
  crit: { base: number; growth: number };
  move: number;
  weaponType: number;
  goldCap: number;
  defaultItems: number[];
  skills: SkillDef[];
}

export interface GameData {
  classes: ClassDef[];
  /** 道具编号从 1 开始：item(id) */
  items: Item[];
  charNames: string[];
  /** 主角名（%N）；命名界面做好之前用原版默认名 */
  heroName: string;
  /** 主角绰号（EXE 绰号表第 0 项"關西之虎"，剧本里的 %M） */
  heroNickname?: string;
  /** EXE 里的二选一对话框（0 = 伏兵号令，1、2 = 第 3、8 章分路；src/formats/exe.ts VA_PROMPTS） */
  prompts?: ExePrompt[];
  /** Effect.lib 每组的触发帧（EXE 0x4435e8；src/formats/exe.ts） */
  effectTriggers?: number[];
}

export function buildClasses(records: ClassRecord[], names: string[], skillNames: string[]): ClassDef[] {
  return records.map((r) => {
    const [attack, defense, hit, agility, crit] = r.stats.map((s) => ({ base: s.base, growth: s.growth }));
    return {
      id: r.id,
      name: names[r.id] ?? `#${r.id}`,
      hp: { base: r.hp, growth: r.hpGrowth },
      mp: { base: r.mp, growth: r.mpGrowth },
      attack,
      defense,
      hit,
      agility,
      crit,
      move: r.move,
      weaponType: r.weaponType,
      goldCap: r.goldCap,
      defaultItems: r.defaultItems,
      skills: r.skills.map((s) => ({ ...s, name: skillNames[s.skillId] ?? `#${s.skillId}` })),
    };
  });
}

export function itemOf(data: GameData, id: number): Item | undefined {
  return id > 0 ? data.items[id - 1] : undefined;
}

/** 道具类型码：0–12 武器、13 衣服、14 头饰，可以提供装备加成 */
export const isEquipment = (it: Item | undefined) => !!it && it.type <= 14;
/** 装备栏：前 3 格是武器（类型 0–12）、衣服（13）、头饰/饰品（14），只有这 3 格的装备算加成（EXE 0x408803 只循环 3 格）；其余 4 格是随身物品 */
export const EQUIP_SLOTS = 3;
export const SLOT_COUNT = 7;
export function equipSlotOf(it: Item | undefined): number {
  if (!it) return -1;
  return it.type <= 12 ? 0 : it.type === 13 ? 1 : it.type === 14 ? 2 : -1;
}
/** 职业能不能装备这件道具：武器只能用职业的武器类型，或该职业默认武器的类型（阮小五武器类型 6 却默认带朴刀 3）【待核】 */
export function canEquip(cls: ClassDef, it: Item | undefined, data: GameData): boolean {
  const k = equipSlotOf(it);
  if (k < 0) return false;
  if (k > 0) return true;
  const own = itemOf(data, cls.defaultItems[0]);
  return it!.type === cls.weaponType || (!!own && own.type === it!.type);
}
/**
 * 打铁 n 次后的攻防（EXE 0x418373：每次花买价的一半，攻击、防御中还有剩余次数的各加一次 +80 / +88，
 * 实例的剩余次数 −1；实例在单位 +0xa6 起每格 10 字节 {id, 攻, 攻剩余, 防, 防剩余}，0x4093f0 装入时取道具表初值）
 */
export function forgedStats(it: Item, n: number) {
  return {
    attack: it.attack + it.attackStep * Math.min(n, it.attackSteps),
    defense: it.defense + it.defenseStep * Math.min(n, it.defenseSteps),
  };
}
export const forgeLimit = (it: Item) => Math.max(it.attackSteps, it.defenseSteps);

/** 装备的移动力加成：原版有不少装备扣移动（负值），重制版一律不扣，加移动的照原版【新：负责人 2026-11-12 决定】 */
export const equipMoveBonus = (it: Item) => Math.max(0, it.moveBonus);

/** 回复类消耗品 */
export const isHealing = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 17;

/** 普通攻击：职业技能表的第一项（全部 72 个职业的第一项都是 1 级、零消耗的普通/远程攻击） */
export function basicAttack(c: ClassDef): SkillDef | undefined {
  return c.skills[0];
}

/** 战斗中能"使用"的道具：类型 15–22（回复、解毒解昏、抗毒抗昏、增益）。原版 0x408dc0 收 15–24，23 财宝用了没有效果、24 祕笈暂未实现 */
export const isUsable = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 22;

export type BuffStat = 'attack' | 'defense' | 'hit' | 'agility' | 'crit' | 'move' | 'poison' | 'stun' | 'resistPoison' | 'resistStun';
/** 限时效果：value 加到对应属性上，持续 turns 回合（每回合开始 −1，到 0 消失） */
export interface Buff {
  stat: BuffStat;
  value: number;
  turns: number;
}

/**
 * 消耗品的限时效果（EXE 0x408dc0：每项都是 {加值, 回合}，回合不为 0 才生效）。
 * 偏移见 binary-formats §9；params[k] = +86 + 2k。
 * 攻击附带中毒/昏迷（金蠶蠱毒粉、悲酥涼風粉）按说明做成攻击带毒/昏的增益【新】：
 * 原版 0x4091b1 把 +130 交给 0x404a70（让目标自己中毒），+134/+136 不读，看起来是原版的错。
 */
export function itemBuffs(it: Item): Buff[] {
  if (it.type < 15) return [];
  const p = it.params ?? [];
  const list: Buff[] = [
    { stat: 'attack', value: it.attack, turns: it.attackTurns },
    { stat: 'defense', value: it.defense, turns: p[0] },
    { stat: 'hit', value: it.hit, turns: p[4] },
    { stat: 'agility', value: it.agility, turns: p[6] },
    { stat: 'crit', value: it.crit, turns: p[8] },
    { stat: 'move', value: it.moveBonus, turns: p[10] },
    { stat: 'resistPoison', value: 0, turns: p[18] },
    { stat: 'resistStun', value: 0, turns: p[19] },
    { stat: 'poison', value: p[23], turns: p[22] },
    { stat: 'stun', value: p[25], turns: p[24] },
  ];
  return list.filter((b) => (b.turns ?? 0) > 0 && (b.value !== 0 || b.stat.startsWith('resist')));
}

const STAT_NAME: Record<BuffStat, string> = {
  attack: '攻击', defense: '防御', hit: '命中', agility: '敏捷', crit: '必杀', move: '移动', poison: '攻击带毒', stun: '攻击致昏', resistPoison: '抗毒', resistStun: '抗昏',
};
export const buffName = (s: BuffStat) => STAT_NAME[s];

/** 道具效果的简短说明（简体）：装备列攻防等加成（含打铁 n 次），消耗品列效果 */
export function itemSummary(it: Item, n = 0): string {
  const p: string[] = [];
  if (equipSlotOf(it) >= 0) {
    const f = forgedStats(it, n);
    if (f.attack) p.push(`攻${f.attack}`);
    if (f.defense) p.push(`防${f.defense}`);
    for (const [k, l] of [['hit', '命'], ['agility', '敏'], ['crit', '必'], ['range', '射程'], ['maxHp', '体'], ['maxMp', '气']] as const)
      if (it[k]) p.push(`${l}${it[k] > 0 ? '+' : ''}${it[k]}`);
    if (equipMoveBonus(it)) p.push(`移+${equipMoveBonus(it)}`);
    if (it.regenHp) p.push(`每回合回体${it.regenHp}`);
    if (it.regenMp) p.push(`每回合回气${it.regenMp}`);
    if (it.poison) p.push(`攻击带毒${it.poison}%`);
    if (it.stun) p.push(`攻击致昏${it.stun}%`);
    return p.join(' ');
  }
  if (it.healHp) p.push(it.healHp < 0 ? '体力全满' : `回体${it.healHp}`);
  if (it.healMp) p.push(it.healMp < 0 ? '气力全满' : `回气${it.healMp}`);
  if (it.curePoison || it.type === 18) p.push('解毒');
  if (it.cureStun || it.type === 19) p.push('解昏迷');
  for (const b of itemBuffs(it)) {
    const pct = b.stat === 'poison' || b.stat === 'stun' ? '%' : '';
    p.push(`${b.turns}回合${buffName(b.stat)}${b.value ? `+${b.value}${pct}` : ''}`);
  }
  if (it.type === 23) p.push('可典当');
  return p.join(' ');
}
