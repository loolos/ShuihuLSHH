// 完整主线期望经验：不刷训练，按当前开场身份/等级/装备，假设战斗敌人全部击倒。
// 等级分配沿用旧估算的均摊近似；不是逐刀AI实战，逃脱/归降关的经验是上限口径。
import {readExeTables}from'../src/formats/exe.ts';
import {parsePasHeader}from'../src/formats/pas.ts';
import {Battle}from'../src/rules/battle.ts';
import {ENEMY_LEVEL}from'../src/rules/enemy-level.ts';
import {previewAttack}from'../src/rules/combat.ts';
import {newCampaign,joinLevel,partyOf,recordResult,type CampaignState}from'../src/rules/campaign.ts';
import {chapterSequence}from'../src/rules/chapters.ts';
import {expToNext,EXP_RULES,OVERKILL_CAP}from'../src/rules/exp.ts';
import {loadStage,buildT2S,exeTables,stageJson}from'../src/rules/load.ts';
import {attackSkill,refreshStats,type Unit}from'../src/rules/unit.ts';
import {loadPackFromDisk}from'./sim-pack.ts';
import {compileStage}from'../src/packs/build.ts';
import {packParty,recordPackResult,saveTownParty}from'../src/packs/campaign.ts';
import {prepareInsertTown}from'../src/packs/towns.ts';
import {NodeFiles,DATA}from'./sim-lib.ts';
export interface CampaignEstimateRow {
 map:string;entry:Map<number,number>;keys:Map<number,string>;design:number;foes:number;foeAvg:number;enter:number;exit:number;kill:number;dmg:number;taken:number;total:number;n:number;
}
const avg=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
export function estimateCampaign(limit=200):CampaignEstimateRow[]{
 if(process.env.KB)EXP_RULES.killBase=Number(process.env.KB);
 if(process.env.KP)EXP_RULES.killPerLevel=Number(process.env.KP);
 if(process.env.NOFLOOR==='1')ENEMY_LEVEL.floor=false;
 const need=(level:number)=>expToNext(level)+Number(process.env.NA??0)*(level-1)+Number(process.env.NB??0)*(level-1)**2;
 const files=new NodeFiles(DATA),rt=loadPackFromDisk('mainline'),data=rt.data,tr=buildT2S(files),exe=exeTables(files);
 const route=new Set<string>();let next=0;
 for(let n=0;n<100&&exe.stages[next]?.mapName;n++){const map=exe.stages[next].mapName;route.add(map.toLowerCase());const h=stageJson(files, map)!.header;if(!h.next)break;next=h.next;}
 const list=chapterSequence().filter(x=>x.key.includes('/')||route.has(x.key.toLowerCase())).slice(0,limit);
 const keys=new Map([...rt.classIds].map(([key,id])=>[id,key]));
 const expected=(a:Unit,d:Unit)=>{const skill=attackSkill(a,data);if(!skill)return{hit:0,damage:1};const p=previewAttack(a,d,skill),hit=p.hit/100,crit=p.crit/100;return{hit,damage:Math.max(1,p.damage*(1-crit)+p.critDamage*crit)};};
 let campaign:CampaignState=newCampaign();const rows:CampaignEstimateRow[]=[];
 for(let i=0;i<list.length;i++){
  const map=list[i].key,pack=map.includes('/'),stage=pack?rt.stages.find(s=>`${rt.id}/${s.id}`===map):undefined;
  if(pack&&!stage)throw Error(`主线估算缺少关卡${map}`);
  const party=pack?packParty(campaign,rt):partyOf(campaign),join=pack?joinLevel({...campaign,members:[...party.values()]}):joinLevel(campaign);
  const input=pack?compileStage(rt,stage!,files,{party,joinLevel:join,text:tr,seed:1}):loadStage(files,data,map,{party,joinLevel:join,text:tr,seed:1});
  const b=new Battle(input),entry=new Map(b.units.filter(u=>u.side==='player').map(u=>[u.classId,u.level]));
  b.begin();
  const fight=pack?stage!.units.some(u=>u.side==='enemy'&&u.ai!==8):!(/^(act|train)/i.test(map))||map.toLowerCase()==='act5-2';
  if(fight)for(const u of b.units)if(u.side==='player'&&!b.spectators.has(u.uid))u.present=true;
  const mine=b.units.filter(u=>u.side==='player'&&u.alive&&!b.spectators.has(u.uid)),foes=fight?b.units.filter(u=>u.side==='enemy'&&u.alive&&(!pack||stage!.units[u.uid].ai!==8)):[];
  const enter=avg(mine.map(u=>u.level));let kill=0,dmg=0,taken=0;
  for(const foe of foes){if(!mine.length)break;const k0=kill,d0=dmg,t0=taken;const out=mine.map(u=>expected(u,foe)),per=avg(out.map(v=>v.hit*v.damage)),hit=avg(out.map(v=>v.hit)),N=foe.stats.maxHp/Math.max(1,per);
   kill+=EXP_RULES.killBase+EXP_RULES.killPerLevel*foe.level+2;
   const over=Math.min(per/Math.max(.01,hit)/2,foe.stats.maxHp*OVERKILL_CAP);dmg+=(foe.stats.maxHp+over)/10+1.5*N*hit;
   const attacks=Math.max(1,Number(process.env.ATT??1.5)*N/mine.length),back=mine.map(u=>expected(foe,u)),eh=avg(back.map(v=>v.hit));taken+=attacks*(eh*(avg(back.map(v=>v.damage))/15+2)+(1-eh)*4);
   const rate=Number(process.env.RB??0),factor=rate?Math.min(2,Math.max(.2,1+rate*(foe.level-enter))):1;kill=k0+(kill-k0)*factor;dmg=d0+(dmg-d0)*factor;taken=t0+(taken-t0)*factor;
  }
  const total=(kill+dmg+taken)*1.05*Number(process.env.SCALE??1);
  for(const u of mine){let exp=u.exp+total/mine.length;while(exp>=need(u.level))exp-=need(u.level++);u.exp=Math.round(exp);refreshStats(u,data);}
  rows.push({map,entry,keys,design:foes.length?avg(foes.map(u=>u.level))+1:0,foes:foes.length,foeAvg:avg(foes.map(u=>u.level)),enter,exit:avg(mine.map(u=>u.level)),kill,dmg,taken,total,n:mine.length});
  // 原版观战同伴结尾归队，回合增援按全部到场保存；不执行会制造击倒经验的额外事件。
  for(const u of b.units){if(b.spectators.has(u.uid)&&party.has(u.classId))u.side='player';if(u.side==='player')u.present=true;}
  b.status='won';campaign=pack?recordPackResult(campaign,b,rt):recordResult(campaign,b);
  const following=list[i+1]?.key;if(stage?.townAfter&&following?.startsWith('mainline/'))campaign=saveTownParty(prepareInsertTown(campaign,rt,following),rt);
 }
 return rows;
}
