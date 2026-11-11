// GRP / PIC / LIB 图像库解码。见 docs/binary-formats.md §2–§4。
import { expectMagic } from './bytes.ts';

export interface Frame {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** 8 位调色板索引，行优先，长度 = width × height；索引 0 视为透明 */
  pixels: Uint8Array;
}

function pcxRle(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let i = 0, o = 0;
  while (i < src.length && o < n) {
    const b = src[i++];
    if (b >= 0xc0) {
      const v = src[i++];
      for (let k = 0; k < (b & 0x3f); k++) out[o++] = v;
    } else out[o++] = b;
  }
  return out;
}

function packBits(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let i = 0, o = 0;
  while (i < src.length && o < n) {
    const b = src[i++];
    if (b < 128) {
      for (let k = 0; k <= b; k++) out[o++] = src[i++];
    } else if (b > 128) {
      const v = src[i++];
      for (let k = 0; k < 257 - b; k++) out[o++] = v;
    }
  }
  return out;
}

function decodeEntry(buf: Buffer, e: number, entSize: 19 | 20): Frame {
  const off = buf.readUInt32LE(e);
  const width = buf.readUInt16LE(e + 4);
  const height = buf.readUInt16LE(e + 8);
  const anchorX = buf.readUInt16LE(e + 10);
  const anchorY = buf.readUInt16LE(e + 12);
  const enc = entSize === 20 ? buf.readUInt16LE(e + 14) : buf[e + 14];
  const size = buf.readUInt32LE(e + (entSize === 20 ? 16 : 15));
  const src = buf.subarray(off, off + size);
  const n = width * height;
  const pixels = enc === 1 ? pcxRle(src, n) : packBits(src, n);
  return { width, height, anchorX, anchorY, pixels };
}

/** GRP 图块库：返回按帧号取帧的函数（懒解码）。 */
export function openGrp(buf: Buffer, file = 'grp'): { count: number; frame(i: number): Frame } {
  expectMagic(buf, 'GRP\0', file);
  const count = buf.readUInt16LE(5);
  const index = buf.readUInt32LE(7);
  const cache = new Map<number, Frame>();
  return {
    count,
    frame(i) {
      let f = cache.get(i);
      if (!f) cache.set(i, (f = decodeEntry(buf, index + 20 * i, 20)));
      return f;
    },
  };
}

/** PIC 图像库（Head.lib、Object.lib）：11 B 头，索引表偏移在 +7，每条 19 B。 */
export function openPic(buf: Buffer, file = 'pic'): { count: number; frame(i: number): Frame } {
  expectMagic(buf, 'PIC\0', file);
  const count = buf.readUInt16LE(5);
  const index = buf.readUInt32LE(7);
  const cache = new Map<number, Frame>();
  return {
    count,
    frame(i) {
      let f = cache.get(i);
      if (!f) cache.set(i, (f = decodeEntry(buf, index + 19 * i, 19)));
      return f;
    },
  };
}

export interface LibGroup {
  first: number;
  last: number;
  param: number;
}

/**
 * LIB 动画库（Man.lib、Effect.lib、Panel.lib）。见 docs/binary-formats.md §4。
 * 文件尾是 N × 19 B 的帧索引；其前是 (A + B) × 8 B 的动作组表。
 * Man.lib：组表前 B 项 = 每个职业的动作组范围，后 A 项 = 每个动作组的帧范围。
 */
export function openLib(buf: Buffer, file = 'lib') {
  expectMagic(buf, 'LIB\0', file);
  const count = buf.readUInt16LE(5);
  const a = buf.readUInt16LE(7);
  const b = buf.readUInt16LE(9);
  const index = buf.length - 19 * count;
  const groupTable = index - 8 * (a + b);
  const groups: LibGroup[] = [];
  for (let i = 0; i < a + b; i++) {
    const o = groupTable + 8 * i;
    groups.push({ first: buf.readUInt16LE(o), last: buf.readUInt16LE(o + 2), param: buf.readUInt16LE(o + 6) });
  }
  const cache = new Map<number, Frame>();
  return {
    count,
    /** 第一段（B 项）：Man.lib 中为职业 → 动作组范围 */
    classes: groups.slice(0, b),
    /** 第二段（A 项）：动作组 → 帧范围 */
    actions: groups.slice(b),
    frame(i: number): Frame {
      let f = cache.get(i);
      if (!f) cache.set(i, (f = decodeEntry(buf, index + 19 * i, 19)));
      return f;
    },
  };
}

export function parsePalette(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.subarray(0, 768));
}
