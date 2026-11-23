import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf, chapterSequence, insertPlaces } from '../src/rules/chapters.ts';
import { pendingInsert, newCampaign } from '../src/rules/campaign.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(path.join(DATA,'Data/Human.hum')))('大名府斗武', () => {
  const rt=loadPackFromDisk('mainline'),s=rt.stages.find(s=>s.id==='daming-duel')!,files=new NodeFiles(DATA);
  const make=()=>new Battle(compileStage(rt,s,files,{seed:1}));
  const get=(b:Battle,id:string)=>b.units[s.units.findIndex(u=>u.id===id)];
  const check=(b:Battle)=>(b as unknown as {afterAction:()=>void}).afterAction();
  it('第十章先教场再赤发鬼、三阮，连续及直接选关均能接续', () => {
    expect(chapterOf('mainline/daming-duel')).toBe(10);
    const opening=JSON.stringify(s.script.find(x=>x.on==='start')!.do);expect(opening).toMatch(/武龙一干好汉杀退了追骑[^"]*按下不表/);
    const sequence=chapterSequence().filter(x=>x.chapter===10).map(x=>x.key);
    expect(sequence.slice(0,4)).toEqual(['mainline/daming-duel','mainline/chifagui','mainline/sanruan','Act10-1']);
    const places=insertPlaces();expect(places.find(p=>p.ref==='mainline/daming-duel')?.before).toBe('Act10-1');
    expect(pendingInsert(newCampaign(),places,'Act10-1')).toBe('mainline/daming-duel');
    expect(pendingInsert(newCampaign(),places,'Act10-1','before','mainline/daming-duel')).toBe('mainline/chifagui');
  });
  it('校场所有落点连通不重叠，独控杨志，三名对手不同模型，观众不能行动或受技能波及', () => {
    const b=make(),occupied=new Set<string>(),field=b.board.distanceField([get(b,'yangzhi')]);
    for(const u of b.units){expect(b.board.passable(u.x,u.y),u.name).toBe(true);expect(Number.isFinite(field[u.y*b.board.width+u.x]),u.name).toBe(true);expect(occupied.has(`${u.x},${u.y}`),u.name).toBe(false);occupied.add(`${u.x},${u.y}`);}
    expect(new Set(['licheng','zhoujin','suochao'].map(id=>get(b,id).classId)).size).toBe(3);
    expect(b.units.filter(u=>u.side==='enemy'&&u.present)).toHaveLength(0);
    const ev=b.begin();expect(get(b,'liangzhongshu').classId).toBe(54);expect(get(b,'suochao').classId).toBe(71);expect(ev).toContainEqual({type:'portrait',classId:71,file:'@class:32'});expect(b.status).toBe('playing');expect(b.active().filter(u=>u.side==='player').map(u=>u.classId)).toEqual([14]);
    expect(b.active().filter(u=>u.side==='enemy').map(u=>u.name)).toEqual(['李成']);
    expect(b.spectators.size).toBe(26);
    const enemy=get(b,'licheng'),watch=get(b,'watch-1');enemy.x=watch.x;enemy.y=watch.y+1;
    expect(b.foesOf(enemy).map(u=>u.classId)).toEqual([14]);
    const skill=rt.data.classes[enemy.classId].skills[0];
    expect(b.affected(enemy,skill,watch)).not.toContain(watch);
    b.phase='ally';expect(b.canAct(watch)).toBe(false);expect(b.canMove(watch)).toBe(false);
    expect(ev.some(e=>(e.type==='narrate'||e.type==='say')&&e.text.includes('牛二'))).toBe(true);
  });
  it.each(['points','knockdown'] as const)('三场按顺序推进，%s路径都只出一个对手，胜出后才交代押纲', mode => {
    const b=make();const events:BattleEvent[]=[...b.begin()];const yang=get(b,'yangzhi');
    expect(events.some(e=>(e.type==='say'||e.type==='narrate')&&e.text.includes('押送生辰纲'))).toBe(false);
    for(const [i,id] of ['licheng','zhoujin','suochao'].entries()) {
      const enemy=get(b,id);expect(b.active().filter(u=>u.side==='enemy').map(u=>u.uid)).toEqual([enemy.uid]);
      yang.hp=20;yang.mp=0;
      if(mode==='points')enemy.hp=Math.floor(enemy.stats.maxHp*.39);
      else (b as unknown as {kill:(a:Unit,t:Unit)=>void}).kill(yang,enemy);
      check(b);events.push(...(b as unknown as {flush:()=>BattleEvent[]}).flush());
      expect(b.status).toBe(i===2?'won':'playing');
      if(i<2){expect(yang.hp).toBe(yang.stats.maxHp);expect(yang.mp).toBe(yang.stats.maxMp);}
      check(b);expect(b.status).toBe(i===2?'won':'playing');
    }
    const arrowShots=events.filter(e=>e.type==='shot');
    expect(arrowShots.length).toBeGreaterThanOrEqual(mode==='points'?4:0);
    expect(events.some(e=>(e.type==='say'||e.type==='narrate')&&e.text.includes('生辰纲'))).toBe(true);
  });
  it('杨志倒下与超时失败，不能靠观众存活拖住败局', () => {
    const b=make();b.begin();(b as unknown as {kill:(a:Unit,t:Unit)=>void}).kill(get(b,'licheng'),get(b,'yangzhi'));check(b);expect(b.status).toBe('lost');
    const time=make();time.begin();(time as unknown as {runTurnTriggers:(n:number)=>void}).runTurnTriggers(30);expect(time.status).toBe('lost');
  });
});
