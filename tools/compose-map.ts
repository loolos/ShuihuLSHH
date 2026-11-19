// 按配方拼一张新地图（§15.15）：只用原版图块号和原版地图的坐标，输出 packs/maps/<名字>.json（不含原版图像），
// 再把预览图写到 extracted/maps/custom-<名字>.png（不入库），并检查通行区域是否连成一片。
// 用法：node --experimental-transform-types tools/compose-map.ts [配方名...]   （配方在 tools/map-recipes/<名字>.json；不写就全部重拼）
//       加 --pass 时预览图把不可通行的格子涂红。
//
// 配方：{ "width", "height", "seed", "ops": [...] }，ops 按顺序执行，后面的盖前面的：
//   { "op": "ground", "rect": [x,y,w,h], "tiles": [地表号...] }            随机铺地表（只改地表，地上物不动）
//   { "op": "stamp", "from": "N05", "src": [x,y,w,h], "at": [x,y],         从原版地图拷一块（全部图层，含高度）
//     "repeat": [nx,ny], "layers": "all" | "upper" | "ground" }             repeat：把这一块横竖重复几次（拼长墙、长栏杆）；
//                                                                           layers=upper：只拷地上物、保留新图的地表；ground：只拷地表
//   { "op": "clear", "rect": [x,y,w,h] }                                   清掉地上物
//   { "op": "put", "at": [x,y], "upper": [[图块, 高度], ...] }               在一格上加地上物（叠在已有的上面）
//   { "op": "scatter", "rect": [x,y,w,h], "tiles": [...], "density": 0.1 } 在没有地上物的格子里随机撒（树、草、石）
//   { "op": "line", "at": [x,y], "dir": "x"|"y", "len": n,                  沿 x 或 y 方向一格一格加地上物（墙、栏杆、篱笆）：
//     "pattern": [[[图块, 高度], ...], ...], "ends": [[[...]], [[...]]] }    pattern 循环使用；ends 可选，首尾两格单独指定（墙角、栏杆柱头）
//                                                                           同一种墙沿 x 和沿 y 是不同的图块（见 tools/map-recipes/README.md）
//   { "op": "void", "rect": [x,y,w,h] }                                    设成地图外（地表 0，不画也不能走）
// 坐标：x 向右下、y 向左下（同 render-maps 的预览图）。
import fs from 'node:fs';
import path from 'node:path';
import { mapFromJson, mapToJson, type MapData, type MapLayer } from '../src/formats/map.ts';
import { encodePng } from '../src/formats/png.ts';
import { cellPassable } from '../src/rules/passability.ts';
import { openTiles, renderMap } from './render-lib.ts';

type Rect = [number, number, number, number];
type Op =
  | { op: 'ground'; rect: Rect; tiles: number[] }
  | { op: 'stamp'; from: string; src: Rect; at: [number, number]; repeat?: [number, number]; layers?: 'all' | 'upper' | 'ground' }
  | { op: 'clear'; rect: Rect }
  | { op: 'put'; at: [number, number]; upper: [number, number][] }
  | { op: 'scatter'; rect: Rect; tiles: number[]; density: number }
  | { op: 'line'; at: [number, number]; dir: 'x' | 'y'; len: number; pattern: [number, number][][]; ends?: [[number, number][] | null, [number, number][] | null]; replace?: boolean }
  | { op: 'void'; rect: Rect };
export interface Recipe {
  title?: string;
  width: number;
  height: number;
  seed?: number;
  ops: Op[];
}

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.resolve(process.env.SHUIHU_DATA ?? path.join(ROOT, 'gamedata/original'));
const RECIPES = path.join(ROOT, 'tools/map-recipes');

