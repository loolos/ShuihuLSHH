// 技能：习得、施放距离、范围形状（docs/game-design.md §6；原版 EXE 0x408a80、0x408ae0、0x408b10）。
import type { Board, Cell } from './board.ts';
import type { GameData, SkillDef } from './data.ts';
import { attackRange, attackSkill, DIRS, facingTowards, type Unit } from './unit.ts';

/** 集气技：回复自己的气力 */
export const isChargeSkill = (s: SkillDef) => s.type === 8;
/** 回复技：回复范围内我方的体力（类型 9 与 11 的区别还没解开，都按回复体力处理【待核】） */
export const isHealSkill = (s: SkillDef) => s.type === 9 || s.type === 11;
/** 不造成伤害的技能 */
export const isSupportSkill = (s: SkillDef) => isChargeSkill(s) || isHealSkill(s);

/** "千軍萬馬LV2" → "千軍萬馬" */
export const skillBaseName = (name: string) => name.replace(/\s*LV\s*\d+$/i, '');

/**
 * 已习得、可以从技能菜单使用的技能（不含第一项普通攻击）。
 * 习得条件：习得等级 ≤ 当前等级，且不是隐藏技（隐藏技要古武術祕笈，M-C 后段再做）。
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
  const lo = s.rangeMin, hi = s.rangeMax;
  return [lo, hi > 0 ? Math.max(lo, hi + u.stats.rangeBonus) : hi];
}

/**
 * 可以选作施放点的格子：沿 4 个方向直线，距离在 [下限, 上限]；下限为 0 时含自身（原版 0x40d5d0）。
 * 原版遇到 0x40d7e0 判定失败的格子会停在那个方向；那是高度检查，在现有地图上永远通过（binary-formats §5.1），所以这里不阻挡。
 */
export function castCells(board: Board, at: Cell, [lo, hi]: [number, number]): Cell[] {
  const out: Cell[] = [];
  if (lo === 0) out.push({ x: at.x, y: at.y });
  for (const d of DIRS)
    for (let k = Math.max(1, lo); k <= hi; k++) {
      const x = at.x + d.x * k, y = at.y + d.y * k;
      if (board.inBounds(x, y)) out.push({ x, y });
    }
  return out;
}

/**
 * 技能的作用范围（原版 0x408b10 按类型分派，跳转表 0x408b94）：
 * - 0、5、6、10：从施放点沿施放方向的一条线，长 size 格（0x40cf90）
 * - 1：从施放点沿施放方向展开的扇形，第 i 行（从 0 数）向两侧各 floor(i/2) 格，共 size 行（0x40d330）
 * - 2 迴旋技：施放者四周 4 格（原版的命中段带 0–3 四个方向；推测）
 * - 其余（3、4、7、8、9、11）：以施放点为中心的菱形，曼哈顿距离 < size；size 0 只含施放点（0x40cde0）
 */
export function areaCells(board: Board, from: Cell, s: SkillDef, at: Cell): Cell[] {
  const dir = DIRS[facingTowards(from, at, 0)];
  const out: Cell[] = [];
  const add = (x: number, y: number) => board.inBounds(x, y) && out.push({ x, y });
  const size = Math.max(1, s.area);
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
    default: {
      const r = s.area;
      if (r <= 0) add(at.x, at.y);
      for (let dy = -r + 1; dy < r; dy++)
        for (let dx = -r + 1 + Math.abs(dy); dx < r - Math.abs(dy); dx++) add(at.x + dx, at.y + dy);
    }
  }
  return out;
}
