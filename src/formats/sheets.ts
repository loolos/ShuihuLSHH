// 拆出来的原版图像（gamedata/sprites、tiles、portraits、icons）：按目录 JSON 从 PNG 图里切出帧。
// 对外的样子和原来解原版图像库（image.ts 的 openLib / openGrp / openPic）一样：全局帧号、动作组表、frame(i)。
// 每帧在哪张 PNG 里由 sheetOf / pathOf 给出，先下载那张图（GameFiles.ensure）再取帧。格式见 docs/binary-formats.md §15。
import type { Frame, LibGroup } from './image.ts';
import type { IndexedImage } from './png-indexed.ts';

export type ImageGetter = (path: string) => IndexedImage;

/** [宽, 高, 锚点 x, 锚点 y]：图里每格一样大，各帧的锚点都对齐在格子里的这一点 */
type Cell = [number, number, number, number];
type Group = [number, number, number];

const groups = (g: Group[]): LibGroup[] => g.map(([first, last, param]) => ({ first, last, param }));

function cut(img: IndexedImage, x0: number, y0: number, w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(img.pixels.subarray((y0 + y) * img.width + x0, (y0 + y) * img.width + x0 + w), y * w);
  return px;
}

export interface SpriteLib {
  count: number;
  /** Man.lib：职业 → 动作组范围（4 个一组 = 一个动作的 4 个朝向）；特效没有 */
  classes: LibGroup[];
  /** 动作组 → 帧范围 */
  actions: LibGroup[];
  frame(i: number): Frame;
  /** 丢掉切好的帧（换关释放内存时用；之后取帧要先重新载入所在的图） */
  clear(): void;
  /** 动作组 g 的帧在哪张图里 */
  sheetOf(group: number): string;
}

/** 人物动画（sprites/man.json + sprites/man/<职业>/<动作>.png，4 行 = 4 个朝向） */
export function manLib(index: { classes: Group[]; actions: Group[]; sheets: Record<string, Cell> }, image: ImageGetter): SpriteLib {
  const classes = groups(index.classes), actions = groups(index.actions);
  const classOf = new Int16Array(actions.length).fill(-1);
  classes.forEach((c, k) => {
    for (let g = c.first; g <= c.last; g++) classOf[g] = k;
  });
  const where = (g: number) => {
    const c = classOf[g];
    const a = (g - classes[c].first) >> 2;
    return { c, a, row: (g - classes[c].first) & 3, path: `sprites/man/${String(c).padStart(2, '0')}/${String(a).padStart(2, '0')}.png` };
  };
  return sheetLib(actions, classes, (g) => {
    const w = where(g);
    return { path: w.path, row: w.row, cell: index.sheets[`${w.c}/${w.a}`] };
  }, image);
}

/** 技能特效（sprites/effects.json + sprites/effects/<组>.png，一行） */
export function effectLib(index: { actions: Group[]; sheets: Cell[] }, image: ImageGetter): SpriteLib {
  return sheetLib(groups(index.actions), [], (g) => ({ path: `sprites/effects/${String(g).padStart(2, '0')}.png`, row: 0, cell: index.sheets[g] }), image);
}

function sheetLib(actions: LibGroup[], classes: LibGroup[], place: (g: number) => { path: string; row: number; cell: Cell }, image: ImageGetter): SpriteLib {
  const count = actions.reduce((n, a) => Math.max(n, a.last + 1), 0);
  const groupOf = new Int32Array(count).fill(-1);
  actions.forEach((a, g) => {
    for (let i = a.first; i <= a.last; i++) groupOf[i] = g;
  });
  const cache = new Map<number, Frame>();
  return {
    count,
    classes,
    actions,
    sheetOf: (g) => place(g).path,
    clear: () => cache.clear(),
    frame(i) {
      let f = cache.get(i);
      if (f) return f;
      const g = groupOf[i];
      if (g < 0) throw new Error(`帧 ${i} 不属于任何动作组`);
      const { path, row, cell } = place(g);
      const [w, h, ax, ay] = cell;
      const col = i - actions[g].first;
      f = { width: w, height: h, anchorX: ax, anchorY: ay, pixels: cut(image(path), col * w, row * h, w, h) };
      cache.set(i, f);
      return f;
    },
  };
}

export interface TileLib {
  count: number;
  frame(i: number): Frame;
  /** 丢掉切好的帧（同 SpriteLib.clear） */
  clear(): void;
  /** 第 i 块在哪张图里 */
  sheetOf(i: number): string;
}

/** 地图图块、格子光标（tiles/tiles.json：每块 [图号, x, y, 宽, 高, 锚点 x, 锚点 y]，图是 tiles/<种类>/<图号>.png） */
export function tileLib(kind: string, list: number[][], image: ImageGetter): TileLib {
  const cache = new Map<number, Frame>();
  const sheetOf = (i: number) => `tiles/${kind}/${String(list[i][0]).padStart(2, '0')}.png`;
  return {
    count: list.length,
    sheetOf,
    clear: () => cache.clear(),
    frame(i) {
      let f = cache.get(i);
      if (f) return f;
      const [, x, y, w, h, ax, ay] = list[i];
      f = { width: w, height: h, anchorX: ax, anchorY: ay, pixels: cut(image(sheetOf(i)), x, y, w, h) };
      cache.set(i, f);
      return f;
    },
  };
}

/** 头像、道具图标（<种类>/<种类>.json：每张 [宽, 高, 锚点 x, 锚点 y]，图是 <种类>/<三位编号>.png） */
export function picLib(kind: string, list: Cell[], image: ImageGetter): TileLib {
  const cache = new Map<number, Frame>();
  const sheetOf = (i: number) => `${kind}/${String(i).padStart(3, '0')}.png`;
  return {
    count: list.length,
    sheetOf,
    clear: () => cache.clear(),
    frame(i) {
      let f = cache.get(i);
      if (f) return f;
      const [w, h, ax, ay] = list[i];
      f = { width: w, height: h, anchorX: ax, anchorY: ay, pixels: cut(image(sheetOf(i)), 0, 0, w, h) };
      cache.set(i, f);
      return f;
    },
  };
}
