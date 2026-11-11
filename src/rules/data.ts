// 规则引擎使用的数据：由原版解析结果整理而来，不依赖 Phaser。
import type { ClassRecord, ClassSkill } from '../formats/hum.ts';
import type { Item } from '../formats/goo.ts';

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
/** 回复类消耗品 */
export const isHealing = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 17;

/** 普通攻击：职业技能表的第一项（全部 72 个职业的第一项都是 1 级、零消耗的普通/远程攻击） */
export function basicAttack(c: ClassDef): SkillDef | undefined {
  return c.skills[0];
}
