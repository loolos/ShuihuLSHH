// 地图格子的通行判断（与 Phaser 无关，tools/ 也会用到）。
import type { MapLayer } from '../formats/map.ts';

/** 单格通行判断，对应 EXE 0x40bc30（载入地图后先把每层标为阻挡，再按下面的条件清掉地表层的阻挡位）。 */
export function cellPassable(layers: MapLayer[], groundAtt: Uint8Array, upperAtt: Uint8Array): boolean {
  const g = layers[0];
  if (g.tile === 0 || groundAtt[g.tile] === 0xff) return false;
  const u = layers[1];
  if (!u) return true;
  // EXE 把文件里的 u16 高度左移 4 位存进内存，比较时再右移 4 位，所以只有低 12 位有效
  const gz = g.flags & 0xfff, uz = u.flags & 0xfff;
  if (gz !== uz) return uz - gz >= 0x40;
  return upperAtt[u.tile] !== 0xff;
}
