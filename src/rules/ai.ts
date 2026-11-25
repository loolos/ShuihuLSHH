// 敌方与友军 AI。按原版 EXE 0x407930 的模式分派（docs/game-design.md §8）。
import { key, type Cell } from './board.ts';
import { previewAttack } from './combat.ts';
import { isHealing, itemOf, type SkillDef } from './data.ts';
import { forcedExtra, type Battle } from './battle.ts';
import { castRange, isAllyChargeSkill, isSelfChargeSkill, isHealSkill, isSupportSkill, learnedSkills } from './skills.ts';
import { attackRange, attackSkill, dist, type Unit } from './unit.ts';

export interface AiPlan {
  path?: Cell[]; // 含起点
  /** 主要目标（施放点上的单位） */
  target?: Unit;
  skill?: SkillDef;
  /** 施放点 */
  cell?: Cell;
  healSlot?: number;
  /** 移动后休息（跟随型 AI 血不满时）【新】 */
  rest?: boolean;
}

interface Option {
  cell: Cell;
  skill: SkillDef;
  at: Cell;
  target: Unit;
  count: number;
  pref: boolean;
  kills: number;
  expected: number;
}

/** 每次攻击决策抽一次策略；概率不按候选站位或技能重复抽。 */
export const LEGACY_ATTACK_PERCENT = 30;

/** 打不到人时仍按脚本模式追击单位表中的首个敌对单位。 */
export function primaryFoe(b: Battle, u: Unit): Unit | undefined {
  return b.aiFoesOf(u)[0];
}

interface Choice { best: Option | null; ties: number }

/** 蓄水池抽样：完全同分的站位/技能等概率选，不保存全部候选方案。 */
function consider(b: Battle, choice: Choice, option: Option, compare: (a: Option, c: Option) => number) {
  const score = choice.best ? compare(option, choice.best) : 1;
  if (score > 0) { choice.best = option; choice.ties = 1; }
  else if (score === 0 && b.rng.int(++choice.ties) === 0) choice.best = option;
}

/**
 * 扫描所有合法移动落点、已学会且气力足够的攻击技和施放点。
 * 30%：预计击倒人数 → 期望伤害 → 目标体力低 → 初始距离近。
 * 70%：范围攻击覆盖人数 → 期望总伤害，同分随机；仅单体可用时先等概率抽目标，再选高伤招式。
 * 治疗、跟随、警戒及脚本指定目标等约束仍由外层模式控制。standOk：只考虑这些出手位置。
 */
