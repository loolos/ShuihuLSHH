// 扩展包（docs/game-design.md §15）：并入原版数据、关卡编译、外传「武松打虎」的剧本触发。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData } from '../src/rules/load.ts';
import { compileStage } from '../src/packs/build.ts';
import { paintShoes, recolorLut } from '../src/packs/recolor.ts';
import { attackSkill, type Unit } from '../src/rules/unit.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('扩展包：武松打虎', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const base = has ? loadGameData(files, tr) : (null as never);
  const rt = has ? loadPackFromDisk('wusong', base) : (null as never);
  const stage = has ? rt.stages[0] : (null as never);
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
    expect(rt.classIds.get('wusong')).toBe(base.classes.length);
    expect(rt.classIds.get('tiger')).toBe(base.classes.length + 1);
    expect(rt.data.classes[base.classes.length].name).toBe('武松');
    expect(rt.data.charNames[base.classes.length + 1]).toBe('吊睛白额虎');
    expect([...rt.skillIds.values()].every((id) => id >= 2000)).toBe(true);
    const staff = rt.data.items[rt.itemIds.get('shaobang')! - 1];
    expect(staff.name).toBe('哨棒');
    expect(staff.attack).toBe(15);
    expect(base.items.length).toBe(rt.data.items.length - 1);
    // 老虎的出手动作：普攻、一扑同一个动作（组 0），一掀、一剪同一个（组 1）
    const tigerSkills = rt.data.classes[rt.classIds.get('tiger')!].skills;
    expect(tigerSkills.map((s) => s.group)).toEqual([0, 0, 1, 1]);
    expect(rt.looks.get(rt.classIds.get('tiger')!)!.actions.slice(3)).toEqual(['attack', 'attack-paw']);
  });

  it('武松用包里自己的头像（140 宽），老虎没有头像', () => {
    const face = rt.looks.get(rt.classIds.get('wusong')!)!.face;
    expect(typeof face).toBe('string');
    const png = fs.readFileSync(path.join('packs/wusong', face as string));
    expect(png.readUInt32BE(16)).toBe(140); // IHDR 宽
    expect(rt.looks.get(rt.classIds.get('tiger')!)!.face).toBeNull();
  });

  it('开场：老虎埋伏不在场，有回合限制和胜负条件，武松带着哨棒', () => {
    const { b, ws, tiger } = start();
    expect(tiger.present).toBe(false);
    expect(b.turnLimit).toBe(15);
    expect(b.objectives.join()).toContain('吊睛白额大虫');
    expect(ws.slots[0]).toBe(rt.itemIds.get('shaobang'));
    expect(ws.level).toBe(15);
    expect(tiger.level).toBe(17);
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

describe.skipIf(!has)('扩展包：赤发鬼夜战插翅虎', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const rt = has ? loadPackFromDisk('liutang', loadGameData(files, tr)) : (null as never);
  const start = (seed = 1) => {
    const b = new Battle(compileStage(rt, rt.stages[0], files, { seed, text: tr }));
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

  it('没有新职业，全用原版人物；开场雷横带 2 个士兵，另 2 个士兵和晁盖、吴用埋伏', () => {
    expect(rt.data.classes.length).toBe(loadGameData(files, tr).classes.length);
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

describe.skipIf(!has)('扩展包：江州好汉（戴宗借原版动画换色、李逵新画）', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const rt = has ? loadPackFromDisk('jiangzhou', loadGameData(files, tr)) : (null as never);

  it('戴宗借都頭（38）的动画和出手动作，命中帧沿用原版技能，有换色表', () => {
    const id = rt.classIds.get('daizong')!;
    const look = rt.looks.get(id)!;
    expect(look.from).toBe(38);
    expect(look.recolor?.length).toBeGreaterThan(0);
    const mine = rt.data.classes[id].skills;
    const src = rt.data.classes[38].skills;
    expect(mine.map((s) => s.group)).toEqual([0, 1, 2]);
    expect(mine[0].hits).toEqual(src[0].hits);
    expect(mine[1].name).toBe('旋风腿');
    expect(rt.data.classes[id].move).toBe(8);
    expect(look.face).toBe('faces/daizong.png');
    expect(rt.looks.get(rt.classIds.get('likui')!)!.face).toBe('faces/likui.png');
  });

  it('换色表：只换指定色阶，透明色不动，结果落在目标色阶里', () => {
    const pal = new Uint8Array(files.get('Data/Default.pal').subarray(0, 768));
    const look = rt.looks.get(rt.classIds.get('daizong')!)!;
    const lut = recolorLut(pal, look.recolor!);
    expect(lut[0]).toBe(0);
    for (let i = 16; i <= 31; i++) expect(lut[i] >= 160 && lut[i] <= 175).toBe(true);
    expect(lut[100]).toBe(100);
  });

  it('宋江混搭：走路用自己的（职业 6），受击、防御、出手借王伦（68）和公孙胜（2），命中帧跟着出处走', () => {
    const id = rt.classIds.get('songjiang')!;
    const look = rt.looks.get(id)!;
    expect(look.from).toBe(6);
    expect(look.idleWalk).toBe(true);
    expect(look.face).toBe(6);
    expect(look.parts?.get(0)).toBeUndefined();
    expect(look.parts?.get(1)).toMatchObject({ from: 68, action: 1, shoes: true });
    expect(look.parts?.get(2)).toMatchObject({ from: 68, action: 2 });
    expect(look.parts?.get(3 + 3)).toMatchObject({ from: 2, action: 6 });
    expect(look.parts?.get(1)?.recolor?.[0].dst).toEqual([144, 156]);
    const sk = rt.data.classes[id].skills;
    expect(sk.map((s) => s.name)).toEqual(['剑击', '跃斩', '剑舞', '旋斩', '及时雨', '运气']);
    expect(sk.map((s) => s.group)).toEqual([0, 1, 2, 3, 4, 5]);
    const hitsOf = (cls: number, skillId: number) => rt.data.classes[cls].skills.find((s) => s.skillId === skillId)!.hits;
    expect(sk[0].hits).toEqual(hitsOf(68, 194));
    expect(sk[2].hits).toEqual(hitsOf(68, 198));
    expect(sk[3].hits).toEqual(hitsOf(2, 22));
  });

  it('染鞋：只染贴地的窄条（脚），宽的袍摆和影子不动', () => {
    // 小人：第 0–8 行宽袍（12 像素宽），第 9–11 行两只脚（各 2 像素宽），第 12 行影子
    const w = 14, h = 13;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < 9; y++) for (let x = 1; x < 13; x++) px[y * w + x] = 20;
    for (let y = 9; y < 12; y++) for (const x of [3, 4, 9, 10]) px[y * w + x] = 20;
    for (let x = 0; x < w; x++) px[12 * w + x] = 158;
    const lut = new Uint8Array(256).map((_, i) => (i === 20 ? 40 : i));
    paintShoes(px, w, h, lut);
    expect(px[11 * w + 3]).toBe(40);
    expect(px[9 * w + 10]).toBe(40);
    expect(px[8 * w + 1]).toBe(20);
    expect(px[3 * w + 5]).toBe(20);
    expect(px[12 * w + 5]).toBe(158);
  });

  it('李逵用自己的 3D 精灵图条，四个技能，黑旋风沿用迴旋技的四方向命中段', () => {
    const id = rt.classIds.get('likui')!;
    const look = rt.looks.get(id)!;
    expect(look.from).toBeUndefined();
    expect(look.sheet).toBe('sprites/likui');
    const sk = rt.data.classes[id].skills;
    expect(sk.map((s) => s.name)).toEqual(['板斧砍', '双斧连劈', '黑旋风', '运气']);
    expect(sk[1].hits.length).toBe(2);
    expect(new Set(sk[2].hits.map((h) => h.dir)).size).toBe(4);
  });

  it('试手关：敌人全部倒下即过关', () => {
    const b = new Battle(compileStage(rt, rt.stages[0], files, { seed: 1, text: tr }));
    b.begin();
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.hp = 0, (u.alive = false), (u.present = false);
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('won');
  });
});
