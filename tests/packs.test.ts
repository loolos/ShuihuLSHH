// 扩展包（docs/game-design.md §15）：并入原版数据、关卡编译、外传「武松打虎」的剧本触发。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData } from '../src/rules/load.ts';
import { compileStage } from '../src/packs/build.ts';
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

  it('打死老虎：猎户登场，过关', () => {
    const { b, ws, tiger } = start();
    besides(ws, tiger);
    tiger.hp = 1;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 20 && b.status === 'playing'; i++) ev = strike(b, ws, undefined, tiger);
    expect(b.status).toBe('won');
    expect(b.units.filter((u) => u.classId === 49).every((u) => u.present)).toBe(true);
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
