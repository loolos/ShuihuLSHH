import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import { baseDamage, rangedFactor, rollAttack } from '../src/rules/combat.ts';
import { Rng } from '../src/rules/rng.ts';
import { areaCells, castRange, learnedSkills } from '../src/rules/skills.ts';
import { LATE_HERO_SKILLS } from '../src/rules/late-hero-skills.ts';
import type { ActUnit } from '../src/formats/act.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(`${DATA}/Data/Human.hum`))('后期好汉技能',()=>{
 const rt=loadPackFromDisk('jiangzhou'),data=rt.data,board=new Board(30,30);
 const act=(index:number,type:number,side:ActUnit['side'],x:number,y:number):ActUnit=>({index,type,side,x,y,level:30,group:index+1,flags:0,facing:0,extra:[0,0,0],items:[0,0,0,0,0,0,0],raw:[]});
 it('14招在指定等级解锁，射程不因装备改变，每招2至5段且权重100%',()=>{
  for(const [i,e]of LATE_HERO_SKILLS.entries()){
   const skill=data.classes[e.cls].skills.find(s=>s.skillId===1200+i)!;
   const b=new Battle({name:'test',board,units:[act(0,e.cls,'player',10,10)],blocks:[],data,seed:1});b.begin();const u=b.units[0];
   u.level=e.level-1;expect(learnedSkills(u,data)).not.toContain(skill);u.level=e.level;expect(learnedSkills(u,data)).toContain(skill);
   u.stats.rangeBonus=4;expect(castRange(u,skill,data)).toEqual(e.range);expect(skill.hits.length).toBeGreaterThanOrEqual(2);expect(skill.hits.length).toBeLessThanOrEqual(5);expect(skill.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);
   for(const at of [{x:10,y:5},{x:5,y:10},{x:10,y:15},{x:15,y:10}]){
    const cells=areaCells(board,u,skill,at);expect(cells).toHaveLength(skill.areaPattern!.length);expect(new Set(cells.map(c=>`${c.x},${c.y}`)).size).toBe(cells.length);expect(rangedFactor(u,{...u,...at},skill)).toBe(1);
   }
  }
 });
 it('阮小二工字七格随四向旋转，朱武空心八格不含中心',()=>{
  const r=data.classes[7].skills.find(s=>s.name==='分水穿浪')!,z=data.classes[5].skills.find(s=>s.name==='破阵飞石')!;
  expect(areaCells(board,{x:10,y:15},r,{x:10,y:10}).map(c=>`${c.x},${c.y}`).sort()).toEqual(['10,10','9,9','9,10','9,11','11,9','11,10','11,11'].sort());
  expect(areaCells(board,{x:5,y:10},r,{x:10,y:10}).map(c=>`${c.x},${c.y}`).sort()).toEqual(['10,10','9,9','10,9','11,9','9,11','10,11','11,11'].sort());
  const cells=areaCells(board,{x:10,y:15},z,{x:10,y:10});expect(cells).toHaveLength(8);expect(cells).not.toContainEqual({x:10,y:10});
 });
 it('晁盖29级远程大十字9格，三段100%伤害，10%昏迷且不重复加回气',()=>{
  const c=data.classes[12],s=c.skills.find(s=>s.name==='天王震岳')!;
  expect(s).toMatchObject({skillId:1213,learnLevel:29,rangeMin:2,rangeMax:5,mpCost:140,power:20,hitMod:5,critMod:-5,stun:10,poison:0,damageScale:1,targetShape:'diamond',fxTint:0xffcc66});
  expect(s.hits.map(h=>h.percent)).toEqual([30,30,40]);
  expect(c.skills.filter(s=>s.type===8)).toHaveLength(1);
  expect(areaCells(board,{x:10,y:15},s,{x:10,y:10}).map(c=>`${c.x},${c.y}`).sort()).toEqual(['10,10','9,10','8,10','11,10','12,10','10,9','10,8','10,11','10,12'].sort());
  const b=new Battle({name:'chaogai',board,units:[act(0,12,'player',10,15),act(1,32,'enemy',10,10),act(2,7,'player',11,10)],blocks:[],data,seed:1});b.begin();const u=b.units[0];u.mp=200;
  const events=b.useSkill(u,s,{x:10,y:10}),attack=events.find(e=>e.type==='attack');
  expect(attack).toBeDefined();if(attack?.type==='attack'){expect(attack.hits).toHaveLength(1);expect(attack.hits[0].result.parts).toHaveLength(3);}
  expect(u.mp).toBe(60);expect(u.acted).toBe(true);expect(b.units[2].hp).toBe(b.units[2].stats.maxHp);
 });
 it('折角及蛇行提供左右两式，菜单稳定引用、相同射程与消耗',()=>{
  for(const [id,name]of [[13,'跳涧飞枪'],[15,'游蛇追命']] as const){const a=data.classes[id].skills.find(s=>s.name===name)!,left=data.classes[id].skills.find(s=>s.name===name+'·左折')!;expect(left.areaPattern).toEqual(a.areaPattern!.map(([x,y])=>[-x,y]));expect(left.mpCost).toBe(a.mpCost);expect(left.learnLevel).toBe(a.learnLevel);}
 });
 it('朱武可选队友所在格解围，不伤中心、其他己方或友军',()=>{
  const b=new Battle({name:'ring',board,units:[act(0,5,'player',10,15),act(1,7,'player',10,10),act(2,9,'ally',11,10),act(3,32,'enemy',9,10),act(4,33,'enemy',10,9),act(5,34,'enemy',15,15)],blocks:[],data,seed:2});b.begin();const u=b.units[0],s=data.classes[5].skills.find(s=>s.name==='破阵飞石')!;
  expect(b.skillTargets(u,s)).toContainEqual({x:10,y:10});expect(b.affected(u,s,{x:10,y:10}).map(t=>t.uid)).toEqual([b.units[3].uid,b.units[4].uid]);
  expect(b.skillArea(u,s,{x:0,y:0})).toHaveLength(3);
 });
 it('多段仅分摊总伤害，100%系数不增伤；中毒每个目标只掷一次',()=>{
  const b=new Battle({name:'damage',board,units:[act(0,15,'player',10,10),act(1,32,'enemy',10,12)],blocks:[],data,seed:2});b.begin();const [u,t]=b.units,s=data.classes[15].skills.find(s=>s.name==='游蛇追命')!;
  expect(baseDamage(u,t,s)).toEqual(baseDamage(u,t,{...s,damageScale:undefined}));
  const multi=rollAttack(u,t,s,new Rng(1),true),one=rollAttack(u,t,{...s,hits:[{frame:1,percent:100,dir:0}]},new Rng(1),true);
  expect(multi.parts).toHaveLength(5);expect(multi.damage).toBe(multi.parts.reduce((a,b)=>a+b,0));
  // 限定普通命中后比较总量；随机浮动相同可直接验证不按段数翻倍。
  u.stats.crit=0;const rng=new Rng(4);vi.spyOn(rng,'next').mockReturnValue(0.5);const chance=vi.spyOn(rng,'chance');const a=rollAttack(u,t,{...s,critMod:-999},rng,true);expect(chance.mock.calls.filter(([rate])=>rate===20)).toHaveLength(1);const c=rollAttack(u,t,{...s,critMod:-999,hits:[{frame:1,percent:100,dir:0}]},rng,true);
  expect(a.damage).toBe(c.damage);expect(one.damage).toBeGreaterThan(0);
 });
 it('陈达杨春白胜26级新增半条气回复，其余已有回气者不重复添加，NPC不增加技能',()=>{
  for(const id of [4,5,7,9,11,13,14,15,16,17]){
   const charges=data.classes[id].skills.filter(s=>s.type===8&&!s.chargeTarget);expect(charges).toHaveLength(1);
   if([4,13,15].includes(id)){const s=charges[0];expect(s).toMatchObject({learnLevel:26,mpCost:0,power:2,rangeMin:0,rangeMax:0});
    const b=new Battle({name:'charge',board,units:[act(0,id,'player',10,10),act(1,32,'enemy',20,20)],blocks:[],data,seed:2});b.begin();const u=b.units[0];u.mp=0;b.useSkill(u,s,u);expect(u.mp).toBe(Math.floor(u.stats.maxMp/2));
   }
  }
  for(const c of data.classes.filter(c=>c.id>=18))expect(c.skills.some(s=>s.skillId>=1200&&s.skillId<1250)).toBe(false);
 });
});
