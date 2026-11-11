// 棋盘：通行与寻路。格子 4 邻接，每步消耗 1 点移动力（docs/game-design.md §2.2）。
import type { MapData } from '../formats/map.ts';
import { DIRS } from './unit.ts';

export interface Cell {
  x: number;
  y: number;
}
export const key = (x: number, y: number) => `${x},${y}`;

export class Board {
  readonly blocked: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    blocked?: Uint8Array,
  ) {
    this.blocked = blocked ?? new Uint8Array(width * height);
  }

  /** 图块属性 0xFF = 不可通行（Ground.att / Upper.att，任一层阻挡即阻挡；推测，见 binary-formats §6） */
  static fromMap(map: MapData, groundAtt: Uint8Array, upperAtt: Uint8Array): Board {
    const b = new Board(map.width, map.height);
    map.cells.forEach((layers, i) => {
      if (groundAtt[layers[0].tile] === 0xff || layers.slice(1).some((l) => upperAtt[l.tile] === 0xff)) b.blocked[i] = 1;
    });
    return b;
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  passable(x: number, y: number) {
    return this.inBounds(x, y) && !this.blocked[y * this.width + x];
  }

  /**
   * 从 start 出发、预算 budget 内能到达的格子（BFS）。occupied 中的格子不能进入也不能穿越。
   * 返回 key → {cost, prev}，含起点。
   */
  reach(start: Cell, budget: number, occupied: Set<string>): Map<string, { x: number; y: number; cost: number; prev: string | null }> {
    const out = new Map<string, { x: number; y: number; cost: number; prev: string | null }>();
    out.set(key(start.x, start.y), { ...start, cost: 0, prev: null });
    let frontier: Cell[] = [start];
    for (let c = 1; c <= budget && frontier.length; c++) {
      const next: Cell[] = [];
      for (const f of frontier)
        for (const d of DIRS) {
          const x = f.x + d.x, y = f.y + d.y, k = key(x, y);
          if (out.has(k) || !this.passable(x, y) || occupied.has(k)) continue;
          out.set(k, { x, y, cost: c, prev: key(f.x, f.y) });
          next.push({ x, y });
        }
      frontier = next;
    }
    return out;
  }

  /** 到目标的地形距离场（忽略单位）。不可达为 Infinity。 */
  distanceField(goals: Cell[]): Float32Array {
    const d = new Float32Array(this.width * this.height).fill(Infinity);
    let frontier: Cell[] = [];
    for (const g of goals) if (this.inBounds(g.x, g.y)) {
      d[g.y * this.width + g.x] = 0;
      frontier.push(g);
    }
    for (let c = 1; frontier.length; c++) {
      const next: Cell[] = [];
      for (const f of frontier)
        for (const dir of DIRS) {
          const x = f.x + dir.x, y = f.y + dir.y;
          if (!this.passable(x, y) || d[y * this.width + x] <= c) continue;
          d[y * this.width + x] = c;
          next.push({ x, y });
        }
      frontier = next;
    }
    return d;
  }

  /** 最近的可通行空格（螺旋搜索），用于事件放出单位时目标格被占的情况 */
  nearestFree(x: number, y: number, occupied: Set<string>): Cell | null {
    for (let r = 0; r < Math.max(this.width, this.height); r++)
      for (let dx = -r; dx <= r; dx++)
        for (const dy of r - Math.abs(dx) === 0 ? [0] : [r - Math.abs(dx), -(r - Math.abs(dx))]) {
          const cx = x + dx, cy = y + dy;
          if (this.passable(cx, cy) && !occupied.has(key(cx, cy))) return { x: cx, y: cy };
        }
    return null;
  }
}

export function pathTo(reach: Map<string, { x: number; y: number; prev: string | null }>, x: number, y: number): Cell[] {
  const path: Cell[] = [];
  let k: string | null = key(x, y);
  while (k) {
    const n = reach.get(k);
    if (!n) return [];
    path.unshift({ x: n.x, y: n.y });
    k = n.prev;
  }
  return path;
}
