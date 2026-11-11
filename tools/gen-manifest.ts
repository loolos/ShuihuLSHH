// 生成 src/data/manifest.json：游戏运行需要的原版文件清单（相对路径、大小、SHA256）。
// 浏览器端用它校验玩家选择的原版目录。清单只含文件名和哈希，不含任何原版内容。
// 用法：node tools/gen-manifest.ts [原版目录]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
