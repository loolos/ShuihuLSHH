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
  | { kind: 'turn'; turn: number; /** 扩展包【新】：区块写了 if / unless，执行前要检查标志 */ flagged?: boolean } // 参数 N：第 N + 1 回合开始时；0 = 开战；−1（必须 flagged）= 第 2 回合起任何一回合开始时，标志一满足就执行【新】
  | { kind: 'death'; char: number } // 角色号；1000 = 主角
  /** chars（扩展包【新】）：这几个角色都在范围里才触发（劫法场：宋江、戴宗都逃到出口）；没有时看 char */
  | { kind: 'area'; char: number; x1: number; y1: number; x2: number; y2: number; chars?: number[]; /** 扩展包【新】：区块写了 if / unless（教学关的将台，§15.26） */ flagged?: boolean; /** 扩展包【新】：地图上区域旁写的字（默认「撤退」） */ label?: string; /** 【新】回合结束（下回合开始前）才检查 */ atTurnEnd?: boolean; /** 【新】这一方任何一个在场的人进去都算（怒破何观察：哪位好汉都能放火），这时不看 char */ side?: 'player' }
  /** 条件 2：N-add03 区块 30（参数 1），内容是"有埋伏！"——重制版放在伏兵号令之后执行（推测） */
  | { kind: 'signal'; type: number; param: number }
  /** 其它条件（组合条件、条件 3/11 等）：按 cond 求值 */
  | { kind: 'cond'; /** 【新】条件树里的坐标判断（条件 4 选人）只在回合结束时算（N12 晁盖撤退） */ atTurnEnd?: boolean }
  /**
   * 扩展包【新】：角色号 char 的单位出手之后——用过 skills 里全部技能（技能号），或累计出手 count 次（含普通攻击、反击）。
   * 原版剧本没有这种触发，只由扩展包关卡（src/packs/）生成。
   */
  | { kind: 'used'; char: number; skills?: number[]; count?: number }
  /** 扩展包【新】：在场我方走到目标身边（相邻一格）；uid 精确选目标，by 可限定接近者职业。省略 by 时任一我方均可，兼容劫法场松绑 */
  | { kind: 'near'; char: number; uid?: number; by?: number; playerPhase?: boolean; /** 几格以内算碰到，默认 1（身边）【新】 */ range?: number; /** 【新】回合结束（下回合开始前）还在身边才触发（还道村受天书：宋江走到玄女像旁） */ atTurnEnd?: boolean }
  /** 扩展包【新】：目标在场、活着且生命低于最大值的 below%（攻破清风寨：黄信打到一半以下才肯归降） */
  | { kind: 'hp'; char: number; uid?: number; below: number; /** 【新】比武点到为止（叫阵晁家庄）：区块没执行、标志也满足时，这人挨打不会被打倒，至少留 1 点体力 */ spare?: boolean }
  /**
   * 扩展包【新】：这个人刚做了某个操作（教学关一步一步教，§15.26）。只在操作发生的那一刻判，之前做过的不算；
   * action 见 DidAction；可配 if / unless 标志，标志不满足时这次操作不算，等下一次。
   */
  | { kind: 'did'; char: number; uid?: number; action: DidAction };

/**
 * 教学关判的操作：move 移动；attack 普通攻击；skill 用技能（含回气、回复）；flank 从背后或侧面出手；
 * defend 防御；guard 防御中被人打（命中或闪开都算）；counter 反击；rest 休息；item 用道具；give 给予道具。
 */
export type DidAction = 'move' | 'attack' | 'skill' | 'flank' | 'defend' | 'guard' | 'counter' | 'rest' | 'item' | 'give' | 'drunk' | 'refuse' | 'wake';

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
  /** 文字指令的固定编号【新】（多语言，docs/game-design.md §10.3）：同一关里唯一，分配后不再变；tools/i18n.ts ids 自动补 */
  id?: number;
  /** 载入时补上的完整编号「关卡名#编号」（如 N01#7），译文按它查；文件里不写 */
  tid?: string;
  /** 扩展包的新指令（100 起，src/packs/script.ts）的参数 */
  args?: { stat?: string; pct?: number; add?: number; turns?: number; /** 108 转身、109 动作、112 镜头：对着这个编组号的人 */ toward?: number; /** 109 动作：attack / hurt / defend */ action?: string; /** 118 拔树：整株地上物所在格 */ cells?: { x: number; y: number }[]; /** 112 镜头：格子坐标 */ x?: number; y?: number; /** 120 剧情选项：选项文字和选中后设的标志 */ options?: { label: string; flag: number; /** 多语言编号 */ tid?: string }[]; /** 121 收手：照打倒给经验、交出击退银子的百分之几、直接离场、不飘字 */ reward?: boolean; goldPct?: number; leave?: boolean; quiet?: boolean; /** 115 换阵营：连带 range 格内最近的 nearest 个同阵营的人（classes 限定职业） */ nearest?: number; range?: number; classes?: number[]; /** 115：按比例换（0.5 = 一半），crewOnly = 不换选中的人本身 */ fraction?: number; crewOnly?: boolean; /** 115：只在这些编号里挑 */ only?: number[]; /** 12 选人【新】：只挑这一方（side）在场的、被定住的（stunned）人、第几个（nth） */ side?: string; stunned?: boolean; nth?: number; /** 27 选人【新】（叫阵晁家庄单挑）：没选上的人留在原地观战（不退场），选上的人走到 (x, y) 附近；fresh = 本关选过的人不能再选；must = 这几个职业要在剩下 left 次选人里出场一次 */ keep?: boolean; fresh?: boolean; must?: number[]; left?: number; /** 124 放火【新】（怒破何观察）：panic = 离火最近的几个敌人逃窜，turns 回合；spare = 不会逃窜的职业（何涛）；focus = 镜头先移到火上 */ panic?: number; spare?: number[]; focus?: boolean; /** 126 黑尘 / 怪风【新】（还道村）：画面样式、范围（步数） */ style?: string; radius?: number; /** 103 标志【新】：clear = 清掉这个标志（杯酒救铁牛：李云醒了） */ clear?: boolean; /** 17 退场【新】：awake = 只让醒着的人退场 */ awake?: boolean; /** 129 就近摆路障【新】（盘陀路）：候选路口、路障图块、伏兵编组、跳过哪些标签的路口、摆几处、离我方至少几步 */ sites?: { cells: { x: number; y: number }[]; tag?: string; tile?: number }[]; tile?: number; groups?: number[]; exclude?: string[]; count?: number; min?: number; /** 129：设障以后每个好汉都还要走得到这一格（石秀带路以后不能再把人关死） */ reach?: { x: number; y: number } };
  /** 指令 12【新】：只点名说话者，隐藏的人不随之登场（重制版补的对白，src/rules/story-quotes.ts） */
  quiet?: boolean;
  /** 剧情点名：已战败角色仅供演出，不复活、不改变战斗状态。near为显示时靠近的职业号。 */
  actor?: { action: 'show' | 'speak' | 'hide'; near?: number };
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
