// 第二十二章「浔阳江头」、第二十三章「江州劫法场」主线版（docs/game-design.md §15.22）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf, chapterSequence } from '../src/rules/chapters.ts';
import { planAi } from '../src/rules/ai.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { insertTownIntro, insertTownName } from '../src/packs/towns.ts';

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

  it('章号；单位站在可通行的格子上、互不重叠；剧情里每个 move 都走得到；第二十二章我方不超过 5 人（江州劫法场按外传，负责人 2026-11-19 允许超过）', () => {
    for (const [id, ch] of [['jiangzhou-laocheng', 22], ['dufang', 22], ['pipating', 22], ['xunyanglou', 22], ['fachang', 24], ['bailongmiao', 24]] as const) {
      expect(chapterOf(`mainline/${id}`)).toBe(ch);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        if (!u.hidden) { expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false); seen.add(`${u.x},${u.y}`); }
      }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} ${op.join()}`).toBe(true);
      if (ch === 22) expect(s.units.filter((u) => u.side === 'player' && !u.offstage).length, id).toBeLessThanOrEqual(5);
    }
  });

  it('大闹清风寨打完（劫囚车）进清风山整备，开放霹雳火秦明第一关的全部我方', () => {
    expect(rt.stages.find((s) => s.id === 'jieqiuche')!.townAfter).toBe(11);
    expect(insertTownName('mainline/yekun')).toBe('清风山整备');
    expect(insertTownIntro('mainline/yekun').map((l) => l.actor)).toEqual(['huarong', 'sj-fugitive', 'wangying']);
  });

  it('有专名的插关城镇都有自己的入城对白，不落到阳谷的宋江、武松对白（负责人 2026-11-23：独龙冈下寨照抄了阳谷）', () => {
    const yanggu = JSON.stringify(insertTownIntro('mainline/shizipo'));
    expect(insertTownIntro('mainline/none')).toEqual([]);
    for (const next of ['mainline/shiyong', 'mainline/yuanyanglou', 'mainline/jieyangzhen', 'mainline/fachang', 'mainline/yekun', 'mainline/zhujiadian', 'mainline/panduolu', 'mainline/ruzhuang']) {
      expect(insertTownName(next), next).not.toBe('阳谷整备');
      expect(JSON.stringify(insertTownIntro(next)), next).not.toBe(yanggu);
    }
    const actors = new Set(rt.stages.find((s) => s.id === 'panduolu')!.units.filter((u) => u.side === 'player' && !u.hidden).map((u) => u.class));
    for (const l of insertTownIntro('mainline/panduolu')) expect(actors.has(l.actor), l.actor).toBe(true);
  });

  it('每个续篇城镇（townAfter）都有入城对白，不留空也不串到别的城镇（负责人 2026-11-23：去城镇的对白放在城镇里）', () => {
    const seq = chapterSequence().map((x) => x.key);
    const seen = new Map<string, string>();
    for (const s of rt.stages.filter((x) => x.townAfter)) {
      const i = seq.indexOf(`mainline/${s.id}`);
      expect(i, s.id).toBeGreaterThanOrEqual(0);
      const next = seq[i + 1];
      const lines = JSON.stringify(insertTownIntro(next));
      expect(insertTownIntro(next).length, next).toBeGreaterThan(0);
      expect(seen.get(lines), next).toBeUndefined();
      seen.set(lines, next);
    }
  });

  it('江州牢城、浔阳楼演完就过关；浔阳楼只演到蔡九差戴宗上东京，梁山泊整备挪到假信露馅之后', () => {
    expect(open('jiangzhou-laocheng').b.status).toBe('won');
    const x = open('xunyanglou');
    expect(x.b.status).toBe('won');
    expect(text(x.ev)).toContain('蔡太师示下');
    expect(text(x.ev)).not.toContain('梁山泊报信');
    expect(stage('xunyanglou').townAfter).toBeUndefined();
    expect(stage('jiaxin').townAfter).toBe(11);
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
    // 栈桥中段要画在小地图上：区域区块只设标志 reach，由 { flag: reach } 区块过关
    expect(b.objectiveZones().filter((z) => z.kind === 'goal').map((z) => [z.x1, z.y1, z.x2, z.y2])).toEqual([[5, 10, 8, 11]]);
    expect(zs.present).toBe(true);
    dz.x = 6; dz.y = 10; after(b);
    expect(b.status).toBe('playing');
    zs.hp = Math.floor(zs.stats.maxHp * 0.4); after(b);
    expect(b.isBound(lk)).toBe(true);
    expect([zs.x, zs.y, lk.x, lk.y]).toEqual([4, 15, 5, 15]); // 都上了栈桥边泊着的渔船
    expect(get('songjiang').present).toBe(true);
    expect(get('lan-1').present).toBe(true);
    const sj = get('songjiang'); sj.x = 7; sj.y = 11; after(b);
    expect(b.status).toBe('playing'); // 区域回合结束才算【新】（负责人 2026-11-21）
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(50);
    expect(b.status).toBe('won');
    expect(b.isBound(lk)).toBe(false);
  });

  it('法场主线版：外传里的我方好汉全部可控（18 人），武龙扮客商第 2 回合动手', () => {
    const { b, get, s } = open('fachang');
    expect(s.units.filter((u) => u.side === 'player')).toHaveLength(18);
    // 撤退方向（第 4–9 回合南街）的援兵各队翻倍，右下街口的第 2、3 回合不加
    expect(s.units.filter((u) => u.side === 'enemy' && u.id.endsWith('b')).map((u) => u.id.split('_')[0])).not.toContain('x2');
    // 开场和各回合登场的 76 人，另有 6 个街口各 3 组（每组 4 人）轮着刷出来抢囚车
    expect(s.units.filter((u) => u.side === 'enemy' && !/^r[a-z]\d_\d$/.test(u.id))).toHaveLength(76);
    expect(s.units.filter((u) => /^r[a-z]\d_\d$/.test(u.id))).toHaveLength(72);
    expect(get('wulong').present).toBe(false);
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(1);
    expect(get('wulong').present).toBe(true);
    expect(get('huarong').side).toBe('player');
    expect(get('zhugui').side).toBe('ally');
    // 乔装的好汉暴露前算围观：官兵选不到他们
    const guan = b.units.find((u) => u.side === 'enemy' && u.present && u.alive)!;
    const disguised = s.units.flatMap((u, i) => u.id.endsWith('_d') ? [b.units[i]] : []);
    expect(disguised.length).toBe(18);
    for (const d of disguised) expect(b.spectators.has(d.uid)).toBe(true);
    expect(b.foesOf(guan).some((t) => disguised.includes(t))).toBe(false);
  });

  it('法场抢囚车（负责人 2026-11-28）：宋江钉在囚车上不挨打；我方回合结束时车旁好汉多就往江边推，自己人挡路换位置', () => {
    const { b, get } = open('fachang');
    const sj = get('songjiang');
    expect(b.cart?.uid).toBe(sj.uid);
    expect(b.isBound(sj)).toBe(true);
    const guan = b.units.find((u) => u.side === 'enemy' && u.present && u.alive)!;
    expect(b.foesOf(guan)).not.toContain(sj);
    // 只留三个好汉站在车旁，前面一格站着自己人（换位置），其余的人都不在场
    for (const u of b.units) if (u !== sj && u.present) { u.present = false; }
    const [lk, cg, hr] = [get('likui'), get('chaogai'), get('huarong')];
    for (const [u, x, y] of [[lk, 40, 13], [cg, 42, 13], [hr, 41, 14]] as const) Object.assign(u, { present: true, alive: true, x, y });
    expect(b.cartView()).toMatchObject({ at: 0, ours: 3, foes: 0 });
    (b as unknown as { cartTick: (w: string) => void }).cartTick('ours');
    expect(b.cartView()!.at).toBe(2);
    expect([sj.x, sj.y]).toEqual([41, 15]);
    expect([hr.x, hr.y]).toEqual([41, 13]);
    // 车前站着官兵就推不动
    Object.assign(guan, { x: 41, y: 16, present: true, alive: true });
    for (const [u, x, y] of [[lk, 40, 15], [cg, 42, 15], [hr, 40, 14]] as const) Object.assign(u, { x, y });
    const ev = (b as unknown as { out: BattleEvent[] }).out;
    (b as unknown as { cartTick: (w: string) => void }).cartTick('ours');
    expect(b.cartView()!.at).toBe(2);
    expect(ev.some((e) => e.type === 'message' && e.text.includes('推不動'))).toBe(true);
    // 官兵回合结束时官兵多：往回拉
    for (const u of [lk, cg, hr]) u.present = false;
    const foes = b.units.filter((u) => u.side === 'enemy' && u !== guan).slice(0, 2);
    for (const [u, x, y] of [[foes[0], 40, 16], [foes[1], 42, 16]] as const) Object.assign(u, { x, y, present: true, alive: true });
    (b as unknown as { cartTick: (w: string) => void }).cartTick('enemy');
    expect(b.cartView()!.at).toBe(0);
  });

  it('法场抢囚车：推到江边过关；好汉全倒下才输（车上的宋江不算）', () => {
    const { b, get } = open('fachang');
    const sj = get('songjiang');
    const end = b.cart!.route.length - 1;
    (b as unknown as { cartAt: number }).cartAt = end - 1;
    Object.assign(sj, b.cart!.route[end - 1]);
    for (const u of b.units) if (u !== sj && u.present) u.present = false;
    const lk = get('likui');
    Object.assign(lk, { present: true, alive: true, x: sj.x - 1, y: sj.y });
    (b as unknown as { cartTick: (w: string) => void }).cartTick('ours');
    expect(b.status).toBe('won');
    const o = open('fachang');
    for (const u of o.b.units) if (u.side === 'player' && u !== o.get('songjiang')) u.alive = false;
    after(o.b);
    expect(o.b.status).toBe('lost');
  });

  it('法场抢囚车 AI：官兵先挑车旁能打到人的位置', () => {
    const { b, get } = open('fachang');
    const sj = get('songjiang');
    for (const u of b.units) if (u !== sj && u.present) u.present = false;
    const lk = get('likui');
    Object.assign(lk, { present: true, alive: true, x: 40, y: 14 });
    const g = b.units.find((u) => u.side === 'enemy' && b.data.classes[u.classId] && u.ai.mode === 0)!;
    Object.assign(g, { present: true, alive: true, x: 37, y: 15 });
    const plan = planAi(b, g);
    const end = plan.path?.at(-1) ?? g;
    expect(b.nextToCart(end)).toBe(true);
    expect(plan.target).toBe(lk);
  });

  it('白龙庙主线版：外传的 26 名可控好汉加李俊共 27 人；武龙开场就在庙旁；新做的穆弘等人用主线职业', () => {
    const { get, s } = open('bailongmiao');
    expect(s.units.filter((u) => u.side === 'player')).toHaveLength(27);
    expect(get('lijun').side).toBe('player');
    expect(get('zhangshun').side).toBe('ally');
    expect(get('wulong').present).toBe(true);
    for (const id of ['muhong', 'muchun', 'xueyong', 'tongwei', 'tongmeng', 'lili', 'lijun', 'zhangheng', 'zhangshun']) expect(s.units.find((u) => u.id === id)!.class, id).toBe(id);
  });
});
