import { areaCells, learnedSkills } from '../src/rules/skills.ts';
import { attackParts } from '../src/rules/combat.ts';
import { Board } from '../src/rules/board.ts';
import type { Unit } from '../src/rules/unit.ts';
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
  for(const pack of ['mainline','jiangzhou'])it(`${pack}万夫莫敌四阶数值、段数、范围及28级替换正确`,()=>{
    const d=loadPackFromDisk(pack).data;
    const tiers=d.classes[0].skills.filter(s=>[10,11,12,1309].includes(s.skillId));expect(tiers).toHaveLength(4);
    tiers.forEach((s,i)=>{
      expect(s).toMatchObject({learnLevel:[8,12,22,28][i],mpCost:[75,115,170,210][i],power:35+10*i,critMod:20+5*i,hitMod:5+5*i,type:1,area:5+i,poison:0,stun:0});
      expect(attackParts(s)).toHaveLength(i<2?1:2);expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);
      for(const [dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]])expect(areaCells(new Board(40,40),{x:20,y:20},s,{x:20+dx,y:20+dy})).toHaveLength([13,18,25,32][i]);
    });
    for(let level=1;level<=30;level++){
      const skills=learnedSkills({classId:0,level}as Unit,d).filter(s=>s.name.startsWith('萬夫莫敵'));
      const tier=[8,12,22,28].filter(n=>n<=level).length;expect(skills).toHaveLength(tier?1:0);if(tier)expect(skills[0]).toBe(tiers[tier-1]);
    }
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
