// 第三十四章「大破高唐州」收尾：武冈镇（城镇）、入云龙斗法破高廉、黑旋风探穴救柴进（docs/game-design.md §15.35.4）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
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

  it('破高廉：开场和每两回合高廉作法放神兵猛兽；公孙胜放五雷天心正法，神兵变回纸、高廉退走，夜劫寨后高廉再出城；打到残血雷横砍做两段，过关', () => {
    const { b, get } = open('polian');
    const freeze = () => { for (const u of b.units) if (u.side === 'enemy') u.ai.mode = 8; };
    const beasts = () => b.units.filter((u) => u.side === 'enemy' && u.present && u.alive && u.name === '神兵猛兽');
    // 开场高廉就作了一次法；第 3 回合再来一波
    const n0 = beasts().length;
    expect(n0).toBeGreaterThan(0);
    freeze(); b.endPlayerPhase(); freeze(); b.endPlayerPhase();
    expect(b.turn).toBe(3);
    expect(beasts().length).toBeGreaterThan(n0);
    const gs = get('gongsun'), gl = get('gaolian');
    const tx = learnedSkills(gs, b.data).find((k) => k.name === '五雷天心正法')!;
    expect(tx).toBeTruthy();
    gs.x = gl.x; gs.y = gl.y + 4; gs.mp = gs.stats.maxMp;
    freeze(); b.useSkill(gs, tx, { x: gl.x, y: gl.y });
    expect(beasts()).toHaveLength(0);
    expect(gl.present).toBe(false);
    const g2 = get('gaolian2');
    expect(g2.present).toBe(true);
    // 夜里收兵回寨：众人回到开场的位置；戴宗回山调兵；吕方等人等高廉被打伤才杀出
    const sj = get('songjiang');
    expect(sj.y).toBeGreaterThan(20);
    expect(get('daizong').present).toBe(false);
    expect(get('lvfang').present).toBe(false);
    expect(b.status).toBe('playing');
    freeze(); b.endPlayerPhase();
    g2.hp = Math.floor(g2.stats.maxHp * 0.5);
    freeze(); b.endPlayerPhase();
    expect(get('lvfang').present).toBe(true);
    g2.hp = Math.floor(g2.stats.maxHp * 0.15);
    freeze(); b.endPlayerPhase();
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
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    // 两人都回到箩筐那块
    cj.x = 2; cj.y = 13; likui.x = 2; likui.y = 14;
    b.endPlayerPhase();
    expect(b.status).toBe('won');
  });
});
