// 技能特效：播哪几组 Effect.lib、在哪些格子、什么时候播。纯函数，不依赖 Phaser（tests/effects.test.ts）。
// 全部来自 ShuiHu.exe 的静态分析（docs/binary-formats.md §4.1），没有运行 EXE。
import type { Cell } from '../rules/board.ts';
import type { SkillDef } from '../rules/data.ts';
import { DIRS } from '../rules/unit.ts';

/** 集气技一律播第 7 组（EXE 0x4037c0：类型 8 → push 7），不看技能子项 +6 */
export const FX_CHARGE = 7;
/** 回复技一律播第 17 组（EXE 0x4037db：类型 9、11 → push 0x11），不看技能子项 +6 */
export const FX_HEAL = 17;
/** 防御：我方单位进入防御状态时在脚下播第 48 组（蓝色护盾圈，EXE 0x4075c0 → 0x40765f；只限阵营 0 且已登场），声音 49.wav */
export const FX_DEFEND = 48;
/** 反击：防御中闪开相邻攻击、触发反击时，在反击者脚下先播第 37 组（聚气爆光，EXE 0x4077a0 → 0x40782b），声音 38.wav，再出手 */
export const FX_COUNTER = 37;
/** 进关就下载的固定特效组 */
export const FIXED_FX = [FX_DEFEND, FX_COUNTER];

export interface SkillFx {
  /** 第一段的组号；directional 时还要加上方向 0–3 */
  first: number;
  /** 第一段播到触发帧时，在同一格接着播的组号（技能子项 +24 − 1） */
  then: number | null;
  /** 前一段播到触发帧、而这一格有可作用的单位时才播的组号（技能子项 +26 − 1） */
  onTarget: number | null;
  /** 遠程（类型 10）：组号 = first + 方向，弓箭 52–55、飞刀 56–59 各 4 个方向 */
  directional: boolean;
  /** 特效像飞镖一样从施放者脚下逐格飞向施放点，碰到第一个目标停下（类型 10，EXE 0x404080） */
  projectile: boolean;
  /** 出手动画放完才播一次（类型 8、9，EXE 0x407522），否则在每个命中帧各播一轮 */
  atEnd: boolean;
}

/**
 * 技能用哪些特效（EXE 0x4073e0 出手动画、0x4072e0 生成特效、0x403780 选组）：
 * - 迴旋技（2）不播特效，命中帧直接结算（0x40746f）；
 * - 集气技（8）播第 7 组、类型 9 的回复技播第 17 组，都在出手动画结束时播，+6 是 0 也播；
 * - 类型 11 的回复技 +6 不为 0 才播，播的也是第 17 组（不是 +6 那组）；
 * - 其它技能 +6 为 0 时不播，否则 +6 → +24 → +26 三段接力。
 */
export function skillFx(s: Pick<SkillDef, 'type' | 'effect' | 'effect2' | 'effect3'>): SkillFx | null {
  const base = { then: null, onTarget: null, directional: false, projectile: false };
  if (s.type === 8) return { ...base, first: FX_CHARGE, atEnd: true };
  if (s.type === 9) return { ...base, first: FX_HEAL, atEnd: true };
  if (s.type === 2 || s.effect <= 0) return null;
  if (s.type === 11) return { ...base, first: FX_HEAL, atEnd: false };
  return {
    first: s.effect - 1,
    then: s.effect2 > 0 ? s.effect2 - 1 : null,
    onTarget: s.effect3 > 0 ? s.effect3 - 1 : null,
    directional: s.type === 10,
    projectile: s.type === 10,
    atEnd: false,
  };
}

export interface FxSpot {
  cell: Cell;
  /** 第几轮出现（每轮隔一个特效帧，EXE 0x404390 每帧向外扩一圈） */
  ring: number;
}

/**
 * 特效出现的格子与先后：
 * - 线形（0、5、6）：从施放点沿方向一格一格往外（0x403bd0）；
 * - 扇形（1）：一行一行往外，同一行同时出现（0x403cf0）；
 * - 菱形（3、4、7、9、11 等）：从施放点按距离一圈一圈往外（0x403f20，按圈推测）；
 * - 遠程（10）：从施放者脚下沿直线飞到施放点（0x404080），碰到目标就停。
 * 集气技、范围为 0 的技能只有施放点一格。
 */
export function fxSpots(s: Pick<SkillDef, 'type'>, from: Cell, at: Cell, area: Cell[], stopAt: (c: Cell) => boolean = () => false): FxSpot[] {
  if (s.type === 10) {
    const dx = Math.sign(at.x - from.x), dy = Math.sign(at.y - from.y);
    const out: FxSpot[] = [];
    for (let i = 0, x = from.x, y = from.y; ; i++, x += dx, y += dy) {
      out.push({ cell: { x, y }, ring: i });
      if ((x === at.x && y === at.y) || (i > 0 && stopAt({ x, y })) || i > 64) break;
    }
    return out;
  }
  const cells = area.length ? area : [at];
  const d = dirIndex(from, at);
  const dir = DIRS[d];
  return cells.map((c) => {
    const ox = c.x - at.x, oy = c.y - at.y;
    const ring = s.type === 0 || s.type === 1 || s.type === 5 || s.type === 6 ? Math.abs(ox * dir.x + oy * dir.y) : Math.abs(ox) + Math.abs(oy);
    return { cell: c, ring };
  });
}

/** 从 from 看 at 的方向 0–3（与 DIRS 同序：0 = y−1、1 = x−1、2 = y+1、3 = x+1；EXE 0x41e3a0 同序，方向表 0x4460c4） */
export function dirIndex(from: Cell, at: Cell, fallback = 0): number {
  const dx = at.x - from.x, dy = at.y - from.y;
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

/** 一格上的接力：每段 {组号, 相对这一格开始的帧数}，以及结算（掉血 / 回复）在第几帧 */
export interface FxChain {
  parts: { group: number; startFrame: number }[];
  resolveFrame: number;
}

/**
 * 一格上依次播哪几段（EXE 0x4041e0）：第一段到触发帧时，有第二段就接第二段；
 * 再到触发帧时，有命中特效且这一格有目标就接命中特效；最后一段到触发帧时结算这一格。
 */
export function fxChain(fx: SkillFx, dir: number, hasTarget: boolean, triggers: readonly number[]): FxChain {
  const trig = (g: number) => Math.max(0, triggers[g] ?? 3);
  const first = fx.first + (fx.directional ? dir & 3 : 0);
  const parts = [{ group: first, startFrame: 0 }];
  let t = trig(first);
  if (fx.then !== null) {
    parts.push({ group: fx.then, startFrame: t });
    t += trig(fx.then);
  }
  if (fx.onTarget !== null && hasTarget) {
    parts.push({ group: fx.onTarget, startFrame: t });
    t += trig(fx.onTarget);
  }
  return { parts, resolveFrame: t };
}

/** 这个技能可能用到的全部组（按需下载用） */
export function fxGroups(s: Pick<SkillDef, 'type' | 'effect' | 'effect2' | 'effect3'>): number[] {
  const fx = skillFx(s);
  if (!fx) return [];
  const out = fx.directional ? [0, 1, 2, 3].map((d) => fx.first + d) : [fx.first];
  if (fx.then !== null) out.push(fx.then);
  if (fx.onTarget !== null) out.push(fx.onTarget);
  return out;
}
