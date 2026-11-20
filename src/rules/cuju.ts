// 蹴鞠外传的规则（docs/game-design.md §15.25）【新：负责人 2026-11-20】：球是地图上的一个物件，好汉用普攻、远程或技能"打"球，
// 伤害决定踢多远，命中决定准不准；球沿直线走，碰到对方好汉被拦下，出界本方回合立刻结束，进球后双方回到开球站位。
// 这里只放纯函数（踢球结算、球路、落点），状态和回合流程在 battle.ts，AI 在 cuju-ai.ts。
import { CRIT_HALF, ratioDamage, rangedFactor, skillHitStat } from './combat.ts';
import type { SkillDef } from './data.ts';
import type { Rng } from './rng.ts';
import type { Side, Unit } from './unit.ts';
import type { Cell } from './board.ts';

/** 球的防御：伤害按 A² / (A + 2 × 40) 算 */
export const BALL_DEFENSE = 40;
/** 球的敏捷：命中率 = 命中 / (命中 + 50)，20 级好汉大约 70%–80% */
export const BALL_AGILITY = 100;
/** 每 25 点伤害踢 1 格 */
export const KICK_DIVISOR = 25;
export const KICK_MIN = 1;
export const KICK_MAX = 10;
/** 踢偏（没命中）时距离打几折 */
export const MISS_FACTOR = 0.6;
/** 踢偏的角度范围（度），左右随机；多段技能按没中的段数比例缩小 */
export const DEVIATE_MIN = 20;
export const DEVIATE_MAX = 45;

export interface CujuGoal {
  /** 门线所在的列（球场外一格） */
  x: number;
  y1: number;
  y2: number;
}

export interface CujuRules {
  /** 球场（含边线）[x1, y1, x2, y2]，出了这个范围就是出界 */
  field: [number, number, number, number];
  /** 两队各自守的球门 */
  goals: Record<'player' | 'enemy', CujuGoal>;
  /** 开球点 */
  kickoff: [number, number];
  /** 先进几球获胜 */
  goalsToWin: number;
  /** 常规回合数：打完领先的赢 */
  turns: number;
  /** 打平后的加时回合数（先进球的赢），再平算输 */
  extraTurns: number;
  /** 某一队踢球的加成（齐云社是行家）：power = 力道倍率，hit = 命中属性倍率 */
  bonus?: Partial<Record<Team, KickBonus>>;
}

export interface KickBonus {
  power?: number;
  hit?: number;
}

export type Team = 'player' | 'enemy';
export const otherTeam = (s: Side): Team => (s === 'player' ? 'enemy' : 'player');

export function inField(r: CujuRules, c: { x: number; y: number }) {
  const [x1, y1, x2, y2] = r.field;
  return c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2;
}

/** 人能站的格子：球场和场外一圈（最多出界一格，好把边线上的球踢回来），球门口除外【新：负责人 2026-11-20】 */
export function canStand(r: CujuRules, c: { x: number; y: number }) {
  const [x1, y1, x2, y2] = r.field;
  if (c.x < x1 - 1 || c.x > x2 + 1 || c.y < y1 - 1 || c.y > y2 + 1) return false;
  return !Object.values(r.goals).some((g) => c.x === g.x && c.y >= g.y1 && c.y <= g.y2);
}

/** 普通攻击能不能碰到球：近战（射程从 1 起）可以踢身边 8 格；其余按射程（上下左右斜着都算，曼哈顿距离） */
export function basicReaches(at: Cell, ball: Cell, [lo, hi]: [number, number]): boolean {
  const dx = Math.abs(at.x - ball.x), dy = Math.abs(at.y - ball.y);
  if (dx === 0 && dy === 0) return false;
  if (lo <= 1 && dx <= 1 && dy <= 1) return true;
  return dx + dy >= lo && dx + dy <= hi;
}

/** 对球的命中率（%）：球没有朝向、不会防御 */
export function kickHitChance(att: Unit, skill: SkillDef, bonus?: KickBonus): number {
  const hv = skillHitStat(att, skill) * (bonus?.hit ?? 1);
  if (hv <= 0) return 0;
  return Math.min(100, Math.floor((100 * hv) / (hv + BALL_AGILITY / 2)));
}

