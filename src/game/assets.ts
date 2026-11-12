// 从原版文件解码出的共享资源：调色板、图块库、人物动画库、EXE 表、道具表。
import { openGrp, openLib, openPic, parsePalette, type Frame } from '../formats/image.ts';
import { readExeTables, type ExeTables } from '../formats/exe.ts';
import { parseGoods, type Item } from '../formats/goo.ts';
import { parseAct } from '../formats/act.ts';
import { parseMap } from '../formats/map.ts';
import type { GameFiles, Progress } from '../platform/gamefiles.ts';
import { buildT2S, findStageFile, loadGameData } from '../rules/load.ts';
import type { GameData } from '../rules/data.ts';

export interface Assets {
  files: GameFiles;
  palette: Uint8Array;
  ground: ReturnType<typeof openGrp>;
  upper: ReturnType<typeof openGrp>;
  man: ReturnType<typeof openLib>;
  /** 技能特效：60 组，技能子项 +6 = 组号 + 1（0 = 无特效） */
  effects: ReturnType<typeof openLib>;
  objects: ReturnType<typeof openPic>;
  /** 半身头像，第 i 张对应 HUM 第 i 个职业（按图比对，见 binary-formats §3） */
  heads: ReturnType<typeof openPic>;
  exe: ExeTables;
  items: Item[];
  /** 规则引擎用的数据 */
  data: GameData;
  /** 繁→简（由 .pab/.pas 对齐得到） */
  tr: (s: string) => string;
}

export function loadAssets(files: GameFiles): Assets {
  const tr = buildT2S(files);
  return {
    tr,
    data: loadGameData(files, tr),
    files,
    palette: parsePalette(files.get('Data/Default.pal')),
    ground: openGrp(files.get('Data/Ground.grp'), 'Ground.grp'),
    upper: openGrp(files.get('Data/Upper.grp'), 'Upper.grp'),
    man: openLib(files.get('Data/Man.lib'), 'Man.lib'),
    effects: openLib(files.get('Data/Effect.lib'), 'Effect.lib'),
    objects: openPic(files.get('Data/Object.lib'), 'Object.lib'),
    heads: openPic(files.get('Data/Head.lib'), 'Head.lib'),
    exe: readExeTables(files.get('ShuiHu.exe')),
    items: parseGoods(files.get('Data/Goods.dab')),
  };
}

/**
 * 进关前下载本关要用的帧（网页版大文件按需下载；整份在本地时什么也不做）：
 * 本关出场职业的人物动画、它们技能的特效，以及地图用到的图块。返回新下载的字节数。
 */
export async function preloadStage(assets: Assets, stage: string, progress?: Progress): Promise<number> {
  const { files } = assets;
  const want = new Map<string, [number, number][]>();
  const add = (path: string, span: [number, number]) => {
    if (span[1] > span[0]) (want.get(path) ?? want.set(path, []).get(path)!).push(span);
  };
  const mapFile = findStageFile(files, stage, '.map');
  if (!mapFile) return 0;
  const map = parseMap(files.get(mapFile), mapFile);
  for (const cell of map.cells)
    cell.forEach((l, k) => {
      const lib = k === 0 ? assets.ground : assets.upper;
      if (l.tile < lib.count) add(k === 0 ? 'Data/Ground.grp' : 'Data/Upper.grp', lib.span(l.tile));
    });
  const actFile = mapFile.replace(/\.map$/i, '.act');
  const classes = new Set([0]);
  if (files.has(actFile))
    for (const a of parseAct(files.get(actFile), actFile)) if (a.side !== 'object' && a.side !== 'unknown' && a.type < assets.data.classes.length) classes.add(a.type);
  for (const cls of classes) {
    const c = assets.man.classes[cls];
    if (c)
      for (let g = c.first; g <= c.last; g++) {
        const r = assets.man.actions[g];
        if (r) for (let i = r.first; i <= r.last; i++) add('Data/Man.lib', assets.man.span(i));
      }
    for (const sk of assets.data.classes[cls]?.skills ?? []) {
      const r = sk.effect > 0 ? assets.effects.actions[sk.effect - 1] : undefined;
      if (r) for (let i = r.first; i <= r.last; i++) add('Data/Effect.lib', assets.effects.span(i));
    }
  }
  return files.ensure(want, progress);
}

/** 把 8 位索引帧转成 RGBA 画布；索引 0 透明。 */
export function frameToCanvas(fr: Frame, palette: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, fr.width);
  c.height = Math.max(1, fr.height);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let i = 0; i < fr.pixels.length; i++) {
    const p = fr.pixels[i];
    if (!p) continue;
    d[i * 4] = palette[p * 3];
    d[i * 4 + 1] = palette[p * 3 + 1];
    d[i * 4 + 2] = palette[p * 3 + 2];
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
