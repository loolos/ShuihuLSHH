// MAP 战场地图：9 B 头 + W×H 个格子，每格为 {u16 tile, u8 cont, u16 flags} 链。
import { expectMagic } from './bytes.ts';

export interface MapLayer {
  tile: number;
  flags: number;
}
export interface MapData {
  width: number;
  height: number;
  /** cells[y * width + x]，第 0 层为地表（Ground.grp），其余为地上物（Upper.grp） */
  cells: MapLayer[][];
}

export function parseMap(buf: Buffer, file = 'map'): MapData {
  expectMagic(buf, 'MAP\0', file);
  const width = buf.readUInt16LE(5);
  const height = buf.readUInt16LE(7);
  const cells: MapLayer[][] = [];
  let o = 9;
  for (let c = 0; c < width * height; c++) {
    const layers: MapLayer[] = [];
    for (;;) {
      const tile = buf.readUInt16LE(o);
      const cont = buf[o + 2];
      const flags = buf.readUInt16LE(o + 3);
      o += 5;
      layers.push({ tile, flags });
      if (cont === 0) break;
      if (cont !== 2) throw new Error(`${file}: 未知 cont 值 ${cont} @${o - 3}`);
    }
    cells.push(layers);
  }
  if (o !== buf.length) throw new Error(`${file}: 解析后剩余 ${buf.length - o} 字节`);
  return { width, height, cells };
}
