// 技能：习得、施放距离、范围形状（docs/game-design.md §6；原版 EXE 0x408a80、0x408ae0、0x408b10）。
import type { Board, Cell } from './board.ts';
import { buffName, type GameData, type SkillDef } from './data.ts';
import { attackRange, attackSkill, DIRS, facingTowards, type Unit } from './unit.ts';

/** 集气 / 援气：回复自身或指定队友的气力。 */
export const isChargeSkill = (s: SkillDef) => s.type === 8;
/** 援助回气与自身集气分开，避免回合终了或 AI 把援助当成给自己回气。 */
export const isAllyChargeSkill = (s: SkillDef) => isChargeSkill(s) && s.chargeTarget === 'ally';
export const isSelfChargeSkill = (s: SkillDef) => isChargeSkill(s) && !isAllyChargeSkill(s) && !s.buffAlly;
/** 架势技【新】（§6.5.3）：集气类、不回气（power 0），只加增益（buffAlly 的可以给相邻队友）；回合终了的自动回气和 AI 回气都不选它 */
export const isStanceSkill = (s: SkillDef) => isChargeSkill(s) && !isAllyChargeSkill(s) && s.power <= 0 && !!s.selfBuffs?.length;
/** 能当回气用的自身集气技（不含架势技） */
export const isRechargeSkill = (s: SkillDef) => isChargeSkill(s) && !isAllyChargeSkill(s) && !isStanceSkill(s);
/** 回复技：回复范围内我方的体力（类型 9 与 11 的区别还没解开，都按回复体力处理【待核】） */
export const isHealSkill = (s: SkillDef) => s.type === 9 || s.type === 11;
/** 不造成伤害的技能 */
export const isSupportSkill = (s: SkillDef) => isChargeSkill(s) || isHealSkill(s);

/** 可控好汉的职业号 0–17（docs/reference/data-tables.md §1） */
export const HERO_CLASSES = 18;

/**
 * 出手时是否在出手者身上弹出技能名：技能都弹；普通攻击对我方、友军与原版好汉弹（如林沖「一寸丹心」）；敌方杂兵普攻不弹【新】（负责人 2026-11-13）。
 */
export const announcesSkill = (u: Unit, skill: SkillDef, data: GameData) => skill !== attackSkill(u, data) || u.side !== 'enemy' || u.classId < HERO_CLASSES;

/** "千軍萬馬LV2" → "千軍萬馬" */
export const skillBaseName = (name: string) => name.replace(/\s*LV\s*\d+$/i, '');

/**
 * 已习得、可以从技能菜单使用的技能（不含第一项普通攻击）。
 * 习得条件：习得等级 ≤ 当前等级，且不是隐藏技。原版的隐藏技（古武術祕笈）在 buildClasses 里已改成普通技能（unlockHiddenSkills）。
 * 分级技能（LV1–4）只保留已习得的最高一级。
 */
export function learnedSkills(u: Unit, data: GameData): SkillDef[] {
  const all = data.classes[u.classId]?.skills ?? [];
  const best = new Map<string, SkillDef>();
  for (const s of all.slice(1)) {
    if (s.hidden || s.learnLevel > u.level) continue;
    const k = skillBaseName(s.name);
    const had = best.get(k);
    if (!had || s.learnLevel >= had.learnLevel) best.set(k, s);
  }
  for (const id of u.extraSkills ?? []) {
    const extra = skillById(data, id);
    if (extra && !best.has(skillBaseName(extra.name))) best.set(skillBaseName(extra.name), extra);
  }
  return [...best.values()];
}

const skillIndex = new WeakMap<GameData, Map<number, SkillDef>>();
/** 按技能号找技能（关卡临时教的技能用，如朱贵扮酒保的劝酒） */
export function skillById(data: GameData, id: number): SkillDef | undefined {
  let m = skillIndex.get(data);
  if (!m) {
    m = new Map();
    for (const c of data.classes) for (const s of c?.skills?.slice(1) ?? []) if (!m.has(s.skillId)) m.set(s.skillId, s);
    skillIndex.set(data, m);
  }
  return m.get(id);
}

/** 这一级新领悟的技能（原版升级时 0x406a89 逐项比较习得等级 == 新等级） */
export function skillsLearnedAt(u: Unit, data: GameData, level: number): SkillDef[] {
  return (data.classes[u.classId]?.skills ?? []).slice(1).filter((s) => !s.hidden && s.learnLevel === level);
}

