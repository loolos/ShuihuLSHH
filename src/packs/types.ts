// 扩展包的 JSON 格式（docs/game-design.md §15.2）。包放在仓库 packs/<包名>/，内容用字符串 id，
// 载入时（src/packs/build.ts）接到原版编号后面。原版素材一律按编号引用，不复制。

import type { RecolorGroup } from './recolor.ts';

export type StatBlock = { hp: number; mp: number; attack: number; defense: number; hit: number; agility: number; crit: number };

export interface PackJson {
  id: string;
  name: string;
  description?: string;
  /** 在游戏流程里的位置：standalone = 外传，从标题「选关」单独进入，等级固定，不碰主线存档 */
  entry: 'standalone';
  /** 素材来源与署名（CC-BY 的必须写） */
  credits?: string[];
  classes: PackClassJson[];
  items?: PackItemJson[];
  /** 关卡文件（相对包目录，如 stages/jingyanggang.json） */
  stages: string[];
}

export interface PackClassJson {
  id: string;
  name: string;
  /** 1 级时的属性；之后按 §5 的成长公式（growth.ts）涨 */
  base: StatBlock;
  move: number;
  /** 武器类型（同原版职业表，1 = 棍） */
  weaponType?: number;
  /** 默认装备与随身物品：原版道具号，或本包道具的字符串 id */
  items?: (number | string)[];
  /** 第一项是普通攻击 */
  skills: PackSkillJson[];
  /** 形象：包里的精灵图条（SheetSprite），或者借原版职业的动画并换色（BorrowSprite） */
  sprite: SheetSprite | BorrowSprite;
  /** 对话头像：借原版 Head.lib 第几张，或者包里自己的图（相对包目录，宽 140、透明底，tools/make-portrait.py 生成）；null = 不显示 */
  face?: { fromHead: number } | { file: string } | null;
}

/** 精灵图条目录（相对包目录，含 sprites.json），和动作对应 */
export interface SheetSprite {
  sheet: string;
  /** 待机、走路、受击、防御用哪个动作（sprites.json 里的名字） */
  idle: string;
  walk: string;
  hurt: string;
  defend: string;
  /** 头顶状态条的高度（像素，脚下往上），不填用普通身材 */
  head?: number;
}

/**
 * 借原版职业（Man.lib）的全部动作，按调色板换色（src/packs/recolor.ts）。
 * 技能的 anim 写原版职业第几个出手动作（0 = 动作 3，通常是普通攻击），命中帧沿用 from 技能的原版数据。
 */
export interface BorrowSprite {
  fromClass: number;
  recolor?: RecolorGroup[];
  head?: number;
}

export interface PackSkillJson {
  /** 本包内的字符串 id，剧本里用它指技能 */
  id: string;
  name: string;
  /** 借哪个原版技能（技能号）的类型、范围、特效和声音；下面的字段覆盖它 */
  from: number;
  /** 出手动画：sprites.json 里的名字；借原版动画的职业写原版第几个出手动作（0 起） */
  anim: string | number;
  /** 在出手动画的什么位置命中（0–1，一段一个数）；借原版动画的职业不用写 */
  hitAt?: number[];
  power?: number;
  mpCost?: number;
  learnLevel?: number;
  rangeMin?: number;
  rangeMax?: number;
  area?: number;
  stun?: number;
  poison?: number;
  hitMod?: number;
  critMod?: number;
}

export interface PackItemJson {
  id: string;
  name: string;
  /** 借哪个原版道具（道具号）的全部字段（图标、类型等）；下面的字段覆盖它 */
  from: number;
  description?: string;
  attack?: number;
  defense?: number;
  agility?: number;
}

/** 剧本里指单位用关卡 units 的 id */
export interface PackStageJson {
  id: string;
  title: string;
  /** 地图：借原版地图（地表、地上物、通行都照原版） */
  map: { base: string };
  /** 背景音乐（music.ts 的曲目名） */
  bgm?: string;
  units: PackUnitJson[];
  script: PackBlockJson[];
  /** AI 优先轮着用的技能：单位 id → 技能 id（老虎的三招） */
  aiPrefer?: Record<string, string[]>;
}

export interface PackUnitJson {
  id: string;
  /** 本包职业的字符串 id，或原版职业号 */
  class: string | number;
  side: 'player' | 'ally' | 'enemy';
  x: number;
  y: number;
  /** 0 背向右上、1 背向左上、2 面向左下、3 面向右下（同原版） */
  facing?: number;
  level: number;
  /** 开局不在场，剧本点名（appear / say）时登场 */
  hidden?: boolean;
  /** AI 模式（§8），默认 0 */
  ai?: number;
  /** 显示的名字，不填用职业名 */
  name?: string;
  /** 装备与物品，覆盖职业默认（7 格：武器、衣服、头饰、物品×4） */
  items?: (number | string)[];
}

export type PackTrigger =
  | 'start'
  /** 在场的敌人全部倒下（还没登场的隐藏单位不算，要等他们登场后也倒下） */
  | 'enemiesDefeated'
  | { turn: number }
  | { dead: string }
  | { enter: string; area: [number, number, number, number] }
  /** 出手之后：用过全部 skills，或累计出手 count 次 */
  | { used: string; skills?: string[]; count?: number };

/**
 * 指令（数组，第一项是名字）：
 * ["narrate", 文字] 旁白；["say", 单位, 文字] 对白；["appear", 单位] 登场；["move", 单位, x, y] 走过去；
 * ["objective", 文字] 胜负条件；["turnLimit", n]；["victory", 文字] 过关；["defeat", 文字] 失败；
 * ["setEquip", 单位, 格号, 道具（0 = 卸掉）]；["transform", 单位, 职业, 新名字（可省）] 换成另一个职业（样子、属性、头像都换，血气回满）；["buff", 单位, 属性, {"pct"|"add", "turns"}]；["sound", 原版音效名]
 */
export type PackOpJson = [string, ...unknown[]];

export interface PackBlockJson {
  on: PackTrigger;
  do: PackOpJson[];
}
