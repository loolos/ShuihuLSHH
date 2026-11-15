import fs from 'node:fs';
import path from 'node:path';
import {beforeAll,describe,expect,it} from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import {compileStage} from '../src/packs/build.ts';
import {loadPackFromDisk} from '../tools/sim-pack.ts';
import {DATA,NodeFiles} from '../tools/sim-lib.ts';
const has=fs.existsSync(path.join(DATA,'ShuiHu.exe'));
describe.skipIf(!has)('鸳鸯楼府院围攻',()=>{
 let rt:ReturnType<typeof loadPackFromDisk>,files:NodeFiles;
 beforeAll(()=>{files=new NodeFiles(DATA);rt=loadPackFromDisk('mainline');});
 const stage=()=>rt.stages.find(s=>s.id==='yuanyanglou')!;
 const start=()=>{const b=new Battle(compileStage(rt,stage(),files,{seed:1}));b.begin();return b;};
 it('十名好汉、三名原位戒备首领及各路守卫均可从前院到达，首领没有额外攻防增益',()=>{
  const b=start(),s=stage(),reach=b.board.reach({x:11,y:15},1000,new Set());
  expect([b.board.width,b.board.height]).toEqual([24,24]);expect(b.units.filter(u=>u.side==='player'&&u.present)).toHaveLength(10);
  const cells=new Set<string>();for(const u of s.units){const k=`${u.x},${u.y}`;expect(cells.has(k),u.id).toBe(false);cells.add(k);expect(reach.has(k),u.id).toBe(true);}
  const bosses=b.units.filter(u=>u.ai.mode===11);expect(bosses).toHaveLength(3);for(const u of bosses){expect(u.buffs.filter(v=>v.stat==='attack'||v.stat==='defense')).toEqual([]);const p=planAi(b,u);expect(p.path?.length??0).toBeLessThanOrEqual(1);}
  const guards=b.units.filter(u=>u.side==='enemy'&&u.present&&u.ai.mode===0);expect(guards).toHaveLength(12);expect(guards.some(u=>(planAi(b,u).path?.length??0)>1)).toBe(true);
 });
 it('第2、4、6回合各六名增援；敌人提前清空也等待最后一批，残留任一敌人不能通关',()=>{
  const b=start(),foes=b.units.filter(u=>u.side==='enemy');expect(foes).toHaveLength(33);expect(foes.filter(u=>u.present)).toHaveLength(15);
  for(const u of b.units)if(u.side==='player')u.hp=99999;
  const clear=()=>{for(const u of foes)if(u.present){u.hp=0;u.alive=false;u.present=false;}};
  for(let turn=2;turn<=6;turn++){clear();b.endPlayerPhase();expect(b.status).toBe('playing');expect(b.turn).toBe(turn);expect(foes.filter(u=>u.present)).toHaveLength(turn%2===0?6:0);}
  const last=foes.find(u=>u.present)!;for(const u of foes)if(u.present&&u!==last){u.hp=0;u.alive=false;u.present=false;}last.hp=99999;b.endPlayerPhase();expect(b.status).toBe('playing');clear();b.endPlayerPhase();expect(b.status).toBe('won');
 });
});
