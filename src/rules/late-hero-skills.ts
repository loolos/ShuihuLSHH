// 后期好汉技能：本项目自有配置，不改 HUM 或同形象的 NPC 职业。
import type { SkillDef } from './data.ts';

export type AreaOffset = readonly [side: number, forward: number];
const ring: AreaOffset[] = [-1, 0, 1].flatMap(x => [-1, 0, 1].filter(y => x || y).map(y => [x, y] as const));
export const LATE_PATTERNS = {
  water: [[0,0],[-1,-1],[-1,0],[-1,1],[1,-1],[1,0],[1,1]],
  wave: [[-2,0],[-1,0],[0,0],[1,0],[2,0],[-2,1],[2,1]],
  corner: [[-1,0],[0,0],[1,0],[1,1],[1,2]],
  ring,
  cross: [[0,0],[-1,-1],[-2,-2],[-1,1],[-2,2],[1,-1],[2,-2],[1,1],[2,2]],
  wings: [[0,0],[-1,-1],[-2,-2],[1,-1],[2,-2]],
  fork: [[0,0],[-1,1],[-2,2],[1,1],[2,2]],
  snake: [[0,0],[0,1],[1,1],[1,2],[2,2]],
  ranks: [[-1,0],[0,0],[1,0],[-1,2],[0,2],[1,2]],
  fan: [[0,0],[-1,1],[0,1],[1,1],[-2,2],[-1,2],[0,2],[1,2],[2,2]],
  spear: [[0,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]],
  quake: [[0,0],[-1,0],[-2,0],[1,0],[2,0],[0,-1],[0,-2],[0,1],[0,2]],
  plum: [[0,0],[-1,-1],[-1,1],[1,-1],[1,1]],
} satisfies Record<string, readonly AreaOffset[]>;

type Entry = { cls:number; name:string; level:number; range:readonly[number,number]; pattern:keyof typeof LATE_PATTERNS; weights:number[]; mp:number; power:number; hit:number; crit:number; fx:number; poison?:number; stun?:number; free?:boolean };
// 伤害100%；多段按权重分摊。广范围以低威力、耗气及必杀修正平衡。
export const LATE_HERO_SKILLS: Entry[] = [
 {cls:7,name:'分水穿浪',level:26,range:[1,5],pattern:'water',weights:[30,30,40],mp:110,power:15,hit:5,crit:0,fx:49},
 {cls:9,name:'横江拍浪',level:27,range:[2,5],pattern:'wave',weights:[25,25,25,25],mp:115,power:10,hit:5,crit:-5,fx:49,stun:10},
 {cls:13,name:'跳涧飞枪',level:26,range:[2,6],pattern:'corner',weights:[40,60],mp:85,power:25,hit:10,crit:5,fx:44},
 {cls:13,name:'猛虎摆尾',level:29,range:[1,4],pattern:'ring',weights:[30,30,40],mp:125,power:10,hit:0,crit:-5,fx:44,stun:10},
 {cls:17,name:'赤发断魂',level:28,range:[2,5],pattern:'cross',weights:[20,20,20,20,20],mp:140,power:10,hit:0,crit:-10,fx:35},
 {cls:14,name:'青面飞刃',level:27,range:[2,6],pattern:'wings',weights:[25,25,50],mp:100,power:30,hit:10,crit:5,fx:44},
 {cls:15,name:'蛇影分锋',level:26,range:[1,5],pattern:'fork',weights:[30,30,40],mp:95,power:15,hit:5,crit:0,fx:35,poison:15},
 {cls:15,name:'游蛇追命',level:29,range:[2,5],pattern:'snake',weights:[20,20,20,20,20],mp:115,power:20,hit:5,crit:0,fx:35,poison:20},
 {cls:5,name:'破阵飞石',level:26,range:[2,6],pattern:'ring',weights:[30,30,40],mp:120,power:0,hit:5,crit:-10,fx:44,stun:10,free:true},
 {cls:5,name:'截阵连锋',level:30,range:[2,5],pattern:'ranks',weights:[25,25,25,25],mp:125,power:15,hit:5,crit:-5,fx:44,free:true},
 {cls:16,name:'伏虎震杖',level:28,range:[1,4],pattern:'fan',weights:[35,65],mp:135,power:15,hit:0,crit:-10,fx:38,stun:15},
 {cls:11,name:'回马扫阵',level:29,range:[2,5],pattern:'spear',weights:[20,20,25,35],mp:115,power:20,hit:10,crit:0,fx:32},
 {cls:4,name:'撒钉封路',level:27,range:[2,6],pattern:'plum',weights:[20,20,20,20,20],mp:100,power:0,hit:15,crit:-10,fx:44,poison:15,free:true},
 {cls:12,name:'天王震岳',level:29,range:[2,5],pattern:'quake',weights:[30,30,40],mp:140,power:20,hit:5,crit:-5,fx:38,stun:10,free:true},
];

