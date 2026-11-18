import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DATA } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { learnedSkills, skillsLearnedAt } from '../src/rules/skills.ts';
import { attackParts, baseDamage, rollAttack } from '../src/rules/combat.ts';
import { Rng } from '../src/rules/rng.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('武龙九死一生三级',()=>{
 const data=loadPackFromDisk('jiangzhou').data;
 const tiers=data.classes[0].skills.filter(s=>s.name.startsWith('九死一生'));
 it('8/20/28级依次替换旧阶，数值和3/4/5段均按确认方案',()=>{
  expect(tiers).toHaveLength(3);expect(tiers.map(s=>s.skillId)).toEqual([3,1304,1305]);
  expect(tiers.map(s=>s.learnLevel)).toEqual([8,20,28]);expect(tiers.map(s=>s.power)).toEqual([40,60,80]);expect(tiers.map(s=>s.mpCost)).toEqual([30,40,50]);expect(tiers.map(s=>s.hitMod)).toEqual([20,30,40]);expect(tiers.map(s=>s.stun)).toEqual([15,20,25]);expect(tiers.map(s=>attackParts(s).length)).toEqual([3,4,5]);
  const u={classId:0,level:1}as Unit;
  for(let level=1;level<=31;level++){u.level=level;const n=[8,20,28].filter(v=>v<=level).length;const selected=learnedSkills(u,data).filter(s=>s.name.startsWith('九死一生'));expect(selected).toHaveLength(n?1:0);if(n)expect(selected[0]).toBe(tiers[n-1]);}
  for(const s of tiers){expect(s).toMatchObject({type:7,rangeMin:1,rangeMax:1,area:1,critMod:25,poison:0,group:2,soundId:3,hidden:false});expect(s.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);expect(Math.max(...s.hits.map(h=>h.frame))).toBe(20);expect(skillsLearnedAt(u,data,s.learnLevel)).toContain(s);}
 });
 it('三级单体实战扣除50气、五段分摊，昏迷每个目标只判一次',()=>{
  const b=new Battle({name:'nine',board:new Board(10,10),data,blocks:[],seed:1,units:[
   {index:0,type:0,level:28,side:'player',group:1,x:4,y:4,facing:0,flags:0,extra:[0,0,0],items:[],raw:[]},
   {index:1,type:32,level:28,side:'enemy',group:2,x:4,y:3,facing:2,flags:0,extra:[0,0,0],items:[],raw:[]},
  ]});b.begin();const [u,t]=b.units;u.mp=100;t.hp=t.stats.maxHp=10000;
  const s=tiers[2];expect(b.skillArea(u,s,t)).toEqual([{x:4,y:3}]);
  const rng=new Rng(1);vi.spyOn(rng,'next').mockReturnValue(.5);const chance=vi.spyOn(rng,'chance');const result=rollAttack(u,t,{...s,critMod:-999},rng,true);
  expect(chance.mock.calls.filter(([rate])=>rate===25)).toHaveLength(1);expect(result.parts).toHaveLength(5);expect(result.damage).toBe(result.parts.reduce((n,v)=>n+v,0));
  expect(baseDamage(u,t,s)).toEqual(baseDamage(u,t,{...s,hits:[{frame:1,percent:100,dir:0}]}));
  const events=b.useSkill(u,s,t);expect(events.some(e=>e.type==='attack'&&e.hits[0].result.parts.length===5)).toBe(true);expect(u.mp).toBe(50);expect(u.acted).toBe(true);
 });
 it('隔山打虎保持原单阶和四段，其他职业不新增九死升级',()=>{
  const skills=data.classes[0].skills.filter(s=>s.name.startsWith('隔山打虎'));expect(skills).toHaveLength(1);expect(skills[0]).toMatchObject({skillId:8,name:'隔山打虎',learnLevel:2,power:60,mpCost:30,hitMod:40,critMod:50});expect(attackParts(skills[0])).toHaveLength(4);
  for(const c of data.classes.filter(c=>c.id!==0))expect(c.skills.some(s=>s.skillId===1304||s.skillId===1305)).toBe(false);
 });
});
