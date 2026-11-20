// 扩展包（docs/game-design.md §15）：并入原版数据、关卡编译、外传「武松打虎」的剧本触发。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { announcesSkill, areaCells, learnedSkills } from '../src/rules/skills.ts';
import { planAi } from '../src/rules/ai.ts';
import { rangedFactor } from '../src/rules/combat.ts';
import { Board } from '../src/rules/board.ts';
import { fxSpots, skillFx } from '../src/game/effects.ts';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { compileStage } from '../src/packs/build.ts';
import { paintShoes, recolorLut } from '../src/packs/recolor.ts';
import { DIRS, attackSkill, type Unit } from '../src/rules/unit.ts';
import { packParty, townParty, saveTownParty, recordPackResult } from '../src/packs/campaign.ts';
import { buy, pawn, stock } from '../src/rules/town.ts';
import { insertTownName, prepareInsertTown, insertTownIntro } from '../src/packs/towns.ts';
import { inheritAssets, pendingInsert, recordResult, type CampaignState } from '../src/rules/campaign.ts';
import { insertPlaces } from '../src/rules/chapters.ts';
/** 章节表算出的插关位置：关卡 id → before / after */
const placeOf = (id: string) => insertPlaces().find((p) => p.ref === `mainline/${id}`);
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('黄信镇三山与寒锋五叠',()=>{
  it.each(['mainline'])('%s三级范围按选点起算，射程与落剑特效正确',pack=>{
    const rt=loadPackFromDisk(pack),cls=rt.data.classes[rt.classIds.get('huangxin')!],board=new Board(30,30),from={x:15,y:15};
    const aoe=cls.skills.filter(s=>s.name.startsWith('镇三山'));
    expect(aoe).toHaveLength(3);
    for(const [i,s]of aoe.entries()){
      expect([s.rangeMin,s.rangeMax,s.area,s.mpCost,s.learnLevel]).toEqual([1,i+3,i+1,[35,50,65][i],[4,16,20][i]]);
      expect(s.areaOrigin).toBe('target');expect(skillFx(s)).toMatchObject({first:14,then:null,onTarget:null});
      for(const dir of DIRS){
        const at={x:from.x+dir.x*3,y:from.y+dir.y*3},cells=areaCells(board,from,s,at);
        expect(cells).toHaveLength(3*(i+1));
        expect(cells).toContainEqual(at);expect(cells).not.toContainEqual(from);
        for(const c of cells){const dx=c.x-at.x,dy=c.y-at.y;expect(dx*dir.x+dy*dir.y).toBeGreaterThanOrEqual(0);expect(dx*dir.x+dy*dir.y).toBeLessThan(i+1);expect(Math.abs(dx*dir.y+dy*dir.x)).toBeLessThanOrEqual(1);}
        expect(fxSpots(s,from,at,cells).map(x=>x.ring).sort()).toEqual(Array.from({length:i+1},(_,depth)=>[depth,depth,depth]).flat());
      }
    }
    for(const [level,rank] of [[3,0],[4,1],[15,1],[16,2],[20,3]]){const learned=learnedSkills({classId:cls.id,level} as Unit,rt.data).filter(s=>s.name.startsWith('镇三山'));expect(learned.map(s=>s.name)).toEqual(rank?[`镇三山LV${rank}`]:[]);}
    const five=cls.skills.find(s=>s.name==='寒锋五叠')!;
    expect([five.power,five.hitMod,five.mpCost,five.rangeMax,five.area,five.castCycles,five.castSpeed]).toEqual([50,20,45,1,1,5,4]);
    expect(five.hits.map(h=>h.frame)).toEqual([11,40,69,98,127]);expect(five.hits.map(h=>h.percent)).toEqual([20,20,20,20,20]);
    expect(cls.skills.map(s=>[s.name,s.learnLevel])).toContainEqual(['聚气',12]);
    const s=aoe[2],edge=areaCells(board,{x:0,y:3},s,{x:0,y:0});expect(edge).toHaveLength(2);expect(edge.every(c=>board.inBounds(c.x,c.y))).toBe(true);
    // 默认的前方矩形不受新选点模式影响。
    expect(areaCells(board,from,{...aoe[0],areaOrigin:undefined},{x:15,y:12})).toContainEqual({x:15,y:14});
  });
  it('寒锋五叠实际只打一个目标，扣一次耗气，五段合计为总伤害',()=>{
    const rt=loadPackFromDisk('mainline'),stage=rt.stages.find(s=>s.id==='liufeng')!,b=new Battle(compileStage(rt,stage,new NodeFiles(DATA),{seed:7}));b.begin();
    const u=b.units.find(u=>u.classId===rt.classIds.get('huangxin'))!,target=b.active().find(u=>u.side==='enemy')!,s=rt.data.classes[u.classId].skills.find(s=>s.name==='寒锋五叠')!;
    u.x=7;u.y=10;target.x=7;target.y=9;u.stats.hit=10000;const mp=u.mp;
    const attack=b.useSkill(u,s,target).find(e=>e.type==='attack');expect(attack?.type).toBe('attack');
    if(attack?.type!=='attack')throw Error('技能未施放');expect(attack.hits).toHaveLength(1);const r=attack.hits[0].result;expect(r.parts).toHaveLength(5);expect(r.parts.reduce((a,b)=>a+b,0)).toBe(r.damage);expect(u.mp).toBe(mp-45);
  });
});


describe.skipIf(!has)('花荣与白胜监守自盗远程衰减', () => {
  it.each(['mainline'])('%s花荣与白胜监守自盗使用100%到60%，其他远程不变', (pack) => {
    const rt = loadPackFromDisk(pack);
    const id = rt.classIds.get('huarong')!;
    expect(rt.data.classes[id].skills[0].rangedDamage).toEqual([1, 0.6]);
    expect(rt.data.classes.filter(c=>c.id<18).flatMap(c=>c.skills).filter(s=>[48,49,50].includes(s.skillId))).toHaveLength(3);
    for (const c of rt.data.classes) for (const skill of c.skills) {
      if(c.id<18&&[48,49,50].includes(skill.skillId)){
        expect(skill.rangedDamage).toEqual([1,0.6]);
        const actor={x:0,y:0,stats:{rangeBonus:0}} as Unit;
        expect(rangedFactor(actor,{x:0,y:1} as Unit,skill)).toBeCloseTo(1);
        expect(rangedFactor(actor,{x:0,y:skill.rangeMax} as Unit,skill)).toBeCloseTo(0.6);
        actor.stats.rangeBonus=2;expect(rangedFactor(actor,{x:0,y:skill.rangeMax+2} as Unit,skill)).toBeCloseTo(0.6);
      }else if (c.id !== id) expect(skill.rangedDamage, `${pack}/${c.name}/${skill.name}`).toBeUndefined();
    }
  });
});

describe('宋江杀惜剧本', () => {
  it('送别后阎婆惜才入场看信，宋江回来后才起争执', () => {
    const stage = JSON.parse(fs.readFileSync('packs/mainline/stages/songjiang-yanshixi.json', 'utf8'));
    const actions = stage.script[0].do as string[][];
    const index = (action: string, value: string) => actions.findIndex((a) => a[0] === action && a[1] === value);
    const liuLeaves = index('leave', 'liutang');
    const songLeaves = index('leave', 'songjiang');
    const enters = (id: string, from = 0) => actions.findIndex((a, i) => i >= from && (a[0] === 'appear' || a[0] === 'move') && a[1] === id);
    const liuEnters = enters('liutang');
    const yanAppears = enters('yanpoxishi');
    const readsLetter = actions.findIndex((a) => a[0] === 'narrate' && a[1].includes('藏起'));
    const songReturns = enters('songjiang', songLeaves);
    const dispute = actions.findIndex((a, i) => i > songReturns && a[0] === 'say' && a[1] === 'songjiang');
    expect(stage.units.find((u: { id: string }) => u.id === 'yanpoxishi').hidden).toBe(true);
    expect(stage.units.find((u: { id: string }) => u.id === 'liutang').hidden).toBe(true);
    // 刘唐、宋江进出门都走路：入场第一个动作是 move，每次退场前最后一个动作也是 move
    const lastMoveBefore = (id: string, i: number) => actions.slice(0, i).filter((x) => x[1] === id && x[0] !== 'say').at(-1)?.[0];
    expect(actions[liuEnters][0]).toBe('move');
    expect(lastMoveBefore('liutang', liuLeaves)).toBe('move');
    actions.forEach((x, i) => { if (x[0] === 'leave' && x[1] === 'songjiang') expect(lastMoveBefore('songjiang', i)).toBe('move'); });
    expect(actions[songReturns][0]).toBe('move');
    expect(liuLeaves).toBeGreaterThan(-1);
    expect(songLeaves).toBeGreaterThan(liuLeaves);
    expect(yanAppears).toBeGreaterThan(songLeaves);
    expect(readsLetter).toBeGreaterThan(yanAppears);
    expect(songReturns).toBeGreaterThan(readsLetter);
    expect(dispute).toBeGreaterThan(songReturns);
    expect(actions.slice(0, yanAppears).some((a) => a[0] === 'say' && a[1] === 'yanpoxishi')).toBe(false);
  });
});

describe.skipIf(!has)('主线续篇：景阳冈（武松打虎，原外传）', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const base = has ? loadGameData(files, tr) : (null as never);
  const rt = has ? loadPackFromDisk('mainline', base) : (null as never);
  const stage = has ? rt.stages.find((s) => s.id === 'jingyanggang')! : (null as never);
  const start = (seed = 1) => {
    const b = new Battle(compileStage(rt, stage, files, { seed, text: tr }));
    const ev = b.begin();
    const ws = b.units.find((u) => u.classId === rt.classIds.get('wusong'))!;
    const tiger = b.units.find((u) => u.classId === rt.classIds.get('tiger'))!;
    return { b, ev, ws, tiger };
  };
  // 直接结算一次出手（跳过回合和走位），再跑出手后的剧本触发
  const strike = (b: Battle, u: Unit, skill = attackSkill(u, b.data), at: Unit) => {
    const x = b as unknown as { out: BattleEvent[]; cast: (...a: unknown[]) => void; afterAction: () => void; flush: () => BattleEvent[] };
    x.out = [];
    x.cast(u, skill, { x: at.x, y: at.y }, false);
    x.afterAction();
    return x.flush();
  };
  const besides = (ws: Unit, tiger: Unit) => {
    tiger.present = true;
    tiger.x = ws.x;
    tiger.y = ws.y - 1;
  };

  it('职业、技能、道具接在原版后面，原版数据不变', () => {
    const ws = rt.classIds.get('wusong')!;
    expect(ws).toBeGreaterThanOrEqual(base.classes.length);
    expect(rt.classIds.get('tiger')).toBe(ws + 1);
    expect(rt.data.classes[ws].name).toBe('武松');
    expect(rt.data.charNames[ws + 1]).toBe('吊睛白额虎');
    expect([...rt.skillIds.values()].every((id) => id >= 2000)).toBe(true);
    const staff = rt.data.items[rt.itemIds.get('shaobang')! - 1];
    expect(staff.name).toBe('哨棒');
    expect(staff.attack).toBe(15);
    expect(base.items.length).toBe(rt.data.items.length - rt.itemIds.size);
    // 老虎的出手动作：普攻、一扑同一个动作（组 0），一掀、一剪同一个（组 1）
    const tigerSkills = rt.data.classes[rt.classIds.get('tiger')!].skills;
    expect(tigerSkills.map((s) => s.group)).toEqual([0, 0, 1, 1]);
    expect(rt.looks.get(rt.classIds.get('tiger')!)!.actions.slice(3)).toEqual(['attack', 'attack-paw']);
  });

  it('武松用包里自己的头像（140 宽），老虎没有头像', () => {
    const face = rt.looks.get(rt.classIds.get('wusong')!)!.face;
    expect(typeof face).toBe('string');
    const png = fs.readFileSync(path.join('packs/mainline', face as string));
    expect(png.readUInt32BE(16)).toBe(140); // IHDR 宽
    expect(rt.looks.get(rt.classIds.get('tiger')!)!.face).toBeNull();
  });

  it('开场：老虎埋伏不在场，有回合限制和胜负条件，武松带着哨棒', () => {
    const { b, ws, tiger } = start();
    expect(tiger.present).toBe(false);
    expect(b.turnLimit).toBe(15);
    expect(b.objectives.join()).toContain('吊睛白额大虫');
    expect(ws.slots[0]).toBe(rt.itemIds.get('shaobang'));
    // 接在终章续篇里，和前后两段的宋江、武松对齐（负责人 2026-11-15）
    expect(ws.level).toBe(27);
    expect(tiger.level).toBe(29);
  });

  it('武松走上冈，老虎登场', () => {
    const { b, ws, tiger } = start();
    const x = b as unknown as { afterAction: () => void };
    ws.y = 9;
    x.afterAction();
    expect(tiger.present).toBe(true);
  });

  it('武松第一次出手后哨棒折断，换成空手', () => {
    const { b, ws, tiger } = start();
    besides(ws, tiger);
    const atk0 = ws.stats.attack;
    const ev = strike(b, ws, undefined, tiger);
    expect(ws.slots[0]).toBe(0);
    expect(ws.stats.attack).toBe(atk0 - 15);
    expect(ev.some((e) => e.type === 'say' && /哨棒折做两截/.test(e.text))).toBe(true);
  });

  it('老虎一扑、一掀、一剪都用过之后，攻击和敏捷减半', () => {
    const { b, ws, tiger } = start();
    besides(ws, tiger);
    const [, pu, xian, jian] = b.data.classes[tiger.classId].skills;
    const atk = tiger.stats.attack, agi = tiger.stats.agility;
    ws.hp = 9999; // 别让武松先被打死
    strike(b, tiger, pu, ws);
    strike(b, tiger, xian, ws);
    expect(tiger.stats.attack).toBe(atk);
    const ev = strike(b, tiger, jian, ws);
    expect(ev.some((e) => e.type === 'say' && /气性先自没了一半/.test(e.text))).toBe(true);
    expect(Math.abs(tiger.stats.attack - atk / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(tiger.stats.agility - agi / 2)).toBeLessThanOrEqual(0.5);
  });

  it('打死老虎：猎户披着虎皮登场，现出原形，过关', () => {
    const { b, ws, tiger } = start();
    const disguise = rt.classIds.get('hunter-in-tigerskin')!;
    const hunters = b.units.filter((u) => u.classId === disguise);
    expect(hunters.map((u) => u.name)).toEqual(['大虫', '大虫']);
    besides(ws, tiger);
    tiger.hp = 1;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 20 && b.status === 'playing'; i++) ev = strike(b, ws, undefined, tiger);
    expect(b.status).toBe('won');
    // 先以老虎的样子登场，旁白之后换成猎户（李吉的样子），名字是猎户甲、乙
    const appear = ev.findIndex((e) => e.type === 'appear' && e.uid === hunters[0].uid);
    const look = ev.findIndex((e) => e.type === 'look' && e.uid === hunters[0].uid);
    expect(appear).toBeGreaterThanOrEqual(0);
    expect(look).toBeGreaterThan(appear);
    expect(hunters.map((u) => [u.classId, u.name, u.present])).toEqual([[49, '猎户甲', true], [49, '猎户乙', true]]);
    expect(ev.some((e) => e.type === 'say' && e.speaker === '猎户甲' && /披了虎皮/.test(e.text))).toBe(true);
    expect(ev.some((e) => e.type === 'end' && e.result === 'won')).toBe(true);
  });

  it('武松倒下：判负，播放失败文字', () => {
    const { b, ws, tiger } = start();
    besides(ws, tiger);
    ws.hp = 1;
    ws.stats.agility = 0;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 20 && b.status === 'playing'; i++) ev = strike(b, tiger, undefined, ws);
    expect(b.status).toBe('lost');
    expect(ev.some((e) => e.type === 'end' && e.result === 'lost' && /武松力尽/.test(e.text))).toBe(true);
  });

  it('AI 会轮着用老虎的三招', () => {
    const { b, ws, tiger } = start();
    besides(ws, tiger);
    const [, pu] = b.data.classes[tiger.classId].skills;
    expect(b.prefers(tiger, pu)).toBe(true);
    strike(b, tiger, pu, ws);
    expect(b.prefers(tiger, pu)).toBe(false);
  });
});

