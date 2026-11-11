// 把 Map\*.map 渲染成整张等距预览图（extracted/maps/*.png，不入库），并叠加 ACT 单位标记。
// 渲染假设（待游戏截图验证，见 docs/binary-formats.md §5）：
//   格子 (x, y) 的屏幕中心 = ((x − y) × 45, (x + y) × 23)；先画全部地表，再按 x+y 从远到近画地上物；
//   图块按锚点对齐格子中心；flags 暂不处理。
// 用法：node tools/render-maps.ts [原版目录] [地图名...]
import fs from 'node:fs';
import path from 'node:path';
import { openGrp, parsePalette, type Frame } from '../src/formats/image.ts';
import { parseMap } from '../src/formats/map.ts';
import { parseAct } from '../src/formats/act.ts';
import { encodePng } from '../src/formats/png.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.resolve(process.argv[2] ?? process.env.SHUIHU_DATA ?? path.join(ROOT, 'gamedata/shuihu'));
const only = process.argv.slice(3).map((s) => s.toLowerCase());
const OUT = path.join(ROOT, 'extracted/maps');
fs.mkdirSync(OUT, { recursive: true });

const read = (...p: string[]) => fs.readFileSync(path.join(DATA, ...p));
const pal = parsePalette(read('Data', 'Default.pal'));
const ground = openGrp(read('Data', 'Ground.grp'), 'Ground.grp');
const upper = openGrp(read('Data', 'Upper.grp'), 'Upper.grp');
const HW = 45, HH = 23;
const SIDE_COLORS: Record<string, [number, number, number]> = {
  player: [40, 120, 255],
  ally: [40, 200, 80],
  enemy: [230, 40, 40],
  object: [250, 210, 30],
  unknown: [200, 0, 200],
};

for (const f of fs.readdirSync(path.join(DATA, 'Map')).filter((f) => f.toLowerCase().endsWith('.map'))) {
  const name = f.replace(/\.map$/i, '');
  if (only.length && !only.includes(name.toLowerCase())) continue;
  const m = parseMap(read('Map', f), f);
  const actFile = fs.readdirSync(path.join(DATA, 'Map')).find((g) => g.toLowerCase() === `${name}.act`.toLowerCase());
  const units = actFile ? parseAct(read('Map', actFile), actFile) : [];
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
  const center = (x: number, y: number) => [ox + (x - y) * HW, oy + (x + y) * HH];
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const [cx, cy] = center(x, y);
      blit(ground.frame(m.cells[y * m.width + x][0].tile), cx, cy);
    }
  for (let d = 0; d < m.width + m.height - 1; d++)
    for (let x = 0; x < m.width; x++) {
      const y = d - x;
      if (y < 0 || y >= m.height) continue;
      const [cx, cy] = center(x, y);
      for (const l of m.cells[y * m.width + x].slice(1)) blit(upper.frame(l.tile), cx, cy);
    }
  for (const u of units) {
    const [cx, cy] = center(u.x, u.y);
    const [r, g, b] = SIDE_COLORS[u.side];
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
  fs.writeFileSync(path.join(OUT, `${name}.png`), encodePng(W, H, rgba));
  console.log(`${name}.png ${W}×${H} units=${units.length}`);
}
