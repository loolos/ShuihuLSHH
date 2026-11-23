import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/packs/build.ts';
import type { PackClassJson, PackJson } from '../src/packs/types.ts';
import type { ActUnit } from '../src/formats/act.ts';
import { Board } from '../src/rules/board.ts';
import { Battle } from '../src/rules/battle.ts';
import type { ClassDef, GameData, SkillDef } from '../src/rules/data.ts';
import { areaCells, learnedSkills, skillBonusText } from '../src/rules/skills.ts';
import { planAi } from '../src/rules/ai.ts';
import { FX_CHARGE, fxSpots, skillFx } from '../src/game/effects.ts';

const basic: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false,
  power: 0, mpCost: 0, learnLevel: 1, rangeMin: 1, rangeMax: 1, area: 1,
  hitMod: 0, critMod: 0, stun: 0, poison: 0, effect: 0, effect2: 0, effect3: 0,
  hits: [{ frame: 10, percent: 100, dir: 0 }], raw: '',
};
const cls = (id: number): ClassDef => ({
  id, name: `角色${id}`, hp: { base: 300, growth: 100 }, mp: { base: 120, growth: 100 },
  attack: { base: 50, growth: 100 }, defense: { base: 20, growth: 100 }, hit: { base: 90, growth: 100 },
  agility: { base: 10, growth: 100 }, crit: { base: 10, growth: 100 }, move: 5,
  weaponType: 0, goldCap: 0, defaultItems: [], skills: [basic],
});
const packOf = (pack: string): PackJson => JSON.parse(fs.readFileSync(`packs/${pack}/pack.json`, 'utf8'));
const configOf = (pack: string): PackClassJson => packOf(pack).classes.find((c) => c.id === 'daizong')!;

function runtime(pack: string) {
  const classes = Array<ClassDef>(72);
  classes[0] = cls(0);
  classes[1] = cls(1);
  classes[38] = { ...cls(38), skills: [basic,
    { ...basic, skillId: 225, name: '迴旋技', type: 2, group: 1, mpCost: 30, power: 15 },
    { ...basic, skillId: 227, name: '集氣技', type: 8, group: 2, mpCost: 0, power: 2, rangeMin: 0, rangeMax: 0, area: 0, hits: [] },
  ] };
  const data: GameData = { classes, items: [], charNames: classes.map((c) => c?.name ?? ''), heroName: '队友' };
  const sp = configOf(pack).sprite;
  const sheet = 'sheet' in sp ? sp.sheet : null;
  const sheets = sheet ? { [sheet]: JSON.parse(fs.readFileSync(`packs/${pack}/${sheet}/sprites.json`, 'utf8')) } : {};
  return buildPack(data, { ...packOf(pack), classes: [configOf(pack)], items: [], stages: [] }, [], sheets);
}

const act = (index: number, type: number, side: ActUnit['side'], x: number, y: number, level = 20): ActUnit => ({
  index, type, side, x, y, level, facing: 0, group: index, flags: 0,
  items: [0, 0, 0, 0, 0, 0, 0], extra: [0, 0, 0], raw: [],
});
const fight = (others: ActUnit[] = [act(1, 0, 'player', 6, 5), act(2, 1, 'enemy', 19, 19)], level = 20, pack = 'mainline') => {
  const rt = runtime(pack);
  const id = rt.classIds.get('daizong')!;
  const b = new Battle({ name: 'test-daizong', board: new Board(20, 20), data: rt.data,
    units: [act(0, id, 'player', 5, 5, level), ...others], blocks: [], seed: 1 });
  b.begin();
  const dai = b.unit(0)!;
  const aid = rt.data.classes[id].skills.find((s) => s.name === '神行渡气')!;
  const strike = rt.data.classes[id].skills.find((s) => s.name === '疾风踏阵LV2')!;
  return { b, dai, aid, strike, rt };
};
const cells = (a: { x: number; y: number }[]) => a.map((p) => `${p.x},${p.y}`).sort();

