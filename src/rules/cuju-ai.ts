// 蹴鞠外传的 AI（docs/game-design.md §15.25）：双方共用，试打工具让我方也这样踢。
// 1. 踢得到球的人：把能走到的格子 × 能用的踢法都试一遍，按"正中 / 必杀 / 左右踢偏"几种结果的期望打分，
//    进球最高，落点越靠前、离对方越远、离本方还没动的队友越近越好；被拦截、出界扣分。
//    每次挑全队分数最高的那一脚先踢，所以会自然出现"一个传、一个接着射"。
// 2. 其余的人按分工走位：守门员站在球和本方球门的连线上，后卫挡在球和球门之间，前锋绕到球后面准备下一脚、或往前插接应；
//    走完防御（防御时上下左右相邻的格子也能拦球），前锋气不够时休息攒气。
import type { Battle } from './battle.ts';
import type { Cell } from './board.ts';
import { DEVIATE_MAX, DEVIATE_MIN, kickCritChance, kickDistance, kickHitChance, kickPower, MISS_FACTOR, otherTeam, resolveBall, traceLine, type BallResult, type Team } from './cuju.ts';
import type { SkillDef } from './data.ts';
import { isSupportSkill, learnedSkills } from './skills.ts';
import { attackSkill, type Unit } from './unit.ts';

export interface CujuActions {
  move(u: Unit, c: Cell): void;
  kick(u: Unit): void;
  skill(u: Unit, s: SkillDef, c: Cell): void;
  defend(u: Unit): void;
  rest(u: Unit): void;
}

interface KickPlan {
  u: Unit;
  at: Cell;
  skill: SkillDef;
  cell: Cell;
  value: number;
}

const mdist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 球停在 c 时对 side 有多好（不算进球）：越靠近对方球门越好，对方下回合踢得到扣分，本方本回合还能接着踢加分 */
export function ballValue(b: Battle, side: Team, c: Cell, kicker?: Unit, lockedAfter = false): number {
  const r = b.cuju!.rules;
  const target = r.goals[otherTeam(side)], own = r.goals[side];
  const len = Math.abs(target.x - own.x);
  const progress = 1 - Math.abs(c.x - target.x) / len; // 0 = 自家门口，1 = 对方门口
  const gy = (target.y1 + target.y2) / 2;
  let v = progress * 200 - Math.abs(c.y - gy) * 2;
  // 离对方球门近、角度正：下一脚可能直接射门
  if (Math.abs(c.x - target.x) <= 8) v += 20 - Math.abs(c.y - gy) * 3;
  const foes = b.active().filter((u) => u.side === otherTeam(side));
  const threats = foes.filter((f) => mdist(f, c) <= f.stats.move + 1).length;
  v -= Math.min(3, threats) * 30 * (1 - progress);
  if (!lockedAfter) {
    const helpers = b.active().filter((u) => u.side === side && u !== kicker && b.canAct(u) && !u.acted && mdist(u, c) <= u.stats.move + 1);
    if (helpers.length) v += 25;
  }
  return v;
}

function outcomeValue(b: Battle, side: Team, res: BallResult, kicker: Unit): number {
  switch (res.kind) {
    case 'goal':
      return res.scorer === side ? 1000 : -1000;
    case 'out':
      return -150;
    case 'intercept':
      return ballValue(b, side, res.at, kicker, true) - 90;
    case 'stop':
      return ballValue(b, side, res.at, kicker);
  }
}

/** 这个人站在 at 用 skill 踢 cell 的期望分 */
function kickValue(b: Battle, u: Unit, skill: SkillDef, at: Cell): number {
  const c = b.cuju!;
  const ball = c.ball;
  const players = b.ballPlayers(u, at);
  const bonus = b.kickBonus(u);
  const [n, cr] = kickPower(u, skill, at, ball, bonus);
  const p = kickHitChance(u, skill, bonus) / 100, pc = (kickCritChance(u, skill) / 100) * p;
  const dx = ball.x - at.x, dy = ball.y - at.y;
  const go = (deg: number, d: number) => outcomeValue(b, u.side as Team, resolveBall(c.rules, ball, traceLine(ball, dx, dy, deg, d), u.side, players), u);
  const dev = (DEVIATE_MIN + DEVIATE_MAX) / 2;
  const miss = kickDistance(n * MISS_FACTOR);
  return (p - pc) * go(0, kickDistance(n)) + pc * go(0, kickDistance(cr)) + ((1 - p) / 2) * (go(dev, miss) + go(-dev, miss)) - skill.mpCost * 0.15;
}

