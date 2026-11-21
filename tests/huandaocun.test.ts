// 第二十六章「还道村受天书」（docs/game-design.md §15.28）：宋江独闯玄女庙，神帐里黑尘、怪风吹散土兵，玄女授书，众好汉杀入。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十六章 还道村受天书', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = rt.stages.find((s) => s.id === 'huandaocun')!;
  const open = () => {
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { b, ev, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const put = (b: Battle, u: Unit, x: number, y: number) => { u.x = x; u.y = y; after(b); };
  const kill = (u: Unit) => { u.hp = 0; u.alive = false; u.present = false; };

  it('章号；单位站在可通行的格子上、互不重叠；开场只有宋江一人', () => {
    expect(chapterOf('mainline/huandaocun')).toBe(26);
    const { b } = open();
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), u.id).toBe(true);
      expect(seen.has(`${u.x},${u.y}`), `${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    expect(b.units.filter((u) => u.side === 'player' && u.present).map((u) => u.name)).toEqual(['宋江']);
    expect(stage.units.filter((u) => u.side === 'player').length).toBe(5);
  });

  it('宋江钻进神帐：黑尘、怪风，附近的土兵逃窜 3 回合，庙门一伙不乱；之后到玄女像前受天书、体力回满、众好汉杀到', () => {
    const { b, get } = open();
    const sj = get('songjiang');
    put(b, sj, 3, 11);
    const panicked = b.units.filter((u) => u.side === 'enemy' && u.panicTurns === 3).map((u) => stage.units[b.units.indexOf(u)].id);
    for (const id of ['zhaode', 'b1', 'c1', 'c5']) expect(panicked).toContain(id);
    for (const id of ['zhaoneng', 'a1', 'd1']) expect(panicked).not.toContain(id);
    expect(b.objectives.join('')).toContain('玄女像');
    sj.hp = 1;
    put(b, sj, 10, 3);
    expect(sj.hp).toBe(sj.stats.maxHp);
    expect(get('xuannv').name).toBe('九天玄女像');
    for (const id of ['likui', 'hero', 'liutang', 'shiyong', 'oupeng', 'taozongwang', 'lili']) expect(get(id).present, id).toBe(true);
    expect(get('oupeng').side).toBe('ally');
  });

  it('没到玄女像也会在第 5 回合来救；打光土兵还要去玄女像前才过关', () => {
    const { b, get } = open();
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.ai.mode = 8; // 只看剧本，不让土兵出手
    for (let t = 1; t < 5 && b.status === 'playing'; t++) {
      get('songjiang').hp = get('songjiang').stats.maxHp;
      b.endPlayerPhase();
    }
    expect(get('likui').present).toBe(true);
    for (const u of b.units.filter((x) => x.side === 'enemy')) kill(u);
    after(b);
    expect(b.status).toBe('playing');
    expect(b.objectives.join('')).toContain('玄女像');
    const sj = get('songjiang');
    sj.hp = sj.stats.maxHp;
    put(b, sj, 10, 3);
    expect(b.status).toBe('won');
  });
});
