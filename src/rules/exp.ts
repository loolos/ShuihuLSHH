// 经验值【新】（docs/game-design.md §5.1，负责人 2026-11-12 选方案二并补充）。
// 原版只有击倒、命中、回复技给经验（EXE 0x406f43 / 0x406f9d / 0x406bd0），强角色独占击倒，弱角色长期停在初始等级。
// 新规则：
// - 各种行动当场给出手者经验：命中、反击、回复技、用药、挨打、闪开、休息。
// - 击倒经验只看敌人等级：65% 当场给击倒者，35% 进"全队经验"；友军击倒的也把 35% 放进全队经验。
// - 全队经验在战斗胜利后统一结算，先补给最落后的人（注水式：从等级最低的往上补齐）。
// 数值用 tools/sim-exp.ts（双方 AI 跑整条主线）校准，让各关全队平均等级与原版规则相近。
import type { Rng } from './rng.ts';
import type { Unit } from './unit.ts';

export const EXP_PER_LEVEL = 100;
export const MAX_PLAYER_LEVEL = 30;

export const EXP_RULES = {
  /** 'original' 只给 tools/sim-exp.ts 做对比 */
  mode: 'new' as 'new' | 'original',
  /** 击倒经验 = killBase + killPerLevel × 敌人等级 */
  killBase: 8,
  killPerLevel: 0.5,
};

/** 击倒一个敌人的总经验。新规则只和敌人等级有关；原版 max(1, 等级差) × 12 + 1–9 */
export function killExp(killer: Unit, foe: Unit, rng: Rng): number {
  if (EXP_RULES.mode === 'original') return Math.max(1, foe.level - killer.level) * 12 + rng.range(1, 9);
  return Math.round(EXP_RULES.killBase + EXP_RULES.killPerLevel * foe.level) + rng.range(0, 4);
}

/** 击倒经验里当场给击倒者的部分（其余进全队经验）；友军击倒时为 0 */
export function killerShare(total: number, byPlayer: boolean): number {
  if (EXP_RULES.mode === 'original') return byPlayer ? total : 0;
  return byPlayer ? total - teamShare(total) : 0;
}

/** 击倒经验的 35% 进全队经验，向下取整；余数归击倒者 */
export function teamShare(total: number): number {
  return EXP_RULES.mode === 'original' ? 0 : Math.floor(total * 35 / 100);
}

/** 命中未击倒：伤害 / 10 + 1–2（与原版相同） */
export function hitExp(damage: number, rng: Rng): number {
  return Math.floor(damage / 10) + rng.range(1, 2);
}

/** 反击命中的额外经验 */
export const counterExp = (rng: Rng) => (EXP_RULES.mode === 'original' ? 0 : rng.range(3, 5));

/** 挨打（没被击倒）：受到伤害 / 15 + 1–3，防御中再 +2 */
export function takenExp(damage: number, defending: boolean, rng: Rng): number {
  if (EXP_RULES.mode === 'original') return 0;
  return Math.floor(damage / 15) + rng.range(1, 3) + (defending ? 2 : 0);
}

/** 闪开攻击（不要求防御状态） */
export const dodgeExp = (rng: Rng) => (EXP_RULES.mode === 'original' ? 0 : rng.range(3, 5));

/** 回复技：原版 1–10；新规则按回复量 / 10 + 1–5 */
export function healExp(amount: number, rng: Rng): number {
  if (EXP_RULES.mode === 'original') return rng.range(1, 10);
  return Math.floor(amount / 10) + rng.range(1, 5);
}

/** 休息：按实际回复的体力 + 气力给少量经验，(体力 + 气力) / 20 + 0–1；什么都没回复时不给【新】（负责人 2026-11-12） */
export function restExp(hp: number, mp: number, rng: Rng): number {
  if (EXP_RULES.mode === 'original' || hp + mp <= 0) return 0;
  return Math.floor((hp + mp) / 20) + rng.range(0, 1);
}

/** 用回复药 / 解毒药：1–3（不占行动，给得少） */
export const itemExp = (rng: Rng) => (EXP_RULES.mode === 'original' ? 0 : rng.range(1, 3));

/**
 * 全队经验的分配：注水式，先把总进度（等级 × 100 + 经验）最低的人往上补，补平了再一起往上。
 * 30 级封顶的人不参与。返回与 members 同序的分得经验。
 */
export function splitTeamExp(members: { level: number; exp: number }[], pool: number): number[] {
  const out = members.map(() => 0);
  const idx = members.map((_, i) => i).filter((i) => members[i].level < MAX_PLAYER_LEVEL);
  if (!idx.length || pool <= 0) return out;
  const prog = (i: number) => members[i].level * EXP_PER_LEVEL + members[i].exp;
  idx.sort((a, b) => prog(a) - prog(b));
  // 找水位 T：Σ max(0, T − p_i) = pool
  let left = pool;
  let k = 1;
  let level = prog(idx[0]);
  while (k < idx.length) {
    const need = (prog(idx[k]) - level) * k;
    if (need > left) break;
    left -= need;
    level = prog(idx[k]);
    k++;
  }
  const each = Math.floor(left / k);
  let rest = left - each * k;
  for (let j = 0; j < k; j++) {
    const i = idx[j];
    out[i] = level + each - prog(i) + (rest-- > 0 ? 1 : 0);
  }
  return out;
}
