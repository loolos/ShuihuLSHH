import fs from 'node:fs';
import path from 'node:path';
import {beforeAll,describe,expect,it} from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { inGuardRoom, planAi } from '../src/rules/ai.ts';
import {compileStage} from '../src/packs/build.ts';
import {loadPackFromDisk} from '../tools/sim-pack.ts';
import {DATA,NodeFiles} from '../tools/sim-lib.ts';
const has=fs.existsSync(path.join(DATA,'ShuiHu.exe'));
describe.skipIf(!has)('鸳鸯楼府院围攻',()=>{
 let rt:ReturnType<typeof loadPackFromDisk>,files:NodeFiles;
 beforeAll(()=>{files=new NodeFiles(DATA);rt=loadPackFromDisk('mainline');});
 const stage=()=>rt.stages.find(s=>s.id==='yuanyanglou')!;
 const start=()=>{const b=new Battle(compileStage(rt,stage(),files,{seed:1}));b.begin();return b;};
 it('十名好汉、三名守屋首领及各路守卫均可从前院到达，首领没有额外攻防增益',()=>{
  const b=start(),s=stage(),reach=b.board.reach({x:11,y:15},1000,new Set());
  expect([b.board.width,b.board.height]).toEqual([24,24]);expect(b.units.filter(u=>u.side==='player'&&u.present)).toHaveLength(10);
  const cells=new Set<string>();for(const u of s.units){const k=`${u.x},${u.y}`;expect(cells.has(k),u.id).toBe(false);cells.add(k);expect(reach.has(k),u.id).toBe(true);}
  const bosses=b.units.filter(u=>u.ai.mode===12);expect(bosses).toHaveLength(3);for(const u of bosses){expect(u.buffs.filter(v=>v.stat==='attack'||v.stat==='defense')).toEqual([]);const p=planAi(b,u);expect(p.path?.length??0).toBeLessThanOrEqual(1);}
  const guards=b.units.filter(u=>u.side==='enemy'&&u.present&&u.ai.mode===0);expect(guards).toHaveLength(21);expect(guards.some(u=>(planAi(b,u).path?.length??0)>1)).toBe(true);
 });
 it('三首领守屋：屋里没有我方时原地不动，有人进屋就出战（负责人 2026-11-15）',()=>{
  const b=start(),bosses=b.units.filter(u=>u.ai.mode===12);
  for(const u of bosses)expect(inGuardRoom(u,{x:18,y:6})&&!inGuardRoom(u,{x:13,y:12})).toBe(true);
  const ws=b.units.find(u=>u.side==='player'&&u.present)!;
  // 屋外：不离岗
  for(const u of bosses)expect(planAi(b,u).path?.length??0).toBeLessThanOrEqual(1);
  // 有人进屋（门口 (13,11) 一带）：首领出战，走向我方
  ws.x=14;ws.y=4;
  const plans=bosses.map(u=>planAi(b,u));
  expect(bosses.every(u=>u.ai.mode===0)).toBe(true);
  expect(plans.some(p=>(p.path?.length??0)>1||!!p.target)).toBe(true);
 });
 it('击败三首领时各有与武松的对话',()=>{
  const s=stage();
  for(const who of ['jiangmenshen','zhangdujian','zhangtuanlian']){
   const blk=s.script.find(x=>typeof x.on==='object'&&'dead' in x.on&&x.on.dead===who)!;
   expect(blk,who).toBeTruthy();
   const speakers=blk.do.filter(o=>o[0]==='say').map(o=>o[1]);
   expect(speakers).toContain(who);expect(speakers).toContain('wusong');
  }
 });
 it('第2、4、6回合各九名增援；敌人提前清空也等待最后一批，残留任一敌人不能通关',()=>{
  const b=start(),foes=b.units.filter(u=>u.side==='enemy');expect(foes).toHaveLength(51);expect(foes.filter(u=>u.present)).toHaveLength(24);
  for(const u of b.units)if(u.side==='player')u.hp=99999;
  const clear=()=>{for(const u of foes)if(u.present){u.hp=0;u.alive=false;u.present=false;}};
  for(let turn=2;turn<=6;turn++){clear();b.endPlayerPhase();expect(b.status).toBe('playing');expect(b.turn).toBe(turn);expect(foes.filter(u=>u.present)).toHaveLength(turn%2===0?9:0);}
  const last=foes.find(u=>u.present)!;for(const u of foes)if(u.present&&u!==last){u.hp=0;u.alive=false;u.present=false;}last.hp=99999;b.endPlayerPhase();expect(b.status).toBe('playing');clear();b.endPlayerPhase();expect(b.status).toBe('won');
 });
});
