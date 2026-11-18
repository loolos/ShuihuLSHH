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
   fxTint:e.cls===17?0xdd6655:e.cls===15?0x80ee88:e.cls===7||e.cls===9?0x99ddff:undefined,
   effect:e.fx,effect2:0,effect3:0,damageScale:1,rangedDamage:undefined,
   hits:e.weights.map((percent,i)=>({frame:frames[i],percent,dir:0})),raw:''}];
 });
 // 不同折向使用稳定的技能对象，技能菜单和useSkill的身份校验保持一致。
 for(const s of [...out]) if(s.name==='跳涧飞枪'||s.name==='游蛇追命')
  out.push({...s,name:s.name+'·左折',skillId:s.skillId+80,areaPattern:s.areaPattern!.map(([x,y])=>[-x,y] as const)});
 if([4,13,15].includes(cls)&&!existing.some(s=>s.type===8&&!s.chargeTarget)){
  const names:Record<number,string>={4:'藏锋养气',13:'伏虎调息',15:'盘蛇吐纳'};
  out.push({...own,skillId:1230+cls,soundId:own.skillId,name:names[cls],type:8,hidden:false,learnLevel:26,mpCost:0,power:2,
   rangeMin:0,rangeMax:0,area:0,hits:[],effect:0,effect2:0,effect3:0,poison:0,stun:0,hitMod:0,critMod:0,raw:''});
 }
 return out;
}
