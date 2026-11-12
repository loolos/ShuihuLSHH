// 取得原版文件：IndexedDB 缓存 → 开发服务器 → 试玩页面附带 → GitHub 仓库里的 gamedata/shuihu → 玩家选目录。
// 构建产物里没有原版素材；网页版运行时从仓库下载（负责人 2026-11-12 决定）。
import manifest from '../data/manifest.json';
import { idbGetAll, idbPutAll } from './idb.ts';

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}
const ENTRIES = (manifest as { files: ManifestEntry[] }).files;
const key = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/** 已载入的原版文件，按相对路径（不区分大小写）取用。 */
export class GameFiles {
  private readonly files: Map<string, ArrayBuffer>;
  constructor(files: Map<string, ArrayBuffer>) {
    this.files = new Map([...files].map(([k, v]) => [key(k), v]));
  }
  has(path: string): boolean {
    return this.files.has(key(path));
  }
  /** 返回 Buffer（浏览器中由 buffer-shim 提供），与离线工具共用解析器。 */
  get(path: string): Buffer {
    const ab = this.files.get(key(path));
    if (!ab) throw new Error(`缺少原版文件：${path}`);
    return Buffer.from(ab);
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

/** 从 GitHub 仓库按 manifest 下载全部原版文件（约 65 MB，8 路并发）；任何一个失败就返回 null */
export async function loadFromRepo(progress?: Progress, base = REPO_GAMEDATA): Promise<Map<string, ArrayBuffer> | null> {
  if (import.meta.env.DEV) return null;
  const total = ENTRIES.reduce((n, e) => n + e.size, 0);
  const out = new Map<string, ArrayBuffer>();
  let done = 0, next = 0, failed = false;
  const worker = async () => {
    while (!failed && next < ENTRIES.length) {
      const e = ENTRIES[next++];
      const url = base + e.path.split('/').map(encodeURIComponent).join('/');
      const r = await fetch(url).catch(() => null);
      if (!r?.ok) {
        failed = true;
        return;
      }
      out.set(e.path, await r.arrayBuffer());
      done += e.size;
      progress?.(`从 GitHub 下载原版文件 ${Math.round(done / 1048576)} / ${Math.round(total / 1048576)} MB`, done / total);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return failed ? null : out;
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
