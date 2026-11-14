// 扩展包的 JSON 格式（docs/game-design.md §15.2）。包放在仓库 packs/<包名>/，内容用字符串 id，
// 载入时（src/packs/build.ts）接到原版编号后面。原版素材一律按编号引用，不复制。

import type { RecolorGroup } from './recolor.ts';

export type StatBlock = { hp: number; mp: number; attack: number; defense: number; hit: number; agility: number; crit: number };

export interface PackJson {
  id: string;
  name: string;
  description?: string;
  /**
   * 在游戏流程里的位置：standalone = 外传，从标题「选关」单独进入，等级固定，不碰主线存档；
   * mainline = 主线插关（docs/game-design.md §15.8），每个关卡用 before 写插在哪一关前面
   */
  entry: 'standalone' | 'mainline';
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
  /**
   * 个别动作改借别的原版职业（混搭）：键是 walk / hurt / defend，或技能 anim 的数字（0 = 第一个出手动作）。
   * 宋江原版只有走路：走路用自己的，受击、防御、出手借王伦、公孙胜（docs/game-design.md §15.2）。
   */
  parts?: Record<string, BorrowPart>;
  /** parts 用的换色方案，按名字引用 */
  recolors?: Record<string, RecolorGroup[]>;
  /** walk = 待机姿势用走路第 1 帧（出手动作是别人的身体时，站着仍是自己的样子） */
  idle?: 'walk';
  /** parts 里写了 shoes 的动作，把脚染成这个色阶（如红鞋 36–46），按形状找脚，见 recolor.ts paintShoes */
  shoes?: { dst: [number, number]; k?: number };
}

export interface BorrowPart {
  fromClass: number;
  /** 被借职业的 Man.lib 动作号：0 走路、1 受击、2 防御，3 起出手 */
  action: number;
  /** 换色：recolors 里的名字，或直接写换色组 */
  recolor?: string | RecolorGroup[];
  shoes?: boolean;
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
  /** 主线插关：要进这一关（原版地图名，如 N-add06）时先打本关（只用于 entry = mainline 的包） */
  before?: string;
  /**
   * 主线插关的视角关：切到还没入伙的人，等级用关卡里写的固定值，打完不写回主线人物和银子。
   * 不写（主线人物关）时我方单位按职业号套用主线进度（等级、经验、装备），打完写回
   */
  pov?: boolean;
  /** 过关奖励：银子（代替原版关卡的过关奖励表，视角关不给） */
  rewards?: { gold?: number };
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
  /** 进入区域；写数组时这几个人都到了区域里才触发 */
  | { enter: string | string[]; area: [number, number, number, number] }
  /** 任一在场的我方单位走到这个人身边（相邻一格） */
  | { near: string }
  /** 出手之后：用过全部 skills，或累计出手 count 次 */
  | { used: string; skills?: string[]; count?: number };

/**
 * 指令（数组，第一项是名字）：
 * ["narrate", 文字] 旁白；["say", 单位, 文字] 对白；["appear", 单位] 登场；["leave", 单位] 退场（之后 appear / say 点名时再登场）；["move", 单位, x, y] 走过去；
 * ["objective", 文字] 胜负条件；["turnLimit", n]；["victory", 文字] 过关；["defeat", 文字] 失败；
 * ["setEquip", 单位, 格号, 道具（0 = 卸掉）]；["transform", 单位, 职业, 新名字（可省）] 换成另一个职业（样子、属性、头像都换，血气回满）；["buff", 单位, 属性, {"pct"|"add", "turns"}]；["sound", 原版音效名]；["flag", 名字] 设剧本标志（配合区块的 if / unless）；
 * ["bind", 单位] 绑住（不能行动，直到 cleanse）；["cleanse", 单位] 解开绑缚、昏迷、中毒和减益，本回合马上能行动
 */
export type PackOpJson = [string, ...unknown[]];

export interface PackBlockJson {
  on: PackTrigger;
  /** 只对 enemiesDefeated 有效：还要求某个剧本标志（["flag", 名字] 设上）已经设上 / 还没设上 */
  if?: string;
  unless?: string;
  do: PackOpJson[];
}
