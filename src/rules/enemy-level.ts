// 敌人等级修正【新】（负责人 2026-11-13：敌人平均等级偏高，调到和主角团差不多）。
// 原版 ACT 里写的敌人等级中后期比按原版节奏升级的我方高 1–4 级（终章 N14 敌均 34，我方约 30）。
// 做法：每场战役一个修正值（只降不升），整关敌人一起平移，头目和小兵的相对差距不变；1 级的过场摆设不动，最低降到 2 级。
// 修正值由 tools/gen-enemy-levels.ts 生成（src/data/enemy-levels.json）：按原版经验规则沿主线模拟，
// 取我方进关和出关平均等级的中点作为「主角团等级」，敌人平均等级高出多少就降多少。
import type { ActUnit } from '../formats/act.ts';
import table from '../data/enemy-levels.json' with { type: 'json' };

const SHIFT: Record<string, number> = table.shift;

/** 生成工具关掉修正，好用 ACT 原值做模拟 */
export const ENEMY_LEVEL = { enabled: true };

export const enemyShift = (stage: string): number => (ENEMY_LEVEL.enabled ? (SHIFT[stage.toLowerCase()] ?? 0) : 0);

/** 第 stage 关修正后的敌人等级 */
export function enemyLevel(stage: string, level: number): number {
  const d = enemyShift(stage);
  return level > 1 && d ? Math.max(2, level + d) : level;
}

/** 修正一关的 ACT 单位（不改原数组） */
export const adjustEnemies = (stage: string, units: ActUnit[]): ActUnit[] =>
  enemyShift(stage) ? units.map((u) => (u.side === 'enemy' ? { ...u, level: enemyLevel(stage, u.level) } : u)) : units;