describe.skipIf(!has)('主线插关：赤发鬼夜战插翅虎', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const rt = has ? loadPackFromDisk('mainline', loadGameData(files, tr)) : (null as never);
  const start = (seed = 1) => {
    const b = new Battle(compileStage(rt, rt.stages.find((s) => s.id === 'chifagui')!, files, { seed, text: tr }));
    const ev = b.begin();
    const of = (cls: number) => b.units.find((u) => u.classId === cls)!;
    return { b, ev, lt: of(17), lh: of(60), wy: of(10), cg: of(12) };
  };
  const strike = (b: Battle, u: Unit, at: Unit) => {
    const x = b as unknown as { out: BattleEvent[]; cast: (...a: unknown[]) => void; afterAction: () => void; flush: () => BattleEvent[] };
    x.out = [];
    x.cast(u, attackSkill(u, b.data), { x: at.x, y: at.y }, false);
    x.afterAction();
    return x.flush();
  };

  it('全用原版人物；开场雷横带 2 个士兵，另 2 个士兵和晁盖、吴用埋伏；说书式开场从主角团转过来', () => {
    const { b, ev, lt, lh, wy, cg } = start();
    expect(lt.level).toBe(21);
    expect(lh.present).toBe(true);
    expect(b.units.filter((u) => u.side === 'enemy' && u.present).length).toBe(3);
    expect(wy.present || cg.present).toBe(false);
    expect(b.objectives.join()).toContain('打倒雷横');
    // 刘唐被吊了一夜：敏捷 −30%，3 回合；雷横手下留情：必杀 −70%
    expect(lt.buffs.some((x) => x.stat === 'agility' && x.value < 0 && x.turns <= 3)).toBe(true);
    expect(lh.buffs.some((x) => x.stat === 'crit' && x.value < 0)).toBe(true);
    expect(ev.some((e) => e.type === 'say' && /赤发鬼/.test(e.text))).toBe(true);
    expect(ev.some((e) => e.type === 'say' && !e.speaker && /武龙/.test(e.text) && /按下不表/.test(e.text))).toBe(true);
  });

  it('第 4 回合士兵增援，第 7 回合吴用、晁盖赶到，过关', () => {
    const { b, lt, lh, wy, cg } = start();
    // 只看回合推进，不让谁先倒下（增减益到期时体力会按上限截断，所以每回合都重设）
    const next = () => {
      lt.hp = lh.hp = 99999;
      return b.endPlayerPhase();
    };
    const hidden = b.units.filter((u) => u.side === 'enemy' && !u.present);
    expect(hidden.length).toBe(2);
    while (b.status === 'playing' && b.turn < 3) next();
    expect(hidden.some((u) => u.present || !u.alive)).toBe(false);
    next();
    expect(hidden.every((u) => u.present || !u.alive)).toBe(true); // 登场（或已被反击打倒）
    let ev: BattleEvent[] = [];
    while (b.status === 'playing' && b.turn < 8) ev = next();
    expect(b.status).toBe('won');
    expect(wy.present && cg.present).toBe(true);
    expect(ev.some((e) => e.type === 'say' && /且不要斗/.test(e.text))).toBe(true);
  });

  it('打倒雷横也过关；刘唐倒下判负', () => {
    const won = start();
    won.lh.hp = 1;
    won.lh.stats.agility = 0;
    won.lh.x = won.lt.x;
    won.lh.y = won.lt.y + 1;
    for (let i = 0; i < 20 && won.b.status === 'playing'; i++) strike(won.b, won.lt, won.lh);
    expect(won.b.status).toBe('won');
    expect(won.wy.present).toBe(true);

    const lost = start();
    lost.lt.hp = 1;
    lost.lt.stats.agility = 0;
    lost.lh.x = lost.lt.x;
    lost.lh.y = lost.lt.y + 1;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 20 && lost.b.status === 'playing'; i++) ev = strike(lost.b, lost.lh, lost.lt);
    expect(lost.b.status).toBe('lost');
    expect(ev.some((e) => e.type === 'end' && /押回郓城县/.test(e.text))).toBe(true);
  });
});

