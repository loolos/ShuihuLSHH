// N13（诱敌蓼儿洼）：伏兵只看回合数——第 11 回合开始时登场，与何涛位置无关；胜利条件后面补回合提示。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('N13 诱敌深入', () => {
  it('第 11 回合开始时伏兵登场，胜利条件带回合提示', () => {
    const files = new NodeFiles(DATA);
    const tr = buildT2S(files);
    const data = loadGameData(files, tr);
    const b = new Battle(loadStage(files, data, 'N13', { simplified: true, seed: 1, text: tr }));
    // 阮氏兄弟不会战败，这样只验证回合触发
    const kill = (b as unknown as { kill: (...a: unknown[]) => void }).kill.bind(b);
    (b as unknown as { kill: (...a: unknown[]) => void }).kill = (u, t, d) => {
      if ((t as { side: string }).side === 'player') return void ((t as { hp: number }).hp = 1);
      kill(u, t, d);
    };
    b.begin();
    expect(b.objectives.some((l) => l.includes('引诱何涛深入蓼儿洼') && l.includes('第 11 回合'))).toBe(true);
    const heroes = () => b.units.filter((u) => u.side === 'player' && u.present).length;
    expect(heroes()).toBe(2);
    while (b.turn < 10) b.endPlayerPhase();
    expect(b.status).toBe('playing');
    expect(heroes()).toBe(2);
    b.endPlayerPhase();
    expect(b.turn).toBe(11);
    expect(heroes()).toBe(16);
    expect(b.objectives.some((l) => l.includes('打败所有敌人') && !l.includes('回合，'))).toBe(true);
  });
});
