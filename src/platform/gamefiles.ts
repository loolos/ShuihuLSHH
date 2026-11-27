// 游戏数据：gamedata/ 下的 JSON（随代码打包）和图像（索引色 PNG，按需下载）。
// 图像来源：开发模式是开发服务器上的 gamedata/，网页版是本仓库 main 分支的 gamedata/（raw.githubusercontent.com 允许跨域，负责人 2026-11-12 决定）。
// 下载过的 PNG 存进 IndexedDB（键 img:路径），下次打开直接用。
import { decodeIndexedPng, type IndexedImage } from '../formats/png-indexed.ts';
import { idbGet, idbPrune, idbPut } from './idb.ts';

const key = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const CACHE = 'img:';

/** 网页版的数据来源：本仓库 main 分支的 gamedata/ */
export const REPO_GAMEDATA = 'https://raw.githubusercontent.com/loolos/ShuihuLSHH/main/gamedata/';

export type Progress = (msg: string, ratio?: number) => void;

/** 取一张图的原始字节（浏览器里先查 IndexedDB 再下载，Node 里读磁盘） */
export type ImageLoader = (path: string) => Promise<Uint8Array>;

/** 浏览器：从 base（开发服务器或仓库）下载，并存进 IndexedDB */
export function webLoader(base: string, cache = true): ImageLoader {
  return async (path) => {
    if (cache) {
      const hit = await idbGet(CACHE + path).catch(() => undefined);
      if (hit) return new Uint8Array(hit);
    }
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(base + path.split('/').map(encodeURIComponent).join('/')).catch((e) => ((last = e), null));
      if (r?.ok) {
        const ab = await r.arrayBuffer();
        if (cache) idbPut(CACHE + path, ab).catch(() => {});
        return new Uint8Array(ab);
      }
      last = r ? new Error(`下载 ${path} 失败（${r.status}）`) : last;
    }
    throw last instanceof Error ? last : new Error(`下载 ${path} 失败`);
  };
}

/** 清掉旧版缓存的原版大文件（2026-11-19 以前缓存的是 Data/*.lib 整份或分段） */
export const pruneOldCache = () => idbPrune(CACHE).catch(() => {});

/** gamedata/ 的 JSON 和图像，按相对路径（不区分大小写）取用。 */
export class GameFiles {
  /** gamedata/ 下的 JSON，浏览器里由 main.ts 设成随代码打包的那份（gamedata-json.ts） */
  static bundledJson: Map<string, unknown> = new Map();
  private readonly images = new Map<string, IndexedImage>();
  private readonly pending = new Map<string, Promise<number>>();
  constructor(private readonly load: ImageLoader, private readonly jsons = GameFiles.bundledJson) {}
  has(path: string): boolean {
    return this.jsons.has(key(path));
  }
  get(path: string): Buffer {
    throw new Error(`GameFiles 只提供 JSON 和图像：${path}`);
  }
  json(path: string): unknown {
    const v = this.jsons.get(key(path));
    if (v === undefined) throw new Error(`缺少数据文件：${path}`);
    return v;
  }
  list(dir: string, ext: string): string[] {
    const d = key(dir) + '/';
    return [...this.jsons.keys()].filter((k) => k.startsWith(d) && k.endsWith(ext.toLowerCase()));
  }
  /** 已经下载并解码好的图像（没有时报错：先 ensure） */
  image(path: string): IndexedImage {
    const img = this.images.get(key(path));
    if (!img) throw new Error(`图像还没有载入：${path}`);
    return img;
  }
  hasImage(path: string): boolean {
    return this.images.has(key(path));
  }
  /** 确保这些图像已经载入；返回新下载（或从缓存读出）的字节数 */
  async ensure(paths: Iterable<string>, progress?: Progress, label = '下载本关素材'): Promise<number> {
    const todo = [...new Set([...paths].map(key))].filter((p) => !this.images.has(p));
    if (!todo.length) return 0;
    let done = 0, bytes = 0;
    progress?.(`${label} 0 / ${todo.length}`, 0);
    const one = (p: string) => {
      let job = this.pending.get(p);
      if (!job) {
        job = this.load(p)
          .then(async (buf) => {
            this.images.set(p, await decodeIndexedPng(buf, p));
            return buf.length;
          })
          .finally(() => this.pending.delete(p));
        this.pending.set(p, job);
      }
      return job.then((n) => {
        bytes += n;
        progress?.(`${label} ${++done} / ${todo.length}`, done / todo.length);
      });
    };
    // 同时最多 8 个请求
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, async () => {
      while (next < todo.length) await one(todo[next++]);
    }));
    return bytes;
  }
  /** 已解码图像一共占多少字节（每像素 1 字节） */
  imageBytes(): number {
    let n = 0;
    for (const img of this.images.values()) n += img.pixels.length;
    return n;
  }
  /** 丢掉已解码的图像（keep 返回 true 的留下），释放内存；以后用到时 ensure 会从浏览器缓存重新读出 */
  forgetImages(keep: (path: string) => boolean): void {
    for (const p of [...this.images.keys()]) if (!keep(p)) this.images.delete(p);
  }
}
