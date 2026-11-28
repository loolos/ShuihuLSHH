// 第三十四章「大破高唐州」收尾：武冈镇（城镇）、入云龙斗法破高廉、黑旋风探穴救柴进（docs/game-design.md §15.35.4）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage, stageKind } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import type { Unit } from '../src/rules/unit.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { insertTownIntro, insertTownName, prepareInsertTown } from '../src/packs/towns.ts';
import { FEAST_PLACES } from '../src/rules/feast.ts';
import { newCampaign } from '../src/rules/campaign.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('破高唐州', () => {
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

  it('两关排在第三十四章；真人授五雷之后进武冈镇', () => {
    for (const id of ['polian', 'jiuchai']) expect(chapterOf(`mainline/${id}`)).toBe(34);
    expect(rt.stages.find((s) => s.id === 'chuanfa')!.townAfter).toBe(11);
    expect(insertTownName('mainline/polian')).toBe('武冈镇');
  });

  it('武冈镇：名单是破高廉开场的我方（含汤隆），对白和请客的人都在名单里', () => {
    const c = prepareInsertTown({ ...newCampaign(22), members: [] }, rt, 'mainline/polian');
    const ids = new Set(c.active);
    expect(ids.has(rt.classIds.get('tanglong')!)).toBe(true);
    expect(ids.has(2)).toBe(true);
    for (const l of insertTownIntro('mainline/polian')) expect(ids.has(rt.classIds.get(l.actor) ?? Number(l.actor)), l.actor).toBe(true);
    for (const l of FEAST_PLACES['mainline/polian'].lines) {
      const id = typeof l.who === 'number' ? l.who : rt.classIds.get(l.who.replace(/^@/, ''))!;
      expect(ids.has(id), String(l.who)).toBe(true);
    }
  });

  it('破高廉：林冲、秦明扮假救兵骗高廉出城，高廉招出神兵猛兽，每回合轮着作法；公孙胜照天书放三回；第 4 回合吕方、郭盛来；高廉退城被孙立、朱仝、雷横截住，残血雷横砍做两段', () => {
    const { b, get } = open('polian');
    const SUMMON = new Set(['shenbing', 'lion', 'yiling-tiger', 'wolf', 'bear', 'boar'].map((k) => rt.classIds.get(k)));
    const freeze = () => { for (const u of b.units) if (u.side !== 'player') u.ai.mode = 8; }; // 友军也不动：援军多，不然没几回合敌兵就被砍光了
    const summons = () => b.units.filter((u) => u.side === 'enemy' && u.present && u.alive && SUMMON.has(u.classId));
    const gl = get('gaolian');
    // 开场剧情演完：假救兵（林冲、秦明各带喽啰）在场，高廉出城站到阵中间，招出两队飞天神兵（16 个）、两群猛兽（10 头）
    for (const id of ['linchong', 'qinming', 'fl0', 'fr1', 'daizong', 'malin', 'shixiu', 'yangxiong', 'zhangshun']) expect(get(id).present, id).toBe(true);
    expect(gl.present).toBe(true);
    expect([gl.x, gl.y]).toEqual([18, 15]);
    expect(get('xueyuanhui').present).toBe(false);
    expect(summons().length).toBe(26);
    for (const id of ['lvfang', 'guosheng', 'sunli', 'zhutong', 'leiheng']) expect(get(id).present, id).toBe(false);
    const said: string[] = [];
    const step = () => { freeze(); for (const e of b.endPlayerPhase()) if (e.type === 'say' || e.type === 'status') said.push(e.type === 'say' ? e.text : `status:${e.text}`); };
    step(); // 第 2 回合神兵
    expect(said.some((x) => x.includes('飞天神兵'))).toBe(true);
    step(); // 第 3 回合黑气
    expect(said.some((x) => x.includes('黑气'))).toBe(true);
    expect(get('lvfang').present).toBe(false);
    step(); // 第 4 回合飞沙；吕方、郭盛从两边杀来
    for (const id of ['lvfang', 'guosheng', 'lw0', 'le1']) expect(get(id).present, id).toBe(true);
    step(); // 第 5 回合猛兽
    expect(b.turn).toBe(5);
    expect(said.some((x) => x.includes('飞沙走石'))).toBe(true);
    expect(said.some((x) => x.includes('猛兽'))).toBe(true);
    const gs = get('gongsun');
    const book = rt.itemIds.get('tianshu-wulei')!;
    const slot = () => gs.slots.indexOf(book);
    expect(slot()).toBeGreaterThanOrEqual(0);
    const s0 = summons()[0];
    gs.x = s0.x; gs.y = s0.y + 1;
    if (!b.board.passable(gs.x, gs.y) || b.units.some((u) => u !== gs && u.present && u.x === gs.x && u.y === gs.y)) { gs.x = s0.x + 1; gs.y = s0.y; }
    b.useItem(gs, slot());
    const near = summons().filter((u) => Math.abs(u.x - gs.x) + Math.abs(u.y - gs.y) <= 8);
    expect(near.length).toBeGreaterThan(0);
    for (const u of near) expect(u.hp).toBeLessThanOrEqual(Math.floor(u.stats.maxHp * 0.1));
    // 天书还在（共三次）；下一回合高廉的法被破，他阵中有人逃窜
    expect(slot()).toBeGreaterThanOrEqual(0);
    said.length = 0;
    step();
    expect(said.some((x) => x.includes('倒卷回去'))).toBe(true);
    expect(said.some((x) => x === 'status:逃竄')).toBe(true);
    b.useItem(gs, slot());
    expect(slot()).toBeGreaterThanOrEqual(0);
    b.useItem(gs, slot());
    // 三回用尽：神兵猛兽现了原形退场，仗接着打
    expect(slot()).toBe(-1);
    expect(summons()).toHaveLength(0);
    expect(gl.present).toBe(true);
    expect(b.status).toBe('playing');
    // 高廉不到六成往城下退；退了一回合孙立、朱仝、雷横截住
    gl.hp = Math.floor(gl.stats.maxHp * 0.5);
    step();
    expect(gl.ai.mode === 4 || get('sunli').present).toBe(true);
    if (!get('sunli').present) step();
    for (const id of ['sunli', 'zhutong', 'leiheng']) expect(get(id).present, id).toBe(true);
    gl.hp = Math.floor(gl.stats.maxHp * 0.15);
    step();
    expect(b.status).toBe('won');
  });

  it('救柴进：李逵在箩底，摸到井底的柴进，柴进跟着走；两人回到箩筐那里，过关', () => {
    const { b, get } = open('jiuchai');
    const likui = get('likui'), cj = get('chaijin');
    expect(likui.side).toBe('player');
    expect(cj.side).toBe('ally');
    const free = (x: number, y: number) => b.board.passable(x, y) && !b.active().some((u) => u.x === x && u.y === y);
    const around = (c: { x: number; y: number }) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter((p) => free(p.x, p.y));
    const near = around(cj)[0];
    const from = around(near).find((p) => p.x !== cj.x || p.y !== cj.y)!;
    likui.x = from.x; likui.y = from.y;
    b.move(likui, near.x, near.y);
    expect(cj.ai.mode).toBe(5);
    // 找到柴进，回程有一只黑影窜出来
    expect(get('lang3').present).toBe(true);
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    for (const id of ['lang1', 'lang2', 'lang3']) kill(b, get(id), likui);
    expect(b.status).toBe('playing');
    // 箩筐只有起点那一小块：站在箩筐房间外面一格还不算（以前区域写错成一大片）
    cj.x = 1; cj.y = 12; likui.x = 1; likui.y = 11;
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    cj.x = 1; cj.y = 14; likui.x = 2; likui.y = 15;
    b.endPlayerPhase();
    expect(b.status).toBe('won');
  });

  it('救柴进：开场两只黑影堵在去柴进的路上（守着不动，走近才扑），算战役；地图有迷雾', () => {
    const { b, stage, get } = open('jiuchai');
    expect(stageKind(stage)).toBe('战役');
    expect(stage.fog).toEqual({ radius: 2 });
    for (const id of ['lang1', 'lang2']) {
      const w = get(id);
      expect(w.present).toBe(true);
      expect(w.ai.mode).toBe(12);
      expect(w.stats.maxHp).toBeLessThan(get('likui').stats.maxHp);
    }
    expect(get('lang3').present).toBe(false);
    // 李逵站在起点不动，黑影不过来
    b.endPlayerPhase();
    for (const id of ['lang1', 'lang2']) expect([get(id).x, get(id).y]).toEqual([stage.units.find((u) => u.id === id)!.x, stage.units.find((u) => u.id === id)!.y]);
  });
});
