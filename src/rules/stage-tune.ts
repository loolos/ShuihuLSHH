// 后期关卡加难度【新】（负责人 2026-11-14：晁蓋一伙入伙之后的关卡敌人多一些，或者增援来得早一些）。
// 不改原版文件：载入关卡时在 ACT 单位表后面追加敌人（照抄同关同职业的一个敌人：等级、装备、AI 模式一样），
// 在 PAS 区块后面追加"第 N 回合放出增援"的区块，或把原版增援区块的回合提前。设计见 docs/game-design.md §9.3。
import type { ActUnit } from '../formats/act.ts';
import type { PasBlock, PasOp } from '../formats/pas.ts';
import { key, type Board } from './board.ts';

/** 照抄本关第一个职业为 like 的敌人，放 n 个 */
export interface TuneUnits {
  like: number;
  n: number;
}

export interface TuneGroup {
  /** 第几回合开始时登场（玩家看到的回合数，1 起）；不写 = 开场就在 */
  turn?: number;
  /** 放在这一格附近：从这里按地形走得到的空格，由近到远 */
  at: [number, number];
  units: TuneUnits[];
  /** AI 模式；不写时增援用 0（冲向我方），开场就在的照抄原单位 */
  mode?: number;
}

export interface StageTune {
  add?: TuneGroup[];
  /** 原版回合区块提前：原第几回合 → 新第几回合（玩家看到的回合数） */
  earlier?: Record<number, number>;
}

const SOLDIER = 32, ARCHER = 34, CAVALRY = 43, CAPTAIN = 38, SOLDIER_B = 33;
const LOULUO_A = 44, LOULUO_B = 45, CHIEF = 65;

export const STAGE_TUNE: Record<string, StageTune> = {
  // 东溪村：何濤合围。第 5 回合东面再来一队官兵，从侧后包抄村子
  'n-add14': {
    add: [{ turn: 5, at: [50, 24], units: [{ like: CAPTAIN, n: 1 }, { like: SOLDIER, n: 4 }, { like: ARCHER, n: 2 }, { like: CAVALRY, n: 1 }] }],
  },
  // 东溪村突围：护送晁蓋。第 6 回合西边出口前的小路上来一队堵截，第 11 回合北面骑兵从后面追上来
  n12: {
    add: [
      { turn: 6, at: [5, 22], units: [{ like: SOLDIER, n: 3 }, { like: ARCHER, n: 1 }, { like: CAVALRY, n: 2 }] },
      { turn: 11, at: [29, 2], units: [{ like: CAVALRY, n: 4 }] },
    ],
  },
  // 诱敌蓼儿洼：诱敌阶段不动；第 7 回合伏兵出现（STAGE_TURN_TRIGGERS），之后第 11 回合北面再来一队官兵
  n13: {
    add: [{ turn: 11, at: [36, 7], units: [{ like: CAPTAIN, n: 1 }, { like: CAVALRY, n: 4 }, { like: SOLDIER_B, n: 3 }, { like: ARCHER, n: 2 }] }],
  },
  // 梁山泊前：出口前多一队守兵；第 5 回合身后追兵赶到（"且战且走"）
  'n-add16': {
    add: [
      { at: [9, 2], units: [{ like: LOULUO_A, n: 2 }, { like: LOULUO_B, n: 2 }] },
      { turn: 5, at: [28, 32], units: [{ like: CHIEF, n: 1 }, { like: LOULUO_A, n: 1 }, { like: LOULUO_B, n: 4 }] },
    ],
  },
  // 火并王倫：两波增援提前（第 6 回合 → 第 4 回合，第 11 回合 → 第 8 回合）
  n14: { earlier: { 6: 4, 11: 8 } },
};

export const stageTune = (stage: string): StageTune | undefined => STAGE_TUNE[stage.toLowerCase()];

const NARRATOR = 0xffffffff;
const REINFORCE = { big5: '敵軍增援了！', gbk: '敌军增援了！' };

/** 按 add 里的每一组算出新单位（不改原数组）。新单位的编号、编组号都接在原来的后面 */
export function tuneUnits(stage: string, units: ActUnit[], board: Board): ActUnit[] {
  const t = stageTune(stage);
  if (!t?.add) return units;
  const out = [...units];
  const taken = new Set(units.filter((u) => u.side !== 'unknown').map((u) => key(u.x, u.y)));
  let index = Math.max(...units.map((u) => u.index)) + 1;
  let group = Math.max(...units.map((u) => u.group)) + 1;
  for (const g of t.add) {
    const cells = [...board.reach({ x: g.at[0], y: g.at[1] }, 40, taken).values()]
      .filter((c) => !taken.has(key(c.x, c.y)))
      .sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
    let k = 0;
    for (const { like, n } of g.units) {
      const base =
        units.find((u) => u.side === 'enemy' && u.type === like && !(u.flags & 0xff) && ![6, 7, 9].includes(u.flags >> 8)) ??
        units.find((u) => u.side === 'enemy' && u.type === like);
      if (!base) throw new Error(`${stage}：没有职业 ${like} 的敌人可照抄`);
      for (let i = 0; i < n; i++) {
        const c = cells[k++];
        if (!c) throw new Error(`${stage}：(${g.at}) 附近放不下`);
        taken.add(key(c.x, c.y));
        const mode = g.mode ?? (g.turn ? 0 : base.flags >> 8);
        out.push({ ...base, index: index++, group: group++, x: c.x, y: c.y, flags: (mode << 8) | (g.turn ? 1 : 0), extra: [...base.extra], items: [...base.items], raw: [...base.raw] });
      }
    }
  }
  return out;
}

/** 追加增援区块、提前原版回合区块。原版和简体两份剧本都要过一遍，保持区块一一对应 */
export function tuneBlocks(stage: string, blocks: PasBlock[], units: ActUnit[], encoding: 'big5' | 'gbk'): PasBlock[] {
  const t = stageTune(stage);
  if (!t) return blocks;
  const out = blocks.map((b) => {
    if (b.trigger.kind !== 'turn' || !t.earlier) return b;
    const to = t.earlier[b.trigger.turn + 1];
    if (!to) return b;
    return { ...b, trigger: { kind: 'turn' as const, turn: to - 1 }, cond: { type: 0, arg: to - 1 } };
  });
  // tuneUnits 追加的增援按组的顺序排在 ACT 末尾
  const added = units.slice(units.length - (t.add ?? []).reduce((s, g) => s + g.units.reduce((a, u) => a + u.n, 0), 0));
  let k = 0;
  for (const g of t.add ?? []) {
    const n = g.units.reduce((a, u) => a + u.n, 0);
    const mine = added.slice(k, k + n);
    k += n;
    if (!g.turn) continue;
    const op = (code: number, value: number, extra: Partial<PasOp> = {}): PasOp => ({ op: code, flag: code < 24 ? 1 : null, value, ...extra });
    const ops = [...mine.map((u) => op(12, 1000 + u.group)), op(12, NARRATOR), op(13, 0, { text: REINFORCE[encoding] })];
    out.push({ index: out.length, head: [1, 0, 0, 0, 0, 0, 0, 0, 0], trigger: { kind: 'turn', turn: g.turn - 1 }, cond: { type: 0, arg: g.turn - 1 }, ops });
  }
  return out;
}
