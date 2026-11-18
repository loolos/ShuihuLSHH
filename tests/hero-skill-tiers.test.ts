import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { learnedSkills, skillsLearnedAt } from '../src/rules/skills.ts';
import { baseDamage } from '../src/rules/combat.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('黑虎偷心与生不如死三级',()=>{
 const data=loadPackFromDisk('jiangzhou').data;
 for(const [cls,name,levels,powers,costs,counts]of [
  [13,'黑虎偷心',[8,20,28],[40,55,75],[20,40,65],[2,3,4]],
  [9,'生不如死',[24,27,30],[40,60,80],[20,45,75],[3,4,5]],
 ]as const){
  it(`${name}原等级起逐阶替换，威力/耗气/段数递增且范围不变`,()=>{
   const skills=data.classes[cls].skills.filter(s=>s.name.startsWith(name));expect(skills).toHaveLength(3);
   expect(skills.map(s=>s.learnLevel)).toEqual(levels);expect(skills.map(s=>s.power)).toEqual(powers);expect(skills.map(s=>s.mpCost)).toEqual(costs);expect(skills.map(s=>s.hits.length)).toEqual(counts);
   const u={classId:cls,level:1,x:10,y:10,facing:0,side:'player',stats:{attack:150,crit:10,rangeBonus:0}}as Unit;
   const t={...u,x:10,y:9,stats:{...u.stats,defense:100}};
   let damage=0;
   for(let level=1;level<=31;level++){
    u.level=level;const available=learnedSkills(u,data).filter(s=>s.name.startsWith(name));const tier=levels.filter(n=>n<=level).length;
    expect(available).toHaveLength(tier?1:0);if(tier)expect(available[0].name).toBe(`${name}LV${tier}`);
   }
   for(const s of skills){expect(s).toMatchObject({type:6,rangeMin:1,rangeMax:2,area:1,group:1,hitMod:0,critMod:10});expect(s.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);expect(Math.max(...s.hits.map(h=>h.frame))).toBe(cls===13?23:28);expect(s.soundId).toBe(cls===13?115:81);expect(skillsLearnedAt(u,data,s.learnLevel)).toContain(s);const n=baseDamage(u,t,s)[0];expect(n).toBeGreaterThan(damage);damage=n;}
  });
 }
 it('敌方阮小七和陈达同源技能不分级，不添加高级招式',()=>{
  expect(data.classes[52].skills.find(s=>s.skillId===81)!.hits).toHaveLength(1);
  for(const c of data.classes.filter(c=>c.id>=18))expect(c.skills.some(s=>s.skillId>=1300&&s.skillId<=1303)).toBe(false);
 });
});
