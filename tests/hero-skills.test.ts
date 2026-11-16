import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { Board } from '../src/rules/board.ts';
import { areaCells, castCells, learnedSkills, skillBaseName, skillsLearnedAt } from '../src/rules/skills.ts';
import { attackParts, baseDamage, rollAttack } from '../src/rules/combat.ts';
import { Rng } from '../src/rules/rng.ts';
import type { Unit } from '../src/rules/unit.ts';
import type { SkillDef } from '../src/rules/data.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { FX_EXPLOSION, fxGroups } from '../src/game/effects.ts';

const available = fs.existsSync(path.join(DATA, 'Data/Human.hum'));
describe.skipIf(!available)('武松、李逵技能重做', () => {
  const main = loadPackFromDisk('mainline'), jiang = loadPackFromDisk('jiangzhou');
  const skills = (who: string, rt=main) => rt.data.classes[rt.classIds.get(who)!].skills;
  const skill = (who: string, name: string) => skills(who).find(s=>s.name===name)!;
  const board = new Board(31,31);
  const from = {x:15,y:15};
  const names: Record<string,string[]> = {
    wusong: ['伏虎拳','横江断浪LV1','擒虎镇岳','抱元归息','横江断浪LV2','玉环鸳鸯脚','横江断浪LV3','横江断浪LV4'],
    likui: ['双斧开山','狂澜裂岳LV1','裂石连斩','沉息蓄锋','狂澜裂岳LV2','旋风卷岳','狂澜裂岳LV3','狂澜裂岳LV4'],
  };
  const battle = (who: string, level=28) => new Battle({
    name:'test', data:main.data, board, seed:11, blocks:[],
    units:[{index:0,type:main.classIds.get(who)!,group:1,side:'player',x:10,y:10,facing:2,level,flags:0,extra:[0,0,0],items:[],raw:[]},
      ...[[12,12],[11,12],[13,12],[12,11],[12,13],[13,13]].map(([x,y],i)=>({index:i+1,type:32,group:i+2,side:'enemy' as const,x,y,facing:0,level:1,flags:0,extra:[0,0,0] as [number,number,number],items:[],raw:[]}))],
  });
  it('两人按1/4/8/12/16/20/24/28学习，最高一级替换旧级，低等级不提前拥有集气',()=> {
    for(const who of ['wusong','likui']) {
      const sk=skills(who);expect(sk.map(s=>s.name)).toEqual(names[who]);
      expect(sk.map(s=>s.learnLevel)).toEqual([1,4,8,12,16,20,24,28]);
      for(let lv=1;lv<=30;lv++) {
        const u={classId:main.classIds.get(who)!,level:lv} as Unit;
        const learned=learnedSkills(u,main.data);
        expect(learned.every(s=>s.learnLevel<=lv)).toBe(true);
        expect(new Set(learned.map(s=>skillBaseName(s.name))).size).toBe(learned.length);
        expect(learned.filter(s=>s.type===8).length).toBe(lv>=12?1:0);
        const tier=lv>=28?4:lv>=24?3:lv>=16?2:lv>=4?1:0;
        expect(learned.filter(s=>s.name.includes('LV')).map(s=>s.name)).toEqual(tier?[`${who==='wusong'?'横江断浪':'狂澜裂岳'}LV${tier}`]:[]);
        expect(skillsLearnedAt(u,main.data,lv).length).toBe([4,8,12,16,20,24,28].includes(lv)?1:0);
      }
      expect(learnedSkills({classId:main.classIds.get(who)!,level:28} as Unit,main.data)).toHaveLength(4);
    }
  });
  it('主线与江州李逵的技能和动作保持一致',()=> {
    const strip=(s:SkillDef)=>{const{skillId,...rest}=s;return rest;};
    expect(skills('likui').map(strip)).toEqual(skills('likui',jiang).map(strip));
    expect(main.sheets['sprites/likui']).toEqual(jiang.sheets['sprites/likui']);
  });
  it('武松普攻2段、重拳3段、鸳鸯4段：动画真正循环相应次数，命中各落在一次出拳内',()=> {
    for(const [name,cycles,power,cost] of [['伏虎拳',2,0,0],['擒虎镇岳',3,60,60],['玉环鸳鸯脚',4,40,40]] as const) {
      const s=skill('wusong',name),look=main.looks.get(main.classIds.get('wusong')!)!;
      const action=main.sheets[look.sheet].actions[look.actions[s.group+3]];
      expect(attackParts(s)).toHaveLength(cycles);expect(s).toMatchObject({power,mpCost:cost});
      expect(s.hits.reduce((a,h)=>a+h.percent,0)).toBe(100);
      for(const strip of [action.front,action.back]) {
        // 一段 = 一次出拳 / 一脚：鸳鸯脚的图条一轮是右脚 + 左脚两脚，循环 2 次
        const totalMs=strip.frames*strip.ms*(strip.cycles??1),cycleMs=totalMs/cycles;
        expect(Number.isInteger(strip.frames*(strip.cycles??1)/cycles)).toBe(true);
        s.hits.forEach((h,i)=>expect((h.frame-1)*45).toBeGreaterThanOrEqual(i*cycleMs-22.5));
        s.hits.forEach((h,i)=>expect((h.frame-1)*45).toBeLessThan((i+1)*cycleMs));
        expect(totalMs).toBeLessThan(2500);
      }
    }
    expect(skill('wusong','擒虎镇岳').stun).toBe(30);
  });
  it('横江断浪各级恒定+20、2段，方向锥形纵深3/4/5/6，自己和身后不在范围',()=> {
    for(let tier=1;tier<=4;tier++) {
      const s=skill('wusong',`横江断浪LV${tier}`);
      expect(s).toMatchObject({power:20,area:tier+2,rangeMin:1,rangeMax:1,mpCost:[50,65,80,95][tier-1],type:1});
      expect(attackParts(s)).toHaveLength(2);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const cells=areaCells(board,from,s,{x:from.x+dx,y:from.y+dy});
        expect(cells).toHaveLength([5,8,13,18][tier-1]);
        const depths=cells.map(c=>(c.x-from.x)*dx+(c.y-from.y)*dy);
        expect(Math.min(...depths)).toBe(1);expect(Math.max(...depths)).toBe(tier+2);
      }
    }
  });
  it('鸳鸯脚可选斜向四格目标，击中目标与四邻敌人，不误伤友军或斜邻格',()=> {
    const b=battle('wusong',20);b.begin();const u=b.units[0],s=skill('wusong','玉环鸳鸯脚');
    expect(b.skillCells(u,s)).toContainEqual({x:12,y:12});expect(b.skillCells(u,s)).not.toContainEqual({x:13,y:12});
    expect(b.skillArea(u,s,{x:12,y:12})).toHaveLength(5);
    expect(b.affected(u,s,{x:12,y:12}).map(t=>t.uid)).toEqual([1,2,3,4,5]);
    b.units[2].side='ally';expect(b.affected(u,s,{x:12,y:12}).map(t=>t.uid)).toEqual([1,3,4,5]);
    const cost=u.mp,ev=b.useSkill(u,s,{x:12,y:12});const attack=ev.find(e=>e.type==='attack');
    expect(attack?.type==='attack' && attack.hits.map(h=>h.uid)).toEqual([1,3,4,5]);expect(u.mp).toBe(cost-40);
    // Existing skills retain the original four-direction casting rule.
    expect(castCells(board,u,[1,4])).not.toContainEqual({x:12,y:12});
  });
  it('裂石连斩距离2仍单体，旋风保持四邻格；集气恢复一半上限',()=> {
    const b=battle('likui');b.begin();const u=b.units[0],s=skill('likui','裂石连斩');
    b.units[1].x=12;b.units[1].y=10;b.units[2].x=12;b.units[2].y=11;
    expect(b.skillTargets(u,s)).toContainEqual({x:12,y:10});expect(b.affected(u,s,{x:12,y:10})).toHaveLength(1);
    expect(s).toMatchObject({rangeMax:2,power:25,mpCost:30,stun:30});expect(attackParts(s)).toHaveLength(2);
    expect(areaCells(board,from,skill('likui','旋风卷岳'),{x:16,y:15})).toHaveLength(4);
    u.mp=0;const charge=skill('likui','沉息蓄锋');b.useSkill(u,charge,u);expect(u.mp).toBe(Math.floor(u.stats.maxMp/2));
  });
  it('狂澜四级固定5格、3/4/5/6段、威力0/20/40/60；昏迷每目标只掷一次',()=> {
    for(let tier=1;tier<=4;tier++) {
      const s=skill('likui',`狂澜裂岳LV${tier}`),b=battle('likui');b.begin();const u=b.units[0],t=b.units[1];
      expect(s).toMatchObject({area:2,rangeMax:tier+2,power:(tier-1)*20,mpCost:[60,80,100,120][tier-1],stun:20,critMod:20});
      expect(s.hitFx).toBe('explosion');expect(fxGroups(s)).toEqual([FX_EXPLOSION]); // 只在命中的人身上炸，不铺满范围
      expect(areaCells(board,from,s,{x:16,y:15})).toHaveLength(5);
      expect(attackParts(s)).toHaveLength(tier+2);expect(s.hits.reduce((a,h)=>a+h.percent,0)).toBe(100);
      u.stats.poison=0;u.stats.stun=0;u.stats.crit=0;
      const rng=new Rng(1),chance=vi.spyOn(rng,'chance');
      const result=rollAttack(u,t,s,rng,true);expect(chance.mock.calls.filter(([rate])=>rate===20)).toHaveLength(1);
      const [normal,critical]=baseDamage(u,t,s);
      expect(result.damage).toBeLessThanOrEqual(Math.ceil(Math.max(normal,critical)*1.1));
      expect(result.parts).toHaveLength(tier+2);
    }
  });
});
