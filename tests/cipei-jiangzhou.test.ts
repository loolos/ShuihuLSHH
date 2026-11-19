// 第二十一章「刺配江州」（docs/game-design.md §15.21）：剧情选项、宋江劝住收手、揭阳岭限时救人。
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

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十一章 刺配江州', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const open = (id: string) => {
    const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { s, b, ev, get: (uid: string) => b.units[s.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const turn = (b: Battle, n: number) => (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(n - 1);
  const kill = (b: Battle, u: Unit) => {
    u.hp = 0; u.alive = false; u.present = false;
    (b as unknown as { pendingDeaths: number[] }).pendingDeaths.push(u.classId);
  };
  const ids = ['bensang', 'liangshan-jielu', 'liangshan-songbie', 'jieyangling'];

  it('四段都在第二十一章；单位站在可通行的格子上、互不重叠；剧情里每个 move 都走得到', () => {
    for (const id of ids) {
      expect(chapterOf(`mainline/${id}`)).toBe(21);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false);
        seen.add(`${u.x},${u.y}`);
      }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} ${op.join()}`).toBe(true);
    }
  });

  it('奔丧归庄：开局停在两项的剧情选项上', () => {
    const { b, ev } = open('bensang');
    expect(b.status).toBe('playing');
    const ask = ev.find((e) => e.type === 'choice');
    expect(ask && ask.type === 'choice' && ask.choice.options.map((o) => o.label)).toEqual(['开门出首，随都头去县里', '与四郎杀出去']);
    expect(b.pendingChoice).not.toBeNull();
    expect(() => b.answer(9)).toThrow();
  });

  it('奔丧归庄：杀出去被太公拦下，再接出首；选出首直接出首', () => {
    for (const k of [0, 1]) {
      const { b } = open('bensang');
      const out = b.answer(k);
      const text = out.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => ('text' in e ? e.text : '')).join('');
      expect(text.includes('使不得'), `选项 ${k}`).toBe(k === 1);
      expect(text).toContain('明日一同见官');
      expect(b.status).toBe('won');
      expect(b.pendingChoice).toBeNull();
    }
  });

  it('梁山截路：宋江戴枷；在我方回合走到喽啰身边就劝住，那人收手不动、不再算敌人', () => {
    const { b, get } = open('liangshan-jielu');
    const sj = get('songjiang');
    expect(sj.buffs.filter((x) => x.value < 0).map((x) => x.stat).sort()).toEqual(['attack', 'move']);
    const ll = get('louluo-1');
    expect(ll.side).toBe('enemy');
    sj.x = ll.x + 1; sj.y = ll.y;
    b.phase = 'enemy'; after(b);
    expect(ll.side).toBe('enemy');
    b.phase = 'player'; after(b);
    expect(ll.side).toBe('ally');
    expect(ll.ai.mode).toBe(8);
    expect(b.spectators.has(ll.uid)).toBe(true);
    expect(b.status).toBe('playing');
  });

  it('梁山截路：喽啰追的是公人；撑到第 6 回合就过关；公人倒下判负', () => {
    const { b, get } = open('liangshan-jielu');
    expect(get('louluo-1').ai.mode).toBe(10);
    expect(get('louluo-1').ai.target).toBe(get('zhangqian').classId);
    expect(get('liutang').ai.mode).toBe(8);
    turn(b, 2);
    expect(get('liutang').ai.mode).toBe(10);
    expect(get('louluo-9').present).toBe(true);
    turn(b, 6);
    expect(b.status).toBe('won');
    const o = open('liangshan-jielu');
    kill(o.b, o.get('liwan')); after(o.b);
    expect(o.b.status).toBe('lost');
  });

  it('梁山截路：敌人全部收手或被打倒就过关（还没登场的增援也要算）', () => {
    const { b, get } = open('liangshan-jielu');
    const foes = () => b.units.filter((u) => u.side === 'enemy' && u.present && u.alive);
    for (const u of foes()) kill(b, u);
    after(b);
    expect(b.status).toBe('playing');
    turn(b, 2);
    const sj = get('songjiang');
    for (const u of foes()) { sj.x = u.x + 1; sj.y = u.y; after(b); }
    expect(b.status).toBe('won');
  });

  it('揭阳岭：四人被绑；第 6 回合开始还没赶到就判负，放哨的火家报信后提前到第 5 回合', () => {
    const { b, get } = open('jieyangling');
    for (const id of ['songjiang', 'hero', 'zhangqian', 'liwan']) expect(b.isBound(get(id)), id).toBe(true);
    turn(b, 5);
    expect(b.status).toBe('playing');
    turn(b, 6);
    expect(b.status).toBe('lost');
    const o = open('jieyangling');
    const lj = o.get('lijun');
    lj.x = 16; lj.y = 18; after(o.b);
    for (const id of ['shao-1', 'shao-2']) {
      expect(o.get(id).ai.mode, id).toBe(4);
    }
    expect(o.get('shao-1').ai.point).toEqual({ x: 11, y: 13 });
    const s1 = o.get('shao-1'); s1.x = 11; s1.y = 13; after(o.b);
    turn(o.b, 5);
    expect(o.b.status).toBe('lost');
  });

  it('揭阳岭：救人的人走到宋江身边就认出来，解药救醒四人、过关', () => {
    const { b, get } = open('jieyangling');
    const sj = get('songjiang'), tw = get('tongwei');
    tw.x = sj.x + 1; tw.y = sj.y; after(b);
    expect(b.status).toBe('won');
    expect(b.isBound(sj)).toBe(false);
  });

  it('梁山送别：演完就过关', () => {
    expect(open('liangshan-songbie').b.status).toBe('won');
  });
});
