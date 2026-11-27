// 服务工作线程：让网页版断网也能打开（docs/game-design.md §12.3）。vite.config.ts 构建时填入版本号和 shell 清单，输出为 dist/sw.js。
// - 安装时缓存页面、脚本、样式（shell-<版本>），换版后旧的只留最近两版（给还开着的旧页面用）。
// - 页面（导航）和 offline.json 等同源小文件：先走网络（4 秒没回应就用缓存），断网时用缓存。
// - 带哈希的 assets/：先查缓存。
// - 仓库 gamedata/ 的图像、音效、配乐：离线包（OFFLINE_DATA，由页面上的「离线包」按钮下载）里有就用，没有走网络。
//   <audio> 的分段请求（Range）从缓存里切出对应的一段，回 206。
const VERSION = __VERSION__;
const SHELL = __SHELL__;
const SHELL_CACHE = `shell-${VERSION}`;
const OFFLINE_DATA = 'offline-data';
const REPO = 'https://raw.githubusercontent.com/loolos/ShuihuLSHH/main/gamedata/';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      // 旧版的 shell 留两份：换版时还开着的旧页面要的脚本（线上已换成新文件名）还能从这里取到，不会出错
      .then((keys) => {
        const old = keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE);
        return Promise.all(old.slice(0, Math.max(0, old.length - 2)).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

/** 从缓存的整份响应里切出 Range 请求的那一段 */
async function ranged(req, res) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!m) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  start = Math.max(0, start);
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = new Headers(res.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

async function fromData(req) {
  const hit = await (await caches.open(OFFLINE_DATA)).match(req.url);
  if (hit) return req.headers.has('range') ? ranged(req, hit) : hit;
  return fetch(req);
}

async function networkFirst(req, fallbackUrl) {
  const shell = await caches.open(SHELL_CACHE);
  const net = fetch(req);
  const timeout = new Promise((r) => setTimeout(r, 4000));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch {
    /* 断网：用缓存 */
  }
  const hit = (await shell.match(fallbackUrl ?? req.url, { ignoreSearch: true })) ?? (await caches.match(req.url, { ignoreSearch: true }));
  return hit ?? net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url.startsWith(REPO)) return e.respondWith(fromData(req));
  if (url.origin !== self.location.origin) return;
  const scope = self.registration.scope;
  if (!req.url.startsWith(scope)) return;
  const rel = req.url.slice(scope.length).split(/[?#]/)[0];
  // 检查更新要拿线上的版本号，不走缓存
  if (rel === 'version.json') return;
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, scope));
  if (rel.startsWith('assets/')) {
    return e.respondWith(caches.match(req.url).then((hit) => hit ?? fetch(req)));
  }
  e.respondWith(networkFirst(req));
});
