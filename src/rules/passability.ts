// 地图格子的通行判断（与 Phaser 无关，tools/ 也会用到）。
import type { MapLayer } from '../formats/map.ts';

/**
 * 图块 tile 的 .att 值是否为 0xFF。注意错一位：EXE 载入 .att 时把第 i 字节写进第 i+1 帧的记录
 * （0x41f6a8 先 add ecx, 0x10 再逐帧写 +0xf），查表时按 tile × 16 取记录（0x41f7b0），
 * 所以图块 tile 实际用的是 att[tile − 1]。
 */
export const attBlocks = (att: Uint8Array, tile: number) => tile > 0 && att[tile - 1] === 0xff;

/** 单格通行判断，对应 EXE 0x40bc30（载入地图后先把每层标为阻挡，再按下面的条件清掉地表层的阻挡位）。 */
export function cellPassable(layers: MapLayer[], groundAtt: Uint8Array, upperAtt: Uint8Array): boolean {
  const g = layers[0];
  if (g.tile === 0 || attBlocks(groundAtt, g.tile)) return false;
  const u = layers[1];
  if (!u) return true;
  // EXE 把文件里的 u16 高度左移 4 位存进内存，比较时再右移 4 位，所以只有低 12 位有效
  const gz = g.flags & 0xfff, uz = u.flags & 0xfff;
  if (gz !== uz) return uz - gz >= 0x40;
  return !attBlocks(upperAtt, u.tile);
}
