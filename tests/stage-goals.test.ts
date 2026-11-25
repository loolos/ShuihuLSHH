// 分阶段的胜负条件（扩展包关卡的 goals，docs/game-design.md §15.2）：只显示当前这一步，按剧本标志随时换（负责人 2026-11-25）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('分阶段胜负条件', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const withGoals = rt.stages.filter((s) => s.goals?.length);

  it('写了 goals 的关卡开场就有胜利条件和失败条件，剧本里不再用 objective', () => {
    expect(withGoals.length).toBeGreaterThanOrEqual(9);
    for (const stage of withGoals) {
      const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
      const ev = b.begin();
      expect(b.objectives.filter((l) => l.startsWith('胜利条件：')), stage.id).toHaveLength(1);
      expect(b.objectives.some((l) => l.startsWith('失败条件：')), stage.id).toBe(true);
      expect(ev.some((e) => e.type === 'objective'), stage.id).toBe(true);
      expect(b.objectives.join(), stage.id).not.toMatch(/\(\d+, ?\d+\)|（\d+, ?\d+）/); // 不写坐标
    }
  });

  it('goals 和 objective 混用、或标志名剧本里没用到，编译就报错', () => {
    const base = withGoals[0];
    const mixed = { ...base, script: [{ on: 'start' as const, do: [['objective', 'x'] as [string, ...unknown[]]] }, ...base.script] };
    expect(() => compileStage(rt, mixed, files, { seed: 1 })).toThrow(/objective/);
    const typo = { ...base, goals: [...base.goals!, { if: 'no-such-flag', win: 'x' }] };
    expect(() => compileStage(rt, typo, files, { seed: 1 })).toThrow(/no-such-flag/);
  });

  it('提示按条件全列出来；胜负条件只取最后一个满足的', () => {
    const stage = rt.stages.find((s) => s.id === 'zhufu')!;
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    b.begin();
    expect(b.objectives.filter((l) => l.startsWith('胜利条件：'))).toHaveLength(1);
    const hints = b.objectives.filter((l) => l.startsWith('提示：'));
    expect(hints.some((l) => l.includes('割断绳索'))).toBe(true);
    expect(hints.some((l) => l.includes('劝降'))).toBe(true);
  });

  it('夜困清风山：陷坑在地图上标出来', () => {
    const stage = rt.stages.find((s) => s.id === 'yekun')!;
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    b.begin();
    expect(b.objectiveZones().some((z) => z.label === '陷坑')).toBe(true);
  });
});
