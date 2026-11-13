// 等距坐标：格子 (x, y, 高度) 的屏幕中心 = ((x − y) × 45, (x + y) × 23 − 高度)。
// MAP 高度直接作像素偏移（EXE 0x40f761–0x40f76a、0x40f782–0x40f78b）。
export const HALF_W = 45;
export const HALF_H = 23;

export function cellToWorld(x: number, y: number, height = 0): { x: number; y: number } {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H - height };
}

/** 屏幕坐标反算格子（取最近的格子中心）。 */
export function worldToCell(wx: number, wy: number): { x: number; y: number } {
  const a = wx / HALF_W;
  const b = wy / HALF_H;
  // 等距变换把正方形格子映射成菱形，所以在格子坐标系里分别四舍五入即可（+ 0 去掉 −0）
  return { x: Math.round((a + b) / 2) + 0, y: Math.round((b - a) / 2) + 0 };
}

/** 绘制深度：按 x + y 从远到近；同一格内按图层顺序。 */
export function depthOf(x: number, y: number, layer: number): number {
  return (x + y) * 16 + layer;
}
