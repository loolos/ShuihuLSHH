// 扩展包里上过我方阵营的人物都要标 hero，好汉技能不扣命中的规则才生效（heroSkillNoHitMod，负责人 2026-11-22）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../packs/mainline');
const pack = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));

/** 关卡里所有带 class 和 side 的对象（开场单位和剧本里增援、入队的） */
function sides(node: unknown, out: Map<string, Set<string>>) {
  if (Array.isArray(node)) for (const x of node) sides(x, out);
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.class === 'string' && typeof o.side === 'string') {
      if (!out.has(o.class)) out.set(o.class, new Set());
      out.get(o.class)!.add(o.side);
    }
    for (const v of Object.values(o)) sides(v, out);
  }
}

describe('扩展包好汉标记', () => {
  it('上过我方的扩展包人物都标了 hero', () => {
    const seen = new Map<string, Set<string>>();
    for (const s of pack.stages) sides(JSON.parse(fs.readFileSync(path.join(dir, s), 'utf8')), seen);
    const missing = pack.classes.filter((c: { id: string; hero?: boolean }) => !c.hero && seen.get(c.id)?.has('player')).map((c: { id: string }) => c.id);
    expect(missing).toEqual([]);
  });
});

import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { isHeroClass } from '../src/rules/data.ts';

describe.skipIf(!fs.existsSync(path.resolve(import.meta.dirname, '../gamedata/tables')))('好汉技能没有负面修正', () => {
  it('好汉（原版 0–17、杜遷、宋萬、包里标 hero 的）技能不扣命中、不扣必杀、不带敌兵固定伤害系数', () => {
    const rt = loadPackFromDisk('mainline');
    const heroes = new Set(pack.classes.filter((c: { hero?: boolean }) => c.hero).map((c: { id: string }) => rt.classIds.get(c.id)));
    const bad: string[] = [];
    for (const c of rt.data.classes) {
      if (!c || !(isHeroClass(c.id) || heroes.has(c.id))) continue;
      for (const s of c.skills) if (s.hitMod < 0 || s.critMod < 0 || s.damageScale !== undefined && s.damageScale < 1 || s.volley) bad.push(`${c.name}/${s.name}`);
    }
    expect(bad).toEqual([]);
  });
});
