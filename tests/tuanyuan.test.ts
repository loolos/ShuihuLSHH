// 第二十六章末的过场「父子团圆」（docs/game-design.md §15.28.4）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('父子团圆', () => {
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = rt.stages.find((s) => s.id === 'tuanyuan')!;

  it('接在还道村之后；单位站在可通行的格子上、互不重叠；开场演完就过关，公孙胜离场', () => {
    expect(chapterOf('mainline/tuanyuan')).toBe(26);
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), u.id).toBe(true);
      expect(seen.has(`${u.x},${u.y}`), `${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    b.begin();
    expect(b.status).toBe('won');
    expect(b.units[stage.units.findIndex((u) => u.id === 'gongsunsheng')].present).toBe(false);
    expect(b.units[stage.units.findIndex((u) => u.id === 'songtaigong')].present).toBe(true);
  });
});
