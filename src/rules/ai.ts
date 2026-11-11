// 敌方与友军 AI。按原版 EXE 0x407930 的模式分派（docs/game-design.md §8）。
import { key, type Cell } from './board.ts';
import { previewAttack } from './combat.ts';
import { isHealing, itemOf } from './data.ts';
import type { Battle } from './battle.ts';
import { attackRange, attackSkill, dist, inAttackRange, type Unit } from './unit.ts';

export interface AiPlan {
  path?: Cell[]; // 含起点
  target?: Unit;
  healSlot?: number;
}

interface Option {
  cell: Cell;
  cost: number;
  target: Unit;
  primary: boolean;
  kill: boolean;
  expected: number;
}

/** 原版默认 AI 追的是单位表里第一个敌对单位（EXE 0x40d930），即 ACT 中排在最前的敌人 */
export function primaryFoe(b: Battle, u: Unit): Unit | undefined {
  return b.foesOf(u)[0];
}

/**
 * 在移动范围内找攻击位置。原版（EXE 0x40d850）只按方向和距离逐格找到能打的位置，不挑目标；
 * 这里【新】：先打主要目标（primaryFoe），其次能击倒的，再次少走路、期望伤害高。
 */
function bestAttack(b: Battle, u: Unit, only?: Unit): { path: Cell[]; target: Unit } | null {
  const reach = b.reachOf(u, u.stats.move);
  const range = attackRange(u, b.data);
  const skill = attackSkill(u, b.data);
  const foes = only ? [only] : b.foesOf(u);
  const main = primaryFoe(b, u);
  let best: Option | null = null;
  for (const n of reach.values())
    for (const t of foes) {
      if (!inAttackRange(n, t, range)) continue;
      const p = previewAttack({ ...u, x: n.x, y: n.y }, t, skill);
      const expected = (p.hit / 100) * p.damage;
      const o: Option = { cell: n, cost: n.cost, target: t, primary: t === main, kill: p.damage >= t.hp, expected };
      if (!best || better(o, best)) best = o;
    }
  return best ? { path: b.pathOf(reach, best.cell), target: best.target } : null;
}

function better(a: Option, b: Option) {
  if (a.primary !== b.primary) return a.primary;
  if (a.kill !== b.kill) return a.kill;
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

function defaultPlan(b: Battle, u: Unit): AiPlan {
  const heal = healIfLow(b, u);
  if (heal) return heal;
  const atk = bestAttack(b, u);
  if (atk) return atk;
  const main = primaryFoe(b, u);
  return approach(b, u, main ? [main] : []);
}

function foesWithin(b: Battle, u: Unit, radius: number) {
  return b.foesOf(u).filter((t) => dist(u, t) <= radius);
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
      // 迎击：警戒半径内有敌人才行动，否则原地待命（半径 = 移动 × 2 + 射程，推测）
      const near = foesWithin(b, u, u.stats.move * 2 + hi);
      if (!near.length) return {};
      return bestAttack(b, u) ?? approach(b, u, near);
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
