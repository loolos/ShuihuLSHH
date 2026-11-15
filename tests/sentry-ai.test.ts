import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import type { ActUnit } from '../src/formats/act.ts';
import type { ClassDef, GameData, SkillDef } from '../src/rules/data.ts';
const basic = { name: '攻击', skillId: 1, type: 5, group: 0, power: 0, rangeMin: 1, rangeMax: 1, area: 1, learnLevel: 1, mpCost: 0, hitMod: 0, critMod: 0, stun: 0, poison: 0, effect: 0, effect2: 0, effect3: 0, hits: [{frame: 1, percent: 100, dir: 0}], hidden: false, raw: '' } satisfies SkillDef;
const g = (base: number) => ({base, growth: 100});
const cls = (id: number): ClassDef => ({id, name: '守卫', hp:g(100),mp:g(50),attack:g(30),defense:g(10),hit:g(90),agility:g(10),crit:g(5),move:5,weaponType:0,goldCap:0,defaultItems:[],skills:[basic]});
const act=(index:number,side:ActUnit['side'],x:number,y:number):ActUnit=>({index,type:index,group:index,side,x,y,level:1,flags:index===1?11<<8:0,facing:0,extra:[0,0,0],items:[0,0,0,0,0,0,0],raw:[]});
function battle(x:number, range=1) {
 const classes=[cls(0),cls(1)];classes[1].skills=[{...basic,rangeMax:range}];
 const data:GameData={classes,items:[],charNames:['好汉','首领'],heroName:'好汉'};
 const b=new Battle({name:'sentry',board:new Board(20,20),units:[act(0,'player',x,5),act(1,'enemy',10,5)],blocks:[],data,seed:1});b.begin();return b;
}
describe('驻守戒备 AI11',()=>{
 it('即使移动后能攻击，也不离开岗位追击',()=>{
  const b=battle(7);expect(planAi(b,b.unit(1)!)).toEqual({});
  const events=b.endPlayerPhase();expect(events.some(e=>e.type==='move'&&e.uid===1)).toBe(false);expect(b.unit(1)).toMatchObject({x:10,y:5});
 });
 it.each([[9,1],[7,3]])('近身或远程目标进入原位射程时还击：目标x=%i，射程%i',(x,range)=>{
  const b=battle(x,range),u=b.unit(1)!,p=planAi(b,u);expect(p.target?.uid).toBe(0);expect(p.path).toEqual([{x:10,y:5}]);
  const events=b.endPlayerPhase();expect(events.some(e=>e.type==='attack'&&e.uid===1)).toBe(true);expect(events.some(e=>e.type==='move'&&e.uid===1)).toBe(false);expect(u).toMatchObject({x:10,y:5});
 });
});
