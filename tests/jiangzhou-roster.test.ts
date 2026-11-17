import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('白龙庙开场17人可控，第4回合水军三人可控，另六人仍为友军', () => {
    const {b,get}=open('bailongmiao');expect(b.active().filter(u=>u.side==='player')).toHaveLength(17);
    for(const id of ['zhangshun','zhangheng','lijun'])expect(get(id).present).toBe(false);
    for(let n=1;n<=3;n++)trigger(b,n);
    expect(b.active().filter(u=>u.side==='player')).toHaveLength(20);
    for(const id of ['zhangshun','zhangheng','lijun']){expect(get(id).side).toBe('player');expect(get(id).present).toBe(true);}
    for(const id of ['lili','muhong','muchun','tongwei','tongmeng','xueyong']){expect(get(id).side).toBe('ally');expect(get(id).present).toBe(true);}
  });
  it('115名敌人、50名开场敌军，密集增兵及第2回合修复援军均可接战，11波各增加2人', () => {
    const {s,b}=open('bailongmiao'),enemies=s.units.filter(u=>u.side==='enemy');
    expect(enemies).toHaveLength(115);expect(b.active().filter(u=>u.side==='enemy')).toHaveLength(50);
    const additions=enemies.filter(u=>u.id.startsWith('dense-')||/^r\d+_[45]$/.test(u.id));expect(additions).toHaveLength(40);
    const field=b.board.distanceField([s.units.find(u=>u.id==='songjiang')!]);
    for(const u of [...additions,...enemies.filter(u=>/^r2_[123]$/.test(u.id))]) {
      expect(b.board.passable(u.x,u.y),u.id).toBe(true);expect(Number.isFinite(field[u.y*b.board.width+u.x]),u.id).toBe(true);
      expect(s.units.filter(v=>u.x===v.x&&u.y===v.y),u.id).toHaveLength(1);
    }
    for(let turn=2;turn<=12;turn++) {
      const wave=enemies.filter(u=>u.id.startsWith(`r${turn}_`));expect(wave,`turn${turn}`).toHaveLength(5);
      trigger(b,turn-1);for(const u of wave)expect(b.units[s.units.indexOf(u)].present,u.id).toBe(true);
    }
    expect(b.status).toBe('playing');trigger(b,12);expect(b.status).toBe('won');
  });
});
