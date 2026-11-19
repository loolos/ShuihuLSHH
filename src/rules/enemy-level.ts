// 自有敌方等级系统：按关卡和单位索引配置绝对等级，与 ACT 的 level 无关。
// ACT 只提供单位身份、位置、装备和事件；扩展包沿用自己的关卡 JSON。
import type { ActUnit } from '../formats/act.ts';
import table from '../data/enemy-levels.json' with { type: 'json' };

interface EnemyEntry {
  classId: number;
  level: number;
}
const STAGES: Record<string, Record<string, EnemyEntry>> = table.stages;

/** 估算工具可关闭动态保底，基础等级始终读取自有配置。 */
export const ENEMY_LEVEL = { floor: true };

/** 单位 index 是关卡 ACT 的稳定索引，不是敌人顺序号或职业号。 */
export function enemyLevel(stage: string, index: number, classId: number): number {
  const entry = STAGES[stage.toLowerCase()]?.[index];
  if (!entry) throw new Error(`${stage}: 敌方单位 ${index} 缺少自有等级配置`);
  if (entry.classId !== classId) throw new Error(`${stage}: 敌方单位 ${index} 职业与等级配置不符`);
  if (!Number.isInteger(entry.level) || entry.level < 1) throw new Error(`${stage}: 敌方单位 ${index} 等级必须为正整数`);
  return entry.level;
}

/** 所有敌人都覆盖，包括 1 级剧情单位；缺配置时报错，不回退原剧本等级。 */
export const adjustEnemies = (stage: string, units: ActUnit[]): ActUnit[] =>
  units.map((u) => u.side === 'enemy' ? { ...u, level: enemyLevel(stage, u.index, u.type) } : u);

/** 敌人等级保底比我方平均等级低几级（负责人 2026-11-13） */
export const FLOOR_GAP = 5;

/**
 * 敌人等级保底【新】（负责人 2026-11-13）：每关开场时看我方（这一关出场的人）的平均等级，
 * 2 级以上的敌人不低于「平均 − FLOOR_GAP」，免得我方练得高时敌人太弱。没有我方人物时为 0。
 */
export function enemyFloor(playerLevels: number[]): number {
  if (!ENEMY_LEVEL.floor || !playerLevels.length) return 0;
  return Math.round(playerLevels.reduce((a, b) => a + b, 0) / playerLevels.length) - FLOOR_GAP;
}

/** 战斗关的最终等级区间；剧情演员和陪练不套用。骑兵/刺客是战斗兵种，不因属性模板为officer而算首领。 */
export type EnemyRank = 'troop' | 'leader';
const TROOP_LEVEL_CLASSES = new Set([19,20,21,22,23,32,33,34,36,37,40,41,43,44,45,66,67]);
export function enemyRank(classId: number): EnemyRank {
  return TROOP_LEVEL_CLASSES.has(classId) ? 'troop' : 'leader';
}
export function relativeEnemyLevel(base: number, heroAverage: number, rank: EnemyRank): number {
  const mid=Math.max(1,Math.round(heroAverage));
  const [low,high]=rank==='troop'?[Math.max(1,mid-3),mid]:[mid,mid+3];
  return Math.max(low,Math.min(high,Math.round(base)));
}