describe.skipIf(!has)('主线插关：火烧瓦罐寺、吴用说三阮（§15.8）', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const base = has ? loadGameData(files, tr) : (null as never);
  const rt = has ? loadPackFromDisk('mainline', base) : (null as never);
  const stageOf = (id: string) => rt.stages.find((s) => s.id === id)!;
  const strike = (b: Battle, u: Unit, at: Unit) => {
    const x = b as unknown as { out: BattleEvent[]; cast: (...a: unknown[]) => void; afterAction: () => void; flush: () => BattleEvent[] };
    x.out = [];
    x.cast(u, attackSkill(u, b.data), { x: at.x, y: at.y }, false);
    x.afterAction();
    return x.flush();
  };
  // 只看回合推进：我方体力拉满，不让谁先倒下（增减益到期会把体力截到上限，所以每回合重设）
  const advance = (b: Battle, to: number) => {
    let ev: BattleEvent[] = [];
    while (b.status === 'playing' && b.turn < to) {
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      ev = b.endPlayerPhase();
    }
    return ev;
  };

  it('主线插关及终章后剧情都已登记，遭遇关开场单位都站在可通行格上', () => {
    expect(rt.stages.filter((s) => !s.sideStory).map((s) => [s.id, placeOf(s.id)?.before, !!s.pov])).toEqual([
      ['jiaochang', 'N01', false],
      ['xihuamen', 'N01', false],
      ['wawasi', 'N-add06', false],
      ['daming-duel', 'Act10-1', true],
      ['chifagui', 'Act10-1', true],
      ['sanruan', 'Act10-1', true],
      ['zhizhulin', 'Act7-1a', false],
      ['songjiang-yanshixi', undefined, false],
      ['songjiazhuang', undefined, true],
      ['chaijin-liubin', undefined, true],
      ['jingyanggang', undefined, true],
      ['tiaolian', undefined, true],
      ['shizilou', undefined, false],
      ...['shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou','xingzhe','wugongling','kongliang','kongjiazhuang','qingfengshan','xingjiutang','yuanxiao','qianghuarong','zhizhan','jieqiuche','yekun','yeshuo','gongpo','duiyingshan','liufeng','shiyong','bensang','toushou','liangshan-jielu','liangshan-songbie','jieyangling','jieyangzhen','mujiazhuang','chuanhuoer','jiangzhou-laocheng','dufang','pipating','xunyanglou','zhuguidian','liangshan-dingji','zhuanshang','jiaxin','fachang','bailongmiao'].map(id => [id,undefined,false]),
    ]);
    const cutscenes = ['xihuamen', 'songjiang-yanshixi', 'chaijin-liubin', 'tiaolian', 'shizipo','anpingzhai','zhangfu','xingzhe','kongjiazhuang','xingjiutang','yuanxiao','zhizhan','yeshuo','duiyingshan','shiyong','toushou','liangshan-songbie','chuanhuoer','jiangzhou-laocheng','xunyanglou','liangshan-dingji'];
    for (const s of rt.stages.filter((x) => !cutscenes.includes(x.id))) {
      const b = new Battle(compileStage(rt, s, files, { seed: 1, text: tr }));
      b.begin();
      expect(b.status).toBe('playing');
      for (const u of b.units.filter((x) => x.present)) expect(b.board.passable(u.x, u.y), `${s.id} ${u.name} (${u.x},${u.y})`).toBe(true);
    }
  });

  it('武松四段（§15.12）：接在义释宋公明后面；单位和 move 的目标格都可通行；过场里每个 move 都走得到；过场演完就过关', () => {
    const after = insertPlaces().filter((p) => p.after === 'N14').map((p) => p.ref.slice('mainline/'.length));
    expect(after).toEqual(['songjiang-yanshixi', 'songjiazhuang', 'chaijin-liubin', 'jingyanggang', 'tiaolian', 'shizilou', 'shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou','xingzhe','wugongling','kongliang','kongjiazhuang','qingfengshan','xingjiutang','yuanxiao','qianghuarong','zhizhan','jieqiuche','yekun','yeshuo','gongpo','duiyingshan','liufeng','shiyong','bensang','toushou','liangshan-jielu','liangshan-songbie','jieyangling','jieyangzhen','mujiazhuang','chuanhuoer','jiangzhou-laocheng','dufang','pipating','xunyanglou','zhuguidian','liangshan-dingji','zhuanshang','jiaxin','fachang','bailongmiao']);
    for (const id of ['chaijin-liubin', 'jingyanggang', 'tiaolian', 'shizilou']) {
      const stage = stageOf(id);
      const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
      for (const u of stage.units) expect(b.board.passable(u.x, u.y), `${id} ${u.id} (${u.x},${u.y})`).toBe(true);
      for (const blk of stage.script)
        for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} move ${op.slice(1).join()}`).toBe(true);
      const ev = b.begin();
      if (id === 'chaijin-liubin' || id === 'tiaolian') {
        expect(b.status, id).toBe('won');
        expect(ev.some((e) => e.type === 'end' && e.result === 'won')).toBe(true);
        // 每个 move 都真的走到了（走不到时剧本会原地不动）
        const moves = stage.script.flatMap((blk) => blk.do.filter((op) => op[0] === 'move'));
        expect(ev.filter((e) => e.type === 'move').length, id).toBe(moves.length);
      } else expect(b.status, id).toBe('playing');
    }
  });

  it('挑帘裁衣：自拼紫石街地图；剧情演出指令（转身、动作、天色、字幕）编进事件，天色最后回到夜里', () => {
    const stage = stageOf('tiaolian');
    expect(stage.map).toMatchObject({ custom: 'zishijie' });
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    const ev = b.begin();
    const tints = ev.filter((e) => e.type === 'tint').map((e) => (e as { tint: string }).tint);
    expect(tints).toContain('snow');
    expect(tints.at(-1)).toBe('night');
    expect(ev.filter((e) => e.type === 'subtitle').length).toBeGreaterThanOrEqual(10);
    const xmq = b.units.find((u) => u.name === '西门庆')!;
    expect(ev.some((e) => e.type === 'act' && e.uid === xmq.uid && e.action === 'attack')).toBe(true);
    expect(ev.some((e) => e.type === 'face')).toBe(true);
    // 演出不改血量
    expect(b.units.every((u) => u.hp === u.stats.maxHp)).toBe(true);
  });

  it('景阳冈：店小二只在对话里出声，不上地图（offstage）', () => {
    const b = new Battle(compileStage(rt, stageOf('jingyanggang'), files, { seed: 1, text: tr }));
    const ev = b.begin();
    const xiao = b.units.find((u) => u.classId === 35)!;
    expect(xiao.present).toBe(false);
    expect(ev.some((e) => e.type === 'say' && e.uid === xiao.uid && e.text.includes('三碗不过冈'))).toBe(true);
    expect(ev.some((e) => e.type === 'appear' && e.uid === xiao.uid)).toBe(false);
  });

  it('狮子楼：开场只有武松带解腕尖刀；西门庆出手踢落刀；第 2 回合宋江一行登场；打倒西门庆和全部手下才过关', () => {
    const stage = stageOf('shizilou');
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    b.begin();
    const mine = () => b.active().filter((u) => u.side === 'player').map((u) => u.name);
    expect(mine()).toEqual(['武松']);
    const ws = b.units.find((u) => u.name === '武松')!;
    expect(rt.data.items[ws.slots[0] - 1].name).toBe('解腕尖刀');
    const xmq = b.units.find((u) => u.name === '西门庆')!;
    const x = b as unknown as { out: BattleEvent[]; cast: (...a: unknown[]) => void; afterAction: () => void; flush: () => BattleEvent[] };
    xmq.x = ws.x + 1; xmq.y = ws.y;
    ws.hp = 9999;
    x.out = [];
    x.cast(xmq, attackSkill(xmq, b.data), { x: ws.x, y: ws.y }, false);
    x.afterAction();
    x.flush();
    expect(ws.slots[0]).toBe(0);
    ws.hp = 9999;
    const arrivalEvents: BattleEvent[] = [];
    while (b.turn < 2 && b.status === 'playing') arrivalEvents.push(...b.endPlayerPhase());
    const uid = (id: string) => stage.units.findIndex(u => u.id === id);
    const songArrival = arrivalEvents.findIndex(e => e.type === 'appear' && e.uid === uid('songjiang'));
    expect(songArrival).toBeGreaterThan(-1);
    for (const id of ['bangxian1', 'bangxian2', 'bangxian3', 'bangxian4', 'bandang3', 'bandang4']) {
      const enemyArrival = arrivalEvents.findIndex(e => e.type === 'appear' && e.uid === uid(id));
      expect(enemyArrival, id).toBeGreaterThan(-1);
      expect(enemyArrival, id).toBeLessThan(songArrival);
    }
    expect(arrivalEvents.some(e => e.type === 'say' && e.uid === uid('songjiang') && e.text.includes('拦住这些帮手'))).toBe(true);
    expect(mine()).toEqual(expect.arrayContaining(['武松', '宋江', '鲁智深', '史进']));
    // 打倒西门庆还不算赢：要把第 3 回合来的护院、徒弟在内的手下全部打倒（负责人 2026-11-15）
    const hit = (t: Unit) => {
      t.hp = 1;
      for (let i = 0; i < 20 && t.alive; i++) {
        ws.x = t.x; ws.y = t.y + 1;
        x.out = [];
        x.cast(ws, attackSkill(ws, b.data), { x: t.x, y: t.y }, false);
        x.afterAction();
      }
    };
    hit(xmq);
    expect(xmq.alive).toBe(false);
    expect(b.status).toBe('playing');
    while (b.turn < 3 && b.status === 'playing') b.endPlayerPhase();
    for (const t of b.units.filter((u) => u.side === 'enemy' && u.present && u.alive)) hit(t);
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && u.present)).toBe(false);
    expect(b.status).toBe('won');
  });

  it('续篇里的包职业（宋江、武松）不记进梁山名单', () => {
    const stage = stageOf('shizilou');
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    b.begin();
    const c = recordResult({ version: 1, stage: 75, members: [], gold: 0 } as unknown as CampaignState, b, { keepActive: true, classLimit: 72 });
    expect(c.members.map((m) => m.classId).sort((p, q) => p - q)).toEqual([0, 3, 16]);
  });

  it('义释宋公明：三人可操作、前三回合敌人分三拨来、30回合，所有人能沿地形互相到达', () => {
    const stage = stageOf('songjiazhuang');
    expect(placeOf(stage.id)?.after).toBe('N14');
    expect(stage.pov).toBe(true);
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    b.begin();
    expect(b.status).toBe('playing');
    expect(b.turnLimit).toBe(30);
    expect(stage.map).toEqual({ base: 'N05', crop: [8, 0, 24, 15] });
    expect([b.board.width, b.board.height]).toEqual([24, 15]);
    expect(b.active().filter((u) => u.side === 'player').map((u) => [u.name, u.x, u.y])).toEqual([['宋江', 10, 5], ['朱仝', 9, 5], ['雷横', 8, 6]]);
    expect(b.active().some((u) => u.name === '宋太公')).toBe(false);
    const enemyCount = () => b.active().filter((u) => u.side === 'enemy').length;
    expect(enemyCount()).toBe(4);
    expect(b.units.filter((u) => u.side === 'enemy')).toHaveLength(14);
    const distances = b.board.distanceField([b.units[0]]);
    const cells = new Set<string>();
    for (const u of b.units.filter((x) => x.name !== '宋太公')) {
      expect(b.board.passable(u.x, u.y)).toBe(true);
      expect(Number.isFinite(distances[u.y * b.board.width + u.x])).toBe(true);
      expect(cells.has(`${u.x},${u.y}`)).toBe(false);
      cells.add(`${u.x},${u.y}`);
    }
    for (const u of b.units.filter((x) => x.side === 'player')) u.hp = 999999;
    advance(b, 2);
    expect(enemyCount()).toBe(8);
    advance(b, 3);
    expect(enemyCount()).toBe(14);
  });

  it('义释宋公明：朱仝横扫、直线破阵，雷横四段连击，两人集气实际回复三分之一', () => {
    const b = new Battle(compileStage(rt, stageOf('songjiazhuang'), files, { seed: 1, text: tr }));
    b.begin();
    const zt = b.units.find((u) => u.classId === rt.classIds.get('zhutong'))!;
    const lh = b.units.find((u) => u.classId === rt.classIds.get('leiheng'))!;
    const skills = (u: Unit) => b.data.classes[u.classId].skills;
    expect(areaCells(b.board, zt, skills(zt)[1], { x: zt.x + 1, y: zt.y })).toHaveLength(3);
    expect(areaCells(b.board, zt, skills(zt)[2], { x: zt.x + 1, y: zt.y })).toEqual([
      { x: zt.x + 1, y: zt.y }, { x: zt.x + 2, y: zt.y }, { x: zt.x + 3, y: zt.y },
    ]);
    expect(skills(lh)[1].hits.map((h) => h.percent)).toEqual([30, 20, 20, 30]);
    for (const u of [zt, lh]) {
      u.mp = 0;
      const charge = skills(u).find((s) => s.type === 8)!;
      expect(charge.learnLevel).toBe(6);
      b.useSkill(u, charge, u);
      expect(u.mp).toBe(Math.floor(u.stats.maxMp / 3));
    }
  });

  it('义释宋公明：打倒张文远即过关（他有对白），任一主角战败即失败，超时也失败', () => {
    const start = () => {
      const b = new Battle(compileStage(rt, stageOf('songjiazhuang'), files, { seed: 1, text: tr }));
      b.begin();
      return b;
    };
    const check = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
    const b = start();
    const kill = (u: Unit) => {
      u.hp = 0; u.alive = false; u.present = false;
      (b as unknown as { pendingDeaths: number[] }).pendingDeaths.push(u.classId);
    };
    const enemies = b.units.filter((u) => u.side === 'enemy');
    kill(enemies.find((u) => u.name === '张家打手')!);
    check(b);
    expect(b.status).toBe('playing');
    kill(enemies.find((u) => u.name === '张文远')!);
    check(b);
    expect(b.status).toBe('won');
    for (const id of ['sj-fugitive', 'zhutong', 'leiheng']) {
      const b = start();
      const fallen = b.units.find((u) => u.classId === rt.classIds.get(id))!;
      fallen.hp = 0; fallen.alive = false; fallen.present = false;
      (b as unknown as { pendingDeaths: number[] }).pendingDeaths.push(fallen.classId);
      check(b);
      expect(b.status).toBe('lost');
    }
    const timeout = start();
    for (const u of timeout.units.filter((u) => u.side === 'enemy')) u.present = false;
    // 留一名敌人，每回合由 advance 补血，验证回合上限而非伤亡。
    const enemy = timeout.units.find((u) => u.side === 'enemy')!;
    enemy.present = true;
    enemy.mp = 0;
    for (const u of timeout.units.filter((u) => u.side === 'player')) u.hp = 999999;
    advance(timeout, 30);
    expect(timeout.status).toBe('playing');
    timeout.endPlayerPhase();
    expect(timeout.status).toBe('lost');
  });

  it('终章之后的纯剧情播放辞金、杀惜与逃亡，演完即通关', () => {
    const stage = stageOf('songjiang-yanshixi');
    expect(placeOf(stage.id)?.after).toBe('N14');
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    const ev = b.begin();
    expect(b.status).toBe('won');
    const lines = ev.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => e.text).join('\n');
    expect(lines).toMatch(/收下/);
    expect(lines).toMatch(/阎婆惜/);
    expect(lines).toMatch(/逃走/);
    const song = b.units.find((u) => u.name === '宋江')!;
    const liu = b.units.find((u) => u.name === '刘唐')!;
    const yan = b.units.find((u) => u.name === '阎婆惜')!;
    const eventIndex = (type: 'leave' | 'appear', uid: number) => ev.findIndex((e) => e.type === type && e.uid === uid);
    const liuLeaves = eventIndex('leave', liu.uid);
    const songLeaves = eventIndex('leave', song.uid);
    const yanAppears = eventIndex('appear', yan.uid);
    const songReturns = eventIndex('appear', song.uid);
    const readsLetter = ev.findIndex((e) => (e.type === 'say' || e.type === 'narrate') && e.text.includes('藏起'));
    expect(liuLeaves).toBeGreaterThan(-1);
    expect(songLeaves).toBeGreaterThan(liuLeaves);
    expect(yanAppears).toBeGreaterThan(songLeaves);
    expect(readsLetter).toBeGreaterThan(yanAppears);
    expect(songReturns).toBeGreaterThan(readsLetter);
    expect(ev.some((e, i) => i > songReturns && e.type === 'say' && e.uid === yan.uid)).toBe(true);
  });

  it('瓦罐寺：我方按职业号套用主线进度；过关奖励用关卡里写的银子', () => {
    const party = new Map([[16, { classId: 16, level: 14, exp: 5, slots: [0, 0, 0, 0, 0, 0, 0] }]]);
    const input = { ...compileStage(rt, stageOf('wawasi'), files, { seed: 1, text: tr }), party };
    expect(input.clearGold).toBe(300);
    const b = new Battle(input);
    expect(b.units.find((u) => u.classId === 16)!.level).toBe(14);
  });

  it('瓦罐寺：鲁智深开局饿着，崔道成说完话退回殿后；第 3 回合史进、陈达赶到，第 4 回合崔道成带人杀出；打倒崔道成过关', () => {
    const b = new Battle(compileStage(rt, stageOf('wawasi'), files, { seed: 1, text: tr }));
    b.begin();
    const of = (cls: number) => b.units.find((u) => u.classId === cls)!;
    const [lz, sj, cd, cui] = [of(16), of(3), of(13), of(65)];
    expect(lz.buffs.some((x) => x.stat === 'attack' && x.value < 0)).toBe(true);
    expect(cui.present).toBe(false);
    expect(sj.present || cd.present).toBe(false);
    advance(b, 3);
    expect(sj.present && cd.present).toBe(true);
    expect(lz.buffs.some((x) => x.stat === 'attack' && x.value > 0)).toBe(true);
    expect(cui.present).toBe(false);
    advance(b, 4);
    expect(cui.present).toBe(true);
    cui.hp = 1;
    cui.stats.agility = 0;
    cui.x = lz.x;
    cui.y = lz.y + 1;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 20 && b.status === 'playing'; i++) ev = strike(b, lz, cui);
    expect(b.status).toBe('won');
    expect(ev.some((e) => e.type === 'say' && /再占不得佛门/.test(e.text))).toBe(true);
  });

  // 把场上的敌人一个个打倒（体力 1、敏捷 0、挪到 hitter 旁边）
  const wipe = (b: Battle, hitter: Unit) => {
    let ev: BattleEvent[] = [];
    // 只打开始时在场的这一批（打光后补上来的不算）
    for (const foe of b.units.filter((u) => u.side === 'enemy' && u.alive && u.present)) {
      if (b.status !== 'playing') break;
      foe.hp = 1;
      foe.stats.agility = 0;
      foe.x = hitter.x;
      foe.y = hitter.y + 1;
      for (let k = 0; k < 20 && foe.alive && b.status === 'playing'; k++) ev = strike(b, hitter, foe);
    }
    return ev;
  };

  it('三阮：每两回合一段对话；对话说完前敌人打光就补 3 个喽啰，第 12 回合以后打光才过关', () => {
    const b = new Battle(compileStage(rt, stageOf('sanruan'), files, { seed: 1, text: tr }));
    const said: string[] = [];
    const log = (ev: BattleEvent[]) => ev.forEach((e) => (e.type === 'say' || e.type === 'narrate') && said.push(e.text));
    log(b.begin());
    expect(said.some((t) => /生辰纲/.test(t))).toBe(true);
    const xq = b.units.find((u) => u.classId === 9)!;
    const present = () => b.units.filter((u) => u.side === 'enemy' && u.alive && u.present).length;
    wipe(b, xq);
    expect(b.status).toBe('playing');
    expect(present()).toBe(3); // 补了 3 个
    const boss = b.units.find((u) => u.classId === 65)!;
    expect(boss.present).toBe(false);
    for (let t = 2; t <= 8; t++) log(advance(b, t));
    expect(boss.present).toBe(true);
    expect(said.some((t) => /立地太岁/.test(t)) && said.some((t) => /石榴花/.test(t)) && said.some((t) => /草生一秋/.test(t)) && said.some((t) => /白衣秀士/.test(t))).toBe(true);
    wipe(b, xq);
    expect(b.status).toBe('playing'); // 打倒小头目、敌人打光也还没过关：对话没说完，又补人
    expect(present()).toBe(3);
    log(advance(b, 12));
    expect(said.some((t) => /水里水里去/.test(t))).toBe(true);
    const ev = wipe(b, xq);
    expect(b.status).toBe('won');
    expect(ev.some((e) => e.type === 'say' && /卖与识货的/.test(e.text))).toBe(true);
    expect(b.clearGold).toBe(0); // 视角关不给银子

    const lost = new Battle(compileStage(rt, stageOf('sanruan'), files, { seed: 1, text: tr }));
    lost.begin();
    const w2 = lost.units.find((u) => u.classId === 10)!;
    const foe = lost.units.find((u) => u.side === 'enemy' && u.present)!;
    w2.hp = 1;
    w2.stats.agility = 0;
    foe.x = w2.x;
    foe.y = w2.y - 1;
    for (let i = 0; i < 20 && lost.status === 'playing'; i++) strike(lost, foe, w2);
    expect(lost.status).toBe('lost');
  });

  it('野猪林：两人一同救林冲，打退官差和强人后头目现身', () => {
    const b = new Battle(compileStage(rt, stageOf('zhizhulin'), files, { seed: 1, text: tr }));
    const of = (id: number) => b.units.find((u) => u.classId === id)!;
    const lin = of(11), lu = of(16), hero = of(0), boss = of(65);
    expect([b.board.width, b.board.height]).toEqual([18, 18]);
    expect(hero.present || lu.present || boss.present).toBe(false);
    const ev = b.begin();
    expect(b.units.filter((u) => u.side === 'player').map((u) => u.classId)).toEqual([0, 11, 16]);
    expect(hero.present && lu.present).toBe(true);
    const appearHero = ev.findIndex((e) => e.type === 'appear' && e.uid === hero.uid);
    const appearLu = ev.findIndex((e) => e.type === 'appear' && e.uid === lu.uid);
    const threat = ev.findIndex((e) => e.type === 'say' && /少说废话/.test(e.text));
    expect(appearHero).toBeGreaterThan(threat);
    expect(appearLu).toBe(appearHero + 1);
    expect(ev.some((e) => e.type === 'status' && e.uid === lin.uid && e.text === '被綁')).toBe(true);
    expect(lin.stunTurns).toBe(0);
    const reachable = b.board.distanceField([{ x: lin.x, y: lin.y }]);
    for (const u of b.units) {
      expect(b.board.passable(u.x, u.y), u.name).toBe(true);
      expect(reachable[u.y * b.board.width + u.x], u.name).toBeLessThan(Infinity);
    }
    wipe(b, hero);
    expect(b.units.filter((u) => u.side === 'enemy' && u.present && u.alive).length).toBe(4);
    expect(b.units.filter((u) => u.name === '强人' && u.present).length).toBe(4);
    expect(boss.present).toBe(false);
    wipe(b, hero);
    expect(b.status).toBe('playing');
    expect(boss.present && boss.alive).toBe(true);
    wipe(b, hero);
    expect(b.status).toBe('won');
  });

  it('林冲别妻与大野猪林开场对白衔接到发配和暗中护送', () => {
    const act = loadStage(files, base, 'Act7-1', { text: tr });
    const ambush = loadStage(files, base, 'Act7-1a', { text: tr });
    const text = (input: typeof act) => input.blocks.flatMap((block) => block.ops.map((op) => op.text ?? '')).join('\n');
    expect(text(act)).toContain('判我刺配沧州');
    expect(text(act)).toContain('董超、薛霸押着林冲离去');
    expect(text(act)).toContain('暗中跟上');
    expect(text(ambush)).toContain('那伙强人已被打退');
  });
});

describe.skipIf(!has)('孟州续篇：存档、援军与结算', () => {
  const files = new NodeFiles(DATA), rt = loadPackFromDisk('mainline');
  const stage = (id: string) => rt.stages.find(s=>s.id===id)!;
  const cid = (id: string) => rt.classIds.get(id)!;
  const start = (id: string, c?: CampaignState) => {
    const b = new Battle(compileStage(rt,stage(id),files,{seed:1,party:c ? packParty(c,rt):undefined})); b.begin(); return b;
  };

  it('快活林三次酒劲各结算一次，本关持续与有限回合增益互不混淆', () => {
    const original = stage('kuaihuolin');
    const s = { ...original, script: [...original.script, {
      on: 'start' as const, do: [['buff', 'wusong', 'defense', { add: 7, turns: 3 }]] as [string, ...unknown[]][],
    }] };
    const b = new Battle(compileStage(rt, s, files, { seed: 1 })); b.begin();
    const wu = b.units.find(u => u.classId === cid('wusong'))!;
    const startingDefense = wu.stats.defense;
    expect(wu.buffs.find(buff => buff.stat === 'defense')?.turns).toBe(2); // 开局已过一次回合开始结算。
    expect(wu.stats.attack).toBe(189);
    const attacks = [208, 229, 252], hits = [229, 218, 207];
    for (let i = 0; i < 3; i++) {
      const npc = s.units.find(u => u.id === `wine-${i + 1}`)!;
      wu.x = npc.x + 1; wu.y = npc.y;
      (b as unknown as { afterAction: () => void }).afterAction();
      expect(wu.stats.attack).toBe(attacks[i]);
      expect(wu.stats.hit).toBe(hits[i]);
    }
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(wu.buffs.filter(buff => buff.turns === 0)).toHaveLength(6);
    b.endPlayerPhase();
    expect(wu.buffs.find(buff => buff.stat === 'defense')?.turns).toBe(1);
    b.endPlayerPhase();
    expect(wu.buffs.some(buff => buff.stat === 'defense')).toBe(false);
    expect(wu.stats.defense).toBe(startingDefense - 7);
    expect(wu.buffs).toHaveLength(6);
    expect(wu.stats.attack).toBe(252);
    expect(wu.stats.hit).toBe(207);
  });

  it('快活林第4回合只有戴宗、花荣、李逵来援，史进不在本关出场', () => {
    const s = stage('kuaihuolin'), b = start('kuaihuolin');
    expect(s.units.some(u => u.id === 'shijin' || u.class === 3)).toBe(false);
    expect(b.units.filter(u => u.side === 'player' && u.present)).toHaveLength(3);
    for (let i = 0; i < 3; i++) b.endPlayerPhase();
    expect(b.turn).toBe(4);
    const ids = b.units.filter(u => u.side === 'player' && u.present).map(u => u.classId);
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(expect.arrayContaining([cid('daizong'), cid('huarong'), cid('likui')]));
    expect(ids).not.toContain(3);
  });

  it('快活林第4回合张团练带六人来援，打倒首领不提前胜，全灭后败逃并在鸳鸯楼再战', () => {
    const s = stage('kuaihuolin'), b = start('kuaihuolin');
    const get = (id: string) => b.unit(s.units.findIndex(u => u.id === id))!;
    const check = () => (b as unknown as { afterAction: () => void }).afterAction();
    const kill = (u: Unit) => (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(get('wusong'), u);
    for (const u of b.units) if (u.side !== 'enemy') u.hp = 999999;
    get('wusong').x = 12; get('wusong').y = 8; check();
    const reinforcements = b.units.filter(u => s.units[u.uid].id === 'zhangtuanlian' || s.units[u.uid].id.startsWith('zhang-rescue-'));
    expect(reinforcements).toHaveLength(7);
    expect(reinforcements.every(u => !u.present && u.alive)).toBe(true);
    for (const u of b.units.filter(u => u.side === 'enemy' && u.present)) kill(u);
    check(); expect(b.status).toBe('playing'); // 蒋门神和原有手下已败，仍须等增援。
    for (let turn = 2; turn <= 4; turn++) {
      b.endPlayerPhase();
      expect(b.turn).toBe(turn);
      expect(reinforcements.filter(u => u.present)).toHaveLength(turn === 4 ? 7 : 0);
    }
    expect(get('zhangtuanlian').classId).toBe(cid('zhangtuanlian'));
    kill(get('zhangtuanlian')); check(); expect(b.status).toBe('playing');
    const troops = reinforcements.filter(u => u.alive);
    for (const u of troops.slice(0, -1)) kill(u);
    check(); expect(b.status).toBe('playing');
    kill(troops.at(-1)!); check(); expect(b.status).toBe('won');
    expect((b as unknown as { out: BattleEvent[] }).out.some(e => e.type === 'say' && e.text.includes('狼狈逃走'))).toBe(true);
    // 战后对话：倒下的蒋门神、张团练临时回到武松身边（只放画面，不复活），说完收起
    const out = (b as unknown as { out: BattleEvent[] }).out;
    for (const id of ['jiangmenshen', 'zhangtuanlian']) {
      const u = get(id), shown = out.find((e): e is Extract<BattleEvent, {type:'appear'}> => e.type === 'appear' && e.uid === u.uid);
      expect(shown, id).toBeDefined();
      expect(Math.abs(shown!.x - get('wusong').x) + Math.abs(shown!.y - get('wusong').y)).toBeLessThanOrEqual(3);
      expect(out.some(e => e.type === 'leave' && e.uid === u.uid)).toBe(true);
      expect(u.alive).toBe(false);
    }
    const cells = out.filter((e): e is Extract<BattleEvent, {type:'appear'}> => e.type === 'appear').map(e => `${e.x},${e.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(b.units.filter(u => u.side === 'enemy').every(u => !u.alive)).toBe(true);
    const later = start('yuanyanglou');
    for (const id of ['jiangmenshen', 'zhangtuanlian']) expect(later.units.find(u => u.classId === cid(id))!.alive).toBe(true);
  });

  it('快活林还没触发酒店交锋时，清掉张团练救援也不能漏算隐藏敌人', () => {
    const s = stage('kuaihuolin'), b = start('kuaihuolin');
    for (const u of b.units) if (u.side !== 'enemy') u.hp = 999999;
    for (let i = 0; i < 3; i++) b.endPlayerPhase();
    const wu = b.units.find(u => u.classId === cid('wusong'))!;
    for (const u of b.units.filter(u => u.side === 'enemy' && u.present))
      (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(wu, u);
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('playing');
    const boss = b.unit(s.units.findIndex(u => u.id === 'jiangmenshen'))!;
    expect(boss.alive).toBe(true); expect(boss.present).toBe(false);
  });

  it('快活林蒋门神的八名手下使用喽啰职业，保留两名徒弟', () => {
    const s = stage('kuaihuolin');
    const guards = s.units.filter(u => u.id.startsWith('guard-'));
    expect(guards).toHaveLength(8);
    expect(guards.every(u => [22, 23].includes(Number(u.class)) && u.side === 'enemy' && u.hidden)).toBe(true);
    expect(s.units.filter(u => u.id.startsWith('disciple-'))).toHaveLength(2);
    expect(s.units.filter(u => u.id.startsWith('guard-') || u.id.startsWith('disciple-')).some(u => [32, 33, 34, 36, 38, 39, 42, 43].includes(Number(u.class)))).toBe(false);
  });

  it('快活林三店逐一由武松靠近喝酒，施恩可以移动帮忙', () => {
    const s = stage('kuaihuolin'), b = start('kuaihuolin');
    const wu = b.units.find(u => u.classId === cid('wusong'))!;
    const shien = b.units.find(u => u.classId === cid('shien'))!;
    expect(shien.side).toBe('ally');
    expect(shien.ai.mode).toBe(0);
    expect(b.canAct(shien)).toBe(false); // 玩家阶段不可操作友军。
    expect(b.canMove(shien)).toBe(false);
    const check = () => (b as unknown as { afterAction: () => void }).afterAction();
    for (const name of ['wine-1', 'wine-2', 'wine-3']) {
      const index = s.units.findIndex(u => u.id === name), npc = b.unit(index)!;
      expect(b.board.passable(npc.x, npc.y)).toBe(true);
      const trigger = compileStage(rt, s, files).blocks.find(blk => blk.trigger.kind === 'near' && blk.trigger.uid === index)!;
      expect(trigger).toBeDefined();
      // 同职业三个店小二分别识别；施恩在身边不会替武松喝酒。
      wu.x = 12; wu.y = 22;
      shien.x = npc.x + 1; shien.y = npc.y;
      check();
      const before = wu.buffs.length;
      expect(before).toBe((Number(name.at(-1)) - 1) * 2);
      wu.x = npc.x + 1; wu.y = npc.y;
      shien.x = 14; shien.y = 23;
      check();
      expect(wu.buffs.length).toBe(before + 2);
      check();
      expect(wu.buffs.length).toBe(before + 2); // 反复靠近只给一次酒劲。
    }
    // 友军采用会行动、会攻击的 AI；并非恢复成原地不动的 AI8。
    const guard = b.unit(s.units.findIndex(u => u.id === 'guard-1'))!;
    guard.present = true;
    shien.x = guard.x; shien.y = guard.y + 2;
    expect(planAi(b, shien).target?.side).toBe('enemy');
  });

  it('十字坡不让武龙宋江出场，两公人先中药再获救，缺席好汉资产保留', () => {
    const s = stage('shizipo');
    expect(s.units.some(u => u.id === 'hero' || u.id === 'songjiang')).toBe(false);
    const b = new Battle(compileStage(rt, s, files));
    const events = b.begin();
    const speech = events.filter((e): e is Extract<BattleEvent, {type:'say'}> => e.type === 'say');
    const index = (text: string) => speech.findIndex(e => e.text.includes(text));
    const refuse = index('我若为自己脱身害了他们');
    expect(refuse).toBeGreaterThan(index('两个公人行路口渴'));
    expect(index('夫妻俩将两个公人救醒')).toBeGreaterThan(refuse);
    expect(index('我们领的是押解文书')).toBeGreaterThan(index('夫妻俩将两个公人救醒'));
    for (const id of ['escort-a', 'escort-b']) {
      const uid = s.units.findIndex(u => u.id === id);
      expect(speech.filter(e => e.uid === uid).length).toBeGreaterThanOrEqual(3);
      expect(b.unit(uid)!.alive).toBe(true);
    }
    expect(speech.some(e => e.speaker.includes('宋江') || e.speaker.includes('武龍'))).toBe(false);
    expect(b.status).toBe('won');
    const c: CampaignState = {version:1,stage:75,gold:4321,members:[{classId:0,level:29,exp:7,slots:[1,84,0],forge:[2,1,0]}],companions:{'mainline/sj-fugitive':{level:28,exp:9,slots:[2,85,0],forge:[3,0,0]}}};
    const after = recordPackResult(c, b, rt);
    expect(after.members.find(m => m.classId === 0)).toMatchObject(c.members[0]);
    expect(after.companions!['mainline/sj-fugitive']).toMatchObject(c.companions!['mainline/sj-fugitive']);
    expect(after.gold).toBe(4321);
  });
  it('鸳鸯楼全体十名好汉使用真实普攻时均显示招式名，包括扩展职业与杜迁宋万', () => {
    const b = start('yuanyanglou');
    const heroes = b.units.filter(u => u.side === 'player');
    expect(heroes).toHaveLength(10);
    for (const u of heroes) {
      const basic = attackSkill(u, rt.data);
      expect(basic.name, u.name).toBeTruthy();
      expect(announcesSkill(u, basic, rt.data), `${u.name}：${basic.name}`).toBe(true);
    }
  });
  it('六关全体含隐藏单位及move落点可通行、不重格，三剧情显式胜利',()=> {
    for (const id of ['shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou']) {
      const s=stage(id), b = new Battle(compileStage(rt,s,files));
      const cells=new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x,u.y),`${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`)).toBe(false);cells.add(`${u.x},${u.y}`); }
      for(const blk of s.script)for(const op of blk.do)if(op[0]==='move')expect(b.board.passable(Number(op[2]),Number(op[3]))).toBe(true);
      b.begin(); if(['shizipo','anpingzhai','zhangfu'].includes(id))expect(b.status).toBe('won');
    }
  });
  it('行者武松（第十八章）夜走蜈蚣岭：十字坡扮行者演完就过关、途中换上行者头像；蜈蚣岭四人夜战，增援到齐且全灭才胜', () => {
    for (const id of ['xingzhe', 'wugongling']) {
      const s = stage(id), b = new Battle(compileStage(rt, s, files));
      const cells = new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x, u.y), `${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`), `${id}/${u.id}`).toBe(false); cells.add(`${u.x},${u.y}`); }
      for (const blk of s.script) for (const op of blk.do) {
        if (op[0] === 'move') expect(b.board.passable(Number(op[2]), Number(op[3])), `${id} move ${op.slice(1).join()}`).toBe(true);
        if (op[0] === 'portrait') expect(fs.existsSync(`packs/mainline/${op[2]}`), String(op[2])).toBe(true);
      }
    }
    // 扮行者：每个 move 都走到；行者头像在「只恐我不象出家人模样」之后才换
    const x = new Battle(compileStage(rt, stage('xingzhe'), files));
    const ev = x.begin();
    expect(x.status).toBe('won');
    const moves = stage('xingzhe').script.flatMap((blk) => blk.do.filter((op) => op[0] === 'move'));
    expect(ev.filter((e) => e.type === 'move').length).toBe(moves.length);
    const face = ev.findIndex((e) => e.type === 'portrait' && e.classId === cid('wusong') && e.file.includes('xingzhe'));
    expect(face).toBeGreaterThan(ev.findIndex((e) => e.type === 'say' && e.text.includes('出家人模样')));
    // 蜈蚣岭：只有武松、武龙、李逵、花荣四人；第 3 回合一波增援；王道人和全部强人倒下才胜
    const s = stage('wugongling'), b = start('wugongling');
    expect(s.tint).toBe('night');
    const heroes = b.units.filter((u) => u.side === 'player' && u.present).map((u) => u.classId);
    expect(heroes.sort()).toEqual([0, cid('wusong'), cid('likui'), cid('huarong')].sort());
    const get = (id: string) => b.unit(s.units.findIndex((u) => u.id === id))!;
    const check = () => (b as unknown as { afterAction: () => void }).afterAction();
    const kill = (u: Unit) => (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(get('wusong'), u);
    for (const u of b.units) if (u.side === 'player') u.hp = 99999;
    for (const u of b.units.filter((u) => u.side === 'enemy' && u.present)) kill(u);
    check(); expect(b.status).toBe('playing');
    while (b.turn < 3) b.endPlayerPhase();
    const wave = b.units.filter((u) => u.side === 'enemy' && u.alive && u.present);
    expect(wave.length, '第 3 回合增援').toBe(12);
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && !u.present)).toBe(false);
    for (const u of wave) kill(u);
    check(); expect(b.status).toBe('won');
    const out = (b as unknown as { out: BattleEvent[] }).out;
    expect(out.some((e) => e.type === 'appear' && e.uid === get('woman').uid)).toBe(true);
    expect(out.some((e) => e.type === 'say' && e.text.includes('张太公家女儿'))).toBe(true);
  });
  it('行者武松（第十八章）醉打孔亮：村店里武松一人带酒劲；孔亮倒下丢进溪里；庄客到齐且全灭才胜，战后落溪被擒；孔家庄相认、瑞龙镇分路演完过关', () => {
    for (const id of ['kongliang', 'kongjiazhuang']) {
      const s = stage(id), b = new Battle(compileStage(rt, s, files));
      const cells = new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x, u.y), `${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`), `${id}/${u.id}`).toBe(false); cells.add(`${u.x},${u.y}`); }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(Number(op[2]), Number(op[3])), `${id} move ${op.slice(1).join()}`).toBe(true);
    }
    // 孔家庄：每个 move 都走到；先认出武二郎、后分路；演完就过关
    const z = new Battle(compileStage(rt, stage('kongjiazhuang'), files));
    const zev = z.begin();
    expect(z.status).toBe('won');
    const zmoves = stage('kongjiazhuang').script.flatMap((blk) => blk.do.filter((op) => op[0] === 'move'));
    expect(zev.filter((e) => e.type === 'move').length).toBe(zmoves.length);
    const said = (t: string) => zev.findIndex((e) => e.type === 'say' && e.text.includes(t));
    expect(said('武二郎')).toBeGreaterThan(-1);
    expect(said('少戒酒性')).toBeGreaterThan(said('武二郎'));
    // 村店：只有武松一人，开场带三条酒劲；第 3 回合庄客；全灭才胜，战后孔明孔亮出场
    const s = stage('kongliang'), b = start('kongliang');
    expect(s.tint).toBe('dusk');
    const heroes = b.units.filter((u) => u.side === 'player' && u.present).map((u) => u.classId);
    expect(heroes).toEqual([cid('wusong')]);
    const get = (id: string) => b.unit(s.units.findIndex((u) => u.id === id))!;
    expect(get('wusong').buffs.map((x) => x.stat).sort()).toEqual(['agility', 'attack', 'hit']);
    const check = () => (b as unknown as { afterAction: () => void }).afterAction();
    const kill = (u: Unit) => (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(get('wusong'), u);
    get('wusong').hp = 99999;
    for (const u of b.units.filter((u) => u.side === 'enemy' && u.present)) kill(u);
    check(); expect(b.status).toBe('playing');
    while (b.turn < 3) b.endPlayerPhase();
    const wave = b.units.filter((u) => u.side === 'enemy' && u.alive && u.present);
    expect(wave.length, '第 3 回合庄客').toBe(6);
    expect(b.units.some((u) => u.side === 'enemy' && u.alive && !u.present)).toBe(false);
    for (const u of wave) kill(u);
    check(); expect(b.status).toBe('won');
    const out = (b as unknown as { out: BattleEvent[] }).out;
    expect(out.some((e) => e.type === 'appear' && e.uid === get('kongming-a').uid)).toBe(true);
    expect(out.some((e) => e.type === 'say' && e.text.includes('正是打了小弟的'))).toBe(true);
    expect(out.some((e) => (e.type === 'say' || e.type === 'narrate') && e.text.includes('倒撞下溪里去'))).toBe(true);
  });
  it('三箭夺人开场依次演三箭，只演出而不扣血、耗气或占用行动', () => {
    const s = stage('qianghuarong'), b = new Battle(compileStage(rt, s, files));
    const before = b.units.map(u => ({ hp:u.hp, mp:u.mp, exp:u.exp, x:u.x, y:u.y }));
    const events = b.begin();
    const shots = events.filter(e => e.type === 'shot');
    const archer = b.units[s.units.findIndex(u => u.id === 'huarong')];
    const target = b.units[s.units.findIndex(u => u.id === 'jiaotou')];
    expect(shots).toMatchObject([
      {uid:archer.uid,x:11,y:11,text:'第一箭 · 骨朵头'},
      {uid:archer.uid,x:12,y:11,text:'第二箭 · 朱缨'},
      {uid:archer.uid,x:target.x,y:target.y,target:target.uid,text:'第三箭 · 白襟穿透'},
    ]);
    expect(b.units.map(u => ({ hp:u.hp, mp:u.mp, exp:u.exp, x:u.x, y:u.y }))).toEqual(before);
    expect(archer.acted).toBe(false);
    expect(archer.ended).toBe(false);
    expect(target.alive && target.present).toBe(true);
    expect(b.turn).toBe(1);
    expect(b.status).toBe('playing');
    expect(events.some(e => e.type === 'attack' || e.type === 'hp' || e.type === 'die')).toBe(false);
    const said = (word:string) => events.findIndex(e => e.type === 'say' && e.text.includes(word));
    expect(said('再看我第二')).toBeGreaterThan(events.indexOf(shots[0]));
    expect(said('你们众人再看')).toBeGreaterThan(events.indexOf(shots[1]));
    expect(said('护住后堂')).toBeGreaterThan(events.indexOf(shots[2]));
    const invalid = structuredClone(s);
    invalid.script[0].do.unshift(['shoot','huarong',-1,11,'越界']);
    expect(() => compileStage(rt,invalid,files)).toThrow(/shoot/);
  });
  it('林间截囚先押车行进，再让九名伏兵现身，保留两辆囚车及后续回合救援', () => {
    const s = stage('jieqiuche'), input = compileStage(rt, s, files), b = new Battle(input);
    const get = (id: string) => b.units[s.units.findIndex(u => u.id === id)];
    const ambushers = ['hero', 'likui', 'wangying', 'yanshun', 'zhengtianshou', 'ally-1', 'ally-2', 'ally-3', 'ally-4'];
    for (const id of ambushers) expect(get(id).present, id).toBe(false);
    expect([...b.prisonCarts]).toEqual(['huarong', 'songjiang'].map(id => s.units.findIndex(u => u.id === id)));
    const ev = b.begin();
    const moves = ev.filter(e => e.type === 'move');
    expect(moves).toHaveLength(4);
    for (const id of ['huangxin', 'huarong', 'liugao', 'songjiang']) {
      const op = s.script[0].do.find(op => op[0] === 'move' && op[1] === id)!;
      expect({x: get(id).x, y: get(id).y}, id).toEqual({x: op[2], y: op[3]});
      expect(moves.some(e => e.uid === get(id).uid && e.path.length > 1), id).toBe(true);
    }
    const lastMove = ev.reduce((last, e, i) => e.type === 'move' ? i : last, -1);
    const firstAppear = ev.findIndex(e => e.type === 'appear');
    expect(firstAppear).toBeGreaterThan(lastMove);
    expect(ev.findIndex(e => e.type === 'say' && e.text.includes('三千两'))).toBeGreaterThan(firstAppear);
    for (const id of ambushers) expect(get(id).present, id).toBe(true);
    for (const id of ['wusong', 'luzhishen', 'yangzhi']) expect(get(id).present, id).toBe(false);
    expect(b.isBound(get('huarong'))).toBe(true);
    expect(b.isBound(get('songjiang'))).toBe(true);
    expect(b.status).toBe('playing');
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(1);
    expect(b.isBound(get('huarong'))).toBe(false);
    expect(b.isBound(get('songjiang'))).toBe(true);
  });

  it('林间截囚使用反劫剪径贼原图，全体落点互不重叠且与囚车道路连通，近旁援手可走到宋江身边', () => {
    const s = stage('jieqiuche'), input = compileStage(rt, s, files), b = new Battle(input);
    expect(s.map).toEqual({base:'N-add07'});
    expect([b.board.width,b.board.height]).toEqual([36,36]);
    const left = s.units.find(u=>u.id==='yanshun')!, right=s.units.find(u=>u.id==='zhengtianshou')!;
    for(const id of ['hero','likui','wangying']) {
      const u=s.units.find(u=>u.id===id)!;
      // 等距画面的左右由x-y决定：三名可控好汉在两位头领之间，并保持近距离。
      expect(u.x-u.y,id).toBeGreaterThan(left.x-left.y);
      expect(u.x-u.y,id).toBeLessThan(right.x-right.y);
      expect(Math.abs(u.x-left.x)+Math.abs(u.y-left.y),id).toBeLessThanOrEqual(5);
      expect(Math.abs(u.x-right.x)+Math.abs(u.y-right.y),id).toBeLessThanOrEqual(5);
    }
    const prisoner = { x: 17, y: 26 }; // 押送过场结束后的囚车位置
    const field = b.board.distanceField([prisoner]);
    const seen = new Set<string>();
    for(const u of s.units) {
      expect(b.board.passable(u.x,u.y),u.id).toBe(true);
      expect(Number.isFinite(field[u.y*b.board.width+u.x]),u.id).toBe(true);
      expect(seen.has(`${u.x},${u.y}`),u.id).toBe(false);seen.add(`${u.x},${u.y}`);
    }
    for(const id of ['wusong','luzhishen','yangzhi']) {
      const u=s.units.find(u=>u.id===id)!;
      expect(field[u.y*b.board.width+u.x],id).toBeLessThanOrEqual(4);
    }
    b.begin();
    // 用真实移动触发near：清空护卫仅为核对新落点的通路与开车触发，不改变生产关卡。
    const hero=b.units.find(u=>u.classId===0)!,sj=b.units[s.units.findIndex(u=>u.id==='songjiang')];
    for(const u of b.units)if(u!==hero&&u!==sj)u.present=false;
    for(let step=0;step<10&&b.isBound(sj);step++) {
      const moves=b.moveRange(hero).green;
      const next=moves.reduce((best,c)=>field[c.y*b.board.width+c.x]<field[best.y*b.board.width+best.x]?c:best,hero);
      if(next.x===hero.x&&next.y===hero.y)break;
      b.move(hero,next.x,next.y);
      hero.movementRemaining=hero.stats.move;hero.forcedMarch=false;hero.turnStart=null;hero.acted=false;hero.ended=false;
    }
    expect(b.isBound(sj)).toBe(false);
  });

  it('大闹清风寨（第十九章）：六关单位与 move 落点可通行不重格；三场剧情演完过关；清风山撑满 8 回合被擒；抢人打光才救出宋江；劫囚车花荣、二龙山、青州援军按回合到', () => {
    const ids = ['qingfengshan', 'xingjiutang', 'yuanxiao', 'qianghuarong', 'zhizhan', 'jieqiuche'];
    for (const id of ids) {
      const s = stage(id), b = new Battle(compileStage(rt, s, files));
      const cells = new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x, u.y), `${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`), `${id}/${u.id}`).toBe(false); cells.add(`${u.x},${u.y}`); }
      for (const blk of s.script) for (const op of blk.do) {
        if (op[0] === 'move') expect(b.board.passable(Number(op[2]), Number(op[3])), `${id} move ${op.slice(1).join()}`).toBe(true);
        if (op[0] === 'portrait') expect(fs.existsSync(`packs/mainline/${op[2]}`), String(op[2])).toBe(true);
      }
    }
    for (const id of ['xingjiutang', 'yuanxiao', 'zhizhan']) {
      const b = new Battle(compileStage(rt, stage(id), files)), ev = b.begin();
      expect(b.status, id).toBe('won');
      const moves = stage(id).script.flatMap((blk) => blk.do.filter((op) => op[0] === 'move'));
      expect(ev.filter((e) => e.type === 'move').length, id).toBe(moves.length);
    }
    const said = (ev: BattleEvent[], t: string) => ev.findIndex((e) => e.type === 'say' && e.text.includes(t));
    const x = new Battle(compileStage(rt, stage('xingjiutang'), files)).begin();
    expect(said(x, '及时雨宋公明')).toBeGreaterThan(said(x, '可惜宋江死在这里'));
    expect(said(x, '郓城县客人')).toBeGreaterThan(said(x, '知寨的浑家'));
    // 新职业都有头像文件
    for (const c of ['qinming', 'wangying', 'liugao', 'liugao-qi', 'huarong-mei', 'yanshun', 'huangxin']) {
      const cls = rt.data.classes[cid(c)];
      expect(cls, c).toBeDefined();
      expect(fs.existsSync(`packs/mainline/faces/${c}.png`), c).toBe(true);
    }
    const check = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
    const killer = (b: Battle, s: ReturnType<typeof stage>, by: string) => (u: Unit) => (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(b.unit(s.units.findIndex((x) => x.id === by))!, u);
    // 清风山：夜战；王英倒下只退走，第 3 回合燕顺、郑天寿带人下山；第 7 回合被绊脚索拿住，过关
    {
      const s = stage('qingfengshan'), b = start('qingfengshan'), kill = killer(b, s, 'hero');
      expect(s.tint).toBe('night');
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      kill(b.unit(s.units.findIndex((u) => u.id === 'wangying'))!); check(b);
      expect(b.status).toBe('playing');
      while (b.turn < 3) b.endPlayerPhase();
      expect(b.units.filter((u) => u.side === 'enemy' && u.present && u.alive).length).toBeGreaterThan(10);
      const out: BattleEvent[] = [];
      while (b.status === 'playing' && b.turn < 10) { for (const u of b.units) if (u.side === 'player') u.hp = 99999; out.push(...b.endPlayerPhase()); }
      expect(b.status).toBe('won');
      expect(out.some((e) => (e.type === 'say' || e.type === 'narrate') && e.text.includes('绊脚索'))).toBe(true);
      // 绊翻之后埋伏的喽啰从四边围上来：都登场、都往三人身边挤（前面的喽啰已经围满时站在外圈）
      const heroes = ['songjiang', 'hero', 'likui'].map((id) => b.unit(s.units.findIndex((u) => u.id === id))!);
      const traps = s.units.filter((u) => u.id.startsWith('trap-'));
      expect(traps.length).toBe(6);
      for (const j of traps) {
        const t = b.unit(s.units.findIndex((x) => x.id === j.id))!;
        const d = (x: number, y: number) => Math.min(...heroes.map((h) => Math.abs(h.x - x) + Math.abs(h.y - y)));
        expect(t.present).toBe(true);
        expect(d(t.x, t.y), `${j.id} ${t.x},${t.y}`).toBeLessThanOrEqual(d(j.x, j.y));
        expect(d(t.x, t.y), `${j.id} ${t.x},${t.y}`).toBeLessThanOrEqual(6);
      }
    }
    // 花荣抢人：花荣、武龙两人；后堂第 4 回合有人杀出；打光才过关，宋江战后登场
    {
      const s = stage('qianghuarong'), b = start('qianghuarong'), kill = killer(b, s, 'hero');
      expect(b.units.filter((u) => u.side === 'player' && u.present).map((u) => u.classId).sort()).toEqual([0, cid('huarong')].sort());
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      for (const u of b.units.filter((u) => u.side === 'enemy' && u.present)) kill(u);
      check(b); expect(b.status).toBe('playing');
      while (b.turn < 4) b.endPlayerPhase();
      for (const u of b.units.filter((u) => u.side === 'enemy' && u.present && u.alive)) kill(u);
      check(b); expect(b.status).toBe('won');
      const sj = b.unit(s.units.findIndex((u) => u.id === 'songjiang'))!;
      expect(sj.present).toBe(true);
    }
    // 劫囚车：开场花荣、宋江绑在押送队里，敌人 AI 跳过被绑的人；第 2 回合花荣挣脱（不加防御），第 3 回合二龙山三人与 4 个官军，第 5 回合青州援军；
    // 打光官军后还得有人走到宋江身边打开囚车才过关
    {
      const s = stage('jieqiuche'), b = start('jieqiuche'), kill = killer(b, s, 'hero');
      const byId = (id: string) => b.unit(s.units.findIndex((u) => u.id === id))!;
      const here = () => b.units.filter((u) => u.side === 'player' && u.present).map((u) => u.classId).sort();
      expect(here()).toEqual([0, cid('likui'), cid('wangying'), cid('huarong'), cid('sj-fugitive')].sort());
      const hr = byId('huarong'), sj = byId('songjiang'), hx = byId('huangxin');
      expect(b.isBound(hr) && b.isBound(sj)).toBe(true);
      expect(b.aiFoesOf(hx)).not.toContain(sj);
      expect(byId('yanshun').side).toBe('ally');
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      for (const u of b.units.filter((u) => u.side === 'enemy' && u.present)) kill(u);
      check(b); expect(b.status).toBe('playing');
      while (b.turn < 2) b.endPlayerPhase();
      expect(b.isBound(hr)).toBe(false);
      expect(hr.buffs.length, '花荣挣脱不加防御').toBe(0);
      expect(b.isBound(sj)).toBe(true);
      while (b.turn < 3) b.endPlayerPhase();
      expect(here()).toEqual(expect.arrayContaining([cid('wusong'), 16, 14]));
      const early = b.units.filter((u) => u.side === 'enemy' && u.alive && u.present);
      expect(early.length, '第 3 回合少量官军').toBe(4);
      for (const u of early) kill(u);
      while (b.turn < 5) b.endPlayerPhase();
      const wave = b.units.filter((u) => u.side === 'enemy' && u.alive && u.present);
      expect(wave.length, '第 5 回合青州援军').toBe(18);
      for (const u of wave) kill(u);
      check(b); expect(b.status, '宋江还没松绑').toBe('playing');
      const w = byId('hero'); w.x = sj.x - 1; w.y = sj.y;
      check(b); expect(b.isBound(sj)).toBe(false); expect(b.status).toBe('won');
      const out = (b as unknown as { out: BattleEvent[] }).out;
      expect(out.some((e) => (e.type === 'say' || e.type === 'narrate') && e.text.includes('斩了'))).toBe(true);
    }
  });
  it('解甲留锋串接在射戟与家书之间，三将断后、1/3/5回合分波且全敌败退才胜', () => {
    const s=stage('liufeng'),b=new Battle(compileStage(rt,s,files,{seed:1}));
    expect(s.map).toEqual({base:'N03',crop:[10,14,16,20]});
    const defenders=s.units.filter(u=>['huarong','huangxin','qinming'].includes(u.id));
    for(const u of s.units.filter(u=>u.side==='enemy')){
      // 等距投影：x-y越大越靠右，x+y较小越靠上。
      expect(u.x-u.y,u.id).toBeGreaterThanOrEqual(3);
      expect(u.facing,u.id).toBe(2);
      // 必须明显在三将上方，不能只靠x-y把追兵推到画面纯右侧。
      expect(u.x+u.y,u.id).toBeLessThanOrEqual(13);
      expect(u.x+u.y,u.id).toBeLessThanOrEqual(Math.min(...defenders.map(d=>d.x+d.y))-4);
      expect(Math.min(...defenders.map(d=>Math.abs(u.x-d.x)+Math.abs(u.y-d.y))),u.id).toBeGreaterThanOrEqual(8);
    }
    expect([...new Set(s.units.filter(u=>u.side==='enemy').map(u=>u.class))].sort()).toEqual([32,33,34,38,43]);
    // 朝三将的来路是画面左下；用x-y校验每波前锋、都头、后排的纵深顺序。
    for(const wave of ['w1-','w2-','w3-']){
      const units=s.units.filter(u=>u.id.startsWith(wave));
      const front=units.filter(u=>u.class===32||u.class===33).map(u=>u.x-u.y);
      const command=units.filter(u=>u.class===38).map(u=>u.x-u.y);
      const bows=units.filter(u=>u.class===34).map(u=>u.x-u.y);
      expect(Math.max(...front)).toBeLessThan(Math.min(...command));
      expect(Math.max(...command)).toBeLessThan(Math.min(...bows));
      for(const cavalry of units.filter(u=>u.class===43))expect(cavalry.x-cavalry.y).toBeGreaterThan(Math.max(...command));
    }

    expect([b.board.width,b.board.height]).toEqual([16,20]);
    const seen=new Set<string>(),field=b.board.distanceField([{x:7,y:10}]);
    for(const u of s.units){expect(b.board.passable(u.x,u.y),u.id).toBe(true);expect(seen.has(`${u.x},${u.y}`),u.id).toBe(false);seen.add(`${u.x},${u.y}`);expect(Number.isFinite(field[u.y*16+u.x]),u.id).toBe(true);}
    const ev=b.begin(),get=(id:string)=>b.units[s.units.findIndex(u=>u.id===id)];
    expect(b.active().filter(u=>u.side==='player').map(u=>u.classId).sort()).toEqual(['huarong','huangxin','qinming'].map(cid).sort());
    for(const id of ['songjiang','hero']){expect(get(id).present).toBe(false);const move=ev.findIndex(e=>e.type==='move'&&e.uid===get(id).uid),leave=ev.findIndex(e=>e.type==='leave'&&e.uid===get(id).uid);expect(move).toBeGreaterThan(-1);expect(leave).toBeGreaterThan(move);}
    const kill=(u:Unit)=>(b as unknown as {kill:(a:Unit,t:Unit)=>void}).kill(get('qinming'),u);
    const check=()=>(b as unknown as {afterAction:()=>void}).afterAction();
    const trigger=(turn:number)=>{b.turn=turn;(b as unknown as {runTurnTriggers:(n:number)=>void}).runTurnTriggers(turn-1);};
    const enemies=()=>b.active().filter(u=>u.side==='enemy');
    expect(enemies()).toHaveLength(6);enemies().forEach(kill);check();expect(b.status).toBe('playing');
    trigger(2);expect(enemies()).toHaveLength(0);trigger(3);expect(enemies()).toHaveLength(8);
    enemies().forEach(kill);check();expect(b.status).toBe('playing');trigger(4);expect(enemies()).toHaveLength(0);
    trigger(5);expect(enemies()).toHaveLength(13);trigger(6);trigger(7);enemies().forEach(kill);check();expect(b.status).toBe('won');
    const text=s.script.flatMap(x=>x.do).filter(op=>op[0]==='say').map(op=>String(op[2])).join('');
    for(const phrase of ['高俅','城下之盟','压寨夫人','强抢民女','杀人放火','刘知寨'])expect(text).toContain(phrase);
    expect(text).not.toContain('【改写】');
    expect(s.script.filter(x=>typeof x.on==='object'&&'turn'in x.on).map(x=>(x.on as {turn:number}).turn)).toEqual([2,3,4,5,6,7]);
    const list=insertPlaces(),c:CampaignState={version:1,stage:1,gold:0,members:[]};
    expect(pendingInsert(c,list,'N14','after','mainline/duiyingshan')).toBe('mainline/liufeng');
    expect(pendingInsert(c,list,'N14','after','mainline/liufeng')).toBe('mainline/shiyong');
    expect(pendingInsert(c,list,'N14','after','mainline/shiyong')).toBe('mainline/bensang');
  });
  it.each(['huarong','huangxin','qinming'])('解甲留锋：%s倒下即失败',id=>{
    const s=stage('liufeng'),b=start('liufeng'),u=b.units[s.units.findIndex(u=>u.id===id)],foe=b.active().find(u=>u.side==='enemy')!;
    (b as unknown as {kill:(a:Unit,t:Unit)=>void}).kill(foe,u);
    (b as unknown as {afterAction:()=>void}).afterAction();
    expect(b.status).toBe('lost');
  });
  it('解甲留锋超过12回合失败，未出场敌军不能被当作已击退',()=>{
    const b=start('liufeng');
    while(b.status==='playing'&&b.turn<=12){for(const u of b.units)if(u.side==='enemy')u.present=false;b.endPlayerPhase();}
    expect(b.status).toBe('lost');expect(b.turn).toBe(13);
  });
  it('解甲留锋保留三将装备、锻造和经验，结算不覆盖先行队员及银子',()=>{
    const s=stage('liufeng'),initial=new Battle(compileStage(rt,s,files));
    const c:CampaignState={version:1,stage:1,gold:4321,members:[{classId:0,level:29,exp:17,slots:[0,84,113],forge:[0,0,0]}],companions:{}};
    for(const id of ['huarong','huangxin','qinming']){
      const u=initial.units.find(u=>u.classId===cid(id))!;
      c.companions![`mainline/${id}`]={level:29,exp:37,slots:u.slots.map(v=>{const key=[...rt.itemIds].find(([,n])=>n===v)?.[0];return key?`mainline/${key}`:v;}),forge:u.slots.map(()=>2)};
    }
    const b=new Battle(compileStage(rt,s,files,{party:packParty(c,rt)}));b.begin();
    for(const id of ['huarong','huangxin','qinming']){
      const u=b.units.find(u=>u.classId===cid(id))!,saved=c.companions![`mainline/${id}`];expect(u.exp).toBe(37);expect(u.slots).toEqual(packParty(c,rt).get(cid(id))!.slots);expect(u.forge).toEqual(saved.forge);
    }
    b.status='won';
    const after=recordPackResult(c,b,rt);expect(after.gold).toBe(4321);expect(after.members.find(m=>m.classId===0)).toMatchObject(c.members[0]);
    for(const id of ['huarong','huangxin','qinming'])expect(after.companions![`mainline/${id}`]).toEqual(c.companions![`mainline/${id}`]);
  });
  it('夜困霹雳使用官道遇伏兵地图与明亮夜色，陷坑和两侧伏兵全部连通，南路第4回合增援', () => {
    const s = stage('yekun'), input = compileStage(rt, s, files), b = new Battle(input);
    expect(s.map).toEqual({ base: 'N-add04a' });
    expect(s.tint).toBe('night');
    const trap = s.script.find(blk => typeof blk.on === 'object' && 'enter' in blk.on && blk.on.enter === 'qinming')!.on as { area: number[] };
    const [x1, y1, x2, y2] = trap.area;
    const reachable = new Set([...b.board.reach({ x: 18, y: 24 }, 1000, new Set()).values()].map(c => `${c.x},${c.y}`));
    for (const u of s.units) expect(reachable.has(`${u.x},${u.y}`), u.id).toBe(true);
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) expect(b.board.passable(x, y), `陷坑 ${x},${y}`).toBe(true);
    expect(s.units.filter(u => u.side === 'ally').some(u => u.x < x1)).toBe(true);
    expect(s.units.filter(u => u.side === 'ally').some(u => u.x > x2)).toBe(true);
    b.begin();
    expect(b.units.filter(u => u.side === 'enemy' && u.present)).toHaveLength(12);
    // 只推进回合事件，避免自动对打干扰增援时点。
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(2);
    expect(b.units.filter(u => u.side === 'enemy' && u.present)).toHaveLength(12);
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(3);
    expect(b.units.filter(u => u.side === 'enemy' && u.present)).toHaveLength(24);
    expect(s.units.filter(u => u.id.startsWith('wave-')).every(u => u.y >= 30)).toBe(true);
    const tints = s.script.flatMap(blk => blk.do.filter(op => op[0] === 'tint').map(op => op[1]));
    expect(tints.every(tint => tint === 'night')).toBe(true);
  });

  it.each(['trap', 'defeat'] as const)('夜困霹雳：%s擒秦明后伏兵才出现，隐蔽增援出完且最后一敌战败才胜', (route) => {
    const s = stage('yekun'), b = start('yekun');
    const get = (id: string) => b.unit(s.units.findIndex(u => u.id === id))!;
    const friends = s.units.filter(u => u.side === 'ally').map(u => get(u.id));
    const check = () => (b as unknown as { afterAction: () => void }).afterAction();
    const kill = (u: Unit) => (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(get('hero'), u);
    expect(friends).toHaveLength(5);
    expect(friends.every(u => !u.present && u.alive)).toBe(true);
    const qm = get('qinming');
    if (route === 'trap') Object.assign(qm, { x: 15, y: 10 });
    else kill(qm);
    check();
    expect(b.status).toBe('playing');
    expect(friends.every(u => u.present && u.alive)).toBe(true);
    expect(qm.side).toBe('ally');
    expect(b.isBound(qm)).toBe(true);
    expect(b.objectiveZones().some(z => z.kind === 'goal')).toBe(false);
    expect(qm.alive).toBe(route === 'trap'); // 擒获不复活战败者。
    if (route === 'trap') expect(qm.present).toBe(false);
    const out = (b as unknown as { out: BattleEvent[] }).out;
    expect(out.some(e => e.type === 'status' && e.uid === qm.uid && e.text === '被擒')).toBe(true);
    expect(out.some(e => e.type === 'status' && e.uid === qm.uid && e.text === '歸順')).toBe(false);
    for (const u of b.units.filter(u => u.side === 'enemy' && u.present)) kill(u);
    check();
    expect(b.status).toBe('playing'); // 第4回合的12名援兵仍隐藏，不能漏算。
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(3);
    const wave = b.units.filter(u => u.side === 'enemy' && u.present && u.alive);
    expect(wave).toHaveLength(12);
    for (const u of wave.slice(0, -1)) kill(u);
    check(); expect(b.status).toBe('playing');
    kill(wave.at(-1)!); check(); expect(b.status).toBe('won');
    expect(b.units.filter(u => u.side === 'enemy').every(u => !u.alive)).toBe(true);
  });

  it('夜困霹雳的友军不会随第4回合敌援提前出现', () => {
    const s = stage('yekun'), b = start('yekun');
    (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(3);
    expect(b.units.filter(u => u.side === 'enemy' && u.present)).toHaveLength(24);
    expect(s.units.filter(u => u.side === 'ally').every(u => !b.unit(s.units.indexOf(u))!.present)).toBe(true);
    expect(b.status).toBe('playing');
  });

  it('黄信被擒时也只有两名亲随随降，普通寨兵不改阵营且仍须击败',()=>{
    const s=stage('gongpo'),b=start('gongpo'),get=(id:string)=>b.units[s.units.findIndex(u=>u.id===id)];
    const qm=get('qinming'),hx=get('huangxin');
    (b as unknown as{kill:(a:Unit,t:Unit)=>void}).kill(qm,hx);
    (b as unknown as{afterAction:()=>void}).afterAction();
    const trusted=['hx-1','hx-2'].map(get),ordinary=s.units.filter(u=>u.id.startsWith('hx-')&&!['hx-1','hx-2'].includes(u.id)).map(u=>get(u.id));
    expect(trusted).toHaveLength(2);expect(trusted.every(u=>!u.present&&u.side==='ally')).toBe(true);
    expect(ordinary).toHaveLength(15);expect(ordinary.every(u=>u.present&&u.side==='enemy')).toBe(true);
    const out=(b as unknown as{out:BattleEvent[]}).out;
    const surrendered=out.filter((e):e is Extract<BattleEvent,{type:'status'}>=>e.type==='status'&&e.text==='歸順');
    expect(surrendered.map(e=>e.uid).sort()).toEqual(trusted.map(u=>u.uid).sort());
    const text=s.script.flatMap(b=>b.do).filter(op=>op[0]==='narrate').map(op=>op[1]).join('');expect(text).toContain('朝廷粮饷');expect(text).not.toContain('寨兵也都放下了刀枪');
    for(const u of b.units.filter(u=>u.side==='enemy'&&u.alive&&!ordinary.includes(u)))(b as unknown as{kill:(a:Unit,t:Unit)=>void}).kill(qm,u);
    (b as unknown as{afterAction:()=>void}).afterAction();expect(b.status).toBe('playing');
    for(const u of ordinary)(b as unknown as{kill:(a:Unit,t:Unit)=>void}).kill(qm,u);
    (b as unknown as{afterAction:()=>void}).afterAction();expect(b.status).toBe('won');
  });
  it('清风寨破使用N02：左下进军、右上守门，左侧与下方分波增援；门卫警戒其余主动进攻',()=>{
    const s=stage('gongpo'),b=start('gongpo');
    expect(s.map).toEqual({base:'N02'});expect([b.board.width,b.board.height]).toEqual([36,36]);
    const get=(id:string)=>b.units[s.units.findIndex(u=>u.id===id)];
    const hx=get('huangxin'),qm=get('qinming');
    expect([hx.x,hx.y]).toEqual([14,5]);
    for(const u of s.units.filter(u=>u.side==='player'||u.side==='ally'&&!u.hidden)){expect(Math.abs(u.x-20)+Math.abs(u.y-28)).toBeLessThanOrEqual(4);expect(u.x-u.y).toBeLessThanOrEqual(-6);expect(u.x+u.y).toBeGreaterThanOrEqual(46);}
    expect([qm.x,qm.y]).toEqual([20,28]);
    for(const u of s.units.filter(u=>u.side==='enemy'&&!u.hidden)){expect(u.x).toBeGreaterThanOrEqual(12);expect(u.y).toBeLessThanOrEqual(22);}
    const field=b.board.distanceField([qm]),seen=new Set<string>();
    for(const u of b.units){expect(b.board.passable(u.x,u.y),u.name).toBe(true);expect(Number.isFinite(field[u.y*36+u.x]),u.name).toBe(true);expect(seen.has(`${u.x},${u.y}`)).toBe(false);seen.add(`${u.x},${u.y}`);}
    const guards=['huangxin',...Array.from({length:9},(_,i)=>`hx-${i+1}`)].map(get);
    for(const u of guards){expect(u.ai.mode).toBe(12);expect(planAi(b,u).path?.length??0).toBe(0);expect(u.ai.mode).toBe(12);}
    for(const u of b.units.filter(u=>u.side==='enemy'&&!guards.includes(u)))expect(u.ai.mode).toBe(0);
    const activeBefore=b.active().filter(u=>u.side==='enemy').length;
    b.turn=3;(b as unknown as {runTurnTriggers:(n:number)=>void}).runTurnTriggers(2);
    expect(b.active().filter(u=>u.side==='enemy')).toHaveLength(activeBefore+3);
    for(let i=1;i<=3;i++){expect(get(`jd2-${i}`).present).toBe(true);expect(get(`jd2-${i}`).x).toBe(1);}
    for(let i=4;i<=6;i++)expect(get(`jd2-${i}`).present).toBe(false);
    b.turn=5;(b as unknown as {runTurnTriggers:(n:number)=>void}).runTurnTriggers(4);
    expect(b.active().filter(u=>u.side==='enemy')).toHaveLength(activeBefore+6);
    for(let i=4;i<=6;i++){expect(get(`jd2-${i}`).present).toBe(true);expect(get(`jd2-${i}`).y).toBe(35);}
    Object.assign(qm,{x:12,y:10});
    for(const u of guards){planAi(b,u);expect(u.ai.mode).toBe(0);}
  });
  it('霹雳火秦明（第二十章）：五关站位可通行不重格；三场剧情演完；困秦明引进陷坑或打倒都只触发擒获，清敌才过关；破清风寨秦明先劝不动、黄信伤过一半再劝才归降转友军，仅亲随降离场，其余寨兵家丁打退才过关', () => {
    const ids = ['yekun', 'yeshuo', 'gongpo', 'duiyingshan', 'shiyong'];
    for (const id of ids) {
      const s = stage(id), b = new Battle(compileStage(rt, s, files));
      const cells = new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x, u.y), `${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`), `${id}/${u.id}`).toBe(false); cells.add(`${u.x},${u.y}`); }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(Number(op[2]), Number(op[3])), `${id} move ${op.slice(1).join()}`).toBe(true);
    }
    for (const id of ['yeshuo', 'duiyingshan', 'shiyong']) {
      const b = new Battle(compileStage(rt, stage(id), files)), ev = b.begin();
      expect(b.status, id).toBe('won');
      const moves = stage(id).script.flatMap((blk) => blk.do.filter((op) => op[0] === 'move'));
      expect(ev.filter((e) => e.type === 'move').length, id).toBe(moves.length);
    }
    const ys = new Battle(compileStage(rt, stage('yeshuo'), files)).begin();
    const said = (t: string) => ys.findIndex((e) => e.type === 'say' && e.text.includes(t));
    expect(said('忒毒些个')).toBeGreaterThan(said('首级挑在城头'));
    expect(said('未免太毒辣了')).toBeGreaterThan(said('忒毒些个'));
    expect(said('花知寨有一妹')).toBeGreaterThan(said('未免太毒辣了'));
    for (const c of ['lvfang', 'guosheng']) expect(rt.data.classes[cid(c)], c).toBeDefined();
    expect(rt.data.classes[cid('huarong-mei')].name).toBe('花婉清');
    const check = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
    const get = (b: Battle, s: ReturnType<typeof stage>, id: string) => b.unit(s.units.findIndex((u) => u.id === id))!;
    // 夜困秦明：秦明敌方、防御大加；走进陷坑只擒获，仍需清敌
    {
      const s = stage('yekun'), b = start('yekun'), qm = get(b, s, 'qinming');
      expect(qm.side).toBe('enemy');
      expect(qm.buffs.some((x) => x.stat === 'defense' && x.value > 0)).toBe(true);
      expect(b.objectiveZones().some((z) => z.kind === 'goal')).toBe(true);
      check(b); expect(b.status).toBe('playing');
      const trap = s.script.find(blk => typeof blk.on === 'object' && 'enter' in blk.on && blk.on.enter === 'qinming')!.on as { area: number[] };
      Object.assign(qm, { x: trap.area[0] + 1, y: trap.area[1] + 1 }); check(b);
      expect(b.status).toBe('playing');
      expect(b.units.filter(u => u.side === 'ally' && u.present && u.alive)).toHaveLength(5);
    }
    {
      const s = stage('yekun'), b = start('yekun');
      (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(get(b, s, 'hero'), get(b, s, 'qinming')); check(b);
      expect(b.status).toBe('playing');
      expect(b.units.filter(u => u.side === 'ally' && u.present && u.alive)).toHaveLength(5);
    }
    // 攻破清风寨
    {
      const s = stage('gongpo'), b = start('gongpo');
      const qm = get(b, s, 'qinming'), hx = get(b, s, 'huangxin');
      expect(qm.side).toBe('player');
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      const spot = (x: number, y: number) => { Object.assign(qm, { x, y }); check(b); };
      const ev = () => (b as unknown as { out: BattleEvent[] }).out;
      spot(hx.x - 1, hx.y);
      expect(ev().some((e) => e.type === 'say' && e.text.includes('岂肯随你落草'))).toBe(true);
      expect(hx.side).toBe('enemy');
      spot(20, 28); spot(hx.x - 1, hx.y);
      expect(hx.side, '没伤到一半不降').toBe('enemy');
      spot(20, 28);
      hx.hp = Math.floor(hx.stats.maxHp * 0.4); check(b);
      spot(hx.x - 1, hx.y);
      expect(hx.side).toBe('ally');
      const soldiers = s.units.filter((u) => u.id.startsWith('hx-')).map((u) => get(b, s, u.id));
      expect(soldiers.filter(u=>u.name==='黄信亲随').every(u=>!u.present&&u.side==='ally')).toBe(true);
      expect(soldiers.filter(u=>u.name!=='黄信亲随').every(u=>u.present&&u.side==='enemy')).toBe(true);
      expect(b.status).toBe('playing');
      for (const u of b.units.filter((u) => u.side === 'enemy' && u.alive)) (b as unknown as { kill: (a: Unit, t: Unit) => void }).kill(qm, u);
      check(b); expect(b.status).toBe('won');
      expect(get(b, s, 'mei').present).toBe(true);
    }
  });
  it('阳谷整备的武器店卖三把弓，花荣能装备', async () => {
    const { stock } = await import('../src/rules/town.ts');
    const { canEquip } = await import('../src/rules/data.ts');
    const bows = stock(rt.data, 1, 11).map((id) => rt.data.items[id - 1]).filter((it) => it.type === 11);
    expect(bows.map((it) => it.name)).toEqual(['獵弓', '鵲畫弓', '寶雕弓']);
    for (const it of bows) expect(canEquip(rt.data.classes[cid('huarong')], it, rt.data)).toBe(true);
    expect(canEquip(rt.data.classes[cid('wusong')], bows[0], rt.data)).toBe(false);
  });

  it('第一次出场的人自带武器；武松用手套，哨棒、解腕刀只是本场临时拿着（负责人 2026-11-15）', () => {
    const glove = (id: number) => rt.data.items[id - 1]?.type === 0;
    for (const id of ['kuaihuolin', 'feiyunpu', 'yuanyanglou']) {
      const b = new Battle(compileStage(rt, stage(id), files, { seed: 1 }));
      for (const u of b.units.filter((u) => u.side === 'player')) expect(u.slots[0], `${id} ${u.name}`).toBeGreaterThan(0);
      // 花荣按等级配弓（负责人 2026-11-15 新增弓）
      const hr = b.units.find((u) => u.classId === cid('huarong'))!;
      expect(rt.data.items[hr.slots[0] - 1].name).toBe('寶雕弓');
    }
    for (const [id, story] of [['jingyanggang', '哨棒'], ['shizilou', '解腕尖刀']] as const) {
      const b = new Battle(compileStage(rt, stage(id), files, { seed: 1 }));
      b.begin();
      const ws = b.units.find((u) => u.classId === cid('wusong'))!;
      expect(rt.data.items[ws.slots[0] - 1].name).toBe(story);
      b.status = 'won';
      const next = recordPackResult({ version: 1, stage: 1, gold: 0, members: [] }, b, rt);
      const kept = next.companions!['mainline/wusong'].slots[0];
      expect(typeof kept === 'number' && glove(kept), `${id} 战后 ${kept}`).toBe(true);
    }
  });

  it('动态等级确定后才发默认药品，低等级不会拿到剧本高等级药品', () => {
    for (const [level, names] of [[5, ['跌打藥', '跌打藥']], [30, ['天山雪蓮', '天山雪蓮', '天山雪蓮']]] as const) {
      const input = compileStage(rt, { ...stage('kuaihuolin'), gearAt: undefined }, files, { joinLevel: level });
      const hero = input.units.find(u => u.side === 'player' && u.type === 0)!;
      expect(hero.level).toBe(level);
      const medicines = hero.items.slice(3).filter(id => id && rt.data.items[id - 1].type >= 15 && rt.data.items[id - 1].type <= 22);
      expect(medicines.map(id => rt.data.items[id - 1].name)).toEqual(names);
    }
  });

  it('已有装备、空槽、锻造、经验优先；敌友随实际队伍等级变化，资产不变',()=> {
    for(const level of [12,39]) {
      const c:CampaignState={version:1,stage:1,gold:1234,members:[{classId:0,level,exp:17,slots:[0,84,0,156,0],forge:[0,3,0,0,0]}],companions:{'mainline/wusong':{level,exp:23,slots:[56,84,0,156,0],forge:[4,2,0,0,0]}}};
      const b=start('kuaihuolin',c), wu=b.units.find(u=>u.classId===cid('wusong'))!, hero=b.units.find(u=>u.classId===0)!;
      expect(wu.level).toBe(level);expect(wu.exp).toBe(23);expect(wu.slots[0]).toBe(0);expect(wu.storyGear?.[0]).toEqual({item:56,forge:4});
      wu.slots[4]=56; expect(b.canEquipItem(wu,4)).toBe(false); b.equipItem(wu,4); expect(wu.slots[0]).toBe(0); wu.slots[4]=0;
      expect(hero.slots.slice(0,5)).toEqual([0,84,0,156,0]);expect(hero.forge[1]).toBe(3);
      expect(b.units.find(u=>u.side==='enemy')!.level).toBe(level);expect(c.gold).toBe(1234);
      b.status='won';const next=recordPackResult(c,b,rt);expect(next.companions!['mainline/wusong'].slots[0]).toBe(56);expect(next.companions!['mainline/wusong'].forge![0]).toBe(4);
      expect(next.companions!['mainline/likui']).toBeUndefined(); // hidden, never arrived
      expect(next.members.find(m=>m.classId===0)!.slots[0]).toBe(0);
    }
  });
  it('解甲留锋后接村镇整备再进家书，三将可购物且资产读档不重置',()=>{
    expect(stage('liufeng').townAfter).toBe(11);
    const next='mainline/shiyong';expect(insertTownName(next)).toBe('村镇整备');
    expect(insertTownIntro(next).map(l=>l.actor)).toEqual(['huarong','huangxin','qinming']);
    const c:CampaignState={version:1,stage:75,gold:12345,members:[{classId:0,level:29,exp:17,slots:[2,84,113,0,0,0,0],forge:[2,3,0,0,0,0,0]}],companions:{'mainline/qinming':{level:27,exp:23,slots:[1,84,113,0,0,0,0],forge:[3,2,0,0,0,0,0]}},insertTown:{pack:'mainline',next,town:11,seen:true}};
    const view=prepareInsertTown(c,rt,next);
    expect(view.active).toEqual([0,...['sj-fugitive','huarong','huangxin','qinming','likui','wangying'].map(cid)]);
    expect(view.gold).toBe(c.gold);expect(view.members.find(m=>m.classId===0)).toMatchObject(c.members[0]);
    const medicine=stock(rt.data,3,11)[0],result=buy(view,rt.data,cid('qinming'),medicine);
    expect(result.ok).toBe(true);
    const saved=JSON.parse(JSON.stringify(saveTownParty(result.c,rt))) as CampaignState;
    const reopened=prepareInsertTown(saved,rt,next),qm=reopened.members.find(m=>m.classId===cid('qinming'))!;
    expect(qm.slots).toContain(medicine);expect(qm.forge?.slice(0,2)).toEqual([3,2]);expect([qm.level,qm.exp]).toEqual([27,23]);
    expect(reopened.gold).toBe(c.gold-rt.data.items[medicine-1].buyPrice);expect(reopened.active).toEqual(view.active);expect(saved.insertTown).toEqual(c.insertTown);
    for(const member of result.c.members)expect(reopened.members.find(m=>m.classId===member.classId)).toMatchObject(member);
  });
  it('飞云浦后接孟州整备再进鸳鸯楼，全部十名好汉可购物且读档不重置资产', () => {
    const sequence = insertPlaces().map(p => p.ref);
    const index = sequence.indexOf('mainline/feiyunpu');
    expect(sequence[index + 1]).toBe('mainline/yuanyanglou');
    expect(stage('feiyunpu').townAfter).toBe(11);
    const next = 'mainline/yuanyanglou';
    expect(insertTownName(next)).toBe('孟州整备');
    expect(insertTownName('mainline/shizipo')).toBe('阳谷整备');
    expect(insertTownIntro(next).some(l => l.text.includes('补齐药品'))).toBe(true);
    const c: CampaignState = { version: 1, stage: 75, gold: 10000, members: [
      { classId: 0, level: 18, exp: 17, slots: [2, 84, 0, 0, 0, 0, 0], forge: [2, 3, 0, 0, 0, 0, 0] },
    ], companions: { 'mainline/wusong': { level: 18, exp: 23, slots: [1, 84, 0, 0, 0, 0, 0], forge: [4, 2, 0, 0, 0, 0, 0] } },
      insertTown: { pack: 'mainline', next, town: 11, seen: true } };
    const prepared = prepareInsertTown(c, rt, next);
    const expected = stage('yuanyanglou').units.filter(u => u.side === 'player').map(u => typeof u.class === 'number' ? u.class : cid(u.class));
    expect(prepared.active).toEqual(expected);
    expect(prepared.active).toHaveLength(10);
    expect(prepared.members.find(m => m.classId === 0)).toMatchObject(c.members[0]);
    expect(prepared.members.filter(m => expected.includes(m.classId)).every(m => m.level === 18)).toBe(true);
    const medicine = stock(rt.data, 3, 11)[0];
    expect(medicine).toBeGreaterThan(0);
    expect(stock(rt.data, 1, 11).length).toBeGreaterThan(0);
    const bought = buy(prepared, rt.data, cid('wusong'), medicine);
    expect(bought.ok).toBe(true);
    expect(bought.c.gold).toBe(c.gold - rt.data.items[medicine - 1].buyPrice);
    const saved = JSON.parse(JSON.stringify(saveTownParty(bought.c, rt))) as CampaignState;
    const reopened = prepareInsertTown(saved, rt, next);
    expect(reopened.gold).toBe(bought.c.gold);
    for (const member of bought.c.members) expect(reopened.members.find(m => m.classId === member.classId)).toMatchObject(member);
    expect(reopened.active).toEqual(expected);
    expect(saved.insertTown).toEqual(c.insertTown);
    // 离城后真正构造下一战：已购道具、锻造、等级和经验均沿用。
    const b = new Battle(compileStage(rt, stage('yuanyanglou'), files, { party: packParty(saved, rt) }));
    const wu = b.units.find(u => u.classId === cid('wusong'))!;
    expect(wu.slots).toContain(medicine);
    expect(wu.forge.slice(0, 2)).toEqual([4, 2]);
    expect([wu.level, wu.exp]).toEqual([18, 23]);
    expect(prepareInsertTown(c, rt, 'mainline/shizipo').active).toEqual([cid('sj-fugitive'), cid('wusong'), 0]);
  });

  it('城镇买卖包人物、消费后序列化重读，不补药不改余额，稳定id不串号',()=> {
    const initial:CampaignState={version:1,stage:1,gold:100000,members:[],insertTown:{pack:'mainline',next:'mainline/shizipo',town:11,seen:true},companions:{'mainline/wusong':{level:31,exp:8,slots:[0,84,0,0,0,0,0],forge:[]}}};
    const id=cid('wusong');let view=townParty(initial,rt);view.active=[id];
    const bought=buy(view,rt.data,id,156);expect(bought.ok).toBe(true);
    const saved=saveTownParty(bought.c,rt), loaded=JSON.parse(JSON.stringify(saved));
    expect(saved.members).toEqual([]);expect(loaded.gold).toBe(initial.gold-rt.data.items[155].buyPrice);
    expect(packParty(loaded,rt).get(id)!.slots.filter(n=>n===156)).toHaveLength(1);expect(loaded.insertTown.seen).toBe(true);
    const sold=pawn(townParty(loaded,rt),rt.data,id,3);expect(sold.ok).toBe(true);
    const final=saveTownParty(sold.c,rt);expect(packParty(final,rt).get(id)!.slots[3]).toBe(0);expect(final.gold).toBeGreaterThan(loaded.gold);
  });
  it('包道具随职业表/道具表重排仍还原同一件，原版好汉也可持有',()=> {
    const id=cid('wusong'), item=rt.itemIds.get('shaobang')!;
    const c:CampaignState={version:1,stage:1,gold:7,members:[{classId:id,level:28,exp:0,slots:[item,0,0]},{classId:0,level:30,exp:0,slots:[item,0,0]}]};
    const saved=saveTownParty(c,rt);
    const shifted={...rt,classIds:new Map([...rt.classIds].map(([key,n])=>[key,n+20])),itemIds:new Map([['shaobang',item+9]]),data:{...rt.data,classes:[...rt.data.classes,...Array(20).fill(rt.data.classes[0])]}};
    expect(packParty(saved,shifted).get(id+20)!.slots[0]).toBe(item+9);
    expect(packParty(saved,shifted).get(0)!.slots[0]).toBe(item+9);
  });
  it('飞云浦先揭穿公人灭口，再让五名同伴现身；第二批援军不提前出现', () => {
    const s = stage('feiyunpu');
    const b = new Battle(compileStage(rt, s, files));
    const first = ['hero', 'songjiang', 'daizong', 'huarong', 'likui'];
    const later = ['shijin', 'linchong', 'duqian', 'songwan'];
    const uid = (id: string) => s.units.findIndex(u => u.id === id);
    for (const id of [...first, ...later]) expect(b.unit(uid(id))!.present, id).toBe(false);
    expect(b.units.filter(u => u.side === 'player' && u.present).map(u => u.uid)).toEqual([uid('wusong')]);
    const events = b.begin();
    const plot = events.findIndex(e => e.type === 'say' && e.text.includes('张团练又替蒋门神出了银子'));
    const attack = events.findIndex(e => e.type === 'say' && e.text.includes('要趁他戴枷一齐下手'));
    expect(plot).toBeGreaterThan(-1);
    expect(attack).toBeGreaterThan(plot);
    for (const id of first) {
      const enter = events.findIndex(e => e.type === 'appear' && e.uid === uid(id));
      const speak = events.findIndex(e => e.type === 'say' && e.uid === uid(id));
      expect(enter, id).toBeGreaterThan(attack);
      expect(speak, id).toBeGreaterThan(enter);
      expect(b.unit(uid(id))!.present).toBe(true);
    }
    for (const id of later) expect(b.unit(uid(id))!.present).toBe(false);
    expect(b.units.filter(u => u.side === 'player' && u.present)).toHaveLength(6);
    expect(b.status).toBe('playing');
  });
  it('飞云浦先断枷再到史进四人，鸳鸯楼十人实际在场，只有末段结束续篇',()=> {
    const b=start('feiyunpu');expect(b.units.filter(u=>u.side==='player'&&u.present)).toHaveLength(6);
    expect(b.units.find(u=>u.classId===3)!.present).toBe(false);
    for(const u of b.units)if(u.side==='player')u.hp=99999;
    const ev=b.endPlayerPhase();
    expect(b.turn).toBe(2);expect(b.units.filter(u=>u.side==='player'&&u.present)).toHaveLength(10);
    expect(b.units.find(u=>u.classId===cid('wusong'))!.buffs.some(x=>x.value<0)).toBe(false);
    expect(ev.findIndex(e=>e.type==='narrate'&&e.text.includes('枷只一扭'))).toBeLessThan(ev.findIndex(e=>e.type==='say'&&e.text.includes('林教头')));
    const y=start('yuanyanglou');expect(y.units.filter(u=>u.side==='player'&&u.present)).toHaveLength(10);
    const list=insertPlaces().filter(p=>p.after==='N14');
    for(const id of ['shizilou','shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu'])expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after',`mainline/${id}`)).toBeTruthy();
    expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after','mainline/yuanyanglou')).toBe('mainline/xingzhe');
    expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after','mainline/wugongling')).toBe('mainline/kongliang');
    expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after','mainline/shiyong')).toBe('mainline/bensang');
    expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after','mainline/bailongmiao')).toBeUndefined();
    expect(stage('shizilou').townAfter).toBe(11);
  });
  it('飞云浦等待后续增援不提前胜；鸳鸯楼三首领与守卫全灭且援兵到齐才胜',()=> {
    const b=start('feiyunpu');
    for(const u of b.units) { if(u.side==='player')u.hp=99999; else if(u.present){u.hp=0;u.alive=false;u.present=false;} }
    b.endPlayerPhase();expect(b.status).toBe('playing');expect(b.turn).toBe(2);
    expect(b.units.filter(u=>u.side==='enemy'&&u.present)).toHaveLength(18);
    const y=start('yuanyanglou'), foes=y.units.filter(u=>u.side==='enemy');
    const bosses=foes.filter(u=>u.ai.mode===12);
    for(const u of y.units)if(u.side==='player')u.hp=99999;
    const kill=(u:Unit)=>{u.hp=0;u.alive=false;u.present=false;};
    for(const u of bosses.slice(0,2))kill(u);
    bosses[2].hp=99999;y.endPlayerPhase();expect(y.status).toBe('playing');
    kill(bosses[2]);y.endPlayerPhase();expect(y.status).toBe('playing');
    while(y.turn<6){for(const u of foes)if(u.present)kill(u);y.endPlayerPhase();expect(y.status).toBe('playing');}
    for(const u of foes)if(u.present)kill(u);y.endPlayerPhase();expect(y.status).toBe('won');
  });
  it('飞云浦使用默认模板，第2回合东桥头6人加另外四处各3人，之后每回合6人，最后一波全灭才获胜', () => {
    const b = start('feiyunpu');
    const foes = b.units.filter(u => u.side === 'enemy');
    expect(stage('feiyunpu').map).toEqual({ custom: 'dukou' });
    expect([b.board.width, b.board.height]).toEqual([30, 24]);
    const bridgeReach = b.board.reach({ x: 21, y: 10 }, 1000, new Set());
    for (const u of b.units) expect([...bridgeReach.values()].some(c => c.x === u.x && c.y === u.y), `桥面可达 ${u.name}`).toBe(true);
    expect(foes).toHaveLength(48);
    expect(new Set(foes.map(u => u.classId))).toEqual(new Set([32, 36, 67, 65, 38]));
    // 默认 28 级模板，移除原先 566 血的自定义精英职业。
    for (const u of foes) {
      expect(u.stats.maxHp).toBeLessThan(300);
      expect(u.stats.attack).toBeLessThan(200);
    }
    for (const u of b.units) if (u.side === 'player') u.hp = 99999;
    const clear = () => { for (const u of foes) if (u.present) { u.hp = 0; u.alive = false; u.present = false; } };
    expect(foes.filter(u => u.present)).toHaveLength(6);
    for (let turn = 2; turn <= 6; turn++) {
      clear();
      b.endPlayerPhase();
      expect(b.status, `第${turn}回合前不能提前通关`).toBe('playing');
      expect(b.turn).toBe(turn);
      expect(foes.filter(u => u.present)).toHaveLength(turn === 2 ? 18 : 6);
    }
    // 最后一批还活着一个时也不胜利。
    const survivor = foes.find(u => u.present)!;
    for (const u of foes) if (u.present && u !== survivor) { u.hp = 0; u.alive = false; u.present = false; }
    survivor.hp = 99999;
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    clear();
    b.endPlayerPhase();
    expect(b.status).toBe('won');
    expect(foes.every(u => !u.alive)).toBe(true);
  });
  it('六名换色保护透明肤色阴影，孙二娘没有战斗技',()=> {
    const pal=new Uint8Array(files.get('Data/Default.pal'));
    for(const id of ['jiangmenshen','shien','zhangqing','sunerniang','zhangdujian','zhangtuanlian']) {
      const lut=recolorLut(pal,rt.looks.get(cid(id))!.recolor!);
      for(const n of [0,157,158,159,...Array.from({length:32},(_,i)=>192+i)])expect(lut[n]).toBe(n);
    }
    expect(rt.data.classes[cid('sunerniang')].skills).toEqual([]);
  });
});

 it('跳关只调整建议等级，不覆盖已有装备和银子',()=> {
   const previous:CampaignState={version:1,stage:1,gold:19,members:[{classId:0,level:3,exp:0,slots:[0,84,0,0],forge:[0,2,0,0]}]};
   const jumped=inheritAssets(previous,{version:1,stage:40,gold:100000,members:[{classId:0,level:29,exp:0,slots:[10,90,120,156]}]});
   expect(jumped.gold).toBe(19);expect(jumped.members[0].slots).toEqual(previous.members[0].slots);expect(jumped.members[0].forge).toEqual(previous.members[0].forge);expect(jumped.members[0].level).toBe(29);
 });