/** 踢球的必杀率按战斗必杀率打几折：20 级好汉打人必杀率常到 40%–55%，一半的球都踢满 10 格就太随机了 */
export const KICK_CRIT_FACTOR = 0.5;

/** 必杀率（%）：同 combat.critChance 再 × KICK_CRIT_FACTOR，踢球不分敌我（敌方名将不打折） */
export function kickCritChance(att: Unit, skill: SkillDef): number {
  const x = Math.max(0, att.stats.crit + skill.critMod);
  return Math.floor(((100 * x * x) / (x * x + CRIT_HALF * CRIT_HALF)) * KICK_CRIT_FACTOR);
}

/** 踢球的力道（对球的伤害，不含浮动）：[普通, 必杀]；远程技能照样按距离打折 */
export function kickPower(att: Unit, skill: SkillDef, from: Cell, ball: Cell, bonus?: KickBonus): [number, number] {
  const a = att.stats.attack + skill.power;
  if (a <= 0) return [0, 0];
  const f = rangedFactor({ ...att, x: from.x, y: from.y } as Unit, ball, skill);
  const normal = ratioDamage(a, BALL_DEFENSE);
  const critical = normal + (1 + kickCritChance(att, skill) / 100) * (a * a) / (a + 3 * BALL_DEFENSE);
  const k = f * (bonus?.power ?? 1);
  return [normal * k, critical * k];
}

/** 力道 → 格数 */
export const kickDistance = (power: number) => Math.max(KICK_MIN, Math.min(KICK_MAX, Math.round(power / KICK_DIVISOR)));

export interface KickRoll {
  /** 段数、命中段数、有没有必杀 */
  parts: number;
  hits: number;
  crit: boolean;
  /** 偏了多少度（正 = 逆时针） */
  deviation: number;
  distance: number;
  power: number;
}

/** 掷一脚：每段单独判命中和必杀（同 rollAttack）；没中的段力道打 6 折，按没中的比例偏 20°–45° */
export function rollKick(att: Unit, skill: SkillDef, from: Cell, ball: Cell, rng: Rng, bonus?: KickBonus): KickRoll {
  const segs = skill.hits.length ? skill.hits.filter((h) => h.dir === skill.hits[0].dir) : [{ frame: 0, percent: 100, dir: 0 }];
  const total = segs.reduce((s, h) => s + h.percent, 0) || 100;
  const hitRate = kickHitChance(att, skill, bonus), critRate = kickCritChance(att, skill);
  const [n, c] = kickPower(att, skill, from, ball, bonus);
  const vary = 0.9 + rng.next() * 0.2;
  let power = 0, hits = 0, missed = 0, crit = false;
  for (const h of segs) {
    const share = h.percent / total;
    if (rng.chance(hitRate)) {
      hits++;
      const cr = rng.chance(critRate);
      crit ||= cr;
      power += (cr ? c : n) * share;
    } else {
      missed += share;
      power += n * share * MISS_FACTOR;
    }
  }
  power *= vary;
  const deviation = missed > 0 ? (rng.chance(50) ? 1 : -1) * (DEVIATE_MIN + rng.next() * (DEVIATE_MAX - DEVIATE_MIN)) * missed : 0;
  return { parts: segs.length, hits, crit, deviation, distance: kickDistance(power), power };
}

/** 从 from 出发，沿 (dx, dy) 方向转过 deg 度，走 len 格长（欧氏距离）经过的格子（不含起点，按顺序、不重复） */
export function traceLine(from: Cell, dx: number, dy: number, deg: number, len: number): Cell[] {
  const r = (deg * Math.PI) / 180;
  const ux0 = dx * Math.cos(r) - dy * Math.sin(r), uy0 = dx * Math.sin(r) + dy * Math.cos(r);
  const m = Math.hypot(ux0, uy0) || 1;
  const ux = ux0 / m, uy = uy0 / m;
  const out: Cell[] = [];
  let last = { x: from.x, y: from.y };
  for (let t = 0.05; t <= len + 1e-9; t += 0.05) {
    const c = { x: Math.round(from.x + ux * t), y: Math.round(from.y + uy * t) };
    if (c.x !== last.x || c.y !== last.y) {
      out.push(c);
      last = c;
    }
  }
  return out;
}

export interface BallPlayer {
  uid: number;
  side: Side;
  x: number;
  y: number;
  defending: boolean;
}

