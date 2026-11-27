// 第三十四章「大破高唐州」：打死殷天锡、妖法困宋江（docs/game-design.md §15.35）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterLabel, chapterOf } from '../src/rules/chapters.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('大破高唐州', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const open = (id: string, seed = 1) => {
    const stage = rt.stages.find((s) => s.id === id)!;
    const b = new Battle(compileStage(rt, stage, files, { seed }));
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
      if (!u.hidden) expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    b.begin();
    return { b, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const kill = (b: Battle, t: Unit, by: Unit) => (b as unknown as { kill(u: Unit, k: Unit): void }).kill(by, t);
  const skill = (b: Battle, u: Unit, name: string) => learnedSkills(u, b.data).find((s) => s.name === name);

  it('三关都排在第三十四章「大破高唐州」', () => {
    for (const id of ['leiheng-zhutong', 'yintianxi', 'baoxin', 'shenbing']) expect(chapterOf(`mainline/${id}`)).toBe(34);
    expect(chapterLabel(34)).toBe('第三十四章 大破高唐州');
  });

  it('打死殷天锡：李逵冲出来，柴进会丹书铁券；第 2 回合殷天锡往府门跑；打死以后闲汉跑散、公人进门、柴进留下，李逵到后门就过关', () => {
    const { b, get } = open('yintianxi');
    const likui = get('likui'), chai = get('chaijin'), yin = get('yintianxi');
    expect(likui.present).toBe(true);
    expect(skill(b, chai, '丹书铁券')).toBeTruthy();
    expect(b.objectiveZones().some((z) => z.kind === 'danger' && z.label === '府门')).toBe(true);
    b.endPlayerPhase();
    expect(yin.ai.mode).toBe(4);
    kill(b, yin, likui);
    b.endPlayerPhase();
    expect(b.units.filter((u) => u.side === 'enemy' && u.present && u.name === '闲汉')).toHaveLength(0);
    expect(get('dutou').present).toBe(true);
    expect(chai.present).toBe(false);
    expect(b.status).toBe('playing');
    likui.x = 3; likui.y = 3;
    b.endPlayerPhase();
    expect(b.status).toBe('won');
  });

  const duel = (b: Battle, get: (id: string) => Unit) => {
    for (const id of ['yuzhi', 'wenwenbao']) get(id).hp = Math.floor(get(id).stats.maxHp * 0.05);
    b.endPlayerPhase();
  };

  it('妖法困宋江：开场只有林冲、秦明能动，两员统制打到一成以下就退场，全军出战', () => {
    const { b, get } = open('shenbing');
    expect(b.spectators.has(get('songjiang').uid)).toBe(true);
    expect(b.spectators.has(get('linchong').uid)).toBe(false);
    expect(b.spectators.has(get('gaolian').uid)).toBe(true);
    duel(b, get);
    expect(get('yuzhi').present).toBe(false);
    expect(get('wenwenbao').present).toBe(false);
    expect(b.spectators.has(get('songjiang').uid)).toBe(false);
    expect(b.spectators.has(get('gaolian').uid)).toBe(false);
  });

  it('妖法困宋江：单挑一结束高廉先召十个飞天神兵（吴用随即提天书），之后每回合轮着作法：黑气中毒、飞沙昏迷并吹开最近的五人、召猛虎、再召神兵', () => {
    const { b, get } = open('shenbing');
    const gl = get('gaolian');
    // 敌人多、中毒久，只看作法：敌人都原地不动，免得宋江先倒下
    const step = () => { for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8; return b.endPlayerPhase(); };
    const sbs = () => b.units.filter((u) => u.present && u.alive && u.name === '飞天神兵');
    for (const id of ['yuzhi', 'wenwenbao']) get(id).hp = Math.floor(get(id).stats.maxHp * 0.05);
    let ev = step();
    expect(ev.some((e) => e.type === 'say' && e.text.includes('回风返火'))).toBe(true);
    // 高廉身边十个，梁山阵后再来八个
    expect(ev.filter((e) => e.type === 'appear' && b.units[e.uid].name === '飞天神兵').length).toBe(18);
    const mine = () => b.units.filter((u) => u.present && u.alive && u.side !== 'enemy' && !b.spectators.has(u.uid));
    expect(b.turn).toBe(2);
    const qi = ev.filter((e) => e.type === 'status' && e.text === '黑氣入體').length;
    expect(qi).toBeGreaterThanOrEqual(Math.round(mine().length / 3) - 1);
    // 几阵风、几个中毒挨在一起（画面上一起放）
    const kinds = ev.filter((e) => e.type === 'gust' || (e.type === 'status' && e.text === '黑氣入體')).map((e) => e.type);
    expect(kinds.join(',')).toMatch(/^(gust,)+(status,)*status$/);
    const dist = (u: Unit) => Math.abs(u.x - gl.x) + Math.abs(u.y - gl.y);
    const before = new Map(mine().map((u) => [u.uid, dist(u)]));
    ev = step();
    expect(ev.some((e) => e.type === 'say' && e.text.includes('回风返火'))).toBe(false);
    expect(ev.filter((e) => e.type === 'status' && e.text === '飛沙迷眼').length).toBeGreaterThan(0);
    const pushed = ev.filter((e) => e.type === 'move' && e.script && b.units[e.uid].side !== 'enemy');
    expect(pushed.length).toBeGreaterThan(0);
    for (const e of pushed) {
      const p = (e as { path: { x: number; y: number }[] }).path;
      const end = p[p.length - 1];
      expect(Math.abs(end.x - gl.x) + Math.abs(end.y - gl.y)).toBeGreaterThan(Math.abs(p[0].x - gl.x) + Math.abs(p[0].y - gl.y));
    }
    expect(before.size).toBeGreaterThan(0);
    ev = step();
    expect(b.units.filter((u) => u.present && u.name === '猛兽').length).toBeGreaterThan(0);
    const n0 = sbs().length;
    step();
    expect(b.turn).toBe(5);
    expect(sbs().length).toBeGreaterThan(n0);
    expect(sbs().some((u) => dist(u) > 3)).toBe(true);
  });

  it('妖法困宋江：好汉杀到高廉跟前，他身边冒出十个飞天神兵', () => {
    const { b, get } = open('shenbing');
    duel(b, get);
    const gl = get('gaolian'), lc = get('linchong');
    const n0 = b.units.filter((u) => u.present && u.name === '飞天神兵').length;
    lc.x = gl.x; lc.y = gl.y + 2;
    b.endPlayerPhase();
    expect(b.units.filter((u) => u.present && u.name === '飞天神兵').length).toBeGreaterThanOrEqual(n0 + 10);
  });

  it('妖法困宋江：宋江身上带着天书，用一次场上神兵猛虎吹散一半、下一次作法被吹回去，之后照常作法；高廉打到三成半以下就收兵过关', () => {
    const { b, get } = open('shenbing');
    const sj = get('songjiang');
    const slot = sj.slots.indexOf(rt.itemIds.get('tianshu')!);
    expect(slot).toBeGreaterThanOrEqual(0);
    // 敌人多，只看作法：敌人都原地不动，免得宋江、吴用先倒下
    const freeze = () => { for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8; };
    const next = () => { freeze(); const ev = b.endPlayerPhase(); freeze(); return ev; };
    for (const id of ['yuzhi', 'wenwenbao']) get(id).hp = Math.floor(get(id).stats.maxHp * 0.05);
    next(); next(); next(); next();
    expect(b.turn).toBe(5);
    const summons = () => b.units.filter((u) => u.present && u.alive && (u.name === '飞天神兵' || u.name === '猛兽'));
    const n0 = summons().length;
    expect(n0).toBeGreaterThan(1);
    b.useItem(sj, slot);
    expect(sj.slots[slot]).toBe(0);
    expect(summons().length).toBe(n0 - Math.round(n0 / 2));
    const n1 = summons().length;
    let ev = next();
    expect(b.turn).toBe(6);
    expect(ev.filter((e) => e.type === 'appear' && b.units[e.uid].name === '飞天神兵')).toHaveLength(0);
    expect(summons().length).toBeLessThanOrEqual(n1);
    expect(b.units.filter((u) => u.side === 'enemy' && u.present && u.panicTurns).length).toBeGreaterThan(0);
    ev = next();
    expect(ev.filter((e) => e.type === 'status' && e.text === '黑氣入體').length).toBeGreaterThan(0);
    const gl = get('gaolian');
    gl.hp = Math.floor(gl.stats.maxHp * 0.3);
    next();
    expect(b.status).toBe('won');
  });
});

describe('跳到续篇插关的等级', () => {
  it('按章节表里到这一关为止最后一次出场的估算等级配人，不停在 N14', async () => {
    const { insertJumpLevels } = await import('../src/rules/preset.ts');
    const { newCampaign } = await import('../src/rules/campaign.ts');
    const rt = loadPackFromDisk('mainline');
    const c = { ...newCampaign(0), members: [{ classId: 11, level: 28, exp: 5, slots: [0, 0, 0, 0, 0, 0, 0, 0], forge: [0, 0, 0, 0, 0, 0, 0, 0] }, { classId: 999, level: 7, exp: 0, slots: [], forge: [] }] };
    const out = insertJumpLevels(rt.data, c as never, 'mainline/shenbing');
    expect(out.members[0].level).toBe(43); // 吴用：神兵困公明的估算等级
    expect(out.members[0].exp).toBe(0);
    expect(out.members[1].level).toBe(7); // 表里没有的人不动
  });
});
