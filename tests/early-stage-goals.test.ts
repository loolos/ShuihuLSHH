// 前十五章换花样的关（docs/game-design.md §9.2.1）：误斗庄客、斗托塔天王、强闯二龙山、反劫剪径贼、山径斗毛贼、大破何涛、力擒金眼虎、叫阵晁家庄
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

  it('力擒金眼虎：打倒邓龙即过关，其余喽啰投降', () => {
    const b = make('N10');
    expect(b.objectives.some((l) => l.includes('邓龙'))).toBe(true);
    const deng = cls(b, 62), me = cls(b, 0);
    place(b, me, deng.x, deng.y + 1);
    deng.hp = 1;
    const ev = b.attack(me, deng);
    expect(deng.alive).toBe(false);
    expect(b.status).toBe('won');
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && u.present)).toBe(false);
    expect(ev.some((e) => e.type === 'message' && e.text.startsWith('其餘敵人的經驗'))).toBe(true);
  });

  it('叫阵晁家庄：三个教头轮流出场，打倒第三个即过关', () => {
    const b = make('N-add13');
    const ring = () => b.units.filter((u) => u.side === 'enemy' && u.present && u.classId !== 39);
    expect(ring().every((u) => u.ai.mode === 8)).toBe(true);
    const [t1, t2, t3] = [64, 63, 65].map((i) => b.units[i]);
    expect(t1.ai.mode).toBe(0);
    expect(t2.ai.mode).toBe(8);
    const beat = (t: Unit) => {
      const p = b.active().find((u) => u.side === 'player' && b.canAct(u) && u.classId !== 14)!;
      place(b, p, t.x - 1, t.y);
      t.hp = 1;
      b.attack(p, t);
      expect(t.alive).toBe(false);
    };
    beat(t1);
    expect(t2.ai.mode).toBe(8); // 下一回合才出来
    b.endPlayerPhase();
    expect(t2.ai.mode).toBe(0);
    expect(Math.abs(t2.x - 23) + Math.abs(t2.y - 33)).toBeLessThan(3);
    beat(t2);
    expect(b.status).toBe('playing');
    b.endPlayerPhase();
    expect(t3.ai.mode).toBe(0);
    beat(t3);
    expect(b.status).toBe('won');
  });

  it('叫阵晁家庄：对庄客出手，人墙一拥而上', () => {
    const b = make('N-add13');
    const z = b.units.find((u) => u.side === 'enemy' && u.present && u.classId === 37)!;
    z.hp -= 1;
    poke(b);
    expect(b.units.filter((u) => u.side === 'enemy' && u.present && u.classId !== 39).every((u) => u.ai.mode === 0)).toBe(true);
    expect(b.status).toBe('playing');
  });

  it('火烧草料场：大火每回合蔓延；陆谦被打倒后林冲拿下，富安、洪教头倒下即过关', () => {
    const b = make('N09');
    const fire = b.fire!;
    const lit = fire.burning.size;
    expect(lit).toBeGreaterThan(5);
    const [c] = fire.cells();
    expect(b.board.passable(c.x, c.y)).toBe(false);
    expect(b.objectiveZones().filter((z) => z.kind === 'danger').length).toBe(3); // 三个出口
    b.endPlayerPhase();
    expect(fire.burning.size).toBeGreaterThan(lit);
    const lu = cls(b, 64), lin = cls(b, 11);
    lu.hp = Math.floor(lu.stats.maxHp * 0.2);
    poke(b, lin);
    expect(lu.stunTurns).toBeGreaterThan(100); // 爬不动了
    const heroes = b.units.filter((u) => u.side === 'player' && u.present && u !== lin);
    [63, 71].forEach((id, k) => {
      const v = cls(b, id), p = heroes[k];
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: v.x + dx, y: v.y + dy })).find((c) => b.board.passable(c.x, c.y))!;
      place(b, p, spot.x, spot.y);
      v.hp = 1;
      b.attack(p, v);
      expect(v.alive).toBe(false);
    });
    expect(b.status).toBe('playing');
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: lu.x + dx, y: lu.y + dy })).find((c) => b.board.passable(c.x, c.y) && !b.units.some((u) => u.alive && u.present && u.x === c.x && u.y === c.y))!;
    place(b, lin, spot.x, spot.y);
    poke(b, lin);
    expect(b.status).toBe('won');
  });

  it('火烧草料场：陆谦从后门逃走就输，富安从侧门逃走只是退场', () => {
    const b = make('N09');
    const fu = cls(b, 63);
    place(b, fu, 2, 24);
    poke(b);
    expect(fu.present).toBe(false);
    expect(b.status).toBe('playing');
    place(b, cls(b, 64), 17, 34);
    poke(b);
    expect(b.status).toBe('lost');
  });
});