export function bestAttack(b: Battle, u: Unit, only?: Unit, budget = u.stats.move, standOk?: (c: Cell) => boolean): AiPlan | null {
  const legacy = b.rng.chance(LEGACY_ATTACK_PERCENT);
  const reach = b.reachOf(u, budget);
  const basic = attackSkill(u, b.data);
  const skills = [basic, ...learnedSkills(u, b.data).filter(s => !isSupportSkill(s) && !s.drug && s.mpCost <= u.mp)];
  const foes = b.aiFoesOf(u);
  const occ = b.occupancy(u);
  const loneVolley: Choice = { best: null, ties: 0 };
  let bestLegacy: Option | null = null;
  const bestArea: Choice = { best: null, ties: 0 };
  const singles = new Map<number, Choice>();
  let hasArea = false;
  const byDamage = (a: Option, c: Option) => a.expected - c.expected;
  const byArea = (a: Option, c: Option) => a.count - c.count || byDamage(a, c);
  const byLegacy = (a: Option, c: Option) => a.kills - c.kills || byDamage(a, c)
    || c.target.hp - a.target.hp || dist(u, c.target) - dist(u, a.target) || Number(a.pref) - Number(c.pref);

  for (const n of reach.values()) {
    if (standOk && !standOk(n)) continue; // 只从这些格子出手（吃鸡：不站到毒圈外）
    const at = { x: n.x, y: n.y };
    const self = b.towerSelf({ ...u, x: n.x, y: n.y });
    for (const skill of skills)
      for (const cell of b.skillCells(u, skill, at)) {
        // 远射技选点多：落点附近（范围大小 + 1 以内）没有敌人就跳过
        if (skill.volley && !foes.some((t) => dist(t, cell) <= Math.max(1, skill.area) + 1)) continue;
        const hit = b.affected(u, skill, cell, at, occ);
        // 绑住的人一律不碰：落点会波及被绑的人就不选【新】
        if (!hit.length || (only && !hit.includes(only)) || hit.some((t) => b.isBound(t))) continue;
        // 门卫不受墙外的人伤害【新】（三打祝家庄）：从墙外打只打得着门卫的落点不选
        if (hit.every((t) => b.walled(t, at))) continue;
        let expected = 0, kills = 0;
        for (const t of hit) {
          if (b.walled(t, at)) continue;
          const p = previewAttack(self, t, skill);
          // 含命中、必杀概率，并按剩余体力截断；不预掷命中，不因耗气或少走路压过人数/伤害。
          expected += (p.hit / 100) * ((1 - p.crit / 100) * Math.min(t.hp, p.damage) + (p.crit / 100) * Math.min(t.hp, p.critDamage));
          if (p.hit > 0 && p.damage >= t.hp) kills++;
        }
        const onCell = b.unitAt(cell.x, cell.y);
        const target = onCell && hit.includes(onCell) ? onCell : hit[0];
        const area = !legacy && b.skillArea(u, skill, cell, at).length > 1;
        const o: Option = { cell, skill, at, target, count: hit.length, pref: b.prefers(u, skill), kills, expected };
        // 主线§6.6：远射技只打一个人时，必须没有其他可用攻击才采用。
        if (skill.volley && hit.length < 2) {
          consider(b, loneVolley, o, legacy ? byLegacy : byArea);
          continue;
        }
        if (legacy) {
          if (!bestLegacy || byLegacy(o, bestLegacy) > 0) bestLegacy = o;
        } else {
          consider(b, bestArea, o, byArea);
          if (area && !hasArea) { hasArea = true; singles.clear(); }
          if (!hasArea) {
            const choice = singles.get(target.uid) ?? { best: null, ties: 0 };
            singles.set(target.uid, choice);
            consider(b, choice, o, byDamage);
          }
        }
      }
  }
  let best = bestLegacy;
  if (!legacy) {
    // 按角色去重后再抽，站位多、可用技能多不会提高该目标被选中的概率。
    best = hasArea ? bestArea.best : singles.size ? [...singles.values()][b.rng.int(singles.size)].best : null;
  }

  best ??= loneVolley.best;
  return best ? { path: b.pathOf(reach, best.at), target: best.target, skill: best.skill, cell: best.cell } : null;
}