/** 这个人这回合最好的一脚（先走到哪、用什么踢） */
export function bestKick(b: Battle, u: Unit): KickPlan | null {
  if (!b.canKick(u)) return null;
  const stands: Cell[] = [{ x: u.x, y: u.y }];
  if (b.canMove(u)) for (const c of b.moveRange(u).green) stands.push(c);
  const skills = [attackSkill(u, b.data), ...learnedSkills(u, b.data).filter((s) => !isSupportSkill(s) && u.mp >= s.mpCost)];
  const ball = b.cuju!.ball;
  let best: KickPlan | null = null;
  for (const at of stands) {
    if (mdist(at, ball) > 12) continue;
    for (const skill of skills) {
      const cells = b.kickCells(u, skill, at);
      if (!cells.length) continue;
      // 同一站位同一招，球的走向一样（方向只看人和球），挑离人最近的施放点就行
      const cell = cells.reduce((a, c) => (mdist(c, at) < mdist(a, at) ? c : a));
      const value = kickValue(b, u, skill, at);
      if (!best || value > best.value) best = { u, at, skill, cell, value };
    }
  }
  return best;
}

/** 走位目标 */
function positionTarget(b: Battle, u: Unit, slot: number): Cell {
  const c = b.cuju!;
  const r = c.rules;
  const side = u.side as Team;
  const own = r.goals[side], target = r.goals[otherTeam(side)];
  const fwd = Math.sign(target.x - own.x); // 进攻方向（x 增大或减小）
  const ball = c.ball;
  const [x1, y1, x2, y2] = r.field;
  const clamp = (p: Cell): Cell => ({ x: Math.max(x1, Math.min(x2, Math.round(p.x))), y: Math.max(y1, Math.min(y2, Math.round(p.y))) });
  const ogy = (own.y1 + own.y2) / 2;
  switch (c.roles[u.uid]) {
    case 'keeper':
      return clamp({ x: own.x + fwd, y: Math.max(own.y1, Math.min(own.y2, ball.y)) });
    case 'back': {
      // 挡在球和本方球门之间；球到了本方半场就上去贴着球的后侧
      const toBall = Math.abs(ball.x - own.x);
      if (toBall < Math.abs(target.x - own.x) / 2 && mdist(u, ball) <= u.stats.move + 2) return clamp({ x: ball.x - fwd, y: ball.y + (slot ? 1 : -1) });
      return clamp({ x: own.x + fwd * Math.max(3, toBall * 0.4), y: ogy + (ball.y - ogy) * 0.5 + (slot ? 2 : -2) });
    }
    default:
      // 第一个前锋绕到球后面（下一脚往前踢），第二个往前插 4 格接应
      return slot === 0 ? clamp({ x: ball.x - fwd, y: ball.y }) : clamp({ x: ball.x + fwd * 4, y: ball.y + (ball.y < (y1 + y2) / 2 ? 3 : -3) });
  }
}

function walkToward(b: Battle, u: Unit, goal: Cell, act: CujuActions) {
  if (!b.canMove(u)) return;
  const field = b.board.distanceField([goal]);
  const W = b.board.width;
  const ball = b.cuju!.ball;
  const d = (c: Cell) => field[c.y * W + c.x] + (c.x === ball.x && c.y === ball.y ? 99 : 0);
  let best: Cell = { x: u.x, y: u.y };
  for (const c of b.moveRange(u).green) if (d(c) < d(best)) best = c;
  if (best.x !== u.x || best.y !== u.y) act.move(u, best);
}

/** 一方的整个回合 */
export function cujuPhase(b: Battle, side: Team, act: CujuActions) {
  const c = b.cuju!;
  const mine = () => b.active().filter((u) => u.side === side && b.canAct(u));
  // 先轮流踢球：每次挑分数最高的一脚，比不踢好才踢
  for (let guard = 0; guard < 10 && b.status === 'playing' && !c.over && !c.locked; guard++) {
    const plans = mine().map((u) => bestKick(b, u)).filter((p): p is KickPlan => !!p);
    if (!plans.length) break;
    const p = plans.reduce((a, x) => (x.value > a.value ? x : a));
    if (p.value <= ballValue(b, side, c.ball, undefined, true)) break;
    if (p.at.x !== p.u.x || p.at.y !== p.u.y) act.move(p.u, p.at);
    if (b.status !== 'playing') return;
    if (p.skill === attackSkill(p.u, b.data)) act.kick(p.u);
    else act.skill(p.u, p.skill, p.cell);
  }
  if (b.status !== 'playing' || c.over) return;
  // 其余的人走位
  const slots: Record<string, number> = {};
  for (const u of mine()) {
    const role = c.roles[u.uid] ?? 'forward';
    const slot = (slots[role] = (slots[role] ?? -1) + 1);
    walkToward(b, u, positionTarget(b, u, slot), act);
    if (b.status !== 'playing' || c.over) return;
    if (!b.canAct(u)) continue;
    if (role === 'forward' && u.mp < u.stats.maxMp * 0.6) act.rest(u);
    else act.defend(u);
  }
}
