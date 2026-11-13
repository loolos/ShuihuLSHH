// 规则引擎单元测试：使用手写的小数据，不依赖原版文件。
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { cellPassable } from '../src/rules/passability.ts';
import { baseDamage, critChance, rangedFactor, facingRelation, hitChance, previewAttack, rollAttack } from '../src/rules/combat.ts';
import { DEFEND_BONUS, dodgeExp, killerShare, killExp, restExp, splitTeamExp, takenExp, teamShare } from '../src/rules/exp.ts';
import { buildClasses, type ClassDef, type GameData, type SkillDef } from '../src/rules/data.ts';
import type { ClassRecord } from '../src/formats/hum.ts';
import { Rng } from '../src/rules/rng.ts';
import { computeStats, facingTowards, refreshStats, type Unit } from '../src/rules/unit.ts';
import { CLASS_OVERRIDES, CLASS_TWEAKS, GRUNT, GRUNT_GEAR, OFFICER, baseStat, perLevel, statAt } from '../src/rules/growth.ts';
import { Battle } from '../src/rules/battle.ts';
import { areaCells, learnedSkills } from '../src/rules/skills.ts';
import { adjustEnemies, enemyFloor, enemyLevel, enemyShift } from '../src/rules/enemy-level.ts';
import { joinLevel, newCampaign, nextStages, partyOf, recordResult } from '../src/rules/campaign.ts';
import { goldBase, goldRange, killGold, stageClearGold, STAGE_CLEAR_GOLD } from '../src/rules/gold.ts';
import type { PasBlock } from '../src/formats/pas.ts';
import type { ActUnit } from '../src/formats/act.ts';
import type { Item } from '../src/formats/goo.ts';
import { FLOAT_COLOR, recoveryFloats } from '../src/game/float-text.ts';

const g = (base: number, growth = 100) => ({ base, growth });
const punch: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false, effect: 0, effect2: 0, effect3: 0, power: 0, poison: 0, stun: 0, rangeMin: 1, rangeMax: 1,
  area: 1, learnLevel: 1, mpCost: 0, hitMod: 0, critMod: 0, hits: [{ frame: 1, percent: 100, dir: 0 }], raw: '',
};
const cls = (id: number, o: Partial<ClassDef> = {}): ClassDef => ({
  id, name: `C${id}`, hp: g(100), mp: g(50), attack: g(60), defense: g(20), hit: g(80), agility: g(40), crit: g(10), move: 4,
  weaponType: 0, goldCap: 50, defaultItems: [0, 0, 0, 0, 0, 0, 0], skills: [punch], ...o,
});
const glove = { type: 0, name: '皮手套', attack: 7, defense: 0, attackStep: 0, attackSteps: 0, defenseStep: 0, defenseSteps: 0, hit: 0, agility: 0, crit: 0, moveBonus: 0, range: 0, maxHp: 0, maxMp: 0, regenHp: 0, regenMp: 0, poison: 0, stun: 0 } as unknown as Item;
const data: GameData = { classes: [cls(0), cls(1), cls(2, { goldCap: 0 })], items: [glove], charNames: ['甲', '乙', '丙'], heroName: '甲' };

function unit(o: Partial<Unit>): Unit {
  const stats = computeStats(data.classes[o.classId ?? 0], o.level ?? 0, o.slots ?? [], data);
  return {
    uid: 0, classId: 0, name: 'u', side: 'player', x: 0, y: 0, facing: 0, level: 0, exp: 0, hp: stats.maxHp, mp: stats.maxMp, stats,
    slots: [], forge: [], gold: 0, ai: { mode: 0, target: 0, point: { x: 0, y: 0 } }, present: true, alive: true, defending: false, poisonTurns: 0,
    stunTurns: 0, buffs: [], movementRemaining: 4, forcedMarch: false, acted: false, ended: false, turnStart: null, ...o,
  };
}

describe('属性', () => {
  it('每级加 固定点数 + 初始值 × 百分比，累计后取整，不封顶', () => {
    const wulong = cls(0, { attack: g(65, 105), defense: g(30, 110) });
    expect(perLevel(wulong, 'attack')).toBeCloseTo(1.5 + 65 * 0.03); // 3.45
    expect(statAt(wulong, 'attack', 1)).toBe(68);
    expect(statAt(wulong, 'attack', 10)).toBe(99);
    expect(statAt(wulong, 'attack', 30)).toBe(168);
    expect(statAt(cls(0, { defense: g(300) }), 'defense', 30)).toBe(300 + 30 * (2 + 24)); // 不封顶
  });
  it('个别职业的初始值调整（王進攻击 80）', () => {
    expect(statAt(cls(1, { attack: g(70, 104) }), 'attack', 0)).toBe(CLASS_OVERRIDES[1].attack);
  });
  it('按职业的偏移：百分比和加点数', () => {
    expect(CLASS_TWEAKS[66].pct!.hp).toBe(-15);
    const assassin = cls(66), captain = cls(65), constable = cls(38);
    expect(baseStat(constable, 'hp')).toBe(OFFICER.hp); // 都頭是标准
    expect(baseStat(assassin, 'hp')).toBe(Math.round(OFFICER.hp * 0.85));
    expect(baseStat(assassin, 'crit')).toBe(OFFICER.crit + 8);
    expect(baseStat(captain, 'hp')).toBe(Math.round(OFFICER.hp * 1.15));
    expect(baseStat(cls(59, { attack: g(100) }), 'attack')).toBe(70); // 陳達 −30%
  });
  it('杂兵用模板：同等级属性一样，装备只给固定加成', () => {
    const soldier = cls(32, { attack: g(55, 105) }), fisher = cls(21, { attack: g(50, 104) });
    expect(statAt(soldier, 'attack', 20)).toBe(statAt(fisher, 'attack', 20));
    expect(statAt(soldier, 'hit', 0)).toBe(GRUNT.hit);
    const d2: GameData = { ...data, classes: [soldier] };
    expect(computeStats(soldier, 0, [1], d2).attack).toBe(GRUNT.attack + GRUNT_GEAR.attack!); // 皮手套 +7 不算
  });
  it('装备加成按道具编号（从 1 开始）计算', () => {
    expect(computeStats(data.classes[0], 0, [1], data).attack).toBe(67);
    expect(computeStats(data.classes[0], 0, [1], data, true).attack).toBe(33); // 中毒减半
  });
});

describe('职业移动力调整', () => {
  it('武龍基础移动力比职业表多 1，其他人照原值', () => {
    const rec = (id: number) => ({ id, hp: 100, hpGrowth: 100, mp: 50, mpGrowth: 100, stats: Array(5).fill({ base: 10, growth: 100 }), move: 5, weaponType: 0, goldCap: 0, defaultItems: [], skills: [] }) as unknown as ClassRecord;
    const [hero, wangjin] = buildClasses([rec(0), rec(1)], ['武龍', '王進'], []);
    expect(hero.move).toBe(6);
    expect(wangjin.move).toBe(5);
  });
});

