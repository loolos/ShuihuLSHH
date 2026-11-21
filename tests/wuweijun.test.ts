// 第二十五章「智取无为军」（docs/game-design.md §15.27）：潜入探查两座黄宅、侯健骗门、杀入放火；穆家庄割黄文炳。
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

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十五章 智取无为军', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const open = (id: string) => {
    const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { s, b, ev, get: (uid: string) => b.units[s.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const put = (b: Battle, u: Unit, x: number, y: number) => {
    u.x = x; u.y = y;
    after(b);
  };
  const kill = (u: Unit) => { u.hp = 0; u.alive = false; u.present = false; };
  const text = (ev: BattleEvent[]) => ev.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => ('text' in e ? e.text : '')).join('');

  it('章号；单位站在可通行的格子上、互不重叠；我方 5 人', () => {
    for (const id of ['wuweijun', 'jiehuang']) {
      expect(chapterOf(`mainline/${id}`)).toBe(25);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        if (!u.hidden) { expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false); seen.add(`${u.x},${u.y}`); }
      }
    }
    expect(stage('wuweijun').units.filter((u) => u.side === 'player').length).toBe(5);
  });

  it('四处探查完，侯健到黄文炳家门口骗开门：潜行结束，武龙、晁盖进场，黄佛子家的门子退场', () => {
    const { b, get } = open('wuweijun');
    expect(b.watchZones().length).toBeGreaterThan(0);
    // 探查时黄文炳家的家丁还没登场（负责人 2026-11-21）
    expect(get('qy1').present).toBe(false);
    expect(get('dt5').present).toBe(false);
    const hj = get('houjian'), xy = get('xueyong');
    // 没探查完，走到门口不算
    put(b, hj, 41, 27);
    expect(get('hero').present).toBe(false);
    put(b, hj, 13, 29); put(b, hj, 11, 1); put(b, hj, 39, 1); put(b, xy, 41, 29);
    expect(b.objectives.join('')).toContain('骗开大门');
    put(b, hj, 41, 27);
    expect(get('hero').present).toBe(true);
    expect(get('chaogai').present).toBe(true);
    expect(get('ye-front').present).toBe(false);
    expect(b.watchZones()).toEqual([]);
    expect(get('qy1').present).toBe(true);
    expect(get('qy1').ai.mode).toBe(0);
    expect(get('shou1').ai.mode).toBe(0);
    expect(get('dt1').ai.mode).toBe(2);
  });

  it('放火三处、打光黄家的人才过关；放火时冒火、附近的人逃窜', () => {
    const { b, ev, get, s } = open('wuweijun');
    const hj = get('houjian');
    for (const [x, y] of [[13, 29], [11, 1], [39, 1], [41, 29], [41, 27]]) put(b, hj, x, y);
    put(b, hj, 34, 6);
    expect(b.fireCells().length).toBeGreaterThan(0);
    expect(b.units.some((u) => u.panicTurns)).toBe(true);
    put(b, hj, 47, 7); put(b, hj, 32, 24);
    expect(b.status).toBe('playing');
    for (const u of s.units) if (u.side === 'enemy') kill(get(u.id));
    after(b);
    expect(b.status).toBe('won');
    expect(text(ev) + text((b as unknown as { out: BattleEvent[] }).out)).toContain('黄文炳');
  });

  it('潜行时被发现、下回合没打倒就输', () => {
    const { b, get } = open('wuweijun');
    const xun = get('xun1');
    const [dx, dy] = [[0, -2], [-2, 0], [0, 2], [2, 0]][xun.facing];
    put(b, get('baisheng'), xun.x + dx, xun.y + dy);
    expect(xun.uid in b.spotters).toBe(true);
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    b.endPlayerPhase();
    expect(b.status).toBe('lost');
  });

  it('穆家庄割黄文炳演完就过关', () => {
    const { b, ev } = open('jiehuang');
    expect(b.status).toBe('won');
    expect(text(ev)).toContain('报了冤仇');
  });
});
