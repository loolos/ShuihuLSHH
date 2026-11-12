// 生成 src/data/manifest.json：游戏运行需要的原版文件清单（相对路径、大小、SHA256）。
// 浏览器端用它校验玩家选择的原版目录。清单只含文件名和哈希，不含任何原版内容。
// 同时生成 src/data/frame-alias.json：Man.lib、Effect.lib 里字节完全相同的帧（网页版按需下载时只取一份）。只含帧号，不含原版内容。
// 用法：node tools/gen-manifest.ts [原版目录]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openLib } from '../src/formats/image.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.resolve(process.argv[2] ?? process.env.SHUIHU_DATA ?? path.join(ROOT, 'gamedata/shuihu'));
const WANT = /^(ShuiHu\.exe|Data\/.*\.(pal|tbl|grp|att|lib|hum|dab)|Map\/.*\.(map|act|pab|pas))$/i;

const files: { path: string; size: number; sha256: string }[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else {
      const rel = path.relative(DATA, abs).split(path.sep).join('/');
      if (!WANT.test(rel)) continue;
      const buf = fs.readFileSync(abs);
      files.push({ path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    }
  }
};
walk(DATA);
files.sort((a, b) => a.path.localeCompare(b.path));
const out = path.join(ROOT, 'src/data/manifest.json');
fs.writeFileSync(out, JSON.stringify({ files }, null, 1) + '\n');
console.log(`${files.length} files, ${(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB → ${path.relative(ROOT, out)}`);

// 字节完全相同、但存放在文件不同位置的帧：dup 是帧号的差分编码，src 是第一份相同内容的帧号
const alias: Record<string, { dup: number[]; src: number[] }> = {};
for (const rel of ['Data/Man.lib', 'Data/Effect.lib']) {
  const buf = fs.readFileSync(path.join(DATA, rel));
  const lib = openLib(buf, rel);
  const first = new Map<string, number>();
  const dup: number[] = [], src: number[] = [];
  let prev = 0;
  for (let i = 0; i < lib.count; i++) {
    const [a, b] = lib.span(i);
    const h = crypto.createHash('sha1').update(buf.subarray(a, b)).digest('hex');
    const j = first.get(h);
    if (j === undefined) first.set(h, i);
    else if (lib.span(j)[0] !== a) {
      dup.push(i - prev);
      src.push(j);
      prev = i;
    }
  }
  alias[rel] = { dup, src };
}
const aliasOut = path.join(ROOT, 'src/data/frame-alias.json');
fs.writeFileSync(aliasOut, JSON.stringify(alias) + '\n');
console.log(`frame alias: ${Object.entries(alias).map(([k, v]) => `${k} ${v.dup.length}`).join(', ')} → ${path.relative(ROOT, aliasOut)}`);
