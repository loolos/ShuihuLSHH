import fs from 'node:fs';
import { parseMap } from '../src/formats/map.ts';
import { describe, expect, it } from 'vitest';
import { cellToWorld, worldToCell } from '../src/game/iso.ts';

describe('等距坐标', () => {
  it('格子中心公式', () => {
    expect(cellToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellToWorld(2, 1)).toEqual({ x: 45, y: 69 });
  });
  it('地图高度按像素抬高，城门楼各层不挤在地面', () => {
    const base = cellToWorld(16, 8);
    for (const height of [0, 64, 128, 192]) {
      expect(cellToWorld(16, 8, height)).toEqual({ x: base.x, y: base.y - height });
    }
    expect(cellToWorld(16, 8, 192).y).toBe(360);
  });
  it('反算回同一格', () => {
    for (let x = 0; x < 20; x++)
      for (let y = 0; y < 20; y++) {
        const p = cellToWorld(x, y);
        expect(worldToCell(p.x + 10, p.y - 5)).toEqual({ x, y });
      }
  });
});

describe('点击判定按格子菱形', () => {
  it('菱形内靠近四个顶点的点都落在本格', () => {
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 10; y++) {
        const p = cellToWorld(x, y);
        const e = 0.9;
        expect(worldToCell(p.x, p.y - 23 * e)).toEqual({ x, y }); // 上
        expect(worldToCell(p.x, p.y + 23 * e)).toEqual({ x, y }); // 下
        expect(worldToCell(p.x - 45 * e, p.y)).toEqual({ x, y }); // 左
        expect(worldToCell(p.x + 45 * e, p.y)).toEqual({ x, y }); // 右
      }
  });
  it('越过菱形边就是相邻格', () => {
    const p = cellToWorld(5, 5);
    expect(worldToCell(p.x, p.y - 23 * 1.1)).toEqual({ x: 4, y: 4 });
    expect(worldToCell(p.x + 22.5 * 1.1, p.y - 11.5 * 1.1)).toEqual({ x: 5, y: 4 });
    expect(worldToCell(p.x - 22.5 * 1.1, p.y - 11.5 * 1.1)).toEqual({ x: 4, y: 5 });
  });
  it('人物身体盖住的身后格子仍然按格子判定', () => {
    // 站在 (5,5) 的人物身体向上画约 80 像素，盖住 (4,4)、(3,3) 等格；点那里应得到后面的格子
    const front = cellToWorld(5, 5);
    expect(worldToCell(front.x, front.y - 46)).toEqual({ x: 4, y: 4 });
    expect(worldToCell(front.x, front.y - 75)).toEqual({ x: 3, y: 3 });
  });
});

const gateMap = new URL('../gamedata/shuihu/Map/N-add04a.map', import.meta.url);
it.skipIf(!fs.existsSync(gateMap))('官道遇伏兵的门楼屋顶按原地图抬到192像素高度', () => {
  const map = parseMap(fs.readFileSync(gateMap));
  const layers = map.cells[8 * map.width + 16];
  expect(layers.map((l) => [l.tile, l.flags])).toEqual([[596, 0], [891, 0], [1017, 128], [956, 192]]);
  expect(layers.map((l) => cellToWorld(16, 8, l.flags).y)).toEqual([552, 552, 424, 360]);
});
