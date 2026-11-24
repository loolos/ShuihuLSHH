// 试打时给我方 AI 的开局指令（负责人 2026-11-21）：
// 我方 AI 一个一个地走，开局站得太靠前的人会一头扎进敌群送命（如双夺宝珠寺、怒破何观察的杨志），
// 输的局多半不是关卡难，而是 AI 自己找死。这里让这种人在开头几回合先往后退。
//
// 1. 自动不冒头（默认开，SIM_AUTO_BACK=0 关掉）：前 AUTO_TURNS 回合，照常的 AI 打算走到的格子
//    被至少 AUTO_THREATS 个敌人够得着（敌人移动力 + 射程），而且比队友所在格子的中位数多 AUTO_MARGIN 个以上，
//    就改走到够得着的敌人不超过这个数、离原本落脚点最近的格子，然后防御；一格都没有就尽量往后退。
// 2. 指定指令（STAGE_ORDERS）：按关卡给某个角色在某几回合下指令，优先于自动后撤：
//    - back：同自动后撤的走法，但不看条件，只要这一格有敌人够得着就退；
//    - hold：原地防御；
//    - to：走向某一格然后防御（如退回庄门）；
//    hpBelow：在 turns 之外，体力低于这个比例时也照这条指令走（如"体力不到六成退回庄门"）。
import type { Battle } from '../src/rules/battle.ts';
import type { Unit } from '../src/rules/unit.ts';
import { attackRange } from '../src/rules/unit.ts';
import { planAi } from '../src/rules/ai.ts';

export interface SimOrder {
  /** 角色号（主角 0） */
  char: number;
  /** 哪几回合照指令走，[起, 止]（含两端） */
  turns: [number, number];
  act: 'back' | 'hold' | { to: [number, number] };
  hpBelow?: number;
}

/** 键：原版关卡用地图名（如 N10），扩展包用「包名/关卡」（如 mainline/jingyanggang） */
export const STAGE_ORDERS: Record<string, SimOrder[]> = {
  // 双夺宝珠寺：七个喽啰头目一开场就专追杨志，他别冲在前面
  N10: [{ char: 14, turns: [1, 3], act: 'back' }],
  // 长街遇石秀：只有石秀能替杨雄挣脱，先让他直奔杨雄（133 = 主线包职业 shixiu，包里职业只往后加，编号不变）
  'mainline/changjie': [{ char: 133, turns: [1, 8], act: { to: [13, 9] } }],
  // 一丈青：扈三娘专找宋江（72 = 主线包职业 sj-fugitive），宋江别冲到前面
  'mainline/yizhangqing': [{ char: 72, turns: [1, 20], act: 'back' }],
  // 劫牢：乐和（156）、顾大嫂（134）伪装着先走到死囚牢门前开门，路上别动手
  // 包职业号按 pack.json 里的先后排；前面插了职业（扈三娘步战 husanniang-bu）以后乐和从 156 变成 157
  'mainline/jielao': [{ char: 157, turns: [1, 7], act: { to: [6, 3] } }, { char: 134, turns: [1, 7], act: { to: [7, 3] } }],
};

/** 过关区域还没启用时先照常打（劫牢：包节级没倒下之前，要逃的三个人别守在原地） */
export const FIGHT_FIRST = new Set(['mainline/jielao']);

export const AUTO_TURNS = 2;
export const AUTO_THREATS = Number(process.env.AUTO_THREATS ?? 5);
export const AUTO_MARGIN = Number(process.env.AUTO_MARGIN ?? 2);

const dist = (a: { x: number; y: number }, c: { x: number; y: number }) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);

/** 这一格有几个敌人下回合够得着（不动的敌人只算射程；迎击 / 固守的只算警戒范围内的，近似为移动力 + 射程） */
export function threatsAt(b: Battle, u: Unit, c: { x: number; y: number }): number {
  let n = 0;
  for (const e of b.foesOf(u)) {
    if (e.side !== 'enemy' || b.spectators.has(e.uid) || b.isBound(e)) continue;
    const [, hi] = attackRange(e, b.data);
    const still = e.ai.mode === 8 || e.ai.mode === 11 || e.ai.mode === 12 || e.ai.mode === 13 || e.ai.mode === 14;
    if (dist(e, c) <= (still ? hi : e.stats.move + hi)) n++;
  }
  return n;
}

