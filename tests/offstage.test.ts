// 全部 63 关：开场剧本跑完后，画在地图上的单位都站在有地面的格子里（不会悬在地图菱形外的黑底上）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('场外占位单位', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const data = has ? loadGameData(files, tr) : (null as never);
  const stages = has ? files.list('Map', '.map').map((p) => path.basename(p, '.map')).sort() : [];

  it('所有关卡开场后，在场单位都站在地面上', () => {
    expect(stages).toHaveLength(63);
    const bad: string[] = [];
    for (const s of stages) {
      const b = new Battle(loadStage(files, data, s, { simplified: true, seed: 1, text: tr }));
      b.begin();
      for (const u of b.units) if (u.present && !b.board.onGround(u.x, u.y)) bad.push(`${s} #${u.uid} ${u.name} (${u.x},${u.y})`);
    }
    expect(bad).toEqual([]);
  });

  it('Act9-1（沧州设毒计）：ACT 里摆在 (0,0) 的两条主角记录不登场，过场照常结束', () => {
    const b = new Battle(loadStage(files, data, 'Act9-1', { simplified: true, seed: 1, text: tr }));
    const ev = b.begin();
    const heroes = b.units.filter((u) => u.classId === 0);
    expect(heroes).toHaveLength(2);
    expect(heroes.every((u) => !u.present)).toBe(true);
    expect(ev.some((e) => e.type === 'end' && e.result === 'lost')).toBe(false);
  });
});