export type BallResult =
  | { kind: 'stop'; at: Cell; path: Cell[] }
  /** by：拦下球的人 */
  | { kind: 'intercept'; at: Cell; path: Cell[]; by: number }
  /** at：出界前最后一格 */
  | { kind: 'out'; at: Cell; path: Cell[] }
  /** scorer：得分的一方（踢进自家门算对方的） */
  | { kind: 'goal'; at: Cell; path: Cell[]; scorer: Team };

/**
 * 球沿 line 一格一格走：
 * - 出了球场：进了某一方的球门口就是进球，不然是出界；
 * - 走到对方好汉站的格子（斜着走时擦过的两个侧格也算）：被拦下，停在他脚前（上一格）；
 * - 走进防御中的对方好汉上下左右相邻的格子：被拦下，停在这一格；
 * - 自己人不挡球；最后停的格子有人，就退回到上一个空格。
 */
export function resolveBall(rules: CujuRules, start: Cell, line: Cell[], kicker: Side, players: BallPlayer[]): BallResult {
  const at = (x: number, y: number) => players.find((p) => p.x === x && p.y === y);
  const foe = (p: BallPlayer | undefined) => !!p && p.side !== kicker;
  const path: Cell[] = [];
  const settle = (i: number): Cell => {
    // path[0..i] 里从 i 往回找第一个没人的格子；都有人就留在起点
    for (let k = i; k >= 0; k--) if (!at(path[k].x, path[k].y)) return path[k];
    return start;
  };
  let prev = start;
  for (const c of line) {
    if (!inField(rules, c)) {
      for (const team of ['player', 'enemy'] as const) {
        const g = rules.goals[team];
        if (c.x === g.x && c.y >= g.y1 && c.y <= g.y2) {
          path.push(c);
          return { kind: 'goal', at: c, path, scorer: otherTeam(team) };
        }
      }
      return { kind: 'out', at: prev, path: [...path, c] };
    }
    const here = at(c.x, c.y);
    const corners = c.x !== prev.x && c.y !== prev.y ? [at(prev.x, c.y), at(c.x, prev.y)] : [];
    const blocker = foe(here) ? here : corners.find(foe);
    if (blocker) return { kind: 'intercept', at: settle(path.length - 1), path, by: blocker.uid };
    path.push(c);
    if (!here) {
      const guard = players.find((p) => p.side !== kicker && p.defending && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) === 1);
      if (guard) return { kind: 'intercept', at: c, path, by: guard.uid };
    }
    prev = c;
  }
  return { kind: 'stop', at: settle(path.length - 1), path };
}

/** 出界后球交给谁、放在哪：离出界点最近的对方好汉，放在他身边朝他要攻的球门那一侧的空格 */
export function throwIn(rules: CujuRules, out: Cell, kicker: Side, players: BallPlayer[]): { to: number; at: Cell } | null {
  const team = otherTeam(kicker);
  const mates = players.filter((p) => p.side === team);
  if (!mates.length) return null;
  const d = (p: { x: number; y: number }) => Math.abs(p.x - out.x) + Math.abs(p.y - out.y);
  const who = mates.reduce((a, b) => (d(b) < d(a) ? b : a));
  const goal = rules.goals[kicker === 'player' ? 'player' : 'enemy']; // 他要攻的是踢球方守的门
  const gy = (goal.y1 + goal.y2) / 2;
  const free = (c: Cell) => inField(rules, c) && !players.some((p) => p.x === c.x && p.y === c.y);
  const near: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) near.push({ x: who.x + dx, y: who.y + dy });
  const score = (c: Cell) => Math.abs(c.x - goal.x) + 0.5 * Math.abs(c.y - gy) + (c.x !== who.x && c.y !== who.y ? 0.25 : 0);
  const cands = near.filter(free).sort((a, b) => score(a) - score(b));
  if (cands.length) return { to: who.uid, at: cands[0] };
  // 身边全被占了：找离他最近的空格
  const [x1, y1, x2, y2] = rules.field;
  let best: Cell | null = null;
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    const c = { x, y };
    if (free(c) && (!best || d2(c, who) < d2(best, who))) best = c;
  }
  return best ? { to: who.uid, at: best } : null;
}

const d2 = (a: Cell, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
