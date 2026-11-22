import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import { attackParts, baseDamage, rangedFactor } from '../src/rules/combat.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('单体技能数值修订',()=>{
 const rt=loadPackFromDisk('mainline'),data=rt.data;
 it('指定威力耗气命中段数逐一生效，总权重为100，单体范围及异常不变',()=>{
  for(const [cls,id,power,mp,hit,count] of [
   // 好汉技能不带命中修正：原定的命中加成按每 4 点 +1 折进威力（如 100 / +30 → 108 / 0）
   [0,7,108,80,0,3],[2,20,33,40,0,3],[3,40,108,65,0,6],
   [3,33,28,15,0,1],[3,34,50,35,0,2],[3,35,73,55,0,3],
   [7,65,33,20,0,2],[7,66,43,35,0,3],[7,67,53,40,0,4],
   [8,74,43,40,0,3],[17,146,63,40,0,2],[11,99,108,55,0,3],
   [14,123,110,80,0,4],[16,138,88,70,0,3],[10,1007,28,30,0,3],[12,106,68,50,0,5],[5,56,68,40,0,4],
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
 for(const pack of ['mainline'])it(`${pack}武松三阶8/18/28级，最高阶替换，不改变其他技能`,()=>{
  const r=loadPackFromDisk(pack),id=r.classIds.get('wusong')!,skills=r.data.classes[id].skills.filter(s=>s.name.startsWith('擒虎镇岳'));
  expect(skills).toHaveLength(3);expect(skills.map(s=>s.learnLevel)).toEqual([8,18,28]);expect(skills.map(s=>s.power)).toEqual([53,65,78]);expect(skills.map(s=>s.hitMod)).toEqual([0,0,0]);expect(skills.map(s=>s.mpCost)).toEqual([40,50,60]);expect(skills.map(s=>attackParts(s).length)).toEqual([3,4,5]);
  const u={classId:id,level:1}as Unit;for(let level=1;level<=31;level++){u.level=level;const tier=[8,18,28].filter(n=>n<=level).length,available=learnedSkills(u,r.data).filter(s=>s.name.startsWith('擒虎镇岳'));expect(available).toHaveLength(tier?1:0);if(tier)expect(available[0].name).toBe(`擒虎镇岳LV${tier}`);}
  for(const s of skills){expect(s).toMatchObject({rangeMin:1,rangeMax:1,area:1,stun:30,critMod:5,soundId:154});expect(s.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);}
 });
 it('监守自盗1/2/3段、耗气30、命中10/20/30 折成威力；杜迁四段+40，隔山打虎不分级',()=>{
  for(const [i,id]of [48,49,50].entries()){const s=data.classes[4].skills.find(s=>s.skillId===id)!;expect(s).toMatchObject({mpCost:30,hitMod:0,power:[43,55,68][i],poison:10+i*5,critMod:30,rangedDamage:[1,.6]});expect(attackParts(s)).toHaveLength(i+1);expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);}
  const d=data.classes[69].skills.find(s=>s.skillId===203)!;expect(d).toMatchObject({mpCost:40,power:20,hitMod:40,critMod:5,stun:15});expect(attackParts(d)).toHaveLength(4);
  const g=data.classes[0].skills.filter(s=>s.name.startsWith('隔山打虎'));expect(g).toHaveLength(1);expect(g[0]).toMatchObject({name:'隔山打虎',learnLevel:2,power:70,mpCost:30,hitMod:0});expect(attackParts(g[0])).toHaveLength(4);
  for(const pack of ['mainline']){const r=loadPackFromDisk(pack),c=r.data.classes[r.classIds.get('qinming')!];expect(c.skills.find(s=>s.name==='当头一棒')).toMatchObject({mpCost:40,power:50,stun:30});}
 });
 it('杨春灵蛇吐信近远及射程加成均不衰减，保留原耗气威力与中毒',()=>{
  const s=data.classes.flatMap(c=>c.skills).find(s=>s.skillId===1004)!;
  expect(s).toMatchObject({type:10,rangeMax:8,mpCost:25,power:20,poison:30,damageScale:1});
  const actor={classId:13,x:10,y:10,facing:0,stats:{attack:150,crit:0,rangeBonus:0}}as Unit;
  for(const bonus of [0,2]){
   actor.stats.rangeBonus=bonus;
   const damages=[];
   for(const d of [1,4,8+bonus]){
    const target={...actor,y:10-d,stats:{...actor.stats,defense:100}};
    expect(rangedFactor(actor,target,s)).toBe(1);damages.push(baseDamage(actor,target,s));
   }
   for(const damage of damages)expect(damage).toEqual(damages[0]);
  }
 });
 it('敌方同源技能不套用好汉的新命中威力和段数',()=>{
  for(const c of data.classes.filter(c=>c.id>=18&&c.id<69))for(const s of c.skills){
   if(s.skillId===20)expect(s.hits).toHaveLength(1);
   if([65,66,67].includes(s.skillId))expect(s.hits).toHaveLength(1);
  }
 });
});
