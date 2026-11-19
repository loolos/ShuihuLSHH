// 第二十二章「浔阳江头」、第二十三章「江州劫法场」主线版（docs/game-design.md §15.22）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { planAi } from '../src/rules/ai.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { insertTownName } from '../src/packs/towns.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十二、二十三章 浔阳江头、江州劫法场', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const open = (id: string) => {
    const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { s, b, ev, get: (uid: string) => b.units[s.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const kill = (b: Battle, u: Unit) => {
    u.hp = 0; u.alive = false; u.present = false;
    (b as unknown as { pendingDeaths: number[] }).pendingDeaths.push(u.classId);
  };
  const text = (ev: BattleEvent[]) => ev.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => ('text' in e ? e.text : '')).join('');

  it('章号；单位站在可通行的格子上、互不重叠；剧情里每个 move 都走得到；我方不超过 5 人', () => {
    for (const [id, ch] of [['jiangzhou-laocheng', 22], ['dufang', 22], ['pipating', 22], ['xunyanglou', 22], ['fachang', 23], ['bailongmiao', 23]] as const) {
      expect(chapterOf(`mainline/${id}`)).toBe(ch);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        if (!u.hidden) { expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false); seen.add(`${u.x},${u.y}`); }
      }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} ${op.join()}`).toBe(true);
      expect(s.units.filter((u) => u.side === 'player' && !u.offstage).length, id).toBeLessThanOrEqual(5);
    }
  });

  it('江州牢城、浔阳楼演完就过关；浔阳楼之后进梁山泊整备', () => {
    expect(open('jiangzhou-laocheng').b.status).toBe('won');
    const x = open('xunyanglou');
    expect(x.b.status).toBe('won');
    expect(text(x.ev)).toContain('梁山泊报信');
    expect(stage('xunyanglou').townAfter).toBe(11);
    expect(insertTownName('mainline/fachang')).toBe('梁山泊整备');
  });

  it('赌坊劝架：赌徒只会逃；走到李逵身边就过关；小张乙被打死判负', () => {
    const { b, get } = open('dufang');
    const zy = get('xiaozhangyi'), lk = get('likui');
    expect(zy.ai.mode).toBe(14);
    const plan = planAi(b, get('dutu-1'));
    expect(plan.skill).toBeUndefined();
    const end = plan.path?.at(-1) ?? get('dutu-1');
    const d = (c: { x: number; y: number }) => Math.abs(c.x - lk.x) + Math.abs(c.y - lk.y);
    expect(d(end)).toBeGreaterThanOrEqual(d(get('dutu-1')));
    const sj = get('songjiang'); sj.x = lk.x - 1; sj.y = lk.y; after(b);
    expect(b.status).toBe('won');
    const o = open('dufang');
    kill(o.b, o.get('xiaozhangyi')); after(o.b);
    expect(o.b.status).toBe('lost');
  });

  it('琵琶亭：张顺打到一半体力以下就转水战，李逵被困在水里；宋江等人赶到栈桥中段过关', () => {
    const { b, get } = open('pipating');
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(1);
    const zs = get('zhangshun'), lk = get('likui'), dz = get('daizong');
    expect(zs.present).toBe(true);
    dz.x = 6; dz.y = 10; after(b);
    expect(b.status).toBe('playing');
    zs.hp = Math.floor(zs.stats.maxHp * 0.4); after(b);
    expect(b.isBound(lk)).toBe(true);
    expect([zs.x, zs.y, lk.x, lk.y]).toEqual([4, 15, 5, 15]); // 都上了栈桥边泊着的渔船
    expect(get('songjiang').present).toBe(true);
    expect(get('lan-1').present).toBe(true);
    const sj = get('songjiang'); sj.x = 7; sj.y = 11; after(b);
    expect(b.status).toBe('won');
    expect(b.isBound(lk)).toBe(false);
  });

  it('法场主线版：武龙扮客商第 2 回合动手；花荣等其余好汉是友军', () => {
    const { b, get, s } = open('fachang');
    expect(s.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['chaogai', 'daizong', 'likui', 'songjiang', 'wulong']);
    expect(get('wulong').present).toBe(false);
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(1);
    expect(get('wulong').present).toBe(true);
    expect(get('huarong').side).toBe('ally');
  });

  it('白龙庙主线版：武龙开场就在庙旁；新做的穆弘等人用主线职业', () => {
    const { get, s } = open('bailongmiao');
    expect(s.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['chaogai', 'daizong', 'likui', 'songjiang', 'wulong']);
    expect(get('wulong').present).toBe(true);
    for (const id of ['muhong', 'muchun', 'xueyong', 'tongwei', 'tongmeng', 'lili', 'lijun', 'zhangheng', 'zhangshun']) expect(s.units.find((u) => u.id === id)!.class, id).toBe(id);
  });
});
