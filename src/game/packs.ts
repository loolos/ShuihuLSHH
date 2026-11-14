// 扩展包在浏览器里的入口：包的 JSON 和图条随代码一起打包（都是重制版自己做的内容，不含原版素材），
// 选中某个包时再并进原版数据、载入图片。规则部分在 src/packs/build.ts。
import { buildPack, packStageName, type PackRuntime, type SpriteSheetJson } from '../packs/build.ts';
import type { PackJson, PackStageJson } from '../packs/types.ts';
import type { Assets } from './assets.ts';

const JSONS = import.meta.glob('/packs/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const PNGS = import.meta.glob('/packs/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface PackAssets {
  rt: PackRuntime;
  /** "<图条目录>/<文件名>" → 已载入的图片 */
  images: Map<string, HTMLImageElement>;
}

export interface PackEntry {
  pack: PackJson;
  stages: PackStageJson[];
}

/** packs/index.json 里启用的包 */
export function listPacks(): PackEntry[] {
  const ids = (JSONS['/packs/index.json'] as string[] | undefined) ?? [];
  return ids.flatMap((id) => {
    const pack = JSONS[`/packs/${id}/pack.json`] as PackJson | undefined;
    if (!pack) return [];
    const stages = pack.stages.map((s) => JSONS[`/packs/${id}/${s}`] as PackStageJson).filter(Boolean);
    return [{ pack, stages }];
  });
}

/** 选关里的值：pack:<包>/<关卡> */
export const isPackValue = (v: string) => v.startsWith('pack:');
export function parsePackValue(v: string): { pack: string; stage: string } | null {
  const m = /^pack:([\w-]+)\/([\w-]+)$/i.exec(v);
  return m ? { pack: m[1], stage: m[2] } : null;
}
export { packStageName };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`载入图片失败：${url}`));
    img.src = url;
  });
}

/** 并入原版数据，载入本包全部图条 */
export async function openPack(assets: Assets, id: string): Promise<PackAssets> {
  const entry = listPacks().find((e) => e.pack.id === id);
  if (!entry) throw new Error(`没有扩展包 ${id}`);
  const sheets: Record<string, SpriteSheetJson> = {};
  for (const c of entry.pack.classes) {
    const j = JSONS[`/packs/${id}/${c.sprite.sheet}/sprites.json`] as SpriteSheetJson | undefined;
    if (j) sheets[c.sprite.sheet] = j;
  }
  const rt = buildPack(assets.data, entry.pack, entry.stages, sheets);
  const images = new Map<string, HTMLImageElement>();
  const jobs: Promise<void>[] = [];
  for (const [sheet, j] of Object.entries(sheets))
    for (const a of Object.values(j.actions))
      for (const strip of [a.front, a.back]) {
        const url = PNGS[`/packs/${id}/${sheet}/${strip.file}`];
        if (url) jobs.push(loadImage(url).then((img) => void images.set(`${sheet}/${strip.file}`, img)));
      }
  await Promise.all(jobs);
  return { rt, images };
}

const CLEARED_KEY = (id: string) => `shuihu.pack.${id}`;
/** 外传的进度另存（不碰主线存档）：过了哪些关 */
export function packCleared(id: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLEARED_KEY(id)) ?? '{}');
    return Array.isArray(v.cleared) ? v.cleared : [];
  } catch {
    return [];
  }
}
export function markPackCleared(id: string, stage: string) {
  try {
    const list = packCleared(id);
    if (!list.includes(stage)) list.push(stage);
    localStorage.setItem(CLEARED_KEY(id), JSON.stringify({ cleared: list }));
  } catch {
    /* 隐私模式：不记 */
  }
}