describe('武龍普攻两段', () => {
  it('一鳴驚人改成同一帧的两段 50% + 50%，其他职业照原值', () => {
    const one = [{ frame: 9, percent: 100, dir: 0 }];
    const rec = (id: number) =>
      ({ id, hp: 100, hpGrowth: 100, mp: 50, mpGrowth: 100, stats: Array(5).fill({ base: 10, growth: 100 }), move: 5, weaponType: 0, goldCap: 0, defaultItems: [], skills: [{ ...punch, hits: one }, { ...punch, hits: one }] }) as unknown as ClassRecord;
    const [hero, wangjin] = buildClasses([rec(0), rec(1)], ['武龍', '王進'], []);
    expect(hero.skills[0].hits).toEqual([{ frame: 9, percent: 50, dir: 0 }, { frame: 9, percent: 50, dir: 0 }]);
    expect(hero.skills[1].hits).toEqual(one);
    expect(wangjin.skills[0].hits).toEqual(one);
    // 两段全中时总伤害和单段一样（不计浮动），两段各占一半
    const att = unit({ side: 'player', x: 0, y: 1, facing: 0 });
    att.stats = { ...att.stats, crit: 0 };
    const foe = unit({ side: 'enemy', x: 0, y: 0, facing: 2 });
    const [n] = baseDamage(att, foe, punch);
    const r2 = rollAttack(att, foe, hero.skills[0], new Rng(5), true);
    expect(r2.parts).toHaveLength(2);
    expect(r2.parts[0] + r2.parts[1]).toBe(r2.damage);
    expect(r2.damage).toBeGreaterThanOrEqual(Math.floor(n * 0.9));
    expect(r2.damage).toBeLessThanOrEqual(Math.ceil(n * 1.1));
    expect(Math.abs(r2.parts[0] - r2.parts[1])).toBeLessThanOrEqual(1);
  });
});

describe('装备移动力', () => {
  it('装备扣移动不生效，加移动照算', () => {
    const boots = { ...glove, moveBonus: 1 } as Item, helm = { ...glove, type: 14, moveBonus: -2 } as Item;
    const d2: GameData = { ...data, items: [boots, helm] };
    expect(computeStats(d2.classes[0], 0, [1, 0, 2], d2).move).toBe(5);
    expect(computeStats(d2.classes[0], 0, [0, 0, 2], d2).move).toBe(4);
  });
});

