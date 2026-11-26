// 第三十二章「登州劫牢」（docs/game-design.md §15.33）：射虎的兄弟配合、劫牢的伪装 / 识破、开牢门、带枷
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { baseDamage, watcherSees } from '../src/rules/combat.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { areaCells, learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第三十二章 登州劫牢', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const open = (id: string, seed = 1) => {
    const stage = rt.stages.find((s) => s.id === id)!;
    const b = new Battle(compileStage(rt, stage, files, { seed }));
    b.begin();
    return { b, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const skill = (b: Battle, u: Unit, name: string) => learnedSkills(u, b.data).find((s) => s.name === name)!;
  const put = (u: Unit, x: number, y: number) => { u.x = x; u.y = y; };

  it('四关接在扈成请和后面，单位站在可通行的格子上、互不重叠', () => {
    for (const id of ['shehu', 'laihu', 'qingsunli', 'jielao']) {
      expect(chapterOf(`mainline/${id}`)).toBe(32);
      const { b, stage } = open(id);
      const seen = new Set<string>();
      for (const u of stage.units) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false);
        seen.add(`${u.x},${u.y}`);
      }
    }
  });

  it('射虎：窝弓（要老虎踩的）区域另标一种，不和找踪迹的格子混在一起', () => {
    const { b } = open('shehu');
    const zs = b.objectiveZones();
    expect(zs.filter((z) => z.label === '窝弓').map((z) => z.kind)).toEqual(['trap', 'trap', 'trap']);
    expect(zs.filter((z) => z.label === '脚印').map((z) => z.kind)).toEqual(['goal']);
  });

  it('射虎：大虫路过窝弓就中箭，不必停在里面', () => {
    const { b, get } = open('shehu');
    const tiger = get('tiger');
    tiger.present = true;
    put(tiger, 12, 5);
    (b as unknown as { phase: string }).phase = 'enemy';
    const before = tiger.hp;
    b.move(tiger, 17, 5); // 一路走过窝弓 [13,5]–[16,5]，停在外面
    expect(tiger.x).toBe(17);
    expect(tiger.hp).toBeLessThan(before);
  });

  it('射虎：钢叉叉虎叉住一回合，乘势刺打被叉住的伤害加倍', () => {
    const { b, get } = open('shehu');
    const jz = get('jiezhen'), jb = get('jiebao');
    const chahu = skill(b, jz, '钢叉叉虎'), cs = skill(b, jb, '乘势刺');
    expect(chahu.stunFor).toBe(1);
    expect(cs.vsStunned).toBe(2);
    const tiger = get('tiger');
    const [n0] = baseDamage(jb, tiger, cs);
    tiger.stunTurns = 1;
    const [n1] = baseDamage(jb, tiger, cs);
    expect(n1).toBeCloseTo(n0 * 2);
  });

  it('劫牢：伪装的人敌人不打；出手就被识破，众人发作', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), lh = get('lehe'), guard = get('ya0');
    expect(gu.disguised && lh.disguised).toBe(true);
    expect(b.foesOf(guard)).not.toContain(gu);
    expect(get('sunli').present).toBe(false);
    put(gu, guard.x - 1, guard.y);
    gu.facing = 3;
    b.attack(gu, guard);
    expect(gu.disguised).toBe(false);
    expect(lh.disguised).toBe(false);
    expect(get('sunli').present).toBe(true);
    expect(guard.ai.mode).toBe(0);
  });

  it('劫牢：伪装的顾大嫂移动 −3，识破以后恢复；乐和不减', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), lh = get('lehe');
    const disguised = gu.stats.move, lhMove = lh.stats.move;
    expect(gu.movementRemaining).toBeLessThanOrEqual(disguised);
    b.scriptDisguise(false);
    expect(gu.stats.move).toBe(disguised + 3);
    expect(lh.stats.move).toBe(lhMove);
  });

  it('母大虫扑食：选第一格打四个方向的第一格，选第二格只打四个方向的第二格', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao');
    put(gu, 12, 12);
    const s = skill(b, gu, '母大虫扑食');
    const key = (cs: { x: number; y: number }[]) => cs.map((c) => `${c.x - 12},${c.y - 12}`).sort();
    expect(key(areaCells(b.board, gu, s, { x: 12, y: 11 }))).toEqual(['-1,0', '0,-1', '0,1', '1,0']);
    expect(key(areaCells(b.board, gu, s, { x: 12, y: 10 }))).toEqual(['-2,0', '0,-2', '0,2', '2,0']);
  });

  it('劫牢：包节级正前方看得穿伪装，乐和他认得', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), lh = get('lehe'), bj = get('baoji');
    bj.facing = 2;
    put(lh, bj.x, bj.y + 3);
    b.move(lh, bj.x, bj.y + 2);
    expect(lh.disguised).toBe(true);
    put(gu, bj.x + 1, bj.y + 3);
    b.move(gu, bj.x + 1, bj.y + 2);
    expect(gu.disguised).toBe(false);
  });

  it('劫牢：伪装的人路过包节级眼前也被识破，就停在被看见的那一格', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), bj = get('baoji');
    bj.facing = 2;
    put(gu, bj.x - 3, bj.y + 2);
    b.move(gu, bj.x + 3, bj.y + 2);
    expect(gu.disguised).toBe(false);
    expect(gu.x === bj.x + 3 && gu.y === bj.y + 2).toBe(false);
    expect(Math.abs(gu.x - bj.x) + Math.abs(gu.y - bj.y)).toBeLessThanOrEqual(3);
  });

  it('劫牢：乐和被识破 / 开打以后吹不了铁叫子；邹渊、邹润是友军', () => {
    const { b, get } = open('jielao');
    const lh = get('lehe');
    const names = (usable: boolean) => b.skillsOf(lh).filter((s) => s.usable === usable).map((s) => s.skill.name);
    expect(names(true)).toEqual(expect.arrayContaining(['吹铁叫子', '长吹铁叫子']));
    lh.disguised = false;
    expect(names(false)).toEqual(expect.arrayContaining(['吹铁叫子', '长吹铁叫子']));
    const long = learnedSkills(lh, b.data).find((s) => s.name === '长吹铁叫子')!;
    expect(b.useSkill(lh, long, { x: lh.x, y: lh.y - 1 })).toEqual([]);
    expect(get('zouyuan').side).toBe('ally');
    expect(get('zourun').side).toBe('ally');
  });

  it('劫牢：乐和临时会长吹铁叫子（三格内两回合不动），不破伪装；巡逻兵丁也看得穿伪装', () => {
    const { b, get } = open('jielao');
    const lh = get('lehe'), bj = get('baoji');
    expect(learnedSkills(lh, b.data).map((s) => s.name)).toContain('长吹铁叫子');
    put(lh, bj.x, bj.y + 3);
    const long = learnedSkills(lh, b.data).find((s) => s.name === '长吹铁叫子')!;
    b.useSkill(lh, long, b.skillTargets(lh, long)[0]);
    expect(lh.disguised).toBe(true);
    expect(bj.stunTurns).toBe(2);
    expect(skill(b, lh, '吹铁叫子').drug).toBe(2); // 普通吹铁叫子也愣两回合（负责人 2026-11-25）
    const gu = get('gudasao'), xl = get('xl0');
    xl.facing = 3;
    put(gu, xl.x + 3, xl.y);
    b.move(gu, xl.x + 2, xl.y);
    expect(gu.disguised).toBe(false);
  });

  it('乐和裂石穿云带伤害（威力 20），打中的必定发愣一回合（负责人 2026-11-26，原先不伤人）', () => {
    const { b, get } = open('jielao');
    const s = skill(b, get('lehe'), '裂石穿云');
    expect(s.power).toBeGreaterThan(0); // 写的威力 20，出自 222 的命中修正按好汉规则折进威力
    expect(s.drug).toBeUndefined();
    expect(s.stun).toBe(100);
    expect(s.stunFor).toBe(1);
  });

  it('劫牢：死囚牢门口的看守面朝外，正前方三格看住整个「死囚牢门」，得先吹铁叫子；最左边牢门口另有看守', () => {
    const { b, get } = open('jielao');
    const kz = get('xl1'), gu = get('gudasao');
    expect([kz.x, kz.y, kz.facing]).toEqual([6, 3, 3]);
    const kz2 = get('xl3');
    expect([kz2.x, kz2.y, kz2.facing, kz2.ai.mode]).toEqual([6, 14, 3, 8]);
    get('baoji').facing = 0; // 只看门口看守
    for (const [x, y] of [[7, 2], [7, 3], [7, 4], [8, 2], [8, 3], [8, 4]]) expect(watcherSees(kz, { x, y }, 3), `${x},${y}`).toBe(true);
    put(gu, 9, 5);
    b.move(gu, 8, 4);
    expect(gu.disguised).toBe(false);
    const g2 = open('jielao');
    g2.get('baoji').facing = 0;
    g2.get('xl1').stunTurns = 2; // 乐和吹愣了
    const gu2 = g2.get('gudasao');
    put(gu2, 9, 5);
    g2.b.move(gu2, 8, 4);
    expect(gu2.disguised).toBe(true);
  });

  it('劫牢：还没到死囚牢门就被识破，营后、营东、营西和都头几队州兵立刻杀到（负责人 2026-11-25）', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao');
    expect(get('zw0').present).toBe(false);
    const xl = get('xl0');
    put(gu, xl.x + 3, xl.y);
    b.move(gu, xl.x + 2, xl.y);
    expect(gu.disguised).toBe(false);
    for (const id of ['zb0', 'zw0', 'zx0', 'menguan']) expect(get(id).present, id).toBe(true);
    expect(b.turn).toBe(1);
  });

  it('劫牢：乐和、顾大嫂站到死囚牢门前，回合结束开门；解珍解宝带枷打一回合再扭断枷', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), lh = get('lehe'), jz = get('jiezhen'), jb = get('jiebao');
    const cls = (id: string) => rt.classIds.get(id);
    expect(b.isBound(jz)).toBe(true);
    put(lh, 7, 3);
    put(gu, 7, 4);
    get('baoji').hp = 1;
    get('xl1').stunTurns = 3; // 别在敌方回合捣乱
    b.endPlayerPhase();
    expect(b.board.passable(5, 3)).toBe(true);
    expect(b.isBound(jz)).toBe(false);
    expect(jz.classId).toBe(cls('jiezhen-jia'));
    expect(jb.classId).toBe(cls('jiebao-jia'));
    expect(get('sunli').present).toBe(true);
    b.endPlayerPhase();
    expect(jz.classId).toBe(cls('jiezhen'));
    expect(jb.classId).toBe(cls('jiebao'));
  });

  it('悄悄开了牢门没被识破：营后州兵照常来，营东州兵和关营门的都头晚两回合', () => {
    const { b, get } = open('jielao');
    put(get('lehe'), 7, 3);
    put(get('gudasao'), 7, 4);
    get('baoji').hp = 1;
    get('xl1').stunTurns = 3;
    for (const id of ['xl0', 'xl1', 'xl2', 'xl3']) get(id).hp = 1;
    b.endPlayerPhase(); // 第 1 回合结束开牢门
    expect(b.board.passable(5, 3)).toBe(true);
    const seen: Record<string, number> = {};
    for (let t = 2; t <= 8 && b.status === 'playing'; t++) {
      for (const id of ['zb0', 'zw0', 'zx0', 'menguan', 'luzhishen']) if (seen[id] === undefined && get(id).present) seen[id] = b.turn;
      for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8; // 只看增援的时机：敌人原地不动，别把人打倒判负
      b.endPlayerPhase();
    }
    expect(seen.zb0).toBe(3);
    expect(seen.zw0).toBe(5);
    expect(seen.zx0).toBe(5);
    expect(seen.menguan).toBe(5);
    expect(seen.luzhishen).toBe(6); // 大队来的下一回合
  });

  it('第 3 回合以后才悄悄开牢门，大队也照样晚两回合（负责人 2026-11-24 试玩发现一起出来了）', () => {
    const { b, get } = open('jielao');
    for (const id of ['baoji', 'xl0', 'xl1', 'xl2']) get(id).hp = 1;
    const seen: Record<string, number> = {};
    for (let t = 1; t <= 9 && b.status === 'playing'; t++) {
      if (b.turn === 3) { put(get('lehe'), 7, 3); put(get('gudasao'), 7, 4); get('xl1').stunTurns = 3; get('baoji').stunTurns = 3; }
      for (const id of ['zb0', 'zw0', 'menguan']) if (seen[id] === undefined && get(id).present) seen[id] = b.turn;
      for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8;
      b.endPlayerPhase();
    }
    expect(seen.zb0).toBe(4);
    expect(seen.zw0).toBe(7);
    expect(seen.menguan).toBe(7);
  });
  it('劫牢：胜负条件只显示当前这一步，开牢门、州兵都头杀到、拽开拒马时换成下一步（负责人 2026-11-25）', () => {
    const { b, get } = open('jielao');
    const win = () => b.objectives.filter((l) => l.startsWith('胜利条件'));
    expect(win()).toHaveLength(1);
    expect(win()[0]).toContain('死囚牢门');
    expect(b.objectives.join()).not.toContain('州兵都头');
    expect(b.objectives.some((l) => l.startsWith('失败条件') && l.includes('18 回合'))).toBe(true);
    expect(b.objectives.some((l) => l.startsWith('提示') && l.includes('伪装'))).toBe(true);
    for (const id of ['baoji', 'xl0', 'xl1', 'xl2']) get(id).hp = 1;
    const shown: string[] = [];
    for (let t = 1; t <= 9 && b.status === 'playing'; t++) {
      if (b.turn === 1) { put(get('lehe'), 7, 3); put(get('gudasao'), 7, 4); get('xl1').stunTurns = 3; get('baoji').stunTurns = 3; }
      for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8;
      for (const e of b.endPlayerPhase()) if (e.type === 'objective') shown.push(e.lines.find((l) => l.startsWith('胜利条件'))!);
      const mg = get('menguan');
      if (mg.present && mg.alive) {
        expect(win()[0]).toContain('打倒州兵都头');
        mg.hp = 0; mg.alive = false; mg.present = false;
        (b as unknown as { pendingDeaths: number[] }).pendingDeaths.push(mg.classId); // 回合结束时判倒下、拽开拒马
      }
    }
    expect(shown[0]).toContain('州兵都头就要带人杀到');
    expect(shown).toContainEqual(expect.stringContaining('打倒州兵都头'));
    expect(win()[0]).toContain('逃出牢城营');
    // 失败条件一直留着，不会被新的胜利条件冲掉
    expect(b.objectives.some((l) => l.startsWith('失败条件'))).toBe(true);
  });
});
