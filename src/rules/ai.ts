// 敌方与友军 AI。按原版 EXE 0x407930 的模式分派（docs/game-design.md §8）。
import { key, type Cell } from './board.ts';
import { previewAttack } from './combat.ts';
import { isHealing, itemOf, type SkillDef } from './data.ts';
import { forcedExtra, type Battle } from './battle.ts';
import { castRange, falloffSkill, isAllyChargeSkill, isRechargeSkill, isHealSkill, isStanceSkill, isSupportSkill, learnedSkills } from './skills.ts';
import { attackRange, attackSkill, dist, hostile, type Unit } from './unit.ts';
import { inZone, zoneCells, zoneDist, type FerryZone } from './ferry.ts';

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
          const p = previewAttack(self, t, falloffSkill(skill, at, cell, t));
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

/**
 * 赶路【新】（负责人 2026-11-26，先敌人、后来我方和友军也一样）：这回合打不到人、要往目标走时——
 * 体力满：强行军（多走「移动力 ÷ 2，向上取整」格，走完本回合结束），比普通移动走得更近才用；
 * 体力不满：普通移动，走完按缺得多的那样补：缺气的比例比缺体力大、又有回气技就回气，否则休息。
 * 敌方、友军、试打的我方都一样；强行军走不近时返回 null，照旧走（withCharge）。
 */
export function marchPlan(b: Battle, u: Unit, goals: Cell[]): AiPlan | null {
  if (!goals.length) return null;
  const plan = approach(b, u, goals);
  if (u.hp >= u.stats.maxHp) {
    const field = b.fieldFor(u, goals);
    const at = (p: AiPlan) => { const e = p.path?.at(-1) ?? u; return field[e.y * b.board.width + e.x]; };
    const forced = approach(b, u, goals, 1, u.stats.move + forcedExtra(u));
    return at(forced) < at(plan) ? forced : null;
  }
  const lackHp = 1 - u.hp / u.stats.maxHp;
  const lackMp = u.stats.maxMp > 0 ? 1 - u.mp / u.stats.maxMp : 0;
  const charge = learnedSkills(u, b.data).find(isRechargeSkill);
  if (charge && lackMp > lackHp) {
    const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
    return { ...plan, skill: charge, cell: { x: end.x, y: end.y } };
  }
  return { ...plan, rest: true };
}

function healIfLow(b: Battle, u: Unit): AiPlan | null {
  if (u.hp < u.stats.maxHp / 5) {
    const slot = u.slots.findIndex((id) => isHealing(itemOf(b.data, id)) && itemOf(b.data, id)!.healHp !== 0);
    if (slot >= 0) return { healSlot: slot };
  }
  const mp = mpItemSlot(b, u);
  return mp >= 0 ? { healSlot: mp } : null;
}

/** 气不到三成时包里只回气的药（包子之类，负责人 2026-11-27）；没有就 -1。敌方、友军、试打的我方都用 */
export function mpItemSlot(b: Battle, u: Unit): number {
  if (u.stats.maxMp <= 0 || u.mp >= u.stats.maxMp * 0.3) return -1;
  return u.slots.findIndex((id) => { const it = itemOf(b.data, id); return isHealing(it) && it!.healHp === 0 && it!.healMp > 0; });
}

/** 体力低于一半时用回复技（原地施放）【新】 */
export function healSkill(b: Battle, u: Unit): AiPlan | null {
  if (u.hp >= u.stats.maxHp / 2) return null;
  const s = learnedSkills(u, b.data).find((k) => isHealSkill(k) && k.mpCost <= u.mp);
  const cell = s && b.skillTargets(u, s).find((c) => b.affected(u, s, c).includes(u));
  return s && cell ? { skill: s, cell } : null;
}

/** 需要照顾的自己人：体力不到一半，或（能解的技能）中毒、昏迷（剧情绑住的不算） */
const needsHeal = (b: Battle, t: Unit, cure?: boolean) =>
  t.hp < t.stats.maxHp / 2 || (!!cure && !b.isBound(t) && (t.poisonTurns > 0 || t.stunTurns > 0));

/**
 * 回复技给自己人回血【新】（负责人 2026-11-26，§8）：移动范围内（budget）每个出手位置、每个施放点都试一遍，
 * 范围里至少有一个体力不到一半（或能解的中毒 / 昏迷）的自己人才放；按实际回得上的体力打分，体力不到 1/3 的人加倍算，
 * 能解状态的再加一点；同分少走路。波及剧情绑住的人的落点不选（解昏迷会把人放了）。
 */