describe('命中与伤害', () => {
  const a = unit({ side: 'player', x: 0, y: 1, facing: 0 });
  it('朝向关系', () => {
    expect(facingRelation(0, 0)).toBe('back');
    expect(facingRelation(0, 2)).toBe('front');
    expect(facingRelation(0, 1)).toBe('side');
    expect(facingTowards({ x: 0, y: 1 }, { x: 0, y: 0 })).toBe(0);
    expect(facingTowards({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
  });
  it('命中 = 命中 / (命中 + 敏捷/2)，按朝向放大，敌我同一公式、没有保底', () => {
    // 守方面向 +y（朝向 2），攻方从 +y 方向往 −y 打（朝向 0）：正面
    const d = unit({ side: 'enemy', x: 0, y: 0, facing: 2, classId: 1 });
    expect(hitChance(a, d, punch)).toBe(80); // 80 / (80 + 20)
    const e = unit({ side: 'enemy', x: 0, y: 1, facing: 0 });
    const p = unit({ side: 'player', x: 0, y: 0, facing: 2 });
    expect(hitChance(e, p, punch)).toBe(80);
    expect(hitChance(e, p, { ...punch, hitMod: -10 })).toBe(70);
    p.facing = 0; // 背后
    expect(hitChance(e, p, punch)).toBe(100);
    p.facing = 1; // 侧面
    expect(hitChance(e, p, punch)).toBe(100);
    p.defending = true;
    expect(hitChance(e, p, punch)).toBe(72);
    expect(hitChance(e, unit({ stats: { ...p.stats, agility: 200 }, x: 0, y: 0, facing: 2 }), punch)).toBe(44);
  });
  it('伤害 = A² / (A + 2 防)，A = 攻 + 威力；必杀把 A 翻倍', () => {
    const d = unit({ side: 'enemy', facing: 2 }); // 正面
    expect(baseDamage(a, d, punch)).toEqual([36, 90]); // 60² / 100，120² / 160
    const tough = unit({ facing: 2, stats: { ...d.stats, defense: 240 } });
    const [n, c] = baseDamage(a, tough, punch);
    expect(n).toBeCloseTo(3600 / 540);
    expect(c).toBe(24); // 120² / 600
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) {
      const r = rollAttack(a, tough, punch, rng, true);
      expect(r.damage).toBeGreaterThanOrEqual(r.crit ? 21 : 6);
      expect(r.damage).toBeLessThanOrEqual(r.crit ? 26 : 7);
    }
    expect(critChance(a, { ...punch, critMod: 10 })).toBe(10);
  });
  it.each([
    [2, 1], [1, 1.1], [3, 1.1], [0, 1.25],
  ])('朝向%s的伤害系数为%s，预览与实际普通/必杀结算一致', (facing, factor) => {
    for (const defending of [false, true]) {
      for (const crit of [0, 200]) {
        const att = unit({ x: 0, y: 1, stats: { ...a.stats, crit } });
        const def = unit({ side: 'enemy', x: 0, y: 0, facing, defending });
        const f = defending ? 1 : factor;
        const defense = defending ? 0.7 : 1;
        const [normal, critical] = baseDamage(att, def, punch);
        expect(normal).toBeCloseTo(36 * f);
        expect(critical).toBeCloseTo(90 * f);
        const preview = previewAttack(att, def, punch);
        expect(preview.damage).toBe(Math.floor(normal * defense));
        expect(preview.critDamage).toBe(Math.floor(critical * defense));
        const rng = new Rng(17);
        rng.chance(crit / 2); // forceHit跳过命中随机，只消耗必杀判定
        const variation = 0.9 + rng.next() * 0.2;
        const result = rollAttack(att, def, punch, new Rng(17), true);
        expect(result.damage).toBe(Math.floor((crit ? critical : normal) * (defense * variation)));
      }
    }
  });

  it('远程攻击按距离打折：距离 1 为 50%，最远射程为 10%', () => {
    const bow = { ...punch, type: 10, rangeMin: 1, rangeMax: 8 };
    const d = unit({ side: 'enemy', x: 0, y: 0 });
    const at = (y: number) => unit({ side: 'player', x: 0, y });
    expect(rangedFactor(at(1), d, bow)).toBeCloseTo(0.5);
    expect(rangedFactor(at(8), d, bow)).toBeCloseTo(0.1);
    expect(rangedFactor(at(4), d, bow)).toBeCloseTo(0.5 - (0.4 * 3) / 7);
    expect(rangedFactor(at(1), d, punch)).toBe(1);
    const [n] = baseDamage(at(1), d, bow);
    expect(n).toBeCloseTo(baseDamage(at(1), d, punch)[0] * 0.5);
  });
  it('多段攻击按比例分配，合计等于总伤害', () => {
    const multi = { ...punch, hits: [25, 25, 25, 25].map((p, i) => ({ frame: i + 1, percent: p, dir: 0 })) };
    const r = rollAttack(a, unit({ side: 'enemy' }), multi, new Rng(3), true);
    expect(r.parts).toHaveLength(4);
    expect(r.partHit).toEqual([true, true, true, true]);
    expect(r.parts.reduce((s, x) => s + x, 0)).toBe(r.damage);
  });
  it('多段攻击每段单独判定命中和必杀', () => {
    const multi = { ...punch, hits: [25, 25, 25, 25].map((p, i) => ({ frame: i + 1, percent: p, dir: 0 })) };
    const foe = unit({ side: 'enemy', x: 0, y: 0, facing: 2 }); // 正面，命中 80%
    const atk = unit({ side: 'player', x: 0, y: 1, facing: 0, stats: { ...a.stats, crit: 100 } }); // 必杀 50%
    const rng = new Rng(7);
    let partial = 0, mixedCrit = 0;
    for (let i = 0; i < 200; i++) {
      const r = rollAttack(atk, foe, multi, rng);
      r.partHit.forEach((h, k) => !h && expect(r.parts[k]).toBe(0));
      expect(r.parts.reduce((s, x) => s + x, 0)).toBe(r.damage);
      if (r.partHit.some(Boolean) && !r.partHit.every(Boolean)) partial++;
      if (r.partCrit.some(Boolean) && r.partCrit.some((c, k) => r.partHit[k] && !c)) mixedCrit++;
    }
    expect(partial).toBeGreaterThan(50);
    expect(mixedCrit).toBeGreaterThan(50);
  });
  it('击倒经验只看敌人等级', () => {
    const foe = unit({ level: 10 });
    for (const lv of [1, 10, 30]) {
      const e = killExp(unit({ level: lv }), foe, new Rng(5));
      expect(e).toBeGreaterThanOrEqual(13);
      expect(e).toBeLessThanOrEqual(17);
      expect(e).toBe(killExp(unit({ level: 1 }), foe, new Rng(5)));
    }
  });
  it('挨打也有经验，防御时更多', () => {
    expect(takenExp(30, false, new Rng(1))).toBeGreaterThanOrEqual(3);
    expect(takenExp(30, true, new Rng(1)) - takenExp(30, false, new Rng(1))).toBe(DEFEND_BONUS);
    expect(DEFEND_BONUS).toBe(3);
    // 闪避：3–5，防御中再 +3
    for (let seed = 1; seed <= 20; seed++) {
      const plain = dodgeExp(false, new Rng(seed));
      expect(plain).toBeGreaterThanOrEqual(3);
      expect(plain).toBeLessThanOrEqual(5);
      expect(dodgeExp(true, new Rng(seed)) - plain).toBe(DEFEND_BONUS);
    }
    // 休息：按回复的体力 + 气力给少量经验，什么都没回复不给
    expect(restExp(0, 0, new Rng(1))).toBe(0);
    expect(restExp(31, 33, new Rng(1))).toBeGreaterThanOrEqual(3);
    expect(restExp(31, 33, new Rng(1))).toBeLessThanOrEqual(4);
  });
  it('全队经验先补给最落后的人', () => {
    const m = [{ level: 10, exp: 0 }, { level: 8, exp: 50 }, { level: 5, exp: 0 }, { level: 30, exp: 0 }];
    expect(splitTeamExp(m, 100)).toEqual([0, 0, 100, 0]);
    // 300 先把 5 级补到 8 级 50，剩 50 两人平分
    expect(splitTeamExp(m, 400)).toEqual([0, 25, 375, 0]);
    const all = splitTeamExp(m, 1000);
    expect(all.reduce((a, x) => a + x, 0)).toBe(1000);
    expect(all[3]).toBe(0); // 满级不分
  });
});

describe('棋盘', () => {
  it('BFS 不穿越阻挡和单位', () => {
    const b = new Board(5, 5);
    b.blocked[1 * 5 + 1] = 1;
    const r = b.reach({ x: 0, y: 0 }, 2, new Set(['1,0']));
    expect([...r.keys()].sort()).toEqual(['0,0', '0,1', '0,2']);
    expect(b.distanceField([{ x: 2, y: 2 }])[0]).toBe(4);
  });
});

const act = (index: number, type: number, side: ActUnit['side'], x: number, y: number, flags = 0, extra = [0, 0, 0]): ActUnit => ({
  index, type, group: 0, side, facing: 0, x, y, level: 1, flags, extra, items: [0, 0, 0, 0, 0, 0, 0], raw: [],
});

describe('战斗流程', () => {
  it('移动、撤销、攻击后结束行动', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 5, 0, 0x800)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    const { green, yellow } = b.moveRange(p);
    expect(green.length).toBeGreaterThan(0);
    expect(yellow.some((c) => c.x === 6 && c.y === 0)).toBe(false); // 敌人占着 (5,0)
    b.move(p, 4, 0);
    expect(p.movementRemaining).toBe(0);
    b.undoMove(p);
    expect(p.x).toBe(0);
    b.move(p, 4, 0);
    expect(b.attackTargets(p).map((t) => t.uid)).toEqual([1]);
    const ev = b.attack(p, b.unit(1)!);
    expect(ev.some((e) => e.type === 'attack')).toBe(true);
    expect(p.ended).toBe(true);
    b.endPlayerPhase();
    expect(b.turn).toBe(2);
    expect(b.phase).toBe('player');
  });

  it('我方全员行动完毕：昏迷、阵亡的人不算', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 0, 'player', 0, 2), act(2, 0, 'player', 0, 4), act(3, 1, 'enemy', 9, 9)], blocks: [], data, seed: 1 });
    b.begin();
    const [p, q, r] = [b.unit(0)!, b.unit(1)!, b.unit(2)!];
    expect(b.playerPhaseDone()).toBe(false);
    q.alive = false;
    r.ended = true; // 昏迷的人在回合开始时就是 ended
    expect(b.playerPhaseDone()).toBe(false);
    b.move(p, 3, 0);
    expect(b.playerPhaseDone()).toBe(false); // 移动后还能攻击/待机
    b.wait(p);
    expect(b.playerPhaseDone()).toBe(true);
  });

  it('宝箱：踩上或路过都拾取，放进随身物品栏；敌人不拾', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 9, 9), act(2, 1, 'object', 2, 0), act(3, 1, 'object', 8, 9)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.slots = [1, 0, 0, 0, 0, 0, 0];
    const ev = b.move(p, 3, 0);
    expect(ev.some((e) => e.type === 'pickup')).toBe(true);
    expect(p.slots).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(b.items).toHaveLength(1);
    b.endPlayerPhase();
    expect(b.items).toHaveLength(1);
  });

  it('宝箱：走到相邻格就打开（路过也算），随身物品 10 格，满了宝箱留着', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'object', 2, 1), act(2, 1, 'object', 5, 2)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    expect(p.slots).toHaveLength(13);
    p.slots = [1, 0, 0, ...Array(9).fill(1), 0];
    const ev = b.move(p, 3, 0); // 经过 (2,0)，与 (2,1) 的宝箱相邻
    expect(ev.filter((e) => e.type === 'pickup')).toHaveLength(1);
    expect(p.slots[12]).toBe(1);
    expect(b.items).toHaveLength(1);
  });

  it('宝箱：物品栏满了打不开，宝箱留着', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'object', 1, 1)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.slots = [1, 0, 0, ...Array(10).fill(1)];
    const ev = b.move(p, 1, 0);
    expect(ev.some((e) => e.type === 'pickup')).toBe(false);
    expect(ev.some((e) => e.type === 'message' && e.text.includes('道具已滿'))).toBe(true);
    expect(b.items).toHaveLength(1);
  });

  it('隐藏的宝物：地图上不画，路过照样拾到', () => {
    const hid = act(1, 1, 'object', 2, 0, 1);
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), hid], blocks: [], data, seed: 1 });
    b.begin();
    expect(b.items[0].hidden).toBe(true);
    const p = b.unit(0)!;
    p.slots = [1, 0, 0, 0, 0, 0, 0];
    expect(b.move(p, 3, 0).some((e) => e.type === 'pickup')).toBe(true);
    expect(b.items).toHaveLength(0);
  });

  it('我方与友军可以互相穿过但不能同格；敌人挡路，敌人之间也互相阻挡', () => {
    // 一条 10×1 的走廊：我方 0，友军 1，我方 2，敌人 6、7
    const b = new Battle({
      name: 't', board: new Board(10, 1),
      units: [act(0, 0, 'player', 0, 0), act(1, 0, 'ally', 1, 0), act(2, 0, 'player', 2, 0), act(3, 1, 'enemy', 6, 0, 0x800), act(4, 1, 'enemy', 7, 0, 0x800)],
      blocks: [], data, seed: 1,
    });
    b.begin();
    const p = b.unit(0)!;
    const cells = (r: { green: { x: number }[]; yellow: { x: number }[] }) => [...r.green, ...r.yellow].map((c) => c.x).sort();
    expect(cells(b.moveRange(p))).toEqual([3, 4, 5]); // 1、2 有自己人不能停；6 是敌人，过不去
    const ev = b.move(p, 3, 0);
    const mv = ev.find((e) => e.type === 'move') as { path: { x: number }[] } | undefined;
    expect(mv?.path.map((c) => c.x)).toEqual([0, 1, 2, 3]);
    expect(p.x).toBe(3);
    // 敌人不能穿过我方，也不能穿过另一个敌人
    const e2 = b.unit(4)!;
    expect([...b.reachOf(e2, 6).values()].map((n) => n.x)).toEqual([7, 8, 9]);
    const e1 = b.unit(3)!;
    expect([...b.reachOf(e1, 6).values()].map((n) => n.x).sort()).toEqual([4, 5, 6]);
    // 友军也能穿过我方
    const a = b.unit(1)!;
    expect([...b.reachOf(a, 6).values()].map((n) => n.x).sort()).toEqual([0, 1, 4, 5]); // 2、3 有我方，穿过但不停留
  });

  it('强行军：走进黄色范围后本回合结束', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    b.move(p, 6, 0); // 移动力 4 + 2
    expect(p.ended).toBe(true);
    expect(b.moveRange(p).green).toHaveLength(0);
  });

  it('回合终了的默认行动：缺血休息；只缺气先用回气剂再防御，没有就休息；都满防御', () => {
    const potion = { ...glove, type: 15, name: '藥', attack: 0, healHp: 10, healMp: 0 } as unknown as Item;
    const small = { ...glove, type: 15, name: '小氣', attack: 0, healHp: 0, healMp: 5 } as unknown as Item;
    const big = { ...glove, type: 15, name: '大氣', attack: 0, healHp: 0, healMp: 50 } as unknown as Item;
    const full = { ...glove, type: 15, name: '滿氣', attack: 0, healHp: 0, healMp: -1 } as unknown as Item;
    const d2: GameData = { ...data, items: [glove, potion, small, big, full] };
    const units = [act(0, 0, 'player', 0, 0), act(1, 0, 'player', 0, 2), act(2, 0, 'player', 0, 4), act(3, 0, 'player', 0, 6), act(4, 1, 'enemy', 9, 9)];
    const b = new Battle({ name: 't', board: new Board(10, 10), units, blocks: [], data: d2, seed: 1 });
    b.begin();
    const [hurt, tired, noPotion, fine] = [0, 1, 2, 3].map((k) => b.unit(k)!);
    for (const u of [hurt, tired, noPotion, fine]) (u.hp = u.stats.maxHp), (u.mp = u.stats.maxMp);
    // 缺血：休息（身上有回血药也不用）
    hurt.hp -= 1;
    hurt.mp = 0;
    hurt.slots = [0, 0, 0, 2, 3];
    // 只缺气：挑能补满缺口的最小一瓶（缺 10 → 大氣，不用小氣和滿氣），用完防御
    tired.mp -= 10;
    tired.slots = [0, 0, 0, 3, 5, 4];
    // 只缺气但没有回气剂（回血药不算）：休息
    noPotion.mp -= 1;
    noPotion.slots = [0, 0, 0, 2];
    expect(b.autoActUnits()).toEqual([hurt, tired, noPotion, fine]);

    const ev0 = b.autoAct(hurt);
    expect(ev0.some((e) => e.type === 'hp' && e.text === '休息')).toBe(true);
    expect(hurt.hp).toBe(hurt.stats.maxHp);
    expect(hurt.slots).toEqual([0, 0, 0, 2, 3]);

    expect(b.mpPotionSlot(tired)).toBe(5);
    const ev1 = b.autoAct(tired);
    expect(tired.mp).toBe(tired.stats.maxMp);
    expect(tired.slots[5]).toBe(0);
    expect(tired.slots[3] + tired.slots[4]).toBe(3 + 5);
    expect(tired.defending).toBe(true);
    expect(ev1.some((e) => e.type === 'defend')).toBe(true);

    b.autoAct(noPotion);
    expect(noPotion.mp).toBe(noPotion.stats.maxMp);
    expect(noPotion.defending).toBe(false);
    expect(noPotion.slots[3]).toBe(2);

    b.autoAct(fine);
    expect(fine.defending).toBe(true);
    for (const u of [hurt, tired, noPotion, fine]) expect(u.ended).toBe(true);
    expect(b.autoActUnits()).toEqual([]);
    expect(b.playerPhaseDone()).toBe(true);
  });

  it('回合终了：缺口比所有回气剂都大时用回得最多的；已经攻击过的人不再休息', () => {
    const small = { ...glove, type: 15, name: '小氣', attack: 0, healHp: 0, healMp: 5 } as unknown as Item;
    const mid = { ...glove, type: 15, name: '中氣', attack: 0, healHp: 0, healMp: 8 } as unknown as Item;
    const d2: GameData = { ...data, items: [glove, small, mid] };
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data: d2, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.hp = p.stats.maxHp;
    p.mp = 0;
    p.slots = [0, 0, 0, 2, 3];
    expect(b.mpPotionSlot(p)).toBe(4);
    p.slots = [0, 0, 0];
    p.acted = true; // 假设已经出过手但还没结束（理论上不会出现），只能防御
    b.autoAct(p);
    expect(p.mp).toBe(0);
    expect(p.defending).toBe(true);
  });

  it('休息恢复上限的 1/5；道具不算行动、可连用', () => {
    const potion = { ...glove, type: 15, name: '藥', attack: 0, healHp: 10, healMp: 0 } as unknown as Item;
    const d2: GameData = { ...data, items: [glove, potion] };
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data: d2, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.slots = [2, 2];
    p.hp = 1;
    b.useItem(p, 0);
    b.useItem(p, 1);
    expect(p.hp).toBe(21);
    expect(p.ended).toBe(false);
    expect(b.canAct(p)).toBe(true);
    p.mp = 0;
    b.rest(p);
    expect(p.hp).toBe(21 + Math.floor(p.stats.maxHp / 5));
    expect(p.mp).toBe(Math.floor(p.stats.maxMp / 5));
    expect(p.ended).toBe(true);
  });

  it('回复事件带上气的变化，用来弹黄字（扣气不弹）', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.hp = 1;
    p.mp = 0;
    const ev = b.rest(p).find((e) => e.type === 'hp');
    expect(ev).toMatchObject({ delta: p.hp - 1, mpDelta: p.mp });
    expect(recoveryFloats(ev!.type === 'hp' ? ev!.delta : 0, ev!.type === 'hp' ? ev!.mpDelta ?? 0 : 0).map((f) => f.color)).toEqual([FLOAT_COLOR.hp, FLOAT_COLOR.mp]);
  });

  it('道具：对自己和上下左右相邻的非敌方单位使用；给予只给相邻我方；装备、卸下、丢弃都不算行动', () => {
    const potion = { ...glove, type: 15, name: '藥', attack: 0, healHp: 10, healMp: 0, params: [] } as unknown as Item;
    const wine = { ...glove, type: 22, name: '酒', attack: 5, attackTurns: 3, healHp: 0, healMp: 0, params: [] } as unknown as Item;
    const d2: GameData = { ...data, items: [glove, potion, wine] };
    const b = new Battle({
      name: 't', board: new Board(10, 10), blocks: [], data: d2, seed: 1,
      units: [act(0, 0, 'player', 2, 2), act(1, 1, 'player', 3, 2), act(2, 1, 'ally', 2, 3), act(3, 1, 'player', 3, 3), act(4, 1, 'enemy', 1, 2, 0x800)],
    });
    b.begin();
    const [p, q, ally, diag] = [b.unit(0)!, b.unit(1)!, b.unit(2)!, b.unit(3)!];
    p.slots = [1, 0, 0, 2, 3, 0, 0];
    p.forge = [2, 0, 0, 0, 0, 0, 0];
    refreshStats(p, d2);
    expect(b.itemTargets(p, 3).map((t) => t.uid).sort()).toEqual([0, 1, 2]); // 斜角、敌人不行
    expect(b.itemTargets(p, 0)).toEqual([]); // 武器不能"使用"
    q.hp = 1;
    b.useItem(p, 3, q);
    expect(q.hp).toBe(11);
    expect(p.slots[3]).toBe(0);
    expect(b.useItem(p, 4, diag)).toEqual([]);
    // 增益：攻击 +5，3 回合
    const atk = ally.stats.attack;
    b.useItem(p, 4, ally);
    expect(ally.stats.attack).toBe(atk + 5);
    // 给予：只能给相邻的我方，装备交出去后自己的攻击回落，打铁次数跟着走
    expect(b.giveTargets(p, 0).map((t) => t.uid)).toEqual([1]);
    const pa = p.stats.attack;
    b.giveItem(p, 0, q);
    expect(p.stats.attack).toBe(pa - 7);
    expect(q.slots[3]).toBe(1);
    expect(q.forge[3]).toBe(2);
    b.equipItem(q, 3);
    expect(q.slots[0]).toBe(1);
    expect(q.slots[3]).toBe(0);
    b.equipItem(q, 0);
    expect(q.slots[0]).toBe(0);
    b.discardItem(q, 3);
    expect(q.slots.every((x) => !x)).toBe(true);
    expect([p, q].every((x) => b.canAct(x) && !x.ended)).toBe(true);
    for (let t = 0; t < 3; t++) b.endPlayerPhase();
    expect(ally.buffs).toEqual([]);
    expect(ally.stats.attack).toBe(atk);
  });

  it('跟随型 AI（模式 5）体力不满时移动后休息', () => {
    const b = new Battle({
      name: 't', board: new Board(10, 10), blocks: [], data, seed: 1,
      units: [act(0, 0, 'player', 0, 0), act(1, 1, 'ally', 5, 5, 0x500), act(2, 1, 'enemy', 9, 9, 0x800)],
    });
    b.begin();
    const a = b.unit(1)!;
    a.hp = 10;
    b.endPlayerPhase();
    expect(a.hp).toBe(10 + Math.floor(a.stats.maxHp / 5));
  });

  it('敌方默认 AI 会接近并攻击', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 4, 0)], blocks: [], data, seed: 2 });
    b.begin();
    const ev = b.endPlayerPhase();
    expect(ev.find((e) => e.type === 'move')).toBeTruthy();
    expect(ev.find((e) => e.type === 'attack')).toBeTruthy();
  });

  it('防御中闪避相邻攻击时可能反击，反击必中', () => {
    let counters = 0;
    for (let seed = 1; seed < 200; seed++) {
      const b = new Battle({ name: 't', board: new Board(4, 4), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 1, 0, 0x800)], blocks: [], data, seed });
      b.begin();
      const p = b.unit(0)!;
      p.stats.agility = 255; // 让敌人难以命中
      b.defend(p);
      b.unit(1)!.ai.mode = 0;
      const ev = b.endPlayerPhase();
      const atk = ev.filter((e) => e.type === 'attack');
      if (atk.length === 2) {
        expect(atk[1].type === 'attack' && atk[1].counter && atk[1].hits[0].result.hit).toBe(true);
        counters++;
      }
    }
    expect(counters).toBeGreaterThan(10);
  });
});

