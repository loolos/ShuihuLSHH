import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import { attackParts, baseDamage } from '../src/rules/combat.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('单体技能数值修订',()=>{
 const rt=loadPackFromDisk('jiangzhou'),data=rt.data;
 it('指定威力耗气命中段数逐一生效，总权重为100，单体范围及异常不变',()=>{
  for(const [cls,id,power,mp,hit,count] of [
   [0,7,100,80,30,3],[2,20,30,40,10,3],[3,40,100,65,30,6],
   [3,33,25,15,10,1],[3,34,45,35,20,2],[3,35,65,55,30,3],
   [7,65,30,20,10,2],[7,66,40,35,10,3],[7,67,50,40,10,4],
   [8,74,40,40,10,3],[17,146,55,40,30,2],[11,99,100,55,30,3],
   [14,123,100,80,40,4],[16,138,80,50,30,3],[10,1007,25,30,10,3],[12,106,60,50,30,5],[5,56,60,20,30,4],
  ]){
   const s=data.classes[cls].skills.find(s=>s.skillId===id)!;
   expect(s).toMatchObject({power,mpCost:mp,hitMod:hit,area:1});expect(attackParts(s)).toHaveLength(count);
   expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);
   const u={classId:cls,x:10,y:10,facing:0,stats:{attack:150,crit:10,rangeBonus:0}}as Unit;
   const target={...u,x:10,y:9,stats:{...u.stats,defense:100}};
   expect(baseDamage(u,target,s)).toEqual(baseDamage(u,target,{...s,hits:[{frame:1,percent:100,dir:0}]}));
  }
  expect(data.classes[14].skills.find(s=>s.skillId===123)).toMatchObject({critMod:50,stun:15});
  expect(data.classes[12].skills.find(s=>s.skillId===106)).toMatchObject({critMod:40,stun:10});
  expect(data.classes[10].skills.find(s=>s.skillId===1007)).toMatchObject({stun:60,critMod:5,learnLevel:24});
  expect(data.classes[16].skills.find(s=>s.skillId===138)).toMatchObject({stun:40});
  const z=data.classes[rt.classIds.get('zhangshun')!].skills.find(s=>s.name==='浪里钻')!;expect(z.mpCost).toBe(45);
 });
 for(const pack of ['mainline','jiangzhou'])it(`${pack}武松三阶8/18/28级，最高阶替换，不改变其他技能`,()=>{
  const r=loadPackFromDisk(pack),id=r.classIds.get('wusong')!,skills=r.data.classes[id].skills.filter(s=>s.name.startsWith('擒虎镇岳'));
  expect(skills).toHaveLength(3);expect(skills.map(s=>s.learnLevel)).toEqual([8,18,28]);expect(skills.map(s=>s.power)).toEqual([50,60,70]);expect(skills.map(s=>s.hitMod)).toEqual([10,20,30]);expect(skills.map(s=>s.mpCost)).toEqual([40,50,60]);expect(skills.map(s=>attackParts(s).length)).toEqual([3,4,5]);
  const u={classId:id,level:1}as Unit;for(let level=1;level<=31;level++){u.level=level;const tier=[8,18,28].filter(n=>n<=level).length,available=learnedSkills(u,r.data).filter(s=>s.name.startsWith('擒虎镇岳'));expect(available).toHaveLength(tier?1:0);if(tier)expect(available[0].name).toBe(`擒虎镇岳LV${tier}`);}
  for(const s of skills){expect(s).toMatchObject({rangeMin:1,rangeMax:1,area:1,stun:30,critMod:5,soundId:154});expect(s.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);}
 });
 it('敌方同源技能不套用好汉的新命中威力和段数',()=>{
  for(const c of data.classes.filter(c=>c.id>=18&&c.id<69))for(const s of c.skills){
   if(s.skillId===20)expect(s.hits).toHaveLength(1);
   if([65,66,67].includes(s.skillId))expect(s.hits).toHaveLength(1);
  }
 });
});
