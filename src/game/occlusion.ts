// 遮挡判断【新】（负责人 2026-11-14）：人物站在树、屋顶、城墙等地上物后面被挡住时，在遮挡物上面再画一个半透明虚影。
// 地上物按图块像素做成粗网格（BLOCK × BLOCK 像素一格，有一个不透明像素就算挡），再按世界坐标分桶，
// 每帧只查人物包围盒附近的几个桶。不依赖 Phaser，便于测试。

export const BLOCK = 8;
const BUCKET = 128;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一帧图块的不透明粗网格（cols × rows，1 = 这一块里有不透明像素） */
export interface CoarseMask {
  cols: number;
  rows: number;
  bits: Uint8Array;
}

/** 由 8 位索引帧算粗网格：索引 0 透明 */
export function coarseMask(width: number, height: number, pixels: ArrayLike<number>): CoarseMask {
  const cols = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const bits = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (pixels[y * width + x]) bits[((y / BLOCK) | 0) * cols + ((x / BLOCK) | 0)] = 1;
  return { cols, rows, bits };
}

interface Occluder {
  /** 图块左上角的世界坐标 */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  mask: CoarseMask;
}

export class OccluderIndex {
  private buckets = new Map<string, Occluder[]>();

  add(x: number, y: number, w: number, h: number, depth: number, mask: CoarseMask) {
    if (!mask.bits.some(Boolean)) return;
    const o: Occluder = { x, y, w, h, depth, mask };
    for (let by = Math.floor(y / BUCKET); by <= Math.floor((y + h - 1) / BUCKET); by++)
      for (let bx = Math.floor(x / BUCKET); bx <= Math.floor((x + w - 1) / BUCKET); bx++) {
        const k = `${bx},${by}`;
        const list = this.buckets.get(k);
        if (list) list.push(o);
        else this.buckets.set(k, [o]);
      }
  }

  /**
   * 包围盒 r 内、画在 depth 之上的不透明地上物里最大的绘制深度；没被挡住返回 null。
   * 虚影画在这个深度之上，正好压过遮挡物，又不会盖住更靠前的东西。
   */
  cover(r: Rect, depth: number): number | null {
    let best: number | null = null;
    const seen = new Set<Occluder>();
    for (let by = Math.floor(r.y / BUCKET); by <= Math.floor((r.y + r.h - 1) / BUCKET); by++)
      for (let bx = Math.floor(r.x / BUCKET); bx <= Math.floor((r.x + r.w - 1) / BUCKET); bx++) {
        const list = this.buckets.get(`${bx},${by}`);
        if (!list) continue;
        for (const o of list) {
          if (seen.has(o) || o.depth <= depth || (best !== null && o.depth <= best)) continue;
          seen.add(o);
          if (overlaps(o, r)) best = o.depth;
        }
      }
    return best;
  }
}

/** 包围盒是否碰到图块的不透明块 */
function overlaps(o: Occluder, r: Rect): boolean {
  const x0 = Math.max(o.x, r.x), x1 = Math.min(o.x + o.w, r.x + r.w);
  const y0 = Math.max(o.y, r.y), y1 = Math.min(o.y + o.h, r.y + r.h);
  if (x0 >= x1 || y0 >= y1) return false;
  const { cols, bits } = o.mask;
  const c0 = Math.floor((x0 - o.x) / BLOCK), c1 = Math.floor((x1 - 1 - o.x) / BLOCK);
  const r0 = Math.floor((y0 - o.y) / BLOCK), r1 = Math.floor((y1 - 1 - o.y) / BLOCK);
  for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) if (bits[row * cols + c]) return true;
  return false;
}
