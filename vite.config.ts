import { execSync } from 'node:child_process';
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

// base './'：GitHub Pages 部署在 /<仓库名>/ 子路径下。
// 开发服务器会直接提供仓库里的 gamedata/（供本地调试）；构建产物只包含代码，不含任何原版文件。
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [versionFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { fs: { strict: true } },
});
