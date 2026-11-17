import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { Board } from '../src/rules/board.ts';
import { areaCells, castRange, learnedSkills } from '../src/rules/skills.ts';
import { fxSpots } from '../src/game/effects.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { DIRS, type Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(path.join(DATA,'Data/Human.hum')))('秦明霹雳火倒锥形', () => {
  const rt=loadPackFromDisk('mainline'),cid=rt.classIds.get('qinming')!;
  const skills=rt.data.classes[cid].skills.filter(s=>s.name.startsWith('霹雳火LV'));
  const board=new Board(15,15),from={x:7,y:7};
  it('四级四朝向均为近宽远窄的完整区域，逐排减两格，特效与命中区域一致', () => {
    for (const [tier,s] of skills.entries()) for (const d of DIRS) {
      const at={x:from.x+d.x,y:from.y+d.y},cells=areaCells(board,from,s,at);
      const widths=Array.from({length:tier+2},(_,i)=>(tier+1-i)*2+1);
      expect(cells).toHaveLength((tier+2)**2);
      for (let i=1;i<=tier+2;i++) {
        expect(cells.filter(c=>(c.x-from.x)*d.x+(c.y-from.y)*d.y===i)).toHaveLength(widths[i-1]);
        for(let j=-(tier+2-i);j<=tier+2-i;j++) expect(cells).toContainEqual({x:from.x+d.x*i+d.y*j,y:from.y+d.y*i+d.x*j});
      }
      expect(cells).not.toContainEqual(from);
      expect(new Set(cells.map(c=>`${c.x},${c.y}`)).size).toBe(cells.length);
      expect(fxSpots(s,from,at,cells).map(p=>p.ring)).toEqual(widths.flatMap((w,i)=>Array(w).fill(i)));
    }
    expect(areaCells(board,{x:0,y:0},skills[3],{x:0,y:1})).toHaveLength(15);
  });
  it('固定四向选点、装备不扩范围，6/18/25/32级换招，保留双段并按范围调整耗气', () => {
    expect(skills.map(s=>s.mpCost)).toEqual([30,50,75,105]);
    expect(skills.map(s=>s.power)).toEqual([20,35,50,65]);
    expect(skills.map(s=>s.learnLevel)).toEqual([6,18,25,32]);
    for(const s of skills) {
      expect(s.hits.map(h=>h.percent)).toEqual([50,50]);
      expect(castRange({classId:cid,stats:{rangeBonus:9}} as Unit,s,rt.data)).toEqual([1,1]);
    }
    for(const level of [1,6,17,18,24,25,31,32,40]) expect(learnedSkills({classId:cid,level} as Unit,rt.data).filter(s=>s.type===17)).toEqual(skills.filter(s=>s.learnLevel<=level).slice(-1));
  });
  it('实际施放命中第一排两侧和远端，不打身侧、身后及友军，耗气仅扣一次', () => {
    const b=new Battle({name:'test',data:rt.data,board,blocks:[],seed:1,units:[
      {index:0,type:cid,group:1,side:'player',x:7,y:7,facing:0,level:32,flags:0,extra:[0,0,0],items:[],raw:[]},
      ...[[3,6],[11,6],[7,2],[7,8],[6,7],[8,6],[8,2]].map(([x,y],i)=>({index:i+1,type:32,group:i+2,side:i===5?'ally' as const:'enemy' as const,x,y,facing:2,level:30,flags:0,extra:[0,0,0] as [number,number,number],items:[],raw:[]})),
    ]});b.begin();const u=b.units[0],s=skills[3],at={x:7,y:6};
    expect(b.affected(u,s,at).map(t=>t.uid)).toEqual([1,2,3]);
    u.mp=104;expect(b.useSkill(u,s,at)).toEqual([]);
    u.mp=135;const ev=b.useSkill(u,s,at),attack=ev.find(e=>e.type==='attack');
    expect(attack?.type==='attack'&&attack.hits.map(h=>h.uid)).toEqual([1,2,3]);expect(u.mp).toBe(30);
  });
});
