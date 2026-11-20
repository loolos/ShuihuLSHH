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
    const gold0 = b.units.filter((u) => u.side === 'player').reduce((n, u) => n + u.gold, 0);
    poke(b);
    expect(z.side).toBe('ally');
    // 收手的离开地图，照打倒给经验，但不交银子（只有反劫剪径贼交）
    expect(z.present).toBe(false);
    expect(b.units.filter((u) => u.side === 'player').reduce((n, u) => n + u.gold, 0)).toBe(gold0);
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
    const ev = b.attack(me, chao);
    expect(chao.alive).toBe(false);
    expect(b.status).toBe('won');
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && u.present)).toBe(false);
    // 庄客一起收手离场（一次淡出，中间不夹升级字幕），好汉们留在场上
    const first = ev.findIndex((e) => e.type === 'leave');
    let run = 0;
    while (ev[first + run]?.type === 'leave') run++;
    expect(run).toBeGreaterThan(20);
    expect(b.units.filter((u) => [40, 41].includes(u.classId) && u.alive).every((u) => !u.present)).toBe(true);
    expect([46, 52, 61, 50].every((c) => cls(b, c).present)).toBe(true);
  });

  it('强闯二龙山：押鲁智深到山门前翻脸，好汉与伏兵一起杀出', () => {
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
    expect(foes().length).toBeGreaterThan(before + 10); // 伏兵从南边起点杀出
    expect(foes().some((u) => u.ai.mode === 8)).toBe(false);
  });

  it('强闯二龙山：混进山门，头领营地呆一回合、伏兵在南边起点杀出；打倒山门头领一半喽啰归顺', () => {
    const b = make('N-add12');
    const yang = cls(b, 14);
    place(b, yang, 22, 9);
    poke(b, yang);
    const head = b.units[27];
    expect(head.stunTurns).toBe(1);
    // 林冲等人从山门一带出现，伏兵在南边起点
    const lin = cls(b, 11);
    expect(lin.present).toBe(true);
    expect(lin.y).toBeLessThanOrEqual(12);
    expect(b.units[51].present).toBe(true);
    expect(b.units[51].y).toBeGreaterThan(25);
    const grunts = () => b.units.filter((u) => u.alive && u.present && [44, 45].includes(u.classId) && (b as unknown as { foesAtStart: Set<number> }).foesAtStart.has(u.uid));
    const before = grunts().filter((u) => u.side === 'enemy').length;
    const me = cls(b, 16);
    place(b, me, head.x + 1, head.y + 2);
    place(b, head, me.x - 1, me.y);
    head.hp = 1;
    me.ended = false; me.acted = false;
    b.attack(me, head);
    expect(head.alive).toBe(false);
    const allies = grunts().filter((u) => u.side === 'ally').length;
    expect(allies).toBe(Math.round(before * 0.5));
    expect(b.status).toBe('playing');
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
    const gold0 = b.units.filter((u) => u.side === 'player').reduce((n, u) => n + u.gold, 0);
    z.hp = Math.floor(z.stats.maxHp * 0.4);
    poke(b);
    // 收手：照打倒给经验、交出银子，并且离开地图不占路
    expect(z.side).toBe('ally');
    expect(z.present).toBe(false);
    expect(b.units.filter((u) => u.side === 'player').reduce((n, u) => n + u.gold, 0)).toBeGreaterThan(gold0);
    const boss = cls(b, 65), me = cls(b, 0);
    place(b, me, boss.x, boss.y - 1);
    boss.hp = 1;
    const ev = b.attack(me, boss);
    expect(boss.alive).toBe(false);
    expect(b.status).toBe('won');
    // 其余喽啰一起收手离场：退场事件连在一起（画面一次淡出），已经离场的不会再冒出来
    const leaves = ev.map((e, i) => (e.type === 'leave' ? i : -1)).filter((i) => i >= 0);
    expect(leaves.length).toBeGreaterThan(5);
    expect(leaves.at(-1)! - leaves[0]).toBe(leaves.length - 1);
    expect(ev.some((e) => e.type === 'appear')).toBe(false);
    expect(ev.some((e) => e.type === 'message' && e.text.startsWith('收手的敵人一共交出銀子'))).toBe(true);
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
    // 连身边最近的手下一起，最多四个、三格以内；别的头领手下不动
    expect(before - after).toBeGreaterThan(2);
    expect(before - after).toBeLessThanOrEqual(5);
    const crew = b.units.filter((u) => u.side === 'ally' && u !== boss && [44, 45].includes(u.classId));
    expect(crew.every((u) => Math.abs(u.x - boss.x) + Math.abs(u.y - boss.y) <= 3)).toBe(true);
    expect(b.units.filter((u) => u.classId === 65 && u !== boss).every((u) => u.side === 'enemy')).toBe(true);
    expect(b.status).toBe('playing');
  });

  it('山径斗毛贼：一次最多带四个，多出来的手下照样要打', () => {
    const b = make('N-add04b');
    const boss = b.units.find((u) => u.classId === 65 && u.present)!;
    // 把六个手下都摆到头领身边
    const ring = [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, -1], [2, 0]];
    const men = b.units.filter((u) => u.side === 'enemy' && [44, 45].includes(u.classId) && u.present).slice(0, 6);
    men.forEach((u, k) => place(b, u, boss.x + ring[k][0], boss.y + ring[k][1]));
    boss.hp = Math.floor(boss.stats.maxHp * 0.4);
    poke(b);
    const zhu = cls(b, 5);
    place(b, zhu, boss.x, boss.y - 1);
    poke(b, zhu);
    expect(boss.side).toBe('ally');
    expect(men.filter((u) => u.side === 'ally').length).toBe(4);
    expect(men.filter((u) => u.side === 'enemy').length).toBe(2);
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
      const ev = b.attack(p, v);
      expect(v.alive).toBe(false);
      // 富安、洪教头倒下各有一段对白
      const said = ev.filter((e) => e.type === 'say').map((e) => (e.type === 'say' ? e.text : ''));
      expect(said.some((t) => t.includes(id === 63 ? '衙内的主意' : '输了你一棒'))).toBe(true);
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

  it('火烧草料场：富安和陆谦一样逃得慢；洪教头被我方逼近三格内就回身硬拼', () => {
    const b = make('N09');
    const fu = cls(b, 63), lu = cls(b, 64), hong = cls(b, 71);
    const slow = (u: Unit) => u.buffs.filter((x) => x.stat === 'move').reduce((n, x) => n + x.value, 0);
    expect(slow(fu)).toBe(-2);
    expect(slow(lu)).toBe(-2);
    expect(slow(hong)).toBe(-1);
    expect(hong.ai.mode).toBe(4);
    const lin = cls(b, 11);
    const spot = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 1], [1, 2], [-2, 1], [2, -1]].map(([dx, dy]) => ({ x: hong.x + dx, y: hong.y + dy })).find((c) => b.board.passable(c.x, c.y) && !b.units.some((u) => u.alive && u.present && u.x === c.x && u.y === c.y))!;
    place(b, lin, spot.x, spot.y);
    poke(b, lin);
    expect(hong.ai.mode).toBe(0);
    expect(slow(hong)).toBe(0);
  });
});