/** 施放距离 [下限, 上限]。普通攻击沿用 attackRange；其它技能读子项 +12/+13，射程大于 0 的再加装备射程（原版 0x408ae0 加 unit+0x88） */
export function castRange(u: Unit, s: SkillDef, data: GameData): [number, number] {
  if (s === attackSkill(u, data)) return attackRange(u, data);
  // 援气固定相邻一格；四格前冲技只选相邻方向，不由武器射程扩大施放点。
  if (s.areaPattern || isAllyChargeSkill(s) || s.buffAlly || s.type === 15 || s.type === 16 || s.type === 17) return [s.rangeMin, s.rangeMax];
  const lo = s.rangeMin;
  let hi = s.rangeMax > 0 ? Math.max(lo, s.rangeMax + u.stats.rangeBonus) : s.rangeMax;
  // 上限按「施放点 + 线形范围延伸」算：一线 2 格的技能施放点最远到第 reachCap − 1 格
  if (s.reachCap) hi = Math.max(lo, Math.min(hi, s.reachCap - Math.max(0, s.area - 1)));
  return [lo, hi];
}

/**
 * 可以选作施放点的格子：沿 4 个方向直线，距离在 [下限, 上限]；下限为 0 时含自身（原版 0x40d5d0）。
 * 原版遇到 0x40d7e0 判定失败的格子会停在那个方向；那是高度检查，在现有地图上永远通过（binary-formats §5.1），所以这里不阻挡。
 */
export function castCells(board: Board, at: Cell, [lo, hi]: [number, number], shape?: SkillDef['targetShape']): Cell[] {
  if (shape === 'diamond') {
    const cells: Cell[] = [];
    for (let dy = -hi; dy <= hi; dy++) for (let dx = -hi + Math.abs(dy); dx <= hi - Math.abs(dy); dx++) {
      if (Math.abs(dx) + Math.abs(dy) >= lo && board.inBounds(at.x + dx, at.y + dy)) cells.push({ x: at.x + dx, y: at.y + dy });
    }
    return cells;
  }
  const out: Cell[] = [];
  if (lo === 0) out.push({ x: at.x, y: at.y });
  for (const d of shape === 'eight' ? [...DIRS, ...DIAGONALS] : DIRS)
    for (let k = Math.max(1, lo); k <= hi; k++) {
      const x = at.x + d.x * k, y = at.y + d.y * k;
      if (board.inBounds(x, y)) out.push({ x, y });
    }
  return out;
}

/** 四个斜方向（targetShape 'eight' 用） */
const DIAGONALS = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }];

/** 穿透技（SkillDef.pierce）的直线长度：至少 area 格；装备射程让施放点更远时延长到施放点 */
export function pierceLength(from: Cell, s: Pick<SkillDef, 'area'>, at: Cell): number {
  return Math.max(1, s.area, Math.abs(at.x - from.x) + Math.abs(at.y - from.y));
}

/**
 * 技能的作用范围（原版 0x408b10 按类型分派，跳转表 0x408b94）：
 * - 0、5、6、10：从施放点沿施放方向的一条线，长 size 格（0x40cf90）
 * - 1：从施放点沿施放方向展开的扇形，第 i 行（从 0 数）向两侧各 floor(i/2) 格，共 size 行（0x40d330）
 * - 2 迴旋技：施放者四周 4 格（原版的命中段带 0–3 四个方向；推测）；选在第 k 格（射程大于 1 时）就打四个方向的第 k 格【新】
 * - 12 周身技：周围 8 格；13 横扫：面前三格（八向选点斜放时为施放点及其朝施放者的横、竖两格）；14 前方长方形：宽 3、长 size；15 前冲：正前、前两格及左右前方四格；16 三岔：身前一格为柄，再向前展开三条各 size 格的射线；17 倒锥：近宽远窄，size 行【新】
 * - 其余（3、4、7、8、9、11）：以施放点为中心的菱形，曼哈顿距离 < size；size 0 只含施放点（0x40cde0）
 */
