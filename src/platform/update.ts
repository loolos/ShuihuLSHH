/** 检查更新：拿本页面构建时写入的版本号和线上的 version.json 比较（vite.config.ts 生成） */

declare const __BUILD__: { id: string; commit: string; time: string };
export const BUILD = __BUILD__;

/** 给玩家看的版本：提交号 + 本地时区的构建时间，如 fc0b9a9（11-12 17:58） */
export function versionLabel(v: { id: string; commit?: string; time?: string }): string {
  const d = v.time ? new Date(v.time) : null;
  if (!d || isNaN(+d)) return v.id;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${(v.commit ?? v.id).slice(0, 7)}（${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}）`;
}

export type UpdateCheck =
  | { kind: 'latest' }
  | { kind: 'newer'; id: string; commit?: string; time: string }
  | { kind: 'unavailable'; reason: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (import.meta.env.DEV) return { kind: 'unavailable', reason: '开发模式下不检查更新' };
  try {
    const r = await fetch(new URL(`version.json?t=${Date.now()}`, document.baseURI), { cache: 'no-store' });
    if (!r.ok) return { kind: 'unavailable', reason: `取不到线上版本信息（HTTP ${r.status}）` };
    const v = (await r.json()) as { id?: string; commit?: string; time?: string };
    if (!v.id) return { kind: 'unavailable', reason: '线上版本信息格式不对' };
    // 线上比本地旧（比如部署回滚中途）也当作已是最新，不来回刷新
    if (v.id === BUILD.id || (v.time && v.time < BUILD.time)) return { kind: 'latest' };
    return { kind: 'newer', id: v.id, commit: v.commit, time: v.time ?? '' };
  } catch {
    return { kind: 'unavailable', reason: '网络不通，无法检查更新' };
  }
}

/**
 * 更新到新版本：先强制重新拉一遍 index.html，免得浏览器用 HTTP 缓存里的旧页面（GitHub Pages 缓存 10 分钟），
 * 再刷新。脚本和样式文件名带内容哈希，新页面自然会去取新的。
 * 存档（localStorage）和已下载的原版文件（IndexedDB）都不动。
 */
export async function applyUpdate(): Promise<void> {
  const page = new URL(location.href);
  page.hash = '';
  try {
    await fetch(page, { cache: 'reload' });
  } catch {
    /* 拉不到也照样刷新 */
  }
  location.reload();
}
