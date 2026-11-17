import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeStats, refreshStats } from '../src/rules/unit.ts';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA,'Data/Human.hum')))('江州可控好汉及白龙庙增兵', () => {
  const rt=loadPackFromDisk('jiangzhou'),files=new NodeFiles(DATA);
  const stage=(id:string)=>rt.stages.find(s=>s.id===id)!;
  const open=(id:string)=>{const s=stage(id),b=new Battle(compileStage(rt,s,files));b.begin();return {s,b,get:(id:string)=>b.units[s.units.findIndex(u=>u.id===id)]};};
  const trigger=(b:Battle,n:number)=>(b as unknown as {runTurnTriggers:(n:number)=>void}).runTurnTriggers(n);
  it('法场六人按原回合成为玩家单位，乔装演员不提前转阵营，花荣可亲自松绑宋江', () => {
    const {s,b,get}=open('fachang');
    for(const id of ['huarong','huangxin','lufang','guosheng','yanshun','wangying']){expect(get(id).side).toBe('player');expect(get(id).present).toBe(false);}
    expect(s.units.filter(u=>u.id.endsWith('_d')).every(u=>u.side==='ally')).toBe(true);
    trigger(b,1);for(const id of ['huarong','huangxin','lufang','guosheng'])expect(get(id).present,id).toBe(true);
    expect(get('yanshun').present).toBe(false);expect(get('wangying').present).toBe(false);
    const sj=get('songjiang'),hr=get('huarong');hr.x=sj.x+1;hr.y=sj.y;
    (b as unknown as {afterAction:()=>void}).afterAction();expect(b.isBound(sj)).toBe(false);
    trigger(b,2);expect(get('yanshun').present).toBe(true);
    trigger(b,3);expect(get('wangying').present).toBe(true);expect(get('wangying').classId).toBe(rt.classIds.get('wangying'));
    for(const id of ['zhugui','zhengtianshou','shiyong'])expect(get(id).side).toBe('ally');
  });
  it('王英定义、专属技能和头像与主线一致，新增技能不丢失', () => {
    const main=JSON.parse(fs.readFileSync('packs/mainline/pack.json','utf8')).classes.find((c:{id:string})=>c.id==='wangying');
    const jiang=JSON.parse(fs.readFileSync('packs/jiangzhou/pack.json','utf8')).classes.find((c:{id:string})=>c.id==='wangying');
    expect(jiang).toEqual(main);
    expect(fs.readFileSync('packs/jiangzhou/faces/wangying.png')).toEqual(fs.readFileSync('packs/mainline/faces/wangying.png'));
    const skills=rt.data.classes[rt.classIds.get('wangying')!].skills.filter(s=>s.name.startsWith('三岔毒龙枪'));
    expect(skills.map(s=>s.mpCost)).toEqual([30,55,80,105]);
  });
  it('白龙庙吴用随宋江等七人守庙，第5回合26人可控', () => {
    const {b,get}=open('bailongmiao');expect(b.active().filter(u=>u.side==='player')).toHaveLength(7);
    expect(get('wuyong')).toMatchObject({side:'player',present:true,classId:10,x:24,y:41});expect(b.canAct(get('wuyong'))).toBe(true);
    for(const id of ['zhangshun','zhangheng','lijun'])expect(get(id).present).toBe(false);
    for(let n=2;n<=4;n++)(b as unknown as {startTurn:(n:number)=>void}).startTurn(n);
    expect(b.active().filter(u=>u.side==='player')).toHaveLength(16);
    (b as unknown as {startTurn:(n:number)=>void}).startTurn(5);expect(b.active().filter(u=>u.side==='player')).toHaveLength(26);
    for(const id of ['yanshun','zhangshun','lijun','lufang','guosheng','zhangheng']){expect(get(id).side).toBe('ally');expect(get(id).present).toBe(true);expect(b.canAct(get(id)),id).toBe(false);expect(b.autoActUnits()).not.toContain(get(id));}
    (b as unknown as {startPhase:(side:'ally')=>void}).startPhase('ally');
    for(const id of ['yanshun','zhangshun','lijun','lufang','guosheng','zhangheng'])expect(b.canAct(get(id)),id).toBe(true);
    for(const id of ['lili','muhong','muchun','tongwei','tongmeng','xueyong']){expect(get(id).side).toBe('ally');expect(get(id).present).toBe(true);}
  });
  it('左侧白龙庙为自拼地图，七名守庙者在院前，敌军仍集中中部，所有落点连通', () => {
    const {s,b}=open('bailongmiao'),friends=s.units.filter(u=>u.side!=='enemy'&&!u.hidden);
    expect(s.map).toEqual({custom:'bailongmiao'});
    expect(friends.map(u=>u.id).sort()).toEqual(['songjiang','wuyong','daizong','likui','chaogai','huarong','liutang'].sort());
    for(const u of friends){expect(u.y-u.x,u.id).toBeGreaterThanOrEqual(14);expect(Math.abs(u.x-24)+Math.abs(u.y-42),u.id).toBeLessThanOrEqual(5);}
    const foes=s.units.filter(u=>u.side==='enemy'&&!u.hidden);
    expect(foes).toHaveLength(50);for(const u of foes)expect(Math.abs(u.x-30)+Math.abs(u.y-28),u.id).toBeLessThanOrEqual(12);
    expect(s.units.find(u=>u.id==='dujian')).toMatchObject({x:28,y:20,facing:2});
    const field=b.board.distanceField([s.units.find(u=>u.id==='dujian')!]);const used=new Set<string>();
    for(const u of s.units.filter(u=>!u.id.startsWith('boss-'))){expect(b.board.passable(u.x,u.y),u.id).toBe(true);expect(Number.isFinite(field[u.y*b.board.width+u.x]),u.id).toBe(true);expect(used.has(`${u.x},${u.y}`),u.id).toBe(false);used.add(`${u.x},${u.y}`);}
  });
  it('其余34人开场隐藏，四批援军每批都有接应对白，未到回合不提前登场', () => {
    const {s,b,get}=open('bailongmiao');const expected:Record<number,string[]>={2:['ruanxiaoer','ruanxiaowu','ruanxiaoqi','baisheng','duqian','songwan'],3:['yanshun','huangxin','wangying','zhugui','zhengtianshou','shiyong'],4:['gongsunsheng','zhangshun','zhangheng','lijun','lili','muhong','muchun','tongwei','tongmeng','xueyong'],5:['lufang','guosheng','zhuwu','chenda','yangchun','shijin','luzhishen','wulong','wusong','linchong','yangzhi','qinming']};
    for(const id of Object.values(expected).flat())expect(get(id).present,id).toBe(false);
    for(let turn=2;turn<=5;turn++) {
      const block=s.script.find(b=>typeof b.on==='object'&&'turn' in b.on&&b.on.turn===turn)!;
      expect(block.do.filter(op=>op[0]==='say')).not.toHaveLength(0);
      trigger(b,turn-1);for(const id of expected[turn])expect(get(id).present,id).toBe(true);
      for(const [later,ids]of Object.entries(expected))if(Number(later)>turn)for(const id of ids)expect(get(id).present,id).toBe(false);
    }
  });
  it('初始45人主阵横列紧排，行间空一格，行头各留一格再放单骑，统一朝左下', () => {
    const {s,b,get}=open('bailongmiao'),army=s.units.filter(u=>u.side==='enemy'&&!u.hidden),boss=get('dujian');
    expect(army).toHaveLength(50);for(const u of army)expect(u.facing,u.id).toBe(2);
    expect(army.filter(u=>u.class===38)).toHaveLength(3);expect(army.filter(u=>u.class===36)).toHaveLength(3);
    const guards=army.filter(u=>u.ai===2);expect(guards).toHaveLength(4);
    for(const u of guards)expect(Math.abs(u.x-boss.x)+Math.abs(u.y-boss.y),u.id).toBeLessThanOrEqual(2);
    const attackers=army.filter(u=>u.id!=='dujian'&&u.ai!==2);expect(attackers).toHaveLength(45);
    for(let rank=0;rank<6;rank++) {
      const y=24+rank*2,cols=rank===5?[26,27,28]:[25,26,27,28,29,30];
      const row=attackers.filter(u=>u.y===y),horse=row.filter(u=>u.class===43),foot=row.filter(u=>u.class!==43);
      expect(foot.map(u=>u.x).sort((a,b)=>a-b)).toEqual(cols);expect(foot.length).toBeLessThanOrEqual(6);
      expect(horse.map(u=>u.x).sort((a,b)=>a-b)).toEqual([cols[0]-2,cols[cols.length-1]+2]);
      expect(row.some(u=>u.x===cols[0]-1||u.x===cols[cols.length-1]+1)).toBe(false);
      expect(army.some(u=>u.y===y+1)).toBe(false);
    }
    b.phase='enemy';for(const u of attackers){expect(get(u.id).ai.mode,u.id).toBe(0);expect(b.moveRange(get(u.id)).green.length,u.id).toBeGreaterThan(0);}
    const archers=attackers.filter(u=>u.class===34),foot=attackers.filter(u=>u.class===32||u.class===33);
    expect(Math.max(...archers.map(u=>u.y))).toBeLessThanOrEqual(Math.min(...foot.map(u=>u.y)));
  });
  it('开场都监点名捉拿宋江并威胁阻拦者，好汉回应并明确背水一战的两条胜路', () => {
    const ops=stage('bailongmiao').script.find(b=>b.on==='start')!.do;
    const threat=ops.findIndex(op=>op[0]==='say'&&op[1]==='dujian'&&String(op[2]).includes('捉拿反贼宋江'));
    const response=ops.findIndex((op,i)=>i>threat&&op[0]==='say'&&op[1]==='songjiang');
    const stand=ops.findIndex((op,i)=>i>response&&op[0]==='say'&&String(op[2]).includes('背水一战'));
    expect(threat).toBeGreaterThan(-1);expect(String(ops[threat][2])).toContain('一律格杀');expect(response).toBeGreaterThan(threat);expect(stand).toBeGreaterThan(response);
    expect(String(ops[stand][2])).toContain('二十回合');expect(String(ops[stand][2])).toContain('打倒那都监');
  });
  it('都监体力始终为普通模板四倍，每回合两骑兵两官吏一都头在身边出现并主动进攻', () => {
    const {s,b,get}=open('bailongmiao'),boss=get('dujian');
    const normal=computeStats(b.data.classes[boss.classId],boss.level,boss.slots,b.data,false,boss.forge,[],boss.side);
    expect(boss.hp).toBe(normal.maxHp*4);expect(boss.stats.maxHp).toBe(normal.maxHp*4);
    refreshStats(boss,b.data);refreshStats(boss,b.data);expect(boss.stats.maxHp).toBe(normal.maxHp*4);
    const rewind=open('bailongmiao');(rewind.b as unknown as {startTurn:(n:number)=>void}).startTurn(2);rewind.get('dujian').hp=1;rewind.b.rewind();refreshStats(rewind.get('dujian'),rewind.b.data);expect(rewind.get('dujian').stats.maxHp).toBe(normal.maxHp*4);expect(rewind.get('dujian').hp).toBe(normal.maxHp*4);
    const cavalry=s.units.filter(u=>u.id.startsWith('boss-'));expect(cavalry).toHaveLength(100);
    for(let turn=1;turn<=20;turn++) {
      if(turn>1)trigger(b,turn-1);
      const pair=cavalry.filter(u=>u.id.startsWith(`boss-cav-${turn}-`)||u.id.startsWith(`boss-support-${turn}-`));expect(pair).toHaveLength(5);expect(pair.map(u=>u.class).sort()).toEqual([36,36,38,43,43]);
      for(const u of pair){const actual=get(u.id);expect(actual.present&&actual.alive,u.id).toBe(true);expect(actual.ai.mode).toBe(0);expect(Math.abs(actual.x-boss.x)+Math.abs(actual.y-boss.y),u.id).toBeLessThanOrEqual(12);}
      const live=b.active();expect(new Set(live.map(u=>`${u.x},${u.y}`)).size).toBe(live.length);
      expect(b.active().filter(u=>u.name==='都监亲随马军')).toHaveLength(turn*2);
    }
  });
  it('282名敌人、55名开场敌军，19波每波6人以2×3从下方右方交替进入，守满20回合判胜', () => {
    const {s,b}=open('bailongmiao'),enemies=s.units.filter(u=>u.side==='enemy');
    expect(enemies).toHaveLength(282);expect(b.active().filter(u=>u.side==='enemy')).toHaveLength(55);
    const additions=enemies.filter(u=>u.id.startsWith('dense-')||/^r\d+_[45]$/.test(u.id));expect(additions).toHaveLength(56);
    const field=b.board.distanceField([s.units.find(u=>u.id==='songjiang')!]);
    for(const u of [...additions,...enemies.filter(u=>/^r2_[123]$/.test(u.id))]) {
      expect(b.board.passable(u.x,u.y),u.id).toBe(true);expect(Number.isFinite(field[u.y*b.board.width+u.x]),u.id).toBe(true);
      expect(s.units.filter(v=>u.x===v.x&&u.y===v.y),u.id).toHaveLength(1);
    }
    for(let turn=2;turn<=20;turn++) {
      const wave=enemies.filter(u=>u.id.startsWith(`r${turn}_`));expect(wave,`turn${turn}`).toHaveLength(6);
      const block=s.script.find(b=>typeof b.on==='object'&&'turn' in b.on&&b.on.turn===turn)!;
      const arrivals=block.do.filter(op=>op[0]==='appear').map(op=>s.units.find(u=>u.id===op[1])!).filter(u=>u.side==='enemy'&&!u.id.startsWith('boss-'));
      const spike=arrivals.filter(u=>u.id.startsWith('spike'));
      expect(spike).toHaveLength([3,7,11].includes(turn)?6:0);
      expect(arrivals).toHaveLength([3,7,11].includes(turn)?12:6);
      expect(wave.some(u=>u.class===38)).toBe(true);expect(wave.some(u=>u.class===36)).toBe(true);
      for(const squad of [wave,...(spike.length?[spike]:[])]) {
        const xs=[...new Set(squad.map(u=>u.x))].sort((a,b)=>a-b),ys=[...new Set(squad.map(u=>u.y))].sort((a,b)=>a-b);
        expect(xs).toEqual([xs[0],xs[0]+1,xs[0]+2]);expect(ys).toEqual([ys[0],ys[0]+2]);
        for(const y of ys)expect(squad.filter(u=>u.y===y)).toHaveLength(3);
      }
      expect(s.units.some(u=>u.id.startsWith('w3_')||u.id.startsWith('w7_'))).toBe(false);
      for(const u of arrivals) expect(turn%2===0?u.x+u.y>=86:u.x-u.y>=18,`${turn}/${u.id}`).toBe(true);
      trigger(b,turn-1);for(const u of arrivals){const actual=b.units[s.units.indexOf(u)];expect(actual.present,u.id).toBe(true);expect([actual.x,actual.y],u.id).toEqual([u.x,u.y]);}
    }
    expect(b.status).toBe('playing');expect(b.turnLimit).toBe(20);
    (b as unknown as {startTurn:(n:number)=>void}).startTurn(21);expect(b.status).toBe('won');
  });
});


it('白龙庙扩展聚义共41人，武龙武松不同角色，武松秦明沿用主线技能', () => {
  const rt=loadPackFromDisk('jiangzhou'),s=rt.stages.find(s=>s.id==='bailongmiao')!;
  expect(s.units.filter(u=>u.side!=='enemy')).toHaveLength(41);
  expect(s.units.find(u=>u.id==='wulong')!.class).toBe(0);expect(s.units.find(u=>u.id==='wusong')!.class).toBe('wusong');
  for(const id of ['wusong','qinming']) {
    const original=JSON.parse(fs.readFileSync('packs/mainline/pack.json','utf8')).classes.find((c:{id:string})=>c.id===id);
    const copied=JSON.parse(fs.readFileSync('packs/jiangzhou/pack.json','utf8')).classes.find((c:{id:string})=>c.id===id);
    expect(copied).toEqual(original);
  }
  expect(s.script.find(b=>typeof b.on==='object'&&'turn' in b.on&&b.on.turn===6)!.do.some(o=>o[0]==='say'&&String(o[2]).includes('四十一个'))).toBe(true);
});
