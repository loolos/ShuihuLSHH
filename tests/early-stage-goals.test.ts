// 前十五章三关的新胜利方式（docs/game-design.md §9.2.1）：误斗庄客（劝和）、斗托塔天王（只擒不杀）、强闯二龙山（诈降赚山门）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import type { Unit } from '../src/rules/unit.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('前十五章换花样的关', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const data = has ? loadGameData(files, tr) : (null as never);
  const make = (stage: string) => {
    const b = new Battle(loadStage(files, data, stage, { seed: 1, text: tr }));
    b.begin();
    return b;
  };
  const cls = (b: Battle, id: number) => b.units.find((u) => u.classId === id)!;
  /** 把人挪到某格（先腾出那一格） */
  const place = (b: Battle, u: Unit, x: number, y: number) => {
    for (const o of b.units) if (o !== u && o.x === x && o.y === y) o.x = o.y = 0;
    u.x = x;
    u.y = y;
  };
  /** 让一个能动的我方的人挪一步，跑一遍行动后的触发 */
  const poke = (b: Battle, skip?: Unit) => {
    const p = b.active().find((u) => u.side === 'player' && u !== skip && b.canAct(u))!;
    const g = b.moveRange(p).green.find((c) => c.x !== p.x || c.y !== p.y)!;
    b.move(p, g.x, g.y);
  };

  it('误斗庄客：庄客体力不到四成就收手，武龙走到刘太公身边即过关', () => {
    const b = make('N-add05');
    const tg = cls(b, 27);
    expect(tg.present).toBe(true);
    expect(b.spectators.has(tg.uid)).toBe(true);
    expect(b.objectives.some((l) => l.includes('刘太公身边'))).toBe(true);
    const z = b.units.find((u) => u.side === 'enemy' && u.classId === 40 && u.present)!;
    z.hp = Math.floor(z.stats.maxHp * 0.3);
    poke(b);
    expect(z.side).toBe('ally');
    expect(b.status).toBe('playing');
    place(b, cls(b, 0), tg.x - 1, tg.y);
    const ev = (() => { const p = b.active().find((u) => u.side === 'player' && u !== cls(b, 0) && b.canAct(u))!; const g = b.moveRange(p).green.find((c) => c.x !== p.x || c.y !== p.y)!; return b.move(p, g.x, g.y); })();
    expect(b.status).toBe('won');
    // 没打倒的庄客（收手的那个已经给过经验）按击败经验进全队经验
    expect(ev.some((e) => e.type === 'message' && e.text.startsWith('其餘敵人的經驗'))).toBe(true);
  });

  it('斗托塔天王：吴用体力不到三成罢手，打倒晁盖即过关、庄客都收手', () => {
    const b = make('N11');
    const wu = cls(b, 53);
    wu.hp = Math.floor(wu.stats.maxHp * 0.2);
    poke(b);
    expect(wu.side).toBe('ally');
    expect(b.status).toBe('playing');
    const chao = cls(b, 58);
    const me = cls(b, 0);
    place(b, me, chao.x + 1, chao.y);
    chao.hp = 1;
    b.attack(me, chao);
    expect(chao.alive).toBe(false);
    expect(b.status).toBe('won');
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && u.present)).toBe(false);
  });

  it('强闯二龙山：押鲁智深到山门前翻脸，伏兵与山下好汉一起杀出', () => {
    const b = make('N-add12');
    const lu = cls(b, 16), yang = cls(b, 14);
    expect(lu.stunTurns).toBeGreaterThan(100); // 被绑
    expect(cls(b, 11).present).toBe(false); // 林冲藏在山下
    const foes = () => b.units.filter((u) => u.side === 'enemy' && u.present);
    expect(foes().every((u) => u.ai.mode === 8)).toBe(true);
    const before = foes().length;
    place(b, yang, 22, 9);
    poke(b, yang);
    expect(lu.stunTurns).toBe(0);
    expect(cls(b, 11).present).toBe(true);
    expect(foes().length).toBeGreaterThan(before + 10);
    expect(foes().some((u) => u.ai.mode === 8)).toBe(false);
  });

  it('强闯二龙山：路上先动手就被识破，同样翻脸', () => {
    const b = make('N-add12');
    const z = b.units.find((u) => u.side === 'enemy' && u.present)!;
    z.hp -= 1;
    poke(b);
    expect(cls(b, 16).stunTurns).toBe(0);
    expect(cls(b, 11).present).toBe(true);
    expect(b.status).toBe('playing');
  });

  it('反劫剪径贼：喽啰体力不到一半求饶，打倒头领即过关', () => {
    const b = make('N-add07');
    const z = b.units.find((u) => u.side === 'enemy' && u.classId === 44 && u.present)!;
    z.hp = Math.floor(z.stats.maxHp * 0.4);
    poke(b);
    expect(z.side).toBe('ally');
    const boss = cls(b, 65), me = cls(b, 0);
    place(b, me, boss.x, boss.y - 1);
    boss.hp = 1;
    b.attack(me, boss);
    expect(boss.alive).toBe(false);
    expect(b.status).toBe('won');
  });

  it('山径斗毛贼：头领伤重后朱武过去劝降，头领带手下归顺', () => {
    const b = make('N-add04b');
    const boss = b.units.find((u) => u.classId === 65 && u.present)!;
    const before = b.units.filter((u) => u.side === 'enemy').length;
    boss.hp = Math.floor(boss.stats.maxHp * 0.4);
    poke(b);
    expect(boss.side).toBe('enemy');
    const zhu = cls(b, 5);
    place(b, zhu, boss.x + 1, boss.y);
    poke(b, zhu);
    expect(boss.side).toBe('ally');
    const after = b.units.filter((u) => u.side === 'enemy').length;
    expect(before - after).toBeGreaterThan(3); // 连手下一起
    expect(b.status).toBe('playing');
  });

  it('大破何涛：四处放火即过关，点着的地方不再标出', () => {
    const b = make('N-add14');
    const spots = () => b.objectiveZones().filter((z) => z.kind === 'goal');
    expect(spots().length).toBe(4);
    const wu = cls(b, 10);
    [[23, 12], [14, 8], [4, 18], [15, 19]].forEach(([x, y], k) => {
      place(b, wu, x, y);
      poke(b, wu);
      if (k < 3) expect(spots().length).toBe(3 - k);
    });
    expect(b.status).toBe('won');
  });
});
