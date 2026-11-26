import { balanceHeroAoe } from './aoe-balance.ts';
// 规则引擎使用的数据：由原版解析结果整理而来，不依赖 Phaser。
import { heroSkillTiers, lateHeroSkills, type AreaOffset } from './late-hero-skills.ts';
import type { ClassRecord, ClassSkill, SkillHit } from '../formats/hum.ts';
import type { Item } from '../formats/goo.ts';
import type { ExePrompt } from '../formats/exe.ts';
import { GRUNT_CLASSES, OFFICER_CLASSES, statAt, tierGear } from './growth.ts';

/** 技能命中特效名（§6.4.1） */
export type HitFx = 'blood' | 'explosion' | 'impact' | 'fire' | 'pillar' | 'gold' | 'frost' | 'stars' | 'shock';

export interface SkillDef extends ClassSkill {
  name: string;
  /** 自有后期技能：落点相对坐标 [横向, 前向]，随方向旋转；可含空心范围。 */
  areaPattern?: readonly AreaOffset[];
  /** 自有技能特效染色；复用原版特效组，不影响结算。 */
  fxTint?: number;
  /** 出手音效用的技能号（s<号>.mp3）；扩展包技能借原版技能的声音，不填就用 skillId */
  soundId?: number;
  /** 指定技能可在曼哈顿距离内选点（diamond），或沿八个方向（含斜向）直线选点（eight，线形范围随之斜着走）；默认保持原版四向直线。 */
  targetShape?: 'diamond' | 'eight';
  /** 集气技可指定一名同阵营队友为目标；不含施放者本人。 */
  chargeTarget?: 'ally';
  /** 蒙汗药酒【新】（杯酒救铁牛）：不伤人、必定喝下，敌人麻翻这么多回合；单位的 drink 设定可以推辞或改回合数 */
  drug?: number;
  /** 劝酒类技能命中后飘的字（默认「麻翻了！」）【新】：乐和吹铁叫子 = 「听得入神」 */
  drugText?: string;
  /** 暗中才能用【新】：有伪装的关卡里，施放者被识破 / 去掉伪装后就不能用（乐和铁叫子） */
  covert?: boolean;
  /** 打昏（stun）固定几回合【新】：不填按原规则 2–4 回合随机；1 = 只误掉对方接下来的一次行动（解珍 钢叉叉虎） */
  stunFor?: number;
  /** 打昏迷（含被麻翻）的目标伤害倍数【新】（解宝 乘势刺 ×2） */
  vsStunned?: number;
  /** 远程技能的距离伤害系数：[最近、最远]；未指定用通用50%→10%。 */
  rangedDamage?: [number, number];
  /** 一次施放连续重复出手动作的次数；默认1，命中帧按完整动作周期配置。 */
  castCycles?: number;
  /** 长方形范围以选中格为第一排中心；不填仍从施放者身前开始。 */
  areaOrigin?: 'target';
  /** 出手动作与命中帧的播放倍率，默认1；不改变规则伤害。 */
  castSpeed?: number;
  /** 命中时在受击者身上加的简单画面效果【新】：blood = 溅血（玉环鸳鸯脚）、explosion = 爆炸（狂澜裂岳，Effect.lib 第 40 组）；
   * 其余见 src/game/effects.ts HIT_FX（pillar 蓝色光柱、gold 金色佛光、frost 寒光、stars 打昏冒星、shock 震劲）；只是画面 */
  hitFx?: HitFx;
  /** 遠程技飞行中的箭加画面效果【新】：fire = 火箭（箭头染成橙红、拖一串火苗，命中处冒一小团火；花荣 穿云贯日，负责人 2026-11-16）；只是画面 */
  arrowFx?: 'fire';
  /** 穿透【新】（遠程技，花荣 穿云贯日，负责人 2026-11-16）：施放点只定方向，从施放者身前一格起整条直线都受击，长 max(area, 到施放点的距离)；箭一路飞到线尾，不停在第一个目标 */
  pierce?: boolean;
  /** 固定伤害系数（取代远程距离系数）：敌兵远射技伤害 = 正常公式 × 此值（§6.6） */
  damageScale?: number;
  /** 最远打到第几格（含线形范围的延伸），装备射程加上去也不超过（杂兵「遠程攻擊」为 3，§6.6） */
  reachCap?: number;
  /** 敌兵远射技（§6.6）：AI 只在能打到 2 人以上、或没有别的攻击可用时才放；不计入迎击警戒半径 */
  volley?: boolean;
  /** 施放后给施放者自己加的限时增益【新】（负责人 2026-11-26，§6.5.3）：固定点数、只加不减；同一项再放只刷新回合、取大值。
   * 集气技（类型 8）把 power 设为 0 就成了「架势技」：花气、不回气、只加增益 */
  selfBuffs?: Buff[];
  /** 架势技可以给自己或相邻一格的队友用（增益加在目标身上）【新】（负责人 2026-11-26：宋江 呼保义、戴宗 神行法） */
  buffAlly?: boolean;
  /** 回复技附加持续回体【新】（负责人 2026-11-26：吴用 如鱼得水）：每个受回复的人之后 turns 回合每回合回最大体力的 1/divisor */
  healRegen?: { divisor: number; turns: number };
  /** 回复技顺带解掉受回复者的中毒和昏迷【新】（负责人 2026-11-26：如魚得水、回復計） */
  cure?: boolean;
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

/**
 * 个别职业的移动力调整（职业号 → 加几格），在职业表原值上加【新】。
 * 0 武龍：原版 5，负责人 2026-11-12 要求 +1。
 * 2 公孫勝、10 吳用、16 魯智深：原版 4，负责人 2026-11-13 要求改为 5（和其他好汉一样）。
 * 只改好汉职业；敌方版公孫勝（46）、吳用（53）照原值。
 */
export const CLASS_MOVE_BONUS: Record<number, number> = { 0: 1, 2: 1, 10: 1, 16: 1 };

/**
 * 个别职业普通攻击的分段调整（职业号 → 新的分段）【新】。
 * 0 武龍「一鳴驚人」：原版第 9 帧一段 100%，负责人 2026-11-13 要求改成两段 50% + 50%，
 * 在同一帧同时结算（两段各自判定命中和必杀，一起弹出两个数字）。总伤害不变。
 * 16 魯智深「三世因果」：原版第 16 帧一段 100%，负责人 2026-11-14 要求改成三段，
 * 取出手动画里禅杖横扫（第 5 帧）、回扫（第 10 帧）、下砸（第 16 帧，原版命中帧）三下，30% / 30% / 40%（同原版三段技的比例）。
 */
export const BASIC_ATTACK_HITS: Record<number, SkillHit[]> = {
  0: [
    { frame: 9, percent: 50, dir: 0 },
    { frame: 9, percent: 50, dir: 0 },
  ],
  16: [
    { frame: 5, percent: 30, dir: 0 },
    { frame: 10, percent: 30, dir: 0 },
    { frame: 16, percent: 40, dir: 0 },
  ],
};

/**
 * 个别技能的数值调整（技能号 → 字段），在职业表原值上覆盖【新】。技能数值不必照原版（负责人 2026-11-12）。
 * 33–35 龍爭虎鬥LV1–3（史進 2/13/25 级）：负责人 2026-11-13 反映"比普通攻击还弱"，要求改强一点。
 * 原版 LV1 威力 10，只比普通攻击 龍虎相搏（威力 5）高 5，比例公式下期望伤害只多约 8%；
 * LV2（60 气）还不如 3 级的 神龍擺尾（30 气）。气力消耗不变。
 */
type SkillOverride = Partial<Pick<SkillDef, 'power' | 'mpCost' | 'hitMod' | 'critMod' | 'hits' | 'stun' | 'rangeMax' | 'area' | 'rangedDamage' | 'hitFx'>>;
export const SKILL_OVERRIDES: Record<number, SkillOverride> = {
  33: { power: 25, critMod: 15 }, // 原版 10 / 10
  34: { power: 45, critMod: 20 }, // 原版 30 / 15
  35: { power: 65, critMod: 25 }, // 原版 50 / 20
  // 8 隔山打虎（武龍 2 级）：数值照原版，原版两段 50/50（第 12、15 帧），负责人 2026-11-13 要求改成 4 段，
  // 取出手动画里出拳、俯冲、空中、落地踢 4 个击打帧，各 25%（每段单独判定命中和必杀）
  8: { hits: [8, 11, 13, 15].map((frame) => ({ frame, percent: 25, dir: 0 })) },
  // 42–44 狂龍出海LV1–3（史進隐藏技）：原版 4 条分段是四个方向（与神龍擺尾同一出手动作，dir 1/2/3/0），
  // 结算只取第一个方向 → 实际一段 100%。负责人 2026-11-13 要求改成真正的 4 段，各 25%，帧号照原版 11/12/13/15
  // 威力 45/55/75 → 60/70/90（负责人 2026-11-13 要求适当提高；命中修正 −10/−15/−20 偏低、又要分 4 段各自判定）
  ...Object.fromEntries([[42, 60], [43, 70], [44, 90]].map(([id, power]) => [id, { power, hits: [11, 12, 13, 15].map((frame) => ({ frame, percent: 25, dir: 0 })) }])),
  // 普通攻击调整（负责人 2026-11-13）：吳用、朱武的普攻带昏迷，几率同杂兵的 連續技（技能 224，昏迷 10）；
  // 楊春、陳達的普攻射程 1–2（原版 1–1），装备射程照常再加
  86: { stun: 10 }, // 吳用 暗度陳倉，原版 0
  54: { stun: 10 }, // 朱武 神機妙算，原版 0
  128: { rangeMax: 2 }, // 楊春 撥草尋蛇
  113: { rangeMax: 2 }, // 陳達 餓虎出柵
  // 朱武 詭計多端（7 级连续技）：昏迷原版 5，负责人 2026-11-13 改 30；2026-11-14 威力 20 → 60，原版三段 60/20/20 改成 4 段各 25%（第 10、14、18、21 帧）
  56: { stun: 30, power: 60, hits: [10, 14, 18, 21].map((frame) => ({ frame, percent: 25, dir: 0 })) },
  // 137 佛法無邊（魯智深 17 级，以自身为中心的范围技）：原版第 13 帧一段 100%，负责人 2026-11-14 要求改成三段：
  // 禅杖顿地（第 13 帧，原版命中帧）之后蹲身按杖的第 16、19 帧再各震一下，30% / 30% / 40%；每段放一轮特效
  137: { hits: [{ frame: 13, percent: 30, dir: 0 }, { frame: 16, percent: 30, dir: 0 }, { frame: 19, percent: 40, dir: 0 }] },
  // 96 懷璧其罪（林沖 9 级）：负责人 2026-11-14 要求射程 1–2、分三级（LV2、LV3 见 CLASS_EXTRA_SKILLS）、两段同一帧同时结算（各 50%，各自判定命中和必杀）
  96: { rangeMax: 2, hits: [{ frame: 11, percent: 50, dir: 0 }, { frame: 11, percent: 50, dir: 0 }] },
};

const hitsAt = (frames: number[], percents: number[]) => frames.map((frame, i) => ({ frame, percent: percents[i], dir: 0 }));

/**
 * 耗气审阅后的调整（技能号 → 字段），只用于好汉职业（职业号 < 18）；敌方版好汉照原版【新】（负责人 2026-11-14）。
 * 在 SKILL_OVERRIDES 之后、noHeroHitPenalty 之前合并；正命中修正独立计算，未覆盖的负命中仍按好汉规则折算威力。
 * 依据：按期望伤害折成"几次普通攻击"，回气一回合回半条气，单体技原来要 50–100% 气条却只有 1.5–2.2 次普攻。
 */
export const HERO_SKILL_OVERRIDES: Record<number, SkillOverride> = {
  // 单体技能本轮调整：保留原范围与解锁，仅好汉职业生效。
  56: { hitMod: 30, mpCost: 40 }, // 朱武 诡计多端
  // 命中特效【新】（负责人 2026-11-25：加点蓝色光柱、原版特效换色组合，不要太花哨；src/game/effects.ts HIT_FX）
  1315: { hitFx: 'pillar' }, // 一夫當關LV2
  106: { power: 60, hits: hitsAt([6, 8, 12, 15, 18], [20, 20, 20, 20, 20]) }, // 晁盖 天王举鼎式：五段
  7: { power: 100, mpCost: 80, hitFx: 'pillar' }, // 武龙 一夫当关；命中特效：最后一段升起蓝色光柱
  20: { mpCost: 40, hits: hitsAt([11, 16, 21], [30, 30, 40]) }, // 公孙胜 神妙御剑心法
  33: { hitMod: 10 },
  65: { hits: hitsAt([12, 23], [40, 60]) }, // 冲太岁LV1，两段
  86: { critMod: 10 }, // 吳用普攻「暗度陳倉」必杀修正 +20 → +10；敌方版吴用保留原值。
  // 公孫勝 回心咒：原版只回自己 1/3 体力（100 / 200 气）→ 以自己为中心的范围回复，耗气不变
  26: { area: 3, power: 2 }, // LV1：菱形半径 2（13 格），回 1/2
  27: { area: 4, power: 1 }, // LV2：菱形半径 3（25 格），回满
  // 白勝 監守自盜LV1–3：仅此三阶沿用花荣100%→60%的距离缩放；耗气统一30，命中+10/+20/+30，1/2/3段，原威力不变。
  48: { mpCost: 30, power: 40, hitMod: 10, rangedDamage: [1, 0.6], hits: hitsAt([20], [100]) },
  49: { mpCost: 30, power: 50, hitMod: 20, rangedDamage: [1, 0.6], hits: hitsAt([12, 20], [40, 60]) },
  50: { mpCost: 30, power: 60, hitMod: 30, rangedDamage: [1, 0.6], hits: hitsAt([6, 13, 20], [30, 30, 40]) },
  47: { mpCost: 15 }, // 白勝 窮鼠噬貓 50 → 15（原版已是三段 20/20/60%）
  // 陳達 黑虎偷心：威力 +20（原版 30、命中 −10 → 实际 20 → 40），耗气 20 不变；
  // 两段：跃起挥枪（第 12 帧）40% + 落地突刺（第 23 帧，原版命中帧）60%
  115: { power: 40, hitMod: 0, hits: hitsAt([12, 23], [40, 60]) },
  116: { mpCost: 15 }, // 陳達 虎嘯山林LV1（单格）60 → 15
  // 阮小七 生不如死（24 级，射程 1–2）：原版第 18 帧一段 100%（撑槳腾空），负责人 2026-11-14 要求改成三段：
  // 撑槳腾空（第 18 帧，原版命中帧）、空中挥槳横扫（第 25 帧）、落下飞踢（第 28 帧），30% / 30% / 40%；威力、耗气不变
  81: { hits: hitsAt([18, 25, 28], [30, 30, 40]) },
  91: { stun: 40 }, // 吳用 星羅棋布LV1：加昏迷 40%，耗气不变
  40: { mpCost: 65, power: 100, hits: hitsAt([4, 6, 8, 10, 12, 15], [15, 15, 15, 15, 20, 20]) }, // 史进 龙腾九天：威力100，六段，耗气65
  // 史進 龍爭虎鬥LV2 / LV3：耗气 60 → 35、130 → 55；出手动作是翻身飞踢（第 18 帧落地）
  34: { mpCost: 35, hitMod: 20, hits: hitsAt([12, 18], [40, 60]) }, // 两段：空中翻身 + 落地
  35: { mpCost: 55, hitMod: 30, hits: hitsAt([9, 13, 18], [30, 30, 40]) }, // 三段：扑出、空中翻身、落地
  138: { mpCost: 70, power: 80, hitMod: 30, hitFx: 'gold' }, // 鲁智深 佛光普照：威力80、命中+30，耗气70；命中特效金色佛光
  136: { mpCost: 40 }, // 魯智深 殺身成佛 60 → 40
  123: { mpCost: 80, power: 100, hits: hitsAt([6, 12, 20, 27], [25, 25, 25, 25]) }, // 杨志 千刀万剮：威力100，四段，耗气80
  122: { mpCost: 45 }, // 楊志 快刀斬亂麻 100 → 45
  99: { mpCost: 55, power: 100, rangeMax: 2 }, // 林冲 策马入林：威力100，耗气55；射程 1–2（负责人 2026-11-22，原 1–1）
  98: { mpCost: 35, rangeMax: 2 }, // 林沖 義憤填膺 80 → 35；射程 1–2（负责人 2026-11-22，原 1–1）
  66: { mpCost: 35, hits: hitsAt([10, 16, 23], [30, 30, 40]) }, // 阮小二 沖太歲LV2 70 → 35
  67: { mpCost: 40, hits: hitsAt([6, 12, 18, 23], [25, 25, 25, 25]) }, // 阮小二 沖太歲LV3 110 → 40
  69: { mpCost: 30 }, // 阮小二 天羅地網LV1（单格）70 → 30
  74: { mpCost: 40 }, // 阮小五 绝地逢生：耗气40
  146: { mpCost: 40 }, // 刘唐 百鬼夜行：耗气40
  // 朱武 奇門遁甲LV1–3（扇形 8 / 13 / 18 格）范围大、耗气少：40 / 55 / 70 → 90 / 105 / 135
  60: { mpCost: 90 },
  61: { mpCost: 105 },
  62: { mpCost: 135 },
};

/**
 * 集气技（类型 8）一律回复最大气力的 1/2【新】（负责人 2026-11-14）。威力字段是回复除数，
 * 原版所有集气技都是 3（回 1/3），包括敌方职业；不改原版数据，载入时覆盖。
 */
export const CHARGE_DIVISOR = 2;
const withChargeDivisor = <T extends Pick<SkillDef, 'type' | 'power'>>(s: T): T => (s.type === 8 ? { ...s, power: CHARGE_DIVISOR } : s);

/**
 * 好汉（职业号 < 18）的技能一律不扣命中：负的命中修正改成 0，威力下降等额，最低 1【新】（负责人 2026-11-13）。
 * 如 魯智深 佛光普照 命中 −20 / 威力 70 → 命中 0 / 威力 50。敌方职业（含敌方版好汉，职业号 46 起）不变。
 * 白勝 監守自盜LV3（威 15、命 −15）、通殺LV1–3（威 10、命 −15/−15/−10）减完不足 1，按 1 算。
 */
export const HERO_CLASS_COUNT = 18;

const buff = (stat: BuffStat, value: number, turns: number): Buff => ({ stat, value, turns });
/**
 * 原版好汉技能的自身增益【新】（负责人 2026-11-26，§6.5.3）：职业号 → 技能名 → 增益。只加防御、敏捷、回体（保命用），固定点数。
 * 按名字挂，分级技能各级分开写；敌方版好汉（职业号 46 起）不受影响。
 */
export const HERO_SELF_BUFFS: Record<number, Record<string, Buff[]>> = {
  0: { 一夫當關: [buff('defense', 30, 3)], 一夫當關LV2: [buff('defense', 45, 3)], 百尺竿頭: [buff('agility', 20, 5)] }, // 武龍
  3: { 龍蟠虎踞: [buff('defense', 20, 5)], 龍騰九天: [buff('agility', 35, 2)] }, // 史進
  4: { 窮鼠噬貓: [buff('agility', 25, 2)], 窮鼠噬貓LV2: [buff('agility', 35, 2)] }, // 白勝
  7: { 分水穿浪: [buff('agility', 25, 2)] }, // 阮小二
  8: { 絕地逢生: [buff('defense', 25, 2)], 絕地逢生LV2: [buff('defense', 35, 2)] }, // 阮小五
  9: { 横江拍浪: [buff('agility', 25, 2)] }, // 阮小七
  17: { 魑魅魍魎: [buff('agility', 25, 2)] }, // 劉唐
  5: { 奇門遁甲LV1: [buff('agility', 20, 2)], 奇門遁甲LV2: [buff('agility', 25, 2)], 奇門遁甲LV3: [buff('agility', 35, 2)] }, // 朱武
  11: { 棄暗投明: [buff('regenHp', 12, 5)], 風雪交加: [buff('defense', 20, 2)], 風雪交加LV2: [buff('defense', 40, 2)] }, // 林沖
  10: { 運籌帷幄: [buff('agility', 35, 5)] }, // 吳用
  12: { 天王聚義式: [buff('defense', 30, 5)] }, // 晁蓋
  13: { 伏虎调息: [buff('defense', 20, 5)] }, // 陳達
  14: { 游刃有餘: [buff('agility', 35, 5)], 快刀斬亂麻: [buff('agility', 25, 2)], 快刀斬亂麻LV2: [buff('agility', 45, 2)] }, // 楊志
  15: { 盘蛇吐纳: [buff('regenHp', 12, 5)] }, // 楊春
  16: { 我佛慈悲: [buff('regenHp', 15, 5)], 佛法無邊: [buff('defense', 30, 3)] }, // 魯智深
};

/** 原版好汉回复技附加的持续回体（职业号 → 技能名）【新】（负责人 2026-11-26） */
export const HERO_HEAL_REGEN: Record<number, Record<string, { divisor: number; turns: number }>> = {
  5: { 回復計LV1: { divisor: 10, turns: 3 }, 回復計LV2: { divisor: 10, turns: 3 }, 回復計LV3: { divisor: 10, turns: 3 } }, // 朱武
  10: { 如魚得水LV1: { divisor: 10, turns: 3 }, 如魚得水LV2: { divisor: 10, turns: 3 }, 如魚得水LV3: { divisor: 10, turns: 3 } }, // 吳用
};
/** 可以给相邻一格队友用的集气技（气仍回给自己，增益给所选的人）【新】（负责人 2026-11-26） */
export const HERO_BUFF_ALLY: Record<number, string[]> = {
  10: ['運籌帷幄'], // 吳用
  12: ['天王聚義式'], // 晁蓋
};

function withHeroSelfBuffs(cls: number, s: SkillDef): SkillDef {
  const b = HERO_SELF_BUFFS[cls]?.[s.name];
  const r = HERO_HEAL_REGEN[cls]?.[s.name];
  const ally = HERO_BUFF_ALLY[cls]?.includes(s.name);
  // 如魚得水、回復計：持续回体 + 解毒解昏迷（负责人 2026-11-26）
  return { ...s, ...(b ? { selfBuffs: b.map((x) => ({ ...x })) } : {}), ...(r ? { healRegen: { ...r }, cure: true } : {}), ...(ally ? { buffAlly: true, rangeMin: 0, rangeMax: 1 } : {}) };
}
export function noHeroHitPenalty<T extends Pick<SkillDef, 'power' | 'hitMod'>>(classId: number, s: T): T {
  if (classId >= HERO_CLASS_COUNT || s.hitMod >= 0) return s;
  return { ...s, power: Math.max(1, s.power + s.hitMod), hitMod: 0 };
}

/**
 * 好汉技能不扣命中【新】（负责人 2026-11-22 扩到全部好汉："所有扣命中的改，加命中的不改"）：
 * 职业号 0–17 的全部技能（含后加的分级、后期技、自定技能）和扩展包里标了 `hero` 的职业，负的命中修正最后都改成 0，
 * 威力下降等额，最低 1（同 noHeroHitPenalty）。正的命中修正不变。集气、回复类（类型 8 / 9 / 11）只清修正，不动威力。
 */
export function heroSkillNoHitMod<T extends Pick<SkillDef, 'power' | 'hitMod' | 'type'>>(s: T): T {
  if (s.hitMod >= 0) return s;
  if (s.type === 8 || s.type === 9 || s.type === 11) return { ...s, hitMod: 0 };
  return { ...s, power: Math.max(1, s.power + s.hitMod), hitMod: 0 };
}

/**
 * 技能改名（技能号 → 名字，繁体，LV 后缀照旧）【新】：隐藏技（负责人 2026-11-13 嫌"古武術"重名太多）。
 * 原版朱武、阮氏三雄、吳用的隐藏技都叫"古武術LV1–3"；按人物和招式形状各取一个名字，敌方同职业单位一起改。
 */
export const SKILL_NAME_OVERRIDES: Record<number, string> = { 96: '懷璧其罪LV1', ...Object.fromEntries(
  ([
    [60, '奇門遁甲'], // 朱武（神機軍師），扇形
    [69, '天羅地網'], // 阮小二（立地太歲，打漁），落点菱形
    [76, '翻江倒海'], // 阮小五（短命二郎），扇形
    [83, '怒海狂濤'], // 阮小七（活閻羅），直线
    [91, '星羅棋布'], // 吳用（智多星），落点菱形、两段
  ] as const).flatMap(([id, name]) => [0, 1, 2].map((i) => [id + i, `${name}LV${i + 1}`])),
  ),
  // 杜遷（摸着天）、宋萬（雲裡金剛）的招式改得文雅些（负责人 2026-11-14；原名無法無天、駕鶴歸天、金剛 擊/崩/破…），主线、外传一起改
  201: '摩天掌', 203: '擎天連環', 204: '天柱迴旋', 205: '摘星攬月', 206: '凌雲吐納', 207: '天恩回春',
  208: '金剛拳', 210: '金剛連環', 211: '金剛轉輪', 212: '雲裡雷音', 213: '金剛入定', 214: '雲開見日',
};

/** 新增技能的公共字段；每个技能只写不同的部分 */
const extraSkill = (s: Partial<SkillDef> & Pick<SkillDef, 'name' | 'skillId' | 'type' | 'group' | 'learnLevel' | 'mpCost' | 'power'>): SkillDef => ({
  hidden: false, rangeMin: 1, rangeMax: 1, area: 1, effect: 0, effect2: 0, effect3: 0, poison: 0, stun: 0, hitMod: 0, critMod: 0,
  hits: [{ frame: 1, percent: 100, dir: 0 }], raw: '', ...s,
});
const split = (frames: number[]) => frames.map((frame) => ({ frame, percent: 100 / frames.length, dir: 0 }));

/**
 * 新增技能（职业号 → 技能），不改原版 HUM；1000 起为重制版技能号（负责人 2026-11-14 起的好汉技能扩充，见 game-design §6.5）。
 * 1001–1002 林沖 懷璧其罪 LV2 / LV3（LV1 是原版 96；LV4 是 1009）；1003 林沖 風雪交加（类型 12：以自身为中心的周围 8 格）；
 * 1004 楊春 靈蛇吐信（暗器，类型 10，射程 8）；1005 陳達 虎尾橫掃（类型 13：面前相邻一排横向三格）；1006–1007 吳用 運籌帷幄（回气）/ 調虎離山（单体昏迷）；1008 晁蓋 天王八荒式（周身技，三段）；1009 林沖 懷璧其罪 LV4；
 * 1010–1013 30–40 级补的 LV2（负责人 2026-11-25，§6.5.2）：林沖 風雪交加、晁蓋 天王八荒式、吳用 調虎離山、楊春 靈蛇吐信。
 */
export const CLASS_EXTRA_SKILLS: Record<number, SkillDef[]> = {
  // 朱武：沿用集气技的零耗气、自身回复 1/2 气力（CHARGE_DIVISOR）；group 0 复用本人的回复计出手动作。
  5: [{
    name: '气定神闲', skillId: 1000, type: 8, group: 0, hidden: false,
    learnLevel: 6, mpCost: 0, power: CHARGE_DIVISOR, rangeMin: 0, rangeMax: 0, area: 0,
    effect: 0, effect2: 0, effect3: 0, poison: 0, stun: 0, hitMod: 0, critMod: 0,
    hits: [], raw: '',
  },
  // 神机助气【新】（负责人 2026-11-26）：架势技，自己或相邻一格的队友之后 5 回合每回合回气 20；group 0 同气定神闲
  extraSkill({
    name: '神机助气', skillId: 1014, type: 8, group: 0, learnLevel: 16, mpCost: 40, power: 0, rangeMin: 0, rangeMax: 1, area: 0, hits: [],
    buffAlly: true, selfBuffs: [{ stat: 'regenMp', value: 20, turns: 5 }],
  })],
  11: [
    extraSkill({ name: '懷璧其罪LV2', skillId: 1001, type: 6, group: 1, learnLevel: 18, mpCost: 40, power: 40, rangeMax: 2, hitMod: 5, critMod: 20, soundId: 96, hits: split([11, 11]) }),
    // LV3、LV4（负责人 2026-11-22）：横扫施放点及左右各一格（类型 13）；施放点选身前相邻格就是前方三格（左前、正前、右前），射程仍 1–2。耗气见 HERO_AOE_COSTS
    // 负责人 2026-11-24：LV3、LV4 也能往四个斜向放（targetShape 'eight'），斜放时打施放点和它两边贴着林沖这一侧的两格（三格弧，见 areaCells 类型 13）
    extraSkill({ name: '懷璧其罪LV3', skillId: 1002, type: 13, targetShape: 'eight', group: 1, learnLevel: 24, mpCost: 60, power: 55, rangeMax: 2, hitMod: 5, critMod: 25, soundId: 96, hits: split([11, 11]) }),
    extraSkill({ name: '懷璧其罪LV4', skillId: 1009, type: 13, targetShape: 'eight', group: 1, learnLevel: 30, mpCost: 75, power: 70, rangeMax: 2, hitMod: 10, critMod: 30, soundId: 96, hits: split([11, 11]) }),
    // 借家破人亡的旋身动作（第 2 组，四个击打帧）、第 31 组雪花星光特效（原版没有技能用）
    extraSkill({ name: '風雪交加', skillId: 1003, type: 12, group: 2, learnLevel: 13, mpCost: 50, power: 30, rangeMin: 0, rangeMax: 0, area: 2, hitMod: 10, critMod: 10, stun: 20, effect: 32, soundId: 97, hits: split([9, 11, 12, 13]) }),
    extraSkill({ name: '風雪交加LV2', skillId: 1010, type: 12, group: 2, learnLevel: 36, mpCost: 85, power: 45, rangeMin: 0, rangeMax: 0, area: 2, hitMod: 15, critMod: 10, stun: 30, effect: 32, soundId: 97, hits: split([9, 11, 12, 13]) }),
  ],
  // 吳用（24 级入队）：回气借本人那组一帧的姿势（第 1 组，其它好汉的集气技也是一帧）；单体昏迷借普攻动作（第 0 组），第 28 组蓝色光环特效（原版没有技能用）
  10: [
    extraSkill({ name: '運籌帷幄', skillId: 1006, type: 8, group: 1, learnLevel: 24, mpCost: 0, power: CHARGE_DIVISOR, rangeMin: 0, rangeMax: 0, area: 0, hits: [] }),
    extraSkill({ name: '調虎離山', skillId: 1007, type: 6, group: 0, learnLevel: 24, mpCost: 30, power: 25, rangeMax: 2, hitMod: 10, critMod: 5, stun: 60, effect: 29, soundId: 86, hits: hitsAt([3, 5, 7], [30, 30, 40]) }),
    extraSkill({ name: '調虎離山LV2', skillId: 1012, type: 6, group: 0, learnLevel: 32, mpCost: 35, power: 35, rangeMax: 2, hitMod: 15, critMod: 5, stun: 80, effect: 29, soundId: 86, hits: hitsAt([3, 5, 7], [30, 30, 40]) }),
  ],
  // 晁蓋（24 级左右入队）：回旋技，借天王舉鼎式的旋身腾跃动作（第 1 组，原版三个击打帧 8/12/18），拆三段 30/30/40%；
  // 第 43 组白色打击火花（小、9 帧；负责人 2026-11-15 嫌第 34 组旋风太复杂）；数值按林沖 風雪交加（13 级：威力 30 / 气 50，约攻击 26%、气条 28%）折算到 24 级
  12: [
    extraSkill({ name: '天王八荒式', skillId: 1008, type: 12, group: 1, learnLevel: 22, mpCost: 70, power: 40, rangeMin: 0, rangeMax: 0, area: 2, hitMod: 10, critMod: 10, effect: 44, soundId: 106, hits: hitsAt([8, 12, 18], [30, 30, 40]) }),
    extraSkill({ name: '天王八荒式LV2', skillId: 1011, type: 12, group: 1, learnLevel: 36, mpCost: 85, power: 55, rangeMin: 0, rangeMax: 0, area: 2, hitMod: 15, critMod: 10, effect: 44, soundId: 106, hits: hitsAt([8, 12, 15, 18], [25, 25, 25, 25]) }),
  ],
  // 陳達：借黑虎偷心的动作（第 1 组）、第 19 组弧形扫击特效（原版没有技能用）
  13: [
    extraSkill({ name: '虎尾橫掃', skillId: 1005, type: 13, group: 1, learnLevel: 18, mpCost: 45, power: 35, area: 3, hitMod: 10, critMod: 10, effect: 20, soundId: 115, hits: [{ frame: 23, percent: 100, dir: 0 }] }),
  ],
  // 楊春：借本人普通攻击的动作（第 1 组与第 0 组帧完全相同）、飞刀特效（第 56–59 组，同白勝 監守自盜）
  15: [
    extraSkill({ name: '靈蛇吐信', skillId: 1004, damageScale: 1, type: 10, group: 1, learnLevel: 8, mpCost: 25, power: 20, rangeMax: 8, critMod: 10, poison: 30, effect: 57, soundId: 48, hits: [{ frame: 13, percent: 100, dir: 0 }] }),
    extraSkill({ name: '靈蛇吐信LV2', skillId: 1013, damageScale: 1, type: 10, group: 1, learnLevel: 32, mpCost: 35, power: 35, rangeMax: 8, hitMod: 5, critMod: 10, poison: 40, effect: 57, soundId: 48, hits: [{ frame: 13, percent: 100, dir: 0 }] }),
  ],
};

/**
 * 敌兵远射技【新】（负责人 2026-11-15，game-design §6.6）：中后期敌兵每个兵种一招远射范围技，
 * 必杀低（必杀修正 −10）、伤害低（正常公式 × damageScale，不按距离再打折），但能从 2 格外打到我方。
 * 杂兵 15 级、小头目 13 级学会。出手动作借本职业原有技能（borrow = 职业技能表的序号，取其动作组、最后一个命中帧和音效），
 * 特效用原版没有技能用的 Effect.lib 组（effect = 组号 + 1）。技能号 1100 起。
 */
export const TROOP_GRUNT_LEVEL = 15;
export const TROOP_OFFICER_LEVEL = 13;
interface TroopSkill {
  classes: number[];
  borrow: number;
  skill: Partial<SkillDef> & Pick<SkillDef, 'name' | 'type' | 'mpCost' | 'rangeMin' | 'rangeMax' | 'area' | 'damageScale' | 'effect'>;
}
const DIAMOND = { targetShape: 'diamond' as const };
export const TROOP_SKILLS: TroopSkill[] = [
  // 杂兵（伤害 35%）
  { classes: [19, 20, 40, 41], borrow: 0, skill: { name: '亂石飛投', type: 0, area: 3, rangeMin: 2, rangeMax: 4, mpCost: 25, damageScale: 0.35, effect: 44, ...DIAMOND } }, // 莊客：从落点往前一线 3 格，第 43 组白色火花
  { classes: [22, 23, 44, 45], borrow: 0, skill: { name: '滾木擂石', type: 0, area: 3, rangeMin: 2, rangeMax: 4, mpCost: 25, damageScale: 0.35, effect: 44, ...DIAMOND } }, // 囉嘍：从落点往前一线 3 格
  { classes: [21], borrow: 1, skill: { name: '撒網', type: 3, area: 2, rangeMin: 2, rangeMax: 3, mpCost: 25, damageScale: 0.35, stun: 10, effect: 49, ...DIAMOND } }, // 漁人：十字 5 格，第 48 组蓝环
  { classes: [32, 33], borrow: 0, skill: { name: '擲槍', type: 10, area: 2, rangeMin: 2, rangeMax: 5, mpCost: 25, damageScale: 0.35, effect: 57 } }, // 士兵：直线飞枪，贯穿 2 格（飞刀弹道 56–59）
  { classes: [34], borrow: 0, skill: { name: '火箭齊發', type: 0, area: 3, rangeMin: 3, rangeMax: 7, mpCost: 30, damageScale: 0.35, effect: 42, ...DIAMOND } }, // 弓箭手：从落点往前一线 3 格，第 41 组火焰
  { classes: [36], borrow: 1, skill: { name: '飛鏈鎖拿', type: 0, area: 2, rangeMin: 2, rangeMax: 4, mpCost: 25, damageScale: 0.35, stun: 15, effect: 49, ...DIAMOND } }, // 官吏：一线 2 格
  { classes: [37], borrow: 1, skill: { name: '石灰包', type: 3, area: 2, rangeMin: 2, rangeMax: 3, mpCost: 25, damageScale: 0.35, stun: 15, effect: 32, ...DIAMOND } }, // 家人：十字 5 格，第 31 组白粉星光
  { classes: [67], borrow: 1, skill: { name: '連環飛鏢', type: 10, area: 2, rangeMin: 2, rangeMax: 4, mpCost: 25, damageScale: 0.35, effect: 57 } }, // 徒弟：直线飞镖，贯穿 2 格
  // 小头目（伤害 40%，頭領 30%）
  { classes: [38], borrow: 0, skill: { name: '震地拳風', type: 3, area: 2, rangeMin: 2, rangeMax: 4, mpCost: 35, damageScale: 0.4, effect: 38, ...DIAMOND } }, // 都頭：十字 5 格，第 37 组蓝色冲击
  { classes: [39], borrow: 0, skill: { name: '劈空掌', type: 0, area: 3, rangeMin: 2, rangeMax: 4, mpCost: 35, damageScale: 0.4, effect: 44, ...DIAMOND } }, // 教頭：一线 3 格
  { classes: [42], borrow: 0, skill: { name: '火攻令', type: 3, area: 3, rangeMin: 3, rangeMax: 6, mpCost: 45, damageScale: 0.4, effect: 22, ...DIAMOND } }, // 縣尉：菱形 13 格，第 21 组火旋
  { classes: [43], borrow: 0, skill: { name: '騎射', type: 10, area: 2, rangeMin: 2, rangeMax: 6, mpCost: 35, damageScale: 0.4, effect: 53 } }, // 騎兵：直线箭矢，贯穿 2 格（弓箭弹道 52–55）
  { classes: [65], borrow: 0, skill: { name: '號令投石', type: 3, area: 3, rangeMin: 3, rangeMax: 5, mpCost: 45, damageScale: 0.3, effect: 44, ...DIAMOND } }, // 頭領：菱形 13 格
  { classes: [66], borrow: 0, skill: { name: '毒煙彈', type: 3, area: 2, rangeMin: 2, rangeMax: 5, mpCost: 35, damageScale: 0.4, poison: 25, effect: 35, ...DIAMOND } }, // 刺客：十字 5 格，第 34 组旋风烟
];
/** 有「遠程攻擊」（射程 2）的兵 15 级起射程 +1（负责人 2026-11-15）；技能号 222，同名高等级版本取代原版 */
export const TROOP_REACH_CLASSES = new Set([20, 21, 33, 36, 37, 41, 67]);

/** 远射技耗气 = 学会那一级的最大气（模板气力 + 档次装备加成）向下取整到 10：刚学会时满气能放一次（负责人 2026-11-15） */
export function troopMp(id: number, level: number): number {
  const cls = { id } as ClassDef;
  return Math.floor((statAt(cls, 'mp', level) + (tierGear(cls)?.mp ?? 0)) / 10) * 10;
}

function troopSkills(id: number, own: SkillDef[]): SkillDef[] {
  const tier = GRUNT_CLASSES.has(id) ? TROOP_GRUNT_LEVEL : OFFICER_CLASSES.has(id) ? TROOP_OFFICER_LEVEL : 0;
  if (!tier) return [];
  const out: SkillDef[] = [];
  const reach = TROOP_REACH_CLASSES.has(id) ? own.find((s) => s.skillId === 222 && s.type === 6) : undefined;
  if (reach) out.push({ ...reach, learnLevel: TROOP_GRUNT_LEVEL, rangeMax: reach.rangeMax + 1, hits: reach.hits.map((h) => ({ ...h })) });
  TROOP_SKILLS.forEach((t, i) => {
    if (!t.classes.includes(id)) return;
    const b = own[t.borrow] ?? own[0];
    const last = b?.hits.at(-1)?.frame ?? 1;
    out.push(extraSkill({ skillId: 1100 + i, group: b?.group ?? 0, learnLevel: tier, power: 0, critMod: -10, soundId: b?.soundId ?? b?.skillId, volley: true, hits: [{ frame: last, percent: 100, dir: 0 }], ...t.skill, mpCost: troopMp(id, tier) }));
  });
  return out;
}

/** 杂兵「遠程攻擊」（棍棒、叉等，技能 222 类型 6；不含弓箭手）最远打到第 3 格，装备射程也不超过（负责人 2026-11-15） */
export const TROOP_REACH_CAP = 3;
const capTroopReach = (id: number, s: SkillDef): SkillDef => (GRUNT_CLASSES.has(id) && s.skillId === 222 && s.type === 6 ? { ...s, reachCap: TROOP_REACH_CAP } : s);

/**
 * 隐藏技（原版要古武術祕笈，HUM 技能子项 +5 = 1）改为好汉自带技能，随等级领悟【新】（负责人 2026-11-13）：
 * LV2、LV3 的习得等级照原版；LV1 原版是 1 级，改为 LV2 的习得等级 − 4（不低于 1）。如楊春 靈蛇出洞 LV2 10 级 → LV1 6 级。
 */
export const HIDDEN_LV1_OFFSET = 4;
export function unlockHiddenSkills(skills: SkillDef[]): SkillDef[] {
  const lv2 = new Map<string, number>();
  for (const s of skills) if (s.hidden && /LV\s*2$/i.test(s.name)) lv2.set(s.name.replace(/\s*LV\s*\d+$/i, ''), s.learnLevel);
  return skills.map((s) => {
    if (!s.hidden) return s;
    const base = s.name.replace(/\s*LV\s*\d+$/i, '');
    const two = lv2.get(base);
    const learnLevel = /LV\s*1$/i.test(s.name) && two !== undefined ? Math.max(1, two - HIDDEN_LV1_OFFSET) : s.learnLevel;
    return { ...s, hidden: false, learnLevel };
  });
}

export function buildClasses(records: ClassRecord[], names: string[], skillNames: string[]): ClassDef[] {
  return records.map((r) => {
    const [attack, defense, hit, agility, crit] = r.stats.map((s) => ({ base: s.base, growth: s.growth }));
    const original: SkillDef[] = r.skills.map((s, i) => withChargeDivisor(noHeroHitPenalty(r.id, {
      ...s,
      ...SKILL_OVERRIDES[s.skillId],
      ...(r.id < HERO_CLASS_COUNT ? HERO_SKILL_OVERRIDES[s.skillId] : undefined),
      // 杜迁擎天连环：仅本职业提高为4段和命中+40。
      ...(r.id === 69 && s.skillId === 203 ? { hitMod: 40, hits: hitsAt([4, 7, 10, 14], [25, 25, 25, 25]) } : {}),
      // 模板普攻默认无必杀修正，仅刺客保留最多 +5；特殊技仍封顶 +5，其他职业不受影响。
      ...(GRUNT_CLASSES.has(r.id) || OFFICER_CLASSES.has(r.id) ? { critMod: i === 0 && r.id !== 66 ? 0 : Math.min(5, SKILL_OVERRIDES[s.skillId]?.critMod ?? s.critMod) } : {}),
      // 縣尉同号气功分开命名，避免范围招式被同名直线技覆盖。
      name: r.id === 42 && s.skillId === 226 && s.type === 3
        ? '震地氣功'
        : SKILL_NAME_OVERRIDES[s.skillId] ?? skillNames[s.skillId] ?? `#${s.skillId}`,
      ...(i === 0 && BASIC_ATTACK_HITS[r.id] ? { hits: BASIC_ATTACK_HITS[r.id].map((h) => ({ ...h })) } : {}),
    })));
    const own = heroSkillTiers(r.id, original);
    const all = [...own, ...(CLASS_EXTRA_SKILLS[r.id] ?? [])];
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
      move: r.move + (CLASS_MOVE_BONUS[r.id] ?? 0),
      weaponType: r.weaponType,
      goldCap: r.goldCap,
      defaultItems: r.defaultItems,
      skills: unlockHiddenSkills([
        ...[...own, ...troopSkills(r.id, own)].map((s) => capTroopReach(r.id, s)),
        ...lateHeroSkills(r.id, all),
        ...(CLASS_EXTRA_SKILLS[r.id] ?? []).map((s) => ({ ...s, hits: s.hits.map((h) => ({ ...h })) })),
      ]).map(s => balanceHeroAoe(r.id, s)).map((s) => (r.id < HERO_CLASS_COUNT ? withHeroSelfBuffs(r.id, heroSkillNoHitMod(s)) : s)),
    };
  });
}

