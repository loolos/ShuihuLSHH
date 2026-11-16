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

/** 从地图里截一块矩形（扩展包关卡借原版大地图的一角用）；越出原图的部分当地图外 */
export function cropMap(map: MapData, x0: number, y0: number, width: number, height: number): MapData {
  const cells: MapLayer[][] = [];
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++)
      cells.push(x >= 0 && y >= 0 && x < map.width && y < map.height ? map.cells[y * map.width + x] : [{ tile: 0, flags: 0 }]);
  return { width, height, cells };
}

/**
 * 重制版自拼地图的 JSON（packs/maps/*.json，由 tools/compose-map.ts 按配方生成，只存图块号，不含原版图像）：
 * cells[y * width + x] 是数字（只有地表）或数组 [地表, 地上物, 高度, 地上物, 高度, …]；高度同 MAP 的 flags（像素）。
 */
export interface MapJson {
  width: number;
  height: number;
  cells: (number | number[])[];
}

export function mapFromJson(j: MapJson, file = 'map.json'): MapData {
  if (j.cells.length !== j.width * j.height) throw new Error(`${file}: 格子数 ${j.cells.length} ≠ ${j.width}×${j.height}`);
  const cells = j.cells.map((c) => {
    if (typeof c === 'number') return [{ tile: c, flags: 0 }];
    const layers: MapLayer[] = [{ tile: c[0], flags: 0 }];
    for (let i = 1; i + 1 < c.length; i += 2) layers.push({ tile: c[i], flags: c[i + 1] });
    return layers;
  });
  return { width: j.width, height: j.height, cells };
}

export function mapToJson(m: MapData): MapJson {
  return {
    width: m.width,
    height: m.height,
    cells: m.cells.map((c) => (c.length === 1 ? c[0].tile : [c[0].tile, ...c.slice(1).flatMap((l) => [l.tile, l.flags])])),
  };
}