describe('经验', () => {
  it('击倒经验按65%/35%分配，整数余数归击倒者；友军只贡献池子部分', () => {
    expect([killerShare(20, true), teamShare(20)]).toEqual([13, 7]);
    expect([killerShare(15, true), teamShare(15)]).toEqual([10, 5]);
    expect(killerShare(20, false)).toBe(0);
    for (let total = 1; total <= 100; total++) {
      expect(killerShare(total, true) + teamShare(total)).toBe(total);
    }
  });

  it.each([false, true])('闪避攻击时获得3–5经验，防御中再+3（防御状态：%s）', (defending) => {
    let dodges = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const b = new Battle({ name: 't', board: new Board(4, 4), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 1, 0)], blocks: [], data, seed });
      b.begin();
      const p = b.unit(0)!;
      p.stats.agility = 255;
      p.defending = defending;
      // 只验证闪避本身的奖励，避免反击贡献额外经验。
      b.unit(1)!.mp = 0;
      const events = b.endPlayerPhase();
      const attacks = events.filter((e) => e.type === 'attack');
      if (attacks.length !== 1 || attacks[0].hits[0]?.result.hit !== false) continue;
      const bonus = defending ? DEFEND_BONUS : 0;
      expect(p.exp).toBeGreaterThanOrEqual(3 + bonus);
      expect(p.exp).toBeLessThanOrEqual(5 + bonus);
      expect(b.expBySource.dodge).toEqual({ n: 1, total: p.exp });
      expect(b.teamExp).toBe(0);
      dodges++;
    }
    expect(dodges).toBeGreaterThan(0);
  });

  it('击倒经验65%给击倒者，35%在胜利后分给全队（先补落后的）', () => {
    const b = new Battle({ name: 't', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0), act(1, 2, 'player', 5, 5), act(2, 1, 'enemy', 1, 0, 0x800)], blocks: [], data, seed: 3 });
    b.begin();
    const [p, q, e] = [b.unit(0)!, b.unit(1)!, b.unit(2)!];
    p.level = 5;
    e.hp = 1;
    p.stats.hit = 255;
    b.attack(p, e);
    expect(e.alive).toBe(false);
    expect(p.exp).toBeGreaterThan(0);
    expect(b.teamExp).toBeGreaterThan(0);
    const total = p.exp + b.teamExp;
    expect(b.teamExp).toBe(Math.floor(total * 35 / 100));
    expect(p.exp).toBe(total - b.teamExp);
    expect(q.exp).toBe(0);
    const pool = b.teamExp;
    b.settleTeamExp(); // 胜利时由剧本触发；这里直接结算
    expect(q.exp).toBe(pool); // 没出手、等级最低的同伴拿走全部全队经验
    expect(b.teamExp).toBe(0);
  });

  it('击倒那一下的伤害经验（溢出最多算最大生命的20%）并入击倒经验，一起按65/35分', () => {
    let kills = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const b = new Battle({ name: 't', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 1, 0, 0x800)], blocks: [], data, seed });
      b.begin();
      const [p, e] = [b.unit(0)!, b.unit(1)!];
      p.stats.hit = 255;
      p.stats.attack = 999;
      e.hp = 45;
      b.attack(p, e);
      if (e.alive) continue;
      const total = p.exp + b.teamExp;
      const lvKill = Math.round(8 + e.level / 2);
      // 击倒经验 lvKill + 0–4；伤害经验按 min(伤害, 45 + 最大生命 × 20%) / 10 + 1–2
      const dmgExp = Math.floor((45 + Math.floor(e.stats.maxHp * 0.2)) / 10);
      expect(total).toBeGreaterThanOrEqual(lvKill + dmgExp + 1);
      expect(total).toBeLessThanOrEqual(lvKill + 4 + dmgExp + 2);
      expect(b.teamExp).toBe(Math.floor(total * 35 / 100));
      expect(b.expBySource.hit).toBeUndefined();
      kills++;
    }
    expect(kills).toBeGreaterThan(0);
  });
});