export function areaCells(board: Board, from: Cell, s: SkillDef, at: Cell): Cell[] {
  const dir = DIRS[facingTowards(from, at, 0)];
  const out: Cell[] = [];
  const add = (x: number, y: number) => board.inBounds(x, y) && out.push({ x, y });
  const size = Math.max(1, s.area);
  if (s.areaPattern) {
    const side = { x: -dir.y, y: dir.x };
    for (const [x,y] of s.areaPattern) add(at.x + side.x*x + dir.x*y, at.y + side.y*x + dir.y*y);
    return out;
  }
  if (s.pierce) {
    for (let i = 1; i <= pierceLength(from, s, at); i++) add(from.x + dir.x * i, from.y + dir.y * i);
    return out;
  }
  switch (s.type) {
    case 0:
    case 5:
    case 6:
    case 10: {
      // 八向选点的技能选在斜线上时，线也斜着走（武龍 千軍萬馬LV3/LV4，负责人 2026-11-22）
      const dx = at.x - from.x, dy = at.y - from.y;
      const step = s.targetShape === 'eight' && dx && Math.abs(dx) === Math.abs(dy) ? { x: Math.sign(dx), y: Math.sign(dy) } : dir;
      for (let i = 0; i < size; i++) add(at.x + step.x * i, at.y + step.y * i);
      break;
    }
    case 1:
      for (let i = 0; i < size; i++) {
        const cx = at.x + dir.x * i, cy = at.y + dir.y * i;
        for (let j = -Math.floor(i / 2); j <= Math.floor(i / 2); j++) add(cx + dir.y * j, cy + dir.x * j);
      }
      break;
    case 2: {
      // 射程 1–2 的迴旋技（顾大嫂 母大虫扑食）：选第几格就打四个方向的第几格，不连带近的那圈（负责人 2026-11-24）；射程 1 的照旧打身边四格
      const k = Math.max(1, Math.abs(at.x - from.x) + Math.abs(at.y - from.y));
      for (const d of DIRS) add(from.x + d.x * k, from.y + d.y * k);
      break;
    }
    case 12:
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) add(at.x + dx, at.y + dy);
      break;
    case 13: {
      // 八向选点（林沖 懷璧其罪LV3/LV4，负责人 2026-11-24）斜放时：施放点加上它朝施放者那边的横、竖两格，
      // 相当于把「左前、正前、右前」三格转 45°（选紧挨的斜格 = 正前、斜前、侧面三格）
      const dx = at.x - from.x, dy = at.y - from.y;
      if (s.targetShape === 'eight' && dx && Math.abs(dx) === Math.abs(dy)) {
        add(at.x, at.y);
        add(at.x - Math.sign(dx), at.y);
        add(at.x, at.y - Math.sign(dy));
        break;
      }
      for (let j = -1; j <= 1; j++) add(at.x + dir.y * j, at.y + dir.x * j);
      break;
    }
    case 14: {
      // 默认从身前一格开始；指定target时，选中格是第一排中心，向前延伸。
      const origin = s.areaOrigin === 'target' ? at : from;
      const first = s.areaOrigin === 'target' ? 0 : 1;
      for (let i = first; i < first + size; i++)
        for (let j = -1; j <= 1; j++) add(origin.x + dir.x * i + dir.y * j, origin.y + dir.y * i + dir.x * j);
      break;
    }
    case 17:
      // 倒锥形：从身前第一排起，半宽为 size - depth，逐排收窄到一点。
      for (let i = 1; i <= size; i++)
        for (let j = -(size - i); j <= size - i; j++) add(from.x + dir.x * i + dir.y * j, from.y + dir.y * i + dir.x * j);
      break;
    case 16:
      // 身前一格为柄，原三条射线整体前移一格，形成三叉形。
      add(from.x + dir.x, from.y + dir.y);
      for (let i = 1; i <= size; i++)
        for (const j of [-i, 0, i]) add(from.x + dir.x * (i + 1) + dir.y * j, from.y + dir.y * (i + 1) + dir.x * j);
      break;
    case 15:
      // 正前、前两格，以及第一排的左前和右前；不含自己、身后或更远处。
      add(from.x + dir.x, from.y + dir.y);
      add(from.x + dir.x * 2, from.y + dir.y * 2);
      for (const j of [-1, 1]) add(from.x + dir.x + dir.y * j, from.y + dir.y + dir.x * j);
      break;
    default: {
      const r = s.area;
      if (r <= 0) add(at.x, at.y);
      for (let dy = -r + 1; dy < r; dy++)
        for (let dx = -r + 1 + Math.abs(dy); dx < r - Math.abs(dy); dx++) add(at.x + dx, at.y + dy);
    }
  }
  return out;
}

/**
 * 范围衰减，返回把衰减并进 damageScale 的技能；没有衰减就原样返回。from 是施放者所在格（决定扇形朝向，同 areaCells）。
 * - 扇形按行（SkillDef.rowFalloff，萬夫莫敵）：目标在扇形第几行（落点那行为 0）；
 * - 按层（SkillDef.ringFalloff，母大虫旋刀）：离施放点横、竖较大的距离，第 1 层不衰减。
 */
