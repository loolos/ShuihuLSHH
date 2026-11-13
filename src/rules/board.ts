// 棋盘：通行与寻路。格子 4 邻接，每步消耗 1 点移动力（docs/game-design.md §2.2）。
import type { MapData } from '../formats/map.ts';
import { cellPassable } from './passability.ts';
import { DIRS } from './unit.ts';

export interface Cell {
  x: number;
  y: number;
}
export const key = (x: number, y: number) => `${x},${y}`;

export class Board {
  readonly blocked: Uint8Array;
  /** 1 = 地表图块号为 0（没有地面，画出来是黑底）。不传时视为全部有地面 */
  readonly voidCells: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    blocked?: Uint8Array,
    voidCells?: Uint8Array,
  ) {
    this.blocked = blocked ?? new Uint8Array(width * height);
    this.voidCells = voidCells ?? new Uint8Array(width * height);
  }

  /**
   * 按 EXE 0x40bc30 的规则算出每格是否可通行（见 docs/binary-formats.md §5.1）：
   * - 地表图块号为 0，或地表 Ground.att = 0xFF → 阻挡；
   * - 没有地上物 → 可通行；
   * - 只看第一层地上物：高度（flags）与地表相同时按 Upper.att 判断（0xFF 阻挡）；
   *   比地表高 ≥ 0x40（悬在头顶的树冠、屋檐等）→ 可通行；比地表低 → 阻挡。
   */
  static fromMap(map: MapData, groundAtt: Uint8Array, upperAtt: Uint8Array): Board {
    const b = new Board(map.width, map.height);
    map.cells.forEach((layers, i) => {
      if (!cellPassable(layers, groundAtt, upperAtt)) b.blocked[i] = 1;
      if (layers[0].tile === 0) b.voidCells[i] = 1;
    });
    return b;
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  /** 格子在地图里且有地面（地表图块号不为 0）。站在地面以外的单位会画在地图菱形之外的黑底上 */
  onGround(x: number, y: number) {
    return this.inBounds(x, y) && !this.voidCells[y * this.width + x];
  }
  passable(x: number, y: number) {
    return this.onGround(x, y) && !this.blocked[y * this.width + x];
  }

  /**
   * 从 start 出发、预算 budget 内能到达的格子（BFS）。blocked 中的格子不能进入也不能穿越；
   * passThrough 中的格子（同阵营的我方/友军）可以穿越但不能停留，所以不出现在结果里，
   * 只记在下一个落脚格的 via 里（pathTo 会把它们放回路径）。返回 key → {cost, prev, via}，含起点。
   */
  reach(start: Cell, budget: number, blocked: Set<string>, passThrough: Set<string> = new Set()): Map<string, ReachNode> {
    const out = new Map<string, ReachNode>();
    // 所有走到过的格子（含只能穿越的），用来还原路径
    const seen = new Map<string, { x: number; y: number; prev: string | null }>();
    const startKey = key(start.x, start.y);
    out.set(startKey, { x: start.x, y: start.y, cost: 0, prev: null });
    seen.set(startKey, { x: start.x, y: start.y, prev: null });
    let frontier: Cell[] = [start];
    for (let c = 1; c <= budget && frontier.length; c++) {
      const next: Cell[] = [];
      for (const f of frontier)
        for (const d of DIRS) {
          const x = f.x + d.x, y = f.y + d.y, k = key(x, y);
          if (seen.has(k) || !this.passable(x, y) || blocked.has(k)) continue;
          seen.set(k, { x, y, prev: key(f.x, f.y) });
          next.push({ x, y });
          if (passThrough.has(k)) continue;
          // 往回找到最近的落脚格，中间穿过的格子记进 via
          const via: Cell[] = [];
          let pk = key(f.x, f.y);
          while (!out.has(pk)) {
            const n = seen.get(pk)!;
            via.unshift({ x: n.x, y: n.y });
            pk = n.prev!;
          }
          out.set(k, via.length ? { x, y, cost: c, prev: pk, via } : { x, y, cost: c, prev: pk });
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

export interface ReachNode {
  x: number;
  y: number;
  cost: number;
  /** 上一个落脚格 */
  prev: string | null;
  /** 从上一个落脚格到这里中间穿过的格子（同阵营单位占着的） */
  via?: Cell[];
}

export function pathTo(reach: Map<string, { x: number; y: number; prev: string | null; via?: Cell[] }>, x: number, y: number): Cell[] {
  const path: Cell[] = [];
  let k: string | null = key(x, y);
  while (k) {
    const n = reach.get(k);
    if (!n) return [];
    path.unshift({ x: n.x, y: n.y });
    if (n.via) path.unshift(...n.via);
    k = n.prev;
  }
  return path;
}

