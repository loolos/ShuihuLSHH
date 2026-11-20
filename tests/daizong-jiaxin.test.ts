// 第二十三章「戴宗传假信」（docs/game-design.md §15.24）：旱地忽律、梁山定计、赚上梁山、假信露馅；新好汉朱贵；萧让、金大坚是书生，由李俊、吕方、郭盛护送。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterLabel, chapterOf } from '../src/rules/chapters.ts';
import { areaCells, castRange, learnedSkills } from '../src/rules/skills.ts';
import { DIRS, type Unit } from '../src/rules/unit.ts';
import { Board } from '../src/rules/board.ts';
import { skillFx } from '../src/game/effects.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十三章 戴宗传假信', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const open = (id: string) => {
    const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { s, b, ev, get: (uid: string) => b.units[s.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const turn = (b: Battle, n: number) => (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(n);
  const killAll = (b: Battle, onlyPresent = false) => { for (const u of b.units) if (u.side === 'enemy' && (!onlyPresent || u.present)) { u.hp = 0; u.alive = false; u.present = false; } after(b); };
  const ids = ['zhuguidian', 'liangshan-dingji', 'zhuanshang', 'jiaxin'];

  it('第二十三章四关，排在浔阳楼和法场之间；单位站在可通行格、互不重叠，move 都走得到，我方不超过 5 人（负责人要求：假信露馅八人、旱地忽律六人）', () => {
    expect(chapterLabel(23)).toBe('第二十三章 戴宗传假信');
    expect(chapterOf('mainline/xunyanglou')).toBe(22);
    expect(chapterOf('mainline/fachang')).toBe(24);
    for (const id of ids) {
      expect(chapterOf(`mainline/${id}`), id).toBe(23);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        if (!u.hidden) { expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false); seen.add(`${u.x},${u.y}`); }
      }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} ${op.join()}`).toBe(true);
      expect(s.units.filter((u) => u.side === 'player' && !u.offstage).length, id).toBeLessThanOrEqual(({ jiaxin: 8, zhuguidian: 6 } as Record<string, number>)[id] ?? 5);
    }
  });

  it('朱贵是新好汉（头领换色，技能按等级领悟）；萧让、金大坚是不动手的书生，只有普通一击', () => {
    const cid = rt.classIds.get('zhugui')!, cls = rt.data.classes[cid];
    expect(cls.skills).toHaveLength(8);
    expect(learnedSkills({ classId: cid, level: 30 } as Unit, rt.data)).toHaveLength(5); // 普通攻击不算
    expect(cls.skills.find((s) => s.name === '蒙汗药酒')!.stun).toBe(60);
    const defs = JSON.parse(fs.readFileSync('packs/mainline/pack.json', 'utf8')).classes as { id: string; sprite: { fromClass: number } }[];
    expect(Object.fromEntries(['zhugui', 'xiaorang', 'jindajian'].map((id) => [id, defs.find((c) => c.id === id)!.sprite.fromClass]))).toEqual({ zhugui: 65, xiaorang: 68, jindajian: 70 });
    for (const id of ['xiaorang', 'jindajian']) expect(rt.data.classes[rt.classIds.get(id)!].skills, id).toHaveLength(1);
  });

  it('朱贵周身连环三段，吞江三阶隔行横排，四向预览与实际命中一致且不伤自己人', () => {
    const cid=rt.classIds.get('zhugui')!, cls=rt.data.classes[cid];
    const lian=cls.skills.find(s=>s.name==='忽律连环')!, tun=cls.skills.filter(s=>s.name.startsWith('忽律吞江'));
    const board=new Board(21,21), from={x:10,y:10};
    expect(lian.hits.map(h=>h.percent)).toEqual([30,30,40]);
    expect(areaCells(board,from,lian,from).filter(c=>c.x!==10||c.y!==10)).toHaveLength(12);
    expect(tun.map(s=>s.mpCost)).toEqual([100,125,150]);
    expect(tun.map(s=>s.learnLevel)).toEqual([24,28,32]);
    for(const [i,s] of tun.entries()) for(const d of DIRS) {
      const at={x:10+d.x,y:10+d.y}, cells=areaCells(board,from,s,at);
      expect(cells).toHaveLength(3*(i+3));
      for(const c of cells) expect([1,3,5]).toContain((c.x-10)*d.x+(c.y-10)*d.y);
      expect(castRange({classId:cid,stats:{rangeBonus:10}} as Unit,s,rt.data)).toEqual([1,1]);
      expect(skillFx(s)).not.toBeNull();
    }
    for(const level of [24,28,32]) expect(learnedSkills({classId:cid,level} as Unit,rt.data).filter(s=>s.name.startsWith('忽律吞江'))).toEqual([tun[(level-24)/4]]);
    const positions=[[10,10],[10,8],[11,9],[10,7],[10,9]];
    const b=new Battle({name:'test',data:rt.data,board,blocks:[],seed:1,units:positions.map(([x,y],i)=>({index:i,type:i===0?cid:32,group:i+1,side:i===0?'player':i===4?'ally':'enemy',x,y,facing:0,level:32,flags:0,extra:[0,0,0],items:[],raw:[]}))});
    b.begin();const u=b.units[0];u.mp=200;
    expect(b.affected(u,lian,u).map(t=>t.uid)).toEqual([1,2]);
    const ev=b.useSkill(u,lian,u), attack=ev.find(e=>e.type==='attack');
    expect(attack?.type==='attack'&&attack.hits.map(h=>h.uid)).toEqual([1,2]);
    expect(u.mp).toBe(110);
  });

  it('旱地忽律：戴宗被麻翻后救醒；朱贵到水亭放号箭，张横带吕方先到，隔一回合张顺带郭盛再到；打退官军才过关', () => {
    const { b, get, ev } = open('zhuguidian');
    expect(ev.some((e) => e.type === 'say' && /旱地忽律朱贵/.test(e.text))).toBe(true);
    expect(b.isBound(get('daizong'))).toBe(false);
    expect(get('zhangheng').present).toBe(false);
    killAll(b, true);
    expect(b.status).toBe('playing'); // 还没放号箭
    const zg = get('zhugui'); zg.x = 3; zg.y = 10; after(b);
    expect(get('zhangheng').present).toBe(true);
    expect(get('lvfang').present).toBe(true);
    expect(get('zhangshun').present).toBe(false);
    expect(get('shichen').present).toBe(true);
    turn(b, 3);
    expect(get('zhangshun').present).toBe(false);
    turn(b, 4);
    expect(get('zhangshun').present).toBe(true);
    expect(get('guosheng').present).toBe(true);
    killAll(b);
    expect(b.status).toBe('won');
  });

  it('梁山定计演完就过关', () => {
    const { b, ev } = open('liangshan-dingji');
    expect(b.status).toBe('won');
    expect(ev.some((e) => e.type === 'say' && /萧名让/.test(e.text))).toBe(true);
  });

  it('赚上梁山：先和拦路的强人过招，打退后王英等人才现身说破（负责人 2026-11-20），接着济州官兵三面杀来；戴宗和李俊、吕方、郭盛护着萧让、金大坚（友军、只会躲）', () => {
    const { s: st, b, get } = open('zhuanshang');
    expect(st.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['daizong', 'guosheng', 'lijun', 'lvfang']);
    for (const id of ['xiaorang', 'jindajian']) expect(get(id)).toMatchObject({ side: 'ally', present: true });
    const opening=st.units.filter(u=>u.id.startsWith('gb-')||u.id==='xunjian');
    expect(opening).toHaveLength(15);
    const escort=st.units.filter(u=>['daizong','lijun','lvfang','guosheng','xiaorang','jindajian'].includes(u.id));
    for(const u of escort) { expect(u.x).toBeGreaterThanOrEqual(17); expect(u.x).toBeLessThanOrEqual(21); expect(u.y).toBeGreaterThanOrEqual(9); expect(u.y).toBeLessThanOrEqual(12); }
    expect(opening.filter(u=>u.x-u.y < -10)).toHaveLength(5); // 画面左
    expect(opening.filter(u=>u.x+u.y > 45)).toHaveLength(5); // 画面下
    expect(opening.filter(u=>u.x-u.y > 20)).toHaveLength(5); // 画面右
    // 第一阶段：只有假强人；王英一伙和官军都还没出来
    expect(st.units.filter((u) => u.id.startsWith('fb-')).every((u) => get(u.id).present && get(u.id).side === 'enemy')).toBe(true);
    for (const id of ['wangying', 'yanshun', 'xunjian']) expect(get(id).present, id).toBe(false);
    killAll(b, true);
    expect(b.status).toBe('playing');
    const active=b.active();
    expect(new Set(active.map(u=>u.x+','+u.y)).size).toBe(active.length);
    for(const foe of opening) {
      expect(get(foe.id).present).toBe(true);
      for(const u of escort) expect(Math.abs(foe.x-u.x)+Math.abs(foe.y-u.y)).toBeGreaterThanOrEqual(12);
    }

    for (const id of ['wangying', 'yanshun']) expect(get(id)).toMatchObject({ side: 'ally', present: true });
    expect(get('xunjian').present).toBe(true);
    expect(get('gc-1').present).toBe(false);
    turn(b, 1); // 第 2 回合（现身后一回合）
    expect(get('gc-1').present).toBe(false);
    turn(b, 2);
    expect(get('gc-1').present).toBe(true);
    expect(get('gd-1').present).toBe(false);
    turn(b, 3);
    expect(get('gd-1').present).toBe(true);
    killAll(b);
    expect(b.status).toBe('won');
  });

  it('伪书事泄（原名假信露馅，负责人 2026-11-20 改）：戴宗开场就被擒绑走；武龙带李俊、吕方、郭盛、朱贵、王英、燕顺从北面后门杀出去才过关（地图用大闹太尉府）；之后进梁山泊整备', () => {
    const { b, get, s } = open('jiaxin');
    expect(s.title).toBe('伪书事泄');
    expect(s.townAfter).toBe(11);
    expect(s.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['daizong', 'guosheng', 'hero', 'lijun', 'lvfang', 'wangying', 'yanshun', 'zhugui']);
    for (const id of ['huangwenbing', 'caijiu']) expect(get(id).side, id).toBe('enemy');
    expect(get('daizong').present).toBe(false);
    expect(get('g1').present).toBe(true);
    expect(b.status).toBe('playing');
    const hero = get('hero'); hero.x = 16; hero.y = 0; after(b);
    expect(b.status).toBe('won');
  });

});
