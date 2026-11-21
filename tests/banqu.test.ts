// 第二十六章「还道村受天书」之前的小关「搬取宋太公」（docs/game-design.md §15.28.3）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('搬取宋太公', () => {
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = rt.stages.find((s) => s.id === 'banqu')!;
  const open = () => {
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    b.begin();
    return { b, get: (id: string) => b.units[stage.units.findIndex((u) => u.id === id)] };
  };

  it('在还道村之前；单位站在可通行的格子上、互不重叠；十回合', () => {
    expect(chapterOf('mainline/banqu')).toBe(26);
    const { b } = open();
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), u.id).toBe(true);
      expect(seen.has(`${u.x},${u.y}`), `${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    expect(b.turnLimit).toBe(10);
  });

  it('第 3、4、5 回合三伙土兵赶到；都到了以后打光才过关', () => {
    const { b, get } = open();
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.ai.mode = 8;
    expect(get('c1').present).toBe(false);
    for (let t = 1; t < 5 && b.status === 'playing'; t++) b.endPlayerPhase();
    expect(get('c1').present).toBe(true);
    expect(get('d1').present).toBe(true);
    expect(get('e1').present).toBe(true);
    for (const u of b.units.filter((x) => x.side === 'enemy')) { u.hp = 0; u.alive = false; u.present = false; }
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('won');
  });
});