export function healPlan(b: Battle, u: Unit, budget = u.stats.move): AiPlan | null {
  const skills = learnedSkills(u, b.data).filter((k) => isHealSkill(k) && k.mpCost <= u.mp);
  if (!skills.length) return null;
  // 范围里没人需要照顾就不必一格格试：自己人里没有需要照顾的直接跳过
  if (!b.active().some((t) => !hostile(u, t) && !b.spectators.has(t.uid) && skills.some((k) => needsHeal(b, t, k.cure)))) return null;
  const reach = b.reachOf(u, budget);
  const occ = b.occupancy(u);
  let best: { at: { x: number; y: number; cost: number }; skill: SkillDef; cell: Cell; score: number } | null = null;
  for (const n of reach.values()) {
    const at = { x: n.x, y: n.y };
    for (const skill of skills)
      for (const cell of b.skillCells(u, skill, at)) {
        const hit = b.affected(u, skill, cell, at, occ);
        if (!hit.some((t) => needsHeal(b, t, skill.cure)) || (skill.cure && hit.some((t) => b.isBound(t)))) continue;
        let score = 0;
        for (const t of hit) {
          const gain = Math.min(t.stats.maxHp - t.hp, Math.floor(t.stats.maxHp / Math.max(1, skill.power)));
          score += t.hp < t.stats.maxHp / 3 ? gain * 2 : gain;
          if (skill.cure && (t.poisonTurns > 0 || t.stunTurns > 0)) score += Math.floor(t.stats.maxHp / 10);
        }
        if (!best || score > best.score || (score === best.score && n.cost < best.at.cost)) best = { at: n, skill, cell, score };
      }
  }
  return best ? { path: b.pathOf(reach, best.at), skill: best.skill, cell: best.cell } : null;
}

/** 这个人身上已经有这招的增益（同一招还剩 2 回合以上）：同一招再放只刷新回合，白费一回合；别的来源的增益照样叠加，不算 */
export function hasSkillBuffs(b: Battle, t: Unit, skill: SkillDef): boolean {
  if (!skill.selfBuffs?.length) return true;
  return t.buffs.some((y) => y.source === b.skillLabel(skill) && y.turns > 1);
}

/** 下回合可能挨打：有敌人在「它的移动力 + 3」格以内 */
const inDanger = (b: Battle, u: Unit, at: Cell) => b.aiFoesOf(u).some((t) => dist(at, t) <= t.stats.move + 3);

/**
 * 增益给谁【新】（负责人 2026-11-26）：自己（站在 end）或 buffAlly 技能可选的相邻队友里，还没有这招增益、下回合可能挨打的人；
 * 挨得着的敌人多的优先，再看体力比例低的，再看离敌人近的。返回施放点；没人值得加就返回 undefined。
 */
function buffCell(b: Battle, u: Unit, skill: SkillDef, end: Cell): Cell | undefined {
  const cands: { t: Unit; at: Cell }[] = [{ t: u, at: end }];
  if (skill.buffAlly)
    for (const t of b.active())
      if (t !== u && !hostile(u, t) && !b.spectators.has(t.uid) && !b.isBound(t) && dist(end, t) === 1) cands.push({ t, at: t });
  let best: { at: Cell; foes: number; ratio: number; near: number } | null = null;
  for (const { t, at } of cands) {
    if (hasSkillBuffs(b, t, skill) || !inDanger(b, u, at)) continue;
    const close = b.aiFoesOf(u).filter((f) => dist(at, f) <= f.stats.move + 3);
    const foes = close.length;
    const ratio = t.hp / t.stats.maxHp;
    const near = Math.min(...close.map((f) => dist(at, f)));
    if (!best || foes > best.foes || (foes === best.foes && (ratio < best.ratio || (ratio === best.ratio && near < best.near)))) best = { at, foes, ratio, near };
  }
  return best ? { x: best.at.x, y: best.at.y } : undefined;
}

/**
 * 打不到人、又有敌人在下回合可能打到自己（或可加增益的相邻队友）的距离内（敌人移动力 + 3 格）时，在走到的位置摆架势技【新】（§6.5.3）；
 * 身上已有这招的增益就不重复摆，能给队友的（呼保义、神行法、神机助气）挑最需要的人。
 */
export function withStance(b: Battle, u: Unit, plan: AiPlan): AiPlan | null {
  if (plan.skill) return null;
  const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
  for (const s of learnedSkills(u, b.data)) {
    if (!isStanceSkill(s) || s.mpCost > u.mp) continue;
    const cell = buffCell(b, u, s, end);
    if (cell) return { ...plan, skill: s, cell };
  }
  return null;
}

/** 打不到人时：气力不到一半就在走到的位置用集气技【新】 */
export function withCharge(b: Battle, u: Unit, plan: AiPlan): AiPlan {
  if (plan.skill) return plan;
  const stance = withStance(b, u, plan);
  if (stance) return stance;
  if (u.mp >= u.stats.maxMp / 2) return plan;
  const s = learnedSkills(u, b.data).find(isRechargeSkill);
  if (!s) return plan;
  const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
  // 回气顺带给人加增益的（天王聚義式、運籌帷幄）：增益给最需要的相邻队友，没人需要就给自己
  const cell = (s.buffAlly && buffCell(b, u, s, end)) || { x: end.x, y: end.y };
  return { ...plan, skill: s, cell };
}

