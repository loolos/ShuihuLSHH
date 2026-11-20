// 吕方、郭盛的戟法与张横、张顺的新技能（负责人 2026-11-20，docs/game-design.md §15.24.1）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { areaCells, castCells, castRange, learnedSkills } from '../src/rules/skills.ts';
import { attackRange, type Unit } from '../src/rules/unit.ts';
import { Board } from '../src/rules/board.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('吕方、郭盛、张横、张顺的技能', () => {
  const rt = loadPackFromDisk('mainline');
  const cls = (id: string) => rt.data.classes[rt.classIds.get(id)!];
  const board = new Board(11, 11, new Uint8Array(121));
  const me = { x: 5, y: 5 };
  const unit = (id: string, level = 30) => ({ classId: rt.classIds.get(id)!, level, stats: { rangeBonus: 0 } }) as unknown as Unit;
  const key = (c: { x: number; y: number }) => `${c.x - me.x},${c.y - me.y}`;

  it('吕方、郭盛：普攻两段、射程 1–2；画戟挑四段，打选中的人和他身后一人；回旋各不同', () => {
    for (const id of ['lvfang', 'guosheng']) {
      const [atk, tiao, spin] = cls(id).skills;
      expect(atk.hits.map((h) => h.percent), id).toEqual([50, 50]);
      expect(attackRange(unit(id), rt.data)).toEqual([1, 2]);
      expect(tiao.hits).toHaveLength(4);
      expect(castRange(unit(id), tiao, rt.data)).toEqual([1, 2]);
      expect(areaCells(board, me, tiao, { x: 5, y: 3 }).map(key)).toEqual(['0,-2', '0,-3']);
      expect(learnedSkills(unit(id), rt.data)).toContain(spin);
    }
    const ring = cls('lvfang').skills[2], cross = cls('guosheng').skills[2];
    expect(castCells(board, me, castRange(unit('lvfang'), ring, rt.data))).toEqual([me]);
    expect(areaCells(board, me, ring, me).map(key).sort()).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0', '1,1']);
    expect(areaCells(board, me, cross, me).map(key).sort()).toEqual(['-1,0', '-2,0', '0,-1', '0,-2', '0,1', '0,2', '1,0', '2,0']);
    // 吕方重必杀，郭盛重命中带昏迷
    expect(cls('lvfang').skills[1].critMod).toBeGreaterThan(cls('guosheng').skills[1].critMod);
    expect(cls('guosheng').skills[1].hitMod).toBeGreaterThan(cls('lvfang').skills[1].hitMod);
    expect(cls('guosheng').skills[1].stun).toBeGreaterThan(0);
  });

  it('张横补直线破阵和回气，张顺补周身水劲；原有技能保留', () => {
    expect(cls('zhangheng').skills.map((s) => s.name)).toEqual(['船叉', '掷叉', '断江飞叉', '撑篙歇气']);
    const po = cls('zhangheng').skills[2];
    expect(areaCells(board, me, po, { x: 5, y: 3 }).map(key)).toEqual(['0,-1', '0,-2', '0,-3', '0,-4']);
    expect(cls('zhangheng').skills[3].type).toBe(8);
    expect(cls('zhangshun').skills.map((s) => s.name)).toEqual(['分水刀', '浪里钻', '换气', '白条翻浪']);
    expect(areaCells(board, me, cls('zhangshun').skills[3], me)).toHaveLength(8);
  });
});
