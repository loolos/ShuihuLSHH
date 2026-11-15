// 把地图渲染成整张等距预览图（RGBA），render-maps.ts 和 compose-map.ts 共用。
// 渲染假设见 render-maps.ts 开头。
import fs from 'node:fs';
import path from 'node:path';
import { openGrp, parsePalette, type Frame } from '../src/formats/image.ts';
import type { MapData } from '../src/formats/map.ts';
import { cellToWorld } from '../src/game/iso.ts';
import { cellPassable } from '../src/rules/passability.ts';

export interface MarkUnit { x: number; y: number; side: string }
const HW = 45, HH = 23;
const SIDE_COLORS: Record<string, [number, number, number]> = {
  player: [40, 120, 255],
  ally: [40, 200, 80],
  enemy: [230, 40, 40],
  object: [250, 210, 30],
  unknown: [200, 0, 200],
};

export function openTiles(data: string) {
  const read = (...p: string[]) => fs.readFileSync(path.join(data, ...p));
  return {
    pal: parsePalette(read('Data', 'Default.pal')),
    ground: openGrp(read('Data', 'Ground.grp'), 'Ground.grp'),
    upper: openGrp(read('Data', 'Upper.grp'), 'Upper.grp'),
    groundAtt: read('Data', 'Ground.att').subarray(8),
    upperAtt: read('Data', 'Upper.att').subarray(8),
  };
}
export type Tiles = ReturnType<typeof openTiles>;

/** 渲染整张地图；pass：不可通行的格子涂红；grid：每 6 格画一条坐标线并标数字（拼图时对坐标用） */
export function renderMap(t: Tiles, m: MapData, units: MarkUnit[] = [], opts: { pass?: boolean } = {}): { W: number; H: number; rgba: Uint8Array } {
  const { pal, ground, upper, groundAtt, upperAtt } = t;
  const W = (m.width + m.height) * HW + 200;
  const H = (m.width + m.height) * HH + 300;
  const ox = m.height * HW + 100, oy = 200;
  const rgba = new Uint8Array(W * H * 4);
  const blit = (fr: Frame, cx: number, cy: number) => {
    const x0 = cx - fr.anchorX, y0 = cy - fr.anchorY;
    for (let y = 0; y < fr.height; y++) {
      const py = y0 + y;
      if (py < 0 || py >= H) continue;
      for (let x = 0; x < fr.width; x++) {
        const c = fr.pixels[y * fr.width + x];
        const px = x0 + x;
        if (!c || px < 0 || px >= W) continue;
        const o = (py * W + px) * 4;
        rgba[o] = pal[c * 3]; rgba[o + 1] = pal[c * 3 + 1]; rgba[o + 2] = pal[c * 3 + 2]; rgba[o + 3] = 255;
      }
    }
  };
  const center = (x: number, y: number, height = 0) => {
    const p = cellToWorld(x, y, height);
    return [ox + p.x, oy + p.y];
  };
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const [cx, cy] = center(x, y);
      if (m.cells[y * m.width + x][0].tile) blit(ground.frame(m.cells[y * m.width + x][0].tile), cx, cy); // 0 = 地图外
    }
  for (let d = 0; d < m.width + m.height - 1; d++)
    for (let x = 0; x < m.width; x++) {
      const y = d - x;
      if (y < 0 || y >= m.height) continue;
      const [cx, cy] = center(x, y);
      for (const l of m.cells[y * m.width + x].slice(1)) blit(upper.frame(l.tile), cx, cy - l.flags);
    }
  if (opts.pass)
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        if (cellPassable(m.cells[y * m.width + x], groundAtt, upperAtt)) continue;
        const [cx, cy] = center(x, y);
        for (let dy = -HH + 2; dy <= HH - 2; dy++) {
          const half = Math.floor((HW - 3) * (1 - Math.abs(dy) / HH));
          for (let dx = -half; dx <= half; dx++) {
            const px = cx + dx, py = cy + dy;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const o = (py * W + px) * 4;
            rgba[o] = (rgba[o] + 255) >> 1; rgba[o + 1] >>= 1; rgba[o + 2] >>= 1; rgba[o + 3] = 255;
          }
        }
      }
  for (const u of units) {
    const [cx, cy] = center(u.x, u.y);
    const [r, g, b] = SIDE_COLORS[u.side] ?? SIDE_COLORS.unknown;
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        if (dx * dx + dy * dy > 64) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4;
        const edge = dx * dx + dy * dy > 40;
        rgba[o] = edge ? 0 : r; rgba[o + 1] = edge ? 0 : g; rgba[o + 2] = edge ? 0 : b; rgba[o + 3] = 255;
      }
  }
  return { W, H, rgba };
}