export function itemOf(data: GameData, id: number): Item | undefined {
  return id > 0 ? data.items[id - 1] : undefined;
}

/** 道具类型码：0–12 武器、13 衣服、14 头饰，可以提供装备加成 */
export const isEquipment = (it: Item | undefined) => !!it && it.type <= 14;
/**
 * 装备栏：前 3 格是武器（类型 0–12）、衣服（13）、头饰/饰品（14），只有这 3 格的装备算加成（EXE 0x408803 只循环 3 格）。
 * 其余是随身物品：原版 4 格，重制版 10 格【新：负责人 2026-11-12】。
 */
export const EQUIP_SLOTS = 3;
export const BAG_SIZE = 10;
export const SLOT_COUNT = EQUIP_SLOTS + BAG_SIZE;
/** 随身物品栏的格号（第 3 格起） */
export const BAG_SLOTS: readonly number[] = Array.from({ length: BAG_SIZE }, (_, i) => EQUIP_SLOTS + i);
/** 第一个空的随身物品格，没有返回 -1 */
export const freeBagSlot = (slots: readonly number[]) => BAG_SLOTS.find((k) => !slots[k]) ?? -1;
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
/** 已打铁 n 次时，再打一次各加多少，以及之后还能打几次（打到头的那一项加 0） */
export function forgeGain(it: Item, n: number) {
  return {
    attack: n < it.attackSteps ? it.attackStep : 0,
    defense: n < it.defenseSteps ? it.defenseStep : 0,
    left: Math.max(0, forgeLimit(it) - n),
  };
}
/** 打铁增加量的短文字，如「攻+3 防+2」 */
export function forgeGainText(it: Item, n: number) {
  const g = forgeGain(it, n);
  return [g.attack ? `攻+${g.attack}` : '', g.defense ? `防+${g.defense}` : ''].filter(Boolean).join(' ');
}

