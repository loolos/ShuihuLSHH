import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** 构建版本号：提交号前 7 位 + 构建时间。检查更新时拿它和线上 version.json 比较 */
function buildInfo() {
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'unknown';
    }
  }
  const time = new Date().toISOString();
  return { id: `${commit.slice(0, 7)}-${time.replace(/\D/g, '').slice(0, 14)}`, commit, time };
}
const build = buildInfo();

/** 构建时在 dist/ 里写一个 version.json，供运行中的页面检查有没有新版本 */
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
  },
});

/** 离线包里的 gamedata/ 目录：图像、音效、配乐（网页版运行时从仓库 main 分支下载的那些） */
const OFFLINE_DIRS = ['sprites', 'tiles', 'portraits', 'icons', 'sound', 'bgm'];
const REPO_GAMEDATA = 'https://raw.githubusercontent.com/loolos/ShuihuLSHH/main/gamedata/';

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`],
  );
}

/**
 * 离线游玩（docs/game-design.md §12.3）：构建时写
 * - offline.json：离线包清单。shell = 页面、脚本、样式（服务工作线程安装时就缓存）；
 *   files = 扩展包图像（dist/assets 里带哈希的 PNG）+ 仓库 gamedata/ 的图像、音效、配乐（带内容哈希，换版时只重下改过的）。
 * - sw.js：服务工作线程（src/platform/sw.js，填入版本号和 shell 清单）。
 */
const offlineFiles = (): Plugin => ({
  name: 'offline-files',
  apply: 'build',
  generateBundle(_opts, bundle) {
    const shell = ['./', 'offline.json'];
    const files: { u: string; s: number; h: string }[] = [];
    for (const [name, f] of Object.entries(bundle)) {
      const size = f.type === 'chunk' ? Buffer.byteLength(f.code) : typeof f.source === 'string' ? Buffer.byteLength(f.source) : f.source.length;
      if (/\.(js|css)$/.test(name)) shell.push(name);
      else if (name.startsWith('assets/')) files.push({ u: name, s: size, h: '' });
    }
    for (const dir of OFFLINE_DIRS) {
      for (const rel of walk(join('gamedata', dir)).sort()) {
        const buf = readFileSync(join('gamedata', dir, rel));
        const h = createHash('sha1').update(buf).digest('hex').slice(0, 10);
        files.push({ u: REPO_GAMEDATA + `${dir}/${rel}`.split('/').map(encodeURIComponent).join('/'), s: buf.length, h });
      }
    }
    this.emitFile({ type: 'asset', fileName: 'offline.json', source: JSON.stringify({ id: build.id, shell, files }) });
    const sw = readFileSync('src/platform/sw.js', 'utf8').replace('__VERSION__', JSON.stringify(build.id)).replace('__SHELL__', JSON.stringify(shell));
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
  },
});

// base './'：GitHub Pages 部署在 /<仓库名>/ 子路径下。
// 开发服务器会直接提供仓库里的 gamedata/（供本地调试）。构建产物只含代码和随代码打包的关卡、地图、数据表 JSON（gamedata/stages、maps、tables），不含原版图像。
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [versionFile(), offlineFiles()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { fs: { strict: true } },
});
