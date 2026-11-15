import { describe, expect, it, vi } from 'vitest';
import { planAi, LEGACY_ATTACK_PERCENT } from '../src/rules/ai.ts';
import { Battle } from '../src/rules/battle.ts';
import { Board } from '../src/rules/board.ts';
import type { ActUnit } from '../src/formats/act.ts';
import type { ClassDef, GameData, SkillDef } from '../src/rules/data.ts';
import { Rng } from '../src/rules/rng.ts';

const skill = (id: number, o: Partial<SkillDef> = {}): SkillDef => ({
  skillId:id,name:`S${id}`,type:7,group:0,hidden:false,effect:0,effect2:0,effect3:0,power:0,mpCost:0,learnLevel:1,
  hitMod:0,critMod:0,stun:0,poison:0,area:1,rangeMin:1,rangeMax:1,hits:[{frame:1,percent:100,dir:0}],raw:'',...o,
});
const basic = skill(1), area = skill(2,{type:3,area:2,rangeMax:4,mpCost:20});
const g=(base:number)=>({base,growth:100});
const cls=(id:number,sk:SkillDef[],move:number):ClassDef=>({id,name:`C${id}`,hp:g(1000),mp:g(100),attack:g(50),defense:g(10),hit:g(100),agility:g(0),crit:g(0),move,weaponType:0,goldCap:0,defaultItems:[],skills:sk});
function setup(sk:SkillDef[], foes:number[][], o:{move?:number;at?:number[];mode?:number;seed?:number;extra?:ActUnit[]}={}) {
  const at=o.at??[5,5];
  const act=(index:number,type:number,side:ActUnit['side'],x:number,y:number,flags=0):ActUnit=>({index,type,side,x,y,level:1,flags,group:index+1,facing:2,extra:[0,0,0],items:[],raw:[]});
  const data:GameData={classes:[cls(0,sk,o.move??0),cls(1,[basic],0)],items:[],charNames:['攻方','守方'],heroName:'守方'};
  const b=new Battle({name:'AI-test',board:new Board(12,12),data,seed:o.seed??1,blocks:[],units:[act(0,0,'enemy',at[0],at[1],(o.mode??0)<<8),...foes.map(([x,y],i)=>act(i+1,1,'player',x,y)),...o.extra??[]]});
  b.begin();return {b,u:b.units[0]};
}
function branch(b:Battle, legacy:boolean){return vi.spyOn(b.rng,'chance').mockReturnValue(legacy);}
const end=(p:ReturnType<typeof planAi>,u:{x:number;y:number})=>p.path?.at(-1)??u;