/** 装备的移动力加成：原版有不少装备扣移动（负值），重制版一律不扣，加移动的照原版【新：负责人 2026-11-12 决定】 */
export const equipMoveBonus = (it: Item) => Math.max(0, it.moveBonus);
/**
 * 装备的命中加成：原版扣命中的装备（槍、叉、鏟、铁甲、铁盔等）重制版只扣原值的 1/4（向零取整），
 * 原扣除不到 4 点的直接当 0；加命中的照原版【新：负责人 2026-11-14 决定】。如 −5 → −1，−12 → −3，−18 → −4。
 */
export const equipHitBonus = (it: Item) => EQUIP_HIT_OVERRIDES[it.id] ?? (it.hit >= 0 ? it.hit : it.hit > -4 ? 0 : -Math.floor(-it.hit / 4));
/**
 * 道具表改动【新：负责人 2026-11-14】：原版的青箬笠（道具 128，0 起算 127）没有任何关卡、宝箱或商店给，
 * 改名「碧雲箬笠」上架武器店，作为紅纓氈笠的上一级：防 10（打铁 +3 一次，原版）、移动 +3（原版）、命中 +16，
 * 城镇 7–11（黄泥冈前起）有卖，原定 4500 两（原版卖价 2250 的两倍），2026-11-25 按指导价改 4120。图标仍用原版这一格。
 */
