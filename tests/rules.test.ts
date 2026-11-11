// 规则引擎单元测试：使用手写的小数据，不依赖原版文件。
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { baseDamage, critChance, facingRelation, hitChance, killExp, rollAttack } from '../src/rules/combat.ts';
import type { ClassDef, GameData, SkillDef } from '../src/rules/data.ts';
import { Rng } from '../src/rules/rng.ts';
import { computeStats, facingTowards, grow, type Unit } from '../src/rules/unit.ts';
import { Battle } from '../src/rules/battle.ts';
import type { ActUnit } from '../src/formats/act.ts';
import type { Item } from '../src/formats/goo.ts';

const g = (base: number, growth = 100) => ({ base, growth });
const punch: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false, effect: 0, power: 0, poison: 0, stun: 0, rangeMin: 1, rangeMax: 1,
  area: 1, learnLevel: 1, mpCost: 0, hitMod: 0, critMod: 0, hits: [{ frame: 1, percent: 100, dir: 0 }], raw: '',
};
const cls = (id: number, o: Partial<ClassDef> = {}): ClassDef => ({
  id, name: `C${id}`, hp: g(100), mp: g(50), attack: g(60), defense: g(20), hit: g(80), agility: g(40), crit: g(10), move: 4,
  weaponType: 0, goldCap: 50, defaultItems: [0, 0, 0, 0, 0, 0, 0], skills: [punch], ...o,
});
const glove = { type: 0, name: '皮手套', attack: 7, defense: 0, hit: 0, agility: 0, crit: 0, moveBonus: 0, range: 0, maxHp: 0, maxMp: 0, regenHp: 0, regenMp: 0, poison: 0, stun: 0 } as unknown as Item;
const data: GameData = { classes: [cls(0), cls(1), cls(2, { goldCap: 0 })], items: [glove], charNames: ['甲', '乙', '丙'], heroName: '甲' };

function unit(o: Partial<Unit>): Unit {
  const stats = computeStats(data.classes[o.classId ?? 0], o.level ?? 0, o.slots ?? [], data);
  return {
    uid: 0, classId: 0, name: 'u', side: 'player', x: 0, y: 0, facing: 0, level: 0, exp: 0, hp: stats.maxHp, mp: stats.maxMp, stats,
    slots: [], gold: 0, ai: { mode: 0, target: 0, point: { x: 0, y: 0 } }, present: true, alive: true, defending: false, poisonTurns: 0,
    stunTurns: 0, movementRemaining: 4, forcedMarch: false, acted: false, ended: false, itemUsed: false, turnStart: null, ...o,
  };
}

describe('属性', () => {
  it('属性 = 基础值 × (成长/100)^等级，截断取整并封顶', () => {
    expect(grow({ base: 65, growth: 105 }, 1)).toBe(68); // 1 级武龍攻击
    expect(grow({ base: 65, growth: 105 }, 10)).toBe(105);
    expect(grow({ base: 65, growth: 105 }, 30)).toBe(255);
    expect(grow({ base: 400, growth: 110 }, 5, 510)).toBe(510);
  });
  it('装备加成按道具编号（从 1 开始）计算', () => {
    expect(computeStats(data.classes[0], 0, [1], data).attack).toBe(67);
    expect(computeStats(data.classes[0], 0, [1], data, true).attack).toBe(33); // 中毒减半
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
  it('命中 = 命中 − 敏捷/2，按朝向放大，我方保底 80、敌方保底 30', () => {
    // 守方面向 +y（朝向 2），攻方从 +y 方向往 −y 打（朝向 0）：正面
    const d = unit({ side: 'enemy', x: 0, y: 0, facing: 2, classId: 1 });
    expect(hitChance(a, d, punch)).toBe(80); // 80 − 20 = 60，保底 80
    const e = unit({ side: 'enemy', x: 0, y: 1, facing: 0 });
    const p = unit({ side: 'player', x: 0, y: 0, facing: 2 });
    expect(hitChance(e, p, punch)).toBe(60);
    p.facing = 0; // 背后
    expect(hitChance(e, p, punch)).toBe(90);
    p.facing = 1; // 侧面
    expect(hitChance(e, p, punch)).toBe(78);
    p.defending = true;
    expect(hitChance(e, p, punch)).toBe(54);
    expect(hitChance(e, unit({ stats: { ...p.stats, agility: 200 }, x: 0, y: 0, facing: 2 }), punch)).toBe(30);
  });
  it('伤害 = 攻 + 威力 − 防；必杀 = 2 × (攻 + 威力) − 防；≤ 0 时为 10–59', () => {
    const d = unit({ side: 'enemy' });
    expect(baseDamage(a, d, punch)).toEqual([40, 100]);
    const tough = unit({ stats: { ...d.stats, defense: 200 } });
    expect(baseDamage(a, tough, punch)).toEqual([null, null]);
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) {
      const r = rollAttack(a, tough, punch, rng, true);
      expect(r.damage).toBeGreaterThanOrEqual(9);
      expect(r.damage).toBeLessThanOrEqual(64);
    }
    expect(critChance(a, { ...punch, critMod: 10 })).toBe(10);
  });
  it('多段攻击按比例分配，合计等于总伤害', () => {
    const multi = { ...punch, hits: [25, 25, 25, 25].map((p, i) => ({ frame: i + 1, percent: p, dir: 0 })) };
    const r = rollAttack(a, unit({ side: 'enemy' }), multi, new Rng(3), true);
    expect(r.parts).toHaveLength(4);
    expect(r.parts.reduce((s, x) => s + x, 0)).toBe(r.damage);
  });
  it('击倒经验', () => {
    const rng = new Rng(5);
    const e = killExp(unit({ level: 1 }), unit({ level: 4 }), rng);
    expect(e).toBeGreaterThanOrEqual(37);
    expect(e).toBeLessThanOrEqual(45);
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

  it('强行军：走进黄色范围后本回合结束', () => {
    const b = new Battle({ name: 't', board: new Board(10, 10), units: [act(0, 0, 'player', 0, 0)], blocks: [], data, seed: 1 });
    b.begin();
    const p = b.unit(0)!;
    b.move(p, 6, 0); // 移动力 4 + 2
    expect(p.ended).toBe(true);
    expect(b.moveRange(p).green).toHaveLength(0);
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
        expect(atk[1].type === 'attack' && atk[1].counter && atk[1].result.hit).toBe(true);
        counters++;
      }
    }
    expect(counters).toBeGreaterThan(10);
  });
});
