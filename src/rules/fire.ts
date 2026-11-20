// 火势蔓延【新】（负责人 2026-11-20，火烧草料场）：关卡 JSON 的 rules.fire 开启，见 docs/game-design.md §9.2.1。
// 纯规则，不依赖 Phaser。
//
// - 燃料 = 地上物是草垛一类图块的格子（rules.fire.fuel 列出图块号）。草垛一旦着火一直烧到本关结束。
// - 每回合开始（第 2 回合起）火往四邻蔓延一次：着火的格子点着旁边的草垛；着火的草垛还会把旁边能走的空地也点着
//   （地上的草屑），空地烧 groundTurns 回合后熄灭成焦土，不会再着火；空地上的火不会再往空地蔓延。
// - 有人站着的格子不会被点着。着火的格子不能走（Board.blocked）。
// - 回合开始时，站在着火格子旁边（四邻）的人掉最大生命的 damagePct%，不会被烧死（最少剩 1 点），双方一样。
import type { Board } from './board.ts';

export interface FireRules {
  /** 开场就着火的格子 [x, y] */
  seeds: [number, number][];
  /** 算燃料的地上物图块号（草垛、茅棚） */
  fuel: number[];
  /** 空地着火烧几回合，默认 2 */
  groundTurns?: number;
  /** 火旁的人每回合掉最大生命的百分之几，默认 10 */
  damagePct?: number;
}

/** 载入时算好的火场：格子都用 y * 宽 + x */
export interface FireInput {
  seeds: number[];
  fuel: number[];
  groundTurns: number;
  damagePct: number;
}

export interface FireState {
  /** 正在烧的格子 → 还剩几回合（−1 = 草垛，一直烧） */
  burning: [number, number][];
  /** 烧过熄灭了的空地 */
  burnt: number[];
}

export class Fire {
  readonly fuel: Set<number>;
  burning = new Map<number, number>();
  burnt = new Set<number>();
  private readonly base: Uint8Array;

  constructor(
    readonly input: FireInput,
    private readonly board: Board,
  ) {
    this.fuel = new Set(input.fuel);
    this.base = board.blocked.slice();
    for (const i of input.seeds) this.burning.set(i, this.fuel.has(i) ? -1 : input.groundTurns);
    this.apply();
  }

  /** 把着火的格子写进 Board.blocked（熄灭的恢复原样） */
  private apply() {
    this.board.blocked.set(this.base);
    for (const i of this.burning.keys()) this.board.blocked[i] = 1;
  }

  private neighbors(i: number): number[] {
    const W = this.board.width, H = this.board.height;
    const x = i % W, y = (i / W) | 0;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
  }

  /** 蔓延一次。occupied = 有人站着的格子（不点着）。返回这次新点着的格子 */
  spread(occupied: Set<number>): number[] {
    const before = [...this.burning];
    const next = new Map<number, number>();
    for (const [i, left] of before) {
      if (left < 0) next.set(i, left);
      else if (left > 1) next.set(i, left - 1);
      else this.burnt.add(i);
    }
    const lit: number[] = [];
    for (const [i] of before) {
      for (const n of this.neighbors(i)) {
        if (next.has(n) || this.burnt.has(n) || occupied.has(n)) continue;
        if (this.fuel.has(n)) next.set(n, -1), lit.push(n);
        else if (this.fuel.has(i) && !this.base[n] && !this.board.voidCells[n]) next.set(n, this.input.groundTurns), lit.push(n);
      }
    }
    this.burning = next;
    this.apply();
    return lit;
  }

  /** (x, y) 本身或四邻有火 */
  scorches(x: number, y: number): boolean {
    const i = y * this.board.width + x;
    return this.burning.has(i) || this.neighbors(i).some((n) => this.burning.has(n));
  }

  cells(): { x: number; y: number }[] {
    const W = this.board.width;
    return [...this.burning.keys()].map((i) => ({ x: i % W, y: (i / W) | 0 }));
  }

  save(): FireState {
    return { burning: [...this.burning], burnt: [...this.burnt] };
  }

  load(s: FireState) {
    this.burning = new Map(s.burning);
    this.burnt = new Set(s.burnt);
    this.apply();
  }
}

/** 载入关卡时把 rules.fire 换成格子号：燃料 = 任一层地上物是 fuel 图块的格子 */
export function fireInput(rules: FireRules, map: { width: number; cells: { tile: number }[][] }): FireInput {
  const fuel = new Set(rules.fuel);
  const cells: number[] = [];
  map.cells.forEach((layers, i) => {
    if (layers.slice(1).some((l) => fuel.has(l.tile))) cells.push(i);
  });
  return {
    seeds: rules.seeds.map(([x, y]) => y * map.width + x),
    fuel: cells,
    groundTurns: rules.groundTurns ?? 2,
    damagePct: rules.damagePct ?? 10,
  };
}
