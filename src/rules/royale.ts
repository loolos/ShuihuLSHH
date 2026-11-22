// 好汉聚义（吃鸡外传，docs/game-design.md §15.31）【新：负责人 2026-11-22】：
// 十六位好汉各自为战，毒圈每几回合缩一次，圈外每回合掉血；地图上不时刷出宝箱（小药），小头目被打倒掉药；活到最后的人获胜。
// 这里放不依赖 Battle 的部分：规则参数、毒圈的几何、可走区域、出生点。战斗里的结算在 battle.ts，AI 在 royale-ai.ts。
import type { Board, Cell } from './board.ts';
import type { Rng } from './rng.ts';

/** 关卡 JSON 的 royale 字段 */
export interface RoyaleRules {
  /** 参赛好汉的等级（玩家和对手一样） */
  level: number;
  /** 对手人数（从出场过的好汉里随机） */
  opponents: number;
  /** 毒圈每几回合缩一次（第 1 + n、1 + 2n…… 回合开始时缩） */
  shrinkEvery: number;
  /** 圈外的人每回合开始掉最大体力的 1/n（能掉死） */
  damageDivisor: number;
  /** 每次缩圈后的半径（格），依次用；用完以后不再缩 */
  radii: number[];
  /** 开局铺几个宝箱 */
  chestStart: number;
  /** 每几回合（回合开始时）再刷一批宝箱、每批几个 */
  chestEvery: number;
  chestCount: number;
  /** 宝箱里的东西（道具号，随机一样） */
  chestItems: number[];
  /** 小头目（各自守一处，打倒掉药） */
  npcs: { classes: number[]; count: number; level: number; /** 打倒后掉的药（道具号，随机一样） */ drops: number[] };
}

/** 毒圈：圆心（格子）和半径（格） */
export interface Zone {
  x: number;
  y: number;
  r: number;
}

/** 场上状态（进时光倒流的存档） */
export interface RoyaleState {
  /** 现在的安全区；圈外的人每回合开始掉血 */
  zone: Zone;
  /** 下一次缩成的安全区（提前公布）；不再缩了为 null */
  next: Zone | null;
  /** 第几回合开始时缩成 next */
  shrinkAt: number;
  /** 下一次缩圈用 radii 的第几项 */
  step: number;
  /** 出局顺序（uid，先出局的在前） */
  out: number[];
}

/** 小头目的阵营号（他们之间不打）；参赛好汉的阵营号是各自的单位序号 */
export const NPC_TEAM = -1;

/** 在圈里：格子中心到圆心的距离不超过半径（多算半格，圈边看起来圆一些） */
export function inZone(z: Zone, c: Cell): boolean {
  const dx = c.x - z.x, dy = c.y - z.y;
  return dx * dx + dy * dy <= (z.r + 0.5) * (z.r + 0.5);
}

/** 地图上最大的一块连通的可走区域（出生点、宝箱、圆心都只放在这里） */
export function mainArea(board: Board): Cell[] {
  const seen = new Uint8Array(board.width * board.height);
  let best: Cell[] = [];
  for (let y = 0; y < board.height; y++)
    for (let x = 0; x < board.width; x++) {
      if (seen[y * board.width + x] || !board.passable(x, y)) continue;
      const part: Cell[] = [];
      const stack = [{ x, y }];
      seen[y * board.width + x] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        part.push(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!board.passable(nx, ny) || seen[ny * board.width + nx]) continue;
          seen[ny * board.width + nx] = 1;
          stack.push({ x: nx, y: ny });
        }
      }
      if (part.length > best.length) best = part;
    }
  return best;
}

/** 开局的圈：圆心在可走区域的重心附近（取最近的可走格），半径盖住全部可走格 */
export function firstZone(area: Cell[]): Zone {
  const mx = area.reduce((s, c) => s + c.x, 0) / area.length, my = area.reduce((s, c) => s + c.y, 0) / area.length;
  const c = area.reduce((a, b) => (Math.hypot(b.x - mx, b.y - my) < Math.hypot(a.x - mx, a.y - my) ? b : a));
  const r = Math.ceil(Math.max(...area.map((p) => Math.hypot(p.x - c.x, p.y - c.y))));
  return { x: c.x, y: c.y, r };
}

/**
 * 下一个圈：半径 r，整个落在现在的圈里（圆心到旧圆心 + r ≤ 旧半径），圆心是可走格，随机挑。
 * 新圈里可走格太少（不到半径对应面积的四成）的圆心不要，免得圈缩到墙里、水里。
 */
export function nextZone(area: Cell[], cur: Zone, r: number, rng: Rng): Zone {
  const minCells = Math.max(1, Math.floor(Math.PI * r * r * 0.4));
  const fits = area.filter((c) => Math.hypot(c.x - cur.x, c.y - cur.y) + r <= cur.r);
  const good = fits.filter((c) => area.filter((p) => inZone({ x: c.x, y: c.y, r }, p)).length >= minCells);
  const pool = good.length ? good : fits;
  if (!pool.length) return { x: cur.x, y: cur.y, r: Math.min(r, cur.r) };
  const c = pool[rng.int(pool.length)];
  return { x: c.x, y: c.y, r };
}

/**
 * 出生点：在可走区域里挑 n 个尽量互相离得远的格子（最远点采样，第一个随机），按格子步数（绕墙）算距离。
 * avoid 里的格子不挑（已经放了人）。
 */
export function spreadCells(board: Board, area: Cell[], n: number, rng: Rng, avoid: Cell[] = []): Cell[] {
  const w = board.width;
  const taken = new Set(avoid.map((c) => c.y * w + c.x));
  const free = area.filter((c) => !taken.has(c.y * w + c.x));
  if (!free.length || n <= 0) return [];
  const near = new Float32Array(w * board.height).fill(Infinity);
  const mark = (c: Cell) => {
    const f = board.distanceField([c]);
    for (let i = 0; i < near.length; i++) near[i] = Math.min(near[i], f[i]);
  };
  avoid.forEach(mark);
  const out: Cell[] = [];
  while (out.length < n) {
    let best: Cell | null = null;
    if (!out.length && !avoid.length) best = free[rng.int(free.length)];
    else {
      let bestD = -1;
      for (const c of free) {
        const d = near[c.y * w + c.x];
        if (d === Infinity || taken.has(c.y * w + c.x)) continue;
        // 同样远的格子随机挑一个（加一点随机抖动）
        const s = d + rng.next() * 0.5;
        if (s > bestD) { bestD = s; best = c; }
      }
    }
    if (!best) break;
    out.push(best);
    taken.add(best.y * w + best.x);
    mark(best);
  }
  return out;
}
