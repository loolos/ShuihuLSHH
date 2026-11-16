// 把 Map\*.map 渲染成整张等距预览图（extracted/maps/*.png，不入库），并叠加 ACT 单位标记。
// 渲染假设（待游戏截图验证，见 docs/binary-formats.md §5）：
//   格子 (x, y) 的屏幕中心 = ((x − y) × 45, (x + y) × 23)；先画全部地表，再按 x+y 从远到近画地上物；
//   图块按锚点对齐，MAP flags 为像素高度，屏幕 Y 减去高度（EXE 0x40f76a）。
// 用法：node tools/render-maps.ts [--pass] [原版目录] [地图名...]
//   --pass：把不可通行的格子涂成半透明红色（规则见 src/rules/passability.ts）
import fs from 'node:fs';
import path from 'node:path';
import { parseMap } from '../src/formats/map.ts';
import { parseAct } from '../src/formats/act.ts';
import { encodePng } from '../src/formats/png.ts';
import { openTiles, renderMap } from './render-lib.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const showPass = args[0] === '--pass';
if (showPass) args.shift();
const DATA = path.resolve(args[0] ?? process.env.SHUIHU_DATA ?? path.join(ROOT, 'gamedata/shuihu'));
const only = args.slice(1).map((s) => s.toLowerCase());
const OUT = path.join(ROOT, 'extracted/maps');
fs.mkdirSync(OUT, { recursive: true });

const read = (...p: string[]) => fs.readFileSync(path.join(DATA, ...p));
const tiles = openTiles(DATA);

for (const f of fs.readdirSync(path.join(DATA, 'Map')).filter((f) => f.toLowerCase().endsWith('.map'))) {
  const name = f.replace(/\.map$/i, '');
  if (only.length && !only.includes(name.toLowerCase())) continue;
  const m = parseMap(read('Map', f), f);
  const actFile = fs.readdirSync(path.join(DATA, 'Map')).find((g) => g.toLowerCase() === `${name}.act`.toLowerCase());
  const units = actFile ? parseAct(read('Map', actFile), actFile) : [];
  const { W, H, rgba } = renderMap(tiles, m, units, { pass: showPass });
  fs.writeFileSync(path.join(OUT, `${name}${showPass ? '-pass' : ''}.png`), encodePng(W, H, rgba));
  console.log(`${name}${showPass ? '-pass' : ''}.png ${W}×${H} units=${units.length}`);
}
