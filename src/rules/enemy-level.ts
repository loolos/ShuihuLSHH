// 敌人等级的运行时规则：保底、等级档。原版关卡敌人的自有等级直接写在 gamedata/stages/*.json（units[].level）。

/** 估算工具可关闭动态保底 */
export const ENEMY_LEVEL = { floor: true };

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