/** 退到被够得着的敌人最少的格子；没有更安全的格子就不动。返回是否挪了 */
export function stepBack(b: Battle, u: Unit, ev: unknown[]): boolean {
  const mates = b.active().filter((x) => x.side === 'player' && x !== u);
  const cx = mates.length ? mates.reduce((s, x) => s + x.x, 0) / mates.length : u.x;
  const cy = mates.length ? mates.reduce((s, x) => s + x.y, 0) / mates.length : u.y;
  const here = threatsAt(b, u, u);
  let best = { x: u.x, y: u.y }, bt = here, bd = Math.abs(u.x - cx) + Math.abs(u.y - cy);
  for (const g of b.moveRange(u).green) {
    const t = threatsAt(b, u, g), d = Math.abs(g.x - cx) + Math.abs(g.y - cy);
    if (t < bt || (t === bt && d < bd)) { best = g; bt = t; bd = d; }
  }
  if (bt >= here) return false;
  ev.push(...b.move(u, best.x, best.y));
  if (b.canAct(u)) ev.push(...b.defend(u));
  if (process.env.TRACE_ORDERS) console.log(`  第 ${b.turn} 回合 ${u.name} 后撤 → (${best.x},${best.y})  威胁 ${here} → ${bt}`);
  return true;
}

/**
 * 自动后撤：照常的 AI 打算走到的格子太靠前（被够得着的敌人 ≥ AUTO_THREATS，且比队友所在格子的中位数多 AUTO_MARGIN 以上），
 * 就改走到不超过这个上限、离原本打算的落脚点最近的格子（照样往前，只是不冒头）；一格都没有就尽量后撤。返回是否接管了
 */
function autoBack(b: Battle, u: Unit, ev: unknown[]): boolean {
  const mates = b.active().filter((x) => x.side === 'player' && x !== u).map((x) => threatsAt(b, x, x)).sort((p, q) => p - q);
  const limit = Math.max(AUTO_THREATS - 1, (mates[mates.length >> 1] ?? 0) + AUTO_MARGIN - 1);
  const plan = planAi(b, u);
  const end = plan.path?.at(-1) ?? { x: u.x, y: u.y };
  const planned = threatsAt(b, u, end);
  if (planned <= limit) return false;
  const field = b.board.distanceField([end]);
  const d = (c: { x: number; y: number }) => field[c.y * b.board.width + c.x];
  const safe = b.moveRange(u).green.filter((g) => threatsAt(b, u, g) <= limit);
  if (!safe.length) return stepBack(b, u, ev);
  const c = safe.reduce((a, g) => (d(g) < d(a) ? g : a));
  if (c.x !== u.x || c.y !== u.y) ev.push(...b.move(u, c.x, c.y));
  if (b.canAct(u)) ev.push(...b.defend(u));
  if (process.env.TRACE_ORDERS) console.log(`  第 ${b.turn} 回合 ${u.name} 不冒头：原想到 (${end.x},${end.y}) 威胁 ${planned}，改到 (${c.x},${c.y}) 威胁 ${threatsAt(b, u, c)}`);
  return true;
}

/**
 * 给这个人套开局指令；走完了（本回合不用再管他）返回 true。
 * walkTo：调用方的"走到某格然后防御"
 */
/** 这一回合关卡有没有给这个角色下指令 */
export function hasOrder(stageKey: string, char: number, turn: number): boolean {
  return !!STAGE_ORDERS[stageKey]?.some((o) => o.char === char && turn >= o.turns[0] && turn <= o.turns[1]);
}

export function applyOrders(b: Battle, u: Unit, stageKey: string, ev: unknown[], walkTo: (x: number, y: number) => void): boolean {
  const order = STAGE_ORDERS[stageKey]?.find(
    (o) => o.char === u.classId && ((b.turn >= o.turns[0] && b.turn <= o.turns[1]) || (o.hpBelow !== undefined && u.hp < u.stats.maxHp * o.hpBelow)),
  );
  if (order) {
    if (order.act === 'hold') {
      ev.push(...b.defend(u));
      return true;
    }
    if (order.act === 'back') return stepBack(b, u, ev);
    walkTo(order.act.to[0], order.act.to[1]);
    return true;
  }
  if (process.env.SIM_AUTO_BACK === '0' || b.turn > AUTO_TURNS || !b.foesOf(u).length) return false;
  return autoBack(b, u, ev);
}
