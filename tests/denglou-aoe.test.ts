// 孙立 病尉迟枪 LV1–4、顾大嫂 母大虫旋刀 LV1–4、孙新 双鞭齐下（负责人 2026-11-24：三人各有一招范围技）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { areaCells, castCells, learnedSkills, skillTags } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('登州诸人的范围技', () => {
  const d = loadPackFromDisk('mainline').data;
  const cls = (name: string) => d.classes.findIndex((c) => c?.skills?.some((s) => s.name.startsWith(name)));
  const tiers = (name: string) => d.classes[cls(name)].skills.filter((s) => s.name.startsWith(name));
  const board = new Board(40, 40), me = { x: 20, y: 20 };

  it('病尉迟枪四级：落点范围 5 / 9 / 13 / 21 格，射程 2 / 2 / 3 / 3，高级替换低级', () => {
    const t = tiers('病尉迟枪');
    expect(t.map((s) => s.learnLevel)).toEqual([8, 18, 28, 36]);
    t.forEach((s, i) => {
      expect(s.rangeMax).toBe([2, 2, 3, 3][i]);
      const cells = areaCells(board, me, s, { x: 20, y: 18 });
      expect(cells).toHaveLength([5, 9, 13, 21][i]);
      expect(cells).toContainEqual({ x: 20, y: 18 });
      expect(skillTags(s)).toContain('范围');
    });
    for (const level of [8, 20, 30, 40]) {
      const got = learnedSkills({ classId: cls('病尉迟枪'), level } as Unit, d).filter((s) => s.name.startsWith('病尉迟枪'));
      expect(got).toHaveLength(1);
      expect(got[0].learnLevel).toBe([8, 18, 28, 36].filter((n) => n <= level).pop());
    }
  });

  it('母大虫旋刀四级：以自己为中心 4 / 8 / 12 / 20 格，不含自己，标成回旋', () => {
    const t = tiers('母大虫旋刀');
    expect(t).toHaveLength(4);
    t.forEach((s, i) => {
      expect(castCells(board, me, [s.rangeMin, s.rangeMax])).toEqual([me]);
      const cells = areaCells(board, me, s, me);
      expect(cells).toHaveLength([4, 8, 12, 20][i]);
      expect(cells).not.toContainEqual(me);
      expect(skillTags(s)).toContain('回旋');
    });
  });

  it('孙新双鞭齐下打 T 字四格', () => {
    const s = d.classes[cls('双鞭齐下')].skills.find((s) => s.name === '双鞭齐下')!;
    expect(areaCells(board, me, s, { x: 20, y: 19 })).toHaveLength(4);
    expect(skillTags(s)).toContain('范围');
  });
});

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('杨雄 鬼头旋风刀', () => {
  it('以自己为中心打周围 8 格，标成回旋', () => {
    const d = loadPackFromDisk('mainline').data;
    const s = d.classes.flatMap((c) => c?.skills ?? []).find((s) => s.name === '鬼头旋风刀')!;
    const board = new Board(40, 40), me = { x: 20, y: 20 };
    expect(castCells(board, me, [s.rangeMin, s.rangeMax])).toEqual([me]);
    expect(areaCells(board, me, s, me)).toHaveLength(8);
    expect(skillTags(s)).toContain('回旋');
  });
});
