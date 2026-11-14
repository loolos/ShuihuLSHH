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

/**
 * 剧本文件头（15 字节）：'PAS' + u32 未知(+3) + u16 区块数(+7) + u16 城镇号(+9) + u16 下一关(+11) + u16 是否过场(+13)。
 * 城镇号非 0 时本关结束后进城（0x418c60 读取，城镇 2、5 离开时问分路）；下一关是 EXE 关卡表序号，
 * 如 Act3-4 → 14（N-add04a），N-add04a/b → 16，N07 → 41（N-add09a），N-add09a/b → 43。
 */
export interface PasHeader {
  blockCount: number;
  town: number;
  next: number;
  /** 1 = 过场（Act*、Train*），0 = 战役 */
  act: number;
}

export function parsePasHeader(buf: Buffer): PasHeader {
  if (buf.subarray(0, 3).toString('latin1') !== 'PAS') throw new Error('魔数应为 PAS');
  return { blockCount: buf.readUInt16LE(7), town: buf.readUInt16LE(9), next: buf.readUInt16LE(11), act: buf.readUInt16LE(13) };
}

// ───────────── 区块与指令（事件脚本），结构见 docs/binary-formats.md §8 ─────────────

export type PasTrigger =
  | { kind: 'turn'; turn: number } // 参数 N：第 N + 1 回合开始时；0 = 开战
  | { kind: 'death'; char: number } // 角色号；1000 = 主角
  /** chars（扩展包【新】）：这几个角色都在范围里才触发（劫法场：宋江、戴宗都逃到出口）；没有时看 char */
  | { kind: 'area'; char: number; x1: number; y1: number; x2: number; y2: number; chars?: number[] }
  /** 条件 2：N-add03 区块 30（参数 1），内容是"有埋伏！"——重制版放在伏兵号令之后执行（推测） */
  | { kind: 'signal'; type: number; param: number }
  /** 其它条件（组合条件、条件 3/11 等）：按 cond 求值 */
  | { kind: 'cond' }
  /**
   * 扩展包【新】：角色号 char 的单位出手之后——用过 skills 里全部技能（技能号），或累计出手 count 次（含普通攻击、反击）。
   * 原版剧本没有这种触发，只由扩展包关卡（src/packs/）生成。
   */
  | { kind: 'used'; char: number; skills?: number[]; count?: number }
  /** 扩展包【新】：任一在场的我方单位走到角色号 char 的单位身边（相邻一格）。劫法场"走过去松绑"用 */
  | { kind: 'near'; char: number };

/**
 * 区块的触发条件树（EXE 0x411410 递归解析，叶子由 0x411220 求值）。节点 = {u16 参数个数标记, u16 A, u16 B, u16 组合}，
 * 标记为 2 时后跟 1 个 u16 参数，为 4 时后跟 2 个；A = 0xFF 表示左边是子节点，B = 0xFF 表示右边是子节点，
 * B = 0xFFFF 表示只有 A 一个叶子；组合 0 = 或、1 = 与。叶子类型见 docs/binary-formats.md §8。
 */
export type PasCond = { type: number; arg: number } | { op: 'and' | 'or'; a: PasCond; b: PasCond };

export interface PasOp {
  op: number;
  flag: number | null; // 操作码 < 24 时才有
  /** 操作码 12/14/15/16/17/18/19/35 等的数值参数（u16 或 u32） */
  value: number;
  /** 文字指令（13 对白、29/30 旁白与结局、31–33 条件）的内容；扩展包指令 102 是新名字 */
  text?: string;
  /** 扩展包的新指令（100 起，src/packs/script.ts）的参数 */
  args?: { stat?: string; pct?: number; add?: number; turns?: number };
}

export interface PasBlock {
  index: number;
  head: number[]; // w0..w8
  trigger: PasTrigger;
  cond: PasCond;
  ops: PasOp[];
}

const TEXT_OPS = new Set([13, 20, 21, 29, 30, 31, 32, 33]);

/**
 * 按区块切分 .pab。区块 +16 起是条件树（EXE 0x411410，见 docs/binary-formats.md §8），简单的回合/死亡/区域条件另外归类；
 * 触发器：w0 = 1 时 w8 = 0 为回合、1 为死亡，参数在区块 +24；
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
    let p = o + 16;
    const node = (): PasCond => {
      const [n, a, b, comb] = [0, 2, 4, 6].map((k) => buf.readUInt16LE(p + k));
      p += 8;
      let x = 0, y = 0;
      if (n === 2) {
        x = buf.readUInt16LE(p);
        p += 2;
      } else if (n === 4) {
        x = buf.readUInt16LE(p);
        y = buf.readUInt16LE(p + 2);
        p += 4;
      }
      const op = comb === 1 ? 'and' : 'or';
      if (a === 0xff) {
        const l = node();
        return { op, a: l, b: node() };
      }
      if (b === 0xffff) return { type: a, arg: x };
      return { op, a: { type: a, arg: x }, b: b === 0xff ? node() : { type: b, arg: y } };
    };
    const cond = node();
    const start = p - o;
    if (head[0] === 1 && (head[8] === 0 || head[8] === 1) && 'type' in cond) {
      trigger = head[8] === 0 ? { kind: 'turn', turn: cond.arg } : { kind: 'death', char: cond.arg };
    } else if (head[0] === 1 && head[8] === 2 && 'type' in cond) {
      trigger = { kind: 'signal', type: 2, param: cond.arg };
    } else if (head[0] === 4) {
      trigger = {
        kind: 'area',
        char: buf.readUInt32LE(o + 24),
        x1: buf.readUInt16LE(o + 42),
        y1: buf.readUInt16LE(o + 44),
        x2: buf.readUInt16LE(o + 54),
        y2: buf.readUInt16LE(o + 56),
      };
    } else {
      trigger = { kind: 'cond' };
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
    blocks.push({ index: i, head, trigger, cond, ops });
    o += len;
  }
  return blocks;
}
