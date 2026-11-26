// 技能附带的自身增益与架势技（docs/game-design.md §6.5.3）
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/packs/build.ts';
import type { PackJson } from '../src/packs/types.ts';
import type { ActUnit } from '../src/formats/act.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import { HERO_SELF_BUFFS, type ClassDef, type GameData, type SkillDef } from '../src/rules/data.ts';
import { isRechargeSkill, isStanceSkill, learnedSkills, skillBonusText, skillTags } from '../src/rules/skills.ts';
import { withCharge } from '../src/rules/ai.ts';

const basic: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false,
  power: 0, mpCost: 0, learnLevel: 1, rangeMin: 1, rangeMax: 1, area: 1,
  hitMod: 0, critMod: 0, stun: 0, poison: 0, effect: 0, effect2: 0, effect3: 0,
  hits: [{ frame: 10, percent: 100, dir: 0 }], raw: '',
};
const charge: SkillDef = { ...basic, skillId: 227, name: '集氣技', type: 8, group: 2, power: 2, rangeMin: 0, rangeMax: 0, area: 0, hits: [] };
const cls = (id: number, skills: SkillDef[] = [basic]): ClassDef => ({
  id, name: `角色${id}`, hp: { base: 300, growth: 100 }, mp: { base: 120, growth: 100 },
  attack: { base: 50, growth: 100 }, defense: { base: 20, growth: 100 }, hit: { base: 90, growth: 100 },
  agility: { base: 10, growth: 100 }, crit: { base: 10, growth: 100 }, move: 5,
  weaponType: 0, goldCap: 0, defaultItems: [], skills,
});
const act = (index: number, type: number, side: ActUnit['side'], x: number, y: number, level = 30): ActUnit => ({
  index, type, side, x, y, level, facing: 0, group: index, flags: 0,
  items: [0, 0, 0, 0, 0, 0, 0], extra: [0, 0, 0], raw: [],
});

const pack: PackJson = JSON.parse(fs.readFileSync('packs/mainline/pack.json', 'utf8'));
/** 戴宗（借职业 38 的动作）：神行法 = 架势技 */
function daizong() {
  const classes = Array<ClassDef>(72);
  classes[0] = cls(0);
  classes[1] = cls(1);
  classes[38] = cls(38, [basic, { ...basic, skillId: 225, name: '迴旋技', type: 2, group: 1, mpCost: 30, power: 15 }, charge]);
  const data: GameData = { classes, items: [], charNames: classes.map((c) => c?.name ?? ''), heroName: '队友' };
  const conf = pack.classes.find((c) => c.id === 'daizong')!;
  const sp = conf.sprite;
  const sheet = 'sheet' in sp ? sp.sheet : null;
  const sheets = sheet ? { [sheet]: JSON.parse(fs.readFileSync(`packs/mainline/${sheet}/sprites.json`, 'utf8')) } : {};
  const rt = buildPack(data, { ...pack, classes: [conf], items: [], stages: [] }, [], sheets);
  const id = rt.classIds.get('daizong')!;
  return { rt, id };
}

