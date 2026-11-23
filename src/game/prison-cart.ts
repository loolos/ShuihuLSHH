// 囚车（青州道劫囚等关里被押的人）：用原版地图物件拼出来，不另外手画（负责人 2026-11-20 选方案 B）。
// 木板手推车 = 上层图块 559（法场地图 N05、N09 上摆的那辆车），背后两段木栅柱 = 上层图块 579、580（牢城营一类地图的木栅栏，
// Act11-1a、N10 等）。三块按各自锚点对齐到格子中心，整体往下挪 DROP 像素，让人看上去站在车板上（人物精灵不用挪）。
import type { Assets } from './assets.ts';
import { frameToCanvas } from './assets.ts';

/** 画囚车要用的上层图块（进关前要先下载它们所在的图集） */
export const PRISON_CART_TILES = [579, 580, 559] as const;
const DROP = 8;

/** 拼好的囚车图和它的锚点（对准人物所在格子的中心） */
export function prisonCartCanvas(assets: Assets): { canvas: HTMLCanvasElement; ax: number; ay: number } {
  const parts = PRISON_CART_TILES.map((t) => assets.upper.frame(t));
  const left = Math.max(...parts.map((f) => f.anchorX)), top = Math.max(...parts.map((f) => f.anchorY));
  const right = Math.max(...parts.map((f) => f.width - f.anchorX)), bottom = Math.max(...parts.map((f) => f.height - f.anchorY));
  const canvas = document.createElement('canvas');
  canvas.width = left + right;
  canvas.height = top + bottom + DROP;
  const c = canvas.getContext('2d')!;
  for (const f of parts) c.drawImage(frameToCanvas(f, assets.palette), left - f.anchorX, top - f.anchorY + DROP);
  return { canvas, ax: left, ay: top };
}
