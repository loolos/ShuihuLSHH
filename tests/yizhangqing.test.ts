// 一丈青（第三十一章）：王英、扈三娘各自往前走到空场对决；林冲走出来和步战的扈三娘斗几合再捉（负责人 2026-11-24）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('一丈青', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline');
  const stage = rt.stages.find((s) => s.id === 'yizhangqing')!;
  const open = () => {
    const b = new Battle(compileStage(rt, stage, new NodeFiles(DATA), { seed: 1 }));
    b.begin();
    return { b, get: (id: string) => b.units[stage.units.findIndex((u) => u.id === id)] };
  };
  const dist = (a: { x: number; y: number }, c: { x: number; y: number }) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);

  it('单挑的空场被人占了，扈三娘就近站开，王英走到她身边', () => {
    const { b, get } = open();
    const hs = get('husanniang'), wy = get('wangying'), lk = get('likui');
    lk.x = 27; lk.y = 38; // 第 1 回合李逵先站到对决的那一格
    let wyAt: { x: number; y: number } | null = null, hsAt: { x: number; y: number } | null = null;
    const ev = b.endPlayerPhase();
    for (const e of ev) if (e.type === 'move' && e.uid === wy.uid) wyAt = e.path[e.path.length - 1];
    for (const e of ev) if (e.type === 'move' && e.uid === hs.uid && !hsAt) hsAt = e.path[e.path.length - 1];
    expect(hsAt).not.toBeNull();
    expect(hsAt).not.toEqual({ x: 27, y: 38 });
    expect(dist(hsAt!, { x: 27, y: 38 })).toBe(1);
    expect(dist(wyAt!, hsAt!)).toBe(1);
  });

  it('扈三娘打到三成以下：林冲走过来，扈三娘下马换步战造型，斗几合再被捉', () => {
    const { b, get } = open();
    const hs = get('husanniang'), sj = get('songjiang');
    b.endPlayerPhase();
    const mounted = hs.classId;
    hs.hp = Math.floor(hs.stats.maxHp * 0.2);
    const lc = get('linchong');
    const ev = b.move(sj, sj.x - 1, sj.y);
    expect(ev.some((e) => e.type === 'move' && e.uid === lc.uid)).toBe(true);
    expect(hs.classId).not.toBe(mounted); // 换成步战造型
    expect(b.data.classes[hs.classId].name).toBe('扈三娘');
    expect(hs.present).toBe(false); // 捉住押走
  });
});
