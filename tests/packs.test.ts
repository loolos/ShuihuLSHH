// 扩展包（docs/game-design.md §15）：并入原版数据、关卡编译、外传「武松打虎」的剧本触发。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { areaCells } from '../src/rules/skills.ts';
import { planAi } from '../src/rules/ai.ts';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { compileStage } from '../src/packs/build.ts';
import { paintShoes, recolorLut } from '../src/packs/recolor.ts';
import { attackSkill, type Unit } from '../src/rules/unit.ts';
import { packParty, townParty, saveTownParty, recordPackResult } from '../src/packs/campaign.ts';
import { buy, pawn } from '../src/rules/town.ts';
import { inheritAssets, pendingInsert, recordResult, type CampaignState } from '../src/rules/campaign.ts';
import { insertPlaces } from '../src/rules/chapters.ts';
/** 章节表算出的插关位置：关卡 id → before / after */
const placeOf = (id: string) => insertPlaces().find((p) => p.ref === `mainline/${id}`);
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

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

describe('宋江职业', () => {
  it('主线续篇的宋江和江州外传的宋江用同一套属性、技能和形象（只有随身道具和技能 id 不同）', () => {
    const cls = (pack: string, id: string) => JSON.parse(fs.readFileSync(`packs/${pack}/pack.json`, 'utf8')).classes.find((c: { id: string }) => c.id === id);
    const strip = (c: Record<string, unknown>) => {
      const { id: _id, items: _items, skills, ...rest } = c;
      return { ...rest, skills: (skills as { id: string }[]).map(({ id: _sid, ...s }) => s) };
    };
    expect(strip(cls('mainline', 'sj-fugitive'))).toEqual(strip(cls('jiangzhou', 'songjiang')));
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

describe.skipIf(!has)('扩展包：江州好汉（戴宗借原版动画换色、李逵新画）', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const rt = has ? loadPackFromDisk('jiangzhou', loadGameData(files, tr)) : (null as never);

  it('我方按个人等级配装，保留包自带剧情武器', () => {
    const names = (stageId: string, cls: string) => {
      const u = compileStage(rt, rt.stages.find((s) => s.id === stageId)!, files).units.find((x) => x.side === 'player' && x.type === rt.classIds.get(cls))!;
      return u.items.filter(Boolean).map((id) => rt.data.items[id - 1].name);
    };
    // 戴宗 22 级：常服／头巾；剧本旧药清理后发两颗大还金丹
    expect(names('shishou', 'daizong')).toEqual(['精鋼拳', '麻布寬衫', '萬字巾', '大還金丹', '大還金丹']);
    // 武松和武龙一样用手套（负责人 2026-11-15）；哨棒只在景阳冈开场临时拿着，战后还回手套
    const ws = loadPackFromDisk('mainline', loadGameData(files, tr));
    const u = compileStage(ws, ws.stages.find((s) => s.id === 'jingyanggang')!, files).units.find((x) => x.side === 'player')!;
    expect(u.items.slice(0, 3).map((id) => ws.data.items[id - 1].name)).toEqual(['精鋼刺拳', '青紗衫子', '黑頭巾']);
  });

  it('戴宗借都頭（38）的动画和出手动作，命中帧沿用原版技能，有换色表', () => {
    const id = rt.classIds.get('daizong')!;
    const look = rt.looks.get(id)!;
    expect(look.from).toBe(38);
    expect(look.recolor?.length).toBeGreaterThan(0);
    const mine = rt.data.classes[id].skills;
    const src = rt.data.classes[38].skills;
    expect(mine.map((s) => s.group)).toEqual([0, 1, 2, 2, 1, 1, 1]);
    expect(mine[3]).toMatchObject({ name: '神行渡气', type: 8, chargeTarget: 'ally', group: 2, hits: [] });
    expect(mine.slice(4).map((s) => [s.name, s.type, s.learnLevel])).toEqual([
      ['疾风踏阵LV1', 15, 12], ['疾风踏阵LV2', 15, 20], ['疾风踏阵LV3', 15, 28],
    ]);
    for (const skill of mine.slice(4)) expect(skill.hits).toEqual([{ frame: 14, percent: 100, dir: 0 }]);
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
    expect(look.parts?.get(3 + 6)).toMatchObject({ from: 68, action: 5 });
    expect(look.parts?.get(1)?.recolor?.[0].dst).toEqual([144, 156]);
    // 负责人 2026-11-14 重做：普攻、回旋技、回气、身前 3×6 范围技、范围回血
    const sk = rt.data.classes[id].skills;
    expect(sk.map((s) => s.name)).toEqual(['孝义剑', '四海归心', '卧虎藏锋', '血染浔阳', '及时雨']);
    expect(sk.map((s) => s.type)).toEqual([5, 2, 8, 14, 9]);
    expect(sk.map((s) => s.group)).toEqual([0, 3, 5, 6, 4]);
    const hitsOf = (cls: number, skillId: number) => rt.data.classes[cls].skills.find((s) => s.skillId === skillId)!.hits;
    expect(sk[0].hits).toEqual(hitsOf(68, 194));
    expect(new Set(sk[1].hits.map((h) => h.dir))).toEqual(new Set([0, 1, 2, 3]));
    expect(sk[3].hits).toEqual(hitsOf(68, 197));
    // 血染浔阳：身前宽 3、长 6，共 18 格，不含自己
    const board = { inBounds: () => true } as unknown as Parameters<typeof areaCells>[0];
    const cells = areaCells(board, { x: 10, y: 10 }, sk[3], { x: 11, y: 10 });
    expect(cells.length).toBe(18);
    expect(cells.every((c) => c.x >= 11 && c.x <= 16 && c.y >= 9 && c.y <= 11)).toBe(true);
    expect(sk[4]).toMatchObject({ area: 3, power: 3, rangeMax: 0 });
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

  it('李逵用自己的图条，五招分八个学习节点，普攻四斧与旋风四方向保留', () => {
    const id = rt.classIds.get('likui')!;
    const look = rt.looks.get(id)!;
    expect(look.from).toBeUndefined();
    expect(look.sheet).toBe('sprites/likui');
    const sk = rt.data.classes[id].skills;
    expect(sk.map((s) => s.name)).toEqual(['双斧开山','狂澜裂岳LV1','裂石连斩','沉息蓄锋','狂澜裂岳LV2','旋风卷岳','狂澜裂岳LV3','狂澜裂岳LV4']);
    expect(sk[0].hits.map((h) => h.percent)).toEqual([25, 25, 25, 25]);
    expect(sk[0].hits.map((h) => h.frame)).toEqual([6, 18, 29, 41]);
    const combo = rt.sheets[look.sheet].actions['axe-four'];
    for (const strip of [combo.front, combo.back]) {
      expect(strip.cycles).toBe(4);
      expect(strip.frames * strip.ms * strip.cycles!).toBe(2080);
    }
    expect(sk.find(s=>s.name==='裂石连斩')!.hits.length).toBe(2);
    expect(new Set(sk.find(s=>s.name==='旋风卷岳')!.hits.map((h) => h.dir)).size).toBe(4);
  });

  it('绑住、走到身边松绑、几人都到区域才触发、纯剧情关', () => {
    const stage = {
      id: 't',
      title: '测试',
      map: { base: 'N-add02' },
      units: [
        { id: 'sj', class: 'songjiang', side: 'player' as const, x: 4, y: 7, level: 20 },
        { id: 'dz', class: 'daizong', side: 'player' as const, x: 8, y: 7, level: 20 },
        { id: 'lk', class: 'likui', side: 'player' as const, x: 4, y: 10, level: 20 },
        { id: 'e', class: 32, side: 'enemy' as const, x: 14, y: 14, level: 10 },
      ],
      script: [
        { on: 'start' as const, do: [['bind', 'sj'], ['bind', 'dz']] as [string, ...unknown[]][] },
        { on: { near: 'sj' }, do: [['narrate', '割断绳索'], ['cleanse', 'sj']] as [string, ...unknown[]][] },
        { on: { enter: ['sj', 'dz'], area: [0, 0, 6, 6] as [number, number, number, number] }, do: [['victory', '逃出']] as [string, ...unknown[]][] },
      ],
    };
    const b = new Battle(compileStage(rt, stage, files, { seed: 1, text: tr }));
    b.begin();
    const by = (n: string) => b.units.find((u) => u.name === n)!;
    const sj = by('宋江'), dz = by('戴宗'), lk = by('李逵');
    expect(sj.stunTurns).toBeGreaterThan(100);
    expect(b.canAct(sj)).toBe(false);
    b.move(lk, 4, 8);
    expect(sj.stunTurns).toBe(0);
    expect(b.canAct(sj)).toBe(true);
    expect(dz.stunTurns).toBeGreaterThan(100);
    // 只有宋江到了区域不算，两人都到才过关
    sj.x = 3, sj.y = 3;
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('playing');
    dz.x = 2, dz.y = 2;
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('won');

    // 纯剧情关：没有敌人，开场演完就过关
    const story = {
      id: 's',
      title: '过场',
      map: { base: 'N-add02' },
      units: [{ id: 'sj', class: 'songjiang', side: 'player' as const, x: 4, y: 7, level: 20 }],
      script: [{ on: 'start' as const, do: [['say', 'sj', '题诗'], ['victory', '']] as [string, ...unknown[]][] }],
    };
    const c = new Battle(compileStage(rt, story, files, { seed: 1, text: tr }));
    const ev = c.begin();
    expect(ev.some((e) => (e as { text?: string }).text === '题诗')).toBe(true);
    expect(c.status).toBe('won');
  });

  it('宋江血染浔阳：身前 3×6 里的敌人都挨打，身后的不挨', () => {
    const b = new Battle(compileStage(rt, rt.stages.find((s) => s.id === 'shishou')!, files, { seed: 1, text: tr }));
    b.begin();
    const sj = b.units.find((u) => u.name === '宋江')!;
    sj.level = 30, (sj.mp = 999);
    const foes = b.units.filter((u) => u.side === 'enemy');
    const sk = b.data.classes[sj.classId].skills.find((s) => s.name === '血染浔阳')!;
    // 宋江在 (3,8)，向右放：x 4–9、y 7–9
    const spots = [{ x: 4, y: 8 }, { x: 9, y: 7 }, { x: 6, y: 9 }, { x: 2, y: 8 }];
    foes.slice(0, 4).forEach((f, i) => Object.assign(f, spots[i], { present: true }));
    for (const f of foes.slice(4)) f.present = false;
    sj.x = 3, (sj.y = 8);
    const hp = foes.slice(0, 4).map((f) => f.hp);
    const ev = b.useSkill(sj, sk, { x: 4, y: 8 });
    const hit = new Set(ev.flatMap((e) => (e.type === 'attack' ? e.hits.map((h) => h.uid) : [])));
    expect(foes.slice(0, 3).every((f) => hit.has(f.uid))).toBe(true);
    expect(hit.has(foes[3].uid)).toBe(false);
    expect(foes[3].hp).toBe(hp[3]);
  });

  it('试手关：敌人全部倒下即过关', () => {
    const b = new Battle(compileStage(rt, rt.stages.find((s) => s.id === 'shishou')!, files, { seed: 1, text: tr }));
    b.begin();
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.hp = 0, (u.alive = false), (u.present = false);
    (b as unknown as { afterAction: () => void }).afterAction();
    expect(b.status).toBe('won');
  });
});

describe.skipIf(!has)('外传：江州劫法场（§15.9）', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const rt = has ? loadPackFromDisk('jiangzhou', loadGameData(files, tr)) : (null as never);
  const open = (id: string) => {
    const b = new Battle(compileStage(rt, rt.stages.find((s) => s.id === id)!, files, { seed: 1, text: tr }));
    const said: string[] = [];
    const log = (ev: BattleEvent[]) => (ev.forEach((e) => (e.type === 'say' || e.type === 'narrate') && said.push(e.text)), ev);
    log(b.begin());
    return { b, said, log, by: (n: string) => b.units.find((u) => u.name === n)! };
  };
  /** at 只剩 1 点血、不闪避，挨 u 一下就倒 */
  const kill = (b: Battle, u: Unit, at: Unit) => {
    const x = b as unknown as { out: BattleEvent[]; cast: (...a: unknown[]) => void; afterAction: () => void; flush: () => BattleEvent[] };
    at.hp = 1;
    at.stats.agility = 0;
    u.x = at.x, (u.y = at.y + 1);
    for (let i = 0; i < 20 && at.alive; i++) {
      x.out = [];
      x.cast(u, attackSkill(u, b.data), { x: at.x, y: at.y }, false);
      x.afterAction();
      x.flush();
    }
  };
  const advance = (b: Battle, to: number, log: (ev: BattleEvent[]) => BattleEvent[]) => {
    while (b.status === 'playing' && b.turn < to) {
      for (const u of b.units) if (u.side === 'player') u.hp = 99999;
      log(b.endPlayerPhase());
    }
  };

  it('三关连成一串（下一关），所有单位都站在可通行格上；蔡九借何涛（54）的动画，用自己的头像', () => {
    expect(rt.stages.map((s) => [s.id, s.next])).toEqual([['xunyang', 'fachang'], ['fachang', 'bailongmiao'], ['bailongmiao', undefined], ['shishou', undefined]]);
    for (const s of rt.stages.filter((x) => x.id !== 'shishou')) {
      const b = new Battle(compileStage(rt, s, files, { seed: 1, text: tr }));
      for (const u of b.units) expect(b.board.passable(u.x, u.y), `${s.id} ${u.name} (${u.x},${u.y})`).toBe(true);
    }
    const cj = rt.classIds.get('caijiu')!;
    expect(rt.looks.get(cj)).toMatchObject({ from: 54, face: 'faces/caijiu.png' });
    // 友军花荣、黄信换色，不和敌方的弓箭手、都头撞样子；敌方不用都头
    expect(rt.looks.get(rt.classIds.get('huarong')!)).toMatchObject({ from: 34 });
    expect(rt.looks.get(rt.classIds.get('huarong')!)?.recolor?.length).toBeGreaterThan(0);
    expect(rt.looks.get(rt.classIds.get('huangxin')!)).toMatchObject({ from: 38 });
    for (const s of rt.stages) expect(s.units.filter((u) => u.side === 'enemy' && (u.class === 34 || u.class === 38)).every((u) => u.class !== 38), s.id).toBe(true);
  });

  it('浔阳楼：纯剧情关，题完反诗、黄文炳告发，演完就过关', () => {
    const { b, said } = open('xunyang');
    expect(said.some((t) => t.includes('敢笑黄巢不丈夫'))).toBe(true);
    expect(said.some((t) => t.includes('耗国因家木'))).toBe(true);
    expect(b.status).toBe('won');
  });

  it('法场：开场宋江、戴宗被绑，乔装的四伙人吵完退进人群，李逵跳下砍翻刽子手', () => {
    const { b, said, by } = open('fachang');
    expect(b.status).toBe('playing');
    expect(by('宋江').stunTurns).toBeGreaterThan(100);
    expect(by('戴宗').stunTurns).toBeGreaterThan(100);
    expect(by('宋江').slots[0]).toBe(0);
    expect(by('李逵').present).toBe(true);
    expect(b.units.filter((u) => u.name === '刽子手' && u.present)).toEqual([]);
    // 乔装的四伙人吵完留在场上围住法场（友军、原地不动），真身还没登场
    for (const n of ['弄蛇丐者', '使枪棒卖药的', '挑担脚夫', '推车客商']) {
      const ds = b.units.filter((u) => u.name === n);
      expect(ds.length, n).toBeGreaterThanOrEqual(4);
      expect(ds.every((u) => u.present && u.side === 'ally'), n).toBe(true);
    }
    expect(b.units.some((u) => u.name === '晁盖' && u.present)).toBe(false);
    expect(said.some((t) => t.includes('午时三刻'))).toBe(true);
    // 第 1 回合我方能动的只有李逵
    expect(b.units.filter((u) => u.side === 'player' && b.canAct(u)).map((u) => u.name)).toEqual(['李逵']);
  });

  it('法场：锣响后按回合加入——第 2 回合北客商（晁盖）、东丐者（三阮、白胜），第 3 回合西使枪棒，第 4 回合南脚夫；没原版形象的是友军', () => {
    const { b, said, log, by } = open('fachang');
    const here = (n: string) => b.units.find((u) => u.name === n && u.present);
    advance(b, 2, log);
    expect(said.some((t) => t.includes('小锣'))).toBe(true);
    for (const n of ['晁盖', '阮小二', '阮小五', '阮小七', '白胜']) expect(here(n)?.side, n).toBe('player');
    for (const n of ['小李广花荣', '镇三山黄信', '小温侯吕方', '赛仁贵郭盛']) expect(here(n)?.side, n).toBe('ally');
    expect(by('晁盖').classId).toBe(12);
    expect(b.units.filter((u) => (u.name === '推车客商' || u.name === '弄蛇丐者') && u.present && u.alive)).toEqual([]);
    expect(b.units.filter((u) => u.name === '使枪棒卖药的' && u.present).length).toBe(4);
    expect(here('刘唐')).toBeUndefined();
    expect(here('蔡九知府')).toBeUndefined(); // 逃命去了
    advance(b, 3, log);
    for (const n of ['刘唐', '摸着天杜迁', '云里金刚宋万']) expect(here(n)?.side, n).toBe('player');
    expect(by('云里金刚宋万').classId).toBe(70);
    expect(b.data.classes[70].skills.map((s) => s.name)).toEqual(['金剛拳', '金剛連環', '金剛轉輪', '雲裡雷音', '金剛入定', '雲開見日']);
    expect(here('锦毛虎燕顺')?.side).toBe('ally');
    expect(here('旱地忽律朱贵')).toBeUndefined();
    advance(b, 4, log);
    for (const n of ['旱地忽律朱贵', '矮脚虎王英', '白面郎君郑天寿', '石将军石勇']) expect(here(n)?.side, n).toBe('ally');
    // 换回真身后兵器也是自己的
    // 换回真身后按个人等级配自己的武器类型
    expect(b.data.items[by('阮小二').slots[0] - 1].name).toBe('飛魚叉');
    expect(b.data.items[by('白胜').slots[0] - 1].type).toBe(b.data.items[56 - 1].type);
  });

  it('法场：走到宋江身边松绑、还他剑；两人都到出口过关；宋江倒下判负', () => {
    const { b, by } = open('fachang');
    const sj = by('宋江'), dz = by('戴宗'), lk = by('李逵');
    const x = b as unknown as { afterAction: () => void };
    lk.x = sj.x, lk.y = sj.y - 1;
    x.afterAction();
    expect(sj.stunTurns).toBe(0);
    expect(sj.slots[0]).toBe(63);
    expect(dz.stunTurns).toBeGreaterThan(100);
    sj.x = 35, sj.y = 53;
    x.afterAction();
    expect(b.status).toBe('playing');
    dz.x = 36, dz.y = 53;
    x.afterAction();
    expect(b.status).toBe('won');

    const c = open('fachang');
    kill(c.b, c.b.units.find((u) => u.side === 'enemy' && u.present)!, c.by('宋江'));
    expect(c.b.status).toBe('lost');
  });

  it('白龙庙：第 4 回合水军九人坐船赶到当友军；打倒兵马都监过关', () => {
    const { b, said, log, by } = open('bailongmiao');
    const boats = ['浪里白条张顺', '船火儿张横', '混江龙李俊', '催命判官李立', '没遮拦穆弘', '小遮拦穆春', '出洞蛟童威', '翻江蜃童猛', '病大虫薛永'];
    expect(boats.every((n) => !by(n).present)).toBe(true);
    advance(b, 4, log);
    for (const n of boats) expect(by(n).present && by(n).side, n).toBe('ally');
    expect(said.some((t) => t.includes('三只大船'))).toBe(true);
    kill(b, by('晁盖'), by('江州兵马都监'));
    expect(b.status).toBe('won');
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
    expect(rt.stages.map((s) => [s.id, placeOf(s.id)?.before, !!s.pov])).toEqual([
      ['wawasi', 'N-add06', false],
      ['chifagui', 'Act10-1', true],
      ['sanruan', 'Act10-1', true],
      ['zhizhulin', 'Act7-1a', false],
      ['songjiang-yanshixi', undefined, false],
      ['songjiazhuang', undefined, true],
      ['chaijin-liubin', undefined, true],
      ['jingyanggang', undefined, true],
      ['tiaolian', undefined, true],
      ['shizilou', undefined, false],
      ...['shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou'].map(id => [id,undefined,false]),
    ]);
    const cutscenes = ['songjiang-yanshixi', 'chaijin-liubin', 'tiaolian', 'shizipo','anpingzhai','zhangfu'];
    for (const s of rt.stages.filter((x) => !cutscenes.includes(x.id))) {
      const b = new Battle(compileStage(rt, s, files, { seed: 1, text: tr }));
      b.begin();
      expect(b.status).toBe('playing');
      for (const u of b.units.filter((x) => x.present)) expect(b.board.passable(u.x, u.y), `${s.id} ${u.name} (${u.x},${u.y})`).toBe(true);
    }
  });

  it('武松四段（§15.12）：接在义释宋公明后面；单位和 move 的目标格都可通行；过场里每个 move 都走得到；过场演完就过关', () => {
    const after = insertPlaces().filter((p) => p.after === 'N14').map((p) => p.ref.slice('mainline/'.length));
    expect(after).toEqual(['songjiang-yanshixi', 'songjiazhuang', 'chaijin-liubin', 'jingyanggang', 'tiaolian', 'shizilou', 'shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou']);
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
    const act = loadStage(files, base, 'Act7-1', { simplified: true, text: tr });
    const ambush = loadStage(files, base, 'Act7-1a', { simplified: true, text: tr });
    const text = (input: typeof act) => input.displayBlocks!.flatMap((block) => block.ops.map((op) => op.text ?? '')).join('\n');
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
      expect(speech.filter(e => e.uid === uid).length).toBeGreaterThanOrEqual(4);
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
  it('六关全体含隐藏单位及move落点可通行、不重格，三剧情显式胜利',()=> {
    for (const id of ['shizipo','anpingzhai','kuaihuolin','zhangfu','feiyunpu','yuanyanglou']) {
      const s=stage(id), b = new Battle(compileStage(rt,s,files));
      const cells=new Set<string>();
      for (const u of s.units) { expect(b.board.passable(u.x,u.y),`${id}/${u.id}`).toBe(true); expect(cells.has(`${u.x},${u.y}`)).toBe(false);cells.add(`${u.x},${u.y}`); }
      for(const blk of s.script)for(const op of blk.do)if(op[0]==='move')expect(b.board.passable(Number(op[2]),Number(op[3]))).toBe(true);
      b.begin(); if(['shizipo','anpingzhai','zhangfu'].includes(id))expect(b.status).toBe('won');
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
    expect(pendingInsert({version:1,stage:1,gold:0,members:[]},list,'N14','after','mainline/yuanyanglou')).toBeUndefined();
    expect(stage('shizilou').townAfter).toBe(11);
  });
  it('飞云浦等待后续增援不提前胜；鸳鸯楼三首领缺一不可',()=> {
    const b=start('feiyunpu');
    for(const u of b.units) { if(u.side==='player')u.hp=99999; else if(u.present){u.hp=0;u.alive=false;u.present=false;} }
    b.endPlayerPhase();expect(b.status).toBe('playing');expect(b.turn).toBe(2);
    expect(b.units.filter(u=>u.side==='enemy'&&u.present)).toHaveLength(6);
    const y=start('yuanyanglou'), bosses=y.units.filter(u=>u.side==='enemy');
    for(const u of y.units)if(u.side==='player')u.hp=99999;
    for(const u of bosses.slice(0,2)){u.hp=0;u.alive=false;u.present=false;}
    bosses[2].hp=99999;y.endPlayerPhase();expect(y.status).toBe('playing');
    bosses[2].hp=0;bosses[2].alive=false;bosses[2].present=false;y.endPlayerPhase();expect(y.status).toBe('won');
  });
  it('飞云浦使用默认模板，连续五回合各来六人，最后一波全灭才获胜', () => {
    const b = start('feiyunpu');
    const foes = b.units.filter(u => u.side === 'enemy');
    expect(stage('feiyunpu').map).toEqual({ custom: 'dukou' });
    expect([b.board.width, b.board.height]).toEqual([30, 24]);
    const bridgeReach = b.board.reach({ x: 21, y: 10 }, 1000, new Set());
    for (const u of b.units) expect([...bridgeReach.values()].some(c => c.x === u.x && c.y === u.y), `桥面可达 ${u.name}`).toBe(true);
    expect(foes).toHaveLength(36);
    expect(new Set(foes.map(u => u.classId))).toEqual(new Set([32, 67, 65, 38]));
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
      expect(foes.filter(u => u.present)).toHaveLength(6);
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
