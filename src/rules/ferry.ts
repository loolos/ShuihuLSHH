// 夺渡口【新】（白龙庙，负责人 2026-11-28，docs/game-design.md §15.23.1）：几块 3×3 的渡口，
// 每整回合结束（敌方行动完）数区域里两边的人，人多的一边占下；占着的一边每回合在渡口刷 1–2 个小兵（友军 / 敌方回合开始时刷，当回合就动）；
// 我方每占一个渡口每回合攒 1 点援军点数，攒够一档就来下一拨好汉。守渡 / 夺渡的人走 AI 17（src/rules/ai.ts）。
import type { Cell } from './board.ts';

export type FerrySide = 'ours' | 'enemy';

export interface FerryZone {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FerryInput {
  zones: FerryZone[];
  /** 守渡的人只理会离渡口这么多格以内的对手 */
  radius: number;
  /** 渡口有这么多人在守，新刷出来的兵就去进攻 */
  hold: number;
  /** 每回合每个渡口刷几个兵（含两端，随机） */
  spawn: [number, number];
  /** 每个渡口的兵源（ACT 序号）：我方喽啰、敌方官兵，各自同时最多活这么多人 */
  pools: { ours: number[][]; enemy: number[][] };
  /** 援军：点数到 at 就来这拨人（在白龙庙旁开场写好的位置登场），设上剧本标志 flag */
  waves: { at: number; units: number[]; flag: number; name: string }[];
  /** 开场守渡口的人：ACT 序号 → 第几个渡口 */
  bind: Record<number, number>;
  /** 我方占着至少 n 个渡口时设上标志 flag（不够就清掉），胜负条件用 */
  heldFlags: { n: number; flag: number }[];
  /** 援军都到齐后，每再攒这么多点就在开场位置复活一位倒下的好汉（一次一个，等级高的先；负责人 2026-11-28） */
  revive?: number;
  /** 我方刚占齐全部渡口的那个回合末，在开场位置刷出这些人（都监身边的马军，负责人 2026-11-28；还活着的不重刷） */
  allHeld?: number[];
  /** 我方夺下一处渡口后，下个敌方回合开始时 by（都监）从离那处渡口最近的敌兵里挑 n[0]–n[1] 个去夺回（负责人 2026-11-28） */
  dispatch?: { by: number; n: [number, number] };
  /** 开场归属，不写都是敌方 */
  owner?: FerrySide[];
}

export interface FerryState {
  owner: FerrySide[];
  points: number;
  /** 下一拨援军的序号 */
  wave: number;
  /** 已经复活了几个人 */
  revived?: number;
  /** 刚占齐全部渡口，下个敌方回合开始时加刷 allHeld */
  allHeldDue?: boolean;
  /** 刚被我方夺下、等着都监派兵去夺回的渡口 */
  lostDue?: number[];
  /** 都监派去夺渡口的人（重新刷出来时任务清掉） */
  sent?: Record<number, true>;
  /** 守（d）还是攻（a） */
  role: Record<number, 'd' | 'a'>;
  /** 这人属于哪个渡口 */
  home: Record<number, number>;
}

/** 格子到渡口区域的步数（区域里是 0） */
export function zoneDist(z: FerryZone, c: Cell): number {
  return Math.max(0, z.x1 - c.x, c.x - z.x2) + Math.max(0, z.y1 - c.y, c.y - z.y2);
}

export const inZone = (z: FerryZone, c: Cell) => zoneDist(z, c) === 0;

export const zoneCenter = (z: FerryZone): Cell => ({ x: (z.x1 + z.x2) >> 1, y: (z.y1 + z.y2) >> 1 });

export function zoneCells(z: FerryZone): Cell[] {
  const out: Cell[] = [];
  for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) out.push({ x, y });
  return out;
}
