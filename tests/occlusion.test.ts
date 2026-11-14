import { describe, expect, it } from 'vitest';
import { BLOCK, coarseMask, OccluderIndex } from '../src/game/occlusion.ts';

describe('遮挡判断', () => {
  it('粗网格只标出有不透明像素的块', () => {
    const w = BLOCK * 2, h = BLOCK;
    const px = new Uint8Array(w * h);
    px[BLOCK + 3] = 5; // 右边那块
    const m = coarseMask(w, h, px);
    expect([...m.bits]).toEqual([0, 1]);
  });

  it('只算画在人物前面、而且碰到不透明块的地上物，返回最靠前的深度', () => {
    const w = BLOCK * 2, h = BLOCK;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) px[y * w + BLOCK] = 1; // 只有右半块不透明
    const idx = new OccluderIndex();
    idx.add(100, 100, w, h, 50, coarseMask(w, h, px));
    idx.add(100, 100, w, h, 60, coarseMask(w, h, px));
    // 只碰到透明的左半块
    expect(idx.cover({ x: 90, y: 90, w: 12, h: 30 }, 10)).toBeNull();
    // 碰到右半块：取最靠前的 60
    expect(idx.cover({ x: 110, y: 90, w: 12, h: 30 }, 10)).toBe(60);
    // 人物自己画得更靠前，不算挡
    expect(idx.cover({ x: 110, y: 90, w: 12, h: 30 }, 60)).toBeNull();
    expect(idx.cover({ x: 110, y: 90, w: 12, h: 30 }, 55)).toBe(60);
  });

  it('全透明的图块不进索引', () => {
    const idx = new OccluderIndex();
    idx.add(0, 0, 8, 8, 50, coarseMask(8, 8, new Uint8Array(64)));
    expect(idx.cover({ x: 0, y: 0, w: 8, h: 8 }, 0)).toBeNull();
  });
});