export function falloffSkill(s: SkillDef, from: Cell, at: Cell, t: Cell): SkillDef {
  let f = 1;
  if (s.rowFalloff && s.type === 1) {
    const dir = DIRS[facingTowards(from, at, 0)];
    f = 1 - Math.max(0, (t.x - at.x) * dir.x + (t.y - at.y) * dir.y) * s.rowFalloff;
  } else if (s.ringFalloff) {
    f = 1 - Math.max(0, Math.max(Math.abs(t.x - at.x), Math.abs(t.y - at.y)) - 1) * s.ringFalloff;
  }
  return f < 1 ? { ...s, damageScale: (s.damageScale ?? 1) * Math.max(0, f) } : s;
}

/**
 * 技能菜单里每个技能下面的简略加成【新】（负责人 2026-11-13）：威力、命中修正、必杀修正、中毒率、昏迷率，
 * 如"威+25 命+40 必+50 毒20% 昏10%"；为 0 的项不显示，减益显示负数（"命-10"）。
 * 命中修正显示技能数据里的原值，不换算成实际的命中倍数。回复技 / 集气技的威力是回复除数，显示成"回体1/4""回气1/2"。
 */
export function skillBonusText(s: SkillDef): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const parts: string[] = [];
  if (isSupportSkill(s)) {
    if (s.power > 0) parts.push(`${isAllyChargeSkill(s) ? '友方回气' : isChargeSkill(s) ? '回气' : '回体'}1/${s.power}`);
  } else if (s.power) parts.push(`威${sign(s.power)}`);
  if (s.hitMod) parts.push(`命${sign(s.hitMod)}`);
  if (s.critMod) parts.push(`必${sign(s.critMod)}`);
  if (s.poison) parts.push(`毒${s.poison}%`);
  if (s.stun) parts.push(`昏${s.stun}%`);
  for (const b of s.selfBuffs ?? []) parts.push(`${buffName(b.stat).replace('每回合', '')}+${b.value}·${b.turns}回合`);
  if (s.healRegen) parts.push(`持续回体1/${s.healRegen.divisor}·${s.healRegen.turns}回合`);
  if (s.cure) parts.push('解毒·解昏迷');
  return parts.join(' ');
}

/** 技能类型标签【新】（负责人 2026-11-22）：技能菜单里加成那一行下面的彩色小标签 */
export type SkillTag = '回旋' | '单体' | '远程' | '范围' | '回气' | '回复' | '增益' | '友方' | '无目标';

const openBoard = { inBounds: () => true } as unknown as Board;

/**
 * 从技能数据推导标签（所有技能，含扩展包、关卡临时技能都自动有）：
 * - 回气：集气 / 援气（类型 8）；回复：回复体力（类型 9 / 11）
 * - 回旋：以施放者自身为中心（迴旋技类型 2、施放距离 0 的伤害技）
 * - 远程：能在 2 格以外施放（施放距离上限 ≥ 2），或遠程技（类型 10）、穿透技
 * - 范围 / 单体：在空地上按作用范围算格数，多于 1 格为范围，否则单体；回旋技不再另标范围
 * 「无目标」是当下状态，由界面按范围内有没有目标另加。
 */
export function skillTags(s: SkillDef): SkillTag[] {
  const tags: SkillTag[] = [];
  const from = { x: 0, y: 0 };
  const self = s.type === 2 || s.rangeMax <= 0;
  const at = self ? from : { x: 0, y: -Math.max(1, s.rangeMin) };
  const cells = areaCells(openBoard, from, s, at).length;
  // 增益：带限时增益（含持续回体）；友方：能对相邻队友用（给队友加增益 / 援气）【新】（负责人 2026-11-26）
  const buffTag: SkillTag[] = [...(s.selfBuffs?.length || s.healRegen ? ['增益' as const] : []), ...(s.buffAlly || isAllyChargeSkill(s) ? ['友方' as const] : [])];
  if (isStanceSkill(s)) return buffTag;
  if (isChargeSkill(s)) return ['回气', ...buffTag];
  if (isHealSkill(s)) tags.push('回复');
  else if (self) tags.push('回旋');
  if (!isSupportSkill(s) && (s.type === 10 || s.pierce || s.rangeMax >= 2)) tags.push('远程');
  if (!tags.includes('回旋')) tags.push(cells > 1 ? '范围' : '单体');
  return [...tags, ...buffTag];
}
