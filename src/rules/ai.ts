// 敌方与友军 AI。按原版 EXE 0x407930 的模式分派（docs/game-design.md §8）。
import { key, type Cell } from './board.ts';
import { previewAttack } from './combat.ts';
import { isHealing, itemOf, type SkillDef } from './data.ts';
import type { Battle } from './battle.ts';
import { castRange, isChargeSkill, isHealSkill, isSupportSkill, learnedSkills } from './skills.ts';
import { attackRange, attackSkill, dist, type Unit } from './unit.ts';

export interface AiPlan {
  path?: Cell[]; // 含起点
  /** 主要目标（施放点上的单位） */
  target?: Unit;
  skill?: SkillDef;
  /** 施放点 */
  cell?: Cell;
  healSlot?: number;
}

interface Option {
  cell: Cell;
  cost: number;
  skill: SkillDef;
  at: Cell;
  target: Unit;
  primary: boolean;
  kills: number;
  expected: number;
}

/** 原版默认 AI 追的是单位表里第一个敌对单位（EXE 0x40d930），即 ACT 中排在最前的敌人 */
export function primaryFoe(b: Battle, u: Unit): Unit | undefined {
  return b.foesOf(u)[0];
}

/**
 * 在移动范围内找攻击位置与招式。原版（EXE 0x40d850）只按方向和距离逐格找到能打的位置，不挑目标；
 * 这里【新】：在普通攻击和气力够用的攻击技能里挑——先打主要目标（primaryFoe），其次击倒人数多的，
 * 再次少走路，最后期望伤害高的（技能按"期望伤害 − 气力消耗 / 2"折算，免得为一点伤害耗光气力）。
 */
function bestAttack(b: Battle, u: Unit, only?: Unit): AiPlan | null {
  const reach = b.reachOf(u, u.stats.move);
  const basic = attackSkill(u, b.data);
  const skills = [basic, ...learnedSkills(u, b.data).filter((s) => !isSupportSkill(s) && s.mpCost <= u.mp)];
  const main = primaryFoe(b, u);
  let best: Option | null = null;
  for (const n of reach.values()) {
    const at = { x: n.x, y: n.y };
    const self = { ...u, x: n.x, y: n.y };
    for (const skill of skills)
      for (const cell of b.skillCells(u, skill, at)) {
        const hit = b.affected(u, skill, cell, at);
        if (!hit.length || (only && !hit.includes(only))) continue;
        let expected = 0, kills = 0;
        for (const t of hit) {
          const p = previewAttack(self, t, skill);
          expected += (p.hit / 100) * Math.min(t.hp, p.damage);
          if (p.damage >= t.hp) kills++;
        }
        if (skill !== basic) expected -= skill.mpCost / 2;
        const target = b.unitAt(cell.x, cell.y) && hit.includes(b.unitAt(cell.x, cell.y)!) ? b.unitAt(cell.x, cell.y)! : hit[0];
        const o: Option = { cell, cost: n.cost, skill, at, target, primary: !!main && hit.includes(main), kills, expected };
        if (!best || better(o, best)) best = o;
      }
  }
  return best ? { path: b.pathOf(reach, best.at), target: best.target, skill: best.skill, cell: best.cell } : null;
}

function better(a: Option, b: Option) {
  if (a.primary !== b.primary) return a.primary;
  if (a.kills !== b.kills) return a.kills > b.kills;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.expected > b.expected;
}

/** 朝目标移动：在移动范围内取离目标地形距离最近的格子（stopAt：到这个距离就停，如跟随时停在相邻格） */
function approach(b: Battle, u: Unit, goals: Cell[], stopAt = 1): AiPlan {
  if (!goals.length) return {};
  const field = b.board.distanceField(goals);
  const reach = b.reachOf(u, u.stats.move);
  const w = b.board.width;
  let best: { x: number; y: number; cost: number } | null = null;
  let bestD = field[u.y * w + u.x];
  if (bestD <= stopAt) return {};
  for (const n of reach.values()) {
    const d = Math.max(stopAt, field[n.y * w + n.x]);
    if (d < bestD || (d === bestD && best && n.cost < best.cost)) {
      bestD = d;
      best = n;
    }
  }
  return best ? { path: b.pathOf(reach, best) } : {};
}

