// 从原版文件解码出的共享资源：调色板、图块库、人物动画库、EXE 表、道具表。
import { openGrp, openLib, openPic, parsePalette, type Frame } from '../formats/image.ts';
import { readExeTables, type ExeTables } from '../formats/exe.ts';
import { parseGoods, type Item } from '../formats/goo.ts';
import type { GameFiles } from '../platform/gamefiles.ts';
import { buildT2S, loadGameData } from '../rules/load.ts';
import type { GameData } from '../rules/data.ts';

export interface Assets {
  files: GameFiles;
  palette: Uint8Array;
  ground: ReturnType<typeof openGrp>;
  upper: ReturnType<typeof openGrp>;
  man: ReturnType<typeof openLib>;
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
    objects: openPic(files.get('Data/Object.lib'), 'Object.lib'),
    heads: openPic(files.get('Data/Head.lib'), 'Head.lib'),
    exe: readExeTables(files.get('ShuiHu.exe')),
    items: parseGoods(files.get('Data/Goods.dab')),
  };
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
