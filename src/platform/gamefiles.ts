// 取得原版文件：IndexedDB 缓存 → 开发服务器 → 试玩页面附带 → GitHub 仓库里的 gamedata/shuihu → 玩家选目录。
// 构建产物里没有原版素材；网页版运行时从仓库下载（负责人 2026-11-12 决定）。
import manifest from '../data/manifest.json';
import { indexSpans } from '../formats/image.ts';
import { idbGetAll, idbPut, idbPutAll } from './idb.ts';

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}
const ENTRIES = (manifest as { files: ManifestEntry[] }).files;
const key = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/** 网页版按需下载的大文件（人物动画、特效、图块；头像对白里随时会用，整份下载）：先取目录，进关前再按帧取 */
export const LAZY_FILES = ['Data/Man.lib', 'Data/Effect.lib', 'Data/Upper.grp', 'Data/Ground.grp'];
/** 目前用不到、网页版不下载的文件 */
const UNUSED = new Set(['Data/Panel.lib']);
const CHUNK = 'range:';

/**
 * 只下载了一部分的文件：按文件全长分配一块内存，下载到的字节范围填进去（没下载的地方是 0）。
 * 下载到的每一段也存进 IndexedDB（键 range:路径:起-止），下次打开直接用。
 */
export class RemoteFile {
  readonly buf: Uint8Array;
  private have: [number, number][] = [];
  constructor(readonly path: string, readonly size: number, private url: string) {
    this.buf = new Uint8Array(size);
  }
  /** 填入一段已有的数据（来自缓存） */
  fill(start: number, data: ArrayBuffer) {
    this.buf.set(new Uint8Array(data), start);
    this.mark(start, start + data.byteLength);
  }
  private mark(a: number, b: number) {
    const all = [...this.have, [a, b] as [number, number]].sort((x, y) => x[0] - y[0]);
    const out: [number, number][] = [];
    for (const r of all) {
      const last = out.at(-1);
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    this.have = out;
  }
  /** 还没下载的部分（相距不到 32 KB 的合并成一次请求） */
  missing(spans: [number, number][]): [number, number][] {
    const need: [number, number][] = [];
    for (const [a0, b] of [...spans].sort((x, y) => x[0] - y[0])) {
      let a = a0;
      for (const [h0, h1] of this.have) {
        if (h1 <= a || h0 >= b) continue;
        if (h0 <= a) a = Math.max(a, h1);
        else if (a < h0) {
          need.push([a, h0]);
          a = h1;
        }
      }
      if (a < b) need.push([a, b]);
    }
    const merged: [number, number][] = [];
    for (const r of need) {
      const last = merged.at(-1);
      if (last && r[0] - last[1] < 32768) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    return merged;
  }
  async ensure(spans: [number, number][], onBytes?: (n: number) => void): Promise<void> {
    await Promise.all(
      this.missing(spans).map(async ([a, b]) => {
        const r = await fetch(this.url, { headers: { Range: `bytes=${a}-${b - 1}` } });
        if (!r.ok) throw new Error(`下载 ${this.path} 失败（${r.status}）`);
        let data = await r.arrayBuffer();
        if (r.status === 200) data = data.slice(a, b); // 服务器不支持 Range 时整份返回
        this.fill(a, data);
        onBytes?.(data.byteLength);
        idbPut(`${CHUNK}${this.path}:${a}-${b}`, data).catch(() => {});
      }),
    );
  }
}

/** 已载入的原版文件，按相对路径（不区分大小写）取用。 */
export class GameFiles {
  private readonly files: Map<string, ArrayBuffer>;
  private readonly remote: Map<string, RemoteFile>;
  constructor(files: Map<string, ArrayBuffer>, remote: RemoteFile[] = []) {
    this.files = new Map([...files].map(([k, v]) => [key(k), v]));
    this.remote = new Map(remote.map((r) => [key(r.path), r]));
  }
  has(path: string): boolean {
    return this.files.has(key(path)) || this.remote.has(key(path));
  }
  /** 返回 Buffer（浏览器中由 buffer-shim 提供），与离线工具共用解析器。 */
  get(path: string): Buffer {
    const r = this.remote.get(key(path));
    if (r) return Buffer.from(r.buf.buffer);
    const ab = this.files.get(key(path));
    if (!ab) throw new Error(`缺少原版文件：${path}`);
    return Buffer.from(ab);
  }
  /** 确保这些字节范围已经下载（整份在本地的文件直接返回）；返回新下载的字节数 */
  async ensure(want: Map<string, [number, number][]>, progress?: Progress): Promise<number> {
    const jobs = [...want].map(([p, spans]) => ({ r: this.remote.get(key(p)), spans })).filter((j) => j.r);
    const total = jobs.reduce((n, j) => n + j.r!.missing(j.spans).reduce((m, [a, b]) => m + b - a, 0), 0);
    if (!total) return 0;
    let got = 0;
    progress?.(`下载本关素材 0 / ${(total / 1048576).toFixed(1)} MB`, 0);
    await Promise.all(
      jobs.map((j) =>
        j.r!.ensure(j.spans, (n) => {
          got += n;
          progress?.(`下载本关素材 ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`, got / total);
        }),
      ),
    );
    return got;
  }
  /**
   * 把文件里一段字节复制到另一处（字节完全相同的帧只下载一份，下载后复制到各自的位置，见 src/data/frame-alias.json）。
   * 整份在本地的文件本来就有，不用复制。
   */
  copy(path: string, from: number, to: number, len: number) {
    const r = this.remote.get(key(path));
    if (r) r.buf.copyWithin(to, from, from + len);
  }
  list(dir: string, ext: string): string[] {
    const d = key(dir) + '/';
    return [...this.files.keys()].filter((k) => k.startsWith(d) && k.endsWith(ext.toLowerCase()));
  }
}

export type Progress = (msg: string, ratio?: number) => void;

export interface CheckResult {
  missing: string[];
  mismatched: string[];
}

async function sha256(ab: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 对照清单检查：缺失的文件，以及大小或 SHA256 不同的文件。 */
export async function checkFiles(files: Map<string, ArrayBuffer>, progress?: Progress, hash = true): Promise<CheckResult> {
  const byKey = new Map([...files].map(([k, v]) => [key(k), v]));
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (let i = 0; i < ENTRIES.length; i++) {
    const e = ENTRIES[i];
    const ab = byKey.get(key(e.path));
    progress?.(`校验 ${e.path}`, i / ENTRIES.length);
    if (!ab) missing.push(e.path);
    else if (ab.byteLength !== e.size || (hash && (await sha256(ab)) !== e.sha256)) mismatched.push(e.path);
  }
  return { missing, mismatched };
}

/** 从文件列表中找出原版根目录（ShuiHu.exe 所在目录），只保留清单里的文件。 */
export async function collectFromFileList(list: Iterable<{ path: string; file: Blob }>, progress?: Progress) {
  const all = [...list];
  const exe = all.find((f) => /(^|\/)shuihu\.exe$/i.test(f.path));
  if (!exe) throw new Error('所选目录里没有找到 ShuiHu.exe，请选择原版游戏的安装目录。');
  const prefix = exe.path.slice(0, exe.path.length - 'ShuiHu.exe'.length);
  const wanted = new Set(ENTRIES.map((e) => key(e.path)));
  const out = new Map<string, ArrayBuffer>();
  const picked = all.filter((f) => f.path.startsWith(prefix) && wanted.has(key(f.path.slice(prefix.length))));
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i];
    progress?.(`读取 ${f.path}`, i / picked.length);
    out.set(f.path.slice(prefix.length), await f.file.arrayBuffer());
  }
  return out;
}

/** File System Access API：递归列出目录。 */
export async function* walkDirectory(dir: FileSystemDirectoryHandle, base = ''): AsyncGenerator<{ path: string; file: Blob }> {
  for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    const p = base ? `${base}/${name}` : name;
    if (h.kind === 'directory') {
      // 只进入可能含原版文件的目录，避免扫描巨大的无关目录
      if (base.split('/').length > 3) continue;
      yield* walkDirectory(h as FileSystemDirectoryHandle, p);
    } else yield { path: p, file: await (h as FileSystemFileHandle).getFile() };
  }
}