function healIfLow(b: Battle, u: Unit): AiPlan | null {
  if (u.hp >= u.stats.maxHp / 5) return null;
  const slot = u.slots.findIndex((id) => isHealing(itemOf(b.data, id)) && itemOf(b.data, id)!.healHp !== 0);
  return slot >= 0 ? { healSlot: slot } : null;
}

/** 体力低于一半时用回复技（原地施放）【新】 */
function healSkill(b: Battle, u: Unit): AiPlan | null {
  if (u.hp >= u.stats.maxHp / 2) return null;
  const s = learnedSkills(u, b.data).find((k) => isHealSkill(k) && k.mpCost <= u.mp);
  const cell = s && b.skillTargets(u, s).find((c) => b.affected(u, s, c).includes(u));
  return s && cell ? { skill: s, cell } : null;
}

/** 打不到人时：气力不到一半就在走到的位置用集气技【新】 */
function withCharge(b: Battle, u: Unit, plan: AiPlan): AiPlan {
  if (plan.skill || u.mp >= u.stats.maxMp / 2) return plan;
  const s = learnedSkills(u, b.data).find(isChargeSkill);
  if (!s) return plan;
  const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
  return { ...plan, skill: s, cell: { x: end.x, y: end.y } };
}

function defaultPlan(b: Battle, u: Unit): AiPlan {
  const heal = healIfLow(b, u) ?? healSkill(b, u);
  if (heal) return heal;
  const atk = bestAttack(b, u);
  if (atk) return atk;
  const main = primaryFoe(b, u);
  return withCharge(b, u, approach(b, u, main ? [main] : []));
}

function foesWithin(b: Battle, u: Unit, radius: number) {
  return b.foesOf(u).filter((t) => dist(u, t) <= radius);
}

/**
 * 迎击/埋伏的警戒半径（原版 0x407fa0 → 0x40d680，曼哈顿距离 0x41e470）：
 * 剩余移动力（+0x8c）+ 当前技能射程上限（+0x80）+ 装备射程（+0x88）+ 技能范围大小（+0x86，子项 +16）。
 * 原版的"当前技能"由 0x407dd0 先选好；这里取所有气力够用的攻击技能里能打到最远的那个。
 */
export function alertRadius(b: Battle, u: Unit): number {
  const skills = [attackSkill(u, b.data), ...learnedSkills(u, b.data)].filter(
    (s): s is SkillDef => !!s && !isSupportSkill(s) && s.mpCost <= u.mp,
  );
  const reach = Math.max(0, ...skills.map((s) => castRange(u, s, b.data)[1] + s.area));
  return u.stats.move + reach;
}

export function planAi(b: Battle, u: Unit): AiPlan {
  const [, hi] = attackRange(u, b.data);
  const target = u.ai.target ? b.unitByChar(u.ai.target) : undefined;
  switch (u.ai.mode) {
    case 1:
    case 10: // 追击指定单位
      if (!target) return defaultPlan(b, u);
      return bestAttack(b, u, target) ?? approach(b, u, [target]);
    case 2:
    case 6: {
      // 迎击：警戒半径内有敌人才行动，否则原地待命（半径见 alertRadius）
      const near = foesWithin(b, u, alertRadius(b, u));
      if (!near.length) return withCharge(b, u, {});
      return healSkill(b, u) ?? bestAttack(b, u) ?? withCharge(b, u, approach(b, u, near));
    }
    case 3: {
      // 固守：只攻击"移动 + 射程"内的敌人，打不到就不动
      if (!foesWithin(b, u, u.stats.move + hi).length) return {};
      return bestAttack(b, u) ?? {};
    }
    case 4: {
      // 先走到指定点，到达后转为模式 2
      if (u.x === u.ai.point.x && u.y === u.ai.point.y) {
        u.ai.mode = 2;
        return {};
      }
      return approach(b, u, [u.ai.point], 0);
    }
    case 5: // 跟随指定单位，不攻击
      return target ? approach(b, u, [target], 1) : {};
    case 8: // 原地不动
      return {};
    default: // 0、7（被事件放出后）、9：原版的默认行为
      return defaultPlan(b, u);
  }
}

export const cellKey = (c: Cell) => key(c.x, c.y);
