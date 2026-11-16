import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { Board } from '../src/rules/board.ts';
import { areaCells, learnedSkills } from '../src/rules/skills.ts';
import { attackParts, baseDamage, rangedFactor, rollAttack } from '../src/rules/combat.ts';
import { Rng } from '../src/rules/rng.ts';
import { openLib } from '../src/formats/image.ts';
import { fxSpots, skillFx } from '../src/game/effects.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('花荣弓术', () => {
  const main = loadPackFromDisk('mainline'), jiang = loadPackFromDisk('jiangzhou');
  const cid = main.classIds.get('huarong')!;
  const skills = main.data.classes[cid].skills;
  const skill = (name: string) => skills.find(s => s.name === name)!;
  const board = new Board(31, 31), from = {x:15,y:15};
  const battle = () => new Battle({name:'test',data:main.data,board,seed:1,blocks:[],units:[
    {index:0,type:cid,group:1,side:'player',x:15,y:15,facing:0,level:24,flags:0,extra:[0,0,0],items:[],raw:[]},
    ...[[14,14],[15,11],[16,7],[15,6],[17,10],[15,16]].map(([x,y],i)=>({index:i+1,type:32,group:i+2,side:'enemy' as const,x,y,facing:2,level:10,flags:0,extra:[0,0,0] as [number,number,number],items:[],raw:[]})),
  ]});
  it('两包技能同步，按1/4/8/12/16/20/24学习，旧等级自动换成最高级', () => {
    const strip = (s: typeof skills[number]) => { const {skillId,...rest}=s;return rest; };
    expect(skills.map(strip)).toEqual(jiang.data.classes[jiang.classIds.get('huarong')!].skills.map(strip));
    expect(skills.map(s=>s.learnLevel)).toEqual([1,4,8,12,16,20,24]);
    for (const level of [1,4,8,12,16,20,24,35]) {
      const list=learnedSkills({classId:cid,level} as Unit,main.data);
      const tier=level>=24?3:level>=20?2:level>=4?1:0;
      expect(list.filter(s=>s.name.startsWith('穿云贯日')).map(s=>s.name)).toEqual(tier?[`穿云贯日LV${tier}`]:[]);
    }
  });
  it('穿云贯日三级威力20/40/60、两三四段、必杀始终+10；每段落在一轮射箭内', () => {
    const man=openLib(fs.readFileSync(path.join(DATA,'Data/Man.lib')));
    for (let tier=1;tier<=3;tier++) {
      const s=skill(`穿云贯日LV${tier}`);
      expect(s).toMatchObject({power:tier*20,mpCost:20+10*tier,critMod:10,castCycles:tier+1,rangeMin:1,rangeMax:8,area:8,pierce:true,castSpeed:2,arrowFx:'fire'});
      expect(attackParts(s)).toHaveLength(tier+1);
      expect(skillFx(s)?.projectile).toBe(true); // 箭逐格飞出，arrowFx 火苗跟着箭走
      expect(s.hits.reduce((n,h)=>n+h.percent,0)).toBe(100);
      for (let dir=0;dir<4;dir++) {
        const r=man.actions[man.classes[34].first+3*4+dir];
        expect(r.last-r.first+1).toBe(26);
        expect(s.hits.map(h=>h.frame)).toEqual(Array.from({length:tier+1},(_,i)=>20+26*i));
      }
    }
  });
  it('穿云贯日穿透：从身前一格起整条直线8格都受击，施放点只定方向；箭一路飞到线尾', () => {
    const s=skill('穿云贯日LV1');
    for (const at of [{x:15,y:14},{x:15,y:11},{x:15,y:7}]) {
      const cells=areaCells(board,from,s,at);
      expect(cells).toEqual(Array.from({length:8},(_,i)=>({x:15,y:14-i})));
      const spots=fxSpots(s,from,at,cells,()=>true);
      expect(spots.map(sp=>sp.ring)).toEqual([0,1,2,3,4,5,6,7,8]); // 碰到目标也不停
    }
    expect(areaCells(board,from,s,{x:15,y:6})).toHaveLength(9); // 装备射程让施放点更远时线跟着延长
    expect(areaCells(board,{x:15,y:3},s,{x:15,y:2})).toHaveLength(3); // 边缘截断
    const b=battle();b.begin();const u=b.units[0];
    b.units.find(t=>t.x===15&&t.y===6)!.x=16; // 第 9 格那人挪开
    const near={x:15,y:13};
    b.units.find(t=>t.x===14&&t.y===14)!.x=15; b.units.find(t=>t.x===15&&t.y===14)!.y=near.y;
    expect(b.affected(u,s,{x:15,y:14}).map(t=>`${t.x},${t.y}`).sort()).toEqual(['15,11','15,13']);
  });
  it('出手播放倍率：穿云贯日2倍、连珠飞星1.8倍（负责人 2026-11-16），其余原速', () => {
    expect(skill('连珠飞星').castSpeed).toBe(1.8);
    expect(skill('连珠飞星').arrowFx).toBeUndefined();
    for (const n of ['百步穿杨','雁落平沙','澄心引弦']) expect(skill(n).castSpeed).toBeUndefined();
  });
  it('连珠飞星四向均为自身前方3×8，共24格，不包含自身与背后，边缘自动截断', () => {
    const s=skill('连珠飞星');
    for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const cells=areaCells(board,from,s,{x:from.x+dx*8,y:from.y+dy*8});
      expect(cells).toHaveLength(24);
      for (let depth=1;depth<=8;depth++) for(let width=-1;width<=1;width++)
        expect(cells).toContainEqual({x:from.x+dx*depth+dy*width,y:from.y+dy*depth+dx*width});
      expect(cells).not.toContainEqual(from);
      const spots=fxSpots(s,from,{x:from.x+dx*8,y:from.y+dy*8},cells);
      expect(spots.map(sp=>sp.ring).sort((a,b)=>a-b)).toEqual(Array.from({length:8},(_,i)=>[i,i,i]).flat());
    }
    expect(areaCells(board,{x:0,y:0},s,{x:0,y:1})).toHaveLength(16);
    expect(attackParts(s)).toHaveLength(3);
    expect(skillFx(s)).toMatchObject({directional:true,projectile:true});
  });
  it('24格贯穿命中前中后敌人、不误伤友军，三段不把总伤害翻三倍，只扣一次气', () => {
    const b=battle();b.begin();const u=b.units[0],s=skill('连珠飞星');
    b.units[2].side='ally';
    expect(b.affected(u,s,{x:15,y:7}).map(t=>t.uid)).toEqual([1,3]);
    const mp=u.mp,ev=b.useSkill(u,s,{x:15,y:7});
    const attack=ev.find(e=>e.type==='attack');
    expect(attack?.type==='attack' && attack.hits.map(h=>h.uid)).toEqual([1,3]);
    expect(u.mp).toBe(mp-35);
    const rng=new Rng(7);vi.spyOn(rng,'chance').mockReturnValue(true);vi.spyOn(rng,'next').mockReturnValue(0.5);
    const result=rollAttack(u,b.units[3],s,rng,true);
    expect(result.parts).toHaveLength(3);
    expect(result.damage).toBe(Math.floor(baseDamage(u,b.units[3],s)[1]));
    expect(rangedFactor(u,b.units[1],s)).toBeCloseTo(1-0.4/7);
    expect(rangedFactor(u,b.units[3],s)).toBeCloseTo(0.6);
  });
  it('雁落平沙为落点五格，集气零耗气回复一半气力', () => {
    const b=battle();b.begin();const u=b.units[0];
    expect(b.skillArea(u,skill('雁落平沙'),{x:15,y:11})).toHaveLength(5);
    u.mp=0;b.useSkill(u,skill('澄心引弦'),u);
    expect(u.mp).toBe(Math.floor(u.stats.maxMp/2));
  });
});