describe('戴宗新技能', () => {
  it('戴宗援气及三阶范围技随等级领悟', () => {
    for (const pack of ['mainline']) {
      const { b, dai, aid } = fight(undefined, 7, pack);
      const names = (level: number) => {
        dai.level = level;
        return learnedSkills(dai, b.data).map((s) => s.name);
      };
      expect(names(7)).not.toContain('神行渡气');
      expect(names(8)).toContain('神行渡气');
      expect(names(11).filter((s) => s.startsWith('疾风踏阵'))).toEqual([]);
      for (const [level, version] of [[12, 1], [20, 2], [28, 3]]) {
        expect(names(level).filter((s) => s.startsWith('疾风踏阵'))).toEqual([`疾风踏阵LV${version}`]);
      }
      expect(aid).toMatchObject({ type: 8, chargeTarget: 'ally', rangeMin: 1, rangeMax: 1, area: 0, power: 2, mpCost: 30 });
      expect(skillBonusText(aid)).toContain('友方回气1/2');
    }
  });

  it('援气只能选正交相邻、在场存活且缺气的同阵营单位，不受装备射程扩大', () => {
    const { b, dai, aid } = fight([
      act(1, 0, 'player', 6, 5), act(2, 0, 'ally', 5, 4), act(3, 1, 'enemy', 4, 5),
      act(4, 0, 'player', 5, 6), act(5, 0, 'player', 6, 6), act(6, 0, 'player', 5, 3),
    ]);
    for (const u of b.units) u.mp = 0;
    dai.mp = 100;
    b.unit(4)!.mp = b.unit(4)!.stats.maxMp;
    dai.stats.rangeBonus = 5;
    expect(cells(b.skillCells(dai, aid))).toEqual(['4,5', '5,4', '5,6', '6,5']);
    expect(cells(b.skillTargets(dai, aid))).toEqual(['5,4', '6,5']);
    expect(b.affected(dai, aid, { x: 5, y: 5 })).toEqual([]);
    b.unit(1)!.present = false;
    b.unit(2)!.alive = false;
    expect(b.skillTargets(dai, aid)).toEqual([]);
  });

  it('援气扣戴宗自己的气、只恢复所选队友的气，消耗本次行动，目标不消耗行动', () => {
    const { b, dai, aid } = fight();
    const ally = b.unit(1)!;
    ally.mp = 0;
    const before = { mp: dai.mp, hp: dai.hp, allyHp: ally.hp, exp: dai.exp };
    const events = b.useSkill(dai, aid, ally);
    expect(dai.mp).toBe(before.mp - 30);
    expect(ally.mp).toBe(Math.floor(ally.stats.maxMp / 2));
    expect(dai.hp).toBe(before.hp);
    expect(ally.hp).toBe(before.allyHp);
    expect(dai.exp).toBe(before.exp);
    expect(dai.acted && dai.ended).toBe(true);
    expect(ally.acted || ally.ended).toBe(false);
    expect(events.find((e) => e.type === 'attack')).toMatchObject({ area: [{ x: ally.x, y: ally.y }], hits: [] });
    expect(events.find((e) => e.type === 'hp' && e.uid === ally.uid)).toMatchObject({ delta: 0, mpDelta: ally.mp });
    expect(b.useSkill(dai, aid, ally)).toEqual([]);
  });

  it('援气不溢出上限，满气、自身、敌人、斜角及远处不能施放，气不足不扣资源', () => {
    const { b, dai, aid } = fight();
    const ally = b.unit(1)!;
    const mp = dai.mp;
    for (const target of [ally, dai, b.unit(2)!, { x: 6, y: 6 }, { x: 7, y: 5 }]) {
      expect(b.useSkill(dai, aid, target)).toEqual([]);
      expect(dai.mp).toBe(mp);
      expect(dai.acted).toBe(false);
    }
    ally.mp--;
    dai.mp = 29;
    expect(b.skillsOf(dai).find((s) => s.skill === aid)?.usable).toBe(false);
    expect(b.useSkill(dai, aid, ally)).toEqual([]);
    dai.mp = 30;
    const events = b.useSkill(dai, aid, ally);
    expect(dai.mp).toBe(0);
    expect(ally.mp).toBe(ally.stats.maxMp);
    expect(events.find((e) => e.type === 'hp' && e.uid === ally.uid)).toMatchObject({ mpDelta: 1 });
  });

  it('未领悟的援气不能提前施放，回合终了只给自己集气，不误用援气', () => {
    const { b, dai, aid } = fight(undefined, 7);
    b.unit(1)!.mp = 0;
    expect(b.useSkill(dai, aid, b.unit(1)!)).toEqual([]);
    dai.level = 20;
    dai.mp = 0;
    expect(b.mpSkill(dai)?.name).toBe('甲马聚气');
    b.autoAct(dai);
    expect(dai.mp).toBeGreaterThan(0);
    expect(b.unit(1)!.mp).toBe(0);
  });

  it('四格攻击随四个方向旋转，始终只含正前、前两格和左右前，不扩成矩形', () => {
    const { b, dai, strike } = fight();
    const expected = [
      [{ x: 5, y: 4 }, ['4,4', '5,3', '5,4', '6,4']],
      [{ x: 6, y: 5 }, ['6,4', '6,5', '6,6', '7,5']],
      [{ x: 5, y: 6 }, ['4,6', '5,6', '5,7', '6,6']],
      [{ x: 4, y: 5 }, ['3,5', '4,4', '4,5', '4,6']],
    ] as const;
    for (const [at, wanted] of expected) expect(cells(b.skillArea(dai, strike, at))).toEqual(wanted);
    dai.stats.rangeBonus = 10;
    expect(b.skillCells(dai, strike)).toHaveLength(4);
    const edge = areaCells(new Board(2, 2), { x: 0, y: 0 }, strike, { x: 1, y: 0 });
    expect(cells(edge)).toEqual(['1,0', '1,1']);
  });

  it('四格攻击只伤敌人、扣除正确气力，范围外与队友不受伤', () => {
    const { b, dai, strike } = fight([
      act(1, 1, 'enemy', 6, 5), act(2, 1, 'enemy', 7, 5), act(3, 1, 'enemy', 6, 4),
      act(4, 0, 'player', 6, 6), act(5, 1, 'enemy', 7, 4), act(6, 1, 'enemy', 8, 5),
    ]);
    const hp = b.units.map((u) => u.hp), mp = dai.mp;
    const events = b.useSkill(dai, strike, { x: 6, y: 5 });
    const attack = events.find((e) => e.type === 'attack');
    expect(attack?.type === 'attack' && attack.hits.map((h) => h.uid).sort()).toEqual([1, 2, 3]);
    expect(attack?.area).toHaveLength(4);
    expect(b.units.slice(1, 4).some((u) => u.hp < hp[u.uid])).toBe(true);
    for (const id of [4, 5, 6]) expect(b.unit(id)!.hp).toBe(hp[id]);
    expect(dai.mp).toBe(mp - 40);
    expect(dai.acted && dai.ended).toBe(true);
  });

  it('AI 可援助缺气队友、选用四格攻击，不把援气当作自身回气', () => {
    const { b, dai, aid } = fight([
      act(1, 0, 'player', 4, 5), act(2, 1, 'enemy', 6, 5), act(3, 1, 'enemy', 7, 5),
      act(4, 1, 'enemy', 6, 4), act(5, 1, 'enemy', 6, 6),
    ]);
    b.unit(1)!.mp = 0;
    expect(planAi(b, dai)).toMatchObject({ skill: aid, cell: { x: 4, y: 5 } });
    b.unit(1)!.mp = b.unit(1)!.stats.maxMp;
    expect(planAi(b, dai).skill?.name).toBe('疾风踏阵LV2');
    const far = fight();
    far.rt.data.classes[far.dai.classId].skills = far.rt.data.classes[far.dai.classId].skills.filter((s) => s.type !== 8 || s.chargeTarget === 'ally');
    far.dai.mp = 40;
    expect(far.b.mpSkill(far.dai)).toBeUndefined();
    expect(planAi(far.b, far.dai).skill).toBeUndefined();
  });

  it('援气特效落在受援者身上；四格攻击先播近侧三格，再播前两格', () => {
    const { b, dai, aid, strike } = fight();
    const at = { x: 6, y: 5 };
    expect(skillFx(aid)).toMatchObject({ first: FX_CHARGE, atEnd: true });
    expect(fxSpots(aid, dai, at, b.skillArea(dai, aid, at))).toEqual([{ cell: at, ring: 0 }]);
    const spots = fxSpots(strike, dai, at, b.skillArea(dai, strike, at));
    expect(spots.find((s) => s.cell.x === 7 && s.cell.y === 5)?.ring).toBe(1);
    expect(spots.filter((s) => s.cell.x === 6).every((s) => s.ring === 0)).toBe(true);
  });
});