/** 朝目标移动：在移动范围内取离目标地形距离最近的格子（stopAt：到这个距离就停，如跟随时停在相邻格） */
function approach(b: Battle, u: Unit, goals: Cell[], stopAt = 1, budget = u.stats.move): AiPlan {
  if (!goals.length) return {};
  const field = b.fieldFor(u, goals);
  const reach = b.reachOf(u, budget);
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
export function healSkill(b: Battle, u: Unit): AiPlan | null {
  if (u.hp >= u.stats.maxHp / 2) return null;
  const s = learnedSkills(u, b.data).find((k) => isHealSkill(k) && k.mpCost <= u.mp);
  const cell = s && b.skillTargets(u, s).find((c) => b.affected(u, s, c).includes(u));
  return s && cell ? { skill: s, cell } : null;
}

/** 打不到人时：气力不到一半就在走到的位置用集气技【新】 */
export function withCharge(b: Battle, u: Unit, plan: AiPlan): AiPlan {
  if (plan.skill || u.mp >= u.stats.maxMp / 2) return plan;
  const s = learnedSkills(u, b.data).find(isSelfChargeSkill);
  if (!s) return plan;
  const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
  return { ...plan, skill: s, cell: { x: end.x, y: end.y } };
}

function defaultPlan(b: Battle, u: Unit): AiPlan {
  const heal = healIfLow(b, u) ?? healSkill(b, u);
  if (heal) return heal;
  // 相邻队友严重缺气时先援气；自身回气仍只选择自身集气技能。
  const aid = allyChargePlan(b, u);
  if (aid) return aid;
  const atk = bestAttack(b, u);
  if (atk) return atk;
  const main = primaryFoe(b, u);
  return withCharge(b, u, approach(b, u, main ? [main] : []));
}

function allyChargePlan(b: Battle, u: Unit): AiPlan | null {
  let best: { skill: SkillDef; cell: Cell; restored: number } | null = null;
  for (const skill of learnedSkills(u, b.data).filter((s) => isAllyChargeSkill(s) && s.mpCost <= u.mp)) {
    for (const cell of b.skillTargets(u, skill)) {
      const t = b.affected(u, skill, cell)[0];
      if (!t || t.mp >= t.stats.maxMp / 3) continue;
      const restored = Math.min(t.stats.maxMp - t.mp, Math.floor(t.stats.maxMp / Math.max(1, skill.power)));
      if (restored > 0 && (!best || restored > best.restored)) best = { skill, cell, restored };
    }
  }
  return best ? { skill: best.skill, cell: best.cell } : null;
}

function foesWithin(b: Battle, u: Unit, radius: number) {
  return b.aiFoesOf(u).filter((t) => dist(u, t) <= radius);
}

/**
 * 迎击/埋伏的警戒半径（原版 0x407fa0 → 0x40d680，曼哈顿距离 0x41e470）：
 * 剩余移动力（+0x8c）+ 当前技能射程上限（+0x80）+ 装备射程（+0x88）+ 技能范围大小（+0x86，子项 +16）。
 * 原版的"当前技能"由 0x407dd0 先选好；这里取所有气力够用的攻击技能里能打到最远的那个。
 */
export function alertRadius(b: Battle, u: Unit): number {
  const skills = [attackSkill(u, b.data), ...learnedSkills(u, b.data)].filter(
    (s): s is SkillDef => !!s && !isSupportSkill(s) && !s.volley && !s.drug && s.mpCost <= u.mp,
  );
  const reach = Math.max(0, ...skills.map((s) => b.onTower(u, castRange(u, s, b.data))[1] + s.area));
  return u.stats.move + reach;
}

export function planAi(b: Battle, u: Unit): AiPlan {
  if (b.spectators.has(u.uid)) return {};
  // 【新】逃窜（怒破何观察放火，负责人 2026-11-21）：在移动范围里随便挑一格乱走，不攻击、不用技能、不防御
  if (u.panicTurns) {
    const reach = b.reachOf(u, u.stats.move);
    const cells = [...reach.values()];
    return { path: b.pathOf(reach, cells[b.rng.int(cells.length)]) };
  }
  const [, hi] = b.onTower(u, attackRange(u, b.data));
  // 模式 5 跟随的 w8 = 0 是主角（角色 0）：N12 晁蓋就是这样跟着主角走的【推测：EXE 0x40c360 按角色号查找，0 也是合法角色号】。
  // 其它模式的 0 仍当"没指定"。
  const target = u.ai.target || u.ai.mode === 5 ? b.unitByChar(u.ai.target) : undefined;
  // 手下留情（rules.feint，夜走东溪村的朱仝）【新】：那个人到了警戒范围就专找他做样子打
  const feint = b.tune?.feint;
  if (feint && u.classId === feint.by && u.present) {
    const t = b.unitByChar(feint.target);
    // 走得到、打得着才去（其余时候照自己的模式，夜走东溪村的朱仝是迎击）
    if (t && t.alive && t.present && Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= alertRadius(b, u)) return bestAttack(b, u, t) ?? approach(b, u, [t]);
  }
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
    case 5: {
      // 跟随指定单位，不攻击；体力不满时走完顺便休息（负责人 2026-11-12 要求，原版没有）【新】
      // 体力满、普通移动到不了相邻格时用强行军追上去（走完本回合结束，所以不休息）（负责人 2026-11-12）【新】
      if (!target) return u.hp < u.stats.maxHp ? { rest: true } : {};
      if (u.hp < u.stats.maxHp) return { ...approach(b, u, [target], 1), rest: true };
      const plan = approach(b, u, [target], 1);
      const field = b.fieldFor(u, [target]);
      const end = plan.path?.at(-1) ?? u;
      if (field[end.y * b.board.width + end.x] <= 1) return plan;
      const forced = approach(b, u, [target], 1, u.stats.move + forcedExtra(u));
      const fEnd = forced.path?.at(-1) ?? u;
      return field[fEnd.y * b.board.width + fEnd.x] < field[end.y * b.board.width + end.x] ? forced : plan;
    }
    case 11: // 【新】驻守戒备：仅从原位攻击射程内目标，不移动追击
      return bestAttack(b, u, undefined, 0) ?? {};
    case 12: {
      // 【新】守屋：屋子（范围存在目标 / 目标点字段，见 guardRoom）里没有敌人时同模式 11；有敌人进来就转为模式 0 出战，之后一直出战
      if (!b.aiFoesOf(u).some((t) => inGuardRoom(u, t))) return bestAttack(b, u, undefined, 0) ?? {};
      u.ai.mode = 0;
      return defaultPlan(b, u);
    }
    case 13: {
      // 【新】巡逻（潜行关）：沿路线依次走，走到一个点换下一个，不攻击；目标点字段记着正要去的点
      const route = b.patrolOf(u);
      if (!route?.length) return {};
      let i = Math.max(0, route.findIndex((p) => p.x === u.ai.point.x && p.y === u.ai.point.y));
      if (u.x === route[i].x && u.y === route[i].y) i = (i + 1) % route.length;
      u.ai.point = { ...route[i] };
      return approach(b, u, [route[i]], 0);
    }
    case 14: {
      // 【新】逃跑（赌坊的赌徒）：不攻击；6 格内有敌对的人就往离所有敌对的人（按走路距离）最远的格子跑
      const foes = b.aiFoesOf(u);
      if (!foes.some((t) => Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= 6)) return {};
      const field = b.fieldFor(u, foes);
      const reach = b.reachOf(u, u.stats.move);
      const w = b.board.width;
      let best: { x: number; y: number; cost: number } | null = null;
      let bestD = field[u.y * w + u.x];
      for (const n of reach.values()) {
        const d = field[n.y * w + n.x];
        if (Number.isFinite(d) && (d > bestD || (d === bestD && best && n.cost < best.cost))) {
          bestD = d;
          best = n;
        }
      }
      return best ? { path: b.pathOf(reach, best) } : {};
    }
    case 15: {
      // 【新】保镖（三打祝家庄的宋清，负责人 2026-11-25）：跟着目标走；目标身边 4 格内有敌人，就站在目标 3 格以内出手
      if (!target) return defaultPlan(b, u);
      const near = (c: Cell) => Math.abs(c.x - target.x) + Math.abs(c.y - target.y);
      if (b.aiFoesOf(u).some((t) => near(t) <= 4)) {
        const hit = bestAttack(b, u, undefined, u.stats.move, (c) => near(c) <= 3);
        if (hit) return hit;
      }
      return approach(b, u, [target], 1);
    }
    case 8: // 原地不动
      return {};
    default: // 0、7（被事件放出后）、9：原版的默认行为
      return defaultPlan(b, u);
  }
}

/** AI 12 的屋子范围：目标点 = 左上 (x1, y1)，目标 = x2 << 8 | y2（含边界） */
export function guardRoom(u: Unit) {
  return { x1: u.ai.point.x, y1: u.ai.point.y, x2: u.ai.target >> 8, y2: u.ai.target & 0xff };
}
export function inGuardRoom(u: Unit, c: Cell): boolean {
  const r = guardRoom(u);
  return c.x >= r.x1 && c.x <= r.x2 && c.y >= r.y1 && c.y <= r.y2;
}

export const cellKey = (c: Cell) => key(c.x, c.y);
