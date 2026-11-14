// 扩展包职业借原版动画时的换色（docs/game-design.md §15.2）：按调色板号重映射，结果是 256 项的查找表。
// 每组把 src 里的调色板号换到 dst 色阶里亮度最接近的那一格（亮度先乘 k 再加 b，用来整体调亮 / 调暗）。
// Default.pal 是 16 色一组的色阶（如 16–31 白→黑、144–159 浅紫→深蓝），换色就是把一件衣服的色阶整体搬到另一个色阶。

export interface RecolorGroup {
  /** 要换的调色板号范围（闭区间），可以几段 */
  src: [number, number][];
  /** 换到哪个色阶（闭区间） */
  dst: [number, number];
  /** 亮度系数，默认 1 */
  k?: number;
  /** 亮度偏移（0–255），默认 0 */
  b?: number;
}

const luma = (pal: Uint8Array, i: number) => 0.299 * pal[i * 3] + 0.587 * pal[i * 3 + 1] + 0.114 * pal[i * 3 + 2];

/** 换色查找表：lut[原调色板号] = 新调色板号；0（透明）永远不换 */
export function recolorLut(pal: Uint8Array, groups: RecolorGroup[]): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  for (const g of groups) {
    const [d0, d1] = g.dst;
    for (const [s0, s1] of g.src)
      for (let i = Math.max(1, s0); i <= s1 && i < 256; i++) {
        const want = luma(pal, i) * (g.k ?? 1) + (g.b ?? 0);
        let best = d0, bestD = Infinity;
        for (let j = d0; j <= d1; j++) {
          const d = Math.abs(luma(pal, j) - want);
          if (d < bestD) (best = j), (bestD = d);
        }
        lut[i] = best;
      }
  }
  return lut;
}
