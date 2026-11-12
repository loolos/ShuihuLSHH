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

/** 回复类消耗品 */
export const isHealing = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 17;

/** 普通攻击：职业技能表的第一项（全部 72 个职业的第一项都是 1 级、零消耗的普通/远程攻击） */
export function basicAttack(c: ClassDef): SkillDef | undefined {
  return c.skills[0];
}