describe('技能', () => {
  const sk = (o: Partial<SkillDef>): SkillDef => ({ ...punch, hits: [{ frame: 5, percent: 100, dir: 0 }], ...o });
  const line = sk({ name: '石破天驚', type: 0, power: 20, area: 3, mpCost: 20, learnLevel: 1 });
  const cone = sk({ name: '氣蓋山河', type: 1, power: 20, area: 5, mpCost: 30, learnLevel: 1 });
  const diamond = sk({ name: '聚氣LV1', type: 3, power: 10, rangeMin: 0, rangeMax: 0, area: 2, mpCost: 10, learnLevel: 1 });
  const diamond2 = sk({ name: '聚氣LV2', type: 3, power: 20, rangeMin: 0, rangeMax: 0, area: 3, mpCost: 20, learnLevel: 3 });
  const heal = sk({ name: '回復計', type: 11, power: 4, rangeMin: 0, rangeMax: 0, area: 2, mpCost: 10, learnLevel: 1, hits: [] });
  const charge = sk({ name: '集氣技', type: 8, power: 3, rangeMin: 0, rangeMax: 0, area: 0, mpCost: 0, learnLevel: 1, hits: [] });
  const hidden = sk({ name: '祕技', type: 0, hidden: true, learnLevel: 1 });
  const later = sk({ name: '絕招', type: 0, learnLevel: 2 });
  const sdata: GameData = {
    ...data,
    classes: [cls(0, { skills: [punch, line, cone, diamond, diamond2, heal, charge, hidden, later] }), cls(1), cls(2)],
  };
  const board = new Board(12, 12);
  const keys = (cs: { x: number; y: number }[]) => cs.map((c) => `${c.x},${c.y}`).sort();

  it('范围形状：直线、扇形、菱形、迴旋', () => {
    const from = { x: 5, y: 5 };
    expect(keys(areaCells(board, from, line, { x: 6, y: 5 }))).toEqual(['6,5', '7,5', '8,5']);
    // 扇形第 i 行向两侧各 floor(i/2) 格：1 + 1 + 3 + 3 + 5 = 13
    const c = areaCells(board, from, cone, { x: 5, y: 4 });
    expect(c).toHaveLength(13);
    expect(keys(c)).toContain('3,0');
    expect(keys(areaCells(board, from, diamond, from))).toEqual(['4,5', '5,4', '5,5', '5,6', '6,5']);
    expect(areaCells(board, from, charge, from)).toEqual([from]);
    expect(keys(areaCells(board, from, sk({ type: 2 }), { x: 5, y: 4 }))).toEqual(['4,5', '5,4', '5,6', '6,5']);
  });

  it('习得：按等级、不含隐藏技，高级取代低级', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data: sdata, seed: 1 });
    const p = b.unit(0)!;
    expect(learnedSkills(p, sdata).map((s) => s.name)).toEqual(['石破天驚', '氣蓋山河', '聚氣LV1', '回復計', '集氣技']);
    p.level = 3;
    expect(learnedSkills(p, sdata).map((s) => s.name)).toContain('聚氣LV2');
    expect(learnedSkills(p, sdata).map((s) => s.name)).not.toContain('聚氣LV1');
  });

  it('使用攻击技：扣气力，范围内每个敌人各自结算', () => {
    const b = new Battle({
      name: 't', board: new Board(10, 10), data: sdata, seed: 3, blocks: [],
      units: [act(0, 0, 'player', 2, 2), act(1, 1, 'enemy', 3, 2, 0x800), act(2, 1, 'enemy', 4, 2, 0x800), act(3, 1, 'enemy', 2, 5, 0x800)],
    });
    b.begin();
    const p = b.unit(0)!;
    const mp0 = p.mp;
    expect(keys(b.skillTargets(p, line))).toEqual(['2,3', '3,2']); // 向下那条线能打到 (2,5)
    const ev = b.useSkill(p, line, { x: 3, y: 2 });
    const atk = ev.find((e) => e.type === 'attack');
    expect(atk && atk.type === 'attack' && atk.hits.map((h) => h.uid).sort()).toEqual([1, 2]);
    expect(p.mp).toBe(mp0 - 20);
    expect(p.ended).toBe(true);
    expect(b.useSkill(p, line, { x: 3, y: 2 })).toEqual([]);
  });

  it('回复技回复范围内己方体力，集气技回复自己气力', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 2, 2), act(1, 1, 'player', 3, 2)], blocks: [], data: sdata, seed: 1 });
    b.begin();
    const [p, q] = [b.unit(0)!, b.unit(1)!];
    q.hp = 10;
    b.useSkill(p, heal, { x: 2, y: 2 });
    expect(q.hp).toBe(10 + Math.floor(q.stats.maxHp / 4));
    expect(p.exp).toBeGreaterThan(0);
    q.mp = 0;
    b.useSkill(q, sdata.classes[1].skills[0], q); // 不是 q 的技能，无效
    expect(q.mp).toBe(0);
  });

  it('集气技', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 2, 2)], blocks: [], data: sdata, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.mp = 0;
    b.useSkill(p, charge, p);
    expect(p.mp).toBe(Math.floor(p.stats.maxMp / 3));
  });

  it('升级时提示领悟新技能', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0), act(1, 2, 'enemy', 1, 0, 0x800)], blocks: [], data: sdata, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    p.exp = 99;
    p.stats.hit = 255;
    const ev = b.attack(p, b.unit(1)!);
    expect(ev.some((e) => e.type === 'message' && e.text.includes('領悟了絕招'))).toBe(true);
  });

  it('敌人会用气力够用的攻击技', () => {
    const edata: GameData = { ...sdata, classes: [cls(0), cls(1, { skills: [punch, line] }), cls(2)] };
    const b = new Battle({
      name: 't', board: new Board(10, 10), data: edata, seed: 1, blocks: [],
      units: [act(0, 0, 'player', 2, 2), act(1, 0, 'player', 2, 3), act(2, 1, 'enemy', 2, 6)],
    });
    b.begin();
    const ev = b.endPlayerPhase();
    const atk = ev.find((e) => e.type === 'attack');
    expect(atk && atk.type === 'attack' && atk.skill.name).toBe('石破天驚');
  });
});

