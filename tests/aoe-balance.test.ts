import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { balanceHeroAoe, HERO_AOE_COSTS } from '../src/rules/aoe-balance.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')) )('群伤技能耗气审查', () => {
  const rt = loadPackFromDisk('mainline');
  it('最终载入的全部原版好汉技能使用审定耗气，且不改变敌方同号技能', () => {
    for (const [cls, costs] of Object.entries(HERO_AOE_COSTS)) {
      for (const [id, cost] of Object.entries(costs)) {
        const skill = rt.data.classes[Number(cls)].skills.find(s => s.skillId === Number(id));
        expect(skill, `${cls}/${id}`).toBeDefined();
        expect(skill!.mpCost, `${cls}/${skill!.name}`).toBe(cost);
      }
    }
    for (const cls of rt.data.classes.filter(c => c.id >= 18)) {
      for (const skill of cls.skills) expect(balanceHeroAoe(cls.id, skill)).toBe(skill);
    }
    expect(rt.data.classes[9].skills.find(s => s.skillId === 84)?.hitMod).toBe(15);
    const costs = rt.data.classes[12].skills.filter(s => s.skillId >= 107 && s.skillId <= 111).map(s => s.mpCost);
    expect(costs).toEqual([75, 100, 120, 140, 160]);
  });
  it('主线与江州的对应扩展技能同步，非审定技能保留', () => {
    for (const pack of ['mainline', 'jiangzhou']) {
      const p = loadPackFromDisk(pack);
      for (const [cls, name, cost] of [['wusong', '玉环鸳鸯脚', 55], ['huarong', '穿云贯日LV3', 60], ['huarong', '连珠飞星', 60]] as const) {
        expect(p.data.classes[p.classIds.get(cls)!].skills.find(s => s.name === name)?.mpCost).toBe(cost);
      }
    }
  });
});
