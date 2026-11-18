// 酒楼结豪杰改为小型遭遇战；原版资源只读，沿用原串关位置。
import type { ActUnit } from '../formats/act.ts';
import type { PasBlock, PasOp, PasTrigger, PasCond } from '../formats/pas.ts';
export const isWillowEncounter = (stage: string) => stage.toLowerCase() === 'act5-2';
export const WILLOW_MAP = 'N05@32,0,22,22';
// 狮子楼裁图中同一株柳树的树干/树冠（Upper.grp 57–65）。
export const WILLOW_CELLS = [{x:3,y:11},{x:2,y:12},{x:3,y:12},{x:4,y:12},{x:3,y:13},{x:4,y:13}];
const op=(op:number,value=0,extra:Partial<PasOp>={}):PasOp=>({op,flag:op<24?0:null,value,...extra});
const say=(who:number,text:string):PasOp[]=>[op(12,who),op(13,0,{text})];
const move=(who:number,x:number,y:number):PasOp[]=>[op(12,who),op(14,x),op(15,y),op(17,1)];
export function willowUnits(original:ActUnit[]):ActUnit[]{
 const positions:Record<number,[number,number]>={0:[9,16],3:[8,17],13:[10,17],15:[10,15],5:[11,16],16:[8,13],11:[12,8],31:[14,8],35:[12,11]};
 const units=original.map(u=>({...u,items:[...u.items],raw:[...u.raw],x:positions[u.type][0],y:positions[u.type][1],flags:[11,31,35].includes(u.type)?7:0,level:u.type===16?12:u.level}));
 for(const [i,type,x,y] of [[0,65,7,10],[1,44,6,12],[2,44,10,12],[3,44,12,13]])units.push({index:units.length,type,group:20+i,side:'enemy',facing:2,x,y,level:i?9:10,flags:0,extra:[0,0,0],items:[],raw:[]});
 return units;
}
export function willowBlocks():PasBlock[]{
 const block=(trigger:PasTrigger,ops:PasOp[],cond:PasCond={type:0,arg:0}):PasBlock=>({index:0,head:[],trigger,cond,ops});
 const watch=[0,3,13,15,5];
 const opening:PasOp[]=[...say(0xffffffff,'众人来到东京，正待进酒铺歇脚，街头却横过四个泼皮，拦住了去路。'),...say(1020,'和尚，打俺们地面经过，怎地不留下些买酒钱？'),...say(16,'洒家不曾吃你的酒，倒来问洒家讨钱？'),...say(1020,'少说闲话！留下银子，放你过去；若说半个不字，教你认得俺们！'),...say(3,'这几个鸟人，倒来寻鲁大哥的晦气！'),...say(16,'兄弟们且站开，休来插手！只这几个腌臜泼才，洒家一个便料理了！'),...say(0,'好，我们就在旁边，看大哥的手段！')];
 for(const id of watch)opening.push(op(12,id),op(115,0,{text:'ally'}));
 opening.push(op(35,5),op(31,0,{text:'五回合内打倒四名泼皮；鲁智深倒下或超时则失败。其余好汉旁观，不参加战斗。'}));
 const ending:PasOp[]=[...say(0xffffffff,'四个泼皮被打得东倒西歪，连声告饶，哪里还敢逞强。'),...say(16,'有手有脚，不去寻个正经营生，却在街头欺人！往后再教洒家撞见，可没今日这般便宜！'),...say(0,'大哥还未使禅杖，他们便撑不住了。'),...say(16,'说起气力，且教你们看个明白。'),...move(16,4,14),op(12,16),op(108,0),...say(0xffffffff,'智深走到柳树旁，束紧腰间衣带，两手抱住树身，腰胯间猛一发力！'),op(118,0,{args:{cells:WILLOW_CELLS}}),...say(0xffffffff,'只听土响根摧，一株垂杨柳竟被他连根拔起。泼皮们看得目瞪口呆，拜服散去。'),...say(3,'鲁大哥这番手段，今日可开了眼！'),...say(16,'拔树算甚么！待洒家再使一路禅杖与你们看。'),...move(16,6,13),op(12,16),op(119),op(119),...say(11,'好使得！'),...move(11,8,13),...say(16,'哪位官人在那里喝彩？既看得入眼，何不过来相叙？'),...say(11,'这条禅杖少说也有六十来斤，师兄使来却似浑不费力，教人好生钦佩！'),...say(16,'洒家关西鲁达，如今法名智深。未敢请教官人姓名？'),...say(11,'在下林冲，在东京充个禁军枪棒教头。'),...say(16,'莫不是林提辖的公子？洒家在东京，正愁少个相知的弟兄！'),...say(0xffffffff,'二人越说越投契，林冲拜智深为兄。众人就在酒铺前坐下，彼此叙礼。'),...say(3,'林教头，在下是王进王教头的徒弟，吾师有一信要转交给你。'),...say(11,'哦？我看看……王兄的好意，林冲心领了。只是在东京尚有家眷，不能说走便走。'),...say(0,'教头今日怎地恰从这里经过？'),...say(11,'今日陪拙荆到庙里还愿，见师兄舞杖看得入神，便让她与丫头先去烧香了。'),...say(16,'放着夫人独自去上香，不要紧么？'),...say(11,'就在近处，料也无妨。来，诸位且饮一杯。'),...say(31,'官人！不要再喝酒了！夫人在庙前被一群登徒子纠缠住了！'),...move(31,9,13),...say(11,'在哪里？！'),...say(31,'方才经过五岳楼，几个富家子弟拦住夫人。我看情势不妙，便脱身来寻官人！'),...say(11,'锦儿，快带路！诸位，林冲先行一步！'),...move(11,12,10),op(12,11),op(17,2),...move(31,13,10),op(12,31),op(17,2),...say(0,'林教头有麻烦，我们去帮他！'),...say(16,'好！休教那伙鸟人欺了他的家眷！')];
 for(const id of watch)ending.push(op(12,id),op(115,0,{text:'player'}));
 ending.push(op(29,0,{text:'柳下识英雄，舞杖逢知己。众人急往岳庙，接应林教头。'}));
 return [block({kind:'turn',turn:0},opening),block({kind:'turn',turn:2},say(16,'方才那股横劲哪里去了？尽管上来，休教洒家一个个寻你！')),block({kind:'cond'},ending,{type:1,arg:0xff}),block({kind:'death',char:16},[op(30,0,{text:'鲁智深倒下，众人只得上前救护，未能独自打退泼皮。'})])].map((b,index)=>({...b,index}));
}