describe('关卡串联', () => {
  const blk = (index: number, trigger: PasBlock['trigger'], ops: PasBlock['ops'], cond: PasBlock['cond'] = { type: 0, arg: 0 }): PasBlock => ({ index, head: [], trigger, cond, ops });
  const say = (op: number, text: string) => ({ op, flag: null, value: 0, text });

  it('下一关：跳过空位与过场以外的另一条路线，同名相邻战役是二选一', () => {
    const st = [
      { index: 0, mapName: 'n01', title: '第1章 戰役1' },
      { index: 1, mapName: '', title: '' },
      { index: 2, mapName: 'act3-4', title: '第3章' },
      { index: 3, mapName: 'n-add04a', title: '第3章 戰役2' },
      { index: 4, mapName: 'n-add04b', title: '第3章 戰役2' },
      { index: 5, mapName: 'act5-1a', title: '第3章' },
    ];
    expect(nextStages(st, 0).map((s) => s.index)).toEqual([2]);
    expect(nextStages(st, 2).map((s) => s.index)).toEqual([3, 4]);
    expect(nextStages(st, 3).map((s) => s.index)).toEqual([5]);
    expect(nextStages(st, 4).map((s) => s.index)).toEqual([5]);
    expect(nextStages(st, 5)).toEqual([]);
  });

  it('人物延续：等级取较高者、经验与装备沿用，银子累计', () => {
    const one = new Battle({ name: 't', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0)], blocks: [], data, seed: 1 });
    const p = one.unit(0)!;
    p.level = 4;
    p.exp = 37;
    p.slots = [1, 0, 0, 0, 0, 0, 0];
    p.gold = 120;
    const c = recordResult(newCampaign(), one);
    expect(c.gold).toBe(120);
    const join = { ...act(1, 1, 'player', 1, 0), level: 6 };
    const two = new Battle({ name: 't', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0), join], blocks: [], data, seed: 1, party: partyOf(c) });
    expect(two.unit(0)).toMatchObject({ level: 4, exp: 37, slots: [1, ...Array(12).fill(0)] });
    expect(two.unit(0)!.stats.attack).toBe(computeStats(data.classes[0], 4, [1], data).attack);
    expect(two.unit(1)!.level).toBe(6);
  });

  it('新入伙的人按当前队伍平均等级入队，不低于剧本等级；等级不封顶', () => {
    const c = { ...newCampaign(), members: [{ classId: 0, level: 20, exp: 0, slots: [] }, { classId: 2, level: 25, exp: 0, slots: [] }, { classId: 3, level: 6, exp: 0, slots: [] }], active: [0, 2] };
    expect(joinLevel(c)).toBe(23); // 只算上一关出场的人
    expect(joinLevel(newCampaign())).toBe(0);
    const units = [act(0, 0, 'player', 0, 0), act(1, 1, 'player', 1, 0), { ...act(2, 2, 'player', 5, 0), level: 30 }];
    const b = new Battle({ name: 't', board: new Board(6, 6), units, blocks: [], data, seed: 1, party: partyOf(c), joinLevel: joinLevel(c) });
    expect(b.unit(0)!.level).toBe(20); // 老成员照旧
    expect(b.unit(1)!.level).toBe(23); // 新人 = 平均
    expect(b.unit(2)!.level).toBe(30); // 剧本等级更高时用剧本等级
    expect(splitTeamExp([{ level: 40, exp: 0 }], 50)).toEqual([50]);
  });

  it('敌人等级修正：整关平移、只降不升、1 级摆设不动、最低 2 级', () => {
    expect(enemyShift('N14')).toBeLessThan(0);
    expect(enemyShift('n14')).toBe(enemyShift('N14'));
    expect(enemyShift('Train1')).toBe(0);
    const d = enemyShift('N14');
    expect(enemyLevel('N14', 42)).toBe(42 + d);
    expect(enemyLevel('N14', 1)).toBe(1);
    expect(enemyLevel('N14', 3)).toBe(Math.max(2, 3 + d));
    const units = adjustEnemies('N14', [{ ...act(0, 0, 'enemy', 20, 0), level: 30 }, { ...act(1, 1, 'player', 0, 0), level: 30 }]);
    expect(units.map((u) => u.level)).toEqual([30 + d, 30]);
  });

  it('击倒掉落：职业上限的一半 ±15%，上限为 0 的不掉', () => {
    expect(goldBase(data, 0)).toBe(25);
    expect(goldRange(25)).toEqual([21, 29]);
    expect(goldRange(250)).toEqual([212, 288]);
    const rng = new Rng(7);
    const got = Array.from({ length: 2000 }, () => killGold(0, data, rng));
    expect(Math.min(...got)).toBe(21);
    expect(Math.max(...got)).toBe(29);
    expect(Math.abs(got.reduce((a, x) => a + x, 0) / got.length - 25)).toBeLessThan(0.3);
    expect(killGold(2, data, rng)).toBe(0);
  });

  it('过关奖励：战役打赢给固定银子并提示，过场不给', () => {
    expect(stageClearGold('N01')).toBe(100);
    expect(stageClearGold('Act3-1')).toBe(0);
    for (const v of Object.values(STAGE_CLEAR_GOLD)) expect(v % 50).toBe(0);
    const win = new Battle({ name: 'N01', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0)], blocks: [blk(0, { kind: 'turn', turn: 0 }, [say(29, '旁白')])], data });
    const ev = win.begin();
    expect(win.status).toBe('won');
    expect(ev.some((e) => e.type === 'message' && e.text === '過關獎勵：得到銀子 100 兩！')).toBe(true);
    win.unit(0)!.gold = 30;
    expect(recordResult(newCampaign(), win).gold).toBe(130);
    const cut = new Battle({ name: 'N01', board: new Board(6, 6), units: [act(0, 1, 'ally', 0, 0)], blocks: [blk(0, { kind: 'turn', turn: 0 }, [say(29, '旁白')])], data });
    cut.begin();
    expect(cut.clearGold).toBe(0);
  });

  it('敌人等级保底：2 级以上的敌人不低于我方平均 − 5，1 级摆设不动', () => {
    expect(enemyFloor([20, 30])).toBe(20);
    expect(enemyFloor([])).toBe(0);
    const c = { ...newCampaign(), members: [{ classId: 0, level: 30, exp: 0, slots: [] }] };
    const units = [act(0, 0, 'player', 0, 0), { ...act(1, 1, 'enemy', 1, 0), level: 10 }, { ...act(2, 1, 'enemy', 2, 0), level: 28 }, act(3, 1, 'enemy', 3, 0)];
    const b = new Battle({ name: 't', board: new Board(6, 6), units, blocks: [], data, seed: 1, party: partyOf(c) });
    expect(b.unit(1)!.level).toBe(25);
    expect(b.unit(2)!.level).toBe(28);
    expect(b.unit(3)!.level).toBe(1);
  });

  it('指令 29 的区块执行完即过关；没有我方人物的过场不判全军覆没', () => {
    const b = new Battle({ name: 'act', board: new Board(6, 6), units: [act(0, 1, 'ally', 0, 0)], blocks: [blk(0, { kind: 'turn', turn: 0 }, [say(29, '旁白')])], data });
    const ev = b.begin();
    expect(ev.map((e) => e.type)).toEqual(['sound', 'narrate', 'end']);
    expect(b.status).toBe('won');
    const c = new Battle({ name: 'act', board: new Board(6, 6), units: [act(0, 1, 'enemy', 0, 0)], blocks: [], data });
    c.begin();
    c.endPlayerPhase();
    expect(c.status).toBe('playing');
  });

  it('角色号 255 的死亡区块在敌方全灭时执行', () => {
    const b = new Battle({
      name: 't', board: new Board(6, 6), units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 1, 0, 0x800)],
      blocks: [blk(0, { kind: 'death', char: 255 }, [say(29, '敵軍全滅')])], data, seed: 1,
    });
    b.begin();
    const p = b.unit(0)!;
    b.unit(1)!.hp = 1;
    p.stats.hit = 255;
    for (let i = 0; i < 20 && b.status === 'playing'; i++) {
      if (b.attackTargets(p).length) b.attack(p, b.unit(1)!);
      else b.endPlayerPhase();
      if (b.status === 'playing' && b.phase === 'player' && p.ended) b.endPlayerPhase();
    }
    expect(b.status).toBe('won');
  });

  it('模式 6 埋伏：开局不在场，敌人进入警戒半径时现身并行动；模式 7 开局隐藏', () => {
    const b = new Battle({
      name: 't', board: new Board(30, 4),
      units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 6, 0, 0x600), act(2, 1, 'enemy', 29, 0, 0x600), act(3, 1, 'enemy', 29, 3, 0x700)],
      blocks: [], data, seed: 1,
    });
    b.begin();
    expect(b.active().map((u) => u.uid)).toEqual([0]);
    const ev = b.endPlayerPhase();
    expect(ev.find((e) => e.type === 'appear')).toMatchObject({ uid: 1 });
    expect(b.unit(1)!.ai.mode).toBe(0);
    expect(b.unit(2)!.present).toBe(false);
    expect(b.unit(3)!).toMatchObject({ present: false, ai: { mode: 0 } });
  });
});

