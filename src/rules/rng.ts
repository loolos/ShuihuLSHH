// 可设种子的随机数（mulberry32）。规则引擎只通过它取随机数，便于测试和重放。
export class Rng {
  private s: number;
  constructor(seed = Date.now()) {
    this.s = seed >>> 0;
  }
  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** [0, n) 的整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** [a, b] 的整数 */
  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  /** 百分比判定：p 为 0–100 */
  chance(p: number): boolean {
    return this.next() * 100 < p;
  }
}
