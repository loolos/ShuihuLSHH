// 朱仝、雷横技能重做（负责人 2026-11-27）：和其他长期好汉一样有单体技、回气技、范围技，主要技能分级到 40 多级（§15.11）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { isChargeSkill, learnedSkills } from '../src/rules/skills.ts';
import { statAt } from '../src/rules/growth.ts';
import type { Unit } from '../src/rules/unit.ts';

const available = fs.existsSync(path.join(DATA, 'Data/Human.hum'));
describe.skipIf(!available)('朱仝、雷横技能', () => {
  const main = loadPackFromDisk('mainline');
  const PLAN: Record<string, { single: string[]; aoe: string[]; charge: string }> = {
    zhutong: { single: ['美髯拖刀', '美髯拖刀LV2', '美髯拖刀LV3'], aoe: ['长髯偃月', '长髯偃月LV2', '长髯偃月LV3', '长髯偃月LV4', '千里流光', '千里流光LV2'], charge: '浩然养气' },
    leiheng: { single: ['风雷振翮', '风雷振翮LV2', '风雷振翮LV3', '怒枷击'], aoe: ['横江断流', '横江断流LV2', '横江断流LV3', '插翅飞涧', '插翅飞涧LV2', '插翅飞涧LV3'], charge: '敛翼息风' },
  };
  const cells = (s: { type: number; area: number; areaPattern?: readonly unknown[] }) => s.areaPattern?.length ?? (s.type === 12 ? 8 : s.type === 13 ? 3 : s.type === 14 ? 3 * s.area : s.area);

  it('单体技打一人、范围技打多格、回气技回半条气并带 5 回合增益；耗气不超过学会那一级的气上限', () => {
    for (const [k, p] of Object.entries(PLAN)) {
      const cls = main.data.classes[main.classIds.get(k)!];
      const get = (n: string) => cls.skills.find((s) => s.name === n)!;
      for (const n of [...p.single, ...p.aoe]) {
        const s = get(n);
        expect(s, `${k} ${n}`).toBeDefined();
        expect(s.mpCost).toBeLessThanOrEqual(statAt(cls, 'mp', s.learnLevel));
        expect(s.hits.reduce((a, h) => a + h.percent, 0)).toBe(100);
        expect(s.hitMod).toBeGreaterThanOrEqual(0);
      }
      for (const n of p.single) expect(cells(get(n)), n).toBe(1);
      for (const n of p.aoe) expect(cells(get(n)), n).toBeGreaterThanOrEqual(3);
      const c = get(p.charge);
      expect(isChargeSkill(c)).toBe(true);
      expect(c.selfBuffs?.[0]?.turns).toBe(5);
    }
  });

  it('同名高阶替换低阶，分级逐档变强；入队（30 级）就有单体、回气、范围三类', () => {
    for (const [k, p] of Object.entries(PLAN)) {
      const id = main.classIds.get(k)!;
      const at = (level: number) => learnedSkills({ classId: id, level } as Unit, main.data).map((s) => s.name);
      const top = at(50);
      expect(new Set(top.map((n) => n.replace(/LV\d+$/, ''))).size).toBe(top.length);
      const all = main.data.classes[id].skills;
      for (const line of [p.single, p.aoe]) {
        const byBase = new Map<string, typeof all>();
        for (const n of line) {
          const s = all.find((x) => x.name === n)!;
          const b = n.replace(/LV\d+$/, '');
          byBase.set(b, [...(byBase.get(b) ?? []), s]);
        }
        for (const tiers of byBase.values()) {
          expect(top).toContain(tiers.at(-1)!.name);
          for (let i = 1; i < tiers.length; i++) {
            expect(tiers[i].learnLevel).toBeGreaterThan(tiers[i - 1].learnLevel);
            expect(tiers[i].power).toBeGreaterThan(tiers[i - 1].power);
          }
        }
      }
      const at30 = at(30);
      expect(at30.some((n) => p.single.includes(n))).toBe(true);
      expect(at30.some((n) => p.aoe.includes(n))).toBe(true);
      expect(at30).toContain(p.charge);
    }
  });
});