/** 小而稳定的随机数（mulberry32），同一配方每次拼出来一样 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const originals = new Map<string, MapData>();
function original(name: string): MapData {
  let m = originals.get(name);
  if (!m) {
    const dir = path.join(ROOT, 'gamedata/maps');
    const f = fs.readdirSync(dir).find((g) => g.toLowerCase() === `${name.toLowerCase()}.json`);
    if (!f) throw new Error(`没有原版地图 ${name}`);
    originals.set(name, (m = mapFromJson(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f)));
  }
  return m;
}

export function compose(r: Recipe): MapData {
  const { width, height } = r;
  const rand = rng(r.seed ?? 1);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const cells: MapLayer[][] = Array.from({ length: width * height }, () => [{ tile: 0, flags: 0 }]);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const each = ([x0, y0, w, h]: Rect, fn: (x: number, y: number) => void) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) fn(x, y);
  };
  for (const op of r.ops) {
    switch (op.op) {
      case 'ground':
        each(op.rect, (x, y) => (cells[y * width + x][0] = { tile: pick(op.tiles), flags: 0 }));
        break;
      case 'void':
        each(op.rect, (x, y) => (cells[y * width + x] = [{ tile: 0, flags: 0 }]));
        break;
      case 'clear':
        each(op.rect, (x, y) => (cells[y * width + x] = cells[y * width + x].slice(0, 1)));
        break;
      case 'put': {
        const [x, y] = op.at;
        if (!inside(x, y)) throw new Error(`put 出界 (${x},${y})`);
        cells[y * width + x].push(...op.upper.map(([tile, flags]) => ({ tile, flags })));
        break;
      }
      case 'line':
        for (let i = 0; i < op.len; i++) {
          const x = op.at[0] + (op.dir === 'x' ? i : 0), y = op.at[1] + (op.dir === 'y' ? i : 0);
          if (!inside(x, y)) throw new Error(`line 出界 (${x},${y})`);
          const stack = (i === 0 && op.ends?.[0]) || (i === op.len - 1 && op.ends?.[1]) || op.pattern[i % op.pattern.length];
          const c = cells[y * width + x];
          // 默认先清掉这格原有的地上物（墙压在树上不好看）
          if (op.replace !== false) c.length = 1;
          c.push(...stack.map(([tile, flags]) => ({ tile, flags })));
        }
        break;
      case 'scatter':
        each(op.rect, (x, y) => {
          const c = cells[y * width + x];
          if (c.length === 1 && c[0].tile && rand() < op.density) c.push({ tile: pick(op.tiles), flags: 0 });
        });
        break;
      case 'stamp': {
        const src = original(op.from);
        const [sx, sy, sw, sh] = op.src;
        const [nx, ny] = op.repeat ?? [1, 1];
        const layers = op.layers ?? 'all';
        for (let ry = 0; ry < ny; ry++)
          for (let rx = 0; rx < nx; rx++)
            for (let dy = 0; dy < sh; dy++)
              for (let dx = 0; dx < sw; dx++) {
                const x = op.at[0] + rx * sw + dx, y = op.at[1] + ry * sh + dy;
                if (!inside(x, y)) continue;
                const s = src.cells[(sy + dy) * src.width + sx + dx];
                if (!s) throw new Error(`stamp ${op.from} 出界 (${sx + dx},${sy + dy})`);
                const c = cells[y * width + x];
                if (layers === 'all') cells[y * width + x] = s.map((l) => ({ ...l }));
                else if (layers === 'upper') cells[y * width + x] = [c[0], ...s.slice(1).map((l) => ({ ...l }))];
                else c[0] = { ...s[0] };
              }
        break;
      }
    }
  }
  return { width, height, cells };
}

/** 通行检查：可走格子数、最大连通块占比（4 邻接）；拼错时常常会把一块空地封死 */
export function passStats(m: MapData, groundAtt: Uint8Array, upperAtt: Uint8Array) {
  const ok = m.cells.map((c) => cellPassable(c, groundAtt, upperAtt));
  const seen = new Uint8Array(ok.length);
  let best = 0;
  const total = ok.filter(Boolean).length;
  for (let i = 0; i < ok.length; i++) {
    if (!ok[i] || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % m.width, y = (j / m.width) | 0;
      for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (ax < 0 || ay < 0 || ax >= m.width || ay >= m.height) continue;
        const k = ay * m.width + ax;
        if (ok[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    best = Math.max(best, n);
  }
  return { total, largest: best };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pass = args.includes('--pass');
  const names = args.filter((a) => !a.startsWith('--'));
  const all = fs.readdirSync(RECIPES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const tiles = openTiles(DATA);
  fs.mkdirSync(path.join(ROOT, 'packs/maps'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'extracted/maps'), { recursive: true });
  for (const name of names.length ? names : all) {
    const recipe = JSON.parse(fs.readFileSync(path.join(RECIPES, `${name}.json`), 'utf8')) as Recipe;
    const m = compose(recipe);
    const j = mapToJson(m);
    // 一行一排格子，diff 时好看
    const rows: string[] = [];
    for (let y = 0; y < m.height; y++) rows.push('    ' + j.cells.slice(y * m.width, (y + 1) * m.width).map((c) => JSON.stringify(c)).join(','));
    fs.writeFileSync(
      path.join(ROOT, 'packs/maps', `${name}.json`),
      `{\n  "width": ${m.width},\n  "height": ${m.height},\n  "cells": [\n${rows.join(',\n')}\n  ]\n}\n`,
    );
    const { W, H, rgba } = renderMap(tiles, m, [], { pass });
    fs.writeFileSync(path.join(ROOT, 'extracted/maps', `custom-${name}${pass ? '-pass' : ''}.png`), encodePng(W, H, rgba));
    const s = passStats(m, tiles.groundAtt, tiles.upperAtt);
    const warn = s.largest < s.total * 0.9 ? '  ⚠ 可走区域没连成一片' : '';
    console.log(`${name}（${recipe.title ?? ''}）${m.width}×${m.height}：可走 ${s.total} 格，最大连通 ${s.largest}${warn}`);
  }
}
