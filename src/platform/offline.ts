// 离线包（docs/game-design.md §12.3）：把网页版运行时要下载的东西一次下完，放进 Cache Storage，断网也能玩。
// - 页面、脚本、样式：服务工作线程（sw.js）安装时自动缓存。
// - 扩展包图像（dist/assets 的 PNG）+ 仓库 gamedata/ 的图像、音效、配乐：玩家按「离线包」按钮下载，清单是构建时生成的 offline.json。
// - 每个文件下载时记下内容哈希（localStorage）；换版后清单里哈希变了的文件从缓存删掉（在线时按需重新下载），离线包显示「需要更新」。
// 存档本来就在 localStorage，不受影响。
import { idbDelete } from './idb.ts';

const DATA = 'offline-data';
const META_KEY = 'shuihu.offline';

interface Entry {
  /** 网址：assets/ 开头的相对本页面，其余是仓库 raw 网址 */
  u: string;
  s: number;
  /** 内容哈希；dist/assets 里文件名已带哈希，这里为空 */
  h: string;
}
interface Manifest {
  id: string;
  shell: string[];
  files: Entry[];
}

export interface OfflineStatus {
  /** 浏览器支不支持（服务工作线程 + Cache Storage） */
  supported: boolean;
  /** 页面本身能不能断网打开（服务工作线程已接管本页） */
  shellReady: boolean;
  total: number;
  totalBytes: number;
  /** 已下载、且是当前版本的文件数 / 字节数 */
  have: number;
  haveBytes: number;
  /** 已下载过但不是当前版本、已删掉等重下的文件数 */
  stale: number;
  /** 浏览器给本网站的存储用量 / 配额（字节） */
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

const supported = () => !import.meta.env.DEV && 'serviceWorker' in navigator && 'caches' in window;
const abs = (u: string) => new URL(u, document.baseURI).href;

/** 已下载文件：网址 → 哈希 */
function loadMeta(): Record<string, string> {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as { files?: Record<string, string> };
    return m.files ?? {};
  } catch {
    return {};
  }
}
function saveMeta(files: Record<string, string>) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ files }));
  } catch {
    /* 存不下：下次打开会按缓存实际内容重查 */
  }
}

let manifest: Promise<Manifest | null> | null = null;
function getManifest(): Promise<Manifest | null> {
  manifest ??= fetch(abs('offline.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null)
    .then((m) => {
      if (!m) manifest = null;
      return m;
    });
  return manifest;
}

/** 启动时调用：注册服务工作线程；清单里换了的文件从离线包和图像缓存里删掉 */
export async function initOffline(): Promise<void> {
  if (!supported()) return;
  try {
    await navigator.serviceWorker.register(abs('sw.js'));
  } catch {
    return;
  }
  const m = await getManifest();
  if (!m) return;
  const meta = loadMeta();
  if (!Object.keys(meta).length) return;
  const want = new Map(m.files.map((f) => [abs(f.u), f.h]));
  const cache = await caches.open(DATA);
  let changed = false;
  for (const [u, h] of Object.entries(meta)) {
    if (want.get(u) === h) continue;
    changed = true;
    delete meta[u];
    await cache.delete(u);
    // 图像同时也存在 IndexedDB（gamefiles.ts 的 img: 键），一起删掉，免得用旧图
    const img = /\/gamedata\/(.+\.png)$/.exec(u);
    if (img) await idbDelete('img:' + decodeURIComponent(img[1]).toLowerCase()).catch(() => {});
  }
  if (changed) saveMeta(meta);
}

export async function offlineStatus(): Promise<OfflineStatus> {
  const st: OfflineStatus = { supported: supported(), shellReady: false, total: 0, totalBytes: 0, have: 0, haveBytes: 0, stale: 0 };
  if (!st.supported) return st;
  st.shellReady = !!navigator.serviceWorker.controller;
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  st.usage = est?.usage;
  st.quota = est?.quota;
  st.persisted = await navigator.storage?.persisted?.().catch(() => undefined);
  const m = await getManifest();
  const meta = loadMeta();
  if (!m) {
    // 断网又没缓存清单：只能按记录报个数
    st.have = st.total = Object.keys(meta).length;
    return st;
  }
  st.total = m.files.length;
  for (const f of m.files) {
    st.totalBytes += f.s;
    if (meta[abs(f.u)] === f.h) {
      st.have++;
      st.haveBytes += f.s;
    }
  }
  st.stale = Object.keys(meta).length - st.have;
  return st;
}

async function sha1(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return [...d.slice(0, 5)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type DownloadProgress = (done: number, total: number, bytes: number, totalBytes: number) => void;

/** 下载离线包里还没有的文件。signal 中止时已下完的保留，下次接着下。返回失败的文件数。 */
export async function downloadOffline(progress: DownloadProgress, signal: AbortSignal): Promise<number> {
  const m = await getManifest();
  if (!m) throw new Error('取不到离线包清单，请联网后再试');
  // 尽量让浏览器别在空间紧张时自动清掉（Chrome 对常用网站会直接同意；Safari、Firefox 可能会问）
  await navigator.storage?.persist?.().catch(() => false);
  await navigator.serviceWorker.ready;
  const cache = await caches.open(DATA);
  const meta = loadMeta();
  const todo = m.files.filter((f) => meta[abs(f.u)] !== f.h);
  const totalBytes = todo.reduce((a, f) => a + f.s, 0);
  let done = 0, bytes = 0, failed = 0, sinceSave = 0;
  progress(0, todo.length, 0, totalBytes);
  const one = async (f: Entry) => {
    const u = abs(f.u);
    let ok = false;
    for (let i = 0; i < 3 && !ok && !signal.aborted; i++) {
      try {
        const r = await fetch(u, { mode: 'cors', cache: 'no-store', signal });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          // 记实际内容的哈希：仓库刚推送时 raw 网址可能还给几分钟旧文件，那样下次打开会当作要更新
          const h = f.h && (await sha1(buf).catch(() => f.h));
          // 只留类型：压缩、长度这些头对解开后的内容不成立
          await cache.put(u, new Response(buf, { headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'application/octet-stream' } }));
          meta[u] = h;
          ok = true;
        }
      } catch {
        /* 重试 */
      }
    }
    if (signal.aborted) return;
    if (!ok) failed++;
    bytes += f.s;
    progress(++done, todo.length, bytes, totalBytes);
    if (++sinceSave >= 20) {
      sinceSave = 0;
      saveMeta(meta);
    }
  };
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(6, todo.length) }, async () => {
        while (next < todo.length && !signal.aborted) await one(todo[next++]);
      }),
    );
  } finally {
    saveMeta(meta);
  }
  return failed;
}

/** 删掉离线包（页面本身的缓存留着，体积很小） */
export async function deleteOffline(): Promise<void> {
  saveMeta({});
  await caches.delete(DATA);
}

export const mb = (n: number) => `${(n / 1048576).toFixed(n >= 1048576 * 10 ? 0 : 1)} MB`;
