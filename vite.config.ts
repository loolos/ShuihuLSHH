import { defineConfig } from 'vite';

// base './'：GitHub Pages 部署在 /<仓库名>/ 子路径下。
// 开发服务器会直接提供仓库里的 gamedata/（供本地调试）；构建产物只包含代码，不含任何原版文件。
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { fs: { strict: true } },
});
