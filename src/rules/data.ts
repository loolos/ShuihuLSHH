// 规则引擎使用的数据：由原版解析结果整理而来，不依赖 Phaser。
import type { ClassRecord, ClassSkill, SkillHit } from '../formats/hum.ts';
import type { Item } from '../formats/goo.ts';
import type { ExePrompt } from '../formats/exe.ts';

export interface SkillDef extends ClassSkill {
  name: string;
  /** 出手音效用的技能号（s<号>.mp3）；扩展包技能借原版技能的声音，不填就用 skillId */
  soundId?: number;
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
export const SKILL_OVERRIDES: Record<number, Partial<Pick<SkillDef, 'power' | 'mpCost' | 'hitMod' | 'critMod' | 'hits' | 'stun' | 'rangeMax'>>> = {
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
  56: { stun: 30 }, // 朱武 詭計多端（7 级连续技），原版 5，负责人 2026-11-13 改 30
  // 137 佛法無邊（魯智深 17 级，以自身为中心的范围技）：原版第 13 帧一段 100%，负责人 2026-11-14 要求改成三段：
  // 禅杖顿地（第 13 帧，原版命中帧）之后蹲身按杖的第 16、19 帧再各震一下，30% / 30% / 40%；每段放一轮特效
  137: { hits: [{ frame: 13, percent: 30, dir: 0 }, { frame: 16, percent: 30, dir: 0 }, { frame: 19, percent: 40, dir: 0 }] },
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
export function noHeroHitPenalty<T extends Pick<SkillDef, 'power' | 'hitMod'>>(classId: number, s: T): T {
  if (classId >= HERO_CLASS_COUNT || s.hitMod >= 0) return s;
  return { ...s, power: Math.max(1, s.power + s.hitMod), hitMod: 0 };
}

/**
 * 隐藏技改名（技能号 → 名字，繁体，LV 后缀照旧）【新】（负责人 2026-11-13 嫌"古武術"重名太多）。
 * 原版朱武、阮氏三雄、吳用的隐藏技都叫"古武術LV1–3"；按人物和招式形状各取一个名字，敌方同职业单位一起改。
 */
export const SKILL_NAME_OVERRIDES: Record<number, string> = Object.fromEntries(
  ([
    [60, '奇門遁甲'], // 朱武（神機軍師），扇形
    [69, '天羅地網'], // 阮小二（立地太歲，打漁），落点菱形
    [76, '翻江倒海'], // 阮小五（短命二郎），扇形
    [83, '怒海狂濤'], // 阮小七（活閻羅），直线
    [91, '星羅棋布'], // 吳用（智多星），落点菱形、两段
  ] as const).flatMap(([id, name]) => [0, 1, 2].map((i) => [id + i, `${name}LV${i + 1}`])),
);

/** 新增技能（职业号 → 技能），不改原版 HUM；1000 起为重制版技能号。 */
export const CLASS_EXTRA_SKILLS: Record<number, SkillDef[]> = {
  // 朱武：沿用集气技的零耗气、自身回复 1/2 气力（CHARGE_DIVISOR）；group 0 复用本人的回复计出手动作。
  5: [{
    name: '气定神闲', skillId: 1000, type: 8, group: 0, hidden: false,
    learnLevel: 6, mpCost: 0, power: CHARGE_DIVISOR, rangeMin: 0, rangeMax: 0, area: 0,
    effect: 0, effect2: 0, effect3: 0, poison: 0, stun: 0, hitMod: 0, critMod: 0,
    hits: [], raw: '',
  }],
};

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
        ...r.skills.map((s, i) => withChargeDivisor(noHeroHitPenalty(r.id, {
          ...s,
          ...SKILL_OVERRIDES[s.skillId],
          name: SKILL_NAME_OVERRIDES[s.skillId] ?? skillNames[s.skillId] ?? `#${s.skillId}`,
          ...(i === 0 && BASIC_ATTACK_HITS[r.id] ? { hits: BASIC_ATTACK_HITS[r.id].map((h) => ({ ...h })) } : {}),
        }))),
        ...(CLASS_EXTRA_SKILLS[r.id] ?? []).map((s) => ({ ...s, hits: s.hits.map((h) => ({ ...h })) })),
      ]),
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
