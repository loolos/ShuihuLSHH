// 规则引擎单元测试：使用手写的小数据，不依赖原版文件。
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { cellPassable } from '../src/rules/passability.ts';
import { attackParts, baseDamage, critChance, rangedFactor, facingRelation, hitChance, previewAttack, rollAttack } from '../src/rules/combat.ts';
import { DEFEND_BONUS, dodgeExp, expAtLevel, expToNext, killerShare, killExp, restExp, splitTeamExp, takenExp, teamShare } from '../src/rules/exp.ts';
import { buildClasses, equipHitBonus, unlockHiddenSkills, type ClassDef, type GameData, type SkillDef } from '../src/rules/data.ts';
import type { ClassRecord } from '../src/formats/hum.ts';
import { Rng } from '../src/rules/rng.ts';
import { computeStats, facingTowards, refreshStats, type Unit } from '../src/rules/unit.ts';
import { CLASS_OVERRIDES, CLASS_TWEAKS, GRUNT, GRUNT_GEAR, OFFICER, baseStat, perLevel, statAt } from '../src/rules/growth.ts';
import { Battle } from '../src/rules/battle.ts';
import { capSkillCosts } from '../src/rules/load.ts';
import { balanceLevels } from '../src/rules/preset.ts';
import { announcesSkill, areaCells, HERO_CLASSES, learnedSkills, skillBonusText } from '../src/rules/skills.ts';
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
  const rec = (id: number, move = 5) => ({ id, hp: 100, hpGrowth: 100, mp: 50, mpGrowth: 100, stats: Array(5).fill({ base: 10, growth: 100 }), move, weaponType: 0, goldCap: 0, defaultItems: [], skills: [] }) as unknown as ClassRecord;
  it('武龍基础移动力比职业表多 1，其他人照原值', () => {
    const [hero, wangjin] = buildClasses([rec(0), rec(1)], ['武龍', '王進'], []);
    expect(hero.move).toBe(6);
    expect(wangjin.move).toBe(5);
  });
  it('公孫勝、吳用、魯智深基础移动力 4 → 5，敌方版公孫勝、吳用照原值 4', () => {
    const cls = buildClasses([rec(2, 4), rec(10, 4), rec(16, 4), rec(46, 4), rec(53, 4)], [], []);
    expect(cls.map((c) => c.move)).toEqual([5, 5, 5, 4, 4]);
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

describe('魯智深三段', () => {
  it('三世因果、佛法無邊都改成三段 30/30/40，三段全中的总伤害与单段相同', () => {
    const one = [{ frame: 16, percent: 100, dir: 0 }];
    const lu = {
      id: 16, hp: 100, hpGrowth: 100, mp: 50, mpGrowth: 100, stats: Array(5).fill({ base: 10, growth: 100 }), move: 4, weaponType: 0, goldCap: 0, defaultItems: [],
      skills: [{ ...punch, skillId: 133, hits: one }, { ...punch, skillId: 137, hits: [{ frame: 13, percent: 100, dir: 0 }] }, { ...punch, skillId: 140, hits: one }],
    } as unknown as ClassRecord;
    const [c] = buildClasses([lu], ['魯智深'], []);
    expect(c.skills[0].hits.map((h) => [h.frame, h.percent])).toEqual([[5, 30], [10, 30], [16, 40]]);
    expect(c.skills[1].hits.map((h) => [h.frame, h.percent])).toEqual([[13, 30], [16, 30], [19, 40]]);
    expect(c.skills[2].hits).toEqual(one); // 萬佛朝宗 不变
    const att = unit({ side: 'player', x: 0, y: 1, facing: 0 });
    att.stats = { ...att.stats, crit: 0, hit: 100000 };
    const foe = unit({ side: 'enemy', x: 0, y: 0, facing: 2 });
    const [n] = baseDamage(att, foe, c.skills[0]);
    const r = rollAttack(att, foe, c.skills[0], new Rng(3), true);
    expect(r.parts).toHaveLength(3);
    expect(r.parts.reduce((a, b) => a + b, 0)).toBe(r.damage);
    expect(r.damage).toBeGreaterThanOrEqual(Math.floor(n * 0.9) - 2);
    expect(r.damage).toBeLessThanOrEqual(Math.ceil(n * 1.1));
  });
});

describe('好汉普攻调整', () => {
  it('吳用、朱武普攻带昏迷 10，楊春、陳達普攻射程 1–2', () => {
    const rec = (id: number, skillId: number) =>
      ({ id, hp: 100, hpGrowth: 100, mp: 50, mpGrowth: 100, stats: Array(5).fill({ base: 10, growth: 100 }), move: 5, weaponType: 0, goldCap: 0, defaultItems: [], skills: [{ ...punch, skillId }] }) as unknown as ClassRecord;
    const [zhu, wu, chen, yang] = buildClasses([rec(5, 54), rec(10, 86), rec(13, 113), rec(15, 128)], [], []);
    expect([zhu, wu].map((c) => c.skills[0].stun)).toEqual([10, 10]);
    expect([chen, yang].map((c) => [c.skills[0].rangeMin, c.skills[0].rangeMax])).toEqual([[1, 2], [1, 2]]);
    expect([chen, yang].map((c) => c.skills[0].stun)).toEqual([0, 0]);
    const [zhu2] = buildClasses([{ ...rec(5, 54), skills: [{ ...punch, skillId: 54 }, { ...punch, skillId: 56, stun: 5 }] } as unknown as ClassRecord], [], []);
    expect(zhu2.skills[1].stun).toBe(30); // 詭計多端
    const dirs = [1, 2, 3, 0].map((dir, i) => ({ frame: [11, 12, 13, 15][i], percent: 100, dir }));
    const [shi] = buildClasses([{ ...rec(3, 31), skills: [{ ...punch, skillId: 31 }, { ...punch, skillId: 42, hits: dirs }] } as unknown as ClassRecord], [], []);
    expect(attackParts(shi.skills[1]).map((h) => h.percent)).toEqual([25, 25, 25, 25]); // 狂龍出海 4 段
    expect(shi.skills[1].power).toBe(60);
  });
});

describe('隐藏技改为自带技能', () => {
  it('不再要祕笈；LV1 习得等级 = LV2 − 4（不低于 1），LV2、LV3 不变', () => {
    const h = (name: string, learnLevel: number): SkillDef => ({ ...punch, name, learnLevel, hidden: true });
    const out = unlockHiddenSkills([punch, h('靈蛇出洞LV1', 1), h('靈蛇出洞LV2', 10), h('靈蛇出洞LV3', 20), h('早招LV1', 1), h('早招LV2', 3)]);
    expect(out.map((s) => [s.learnLevel, s.hidden])).toEqual([[1, false], [6, false], [10, false], [20, false], [1, false], [3, false]]);
    const yang = { ...cls(0), skills: out } as ClassDef;
    const at = (level: number) => learnedSkills({ classId: 0, level } as Unit, { classes: [yang] } as unknown as GameData).map((s) => s.name);
    expect(at(5)).not.toContain('靈蛇出洞LV1');
    expect(at(6)).toContain('靈蛇出洞LV1');
    expect(at(12)).toContain('靈蛇出洞LV2');
    expect(at(12)).not.toContain('靈蛇出洞LV1');
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
  it('命中 = 有效命中 / (有效命中 + 敏捷/2)，技能修正、朝向、防御都作用在命中属性上，敌我同一公式、没有保底', () => {
    // 守方面向 +y（朝向 2），攻方从 +y 方向往 −y 打（朝向 0）：正面
    const d = unit({ side: 'enemy', x: 0, y: 0, facing: 2, classId: 1 });
    expect(hitChance(a, d, punch)).toBe(80); // 80 / (80 + 20)
    const e = unit({ side: 'enemy', x: 0, y: 1, facing: 0 });
    const p = unit({ side: 'player', x: 0, y: 0, facing: 2 });
    expect(hitChance(e, p, punch)).toBe(80);
    expect(hitChance(e, p, { ...punch, hitMod: -10 })).toBe(77); // 70 / (70 + 20)
    expect(hitChance(e, p, { ...punch, hitMod: -100 })).toBe(0);
    p.facing = 0; // 背后：命中 80 × 2.5 = 200
    expect(hitChance(e, p, punch)).toBe(90); // 200 / 220
    p.facing = 1; // 侧面：80 × 1.6 = 128
    expect(hitChance(e, p, punch)).toBe(86); // 128 / 148
    p.defending = true; // 128 × 0.4 = 51.2
    expect(hitChance(e, p, punch)).toBe(71); // 51.2 / 71.2
    p.facing = 0; p.defending = false; // 技能 +40 → 命中 ×3，再乘背面：80 × 3 × 2.5 = 600
    expect(hitChance(e, p, { ...punch, hitMod: 40 })).toBe(96); // 600 / 620
    p.facing = 2; // 正面，技能 +10 → 命中 ×1.5 = 120
    expect(hitChance(e, p, { ...punch, hitMod: 10 })).toBe(85); // 120 / 140
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
    expect(critChance(a, { ...punch, critMod: 10 })).toBe(7); // x = 20：400 / 5300
  });
  it('必杀率 = x² / (x² + 70²)，越高越接近 100% 但不到', () => {
    const a = unit({ side: 'player', x: 0, y: 0, facing: 0 });
    const at = (crit: number, critMod = 0) => critChance({ ...a, stats: { ...a.stats, crit } } as typeof a, { ...punch, critMod });
    expect(at(0)).toBe(0);
    expect(at(70)).toBe(50);
    expect(at(50, 20)).toBe(50);
    expect(at(100)).toBe(67);
    expect(at(200)).toBe(89);
    expect(at(10, -30)).toBe(0);
    expect(at(10000)).toBe(99);
    let prev = -1;
    for (let c = 0; c <= 500; c += 5) { expect(at(c)).toBeGreaterThanOrEqual(prev); prev = at(c); }
  });
  it('敌方名将必杀 × 0.8，杂兵、小头目不打折', () => {
    const mk = (side: 'player' | 'enemy', classId: number) => ({ ...unit({ side, x: 0, y: 0, facing: 0 }), classId, stats: { ...unit({ side, x: 0, y: 0, facing: 0 }).stats, crit: 70 } });
    expect(critChance(mk('player', 3), punch)).toBe(50);
    expect(critChance(mk('enemy', 68), punch)).toBe(39); // x = 56：3136 / 8036
    expect(critChance(mk('enemy', 19), punch)).toBe(50);
    expect(critChance(mk('enemy', 38), punch)).toBe(50);
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
  it('升级所需经验 90 + 10 × 等级', () => {
    expect([1, 10, 20, 30].map(expToNext)).toEqual([100, 190, 290, 390]);
    expect(expAtLevel(1)).toBe(0);
    expect(expAtLevel(2)).toBe(100);
    for (let l = 1; l < 40; l++) expect(expAtLevel(l + 1) - expAtLevel(l)).toBe(expToNext(l));
  });
  it('全队经验先补给最落后的人', () => {
    const m = [{ level: 10, exp: 0 }, { level: 8, exp: 50 }, { level: 5, exp: 0 }, { level: 30, exp: 0 }];
    expect(splitTeamExp(m, 100)).toEqual([0, 0, 100, 0]);
    // 累计经验：5 级 460，8 级 50 = 960；先给 5 级 500 补平，剩 100 两人平分
    expect(splitTeamExp(m, 600)).toEqual([0, 50, 550, 0]);
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

  it('开局站在没有地面的格子上的单位当作场外占位：不登场、不占格、不算我方全灭；点名时挪到最近的可通行格', () => {
    const voidCells = new Uint8Array(100);
    voidCells[0] = 1; // (0,0) 没有地面
    const board = new Board(10, 10, undefined, voidCells);
    expect(board.onGround(0, 0)).toBe(false);
    expect(board.onGround(-1, 3)).toBe(false);
    expect(board.onGround(1, 0)).toBe(true);
    const b = new Battle({ name: 't', board, units: [act(0, 0, 'player', 0, 0), act(1, 1, 'enemy', 5, 5, 0x800)], blocks: [], data, seed: 1 });
    b.begin();
    const ghost = b.unit(0)!;
    expect(ghost.present).toBe(false);
    expect(b.active().map((u) => u.uid)).toEqual([1]);
    expect(b.status).toBe('playing');
    (b as unknown as { appear(u: unknown): void }).appear(ghost);
    expect(ghost.present).toBe(true);
    expect(board.onGround(ghost.x, ghost.y)).toBe(true);
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
  it('好汉的普通攻击也弹技能名，杂兵普攻不弹，技能都弹', () => {
    const skill = { ...punch, name: '技能', mpCost: 10 };
    const d: GameData = { ...data, classes: [...data.classes] };
    d.classes[HERO_CLASSES] = cls(HERO_CLASSES);
    const hero = unit({ classId: 1 });
    const grunt = { ...unit({ classId: 1 }), classId: HERO_CLASSES };
    expect(announcesSkill(hero, punch, d)).toBe(true);
    expect(announcesSkill(grunt, punch, d)).toBe(false);
    expect(announcesSkill(grunt, skill, d)).toBe(true);
  });

  const sk = (o: Partial<SkillDef>): SkillDef => ({ ...punch, hits: [{ frame: 5, percent: 100, dir: 0 }], ...o });
  const line = sk({ name: '石破天驚', type: 0, power: 20, area: 3, mpCost: 20, learnLevel: 1 });
  const cone = sk({ name: '氣蓋山河', type: 1, power: 20, area: 5, mpCost: 30, learnLevel: 1 });
  const diamond = sk({ name: '聚氣LV1', type: 3, power: 10, rangeMin: 0, rangeMax: 0, area: 2, mpCost: 10, learnLevel: 1 });
  const diamond2 = sk({ name: '聚氣LV2', type: 3, power: 20, rangeMin: 0, rangeMax: 0, area: 3, mpCost: 20, learnLevel: 3 });
  const heal = sk({ name: '回復計', type: 11, power: 4, rangeMin: 0, rangeMax: 0, area: 2, mpCost: 10, learnLevel: 1, hits: [] });
  const charge = sk({ name: '集氣技', type: 8, power: 2, rangeMin: 0, rangeMax: 0, area: 0, mpCost: 0, learnLevel: 1, hits: [] });
  const hidden = sk({ name: '祕技', type: 0, hidden: true, learnLevel: 1 });
  const later = sk({ name: '絕招', type: 0, learnLevel: 2 });
  const sdata: GameData = {
    ...data,
    classes: [cls(0, { skills: [punch, line, cone, diamond, diamond2, heal, charge, hidden, later] }), cls(1), cls(2)],
  };
  const board = new Board(12, 12);
  const keys = (cs: { x: number; y: number }[]) => cs.map((c) => `${c.x},${c.y}`).sort();

  it('回合终了的默认行动：缺血休息；只缺气用集气技，没有就休息；都满防御；不自动用道具', () => {
    const mpPot = { ...glove, type: 15, name: '氣', attack: 0, healHp: 0, healMp: 50 } as unknown as Item;
    const d2: GameData = { ...sdata, items: [glove, mpPot], classes: [sdata.classes[0], cls(1, { skills: [punch] }), cls(2)] };
    const units = [act(0, 0, 'player', 0, 0), act(1, 0, 'player', 0, 2), act(2, 1, 'player', 0, 4), act(3, 0, 'player', 0, 6), act(4, 2, 'enemy', 9, 9)];
    const b = new Battle({ name: 't', board: new Board(10, 10), units, blocks: [], data: d2, seed: 1 });
    b.begin();
    const [hurt, tired, noSkill, fine] = [0, 1, 2, 3].map((k) => b.unit(k)!);
    for (const u of [hurt, tired, noSkill, fine]) (u.hp = u.stats.maxHp), (u.mp = u.stats.maxMp);
    hurt.hp -= 1;
    hurt.mp = 0;
    tired.mp = 0;
    tired.slots = [0, 0, 0, 2];
    noSkill.mp -= 1;
    noSkill.slots = [0, 0, 0, 2];
    expect(b.autoActUnits()).toEqual([hurt, tired, noSkill, fine]);

    // 缺血：休息，不用集气技
    const ev0 = b.autoAct(hurt);
    expect(ev0.some((e) => e.type === 'hp' && e.text === '休息')).toBe(true);
    expect(hurt.hp).toBe(hurt.stats.maxHp);

    // 只缺气：用集气技（回 1/2），道具里的回气剂不动
    expect(b.mpSkill(tired)?.name).toBe('集氣技');
    const ev1 = b.autoAct(tired);
    expect(ev1.some((e) => e.type === 'message' && e.text.includes('自動使用集氣技'))).toBe(true);
    expect(ev1.some((e) => e.type === 'attack')).toBe(true);
    expect(tired.mp).toBe(Math.floor(tired.stats.maxMp / 2));
    expect(tired.slots[3]).toBe(2);
    expect(tired.defending).toBe(false);

    // 只缺气、没有集气技（身上有回气剂也不用）：休息
    b.autoAct(noSkill);
    expect(noSkill.mp).toBe(noSkill.stats.maxMp);
    expect(noSkill.slots[3]).toBe(2);
    expect(noSkill.defending).toBe(false);

    b.autoAct(fine);
    expect(fine.defending).toBe(true);
    for (const u of [hurt, tired, noSkill, fine]) expect(u.ended).toBe(true);
    expect(b.autoActUnits()).toEqual([]);
    expect(b.playerPhaseDone()).toBe(true);
  });

  it('回合终了的回气技能：挑用完气最多的，一样多挑耗气少的；付不起或没有净增就不用', () => {
    const cheap = sk({ name: '小集氣', type: 8, power: 4, rangeMin: 0, rangeMax: 0, area: 0, mpCost: 0, learnLevel: 1, hits: [] });
    const big = sk({ name: '大集氣', type: 8, power: 2, rangeMin: 0, rangeMax: 0, area: 0, mpCost: 10, learnLevel: 1, hits: [] });
    const d2: GameData = { ...sdata, classes: [cls(0, { skills: [punch, cheap, big] }), cls(1), cls(2)] };
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data: d2, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    const max = p.stats.maxMp;
    p.hp = p.stats.maxHp;
    // 缺得多：大集氣净回 max/2 − 10，比小集氣的 max/4 多
    p.mp = 10;
    expect(Math.floor(max / 2) - 10).toBeGreaterThan(Math.floor(max / 4));
    expect(b.mpSkill(p)?.name).toBe('大集氣');
    // 只缺 1：两个都能补满，挑不耗气的
    p.mp = max - 1;
    expect(b.mpSkill(p)?.name).toBe('小集氣');
    // 气不够付大集氣：只能用小集氣
    p.mp = 5;
    expect(b.mpSkill(p)?.name).toBe('小集氣');
    // 已经出过手：不用技能也不休息，防御
    p.mp = 0;
    p.acted = true;
    expect(b.mpSkill(p)).toBeUndefined();
    b.autoAct(p);
    expect(p.mp).toBe(0);
    expect(p.defending).toBe(true);
  });

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

  it('范围里没有敌人也能选技能查看范围，但不能施放；气不够仍不能选', () => {
    const b = new Battle({
      name: 't', board: new Board(10, 10), data: sdata, seed: 3, blocks: [],
      units: [act(0, 0, 'player', 2, 2), act(1, 1, 'enemy', 9, 9, 0x800)],
    });
    b.begin();
    const p = b.unit(0)!;
    const row = () => b.skillsOf(p).find((k) => k.skill === line)!;
    expect(row()).toMatchObject({ usable: true, hasTarget: false });
    expect(b.skillCells(p, line).length).toBeGreaterThan(0);
    expect(b.skillTargets(p, line)).toEqual([]);
    const mp0 = p.mp;
    expect(b.useSkill(p, line, { x: 3, y: 2 })).toEqual([]); // 空放无效：不耗气、不算行动
    expect(p.mp).toBe(mp0);
    expect(p.ended).toBe(false);
    p.mp = line.mpCost - 1;
    expect(row()).toMatchObject({ usable: false, hasTarget: false });
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
    expect(p.mp).toBe(Math.floor(p.stats.maxMp / 2));
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

describe('技能耗气上限', () => {
  it('耗气不超过习得那一级的最大气，够用的不动', () => {
    const big: SkillDef = { ...punch, name: '大招', skillId: 1, learnLevel: 15, mpCost: 999 };
    const small: SkillDef = { ...punch, name: '小招', skillId: 2, learnLevel: 2, mpCost: 10 };
    const c = cls(0, { skills: [punch, big, small] });
    capSkillCosts([c]);
    expect(c.skills[1].mpCost).toBe(statAt(c, 'mp', 15));
    expect(c.skills[2].mpCost).toBe(10);
  });
});

describe('跳关等级校验', () => {
  const mk = (classId: number, level: number) => ({ classId, level, exp: 0, slots: [], forge: [] });
  it('我方比敌人平均高出 2 级以上时全员一起降，低太多时一起升', () => {
    const hi = [mk(0, 30), mk(1, 26)];
    balanceLevels(hi, new Map([[0, 1], [1, 1]]), 24);
    expect(hi.map((m) => m.level)).toEqual([28, 24]);
    const lo = [mk(0, 10), mk(1, 12)];
    balanceLevels(lo, new Map(), 16);
    expect(lo.map((m) => m.level)).toEqual([13, 15]);
  });
  it('不低于剧本等级', () => {
    const ms = [mk(0, 30), mk(1, 20)];
    balanceLevels(ms, new Map([[0, 30], [1, 1]]), 20);
    expect(ms.map((m) => m.level)).toEqual([30, 14]);
  });
});

describe('技能菜单的简略加成', () => {
  const sk = (o: Partial<SkillDef>): SkillDef => ({
    name: 'x', skillId: 1, type: 5, group: 0, hidden: false, effect: 0, effect2: 0, effect3: 0, power: 0, poison: 0, stun: 0,
    rangeMin: 1, rangeMax: 1, area: 0, learnLevel: 1, mpCost: 0, hitMod: 0, critMod: 0, hits: [], raw: '', ...o,
  });
  it('只列非 0 的项，命中显示原值', () => {
    expect(skillBonusText(sk({ power: 60, hitMod: 40, critMod: 50 }))).toBe('威+60 命+40 必+50');
    expect(skillBonusText(sk({ critMod: 10, hitMod: 20 }))).toBe('命+20 必+10');
    expect(skillBonusText(sk({}))).toBe('');
  });
  it('减益显示负数，中毒 / 昏迷显示几率', () => {
    expect(skillBonusText(sk({ power: 20, hitMod: -10, poison: 20, stun: 10 }))).toBe('威+20 命-10 毒20% 昏10%');
  });
  it('回复技 / 集气技显示回复比例', () => {
    expect(skillBonusText(sk({ type: 9, power: 4 }))).toBe('回体1/4');
    expect(skillBonusText(sk({ type: 8, power: 3 }))).toBe('回气1/3');
  });
});

describe('装备命中', () => {
  const item = (id: number, hit: number) => ({ id, hit }) as Parameters<typeof equipHitBonus>[0];
  it('扣命中减为 1/4，原扣除不到 4 点当 0', () => {
    expect([-2, -3, -4, -5, -7, -8, -12, -14, -18].map((h) => equipHitBonus(item(1, h)))).toEqual([0, 0, -1, -1, -1, -2, -3, -3, -4]);
  });
  it('加命中照原版', () => expect(equipHitBonus(item(1, 10))).toBe(10));
  it('两顶斗笠加命中', () => {
    expect(equipHitBonus(item(125, 0))).toBe(8);
    expect(equipHitBonus(item(126, 0))).toBe(12);
  });
});

describe('道具表改动', () => {
  it('青箬笠改名碧雲箬笠上架', async () => {
    const { withItemOverrides } = await import('../src/rules/data.ts');
    const base = { id: 127, name: '青箬笠', category: 0, hit: 0, buyPrice: 0, sellPrice: 2250, seqA: [] } as unknown as Parameters<typeof withItemOverrides>[0][number];
    const [it] = withItemOverrides([base]);
    expect(it).toMatchObject({ name: '碧雲箬笠', category: 2, hit: 16, buyPrice: 4500 });
    expect(it.seqA).toContain(7);
  });
});
