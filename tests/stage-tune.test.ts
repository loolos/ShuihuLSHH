// 后期关卡加难度（src/rules/stage-tune.ts，docs/game-design.md §9.3）：追加的敌人、增援区块、提前的增援回合。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { key } from '../src/rules/board.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { STAGE_TUNE } from '../src/rules/stage-tune.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('后期关卡加敌人 / 提前增援', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const data = has ? loadGameData(files, tr) : (null as never);
  const load = (s: string) => loadStage(files, data, s, { simplified: true, seed: 1, text: tr });
  const enemies = (s: string) => load(s).units.filter((u) => u.side === 'enemy').length;
  // 原版 ACT 敌人数 → 加完以后
  const COUNTS: Record<string, [number, number]> = { 'N-add14': [52, 60], N12: [59, 69], N13: [49, 59], 'N-add16': [46, 56], N14: [87, 87] };

  it('敌人数', () => {
    for (const [s, [, after]] of Object.entries(COUNTS)) expect(enemies(s), s).toBe(after);
    expect(Object.keys(STAGE_TUNE).sort()).toEqual(Object.keys(COUNTS).map((s) => s.toLowerCase()).sort());
  });

  it('追加的敌人站在可通行的空格上，编号和编组号不重复', () => {
    for (const s of Object.keys(COUNTS)) {
      const input = load(s);
      const n = COUNTS[s][1] - COUNTS[s][0];
      const old = input.units.slice(0, input.units.length - n), added = input.units.slice(input.units.length - n);
      const cells = new Set(old.filter((u) => u.side !== 'unknown').map((u) => key(u.x, u.y)));
      const groups = new Set(old.map((u) => u.group));
      const ids = new Set(old.map((u) => u.index));
      for (const u of added) {
        expect(input.board.passable(u.x, u.y), `${s} (${u.x},${u.y})`).toBe(true);
        expect(cells.has(key(u.x, u.y)) || groups.has(u.group) || ids.has(u.index), `${s} (${u.x},${u.y})`).toBe(false);
        cells.add(key(u.x, u.y));
        groups.add(u.group);
        ids.add(u.index);
      }
      // 原版、简体两份剧本区块一一对应
      expect(input.displayBlocks?.length, s).toBe(input.blocks.length);
    }
  });

  it('增援在指定回合登场，并提示"敌军增援了！"', () => {
    for (const [s, t] of Object.entries(STAGE_TUNE)) {
      const name = Object.keys(COUNTS).find((k) => k.toLowerCase() === s)!;
      const b = new Battle(load(name));
      b.begin();
      const turns = (t.add ?? []).filter((g) => g.turn);
      const present = () => b.units.filter((u) => u.side === 'enemy' && u.alive && u.present).length;
      for (const g of turns) {
        const n = g.units.reduce((a, u) => a + u.n, 0);
        const before = present();
        const ev = (b as unknown as { runTurnTriggers(p: number): void; flush(): { type: string; text?: string }[] });
        ev.runTurnTriggers(g.turn! - 1);
        const out = ev.flush();
        expect(present() - before, `${name} 第 ${g.turn} 回合`).toBeGreaterThanOrEqual(n);
        expect(out.some((e) => e.type === 'say' && e.text === '敌军增援了！'), name).toBe(true);
        expect(b.status, name).toBe('playing');
      }
    }
  });

  it('N14 两波增援提前到第 4、8 回合', () => {
    const turns = load('N14').blocks.filter((b) => b.trigger.kind === 'turn').map((b) => (b.trigger as { turn: number }).turn + 1);
    expect(turns).toEqual([1, 4, 8, 51]);
  });
});