export function lateHeroSkills(cls: number, existing: SkillDef[]): SkillDef[] {
 const own=existing[0];
 if(!own) return [];
 const out=LATE_HERO_SKILLS.flatMap((e,i):SkillDef[] => {
  if(e.cls!==cls)return [];
  // 沿用本人普攻动作，连续命中帧集中于该动作结尾，避免虚构不存在的出手组。
  const last=Math.max(1,...own.hits.map(h=>h.frame));
  const frames=e.weights.map((_,i)=>Math.max(1,last-(e.weights.length-1-i)*2));
  return [{...own,skillId:1200+i,soundId:own.soundId??own.skillId,name:e.name,type:0,hidden:false,learnLevel:e.level,
   rangeMin:e.range[0],rangeMax:e.range[1],area:5,areaPattern:LATE_PATTERNS[e.pattern],targetShape:e.free?'diamond':undefined,
   mpCost:e.mp,power:e.power,hitMod:e.hit,critMod:e.crit,poison:e.poison??0,stun:e.stun??0,
   fxTint:e.cls===12?0xffcc66:e.cls===17?0xdd6655:e.cls===15?0x80ee88:e.cls===7||e.cls===9?0x99ddff:undefined,
   effect:e.fx,effect2:0,effect3:0,damageScale:1,rangedDamage:undefined,
   hits:e.weights.map((percent,i)=>({frame:frames[i],percent,dir:0})),raw:''}];
 });
 // 不同折向使用稳定的技能对象，技能菜单和useSkill的身份校验保持一致。
 for(const s of [...out]) if(s.name==='跳涧飞枪'||s.name==='游蛇追命')
  out.push({...s,name:s.name+'·左折',skillId:s.skillId+80,areaPattern:s.areaPattern!.map(([x,y])=>[-x,y] as const)});
 if([4,13,15].includes(cls)&&!existing.some(s=>s.type===8&&!s.chargeTarget)){
  const names:Record<number,string>={4:'藏锋养气',13:'伏虎调息',15:'盘蛇吐纳'};
  out.push({...own,skillId:1230+cls,soundId:own.skillId,name:names[cls],type:8,hidden:false,learnLevel:cls===4?26:8,mpCost:0,power:2,
   rangeMin:0,rangeMax:0,area:0,hits:[],effect:0,effect2:0,effect3:0,poison:0,stun:0,hitMod:0,critMod:0,raw:''});
 }
 return out;
}