function defaultPlan(b: Battle, u: Unit): AiPlan {
  const heal = healIfLow(b, u) ?? healPlan(b, u);
  if (heal) return heal;
  // 相邻队友严重缺气时先援气；自身回气仍只选择自身集气技能。
  const aid = allyChargePlan(b, u);
  if (aid) return aid;
  const atk = bestAttack(b, u);
  if (atk) return atk;
  const main = primaryFoe(b, u);
  const goals = main ? [main] : [];
  return marchPlan(b, u, goals) ?? withCharge(b, u, approach(b, u, goals));
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
      return bestAttack(b, u, target) ?? marchPlan(b, u, [target]) ?? approach(b, u, [target]);
    case 2:
    case 6: {
      // 迎击：警戒半径内有敌人才行动，否则原地待命（半径见 alertRadius）
      // 没敌人靠近时原地不动，只在原地给够得着的自己人回血
      const near = foesWithin(b, u, alertRadius(b, u));
      if (!near.length) return healPlan(b, u, 0) ?? withCharge(b, u, {});
      return healPlan(b, u) ?? bestAttack(b, u) ?? marchPlan(b, u, near) ?? withCharge(b, u, approach(b, u, near));
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
    case 16: {
      // 【新】直扑目标、顺路就打（三打祝家庄的伏兵，负责人 2026-11-26）：打得到目标先打目标；
      // 打不到目标时，移动范围里打得到谁就打谁；都打不到才往目标那边走（模式 10 只认目标，路上的人不理）
      if (!target) return defaultPlan(b, u);
      return bestAttack(b, u, target) ?? bestAttack(b, u) ?? marchPlan(b, u, [target]) ?? approach(b, u, [target]);
    }
    case 17:
    case 18:
      // 【新】守渡 / 夺渡（白龙庙，负责人 2026-11-28）：见 ferryPlan；18 = 都监亲随，对方占着渡口就去夺，没有就主动进攻
      return ferryPlan(b, u) ?? defaultPlan(b, u);
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

/**
 * AI 17 守渡 / 夺渡【新】（白龙庙，负责人 2026-11-28，§15.23.1）。任务由 Battle.ferryTask 给：
 * 守：渡口附近（radius 格）没有对手就守在渡口里或紧挨着它；有对手靠近就迎击，只从离渡口 2 格以内出手，不被引远；
 * 夺：先从渡口里能打到人的格子出手，走得进渡口就进去站着，否则从渡口附近打人，再不行就往渡口赶。
 * 敌兵、我方的梁山喽啰都用这一套（试打的我方好汉也借 take 用）。
 */
export function ferryPlan(b: Battle, u: Unit): AiPlan | null {
  const task = b.ferryTask(u);
  if (!task) return null;
  const z = b.ferries!.zones[task.zone];
  const heal = healIfLow(b, u) ?? healPlan(b, u);
  if (heal) return heal;
  return task.kind === 'hold' ? holdFerry(b, u, z) : takeFerry(b, u, z);
}

export function holdFerry(b: Battle, u: Unit, z: FerryZone): AiPlan {
  const radius = b.ferries!.radius;
  const near = b.aiFoesOf(u).filter((t) => zoneDist(z, t) <= radius);
  if (near.length) {
    const hit = bestAttack(b, u, undefined, u.stats.move, (c) => zoneDist(z, c) <= 2);
    if (hit && hit.target && zoneDist(z, hit.target) <= radius + 2) return hit;
  }
  if (zoneDist(z, u) <= 1) return withCharge(b, u, {});
  return withCharge(b, u, approach(b, u, zoneCells(z), 0));
}

/** 夺渡：也给试打的我方好汉用 */
export function takeFerry(b: Battle, u: Unit, z: FerryZone): AiPlan {
  const radius = b.ferries!.radius;
  const inside = bestAttack(b, u, undefined, u.stats.move, (c) => inZone(z, c));
  if (inside) return inside;
  // 走得进渡口就进去站着（离对手最近的那格，好下回合接着打）
  const reach = b.reachOf(u, u.stats.move);
  const foes = b.aiFoesOf(u);
  let best: { x: number; y: number; cost: number } | null = null, bd = Infinity;
  for (const n of reach.values()) {
    const who = b.unitAt(n.x, n.y);
    if (!inZone(z, n) || (who && who !== u)) continue;
    const d = foes.length ? Math.min(...foes.map((t) => dist(n, t))) : 0;
    if (d < bd) { bd = d; best = n; }
  }
  if (best) return withCharge(b, u, best.x === u.x && best.y === u.y ? {} : { path: b.pathOf(reach, best) });
  const around = bestAttack(b, u, undefined, u.stats.move, (c) => zoneDist(z, c) <= radius);
  if (around) return around;
  const goals = zoneCells(z);
  return marchPlan(b, u, goals) ?? withCharge(b, u, approach(b, u, goals, 0));
}
