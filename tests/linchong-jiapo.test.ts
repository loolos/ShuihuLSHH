// 林沖 家破人亡LV2（负责人 2026-11-27）：十字两格 + 一二级都带小幅回体、防御
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { Board } from '../src/rules/board.ts';
import { areaCells, castRange, learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('林沖 家破人亡', () => {
  const d = loadPackFromDisk('mainline').data;
  const skills = d.classes[11].skills;
  const lv1 = skills.find((s) => s.name === '家破人亡')!, lv2 = skills.find((s) => s.name === '家破人亡LV2')!;

  it('LV2 打四个方向各两格（十字 8 格），以自身为中心', () => {
    const board = new Board(30, 30), c = { x: 10, y: 10 };
    const cells = areaCells(board, c, lv2, c);
    const expected = [1, 2].flatMap((n) => [{ x: 10 + n, y: 10 }, { x: 10 - n, y: 10 }, { x: 10, y: 10 + n }, { x: 10, y: 10 - n }]);
    expect(cells).toHaveLength(8);
    expect(cells).toEqual(expect.arrayContaining(expected));
    expect(castRange({ classId: 11, stats: { rangeBonus: 3 } } as Unit, lv2, d)).toEqual([0, 0]);
  });

  it('32 级学会，替换一级', () => {
    expect(learnedSkills({ classId: 11, level: 31 } as Unit, d).map((s) => s.name)).toContain('家破人亡');
    const at32 = learnedSkills({ classId: 11, level: 32 } as Unit, d).map((s) => s.name);
    expect(at32).toContain('家破人亡LV2');
    expect(at32).not.toContain('家破人亡');
  });

  it('一二级都带回体 + 防御增益，二级更高', () => {
    const get = (s: typeof lv1, stat: string) => s.selfBuffs!.find((b) => b.stat === stat)!.value;
    for (const s of [lv1, lv2]) expect(s.selfBuffs!.map((b) => b.stat).sort()).toEqual(['defense', 'regenHp']);
    expect(get(lv2, 'regenHp')).toBeGreaterThan(get(lv1, 'regenHp'));
    expect(get(lv2, 'defense')).toBeGreaterThan(get(lv1, 'defense'));
  });
});