/** 好汉技能分阶；按职业与原技能号限定，NPC保留自己的原技能。 */
export function heroSkillTiers(cls: number, own: SkillDef[]): SkillDef[] {
 return own.flatMap(s => {
  if(cls===0&&[10,11,12].includes(s.skillId)){
   const tier=s.skillId-10;
   const updated={...s,hitMod:5*(tier+1),critMod:20+5*tier,
    hits:tier===2?[{frame:8,percent:50,dir:0},{frame:12,percent:50,dir:0}]:s.hits};
   if(tier!==2)return [updated];
   // LV5（负责人 2026-11-25，30–40 级补技能）：40 级，范围 9，威力 75，命中 +25，必杀 +40
   const lv4={...updated,skillId:1309,soundId:s.soundId??s.skillId,name:s.name.replace(/LV3$/,'LV4'),
    learnLevel:28,mpCost:210,power:65,area:8,hitMod:20,critMod:35};
   return [updated,lv4,{...lv4,skillId:1314,name:s.name.replace(/LV3$/,'LV5'),learnLevel:40,mpCost:250,power:75,area:9,hitMod:25,critMod:40,
    hits:lv4.hits.map(h=>({...h}))}];
  }
  // 千軍萬馬（武龍，类型 0 落点往前一线）：负责人 2026-11-22 加 LV4，命中 +5/+10/+15/+20，
  // LV3、LV4 两段（与萬夫莫敵同一出手动作第 3 组，第 8、12 帧各 50%）；LV4 一线 9 格（3/5/7 → 9），22 级，威力 65，耗气见 HERO_AOE_COSTS
  if(cls===0&&[4,5,6].includes(s.skillId)){
   const tier=s.skillId-4;
   const two=[{frame:8,percent:50,dir:0},{frame:12,percent:50,dir:0}];
   // LV3、LV4 可选周围 8 格（含斜向），斜着放时一线也斜着走（负责人 2026-11-22）
   const updated={...s,hitMod:5*(tier+1),hits:tier===2?two:s.hits,targetShape:tier===2?'eight' as const:undefined};
   if(tier!==2)return [updated];
   // LV5（负责人 2026-11-25，30–40 级补技能）：32 级，一线 11 格，威力 75，命中 +25
   return [updated,{...updated,skillId:1310,soundId:s.soundId??s.skillId,name:s.name.replace(/LV3$/,'LV4'),
    learnLevel:22,mpCost:150,power:65,area:9,hitMod:20,hits:two.map(h=>({...h}))},
    {...updated,skillId:1312,soundId:s.soundId??s.skillId,name:s.name.replace(/LV3$/,'LV5'),
    learnLevel:32,mpCost:190,power:75,area:11,hitMod:25,hits:two.map(h=>({...h}))}];
  }
  // 鏟惡除奸（林沖，类型 0 落点往前一线）：负责人 2026-11-25 加 LV4，命中 +5/+10/+15/+20，
  // LV3、LV4 两段（出手动作 7 第 14 帧气浪、第 18 帧突刺各 50%）；LV4 一线 6 格（3/4/5 → 6），30 级，威力 75，耗气见 HERO_AOE_COSTS
  if(cls===11&&[101,102,103].includes(s.skillId)){
   const tier=s.skillId-101;
   const two=[{frame:14,percent:50,dir:0},{frame:18,percent:50,dir:0}];
   const updated={...s,hitMod:5*(tier+1),hits:tier===2?two:s.hits};
   if(tier!==2)return [updated];
   return [updated,{...updated,skillId:1311,soundId:s.soundId??s.skillId,name:s.name.replace(/LV3$/,'LV4'),
    learnLevel:30,power:75,area:6,hitMod:20,hits:two.map(h=>({...h}))}];
  }
  if(cls===16&&s.skillId===135){
   const frames=[12,13,15,17],weights=[[100],[50,50],[30,30,40],[25,25,25,25]];
   return [4,14,22,30].map((level,i)=>({...s,skillId:i===0?135:1305+i,soundId:s.soundId??s.skillId,
    name:`${s.name}LV${i+1}`,learnLevel:level,rangeMin:0,rangeMax:0,area:i+1,
    areaPattern:Array.from({length:i+1},(_,k)=>k+1).flatMap(n=>[[n,0],[-n,0],[0,n],[0,-n]] as AreaOffset[]),
    power:s.power+i*5,mpCost:s.mpCost+i*10,hitMod:s.hitMod+i*5,critMod:s.critMod+i*5,
    hits:weights[i].map((percent,k)=>({frame:frames[k],percent,dir:0}))}));
  }
  // 一夫當關（武龍）LV2（负责人 2026-11-25，40 级后也留一招）：44 级，4 段，威力 120，命中 +35
  if(cls===0&&s.skillId===7)
   return [s,{...s,skillId:1315,soundId:s.soundId??s.skillId,name:`${s.name}LV2`,learnLevel:44,mpCost:100,power:120,hitMod:s.hitMod+5,
    hits:[6,11,16,19].map(frame=>({frame,percent:25,dir:0}))}];
  if(cls===0&&s.skillId===3){
   const tiers=[
    {id:3,level:8,power:40,mp:30,hit:20,stun:15,frames:[7,14,20],weights:[30,50,20]},
    {id:1304,level:20,power:60,mp:40,hit:30,stun:20,frames:[5,10,15,20],weights:[25,25,25,25]},
    {id:1305,level:28,power:80,mp:50,hit:40,stun:25,frames:[4,8,12,16,20],weights:[20,20,20,20,20]},
    // LV4（负责人 2026-11-25，30–40 级补技能）：36 级，6 段
    {id:1313,level:36,power:100,mp:60,hit:50,stun:30,frames:[3,6,9,12,15,20],weights:[16,16,17,17,17,17]},
   ];
   return tiers.map((t,i)=>({...s,skillId:t.id,soundId:s.soundId??s.skillId,name:`${s.name}LV${i+1}`,learnLevel:t.level,
    power:t.power,mpCost:t.mp,hitMod:t.hit,stun:t.stun,
    hits:t.frames.map((frame,k)=>({frame,percent:t.weights[k],dir:0}))}));
  }
  const chenda=cls===13&&s.skillId===115;
  const xiaoqi=cls===9&&s.skillId===81;
  if(!chenda&&!xiaoqi)return [s];
  const tiers=chenda
   ? [{id:115,level:s.learnLevel,power:s.power,mp:s.mpCost,frames:[12,23],weights:[40,60]},
      {id:1300,level:20,power:55,mp:30,frames:[12,18,23],weights:[30,30,40]},
      {id:1301,level:28,power:75,mp:40,frames:[8,12,18,23],weights:[25,25,25,25]}]
   : [{id:81,level:s.learnLevel,power:s.power,mp:s.mpCost,frames:[18,25,28],weights:[30,30,40]},
      {id:1302,level:27,power:60,mp:30,frames:[18,22,25,28],weights:[25,25,25,25]},
      {id:1303,level:30,power:80,mp:40,frames:[15,18,22,25,28],weights:[20,20,20,20,20]}];
  return tiers.map((t,i)=>({...s,skillId:t.id,soundId:s.soundId??s.skillId,name:`${s.name}LV${i+1}`,learnLevel:t.level,power:t.power,mpCost:t.mp,hitMod:s.hitMod+i*5,
   hits:t.frames.map((frame,k)=>({frame,percent:t.weights[k],dir:0}))}));
 });
}