describe('通行判断（EXE 0x40bc30）', () => {
  const gAtt = new Uint8Array(2048), uAtt = new Uint8Array(2048);
  gAtt[4] = 0xff; // 图块 5 用 att[4]（EXE 错一位）
  uAtt[6] = 0xff; // 图块 7
  const L = (tile: number, flags = 0) => ({ tile, flags });
  it('地表', () => {
    expect(cellPassable([L(1)], gAtt, uAtt)).toBe(true);
    expect(cellPassable([L(0)], gAtt, uAtt)).toBe(false); // 地表 0 号 = 空白
    expect(cellPassable([L(5)], gAtt, uAtt)).toBe(false);
  });
  it('第一层地上物：同高看 Upper.att，高出 0x40 以上可通行，低于地表阻挡', () => {
    expect(cellPassable([L(1), L(7)], gAtt, uAtt)).toBe(false);
    expect(cellPassable([L(1), L(8)], gAtt, uAtt)).toBe(true);
    expect(cellPassable([L(1), L(7, 0x40)], gAtt, uAtt)).toBe(true);
    expect(cellPassable([L(1, 0x40), L(8, 0)], gAtt, uAtt)).toBe(false);
    // 只看第一层地上物
    expect(cellPassable([L(1), L(8), L(7)], gAtt, uAtt)).toBe(true);
  });
});