/** 开发模式：从 Vite 开发服务器读取仓库里的 gamedata/shuihu（构建产物中不存在）。 */
export async function loadFromDevServer(progress?: Progress): Promise<Map<string, ArrayBuffer> | null> {
  if (!import.meta.env.DEV) return null;
  const probe = await fetch('/gamedata/shuihu/ShuiHu.exe', { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return null;
  const out = new Map<string, ArrayBuffer>();
  for (let i = 0; i < ENTRIES.length; i++) {
    const e = ENTRIES[i];
    progress?.(`读取 ${e.path}`, i / ENTRIES.length);
    const r = await fetch(`/gamedata/shuihu/${e.path}`);
    if (r.ok) out.set(e.path, await r.arrayBuffer());
  }
  return out;
}

/** 网页版用的原版文件来源：本仓库 main 分支的 gamedata/shuihu（raw.githubusercontent.com 允许跨域） */
export const REPO_GAMEDATA = 'https://raw.githubusercontent.com/loolos/ShuihuLSHH/main/gamedata/shuihu/';

/**
 * 网页版：从 GitHub 仓库取原版文件。小文件整份下载（约 2 MB），大文件（LAZY_FILES）只取目录，帧数据进关前按需下载。
 * `cached` 是 IndexedDB 里已有的内容（整份文件，以及 range: 开头的分段）。任何一个请求失败就返回 null。
 */
export async function loadFromRepo(
  progress?: Progress,
  cached: Map<string, ArrayBuffer> = new Map(),
  base = REPO_GAMEDATA,
): Promise<{ files: Map<string, ArrayBuffer>; remote: RemoteFile[] } | null> {
  if (import.meta.env.DEV) return null;
  const url = (p: string) => base + p.split('/').map(encodeURIComponent).join('/');
  const lazy = new Set(LAZY_FILES.map(key));
  const small = ENTRIES.filter((e) => !lazy.has(key(e.path)) && !UNUSED.has(e.path));
  const files = new Map<string, ArrayBuffer>();
  const todo = small.filter((e) => {
    const c = cached.get(e.path);
    if (c && c.byteLength === e.size) files.set(e.path, c);
    return !files.has(e.path);
  });
  const total = todo.reduce((n, e) => n + e.size, 0);
  let done = 0, next = 0, failed = false;
  const worker = async () => {
    while (!failed && next < todo.length) {
      const e = todo[next++];
      const r = await fetch(url(e.path)).catch(() => null);
      if (!r?.ok) {
        failed = true;
        return;
      }
      const ab = await r.arrayBuffer();
      files.set(e.path, ab);
      idbPut(e.path, ab).catch(() => {});
      done += e.size;
      progress?.(`从 GitHub 下载基础文件 ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`, done / total);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed) return null;
  // 大文件：用缓存里的分段，再补齐文件头和目录
  const remote: RemoteFile[] = [];
  try {
    for (const p of LAZY_FILES) {
      const e = ENTRIES.find((x) => x.path === p)!;
      const r = new RemoteFile(p, e.size, url(p));
      for (const [k, v] of cached) {
        if (!k.startsWith(`${CHUNK}${p}:`)) continue;
        r.fill(Number(k.slice(k.lastIndexOf(':') + 1).split('-')[0]), v);
      }
      await r.ensure([[0, 15]]);
      await r.ensure(indexSpans(Buffer.from(r.buf.buffer, 0, 15), e.size));
      remote.push(r);
    }
  } catch {
    return null;
  }
  return { files, remote };
}

/**
 * 内部试玩页面：原版文件按 manifest 顺序拼接后切成若干块（可为 base64 文本），和页面一起发布在 ./gamedata/ 下。
 * 公开构建里没有这个目录，请求失败时返回 null，照常让玩家选目录。
 */
export async function loadBundled(progress?: Progress): Promise<Map<string, ArrayBuffer> | null> {
  if (import.meta.env.DEV) return null;
  const r = await fetch('./gamedata/index.json').catch(() => null);
  if (!r?.ok) return null;
  const index = (await r.json().catch(() => null)) as { chunks: string[]; encoding?: 'base64'; files: { path: string; size: number }[] } | null;
  if (!index?.chunks?.length) return null;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < index.chunks.length; i++) {
    progress?.(`下载原版文件 ${i + 1}/${index.chunks.length}`, i / index.chunks.length);
    const c = await fetch(`./gamedata/${index.chunks[i]}`);
    if (!c.ok) return null;
    if (index.encoding === 'base64') {
      // 发布平台只接受文本等常见类型，所以块以 base64 文本存放
      const bin = atob((await c.text()).trim());
      const u = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
      parts.push(u);
    } else parts.push(new Uint8Array(await c.arrayBuffer()));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const out = new Map<string, ArrayBuffer>();
  o = 0;
  for (const f of index.files) {
    out.set(f.path, all.slice(o, o + f.size).buffer);
    o += f.size;
  }
  return out;
}

export async function loadCached(): Promise<Map<string, ArrayBuffer> | null> {
  try {
    const m = await idbGetAll();
    return m.size ? m : null;
  } catch {
    return null;
  }
}

export async function saveCache(files: Map<string, ArrayBuffer>): Promise<void> {
  try {
    await idbPutAll(files);
  } catch (e) {
    console.warn('无法写入 IndexedDB 缓存', e);
  }
}

export const manifestEntries = ENTRIES;
