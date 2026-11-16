// 技能：习得、施放距离、范围形状（docs/game-design.md §6；原版 EXE 0x408a80、0x408ae0、0x408b10）。
import type { Board, Cell } from './board.ts';
import type { GameData, SkillDef } from './data.ts';
import { attackRange, attackSkill, DIRS, facingTowards, type Unit } from './unit.ts';

/** 集气 / 援气：回复自身或指定队友的气力。 */
export const isChargeSkill = (s: SkillDef) => s.type === 8;
/** 援助回气与自身集气分开，避免回合终了或 AI 把援助当成给自己回气。 */
export const isAllyChargeSkill = (s: SkillDef) => isChargeSkill(s) && s.chargeTarget === 'ally';
export const isSelfChargeSkill = (s: SkillDef) => isChargeSkill(s) && !isAllyChargeSkill(s);
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
 * 分级技能（LV1–3）只保留已习得的最高一级。
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
  return [...best.values()];
}

/** 这一级新领悟的技能（原版升级时 0x406a89 逐项比较习得等级 == 新等级） */
export function skillsLearnedAt(u: Unit, data: GameData, level: number): SkillDef[] {
  return (data.classes[u.classId]?.skills ?? []).slice(1).filter((s) => !s.hidden && s.learnLevel === level);
}

/** 施放距离 [下限, 上限]。普通攻击沿用 attackRange；其它技能读子项 +12/+13，射程大于 0 的再加装备射程（原版 0x408ae0 加 unit+0x88） */
export function castRange(u: Unit, s: SkillDef, data: GameData): [number, number] {
  if (s === attackSkill(u, data)) return attackRange(u, data);
  // 援气固定相邻一格；四格前冲技只选相邻方向，不由武器射程扩大施放点。
  if (isAllyChargeSkill(s) || s.type === 15) return [s.rangeMin, s.rangeMax];
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
  for (const d of DIRS)
    for (let k = Math.max(1, lo); k <= hi; k++) {
      const x = at.x + d.x * k, y = at.y + d.y * k;
      if (board.inBounds(x, y)) out.push({ x, y });
    }
  return out;
}

/** 穿透技（SkillDef.pierce）的直线长度：至少 area 格；装备射程让施放点更远时延长到施放点 */
export function pierceLength(from: Cell, s: Pick<SkillDef, 'area'>, at: Cell): number {
  return Math.max(1, s.area, Math.abs(at.x - from.x) + Math.abs(at.y - from.y));
}

/**
 * 技能的作用范围（原版 0x408b10 按类型分派，跳转表 0x408b94）：
 * - 0、5、6、10：从施放点沿施放方向的一条线，长 size 格（0x40cf90）
 * - 1：从施放点沿施放方向展开的扇形，第 i 行（从 0 数）向两侧各 floor(i/2) 格，共 size 行（0x40d330）
 * - 2 迴旋技：施放者四周 4 格（原版的命中段带 0–3 四个方向；推测）
 * - 12 周身技：周围 8 格；13 横扫：面前三格；14 前方长方形：宽 3、长 size；15 前冲：正前、前两格及左右前方四格【新】
 * - 其余（3、4、7、8、9、11）：以施放点为中心的菱形，曼哈顿距离 < size；size 0 只含施放点（0x40cde0）
 */
export function areaCells(board: Board, from: Cell, s: SkillDef, at: Cell): Cell[] {
  const dir = DIRS[facingTowards(from, at, 0)];
  const out: Cell[] = [];
  const add = (x: number, y: number) => board.inBounds(x, y) && out.push({ x, y });
  const size = Math.max(1, s.area);
  if (s.pierce) {
    for (let i = 1; i <= pierceLength(from, s, at); i++) add(from.x + dir.x * i, from.y + dir.y * i);
    return out;
  }
  switch (s.type) {
    case 0:
    case 5:
    case 6:
    case 10:
      for (let i = 0; i < size; i++) add(at.x + dir.x * i, at.y + dir.y * i);
      break;
    case 1:
      for (let i = 0; i < size; i++) {
        const cx = at.x + dir.x * i, cy = at.y + dir.y * i;
        for (let j = -Math.floor(i / 2); j <= Math.floor(i / 2); j++) add(cx + dir.y * j, cy + dir.x * j);
      }
      break;
    case 2:
      for (const d of DIRS) add(from.x + d.x, from.y + d.y);
      break;
    case 12:
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) add(at.x + dx, at.y + dy);
      break;
    case 13:
      for (let j = -1; j <= 1; j++) add(at.x + dir.y * j, at.y + dir.x * j);
      break;
    case 14:
      // 前方长方形：从施放者身前一格起往前 size 行，每行宽 3 格
      for (let i = 1; i <= size; i++)
        for (let j = -1; j <= 1; j++) add(from.x + dir.x * i + dir.y * j, from.y + dir.y * i + dir.x * j);
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
  return parts.join(' ');
}
