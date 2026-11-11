import { describe, expect, it } from 'vitest';
import { cellToWorld, worldToCell } from '../src/game/iso.ts';

describe('等距坐标', () => {
  it('格子中心公式', () => {
    expect(cellToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellToWorld(2, 1)).toEqual({ x: 45, y: 69 });
  });
  it('反算回同一格', () => {
    for (let x = 0; x < 20; x++)
      for (let y = 0; y < 20; y++) {
        const p = cellToWorld(x, y);
        expect(worldToCell(p.x + 10, p.y - 5)).toEqual({ x, y });
      }
  });
});
