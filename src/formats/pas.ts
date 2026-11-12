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

// ───────────── 区块与指令（事件脚本），结构见 docs/binary-formats.md §8 ─────────────

export type PasTrigger =
  | { kind: 'turn'; turn: number } // 参数 N：第 N + 1 回合开始时；0 = 开战
  | { kind: 'death'; char: number } // 角色号；1000 = 主角
  | { kind: 'area'; char: number; x1: number; y1: number; x2: number; y2: number }
  /** w8 = 2：N-add03 区块 30（参数 1），内容是"有埋伏！"——伏兵号令之后执行（推测）；w8 = 3：训练关等（参数 0），未解 */
  | { kind: 'signal'; type: number; param: number }
  | { kind: 'unknown'; w0: number; type: number };

export interface PasOp {
  op: number;
  flag: number | null; // 操作码 < 24 时才有
  /** 操作码 12/14/15/16/17/18/19/35 等的数值参数（u16 或 u32） */
  value: number;
  /** 文字指令（13 对白、29/30 旁白与结局、31–33 条件）的内容 */
  text?: string;
}

export interface PasBlock {
  index: number;
  head: number[]; // w0..w8
  trigger: PasTrigger;
  ops: PasOp[];
}

const TEXT_OPS = new Set([13, 20, 21, 29, 30, 31, 32, 33]);

/**
 * 按区块切分 .pab。触发器：w0 = 1 时 w8 = 0 为回合、1 为死亡，参数在区块 +24；
 * w0 = 4 为"某角色进入矩形区域"：+24 u32 角色号，+42/+44 与 +54/+56 为两角坐标（N01 区块 6 验证）。
 */
export function parsePasBlocks(buf: Buffer, encoding: 'big5' | 'gbk' = 'big5'): PasBlock[] {
  const dec = encoding === 'big5' ? decodeBig5 : decodeGbk;
  const n = buf.readUInt16LE(7);
  const blocks: PasBlock[] = [];
  let o = 15;
  for (let i = 0; i < n && o < buf.length; i++) {
    const len = buf.readUInt16LE(o);
    const head = Array.from({ length: 9 }, (_, k) => buf.readUInt16LE(o + 2 + 2 * k));
    let trigger: PasTrigger;
    let start: number;
    if (head[0] === 1 && (head[8] === 0 || head[8] === 1)) {
      const p = buf.readUInt16LE(o + 24);
      trigger = head[8] === 0 ? { kind: 'turn', turn: p } : { kind: 'death', char: p };
      start = 26;
    } else if (head[0] === 1 && (head[8] === 2 || head[8] === 3)) {
      trigger = { kind: 'signal', type: head[8], param: buf.readUInt16LE(o + 24) };
      start = 26;
    } else if (head[0] === 4) {
      trigger = {
        kind: 'area',
        char: buf.readUInt32LE(o + 24),
        x1: buf.readUInt16LE(o + 42),
        y1: buf.readUInt16LE(o + 44),
        x2: buf.readUInt16LE(o + 54),
        y2: buf.readUInt16LE(o + 56),
      };
      start = 58;
    } else {
      trigger = { kind: 'unknown', w0: head[0], type: head[8] };
      start = len; // 未解的触发器：不执行指令
    }
    const ops: PasOp[] = [];
    for (let p = o + start; p + 4 <= o + len; ) {
      const l = buf.readUInt16LE(p);
      const op = buf.readUInt16LE(p + 2);
      const flag = op < 24 ? buf.readUInt16LE(p + 4) : null;
      const body = p + (op < 24 ? 6 : 4);
      const payload = buf.subarray(body, body + l);
      const entry: PasOp = { op, flag, value: l >= 4 ? payload.readUInt32LE(0) : l >= 2 ? payload.readUInt16LE(0) : 0 };
      if (TEXT_OPS.has(op)) {
        const z = payload.indexOf(0);
        entry.text = dec(z >= 0 ? payload.subarray(0, z) : payload).trim();
      }
      ops.push(entry);
      p = body + l;
    }
    blocks.push({ index: i, head, trigger, ops });
    o += len;
  }
  return blocks;
}
