import fs from 'node:fs';
import{describe,it,expect}from'vitest';
import{loadStage,loadGameData,exeTables,stageJson}from'../src/rules/load.ts';
import{Battle}from'../src/rules/battle.ts';
import{enemyRank,relativeEnemyLevel}from'../src/rules/enemy-level.ts';
import{loadPackFromDisk}from'../tools/sim-pack.ts';
import{compileStage}from'../src/packs/build.ts';
import{DATA,NodeFiles}from'../tools/sim-lib.ts';
import{readExeTables}from'../src/formats/exe.ts';
import{type Member}from'../src/rules/campaign.ts';
import levels from'../src/data/entry-levels.json'with{type:'json'};
it('兵与头领按自己的区间校正且不低于1，骑兵刺客不误算头领',()=>{
 expect([relativeEnemyLevel(1,20,'troop'),relativeEnemyLevel(19,20,'troop'),relativeEnemyLevel(40,20,'troop')]).toEqual([17,19,20]);
 expect([relativeEnemyLevel(1,20,'leader'),relativeEnemyLevel(22,20,'leader'),relativeEnemyLevel(40,20,'leader')]).toEqual([20,22,23]);
 expect(relativeEnemyLevel(0,1,'troop')).toBe(1);expect(enemyRank(43)).toBe('troop');expect(enemyRank(66)).toBe('troop');expect(enemyRank(38)).toBe('leader');
});
describe.skipIf(!fs.existsSync(`${DATA}/ShuiHu.exe`))('完整流程等级',()=>{
 const files=new NodeFiles(DATA),data=loadGameData(files),rt=loadPackFromDisk('mainline');
 const member=(id:number,level:number):Member=>({classId:id,level,exp:73,slots:[...rt.data.classes[id].defaultItems],forge:[2,1,0]});
 const check=(input:ReturnType<typeof loadStage>)=>{
  const b=new Battle(input),mine=b.units.filter(u=>u.side==='player'&&!b.spectators.has(u.uid)&&!b.prisonCarts.has(u.uid)&&b.board.onGround(u.x,u.y)&&b.data.classes[u.classId].skills.length);
  if(!mine.length)return;
  const mid=Math.round(mine.reduce((a,u)=>a+u.level,0)/mine.length);
  for(const[id,rank]of Object.entries(input.enemyRanks??{})){const u=b.unit(Number(id))!;expect(u.level,`${input.name} ${u.name}`).toBeGreaterThanOrEqual(Math.max(1,mid+(rank==='troop'?-3:0)));expect(u.level,`${input.name} ${u.name}`).toBeLessThanOrEqual(mid+(rank==='troop'?0:3));}
 };
 it('全部原版战斗及主线插关/续篇，低级和高级存档都满足等级区间',()=>{
  for(const lv of[5,35]){
   for(const s of exeTables(files).stages.filter(s=>s.mapName&&!!stageJson(files, s.mapName))){const first=loadStage(files,data,s.mapName),party=new Map(first.units.filter(u=>u.side==='player').map(u=>[u.type,member(u.type,lv)]));check(loadStage(files,data,s.mapName,{party}));}
   for(const stage of rt.stages){const party=new Map(stage.units.filter(u=>u.side==='player').map(u=>{const id=typeof u.class==='number'?u.class:rt.classIds.get(u.class)!;return[id,member(id,lv)]}));check(compileStage(rt,stage,files,{party,joinLevel:lv+10}));}
  }
 });
 it('大破何涛不再把已有主角抬到30，保留经验与打铁',()=>{
  const m=member(0,24),input=loadStage(files,data,'N-add14',{party:new Map([[0,m]])}),b=new Battle(input),u=b.units.find(u=>u.classId===0&&u.side==='player')!;
  expect(u.level).toBe(24);expect(u.exp).toBe(73);expect(u.forge.slice(0,3)).toEqual([2,1,0]);expect(u.slots.slice(0,m.slots.length)).toEqual(m.slots);
 });
 it('快活林新人按本场28/29/33均级30加入，不被全局40再次抬高',()=>{
  const stage=rt.stages.find(s=>s.id==='kuaihuolin')!,party=new Map([[rt.classIds.get('wusong')!,member(rt.classIds.get('wusong')!,28)],[rt.classIds.get('sj-fugitive')!,member(rt.classIds.get('sj-fugitive')!,29)],[0,member(0,33)]]);
  const b=new Battle(compileStage(rt,stage,files,{party,joinLevel:40}));
  for(const key of['daizong','huarong','likui'])expect(b.units.find(u=>u.classId===rt.classIds.get(key))!.level,key).toBe(30);
  expect(party.get(0)!.level).toBe(33);
 });
 it('新选关用稳定推荐表，普通连续存档不被推荐等级覆盖',()=>{
  const stage=rt.stages.find(s=>s.id==='liufeng')!,table=(levels.levels as Record<string,Record<string,number>>)['mainline/liufeng'];
  const fresh=new Battle(compileStage(rt,stage,files,{preset:true}));
  for(const key of['huarong','huangxin','qinming'])expect(fresh.units.find(u=>u.classId===rt.classIds.get(key))!.level).toBe(table[key]);
  const id=rt.classIds.get('huarong')!,m=member(id,13),b=new Battle(compileStage(rt,stage,files,{party:new Map([[id,m]]),joinLevel:60}));
  expect(b.units.find(u=>u.classId===id)!.level).toBe(13);expect(b.units.find(u=>u.classId===id)!.exp).toBe(73);
 });
});
