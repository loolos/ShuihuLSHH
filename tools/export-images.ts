// 一次性迁移（2026-11-19，第二步）：把原版图像库拆成 gamedata/ 下的索引色 PNG 和目录 JSON。
// 导出后 PNG 就是游戏用的图像（可编辑），这个脚本不再保留（见 git 历史）。格式见 docs/binary-formats.md §15。
// 用法：node --experimental-transform-types tools/export-images.ts
import fs from 'node:fs';
import path from 'node:path';
import { openGrp, openLib, openPic, parsePalette, type Frame } from '../src/formats/image.ts';
import { encodeIndexedPng } from '../src/formats/png.ts';
import { decodeIndexedPng } from '../src/formats/png-indexed.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'gamedata/original/Data');
const OUT = path.join(ROOT, 'gamedata');
const read = (f: string) => fs.readFileSync(path.join(SRC, f));
const palette = parsePalette(read('Default.pal'));
const names: string[] = JSON.parse(fs.readFileSync(path.join(OUT, 'tables/exe.json'), 'utf8')).characterNames;
const written: { file: string; check: (img: { width: number; height: number; pixels: Uint8Array }) => void }[] = [];
const png = (rel: string, w: number, h: number, px: Uint8Array, check: (typeof written)[number]['check']) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encodeIndexedPng(w, h, px, palette));
  written.push({ file: rel, check });
};
const json = (rel: string, text: string) => fs.writeFileSync(path.join(OUT, rel), text);
const blit = (dst: Uint8Array, W: number, f: Frame, ox: number, oy: number) => {
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) {
      const p = f.pixels[y * f.width + x];
      if (p) dst[(oy + y) * W + ox + x] = p;
    }
};
const same = (img: { width: number; pixels: Uint8Array }, f: Frame, ox: number, oy: number, what: string) => {
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++)
      if (img.pixels[(oy + y) * img.width + ox + x] !== f.pixels[y * f.width + x]) throw new Error(`${what}: (${x},${y}) 不一致`);
};

/** 一组帧按行排成一张图：每格同样大小，各帧的锚点对齐到格子里的同一点 */
function sheet(rel: string, rows: Frame[][]): [number, number, number, number] {
  let l = 0, t = 0, r = 1, b = 1;
  for (const row of rows) for (const f of row) {
    l = Math.max(l, f.anchorX);
    t = Math.max(t, f.anchorY);
    r = Math.max(r, f.width - f.anchorX);
    b = Math.max(b, f.height - f.anchorY);
  }
  const cw = l + r, ch = t + b, cols = Math.max(1, ...rows.map((x) => x.length));
  const W = cw * cols, H = ch * rows.length, px = new Uint8Array(W * H);
  const at = (f: Frame, ry: number, cx: number) => [cx * cw + l - f.anchorX, ry * ch + t - f.anchorY] as const;
  rows.forEach((row, ry) => row.forEach((f, cx) => blit(px, W, f, ...at(f, ry, cx))));
  png(rel, W, H, px, (img) => rows.forEach((row, ry) => row.forEach((f, cx) => same(img, f, ...at(f, ry, cx), `${rel} ${ry}/${cx}`))));
  return [cw, ch, l, t];
}

const groupLine = (g: { first: number; last: number; param: number }) => JSON.stringify([g.first, g.last, g.param]);

// 人物动画：每个职业的每个动作一张图，4 行 = 4 个朝向
{
  const man = openLib(read('Man.lib'), 'Man.lib');
  const sheets: string[] = [];
  man.classes.forEach((c, cls) => {
    for (let g = c.first, a = 0; g <= c.last; g += 4, a++) {
      const rows: Frame[][] = [];
      for (let d = 0; d < 4 && g + d <= c.last; d++) {
        const r = man.actions[g + d];
        rows.push(Array.from({ length: r.last - r.first + 1 }, (_, k) => man.frame(r.first + k)));
      }
      const cell = sheet(`sprites/man/${String(cls).padStart(2, '0')}/${String(a).padStart(2, '0')}.png`, rows);
      sheets.push(`  ${JSON.stringify(`${cls}/${a}`)}: ${JSON.stringify(cell)}`);
    }
  });
  json(
    'sprites/man.json',
    `{\n"names": ${JSON.stringify(names.slice(0, man.classes.length))},\n"classes": [\n${man.classes.map(groupLine).join(',\n')}\n],\n"actions": [\n${man.actions.map(groupLine).join(',\n')}\n],\n"sheets": {\n${sheets.join(',\n')}\n}\n}\n`,
  );
}

