import { describe, expect, it } from 'vitest';
import { cellToWorld } from '../src/game/iso.ts';
import { miniLayout, miniMaxSize, miniToWorld, worldToMini } from '../src/game/minimap.ts';

describe('小地图', () => {
  it('整张地图缩进限定尺寸，四个角都在画布里', () => {
    for (const [w, h] of [[40, 30], [64, 64], [20, 90]]) {
      const l = miniLayout(w, h, 300, 220);
      expect(l.width).toBeLessThanOrEqual(300);
      expect(l.height).toBeLessThanOrEqual(220);
      expect(Math.max(l.width / 300, l.height / 220)).toBeGreaterThan(0.99); // 至少一边撑满
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
        const c = cellToWorld(x, y);
        const p = worldToMini(l, c.x, c.y);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(l.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(l.height);
      }
    }
  });
  it('点击位置反算回世界坐标', () => {
    const l = miniLayout(50, 40, 300, 220);
    const c = cellToWorld(12, 7);
    const p = worldToMini(l, c.x, c.y);
    const w = miniToWorld(l, p.x, p.y);
    expect(w.x).toBeCloseTo(c.x);
    expect(w.y).toBeCloseTo(c.y);
  });
  it('手机上可以占到半个屏幕，电脑上较小', () => {
    expect(miniMaxSize(390, 844)).toEqual({ w: 374, h: 380 });
    expect(miniMaxSize(1440, 900)).toEqual({ w: 300, h: 220 });
  });
});
