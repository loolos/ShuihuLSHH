// AI 主动用回复技、增益技（docs/game-design.md §8）
import { describe, expect, it } from 'vitest';
import type { ActUnit } from '../src/formats/act.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import type { ClassDef, GameData, SkillDef } from '../src/rules/data.ts';
import { marchPlan, healPlan, planAi, withCharge } from '../src/rules/ai.ts';

const basic: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false,
  power: 0, mpCost: 0, learnLevel: 1, rangeMin: 1, rangeMax: 1, area: 1,
  hitMod: 0, critMod: 0, stun: 0, poison: 0, effect: 0, effect2: 0, effect3: 0,
  hits: [{ frame: 10, percent: 100, dir: 0 }], raw: '',
};
const heal: SkillDef = { ...basic, skillId: 301, name: '如魚得水LV1', type: 11, power: 3, mpCost: 10, rangeMin: 0, rangeMax: 2, area: 1, hits: [], cure: true };
const stance: SkillDef = { ...basic, skillId: 302, name: '呼保義', type: 8, power: 0, mpCost: 20, rangeMin: 0, rangeMax: 1, area: 0, hits: [], buffAlly: true, selfBuffs: [{ stat: 'defense', value: 30, turns: 5 }] };
const cls = (id: number, skills: SkillDef[] = [basic]): ClassDef => ({
  id, name: `角色${id}`, hp: { base: 300, growth: 100 }, mp: { base: 120, growth: 100 },
  attack: { base: 50, growth: 100 }, defense: { base: 20, growth: 100 }, hit: { base: 90, growth: 100 },
  agility: { base: 10, growth: 100 }, crit: { base: 10, growth: 100 }, move: 4,
  weaponType: 0, goldCap: 0, defaultItems: [], skills,
});
const act = (index: number, type: number, side: ActUnit['side'], x: number, y: number): ActUnit => ({
  index, type, side, x, y, level: 30, facing: 0, group: index, flags: 0,
  items: [0, 0, 0, 0, 0, 0, 0], extra: [0, 0, 0], raw: [],
});
const recharge: SkillDef = { ...basic, skillId: 303, name: '集氣技', type: 8, power: 2, rangeMin: 0, rangeMax: 0, area: 0, hits: [] };
const data: GameData = { classes: [cls(0, [basic, heal, stance]), cls(1), cls(2, [basic, recharge])], items: [], charNames: ['甲', '乙', '丙'], heroName: '甲' };
const battle = (units: ActUnit[]) => {
  const b = new Battle({ name: 'test-support', board: new Board(30, 30), data, units, blocks: [], seed: 5 });
  b.begin();
  return b;
};

describe('AI 回复与增益', () => {
  it('走过去给体力不到一半的队友回血；人人体力过半就不放', () => {
    const b = battle([act(0, 0, 'enemy', 5, 5), act(1, 1, 'enemy', 11, 5), act(2, 1, 'player', 28, 28)]);
    const me = b.unit(0)!, hurt = b.unit(1)!;
    expect(healPlan(b, me)).toBeNull();
    hurt.hp = Math.floor(hurt.stats.maxHp / 4);
    const plan = healPlan(b, me)!;
    expect(plan.skill?.name).toBe('如魚得水LV1');
    expect(b.affected(me, heal, plan.cell!, plan.path!.at(-1)!)).toContain(hurt);
    // 敌方 AI 默认模式照样会用
    expect(planAi(b, me).skill?.name).toBe('如魚得水LV1');
  });

  it('能解状态的回复技：队友中毒也去救；被剧情绑住的人不碰', () => {
    const b = battle([act(0, 0, 'player', 5, 5), act(1, 1, 'player', 6, 5), act(2, 1, 'enemy', 28, 28)]);
    const me = b.unit(0)!, ally = b.unit(1)!;
    ally.poisonTurns = 3;
    expect(healPlan(b, me)?.skill?.name).toBe('如魚得水LV1');
    ally.poisonTurns = 0;
    ally.stunTurns = 100000; // 绑住
    expect(healPlan(b, me)).toBeNull();
  });

  it('可给队友的架势技：给挨得着敌人的相邻队友加，已有就不重复', () => {
    const b = battle([act(0, 0, 'player', 5, 5), act(1, 1, 'player', 5, 6), act(2, 1, 'enemy', 5, 12)]);
    const me = b.unit(0)!, ally = b.unit(1)!;
    let plan = withCharge(b, me, {});
    expect(plan.skill?.name).toBe('呼保義');
    // 两人都挨得着，队友离敌人近：先给队友
    expect(plan.cell).toEqual({ x: 5, y: 6 });
    b.useSkill(me, stance, plan.cell!);
    expect(ally.buffs.some((x) => x.source === '呼保義')).toBe(true);
    me.acted = false; me.ended = false; // 下一回合
    plan = withCharge(b, me, {});
    expect(plan.cell).toEqual({ x: 5, y: 5 });
    b.useSkill(me, stance, plan.cell!);
    expect(withCharge(b, me, {}).skill).toBeUndefined();
  });

  it('打不到人（敌我一样）：满血强行军，不满血走完按缺得多的休息或回气；打得到照样先打', () => {
    const b = battle([act(0, 2, 'enemy', 5, 5), act(1, 1, 'player', 5, 25)]);
    const foe = b.unit(0)!, hero = b.unit(1)!;
    let plan = planAi(b, foe);
    expect(plan.path!.length - 1).toBe(foe.stats.move + Math.ceil(foe.stats.move / 2));
    expect(plan.skill).toBeUndefined();
    foe.hp = foe.stats.maxHp - 50;
    plan = planAi(b, foe);
    expect(plan.path!.length - 1).toBe(foe.stats.move);
    expect(plan.rest).toBe(true);
    foe.mp = 0;
    plan = planAi(b, foe);
    expect(plan.skill?.name).toBe('集氣技');
    expect(plan.rest).toBeUndefined();
    // 我方也一样：满血强行军
    expect(marchPlan(b, hero, [foe])!.path!.length - 1).toBe(hero.stats.move + Math.ceil(hero.stats.move / 2));
    // 走绿格打得到人：先打
    foe.hp = foe.stats.maxHp;
    hero.y = 8;
    expect(planAi(b, foe).target).toBe(hero);
  });
});
