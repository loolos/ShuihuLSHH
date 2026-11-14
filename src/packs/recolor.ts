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

/** 原版人物影子用的调色板号（Man.lib 各帧脚下的影子都是 157–159，逐帧导出像素看到的），换色、染鞋都不碰 */
export const SHADOW_COLORS: ReadonlySet<number> = new Set([157, 158, 159]);
/** 脸、手的肤色色阶（192–223），染鞋时不碰（兵器握把也在这里） */
const isSkin = (v: number) => v >= 192 && v <= 223;

/**
 * 按形状找脚染色（宋江的红鞋，负责人 2026-11-14）：鞋和衣服常用同一个色阶，只能按位置找。
 * 在身体最低的 18 行里找横向不超过 10 像素宽的连续像素（腿、脚是窄条，袍摆是宽条），连成块；
 * 块的最低点离身体最低点不超过 11 行（贴着地面）的，把块最下面 3 行按 lut 换色。
 * 长袍盖住脚的帧（站直、袍摆拖地）找不到窄条，就不染。pixels 原地修改。
 */
export function paintShoes(pixels: Uint8Array, width: number, height: number, lut: Uint8Array): void {
  const body = (k: number) => pixels[k] !== 0 && !SHADOW_COLORS.has(pixels[k]);
  let bottom = -1;
  for (let k = 0; k < pixels.length; k++) if (body(k)) bottom = Math.floor(k / width);
  if (bottom < 0) return;
  const cand = new Uint8Array(width * height);
  for (let y = Math.max(0, bottom - 18); y <= bottom; y++)
    for (let x = 0; x < width; ) {
      if (!body(y * width + x)) {
        x++;
        continue;
      }
      let e = x;
      while (e < width && body(y * width + e)) e++;
      if (e - x <= 10) cand.fill(1, y * width + x, y * width + e);
      x = e;
    }
  const seen = new Uint8Array(width * height);
  for (let k0 = 0; k0 < cand.length; k0++) {
    if (!cand[k0] || seen[k0]) continue;
    const comp: number[] = [];
    const stack = [k0];
    seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const cx = k % width;
      const cy = (k - cx) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (cand[n] && !seen[n]) (seen[n] = 1), stack.push(n);
        }
    }
    let low = 0;
    for (const k of comp) low = Math.max(low, Math.floor(k / width));
    if (comp.length < 4 || low < bottom - 11) continue;
    for (const k of comp) if (Math.floor(k / width) >= low - 2 && !isSkin(pixels[k])) pixels[k] = lut[pixels[k]];
  }
}