/** 城镇的先后顺序（同 preset.ts 的 TOWN_ORDER） */
const TOWNS_IN_ORDER = [1, 2, 3, 4, 5, 13, 6, 12, 7, 8, 9, 10, 11];
/** 从城镇 town 起（按先后顺序）都有卖的城镇号表（道具 +146） */
const soldFrom = (town: number) => {
  const t = TOWNS_IN_ORDER.slice(TOWNS_IN_ORDER.indexOf(town));
  return [...t, ...Array(13 - t.length).fill(0)];
};
/** 上架：武器店（大类 2）或当铺（大类 5），从城镇 town 起有卖，卖价 = 买价 / 2 */
const shopItem = (price: number, town: number, category = 2): Partial<Item> => ({ category, buyPrice: price, sellPrice: price / 2, seqA: soldFrom(town) });
/** 只改价钱：卖价 = 买价 / 2 */
const price = (p: number): Partial<Item> => ({ buyPrice: p, sellPrice: p / 2 });
export const ITEM_OVERRIDES: Record<number, Partial<Item>> = {
  127: { name: '碧雲箬笠', category: 2, hit: 16, defense: 12, description: '防御力加12，可提升', buyPrice: 2580, sellPrice: 1290, seqA: [10, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, // 斗笠到顶（移动 +3）；2026-11-26 斗笠补档后从城镇 7 挪到 10、防 10 → 12
  126: { ...shopItem(1550, 5), defense: 8, description: '防御力加8，可提升' }, // 紅纓氈笠：移动 +2 原版城镇 2 就有，太早；2026-11-26 挪到城镇 5、防 6 → 8
  /*
   * 原版库里有、但没有任何关卡、宝箱、我方配装或商店给的装备（敌人身上的打倒后不掉），一律放进后期商店【新：负责人 2026-11-14】。
   * 价格按同类商店货的属性比较定；城镇 7（N09 之后）→ 8 → 9 → 10（N-add16 前）越往后越好。属性照原版不改。108魔星草人没有属性，不放。
   */
  11: { ...shopItem(3270, 7), attack: 24, agility: 8, description: '攻擊力加24，可提升', maxHp: 0, maxMp: 0, regenHp: 6 }, // 2026-11-26 统一：攻 18 → 24（同城镇鋼刺拳 24），体气 20 → 10、敏 10 → 8； 烏金鐵拳：攻 18 偏低，附加多（鐵甲拳 攻 30 / 2900）；烏金鐵拳：体气上限换成每回合回体 6
  21: { ...shopItem(7430, 10), hit: 8, agility: 8, crit: 15, maxHp: 10, maxMp: 20, stun: 15 }, // 2026-11-26 特色稍减：命敏 10 → 8、必 20 → 15、体 20 → 10、气 50 → 20、昏 20 → 15； 打狗棒：攻 30 + 射程、移动、昏 20%（羅漢棍 攻 36 / 3300）
  28: { ...shopItem(3730, 9), moveBonus: 0, regenMp: 0 }, // 2026-11-26 统一：去掉移动 +1、每回合回气 20； 風雷刀：攻 22 + 移动、每回合回气 20（冰火刀 攻 34 / 3400）
  36: { ...shopItem(4440, 10), hit: 8, agility: 8, crit: 15, maxMp: 0 }, // 2026-11-26 特色稍减：命 10 → 8、敏 15 → 8、必 20 → 15、去掉气 +10，射程保留； 青龍偃月刀：攻 35 + 射程、敏 15、必 20（金龍大刀 攻 38 / 3640）
  47: { ...shopItem(3550, 9), hit: 8, crit: 15 }, // 2026-11-26 特色稍减：命 10 → 8、必 20 → 15，射程保留； 火尖槍：攻 28 + 射程、命 10、必 20（透甲槍 攻 38 / 5500）
  53: { ...shopItem(14130, 10), hit: 8, agility: 5, regenHp: 25, regenMp: 25 }, // 2026-11-26 特色稍减：命 15 → 8、敏 10 → 5、回体回气 30 → 25； 金剛鏟：攻 36 + 每回合回体回气 30（巨靈鏟 攻 39 / 7000）
  66: { ...shopItem(3160, 7), attack: 30, description: '攻擊力加30，可提升', hit: 8, maxMp: 8 }, // 2026-11-26 闊劍、錕吾劍提前后攻 28 → 30，保持递增； // 2026-11-26 统一：攻 15 → 28（鋼劍 22 城镇 1、闊劍 29 城镇 8 之间）； 玄鐵劍：攻 15 偏低（闊劍 攻 29 / 1600）；玄鐵劍
  70: { ...shopItem(1680, 5), attack: 28, description: '攻擊力加28，可提升', agility: 8, crit: 5, attackStep: 4, attackSteps: 1 }, // 2026-11-26 补双剑断档：城镇 7 → 5、攻 27 → 28；统一：攻 22 → 27； 將邪劍：攻 22（兩儀劍 攻 28 / 2300）；將邪劍；打铁原版 +20×1，改成同类的 +4×1（负责人 2026-11-26）
  75: { ...shopItem(2940, 7), attack: 33, crit: 10, description: '攻擊力加33，可提升', poison: 10, hit: 6 }, // 2026-11-26 补叉断档：城镇 9 → 7；统一：攻 38 → 33（不超过城镇 10 的飛魚叉 34）、必 20 → 10； 虎鯊叉：攻 38、必 20（飛魚叉 攻 34 / 4200）；虎鯊叉；命中 5 → 6
  79: { ...shopItem(2800, 5), attack: 32, description: '攻擊力加32，可提升', stun: 5 }, // 2026-11-26 补桨断档：城镇 8 → 5、攻 33 → 32；统一：攻 30 → 33（木槳 30 城镇 1、鐵槳 35 城镇 9 之间）； 巨鯨槳：攻 30、昏 15%（鐵槳 攻 35 / 3000）；巨鯨槳：昏迷 15 → 5
  94: shopItem(3100, 8), // 綠蓑衣：防 17、敏 13、移动 +2（皂色繡襖 防 18 / 2000）；3300 两（2026-11-26 重审）
  110: shopItem(7810, 9), // 梅花榆葉甲：防 45（鐵葉攢鎧 防 40 / 5200）
  111: shopItem(13530, 10), // 雁翎圈金甲：防 50
  124: { ...shopItem(7180, 9), maxMp: 20 }, // 2026-11-26 统一：气 +50 → +20； 烏紗帽：防 10、每回合回体回气 20（猛虎紋玉 回 15 / 6000）
  132: { ...shopItem(1080, 7), agility: -5 }, // 耀日鑌鐵盔：防 20、必 10（熟鋼獅子盔 防 18 / 2400）；敏捷 −10 → −5
  138: shopItem(2610, 9), // 麒麟護符：防 20、命 10、敏 10；2740 两（2026-11-26 重审）
  143: shopItem(5000, 9, 5), // 菊花金飾：体气 +50（水蓮鐵飾 +20 / 2000），当铺
  154: shopItem(600, 10, 5), // 孔明兵法：攻防命敏 +5，当铺
  /*
   * 药价按效果重定【新：负责人 2026-11-25】：原版小還銀丹 / 小還金丹回得比大還少却贵 2–5 倍，大還又比同等回量的創藥便宜一半，
   * 抗毒 / 抗昏 3 回合卖解毒草藥的 60 倍。现按指导价（tools/price-audit.ts：体力 2.5 两/点、气力 2 两/点，回满按体 300 气 200 算）。
   */
  // 萬靈藥：原数据回体 510 ≈ 回满（说明写 200），2026-11-25 改 200；2026-11-26 负责人定改成群体药：自己和相邻友方各回体 150（area），原价 300，群体后按指导价 750
  157: { healHp: 150, area: true, description: '自己與相鄰同伴各回體150', ...price(750) }, // 萬靈藥：群体药不加持续回复（负责人 2026-11-26）
  158: { healHp: 130, healMp: 40, regenHp: 40, regenMp: 15, description: '回體130、氣40，之後3回合每回合體40、氣15', ...price(800) }, // 大還銀丹：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 130/40 + 3 回合每回合 40/15）
  159: { healHp: 180, healMp: 70, regenHp: 60, regenMp: 30, description: '回體180、氣70，之後3回合每回合體60、氣30', ...price(1070) }, // 大還金丹：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 180/70 + 3 回合每回合 60/30）
  161: { description: '體氣全滿，解除異常', ...price(1300) }, // 天山雪蓮：体气回满 + 解毒解昏，原 1000（要比大還金丹贵）
  183: { healHp: 110, healMp: 25, regenHp: 30, regenMp: 10, description: '回體110、氣25，之後3回合每回合體30、氣10', ...price(610) }, // 小還銀丹：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 110/25 + 3 回合每回合 30/10）
  181: { healHp: 100, healMp: 0, regenHp: 30, regenMp: 0, description: '回體100，之後3回合每回合體30', ...price(480) }, // 銀創藥：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 100/0 + 3 回合每回合 30/0）
  178: { healMp: 110, regenMp: 25, description: '回氣110，之後3回合每回合氣25', ...price(370) }, // 豬肉包子：负责人 2026-11-26 立即 + 3 回合持续，立即回复要比羊肉包子（100）多；气 200 封顶后指导价相同，牛肉 / 人肉手动拉开
  177: { healMp: 140, regenMp: 35, description: '回氣140，之後3回合每回合氣35', ...price(430) }, // 牛肉包子：负责人 2026-11-26 立即 + 3 回合持续，立即回复要比羊肉包子（100）多；气 200 封顶后指导价相同，牛肉 / 人肉手动拉开
  176: { healMp: 170, regenMp: 45, description: '回氣170，之後3回合每回合氣45', ...price(480) }, // 人肉包子：负责人 2026-11-26 立即 + 3 回合持续，立即回复要比羊肉包子（100）多；气 200 封顶后指导价相同，牛肉 / 人肉手动拉开
  182: { healHp: 130, healMp: 0, regenHp: 45, regenMp: 0, description: '回體130，之後3回合每回合體45', ...price(660) }, // 金創藥：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 130/0 + 3 回合每回合 45/0）
  184: { healHp: 150, healMp: 50, regenHp: 50, regenMp: 20, description: '回體150、氣50，之後3回合每回合體50、氣20', ...price(970) }, // 小還金丹：负责人 2026-11-26 每档立即、持续回复都比上一档多（立即 150/50 + 3 回合每回合 50/20）
  165: { attack: 25, attackTurns: 5, description: '5回合攻擊+25', ...price(440) }, // 人參藥酒：负责人 2026-11-26 酒要明显有用：+25、5 回合，价按增益指导价（临时增益约为装备永久加成的 1/5）
  166: { defense: 25, params: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '5回合防御+25', ...price(440) }, // 白蛇藥酒：负责人 2026-11-26 酒要明显有用：+25、5 回合，价按增益指导价（临时增益约为装备永久加成的 1/5）
  167: { hit: 25, params: [0, 0, 0, 25, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '5回合命中+25', ...price(440) }, // 白酒：负责人 2026-11-26 酒要明显有用：+25、5 回合，价按增益指导价（临时增益约为装备永久加成的 1/5）
  168: { agility: 25, params: [0, 0, 0, 0, 0, 25, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '5回合敏捷+25', ...price(440) }, // 女兒紅：负责人 2026-11-26 酒要明显有用：+25、5 回合，价按增益指导价（临时增益约为装备永久加成的 1/5）
  169: { crit: 12, params: [0, 0, 0, 0, 0, 0, 0, 12, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '5回合必殺+12', ...price(210) }, // 青花壇酒：负责人 2026-11-26 酒要明显有用：+12、5 回合，价按增益指导价（临时增益约为装备永久加成的 1/5）
  162: { crit: 70, description: '3回合必殺+70', ...shopItem(1000, 7, 4) }, // 神力萬靈丹：负责人 2026-11-26 万灵丹一系加强：必杀 +40 → +70，价高于线性指导价（约 1.4 倍）
  188: { defense: 100, description: '3回合防御+100', ...shopItem(1500, 7, 4) }, // 金剛萬靈丹：负责人 2026-11-26 万灵丹一系加强：+60 → +100，价约指导价 1.4 倍
  189: { hit: 100, description: '3回合命中+100', ...shopItem(1500, 7, 4) }, // 火眼萬靈丹：同上
  190: { agility: 100, description: '3回合敏捷+100', ...shopItem(1500, 7, 4) }, // 神步萬靈丹：同上
  163: { moveBonus: 3, params: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '5回合移動+3', ...shopItem(1000, 5, 4) }, // 旋風萬靈丹：负责人 2026-11-26 万灵丹一系加强：移动 +2 → +3（5 回合）
  164: { moveBonus: 4, params: [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], description: '3回合移動+4', ...shopItem(800, 5, 4) }, // 疾風萬靈丹：移动 +3 → +4（3 回合）
  191: { description: '3回合攻擊帶毒20%', ...shopItem(210, 5, 4) }, // 金蠶蠱毒粉：原版不上架，负责人 2026-11-26 第 5 个城镇起卖
  192: { description: '3回合攻擊致昏20%', ...shopItem(210, 5, 4) }, // 悲酥涼風粉：原版不上架，负责人 2026-11-26 第 5 个城镇起卖
  156: { description: '回體100' }, // 说明写短（负责人 2026-11-26）
  179: { description: '回氣100' }, // 说明写短（负责人 2026-11-26）
  180: { description: '回氣50' }, // 说明写短（负责人 2026-11-26）
  194: { description: '解昏迷' }, // 说明写短（负责人 2026-11-26）
  195: { description: '解毒' }, // 说明写短（负责人 2026-11-26）
  196: { description: '3回合攻防命敏+255' }, // 说明写短（负责人 2026-11-26）
  197: { description: '3回合攻防命敏+200' }, // 说明写短（负责人 2026-11-26）
  198: { description: '3回合攻防命敏+150' }, // 说明写短（负责人 2026-11-26）
  199: { description: '3回合攻防命敏+30' }, // 说明写短（负责人 2026-11-26）；原文写五属性，但必杀的回合数（params[8]）是 0，实际不加必杀
  185: { description: '3回合抗毒', ...price(300) }, // 清涼丸：3 回合抗毒，原 3000
  187: { description: '3回合抗昏', ...price(300) }, // 提神丸：3 回合抗昏，原 3000
  /*
   * 装备和杂货的价按指导价挪进 0.5–1.5 倍区间【新：负责人 2026-11-25】：只改落在区间外的，挪到最近的边上，改动尽量小。
   * 指导价见 tools/price-audit.ts（--json 输出这张表）。
   */
  5: { ...price(1040), maxHp: 0, maxMp: 0 }, // 钢拳：原 760；鋼拳：拳套不加体气上限（2026-11-26 武器特色）
  13: price(300), // 木棍：原 450
  25: price(1840), // 阴陽刀：原 1800
  29: price(380), // 大杆刀：原 300；380 两（2026-11-26 重审）
  32: price(1750), // 眉尖刀：原 2230
  38: price(820), // 花枪：原 1400
  39: price(1000), // 笔管枪：原 1600
  40: price(1180), // 綠沉枪：原 2040
  41: price(1350), // 鴉角枪：原 2400
  43: price(1950), // 白点钢枪：原 3720
  48: price(1280), // 水磨禅杖：原 700
  55: { ...shopItem(1390, 3), crit: 8, maxHp: 5, attackStep: 3, attackSteps: 2 }, // 解腕尖刀：原 900；刀是必杀最高的类别，按档 8/10/12/15/18/20/22，并加体力上限（负责人 2026-11-26 武器特色）；城镇 7 → 3 补刀的断档，打铁原版 +8×2 → +3×2
  73: { ...shopItem(1820, 5), poison: 8, hit: 5 }, // 2026-11-26 补叉断档：城镇 8 → 5；钢叉：原 2900；鋼叉：叉的特色是带毒（倒刺）8/10/12%；命中 −10 → +5
  74: { ...price(2570), poison: 12, hit: 8 }, // 飞鱼叉：原 4200；3150 两（2026-11-26 重审）；飛魚叉；命中 −10 → +8
  85: price(230), // 棋子布背心：原 200
  104: { ...price(1390), agility: 0, hit: 4 }, // 朱红甲：原 2300；轻甲不扣敏捷（原 −9，负责人 2026-11-26）
  108: { ...price(2350), crit: 6 }, // 狻猊甲：原 3810；必杀 +6；2460 两（2026-11-26 重审）
  109: { ...price(3670), crit: 10 }, // 铁葉攢鎧：原 5200；必杀 +10；3940 两（2026-11-26 重审）
  112: price(70), // 一字巾：原 50；70 两（2026-11-26 重审）
  115: { ...price(420), maxHp: 0, hit: 3 }, // 干红凹面巾：原 400；体 +20 → 命中 +3（2026-11-26 统一）
  118: { ...price(720), hit: 4 }, // 軟紗唐巾：原 1500；命中 +4（高档头巾加命中，负责人 2026-11-26）
  119: { ...price(1740), hit: 6 }, // 黑头巾：原 2090；命中 +6
  120: { ...price(1840), hit: 8 }, // 皂紗唐巾：原 2800；命中 +8
  121: price(590), // 虎皮帽：原 300
  122: price(630), // 僧帽：原 400
  123: price(1100), // 官帽：原 800
  128: { ...price(150), agility: -1 }, // 熟铁盔：原 300；敏捷 −2 → −1
  129: { ...price(130), agility: -2 }, // 朱纓盔：原 1200；敏捷 −4 → −2
  130: { ...price(210), agility: -3, crit: 3 }, // 獅子盔：原 1800；敏捷 −6 → −3；必杀 +3（战盔必杀按档拉开，负责人 2026-11-26）
  131: { ...price(550), agility: -4, crit: 6 }, // 熟钢獅子盔：原 2400；敏捷 −8 → −4；必杀 +6
  139: price(840), // 青花錫飾：原 1000
  155: { description: '回體50', ...price(70) }, // 狗皮膏药：原 50；早期药不加持续回复（负责人 2026-11-26）
  /*
   * 衣帽调整【新：负责人 2026-11-26】：轻甲不扣敏捷（连环甲原 −6、朱红甲见上）；战盔扣的敏捷减半（熟铁盔…耀日镔铁盔见上，宝箱货凤翅金盔 −12 → −6）；
   * 最早两件重甲防御太低（比城镇 5 的朱红甲还低），裹金生铁甲 16 → 24、镶银生铁甲 17 → 26。
   */
  69: { ...price(2430), agility: 10, crit: 5 }, // 按指导价（2026-11-26 衣帽改动后重审）；鴛鴦劍
  101: price(630), // 按指导价（2026-11-26 衣帽改动后重审）
  103: { ...price(1230), agility: 0, hit: 2 }, // 連環甲；1260 两（2026-11-26 重审）
  /* 衣服特点拉开（负责人 2026-11-26）：高档轻甲加命中、高档重甲加必杀、战袍都带每回合回气（低档少） */
  // 高档常服移动 +1、每回合少量回体（负责人 2026-11-26）
  89: { regenHp: 3 }, // 紅羅繡襖
  90: { moveBonus: 1, regenHp: 5 }, // 青紗衫子
  91: { moveBonus: 1, regenHp: 6 }, // 皂色繡襖
  95: { regenMp: 2 }, // 戰袍
  96: { regenMp: 4 }, // 虎皮戰袍
  97: { regenMp: 6 }, // 金繡綠羅袍
  98: { regenMp: 8 }, // 綠羅花戰袍
  107: { crit: 3, ...shopItem(1810, 7) }, // 2026-11-26 补重甲断档：城镇 8 → 7；魚鱗鐵甲；1870 两（2026-11-26 重审）
  116: { hit: 2 }, // 青紗頭巾：命中 +2（头巾到这档起加命中）
  117: { hit: 5 }, // 萬字巾（宝箱货）：命中 +5
  133: { agility: -6 }, // 鳳翅金盔
  /* 同类加成统一（负责人 2026-11-26）：齊眉棍 / 五郎棍补命中必杀；長槍 / 紅纓槍去掉体气；禪杖类不再扣必杀；刀的必杀按档递增 */
  18: { ...price(3430), hit: 10, crit: 8, range: 1 }, // 齊眉棍
  19: { ...price(3530), hit: 10, crit: 9, range: 1 }, // 五郎棍
  37: { ...price(620), maxHp: 0, maxMp: 0, hit: 3 }, // 長槍：体气 +5 → 命中 +3
  42: { ...price(1400), maxHp: 0, maxMp: 0, hit: -5 }, // 紅纓槍：体 +6 气 +8 → 去掉，命中 −8 → −5
  50: { ...price(2960), crit: 0 }, // 月牙鏟：必杀 −5 → 0
  51: { ...price(5440), crit: 0 }, // 降魔鏟：必杀 −6 → 0
  52: { ...price(7590), crit: 0 }, // 巨靈鏟：必杀 −9 → 0
  56: { ...price(2150), crit: 12, maxHp: 10 }, // 腰刀
  57: { ...price(2620), crit: 15, maxHp: 15 }, // 戒刀
  58: { ...price(3350), crit: 18, maxHp: 20 }, // 三尖兩刃刀
  72: { ...price(1240), hit: 3 }, // 按指导价（2026-11-26 武器加成统一后重审）；魚叉：叉不再扣命中，改成加命中（负责人 2026-11-26）3/5/6/8/10
  /* 长兵器射程（负责人 2026-11-26）：枪、棍、大刀从城镇 8 起的货（含续篇货）射程 +1，基础和中档货不加；純鋼鐵棍、鳳嘴刀原有的射程去掉 */
  17: { ...price(3060), range: 0 }, // 純鋼鐵棍（城镇 7）
  33: { ...price(1760), range: 0 }, // 鳳嘴刀（城镇 6）
  20: { ...price(4150), range: 1 }, // 羅漢棍
  34: { ...price(2990), range: 1 }, // 掩月刀
  35: { ...price(3310), range: 1 }, // 金龍大刀
  44: { ...price(2260), range: 1 }, // 渾鐵點鋼槍
  45: { ...price(2280), range: 1 }, // 丈八點鋼矛
  46: { ...price(2780), range: 1 }, // 透甲槍
  7: { ...price(1390), regenHp: 3 }, // 鋼刺拳：拳套中后期每回合回体（武器特色）
  8: { ...price(2080), regenHp: 5 }, // 精鋼刺拳：每回合回体 5
  9: { ...price(3350), regenHp: 8 }, // 鐵甲拳：每回合回体 8
  63: { ...shopItem(1380, 3), attack: 25, description: '攻擊力加25，可提升', hit: 5, maxMp: 5 }, // 闊劍：剑的特色是命中 + 少量气力上限；负责人 2026-11-26 补剑的断档：城镇 8 → 3，攻 29 → 25
  64: { ...shopItem(1620, 5), attack: 27, description: '攻擊力加27，可提升', hit: 6, maxMp: 6 }, // 錕吾劍：城镇 9 → 5，攻 32 → 27（负责人 2026-11-26 补剑的断档）
  65: { ...price(3250), hit: 12, maxMp: 15 }, // 龍泉劍
  68: { ...shopItem(1510, 3), attack: 26, description: '攻擊力加26，可提升', agility: 8, crit: 5 }, // 2026-11-26 补双剑断档：城镇 8 → 3、攻 28 → 26；兩儀劍：双剑的特色是敏捷，必杀降到 5 左右
  77: { ...shopItem(3170, 7), moveBonus: 1 }, // 2026-11-26 补桨断档：城镇 9 → 7；鐵槳：桨高档移动 +1（水军灵活）
  78: { ...price(4280), moveBonus: 1, stun: 5 }, // 鑌鐵槳：昏迷 10 → 5
  /* 刀补两档（负责人 2026-11-26）：原版没人用、哪里都不出现的两把刀上架。四竅八環刀放城镇 5（解腕尖刀之后、腰刀之前）；雁翎刀放阳谷整备（城镇 11），在三尖兩刃刀和续篇的楊家寶刀之间 */
  59: { ...shopItem(1770, 5), attack: 28, crit: 10, maxHp: 8, attackStep: 3, attackSteps: 2, description: '攻擊力加28，可提升' }, // 原版 攻 16、必 15、打铁 +8×3
  60: { ...shopItem(4040, 11), attack: 40, agility: 0, crit: 20, maxHp: 25, attackStep: 4, attackSteps: 2, description: '攻擊力加40，可提升' }, // 原版 攻 40、敏 10、必 4、不能打铁
  105: { defense: 24, description: '防御力加24，可提升', ...shopItem(700, 3) }, // 2026-11-26 补重甲断档：城镇 6 → 3；裹金生鐵甲：原 500
  106: { defense: 26, description: '防御力加26，可提升', ...shopItem(700, 5) }, // 2026-11-26 补重甲断档：城镇 7 → 5；鑲銀生鐵甲
};
/**
 * 新增装备【新：负责人 2026-11-26，补商店断档】：放在原版道具表的空位上（原版这几格没有名字、不在任何地方出现），
 * 其余字段照 from 那件同类货（打铁、图标框等），图标是换色的新图（gamedata/icons 200 起，tools/recolor-icon.py）。
 * 续篇商店的新货在 mainline 包（packs/mainline/pack.json，按 shopTier 分档）。
 */
const NEW_ITEMS: Record<number, { from: number } & Partial<Item>> = {
  71: { from: 69, name: '雌雄寶劍', type: 8, icon: 204, attack: 37, hit: 5, description: '攻擊力加37，可提升', ...shopItem(2910, 10), agility: 12, crit: 6 }, // 双剑：原到顶鴛鴦劍 攻 33；雌雄寶劍
  80: { from: 9, name: '金剛拳套', icon: 203, attack: 36, hit: 10, crit: 10, description: '攻擊力加36，可提升', ...shopItem(4250, 10), regenHp: 10 }, // 拳套：原到顶鐵甲拳 攻 30；金剛拳套：每回合回体 10
  81: { from: 103, name: '鎖子甲', icon: 200, defense: 28, hit: 6, agility: 0, maxHp: 10, description: '防御力加28，可提升', ...shopItem(2200, 7) }, // 轻甲：原到顶朱紅甲 防 22（城镇 5）
  82: { from: 102, name: '柳葉軟甲', icon: 201, defense: 34, hit: 8, agility: 0, maxHp: 15, description: '防御力加34，可提升', ...shopItem(3200, 9) },
  170: { from: 121, name: '貂鼠皮帽', icon: 205, defense: 9, regenHp: 15, regenMp: 15, description: '防御力加9，每回合回復體力氣力15點', ...shopItem(2600, 6) }, // 帽子：官帽（城镇 3）到烏紗帽（城镇 9）之间
  // 斗笠补两档（负责人 2026-11-26：只有最高档碧雲箬笠移动 +3）：遮日黑箬笠 1 → 青竹斗笠 1 → 紅纓氈笠 2 → 白范陽氈笠 2 → 碧雲箬笠 3
  186: { from: 125, name: '青竹斗笠', type: 14, icon: 206, defense: 6, hit: 10, moveBonus: 1, description: '防御力加6，可提升', ...shopItem(740, 3) },
  193: { from: 126, name: '白范陽氈笠', type: 14, icon: 207, defense: 10, hit: 14, moveBonus: 2, description: '防御力加10，可提升', ...shopItem(1790, 7) },
  160: { from: 132, name: '爛銀盔', icon: 202, defense: 28, hit: 0, agility: -6, crit: 13, maxHp: 10, description: '防御力加28，可提升', ...shopItem(1600, 10) }, // 战盔：原到顶耀日鑌鐵盔 防 20
};
export const withItemOverrides = (items: Item[]): Item[] =>
  items.map((it) => {
    const add = NEW_ITEMS[it.id];
    if (add && items[add.from]) {
      const { from, ...patch } = add;
      const base = items[from];
      return { ...base, seqB: patch.seqA ?? base.seqB, ...patch, params: [...base.params], id: it.id };
    }
    return ITEM_OVERRIDES[it.id] ? { ...it, ...ITEM_OVERRIDES[it.id] } : it;
  });
/** 个别装备的命中改值（道具号 → 命中）：遮日黑箬笠 +8、紅纓氈笠 +12（原版都是 0）【新：负责人 2026-11-14】 */
export const EQUIP_HIT_OVERRIDES: Record<number, number> = { 125: 8, 126: 12 };

/** 回复类消耗品 */
export const isHealing = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 17;

/** 普通攻击：职业技能表的第一项（全部 72 个职业的第一项都是 1 级、零消耗的普通/远程攻击） */
export function basicAttack(c: ClassDef): SkillDef | undefined {
  return c.skills[0];
}

/** 战斗中能"使用"的道具：类型 15–22（回复、解毒解昏、抗毒抗昏、增益）。原版 0x408dc0 收 15–24，23 财宝用了没有效果、24 祕笈暂未实现 */
export const isUsable = (it: Item | undefined) => !!it && it.type >= 15 && it.type <= 22;

export type BuffStat = 'attack' | 'defense' | 'hit' | 'agility' | 'crit' | 'move' | 'poison' | 'stun' | 'resistPoison' | 'resistStun' | 'regenHp' | 'regenMp';
/** 高级药的持续回复（负责人 2026-11-26）：药上的 regenHp / regenMp 是之后每回合回复多少，持续这么多回合 */
export const ITEM_REGEN_TURNS = 3;
/**
 * 属性效果：value 加到对应属性；turns > 0 按回合倒计时，turns = 0 表示持续到本关结束。
 * source 是增益的来源名（技能、道具、请客的酒菜），状态栏按它显示；同一来源再加只刷新回合、不叠加（applyBuffs）。
 */
export interface Buff {
  stat: BuffStat;
  value: number;
  turns: number;
  source?: string;
}

/**
 * 加一组增益【新】（负责人 2026-11-26）：同一来源（同名技能 / 道具 / 请客）已有的整组换成新的，只是刷新回合，效果不叠加；
 * 不同来源的增益同时挂着、效果相加（负责人 2026-11-26）。没写来源的（剧本 op 101）照旧直接加上。
 */
export function applyBuffs(cur: Buff[], list: readonly Buff[], source?: string): Buff[] {
  if (!source) return [...cur, ...list.map((b) => ({ ...b }))];
  return [...cur.filter((b) => b.source !== source), ...list.map((b) => ({ ...b, source }))];
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
    { stat: 'regenHp', value: it.regenHp, turns: ITEM_REGEN_TURNS },
    { stat: 'regenMp', value: it.regenMp, turns: ITEM_REGEN_TURNS },
  ];
  return list.filter((b) => (b.turns ?? 0) > 0 && (b.value !== 0 || b.stat.startsWith('resist')));
}

const STAT_NAME: Record<BuffStat, string> = {
  attack: '攻击', defense: '防御', hit: '命中', agility: '敏捷', crit: '必杀', move: '移动', poison: '攻击带毒', stun: '攻击致昏', resistPoison: '抗毒', resistStun: '抗昏', regenHp: '每回合回体', regenMp: '每回合回气',
};
export const buffName = (s: BuffStat) => STAT_NAME[s];

const STAT_SHORT: Record<BuffStat, string> = {
  attack: '攻', defense: '防', hit: '命', agility: '敏', crit: '必', move: '移', poison: '带毒', stun: '致昏', resistPoison: '抗毒', resistStun: '抗昏', regenHp: '回体', regenMp: '回气',
};

/** 头上弹字用的简短效果，如「防+30 敏+20」 */
export const buffShort = (list: readonly Buff[]) => list.map((b) => `${STAT_SHORT[b.stat]}${b.value ? `${b.value > 0 ? '+' : ''}${b.value}` : ''}`).join(' ');

/** 单位面板的状态说明【新】：按来源一组一条，写简要的效果和剩余回合，如「呼保义 防+30 敏+20 3回合」；没有来源的每项一条。 */
export function buffLabels(buffs: readonly Buff[]): string[] {
  const groups = new Map<string, Buff[]>();
  buffs.forEach((b, i) => {
    const key = b.source ? `${b.source}|${b.turns}` : `#${i}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  });
  return [...groups.values()].map((g) => {
    const fx = buffShort(g);
    const turns = g[0].turns === 0 ? '本关' : `${g[0].turns}回合`;
    return [g[0].source, fx, turns].filter(Boolean).join(' ');
  });
}


/** 道具效果的简短说明（简体）：装备列攻防等加成（含打铁 n 次），消耗品列效果 */
export function itemSummary(it: Item, n = 0): string {
  const p: string[] = [];
  if (equipSlotOf(it) >= 0) {
    const f = forgedStats(it, n);
    if (f.attack) p.push(`攻${f.attack}`);
    if (f.defense) p.push(`防${f.defense}`);
    const hit = equipHitBonus(it);
    if (hit) p.push(`命${hit > 0 ? '+' : ''}${hit}`);
    for (const [k, l] of [['agility', '敏'], ['crit', '必'], ['range', '射程'], ['maxHp', '体'], ['maxMp', '气']] as const)
      if (it[k]) p.push(`${l}${it[k] > 0 ? '+' : ''}${it[k]}`);
    if (equipMoveBonus(it)) p.push(`移+${equipMoveBonus(it)}`);
    if (it.regenHp) p.push(`每回合回体${it.regenHp}`);
    if (it.regenMp) p.push(`每回合回气${it.regenMp}`);
    if (it.poison) p.push(`攻击带毒${it.poison}%`);
    if (it.stun) p.push(`攻击致昏${it.stun}%`);
    return p.join(' ');
  }
  // 消耗品写得简短（负责人 2026-11-26）：「回体130 气40，之后3回合每回合体40 气15」「5回合攻击+25」「3回合攻防命敏+150」
  const heal: string[] = [];
  if (it.healHp) heal.push(it.healHp < 0 ? '体力全满' : `回体${it.healHp}`);
  if (it.healMp) heal.push(it.healMp < 0 ? '气力全满' : heal.length ? `气${it.healMp}` : `回气${it.healMp}`);
  if (heal.length) p.push((it.area ? '自己和相邻同伴' : '') + heal.join(' '));
  if (it.curePoison || it.type === 18) p.push('解毒');
  if (it.cureStun || it.type === 19) p.push('解昏迷');
  const buffs = itemBuffs(it);
  const regen = buffs.filter((b) => b.stat === 'regenHp' || b.stat === 'regenMp');
  if (regen.length) {
    const r = `${regen[0].turns}回合每回合${regen.map((b) => `${b.stat === 'regenHp' ? '体' : '气'}${b.value}`).join(' ')}`;
    if (p.length) p[p.length - 1] += `，之后${r}`;
    else p.push(r);
  }
  const byTurns = new Map<number, Buff[]>();
  for (const b of buffs) if (!regen.includes(b)) byTurns.set(b.turns, [...(byTurns.get(b.turns) ?? []), b]);
  for (const [turns, list] of byTurns) {
    const byValue = new Map<string, BuffStat[]>();
    for (const b of list) {
      const pct = b.stat === 'poison' || b.stat === 'stun' ? '%' : '';
      const v = b.value ? `+${b.value}${pct}` : '';
      byValue.set(v, [...(byValue.get(v) ?? []), b.stat]);
    }
    p.push(`${turns}回合${[...byValue].map(([v, stats]) => (stats.length > 1 ? stats.map((s) => STAT_SHORT[s]).join('') : buffName(stats[0])) + v).join(' ')}`);
  }
  if (it.type === 23) p.push('可典当');
  return p.join(' ');
}
