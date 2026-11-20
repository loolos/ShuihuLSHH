// 第二十一章「刺配江州」（docs/game-design.md §15.21）：剧情选项、宋江劝住收手、揭阳岭限时救人、揭阳镇、穆家庄潜行、船火儿。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { attackSkill, facingTowards, type Unit } from '../src/rules/unit.ts';
import { baseDamage } from '../src/rules/combat.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { insertTownName, insertTownIntro } from '../src/packs/towns.ts';

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
  const ids = ['bensang', 'liangshan-jielu', 'liangshan-songbie', 'jieyangling', 'jieyangzhen', 'mujiazhuang', 'chuanhuoer'];

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
    const exp0 = sj.exp, lv0 = sj.level, team0 = (b as unknown as { teamExp: number }).teamExp;
    b.phase = 'player'; after(b);
    expect(ll.side).toBe('ally');
    // 劝住也按正常击败算法给宋江经验，另一半进全队（负责人 2026-11-20）
    expect(sj.level > lv0 || sj.exp > exp0).toBe(true);
    expect((b as unknown as { teamExp: number }).teamExp).toBeGreaterThan(team0);
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

  it('揭阳岭：四人走进酒店被麻翻、绑在店院原地；第 5 回合开始还没赶到就判负，放哨的火家报信后提前到第 4 回合', () => {
    const { b, get } = open('jieyangling');
    for (const id of ['songjiang', 'hero', 'zhangqian', 'liwan']) expect(b.isBound(get(id)), id).toBe(true);
    expect([get('songjiang').x, get('songjiang').y]).toEqual([10, 12]);
    turn(b, 4);
    expect(b.status).toBe('playing');
    turn(b, 5);
    expect(b.status).toBe('lost');
    const o = open('jieyangling');
    const lj = o.get('lijun');
    lj.x = 16; lj.y = 18; after(o.b);
    for (const id of ['shao-1', 'shao-2']) {
      expect(o.get(id).ai.mode, id).toBe(4);
    }
    expect(o.get('shao-1').ai.point).toEqual({ x: 12, y: 10 });
    const s1 = o.get('shao-1'); s1.x = 12; s1.y = 10; after(o.b);
    turn(o.b, 3);
    expect(o.b.status).toBe('playing');
    turn(o.b, 4);
    expect(o.b.status).toBe('lost');
  });

  it('揭阳岭：救人的人走到宋江身边就认出来，解药救醒四人、过关', () => {
    const { b, get } = open('jieyangling');
    const sj = get('songjiang'), tw = get('tongwei');
    tw.x = sj.x; tw.y = sj.y - 1; after(b);
    expect(b.status).toBe('won');
    expect(b.isBound(sj)).toBe(false);
  });

  it('梁山送别：演完就过关', () => {
    expect(open('liangshan-songbie').b.status).toBe('won');
  });

  it('揭阳岭打完进揭阳岭整备，城里由李俊开口', () => {
    expect(stage('jieyangling').townAfter).toBe(11);
    expect(insertTownName('mainline/jieyangzhen')).toBe('揭阳岭整备');
    expect(insertTownIntro('mainline/jieyangzhen')[0].actor).toBe('lijun');
  });

  it('揭阳镇：李俊同行；穆春打到三成以下就跑掉、不算敌人；闲汉打光过关；穆春被打死判负', () => {
    const { b, get } = open('jieyangzhen');
    expect(get('lijun').side).toBe('player');
    expect(get('lijun').present).toBe(true);
    const mc = get('muchun');
    expect(mc.present).toBe(true);
    mc.hp = Math.floor(mc.stats.maxHp * 0.2); after(b);
    expect(mc.side).not.toBe('enemy');
    expect(mc.present).toBe(false);
    expect(b.status).toBe('playing');
    turn(b, 3);
    for (const u of b.units.filter((x) => x.side === 'enemy' && x.present && x.alive)) kill(b, u);
    after(b);
    expect(b.status).toBe('won');
    const o = open('jieyangzhen');
    kill(o.b, o.get('muchun')); after(o.b);
    expect(o.b.status).toBe('lost');
  });

  const DIR = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  const at = (u: Unit, g: Unit, k: number, sideOf: 'front' | 'back' | 'side') => {
    const f = sideOf === 'front' ? g.facing : sideOf === 'back' ? (g.facing + 2) % 4 : (g.facing + 1) % 4;
    u.x = g.x + DIR[f][0] * k; u.y = g.y + DIR[f][1] * k;
  };

  it('穆家庄夜遁：走到庄客正前方的警戒范围就被发现，下个回合结束前没打倒他判负；打倒了照常走', () => {
    const { b, get } = open('mujiazhuang');
    const g = get('shui-1'), sj = get('songjiang');
    expect(b.watchers.get(g.uid)).toBe(2);
    expect(b.watchZones().some((z) => z.uid === g.uid && !z.spotted)).toBe(true);
    at(sj, g, 2, 'front'); after(b);
    expect(b.spotters[g.uid]).toBe(b.turn + 1);
    expect(g.ai.mode).toBe(0);
    expect(g.unaware).toBe(false);
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    b.endPlayerPhase();
    expect(b.status).toBe('lost');
    const o = open('mujiazhuang');
    const g2 = o.get('shui-1'), sj2 = o.get('songjiang');
    at(sj2, g2, 1, 'front'); after(o.b);
    kill(o.b, g2); after(o.b);
    o.b.endPlayerPhase(); o.b.endPlayerPhase();
    expect(o.b.status).toBe('playing');
  });

  it('穆家庄夜遁：背后、侧面摸过去不会被发现；公人走到正前方也算发现；挨了打就惊醒', () => {
    const { b, get } = open('mujiazhuang');
    const g = get('shui-1');
    at(get('songjiang'), g, 1, 'back'); at(get('hero'), g, 1, 'side'); after(b);
    expect(b.spotters).toEqual({});
    at(get('zhangqian'), g, 2, 'front'); after(b);
    expect(g.uid in b.spotters).toBe(true);
    const o = open('mujiazhuang');
    const g2 = o.get('shui-2');
    at(o.get('hero'), g2, 1, 'back'); after(o.b);
    expect(o.b.spotters).toEqual({});
    g2.hp = g2.stats.maxHp - 1; after(o.b);
    expect(g2.uid in o.b.spotters).toBe(true);
  });

  it('穆家庄夜遁：偷袭没发觉的庄客，背后伤害 ×3、侧面 ×2；发觉了照常 ×1.25 / ×1.1', () => {
    const { b, get } = open('mujiazhuang');
    const g = get('shui-1'), hero = get('hero');
    const skill = attackSkill(hero, b.data);
    const dmg = (side: 'front' | 'back' | 'side') => { at(hero, g, 1, side); hero.facing = facingTowards(hero, g); return baseDamage(hero, g, skill)[0]; };
    const front = dmg('front');
    expect(dmg('back') / front).toBeCloseTo(3);
    expect(dmg('side') / front).toBeCloseTo(2);
    g.unaware = false;
    expect(dmg('back') / front).toBeCloseTo(1.25);
    expect(dmg('side') / front).toBeCloseTo(1.1);
  });

  it('穆家庄夜遁：巡夜庄客沿路线来回走；宋江和武龙都到江边就过关', () => {
    const { s, b, get } = open('mujiazhuang');
    const p = get('xun-1'), route = s.units.find((u) => u.id === 'xun-1')!.patrol!;
    expect(p.ai.mode).toBe(13);
    const start = { x: p.x, y: p.y };
    b.endPlayerPhase();
    expect(p.x !== start.x || p.y !== start.y).toBe(true);
    expect(Math.abs(p.x - route[1][0]) + Math.abs(p.y - route[1][1])).toBeLessThan(Math.abs(start.x - route[1][0]) + Math.abs(start.y - route[1][1]));
    const o = open('mujiazhuang');
    const sj = o.get('songjiang'), hero = o.get('hero');
    sj.x = 2; sj.y = 30; after(o.b);
    expect(o.b.status).toBe('playing');
    hero.x = 3; hero.y = 31; after(o.b);
    expect(o.b.status).toBe('won');
  });

  it('船火儿：板刀面、馄饨、报名号三条路都接李俊赶到、过关', () => {
    for (const k of [0, 1, 2]) {
      const { b, ev } = open('chuanhuoer');
      const ask = ev.find((e) => e.type === 'choice');
      expect(ask && ask.type === 'choice' && ask.choice.options.map((o) => o.label)).toEqual(['吃板刀面', '吃馄饨', '报出名号']);
      const out = b.answer(k);
      const text = out.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => ('text' in e ? e.text : '')).join('');
      expect(text).toContain('船火儿');
      expect(text).toContain('张顺');
      expect(b.status).toBe('won');
    }
  });
});
