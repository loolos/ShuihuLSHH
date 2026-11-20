// 火势蔓延（src/rules/fire.ts，火烧草料场）
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { Fire } from '../src/rules/fire.ts';

// 5×3：中间一行 x=1..3 是草垛（本来就不能走），其余是空地
const make = () => {
  const b = new Board(5, 3);
  const at = (x: number, y: number) => y * 5 + x;
  const fuel = [at(1, 1), at(2, 1), at(3, 1)];
  for (const i of fuel) b.blocked[i] = 1;
  const f = new Fire({ seeds: [at(1, 1)], fuel, groundTurns: 2, damagePct: 10 }, b);
  return { b, f, at };
};

describe('火势蔓延', () => {
  it('草垛一格格烧过去，旁边的空地也着火、不能走，烧两回合熄灭成焦土', () => {
    const { b, f, at } = make();
    expect(f.burning.size).toBe(1);
    f.spread(new Set());
    // 草垛点着 (2,1)，空地 (0,1)、(1,0)、(1,2) 着火
    expect([...f.burning.keys()].sort((a, c) => a - c)).toEqual([at(1, 0), at(0, 1), at(1, 1), at(2, 1), at(1, 2)].sort((a, c) => a - c));
    expect(b.passable(0, 1)).toBe(false);
    f.spread(new Set());
    expect(f.burning.has(at(3, 1))).toBe(true);
    expect(f.burning.get(at(0, 1))).toBe(1);
    f.spread(new Set());
    // 第一批空地烧完熄灭，不再着火；草垛一直烧
    expect(f.burning.has(at(0, 1))).toBe(false);
    expect(f.burnt.has(at(0, 1))).toBe(true);
    expect(b.passable(0, 1)).toBe(true);
    expect(f.burning.get(at(1, 1))).toBe(-1);
    f.spread(new Set());
    expect(f.burning.has(at(0, 1))).toBe(false);
  });

  it('空地上的火不往空地蔓延；有人站着的格子不点着；火旁算烧伤', () => {
    const { f, at } = make();
    f.spread(new Set([at(1, 0)]));
    expect(f.burning.has(at(1, 0))).toBe(false);
    f.spread(new Set());
    expect(f.burning.has(at(0, 0))).toBe(false); // (0,1) 着火的空地不会点着 (0,0)
    expect(f.scorches(0, 0)).toBe(true);
    expect(f.scorches(4, 0)).toBe(false);
  });

  it('存档读档还原火场和通行', () => {
    const { b, f } = make();
    f.spread(new Set());
    const s = JSON.parse(JSON.stringify(f.save()));
    f.spread(new Set());
    f.spread(new Set());
    f.load(s);
    expect(b.passable(0, 1)).toBe(false);
    expect(f.burning.size).toBe(5);
  });
});
