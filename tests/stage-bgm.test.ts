// 关卡中途按剧情换背景曲（扩展包指令 ["bgm", 歌单, {sting}]，指令 134；负责人 2026-11-25：只给关键剧情用）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

type Op = [string, ...unknown[]];

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('剧情换背景曲', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const base = rt.stages.find((s) => s.id === 'zhufu')!;
  const withOps = (...ops: Op[]) => ({ ...base, script: [{ on: 'start' as const, do: ops }, ...base.script] });

  it('换歌单、插播短曲，战斗记下现在的歌单', () => {
    const b = new Battle(compileStage(rt, withOps(['bgm', ['manor', 'fire'], { sting: 'signal' }]), files, { seed: 1 }));
    expect(b.bgm).toBeNull();
    const ev = b.begin();
    expect(ev).toContainEqual({ type: 'bgm', tracks: ['manor', 'fire'], sting: 'signal' });
    expect(b.bgm).toEqual(['manor', 'fire']);
  });

  it('一首曲名也行；null 只插播不换歌单', () => {
    const b = new Battle(compileStage(rt, withOps(['bgm', 'fire'], ['bgm', null, { sting: 'ambush' }]), files, { seed: 1 }));
    const ev = b.begin().filter((e) => e.type === 'bgm');
    expect(ev).toEqual([{ type: 'bgm', tracks: ['fire'] }, { type: 'bgm', tracks: [], sting: 'ambush' }]);
    expect(b.bgm).toEqual(['fire']);
  });

  it('既没歌单也没短曲，编译报错', () => {
    expect(() => compileStage(rt, withOps(['bgm', null]), files, { seed: 1 })).toThrow(/bgm/);
  });
});
