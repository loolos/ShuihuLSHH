// 把原版 Sound/*.wav 压成网页用的 MP3，写到 gamedata/sound/（负责人 2026-11-12 同意放进仓库，并要求压缩精简）。
// - 内容完全相同的 WAV 只保留一份（按 SHA256 去重），index.json 记录 名字 → 文件。
// - 单声道、22,050 Hz、64 kbps（原版多为 22,050 Hz/16 bit 立体声）。
// 用法：node tools/gen-sound.ts <原版 Sound 目录>    需要 ffmpeg（带 libmp3lame）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.resolve(process.argv[2] ?? path.join(ROOT, 'gamedata/shuihu/Sound'));
const OUT = path.join(ROOT, 'gamedata/sound');
fs.mkdirSync(OUT, { recursive: true });

const names = fs.readdirSync(SRC).filter((f) => /\.wav$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const byHash = new Map<string, string>();
const index: Record<string, string> = {};
let inBytes = 0, outBytes = 0;
for (const f of names) {
  const buf = fs.readFileSync(path.join(SRC, f));
  inBytes += buf.length;
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  const name = f.replace(/\.wav$/i, '').toLowerCase();
  let file = byHash.get(h);
  if (!file) {
    file = `${name}.mp3`;
    byHash.set(h, file);
    const dst = path.join(OUT, file);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(SRC, f), '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k', dst]);
    outBytes += fs.statSync(dst).size;
  }
  index[name] = file;
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`${names.length} WAV（${(inBytes / 1e6).toFixed(1)} MB）→ ${byHash.size} 个 MP3（${(outBytes / 1e6).toFixed(2)} MB）→ ${path.relative(ROOT, OUT)}`);