describe('技能自身增益', () => {
  it('架势技：扣气、不回气，加移动和敏捷，5 回合后消失；不当回气技用', () => {
    const { rt, id } = daizong();
    const b = new Battle({ name: 'test-stance', board: new Board(20, 20), data: rt.data, units: [act(0, id, 'player', 5, 5), act(1, 1, 'enemy', 19, 19)], blocks: [], seed: 1 });
    b.begin();
    const dai = b.unit(0)!;
    const stance = learnedSkills(dai, rt.data).find((s) => s.name === '神行法')!;
    expect(isStanceSkill(stance)).toBe(true);
    expect(isRechargeSkill(stance)).toBe(false);
    expect(skillTags(stance)).toEqual(['增益']);
    expect(skillBonusText(stance)).toBe('移动+2·5回合 敏捷+40·5回合');
    const move0 = dai.stats.move, agi0 = dai.stats.agility;
    dai.mp = 50;
    const events = b.useSkill(dai, stance, { x: dai.x, y: dai.y });
    expect(dai.mp).toBe(5);
    expect(dai.stats.move).toBe(move0 + 2);
    expect(dai.stats.agility).toBe(agi0 + 40);
    expect(events.some((e) => e.type === 'status' && e.uid === dai.uid)).toBe(true);
    // 再放一次只刷新、不叠加
    dai.acted = dai.ended = false;
    b.useSkill(dai, stance, { x: dai.x, y: dai.y });
    expect(dai.stats.agility).toBe(agi0 + 40);
    dai.mp = 50;
    for (let i = 0; i < 4; i++) b.endPlayerPhase();
    expect(dai.stats.agility).toBe(agi0 + 40);
    b.endPlayerPhase();
    expect(dai.stats.agility).toBe(agi0);
    expect(dai.buffs).toEqual([]);
    // 回合终了自动回气不选架势技
    expect(b.mpSkill(dai)?.name).toBe('甲马聚气');
  });

  it('呼保义 / 神行法可以给相邻一格的队友用，增益加在队友身上', () => {
    const { rt, id } = daizong();
    const b = new Battle({ name: 'test-ally', board: new Board(20, 20), data: rt.data, units: [act(0, id, 'player', 5, 5), act(1, 0, 'player', 6, 5), act(2, 0, 'player', 8, 5), act(3, 1, 'enemy', 19, 19)], blocks: [], seed: 1 });
    b.begin();
    const dai = b.unit(0)!, near = b.unit(1)!;
    const stance = learnedSkills(dai, rt.data).find((s) => s.name === '神行法')!;
    expect(stance.buffAlly).toBe(true);
    const cells = b.skillTargets(dai, stance).map((c) => `${c.x},${c.y}`).sort();
    expect(cells).toEqual(['5,5', '6,5']); // 自己和相邻的队友；隔一格的不行
    const agi0 = near.stats.agility, mine = dai.stats.agility;
    b.useSkill(dai, stance, { x: 6, y: 5 });
    expect(near.stats.agility).toBe(agi0 + 40);
    expect(dai.stats.agility).toBe(mine);
  });

  it('可给队友的集气技（天王聚义式）：气回给自己，增益给所选的队友；回合终了仍会自动用它回气', () => {
    const rally: SkillDef = { ...charge, skillId: 302, name: '天王聚義式', learnLevel: 1, rangeMin: 0, rangeMax: 1, buffAlly: true, selfBuffs: [{ stat: 'defense', value: 30, turns: 5 }] };
    const classes = [cls(0, [basic, rally]), cls(1)];
    const data: GameData = { classes, items: [], charNames: ['甲', '乙'], heroName: '甲' };
    const b = new Battle({ name: 'test-rally', board: new Board(10, 10), data, units: [act(0, 0, 'player', 5, 5), act(1, 0, 'player', 5, 6), act(2, 1, 'enemy', 0, 0)], blocks: [], seed: 3 });
    b.begin();
    const me = b.unit(0)!, ally = b.unit(1)!;
    expect(b.mpSkill(me)).toBeUndefined(); // 满气时不用
    me.mp = 0; ally.mp = 0;
    expect(b.mpSkill(me)?.name).toBe('天王聚義式');
    const def0 = ally.stats.defense, mine = me.stats.defense;
    b.useSkill(me, rally, { x: 5, y: 6 });
    expect(me.mp).toBe(Math.floor(me.stats.maxMp / 2));
    expect(ally.mp).toBe(0);
    expect(ally.stats.defense).toBe(def0 + 30);
    expect(me.stats.defense).toBe(mine);
  });

  it('回复技持续回体：每个受回复的人之后 3 回合每回合回 1/10 最大体力', () => {
    const heal: SkillDef = { ...basic, skillId: 301, name: '如魚得水LV1', type: 11, power: 3, mpCost: 10, rangeMin: 0, rangeMax: 0, area: 2, hits: [], healRegen: { divisor: 10, turns: 3 } };
    const classes = [cls(0, [basic, heal]), cls(1)];
    const data: GameData = { classes, items: [], charNames: ['甲', '乙'], heroName: '甲' };
    const b = new Battle({ name: 'test-regen', board: new Board(10, 10), data, units: [act(0, 0, 'player', 5, 5), act(1, 0, 'player', 5, 6), act(2, 1, 'enemy', 0, 0)], blocks: [], seed: 3 });
    b.begin();
    const me = b.unit(0)!, ally = b.unit(1)!;
    b.unit(2)!.alive = false;
    ally.hp = 1;
    b.useSkill(me, heal, { x: 5, y: 5 });
    expect(skillBonusText(heal)).toContain('持续回体1/10·3回合');
    const tick = Math.floor(ally.stats.maxHp / 10);
    const hp = ally.hp;
    b.endPlayerPhase();
    expect(ally.hp).toBe(hp + tick);
    b.endPlayerPhase(); b.endPlayerPhase(); b.endPlayerPhase();
    expect(ally.hp).toBe(hp + 3 * tick);
  });

  it('攻击技附带增益：出手后加防御；每回合回体按回合开始回复', () => {
    const strike: SkillDef = { ...basic, skillId: 300, name: '護身擊', type: 7, mpCost: 10, power: 20, learnLevel: 1, selfBuffs: [{ stat: 'defense', value: 30, turns: 2 }, { stat: 'regenHp', value: 10, turns: 2 }] };
    const classes = [cls(0, [basic, strike]), cls(1)];
    const data: GameData = { classes, items: [], charNames: ['甲', '乙'], heroName: '甲' };
    const b = new Battle({ name: 'test-buff', board: new Board(10, 10), data, units: [act(0, 0, 'player', 5, 5), act(1, 1, 'enemy', 5, 4)], blocks: [], seed: 3 });
    b.begin();
    const me = b.unit(0)!;
    const def0 = me.stats.defense;
    b.useSkill(me, strike, { x: 5, y: 4 });
    expect(skillTags(strike)).toContain('增益');
    expect(me.stats.defense).toBe(def0 + 30);
    expect(me.stats.regenHp).toBe(10);
    me.hp = 100;
    const foe = b.unit(1)!;
    foe.alive = false; // 别让敌人打乱体力
    b.endPlayerPhase();
    expect(me.hp).toBe(110);
    b.endPlayerPhase();
    expect(me.hp).toBe(120);
    expect(me.stats.defense).toBe(def0);
  });

  it('AI：打不到人、敌人在附近时摆架势，已有增益不重复摆', () => {
    const { rt, id } = daizong();
    const b = new Battle({ name: 'test-ai', board: new Board(20, 20), data: rt.data, units: [act(0, id, 'player', 5, 5), act(1, 1, 'enemy', 5, 12)], blocks: [], seed: 1 });
    b.begin();
    const dai = b.unit(0)!;
    dai.mp = dai.stats.maxMp;
    expect(withCharge(b, dai, {}).skill?.name).toBe('神行法');
    b.useSkill(dai, withCharge(b, dai, {}).skill!, { x: 5, y: 5 });
    expect(withCharge(b, dai, {}).skill).toBeUndefined();
  });

  it('原版好汉增益表只写防御、敏捷、回体，数值为正', () => {
    for (const per of Object.values(HERO_SELF_BUFFS))
      for (const list of Object.values(per)) for (const x of list) {
        expect(['defense', 'agility', 'regenHp']).toContain(x.stat);
        expect(x.value).toBeGreaterThan(0);
        expect(x.turns).toBeGreaterThan(0);
      }
  });
});
