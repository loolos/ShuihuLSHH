// PAS 剧本：15 B 头 + 指令流。目前只识别对白指令，其它指令原样保留。见 docs/binary-formats.md §8。
import { decodeBig5, decodeGbk } from './bytes.ts';

export interface DialogueLine {
  offset: number;
  speaker: number;
  text: string;
}
export interface PasScript {
  lines: DialogueLine[];
  /** 不属于对白指令的可读字符串（关卡目标说明等），按出现顺序 */
  otherStrings: { offset: number; text: string }[];
}

const DIALOGUE_HEAD = [0x04, 0x00, 0x0c, 0x00, 0x01, 0x00];

function isLeadByte(b: number) {
  return b >= 0x81 && b <= 0xfe;
}

export function parsePas(buf: Buffer, encoding: 'big5' | 'gbk' = 'big5', file = 'pas'): PasScript {
  if (buf.subarray(0, 3).toString('latin1') !== 'PAS') throw new Error(`${file}: 魔数应为 PAS`);
  const dec = encoding === 'big5' ? decodeBig5 : decodeGbk;
  const lines: DialogueLine[] = [];
  const covered: [number, number][] = [];
  for (let o = 15; o + 18 < buf.length; o++) {
    if (!DIALOGUE_HEAD.every((b, k) => buf[o + k] === b)) continue;
    const speaker = buf.readUInt16LE(o + 6);
    const len = buf.readUInt16LE(o + 10);
    if (buf.readUInt16LE(o + 8) !== 0 || buf.readUInt16LE(o + 12) !== 0x0d || buf.readUInt16LE(o + 14) !== 0) continue;
    const s = o + 16;
    const body = buf.subarray(s, s + len);
    const z = body.indexOf(0);
    lines.push({ offset: o, speaker, text: dec(z >= 0 ? body.subarray(0, z) : body) });
    covered.push([o, s + len]);
    o = s + len - 1;
  }
  // 其它字符串：至少 2 个双字节字符的连续可读段，且不在对白范围内
  const otherStrings: { offset: number; text: string }[] = [];
  const inDialogue = (p: number) => covered.some(([a, b]) => p >= a && p < b);
  for (let o = 15; o < buf.length; ) {
    let p = o;
    let wide = 0;
    while (p < buf.length) {
      if (isLeadByte(buf[p]) && p + 1 < buf.length && buf[p + 1] >= 0x40) {
        p += 2;
        wide++;
      } else if (buf[p] >= 0x20 && buf[p] < 0x7f && p > o) p++;
      else break;
    }
    if (wide >= 2 && buf[p] === 0 && !inDialogue(o)) {
      otherStrings.push({ offset: o, text: dec(buf.subarray(o, p)).trim() });
      o = p + 1;
    } else o = Math.max(p, o + 1);
  }
  return { lines, otherStrings };
}
