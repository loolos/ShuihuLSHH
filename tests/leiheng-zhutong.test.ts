// 第三十四章过场「美髯公误失小衙内」（docs/game-design.md §15.35）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('美髯公误失小衙内', () => {
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = rt.stages.find((s) => s.id === 'leiheng-zhutong')!;

  it('接在扑天雕李应上山之后；单位站位可通行、不重叠，走位终点也可通行；开场演完就过关，朱仝、吴用登场', () => {
    expect(chapterOf('mainline/leiheng-zhutong')).toBe(34);
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), u.id).toBe(true);
      expect(seen.has(`${u.x},${u.y}`), `${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    const raw = JSON.parse(fs.readFileSync(path.join('packs/mainline/stages/leiheng-zhutong.json'), 'utf8'));
    for (const s of raw.script[0].do) if (s[0] === 'move') expect(b.board.passable(s[2], s[3]), `${s[1]} → ${s[2]},${s[3]}`).toBe(true);
    b.begin();
    expect(b.status).toBe('won');
    for (const id of ['zhutong', 'wuyong', 'leiheng']) expect(b.units[stage.units.findIndex((u) => u.id === id)].present, id).toBe(true);
  });
});
