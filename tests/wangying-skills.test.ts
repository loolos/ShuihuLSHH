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

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('王英三岔毒龙枪', () => {
  const rt = loadPackFromDisk('mainline'), cid = rt.classIds.get('wangying')!;
  const skills = rt.data.classes[cid].skills.filter(s => s.type === 16);
  const board = new Board(13, 13), from = {x:6,y:6};
  it('四级仅延长三条射线，四个朝向都不打中间空隙、身侧和身后，特效同时沿三路推进', () => {
    for (const s of skills) for (const d of DIRS) {
      const at = {x:from.x+d.x,y:from.y+d.y}, cells = areaCells(board,from,s,at);
      expect(cells).toHaveLength(s.area*3);
      for (let i=1;i<=s.area;i++) for (const j of [-i,0,i])
        expect(cells).toContainEqual({x:from.x+d.x*i+d.y*j,y:from.y+d.y*i+d.x*j});
      expect(cells).not.toContainEqual(from);
      expect(fxSpots(s,from,at,cells).map(p=>p.ring)).toEqual(Array.from({length:s.area},(_,i)=>[i,i,i]).flat());
    }
    expect(areaCells(board,{x:0,y:0},skills[3],{x:0,y:1})).toHaveLength(8);
  });
  it('6/14/22/30级自动替换旧级，威力和命中、带毒不随级数增加；武器不扩范围', () => {
    expect(skills.map(s=>s.learnLevel)).toEqual([6,14,22,30]);
    expect(skills.map(s=>s.mpCost)).toEqual([30,55,80,105]);
    for (const s of skills) {
      expect(s).toMatchObject({power:20,hitMod:30,poison:20,stun:0,critMod:0});
      expect(castRange({classId:cid,stats:{rangeBonus:10}} as Unit,s,rt.data)).toEqual([1,1]);
    }
    for (const level of [1,6,13,14,21,22,29,30,40]) {
      const list=learnedSkills({classId:cid,level} as Unit,rt.data).filter(s=>s.type===16);
      expect(list).toEqual(skills.filter(s=>s.learnLevel<=level).slice(-1));
    }
  });
  it('实际施放命中三条线的远端，避开空隙和友军，只扣一次气；气不足不能出手', () => {
    const b=new Battle({name:'test',data:rt.data,board,blocks:[],seed:1,units:[
      {index:0,type:cid,group:1,side:'player',x:6,y:6,facing:0,level:30,flags:0,extra:[0,0,0],items:[],raw:[]},
      ...[[6,2],[2,2],[10,2],[5,2],[6,7],[7,5]].map(([x,y],i)=>({index:i+1,type:32,group:i+2,side:i===5?'ally' as const:'enemy' as const,x,y,facing:2,level:30,flags:0,extra:[0,0,0] as [number,number,number],items:[],raw:[]})),
    ]});
    b.begin();const u=b.units[0],s=skills[3],at={x:6,y:5};
    expect(b.affected(u,s,at).map(t=>t.uid)).toEqual([1,2,3]);
    u.mp=104;expect(b.useSkill(u,s,at)).toEqual([]);expect(u.acted).toBe(false);
    u.mp=135;const ev=b.useSkill(u,s,at),attack=ev.find(e=>e.type==='attack');
    expect(attack?.type==='attack'&&attack.hits.map(h=>h.uid)).toEqual([1,2,3]);
    expect(u.mp).toBe(30);
  });
});