describe('AI 30%传统 / 70%人数优先',()=>{
  it('每次攻击决策只抽一次30%策略，候选多也不重复抽',()=>{
    const {b,u}=setup([basic,area],[[3,4],[3,6],[8,6]],{move:2});const chance=branch(b,false);
    expect(planAi(b,u).skill).toBeTruthy();expect(chance.mock.calls).toEqual([[30]]);expect(LEGACY_ATTACK_PERCENT).toBe(30);
  });
  it('新策略优先多打人，不被首个目标、残血击倒或高单体伤害拉走',()=>{
    const heavy=skill(3,{power:500,rangeMax:4});
    const {b,u}=setup([basic,area,heavy],[[5,2],[7,5],[8,5],[7,6]]);b.units[1].hp=1;branch(b,false);
    const p=planAi(b,u),targets=b.affected(u,p.skill!,p.cell!,end(p,u));
    expect(p.skill).toBe(area);expect(targets.map(t=>t.uid)).toEqual([2,3,4]);
  });
  it('回旋技会走到能包围最多人的落点，而非优先少走路打一个',()=>{
    const spin=skill(3,{type:2,area:1,rangeMin:1,rangeMax:1,mpCost:10});
    const {b,u}=setup([basic,spin],[[2,4],[4,4],[4,6]],{at:[2,5],move:2});branch(b,false);
    const p=planAi(b,u);expect(p.skill).toBe(spin);expect(end(p,u)).toEqual({x:4,y:5});
    expect(b.affected(u,p.skill!,p.cell!,end(p,u)).map(t=>t.uid)).toEqual([2,3]);
  });
  it('真实敌方回合会执行新落点与回旋技，命中计划中的两人',()=>{
    const spin=skill(3,{type:2,area:1,rangeMin:1,rangeMax:1,mpCost:10});
    const {b,u}=setup([basic,spin],[[2,4],[4,4],[4,6]],{at:[2,5],move:2});
    const original=b.rng.chance.bind(b.rng);vi.spyOn(b.rng,'chance').mockImplementation(rate=>rate===30?false:original(rate));
    for(const t of b.units)if(t.side==='player')t.ended=true;
    const ev=b.endPlayerPhase();
    const attack=ev.find(e=>e.type==='attack'&&e.uid===u.uid);
    expect(attack?.type==='attack'&&attack.hits.map(h=>h.uid)).toEqual([2,3]);
    expect(attack?.type==='attack'&&attack.skill).toBe(spin);
    expect({x:u.x,y:u.y}).toEqual({x:4,y:5});expect(u.mp).toBe(u.stats.maxMp-10);
  });
  it('同样命中人数时选择期望伤害最高，不先扣除耗气惩罚',()=>{
    const strong={...area,skillId:3,power:1,mpCost:90};
    const {b,u}=setup([basic,area,strong],[[7,5],[8,5]]);branch(b,false);
    expect(planAi(b,u).skill).toBe(strong);
  });
  it('同分范围方案会随机选；重放相同种子可复现',()=>{
    const plans=new Set<string>();
    for(let seed=1;seed<=30;seed++){
      const {b,u}=setup([basic,area],[[2,5],[8,5]],{seed});branch(b,false);
      const p=planAi(b,u);plans.add(`${p.cell!.x},${p.cell!.y}`);
      const copy=setup([basic,area],[[2,5],[8,5]],{seed});branch(copy.b,false);
      expect(planAi(copy.b,copy.u)).toEqual({...p,target:copy.b.units.find(t=>t.uid===p.target!.uid)});
    }
    expect(plans.size).toBeGreaterThan(1);
  });
  it('仅单体可用时均匀随机目标：不会一直追第一个，也不按候选站位加权',()=>{
    const ranged=skill(4,{rangeMax:4,targetShape:'diamond'});
    const {b,u}=setup([ranged],[[5,4],[8,5]],{move:2});branch(b,false);
    const counts=[0,0];
    for(let seed=1;seed<=800;seed++){b.rng.reseed(seed);counts[planAi(b,u).target!.uid-1]++;}
    expect(counts[0]).toBeGreaterThan(330);expect(counts[0]).toBeLessThan(470);expect(counts.reduce((a,n)=>a+n,0)).toBe(800);
  });
  it('单体随机选人后，对同一目标使用气力足够的最高伤招式',()=>{
    const strong=skill(3,{power:80,mpCost:80});
    const {b,u}=setup([basic,strong],[[5,4],[6,5]]);branch(b,false);
    expect(planAi(b,u).skill).toBe(strong);
  });
  it('气力不足、未学会技能不候选；不可见、已死与同阵营人物不计人数',()=>{
    const locked={...area,skillId:3,learnLevel:9};
    const {b,u}=setup([basic,area,locked],[[5,4],[7,5],[8,5]]);u.mp=19;branch(b,false);
    expect(planAi(b,u).skill).toBe(basic);
    u.mp=100;b.units[2].present=false;b.units[3].alive=false;
    expect(b.affected(u,area,{x:7,y:5})).toEqual([]);
    b.units[2].present=true;b.units[2].side='enemy';expect(b.affected(u,area,{x:7,y:5})).toEqual([]);
  });
  it('30%分支先击倒，再伤害，不优先单位表里的首个敌人',()=>{
    const {b,u}=setup([skill(1,{rangeMax:4})],[[5,2],[7,5]]);b.units[2].hp=1;branch(b,true);
    expect(planAi(b,u).target!.uid).toBe(2);
    b.units[2].hp=1000;b.units[1].stats.defense=100;expect(planAi(b,u).target!.uid).toBe(2);
  });
  it('30%分支伤害相同先低血，再距离近',()=>{
    const {b,u}=setup([skill(1,{rangeMax:4})],[[5,2],[7,5]]);branch(b,true);
    b.units[1].defending=true;b.units[2].defending=true; // 排除侧背伤害，使本例的伤害确实相同
    for(const t of b.units.slice(1)){t.stats.defense=0;t.stats.agility=0;}
    u.stats.crit=0;
    b.units[1].hp=900;b.units[2].hp=950;expect(planAi(b,u).target!.uid).toBe(1);
    b.units[1].hp=950;expect(planAi(b,u).target!.uid).toBe(2);
  });
  it('策略抽样边界30%，使用战斗随机种子而非Math.random',()=>{
    const rng=new Rng(1);vi.spyOn(rng,'next').mockReturnValueOnce(.29999).mockReturnValueOnce(.3);
    expect(rng.chance(LEGACY_ATTACK_PERCENT)).toBe(true);expect(rng.chance(LEGACY_ATTACK_PERCENT)).toBe(false);
    const draw=new Rng(7);let legacy=0;for(let i=0;i<5000;i++)if(draw.chance(LEGACY_ATTACK_PERCENT))legacy++;
    expect(legacy).toBeGreaterThan(1350);expect(legacy).toBeLessThan(1650);
  });
  it('脚本追击仍必须覆盖指定目标；原地待命与警戒外不抽攻击策略',()=>{
    const {b,u}=setup([basic,area],[[5,2],[7,5],[8,5],[7,6]],{mode:1});u.ai.target=1;branch(b,false);
    const p=planAi(b,u);expect(b.affected(u,p.skill!,p.cell!,end(p,u)).some(t=>t.uid===1)).toBe(true);
    u.ai.mode=8;const chance=vi.spyOn(b.rng,'chance');chance.mockClear();expect(planAi(b,u)).toEqual({});expect(chance).not.toHaveBeenCalled();
    const far=setup([basic],[[11,11]],{mode:2,at:[1,1]});const other=vi.spyOn(far.b.rng,'chance');expect(planAi(far.b,far.u)).toEqual({});expect(other).not.toHaveBeenCalled();
  });
  it('低血用药、回复技优先仍生效；跟随模式不转成攻击',()=>{
    const heal=skill(5,{type:9,area:1,rangeMin:0,rangeMax:0,power:2});
    const {b,u}=setup([basic,area,heal],[[5,4]]);u.hp=50;const chance=branch(b,false);
    expect(planAi(b,u).skill).toBe(heal);expect(chance).not.toHaveBeenCalled();
    u.ai.mode=5;u.ai.target=1;const p=planAi(b,u);expect(p.skill).toBeUndefined();expect(p.rest).toBe(true);
  });
});