// 技能特效：每组一张图，一行
{
  const fx = openLib(read('Effect.lib'), 'Effect.lib');
  const sheets = fx.actions.map((r, g) =>
    JSON.stringify(sheet(`sprites/effects/${String(g).padStart(2, '0')}.png`, [Array.from({ length: r.last - r.first + 1 }, (_, k) => fx.frame(r.first + k))])),
  );
  json('sprites/effects.json', `{\n"actions": [\n${fx.actions.map(groupLine).join(',\n')}\n],\n"sheets": [\n${sheets.join(',\n')}\n]\n}\n`);
}

// 地图图块：每 64 块拼一张图（每行 8 块），tiles.json 记每块的位置和锚点
{
  const out: string[] = [];
  for (const [kind, file] of [['ground', 'Ground.grp'], ['upper', 'Upper.grp'], ['grid', 'Grid.grp']] as const) {
    const lib = openGrp(read(file), file);
    const frames: number[][] = [];
    for (let s = 0; s * 64 < lib.count; s++) {
      const list = Array.from({ length: Math.min(64, lib.count - s * 64) }, (_, k) => lib.frame(s * 64 + k));
      const pos: [number, number][] = [];
      let W = 1, H = 0;
      for (let r = 0; r * 8 < list.length; r++) {
        const row = list.slice(r * 8, r * 8 + 8);
        let x = 0;
        for (const f of row) pos.push([(x += f.width) - f.width, H]);
        W = Math.max(W, x);
        H += Math.max(0, ...row.map((f) => f.height));
      }
      H = Math.max(1, H);
      const px = new Uint8Array(W * H);
      list.forEach((f, k) => blit(px, W, f, ...pos[k]));
      const rel = `tiles/${kind}/${String(s).padStart(2, '0')}.png`;
      png(rel, W, H, px, (img) => list.forEach((f, k) => same(img, f, ...pos[k], `${rel} #${k}`)));
      list.forEach((f, k) => frames.push([s, ...pos[k], f.width, f.height, f.anchorX, f.anchorY]));
    }
    out.push(`"${kind}": [\n${frames.map((f) => JSON.stringify(f)).join(',\n')}\n]`);
  }
  json('tiles/tiles.json', `{\n${out.join(',\n')}\n}\n`);
}

// 头像、道具图标：一张一个文件
for (const [kind, file] of [['portraits', 'Head.lib'], ['icons', 'Object.lib']] as const) {
  const lib = openPic(read(file), file);
  const list: string[] = [];
  for (let i = 0; i < lib.count; i++) {
    const f = lib.frame(i);
    const w = Math.max(1, f.width), h = Math.max(1, f.height);
    const px = new Uint8Array(w * h);
    blit(px, w, f, 0, 0);
    png(`${kind}/${String(i).padStart(3, '0')}.png`, w, h, px, (img) => same(img, f, 0, 0, `${kind} ${i}`));
    list.push(JSON.stringify([f.width, f.height, f.anchorX, f.anchorY]));
  }
  json(`${kind}/${kind}.json`, `[\n${list.join(',\n')}\n]\n`);
}

fs.writeFileSync(path.join(OUT, 'tables/palette.json'), `[\n${Array.from({ length: 256 }, (_, i) => JSON.stringify([...palette.subarray(i * 3, i * 3 + 3)])).join(',\n')}\n]\n`);

// 校验：每张 PNG 解回来和原版帧逐像素一致
for (const w of written) w.check(await decodeIndexedPng(fs.readFileSync(path.join(OUT, w.file)), w.file));
console.log(`写出并校验 ${written.length} 张 PNG`);
