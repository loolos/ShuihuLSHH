import { describe, expect, it } from 'vitest';
import { cellToWorld, HALF_H, HALF_W } from '../src/game/iso.ts';
import { miniLayout, miniMaxSize, miniToWorld, worldToMini, zoneCorners } from '../src/game/minimap.ts';
import { condZones } from '../src/rules/battle.ts';
import type { PasCond } from '../src/formats/pas.ts';

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

describe('胜负区域', () => {
  it('条件树里"选人 + 坐标范围"取成矩形，"或"的两边分开', () => {
    // N12 区块 4：朱仝死 或（选晁蓋 且 x ≥ 0 且 y ≥ 27 且 x ≤ 1 且 y ≤ 29）
    const cond: PasCond = {
      op: 'or',
      a: { type: 1, arg: 48 },
      b: { op: 'and', a: { type: 4, arg: 12 }, b: { op: 'and', a: { op: 'and', a: { type: 7, arg: 0 }, b: { type: 8, arg: 27 } }, b: { op: 'and', a: { type: 9, arg: 1 }, b: { type: 10, arg: 29 } } } },
    };
    expect(condZones(cond)).toEqual([{ char: 12, x1: 0, y1: 27, x2: 1, y2: 29 }]);
    expect(condZones({ type: 1, arg: 0xff })).toEqual([]);
  });

  it('外框是格子边缘的平行四边形', () => {
    const [top, right, bottom, left] = zoneCorners({ x1: 0, y1: 0, x2: 0, y2: 0 });
    expect(top).toEqual({ x: 0, y: -HALF_H });
    expect(right).toEqual({ x: HALF_W, y: 0 });
    expect(bottom).toEqual({ x: 0, y: HALF_H });
    expect(left).toEqual({ x: -HALF_W, y: 0 });
  });
});
