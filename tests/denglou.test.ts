// 第三十二章「登州劫牢」（docs/game-design.md §15.33）：射虎的兄弟配合、劫牢的伪装 / 识破、开牢门、带枷
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { baseDamage } from '../src/rules/combat.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { learnedSkills } from '../src/rules/skills.ts';
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

  it('劫牢：吹铁叫子叫人一回合不动，不破伪装', () => {
    const { b, get } = open('jielao');
    const lh = get('lehe'), bj = get('baoji');
    put(lh, bj.x, bj.y + 2);
    b.useSkill(lh, skill(b, lh, '吹铁叫子'), { x: bj.x, y: bj.y });
    expect(lh.disguised).toBe(true);
    expect(bj.stunTurns).toBeGreaterThan(0);
  });

  it('劫牢：乐和、顾大嫂站到死囚牢门前，回合结束开门；解珍解宝带枷打一回合再扭断枷', () => {
    const { b, get } = open('jielao');
    const gu = get('gudasao'), lh = get('lehe'), jz = get('jiezhen'), jb = get('jiebao');
    const cls = (id: string) => rt.classIds.get(id);
    expect(b.isBound(jz)).toBe(true);
    put(lh, 6, 3);
    put(gu, 7, 3);
    get('baoji').hp = 1; // 别在敌方回合捣乱
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
});
