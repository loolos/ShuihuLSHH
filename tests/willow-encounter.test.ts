import fs from 'node:fs';
import {describe,it,expect}from'vitest';
import{loadStage,loadStageMap,loadGameData}from'../src/rules/load.ts';
import{Battle,type BattleEvent}from'../src/rules/battle.ts';
import{NodeFiles,DATA}from'../tools/sim-lib.ts';
import{WILLOW_CELLS,WILLOW_MAP}from'../src/rules/willow-encounter.ts';
import{stageLabel}from'../src/game/stage-names.ts';
import{recordResult}from'../src/rules/campaign.ts';
import{OccluderIndex,coarseMask}from'../src/game/occlusion.ts';
describe.skipIf(!fs.existsSync(`${DATA}/Map/Act5-2.act`))('柳下逢知己',()=>{
 const files=new NodeFiles(DATA),data=loadGameData(files),input=()=>loadStage(files,data,'Act5-2',{seed:2});
 it('原串关换用狮子楼裁图，只有鲁智深参战，四名泼皮，其余五人旁观且不可攻击',()=>{
  expect(loadStageMap(files,'Act5-2')!.map).toEqual(loadStageMap(files,WILLOW_MAP)!.map);
  const i=input(),b=new Battle(i);b.begin();
  expect(i.header).toMatchObject({act:0,next:27});expect(stageLabel('第5章','Act5-2').kind).toBe('战役');
  expect(b.active().filter(u=>u.side==='player').map(u=>u.classId)).toEqual([16]);
  expect(b.active().filter(u=>u.side==='enemy')).toHaveLength(4);
  const seen=new Set<string>(),field=b.board.distanceField([b.units.find(u=>u.classId===16)!]);
  for(const u of b.units){expect(b.board.passable(u.x,u.y)).toBe(true);expect(seen.has(`${u.x},${u.y}`)).toBe(false);seen.add(`${u.x},${u.y}`);expect(Number.isFinite(field[u.y*22+u.x])).toBe(true);}
  for(const id of b.spectators){const u=b.unit(id)!;expect(u.side).toBe('ally');expect(b.canAct(u)).toBe(false);for(const foe of b.active().filter(u=>u.side==='enemy'))expect(b.aiFoesOf(foe)).not.toContain(u);}
  expect(b.units.find(u=>u.classId===11)!.present).toBe(false);expect(b.status).toBe('playing');expect(b.turnLimit).toBe(5);
 });
 it('清敌后先走到树旁再拔树、舞杖、林冲出现喝彩，树占格清除且重开恢复',()=>{
  const b=new Battle(input());b.begin();const lu=b.units.find(u=>u.classId===16)!,lin=b.units.find(u=>u.classId===11)!;
  const before=WILLOW_CELLS.map(c=>b.board.passable(c.x,c.y));expect(before.some(x=>!x)).toBe(true);
  for(const u of b.active().filter(u=>u.side==='enemy'))(b as unknown as{kill:(a:typeof lu,t:typeof lu)=>void}).kill(lu,u);
  (b as unknown as{afterAction:()=>void}).afterAction();const events=(b as unknown as{flush:()=>BattleEvent[]}).flush();
  const walk=events.findIndex(e=>e.type==='move'&&e.uid===lu.uid&&e.path.at(-1)?.x===4&&e.path.at(-1)?.y===14),up=events.findIndex(e=>e.type==='uproot'),staff=events.findIndex(e=>e.type==='flourish'),appear=events.findIndex(e=>e.type==='appear'&&e.uid===lin.uid);
  expect(walk).toBeGreaterThanOrEqual(0);expect(up).toBeGreaterThan(walk);expect(staff).toBeGreaterThan(up);expect(appear).toBeGreaterThan(staff);
  expect(events.filter(e=>e.type==='flourish')).toHaveLength(2);
  const said=events.filter((e):e is Extract<BattleEvent,{type:'say'}>=>e.type==='say').map(e=>e.text).join('');expect(said).toContain('王进');expect(said).toContain('夫人在庙前');expect(said).not.toContain('【改写】');
  for(const c of WILLOW_CELLS)expect(b.board.passable(c.x,c.y)).toBe(true);
  expect(b.status).toBe('won');expect(b.units.filter(u=>b.spectators.has(u.uid)).every(u=>u.side==='player')).toBe(true);
  const again=new Battle(input());expect(WILLOW_CELLS.map(c=>again.board.passable(c.x,c.y))).toEqual(before);
 });
 it('旁观人物继承装备锻造，胜利归队保存时不会重置资产',()=>{
  const slots=[...data.classes[0].defaultItems],forge=slots.map(()=>2);
  const kept={classId:0,level:18,exp:73,slots,forge};
  const b=new Battle(loadStage(files,data,'Act5-2',{party:new Map([[0,kept]])}));b.begin();
  const hero=b.units.find(u=>u.classId===0)!,lu=b.units.find(u=>u.classId===16)!;
  expect(hero.slots.slice(0,slots.length)).toEqual(slots);expect(hero.forge.slice(0,forge.length)).toEqual(forge);expect(hero.side).toBe('ally');
  for(const u of b.active().filter(u=>u.side==='enemy'))(b as unknown as{kill:(a:typeof lu,t:typeof lu)=>void}).kill(lu,u);
  (b as unknown as{afterAction:()=>void}).afterAction();
  const saved=recordResult({version:1,stage:26,gold:123,members:[kept]},b),member=saved.members.find(m=>m.classId===0)!;
  expect(member.slots.slice(0,slots.length)).toEqual(slots);expect(member.forge?.slice(0,forge.length)).toEqual(forge);expect(saved.gold).toBeGreaterThanOrEqual(123);expect(saved.active).toContain(0);
 });
 it('鲁智深倒下或第五回合尚未打完都会失败',()=>{
  const b=new Battle(input());b.begin();const lu=b.units.find(u=>u.classId===16)!,foe=b.active().find(u=>u.side==='enemy')!;
  (b as unknown as{kill:(a:typeof lu,t:typeof lu)=>void}).kill(foe,lu);(b as unknown as{afterAction:()=>void}).afterAction();expect(b.status).toBe('lost');
  const timeout=new Battle(input());timeout.begin();timeout.turn=5;timeout.endPlayerPhase();expect(timeout.status).toBe('lost');
 });
});
it('移除柳树遮挡不影响其他物体',()=>{
 const idx=new OccluderIndex(),mask=coarseMask(8,8,new Uint8Array(64).fill(1));idx.add(0,0,8,8,10,mask,'tree');idx.add(0,0,8,8,5,mask,'wall');idx.remove('tree');expect(idx.cover({x:0,y:0,w:8,h:8},0)).toBe(5);idx.remove('wall');expect(idx.cover({x:0,y:0,w:8,h:8},0)).toBeNull();
});
