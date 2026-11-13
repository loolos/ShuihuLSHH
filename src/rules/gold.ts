// 金钱：击倒敌人的掉落与过关奖励（docs/game-design.md §7.6）。
import type { GameData } from './data.ts';
import type { Rng } from './rng.ts';

/** 掉落的波动幅度：基数 ±15%【新】 */
export const GOLD_SPREAD = 0.15;

/**
 * 某职业被击倒时掉落黄金的基数：职业金钱上限的一半（上限为 0 的不掉）。
 * 原版是 1..上限的随机数（期望 (上限+1)/2，EXE 0x406f43 附近），重制版改为基数 ±15%，期望几乎不变。
 */
export function goldBase(data: GameData, classId: number): number {
  const cap = data.classes[classId]?.goldCap ?? 0;
  return cap > 0 ? Math.round(cap / 2) : 0;
}

/** 掉落范围 [最少, 最多] */
export function goldRange(base: number): [number, number] {
  const d = Math.round(base * GOLD_SPREAD);
  return [base - d, base + d];
}

/** 击倒一个敌人掉落的黄金：基数 ±15% 内均匀取整 */
export function killGold(classId: number, data: GameData, rng: Rng): number {
  const base = goldBase(data, classId);
  if (!base) return 0;
  const [lo, hi] = goldRange(base);
  return rng.range(lo, hi);
}

/**
 * 过关奖励【新：负责人 2026-11-13】：打赢一场战役（地图名 N*、训练关 Train*）给一笔固定的黄金。
 * 数额按该关敌人平均等级定：100 + 20 × 平均等级，取整到 50；过场（Act*）不给。
 * 改数额直接改这张表。分路的两关（N-add04a/b、N-add09a/b）各自有数。
 */
export const STAGE_CLEAR_GOLD: Record<string, number> = {
  'n01': 100,
  'n-add01': 150,
  'n-add02': 200,
  'n02': 200,
  'n-add03': 150,
  'n03': 200,
  'n-add04a': 250,
  'n-add04b': 250,
  'n-add05': 250,
  'n04': 300,
  'n-add06': 300,
  'train1': 450,
  'n-add07': 350,
  'n05': 400,
  'n-add08': 400,
  'n06': 400,
  'n07': 450,
  'n-add09a': 450,
  'n-add09b': 500,
  'n-add10': 400,
  'n08': 500,
  'n09': 500,
  'n-add11': 550,
  'n-add12': 550,
  'n10': 600,
  'n-add13': 600,
  'n11': 600,
  'n-add14': 650,
  'n12': 700,
  'n-add15': 700,
  'n13': 650,
  'n-add16': 650,
  'train2': 850,
  'n14': 800,
};

/** 某关的过关奖励（没有的为 0） */
export const stageClearGold = (map: string) => STAGE_CLEAR_GOLD[map.toLowerCase()] ?? 0;
