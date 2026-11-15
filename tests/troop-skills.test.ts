// 敌兵远射技与「遠程攻擊」15 级射程 +1（game-design §6.6）
import { describe, expect, it } from 'vitest';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import { alertRadius, planAi } from '../src/rules/ai.ts';
import { rangedFactor } from '../src/rules/combat.ts';
import { buildClasses, TROOP_REACH_CLASSES, TROOP_SKILLS, type GameData } from '../src/rules/data.ts';
import { GRUNT_CLASSES, OFFICER_CLASSES } from '../src/rules/growth.ts';
import { castRange, learnedSkills } from '../src/rules/skills.ts';
import type { ClassRecord } from '../src/formats/hum.ts';
import type { ActUnit } from '../src/formats/act.ts';

const skill = (skillId: number, type: number, rangeMax: number, area = 1) => ({
  skillId, type, group: skillId === 221 ? 0 : 1, hidden: false, effect: 0, effect2: 0, effect3: 0, power: skillId === 221 ? 0 : 20, poison: 0, stun: 0,
  rangeMin: 1, rangeMax, area, learnLevel: 1, mpCost: skillId === 221 ? 0 : 20, hitMod: 0, critMod: 0, hits: [{ frame: 7, percent: 100, dir: 0 }], raw: '',
});
// 职业 0–68 都造一份：有「遠程攻擊」的兵带射程 2 的技能 222，其余只有普攻
const records = Array.from({ length: 69 }, (_, id) => ({
  id, hp: 100, mp: 100, hpGrowth: 100, mpGrowth: 100, move: 5, weaponType: 0, goldCap: 0,
  stats: Array(5).fill({ base: 50, growth: 100 }), defaultItems: [],
  skills: [skill(221, 5, 1), ...(TROOP_REACH_CLASSES.has(id) ? [skill(222, 6, id === 33 ? 1 : 2, id === 33 ? 2 : 1)] : [])],
})) as unknown as ClassRecord[];
const classes = buildClasses(records, [], ['#'].concat(Array(300).fill('技')));
const data: GameData = { classes, items: [], charNames: [], heroName: '好汉' } as unknown as GameData;
const unitAt = (classId: number, level: number) => ({ classId, level, stats: { rangeBonus: 0 } }) as never;

describe('敌兵远射技', () => {
  it('每个杂兵、小头目职业正好一招，杂兵 15 级、小头目 13 级学会，必杀修正 −10', () => {
    for (const id of [...GRUNT_CLASSES, ...OFFICER_CLASSES]) {
      const v = classes[id].skills.filter((s) => s.volley);
      expect(v.length, `职业 ${id}`).toBe(1);
      expect(v[0].learnLevel).toBe(GRUNT_CLASSES.has(id) ? 15 : 13);
      expect(v[0].critMod).toBe(-10);
      expect(v[0].rangeMin).toBeGreaterThanOrEqual(2);
      expect(learnedSkills(unitAt(id, v[0].learnLevel - 1), data).some((s) => s.volley)).toBe(false);
      expect(learnedSkills(unitAt(id, v[0].learnLevel), data).some((s) => s.volley)).toBe(true);
    }
    // 好汉、名将没有
    for (const id of [0, 11, 46, 68]) expect(classes[id].skills.some((s) => s.volley)).toBe(false);
    expect(new Set(TROOP_SKILLS.flatMap((t) => t.classes)).size).toBe(GRUNT_CLASSES.size + OFFICER_CLASSES.size);
  });

  it('伤害取固定系数，不按距离打折', () => {
    const v = classes[34].skills.find((s) => s.volley)!;
    const att = { x: 0, y: 0, stats: { rangeBonus: 0 } } as never;
    for (const x of [3, 5, 7]) expect(rangedFactor(att, { x, y: 0 } as never, v)).toBe(0.35);
  });

  it('「遠程攻擊」15 级起射程 +1', () => {
    for (const id of TROOP_REACH_CLASSES) {
      const lo = learnedSkills(unitAt(id, 14), data).find((s) => s.skillId === 222)!;
      const hi = learnedSkills(unitAt(id, 15), data).find((s) => s.skillId === 222)!;
      expect(castRange(unitAt(id, 15), hi, data)[1], `职业 ${id}`).toBe(castRange(unitAt(id, 14), lo, data)[1] + 1);
      expect(learnedSkills(unitAt(id, 15), data).filter((s) => s.skillId === 222)).toHaveLength(1);
    }
  });
});

describe('敌兵远射技 AI', () => {
  const act = (index: number, type: number, side: ActUnit['side'], x: number, y: number, level = 1): ActUnit =>
    ({ index, type, group: index, side, x, y, level, flags: 0, facing: 0, extra: [0, 0, 0], items: [0, 0, 0, 0, 0, 0, 0], raw: [] });
  const setup = (players: [number, number][]) => {
    const b = new Battle({ name: 't', board: new Board(20, 20), units: [...players.map(([x, y], i) => act(i, 0, 'player', x, y)), act(9, 19, 'enemy', 10, 10, 20)], blocks: [], data, seed: 1 });
    b.begin();
    const e = b.units.find((u) => u.side === 'enemy')!;
    return { b, e };
  };
  it('走不到人时，打得到两人就放远射技', () => {
    const { b, e } = setup([[10, 13], [11, 13]]);
    e.stats.move = 0;
    expect(planAi(b, e).skill?.volley).toBe(true);
  });
  it('能近身打时，单个目标不放远射技', () => {
    const { b, e } = setup([[10, 12]]);
    expect(planAi(b, e).skill?.volley).toBeFalsy();
  });
  it('远射技不计入警戒半径', () => {
    const { b, e } = setup([[0, 0]]);
    expect(alertRadius(b, e)).toBe(e.stats.move + 2) // 普攻射程 1 + 范围 1;
  });
});

describe('远射技调整（负责人 2026-11-15）', () => {
  it('亂石飛投、火箭齊發为一线 3 格，連環飛鏢射程 2–4', () => {
    for (const id of [19, 34]) expect(classes[id].skills.find((s) => s.volley)).toMatchObject({ type: 0, area: 3 });
    expect(classes[67].skills.find((s) => s.volley)).toMatchObject({ rangeMin: 2, rangeMax: 4 });
  });
});

describe('远射技耗气（负责人 2026-11-15）', () => {
  it('耗气等于学会那一级的最大气', async () => {
    const { statAt, tierGear } = await import('../src/rules/growth.ts');
    for (const id of [...GRUNT_CLASSES, ...OFFICER_CLASSES]) {
      const v = classes[id].skills.find((s) => s.volley)!;
      expect(v.mpCost, `职业 ${id}`).toBe(statAt(classes[id], 'mp', v.learnLevel) + (tierGear(classes[id])?.mp ?? 0));
      expect(v.mpCost).toBeGreaterThan(60);
    }
  });
});
