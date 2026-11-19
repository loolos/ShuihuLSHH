// N14（火并王倫）【新】（负责人 2026-11-15）：王倫一死下一波增援马上来、再下一波下一回合来；增援没出完不判胜。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import type { Unit } from '../src/rules/unit.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('N14 火并王倫：增援与胜利条件', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const data = has ? loadGameData(files, tr) : (null as never);
  const start = () => {
    const b = new Battle(loadStage(files, data, 'N14', { seed: 1, text: tr }));
    // 我方不会战败：只验证增援和胜负
    const kill = x(b).kill.bind(b);
    x(b).kill = (u, t) => (t.side === 'player' ? void (t.hp = 1) : kill(u, t));
    b.begin();
    return b;
  };
  type X = { kill: (u: Unit, t: Unit) => void; afterAction: () => void; flush: () => BattleEvent[]; out: BattleEvent[] };
  const x = (b: Battle) => b as unknown as X;
  const hero = (b: Battle) => b.units.find((u) => u.side === 'player' && u.classId === 0)!;
  const present = (b: Battle) => b.units.filter((u) => u.side === 'enemy' && u.alive && u.present);
  const killEnemy = (b: Battle, t: Unit) => {
    x(b).kill(hero(b), t);
    x(b).afterAction();
  };
  // 我方不参与：只推进回合
  const pass = (b: Battle) => {
    const t = b.turn;
    b.endPlayerPhase();
    expect(b.turn).toBe(t + 1);
  };

  it('胜利条件写明要打倒增援', () => {
    const b = start();
    expect(b.objectives.some((l) => l.includes('打败所有敌人（包括增援'))).toBe(true);
  });

  it('第 1 回合王倫倒下：第一波马上登场，第二波下一回合登场', () => {
    const b = start();
    const n0 = present(b).length;
    const wang = b.units.find((u) => u.classId === 68)!;
    killEnemy(b, wang);
    const out = x(b).flush();
    expect(out.some((e) => e.type === 'say' && e.text === '敌军增援了！')).toBe(true);
    expect(present(b).length).toBe(n0 - 1 + 14);
    expect(b.turn).toBe(1);
    pass(b);
    expect(b.turn).toBe(2);
    expect(present(b).length).toBeGreaterThanOrEqual(n0 - 1 + 14 + 30);
    // 宋万喊的不再是"谁敢动我大哥"
    const said = x(b).flush().filter((e) => e.type === 'say').map((e) => (e as { text: string }).text);
    expect(said.some((t) => t.includes('谁敢动我大哥'))).toBe(false);
  });

  it('第一波出来后王倫倒下：第二波马上登场', () => {
    const b = start();
    while (b.turn < 5) pass(b);
    const n = present(b).length;
    killEnemy(b, b.units.find((u) => u.classId === 68)!);
    expect(present(b).length).toBeGreaterThan(n + 20);
  });

  it('王倫活着时增援照原定回合（第 4、8 回合）', () => {
    const b = start();
    const n0 = present(b).length;
    while (b.turn < 3) pass(b);
    expect(present(b).length).toBeLessThanOrEqual(n0);
    pass(b);
    expect(b.turn).toBe(4);
    expect(present(b).length).toBeGreaterThan(n0);
  });

  it('地图上的敌人全倒、增援没出完不过关；全部打倒才过关', () => {
    const b = start();
    // 先把王倫以外的在场敌人打光：还有两波没来，不过关
    for (const u of present(b)) if (u.classId !== 68) killEnemy(b, u);
    expect(b.status).toBe('playing');
    // 王倫倒下：第一波马上来
    killEnemy(b, b.units.find((u) => u.classId === 68)!);
    expect(b.status).toBe('playing');
    for (const u of present(b)) killEnemy(b, u);
    // 第一波打光，第二波还没来：仍然不过关
    expect(present(b).length).toBe(0);
    expect(b.status).toBe('playing');
    pass(b);
    expect(present(b).length).toBeGreaterThan(20);
    for (const u of present(b)) killEnemy(b, u);
    expect(b.status).toBe('won');
  });

  it('时光倒流保留提前了的增援回合', () => {
    const b = start();
    pass(b);
    killEnemy(b, b.units.find((u) => u.classId === 68)!);
    pass(b);
    const n = present(b).length;
    expect(b.rewindTarget()).not.toBeNull();
    // 回到第 2 回合开始（王倫还活着），再打一遍结果一样
    b.rewind(2);
    expect(b.turn).toBe(2);
    killEnemy(b, b.units.find((u) => u.classId === 68)!);
    pass(b);
    expect(present(b).length).toBe(n);
  });
});
