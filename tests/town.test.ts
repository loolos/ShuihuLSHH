// 城镇与整备：商店货品、买卖、打铁、给予、装备（docs/game-design.md §7.5）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/formats/goo.ts';
import { stageUnits } from '../src/formats/stage-json.ts';
import { exeTables, stageJson } from '../src/rules/load.ts';
import { NodeFiles } from '../tools/sim-lib.ts';
import { parseGoods } from '../src/formats/goo.ts';
import { newCampaign, nextStages, type CampaignState } from '../src/rules/campaign.ts';
import { forgeGain, forgeGainText, type ClassDef, type GameData } from '../src/rules/data.ts';
import { buy, canForge, discard, equip, forge, give, partyMembers, pawn, stock } from '../src/rules/town.ts';
import { computeStats } from '../src/rules/unit.ts';

const g = { base: 10, growth: 100 };
const cls = (id: number, weaponType = 0): ClassDef =>
  ({ id, name: `c${id}`, hp: g, mp: g, attack: g, defense: g, hit: g, agility: g, crit: g, move: 4, weaponType, goldCap: 0, defaultItems: [], skills: [] }) as ClassDef;
const item = (o: Partial<Item>): Item =>
  ({ type: 0, category: 2, name: 'x', attack: 0, defense: 0, attackStep: 0, attackSteps: 0, defenseStep: 0, defenseSteps: 0, hit: 0, agility: 0, crit: 0, moveBonus: 0, range: 0, maxHp: 0, maxMp: 0, regenHp: 0, regenMp: 0, poison: 0, stun: 0, buyPrice: 100, sellPrice: 50, seqA: [1, 2], seqB: [2], ...o }) as Item;
const data: GameData = {
  classes: [cls(0, 0), cls(1, 1)],
  items: [
    item({ name: '手套', attack: 9, attackStep: 2, attackSteps: 4, buyPrice: 200, sellPrice: 100 }), // 1
    item({ name: '棍', type: 1, attack: 10 }), // 2
    item({ name: '衣', type: 13, defense: 6, defenseStep: 3, defenseSteps: 1 }), // 3
    item({ name: '藥', type: 15, category: 4, buyPrice: 50 }), // 4
    item({ name: '寶', type: 14, category: 0, buyPrice: 0, sellPrice: 4000, seqA: [], seqB: [] }), // 5
  ],
  charNames: ['甲', '乙'],
  heroName: '甲',
};
/** 补齐到 13 格（3 装备 + 10 随身） */
const pad = (a: number[]) => [...a, ...Array(13 - a.length).fill(0)];
const camp = (gold = 1000): CampaignState => ({
  ...newCampaign(0),
  gold,
  members: [
    { classId: 0, level: 1, exp: 0, slots: pad([1, 0, 0, 4]) },
    { classId: 1, level: 1, exp: 0, slots: [2, 3, 0, ...Array(10).fill(4)] },
  ],
});

describe('城镇', () => {
  it('货品：大类 = 店序号 + 1，且城镇号表含本城', () => {
    expect(stock(data, 1, 1)).toEqual([1, 2, 3]);
    expect(stock(data, 3, 1)).toEqual([4]);
    expect(stock(data, 1, 5)).toEqual([]);
  });

  it('买：扣钱，能装上就放进空的装备栏，否则放随身物品；钱不够、道具满都不行', () => {
    let r = buy(camp(), data, 0, 3);
    expect(r).toMatchObject({ ok: true, c: { gold: 900 } });
    expect(r.c.members[0].slots).toEqual(pad([1, 3, 0, 4, 0, 0, 0]));
    r = buy(r.c, data, 0, 2); // 棍不是甲的武器类型 → 随身
    expect(r.c.members[0].slots).toEqual(pad([1, 3, 0, 4, 2, 0, 0]));
    expect(buy(camp(10), data, 0, 1)).toMatchObject({ ok: false, text: '金錢不夠！' });
    expect(buy(camp(), data, 1, 4)).toMatchObject({ ok: false });
  });

  it('典当按卖价收钱', () => {
    const r = pawn(camp(0), data, 0, 0);
    expect(r.c.gold).toBe(100);
    expect(r.c.members[0].slots[0]).toBe(0);
  });

  it('打铁：每次收买价一半，按次数加攻防，只在列出的城镇，次数用完为止', () => {
    expect(canForge(data.items[0], 0, 1)).toBe(false);
    let c = camp(450);
    for (let i = 0; i < 4; i++) c = forge(c, data, 0, 0, 2).c;
    expect(c.gold).toBe(50);
    expect(c.members[0].forge![0]).toBe(4);
    expect(forge({ ...c, gold: 1000 }, data, 0, 0, 2).ok).toBe(false); // 4 次用完
    expect(forge(camp(50), data, 0, 0, 2).text).toBe('金錢不夠，無法提升！');
    const st = computeStats(data.classes[0], 0, c.members[0].slots, data, false, c.members[0].forge);
    expect(st.attack).toBe(10 + 9 + 8);
    expect(forge(camp(), data, 1, 1, 2).text).toBe('防御力提升了3點！');
  });

  it('打铁前显示每次加多少：打到头的那项不再加，剩余次数递减', () => {
    const both = item({ attack: 5, attackStep: 2, attackSteps: 3, defense: 4, defenseStep: 1, defenseSteps: 1 });
    expect(forgeGain(both, 0)).toEqual({ attack: 2, defense: 1, left: 3 });
    expect(forgeGainText(both, 0)).toBe('攻+2 防+1');
    expect(forgeGain(both, 1)).toEqual({ attack: 2, defense: 0, left: 2 });
    expect(forgeGainText(both, 1)).toBe('攻+2');
    expect(forgeGain(both, 3)).toEqual({ attack: 0, defense: 0, left: 0 });
    expect(forgeGainText(data.items[2], 0)).toBe('防+3');
  });

  it('只有前 3 格的装备算加成', () => {
    expect(computeStats(data.classes[0], 0, [0, 0, 0, 1], data).attack).toBe(10);
    expect(computeStats(data.classes[0], 0, [1], data).attack).toBe(19);
  });

  it('给予带着打铁次数；装备 / 卸下互换格子；武器类型不合不能装备', () => {
    let c = forge(camp(), data, 0, 0, 2).c;
    c = give(c, data, 0, 0, 1).c; // 乙的武器类型是 1，手套放随身……但乙已满
    expect(c.members[0].slots[0]).toBe(1);
    c = discard(c, data, 1, 6).c;
    c = give(c, data, 0, 0, 1).c;
    expect(c.members[1].slots[6]).toBe(1);
    expect(c.members[1].forge![6]).toBe(1);
    expect(equip(c, data, 1, 6)).toMatchObject({ ok: false });
    c = give(c, data, 1, 0, 0).c; // 棍给甲：甲武器栏空了，但棍不合 → 随身
    expect(c.members[0].slots).toEqual(pad([0, 0, 0, 4, 2, 0, 0]));
    expect(equip(c, data, 0, 4).ok).toBe(false);
    expect(equip(c, data, 1, 1)).toMatchObject({ ok: false, text: '道具已滿，無法卸下。' });
    const d = equip(discard(c, data, 1, 3).c, data, 1, 1); // 卸下衣服
    expect(d.c.members[1].slots[1]).toBe(0);
    expect(d.c.members[1].slots.includes(3)).toBe(true);
  });

  it('整备只列上一关出场的人', () => {
    expect(partyMembers({ ...camp(), active: [1] }).map((m) => m.classId)).toEqual([1]);
    expect(partyMembers(camp())).toHaveLength(2);
  });
});

const DATA = path.resolve(import.meta.dirname, '../gamedata/original');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('城镇（原版数据）', () => {
  const files = new NodeFiles(DATA);
  const exe = exeTables(files);
  const stages = exe.stages.filter((s) => s.mapName);
  const pab = (n: string) => stageJson(files, n)!.header;

  it('PAB 文件头：城镇号与下一关', () => {
    const towns = stages.flatMap((s) => (pab(s.mapName).town ? [`${s.mapName}:${pab(s.mapName).town}`] : []));
    expect(towns.slice(0, 4)).toEqual(['n-add01:1', 'act3-4:2', 'act5-1:3', 'n-add07:4']);
    expect(towns).toHaveLength(13);
    // 文件头的"下一关"与按关卡表推出的顺序一致（二选一的路线取第一条）
    for (const s of stages) {
      const next = nextStages(stages, s.index);
      if (next.length) expect(pab(s.mapName).next, s.mapName).toBe(next[0].index);
    }
  });

  it('店名、招呼语与各城镇的传闻', () => {
    expect(exe.town.shops).toEqual(['酒店', '武器店', '打鐵鋪', '藥鋪', '當鋪']);
    expect(exe.town.greet[3]).toBe('客倌，抓藥嗎？');
    expect(exe.town.rumors[1].map((r) => r.slice(0, 5))).toEqual(['前方有個史', '過了華陰縣']);
    expect(exe.town.rumors[5]).toEqual([]);
  });

  it('第一个城镇的货', () => {
    const items = parseGoods(fs.readFileSync(path.join(DATA, 'Data/Goods.dab')));
    const d = { items } as GameData;
    const names = (shop: number) => stock(d, shop, 1).map((i) => items[i - 1].name);
    expect(names(1)).toContain('皮手套');
    expect(names(1)).not.toContain('白銀手套');
    expect(names(0)).toContain('女兒紅');
    expect(names(3)).toContain('狗皮膏藥');
    expect(names(4)).toEqual(['青花錫飾']);
    expect(names(2)).toEqual([]);
  });
});

describe.skipIf(!has)('测试用跳关', () => {
  it('按主线估算的入场等级表补等级，按人物类别和最终等级查表配装', async () => {
    const { loadGameData } = await import('../src/rules/load.ts');
    const { jumpTo, expectedGold } = await import('../src/rules/preset.ts');
    const files = new NodeFiles(DATA);
    const data = loadGameData(files);
    const exe = exeTables(files);
    const stages = exe.stages.filter((s) => s.mapName);
    const c = jumpTo(files, data, stages, 34, newCampaign(0)); // N06
    const lin = c.members.find((m) => m.classId === 11)!; // 林沖
    expect(c.stage).toBe(34);
    const table = JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'../src/data/entry-levels.json'),'utf8')).levels.n06;
    for(const m of c.members)expect(m.level).toBe(table[m.classId]);
    expect(lin.level).toBe(table[11]);
    // 第 1 章战役 2（N-add01）：第一关打过不少小兵，两人都不该还是 2 级
    const at1 = jumpTo(files, data, stages, 1, newCampaign(0)).members;
    expect(at1.find((m) => m.classId === 0)!.level).toBeGreaterThanOrEqual(3); // 武龍
    expect(at1.find((m) => m.classId === 1)!.level).toBeGreaterThanOrEqual(4); // 王進
    // 每一关的等级都不比前一关低（同一个人沿主线只升不降）
    const mainPath = ['n01', 'n-add01', 'n-add02', 'n02', 'n03', 'n-add04a', 'n-add05', 'n04', 'n-add06', 'n-add07', 'n05', 'n-add08', 'n06'];
    let seen = new Map<number, number>();
    for (const name of mainPath) {
      const s = stages.find((x) => x.mapName.toLowerCase() === name)!;
      const now = new Map(jumpTo(files, data, stages, s.index, newCampaign(0)).members.map((m) => [m.classId, m.level]));
      for (const [id, lv] of now) if (seen.has(id)) expect(lv, `${name} ${id}`).toBeGreaterThanOrEqual(seen.get(id)!);
      seen = new Map([...seen, ...now]);
    }
    // 推荐等级来自实际流程，不再按旧的敌人绝对等级全员压低。
    // 全关卡以最终人物等级查表；不再依赖经过的城镇。
    const { GEAR_TABLE, WEAPON_TABLE, MEDICINE_TABLE, kitBand, kitProfile } = await import('../src/rules/equipment.ts');
    for (const stage of stages) {
      const state = jumpTo(files, data, stages, stage.index, newCampaign(0));
      for (const m of state.members) {
        const cls = data.classes[m.classId], profile = kitProfile(data, cls), band = kitBand(m.level);
        const type = data.items[cls.defaultItems[0] - 1]?.type ?? cls.weaponType;
        // 剧本装备比表里这一档好就留着（负责人 2026-11-15）：武器比攻击，衣服、头饰比防御
        const tableOrBetter = (k: number, want: string) => {
          const got = data.items[m.slots[k] - 1], ref = data.items.find((it) => it.name === want)!;
          if (got?.name === want) return;
          expect(k === 0 ? got.attack : got.defense, `${stage.mapName} ${cls.name} ${got?.name} / ${want}`).toBeGreaterThan(k === 0 ? ref.attack : ref.defense);
        };
        tableOrBetter(0, WEAPON_TABLE[type][band]);
        tableOrBetter(1, GEAR_TABLE[profile.armor][band]);
        tableOrBetter(2, GEAR_TABLE[profile.head][band]);
        const meds = m.slots.slice(3).filter((id) => id && [15, 16, 17].includes(data.items[id - 1].type)).map((id) => data.items[id - 1].name);
        expect(meds).toEqual(MEDICINE_TABLE[band]);
        expect(meds.length).toBeLessThanOrEqual(7);
        expect(m.forge?.every((n) => n === 0)).toBe(true);
      }
    }
    // 剧本武器比表里这一档好就留着：N03 陳達的白點鋼槍（攻 31）不换成筆管槍
    const n03 = jumpTo(files, data, stages, stages.find((s) => s.mapName.toLowerCase() === 'n03')!.index, newCampaign(0));
    expect(data.items[n03.members.find((m) => m.classId === 13)!.slots[0] - 1].name).toBe('白點鋼槍');
    // 先跳到后期再跳回前面：不沿用后期的等级、装备和银子，和直接跳过去一样
    const early = stages.find((s) => s.mapName.toLowerCase() === 'n01')!.index;
    const back = jumpTo(files, data, stages, early, { ...c, gold: 500 });
    expect(back.members).toEqual(jumpTo(files, data, stages, early, newCampaign(0)).members);
    expect(back.members.find((m) => m.classId === 0)!.level).toBeLessThan(5);
    expect(back.gold).toBe(0); // 第一关之前没有收入
    // 银子固定为打到上一关为止的期望收入
    const p34 = stages.findIndex((s) => s.index === 34);
    expect(c.gold).toBe(expectedGold(files, data, stages, p34 - 1));
    expect(jumpTo(files, data, stages, 34, { ...newCampaign(0), gold: 999999 }).gold).toBe(c.gold);

    // 直接进城镇：N-add07（25）之后是城镇 4，下一关 26
    const { jumpToTown } = await import('../src/rules/preset.ts');
    const t = jumpToTown(files, data, stages, 25, 4, 26, newCampaign(0));
    const pos25 = stages.findIndex((s) => s.index === 25);
    expect(t.stage).toBe(25);
    expect(t.town).toBe(4);
    // 等级、装备都按下一关配，与城镇商店无关
    const at26 = jumpTo(files, data, stages, 26, newCampaign(0));
    expect(t.members.find((m) => m.classId === 0)!.level).toBe(at26.members.find((m) => m.classId === 0)!.level);
    expect(t.members.find((m) => m.classId === 0)!.slots).toEqual(at26.members.find((m) => m.classId === 0)!.slots);
    expect(t.gold).toBe(expectedGold(files, data, stages, pos25));
    expect(t.gold).toBeGreaterThan(1000);
    // 不沿用手上的钱
    expect(jumpToTown(files, data, stages, 25, 4, 26, { ...newCampaign(0), gold: 999999 }).gold).toBe(t.gold);
    // 分路：小径（42）只算小径，不把大道（41）也算进去
    const p41 = stages.findIndex((s) => s.index === 41);
    const p42 = stages.findIndex((s) => s.index === 42);
    const prev = expectedGold(files, data, stages, p41 - 1);
    expect(expectedGold(files, data, stages, p42) - prev).toBeLessThan(expectedGold(files, data, stages, p41) - prev + 1000);
    expect(expectedGold(files, data, stages, p42)).toBeLessThan(expectedGold(files, data, stages, p41) * 1.5);
  });
});

describe('城镇整备名单', () => {
  it('startingParty：只取开局在场的我方，隐藏、埋伏、场外占位都不算，按角色号去重', async () => {
    const { startingParty } = await import('../src/rules/campaign.ts');
    const u = (type: number, o: { side?: string; flags?: number; x?: number; y?: number } = {}) =>
      ({ index: 0, type, group: 0, side: o.side ?? 'player', facing: 0, x: o.x ?? 3, y: o.y ?? 4, level: 1, flags: o.flags ?? 0, extra: [0, 0, 0], items: [], raw: [] }) as never;
    expect(startingParty([u(0), u(1, { flags: 1 }), u(2, { flags: 7 << 8 }), u(3, { flags: 6 << 8 }), u(4, { x: 0, y: 0 }), u(5, { side: 'ally' }), u(0), u(6)])).toEqual([0, 6]);
  });
});

describe.skipIf(!has)('城镇整备名单（原版数据）', async () => {
  const { loadGameData } = await import('../src/rules/load.ts');
  const { jumpToTown, townRoster } = await import('../src/rules/preset.ts');
  const files = new NodeFiles(DATA);
  const data = loadGameData(files);
  const stages = exeTables(files).stages.filter((s) => s.mapName);
  const header = (m: string) => stageJson(files, m)!.header;
  const towns = stages.flatMap((s) => {
    const h = header(s.mapName);
    const next = stages.find((x) => x.index === h.next);
    return h.town && next ? [{ stage: s, town: h.town, next }] : [];
  });
  const names = (ids: number[]) => ids.map((i) => data.charNames[i]).sort().join(' ');
  /** 每个城镇该列的人（docs/game-design.md §7.5.1）；排序后比较 */
  const ROSTER: Record<number, string> = {
    1: '武龍 王進',
    2: '武龍 史進 朱武 陳達 楊春',
    3: '武龍 史進 朱武 陳達 楊春 魯智深',
    4: '武龍 史進 朱武 陳達 楊春 魯智深',
    13: '武龍 林沖 史進 朱武 陳達 楊春 魯智深',
    5: '武龍 林沖 史進 朱武 陳達 楊春 魯智深',
    6: '武龍 林沖 史進 朱武 陳達 楊春 魯智深',
    12: '武龍 林沖 史進 朱武 陳達 楊春 魯智深',
    7: '武龍 林沖 史進 朱武 陳達 楊春 魯智深',
    8: '武龍 林沖 史進 朱武 陳達 楊春 魯智深 楊志',
    9: '武龍 林沖 史進 朱武 陳達 楊春 魯智深 楊志 晁蓋 吳用 公孫勝 劉唐 阮小二 阮小五 阮小七 白勝',
    10: '武龍 林沖 史進 朱武 陳達 楊春 魯智深 楊志 晁蓋 吳用 公孫勝 劉唐 阮小二 阮小五 阮小七 白勝',
    11: '武龍 林沖 史進 朱武 陳達 楊春 魯智深 楊志 晁蓋 吳用 公孫勝 劉唐 阮小二 阮小五 阮小七 白勝',
  };
  const sorted = (s: string) => s.split(' ').sort().join(' ');

  it('13 个城镇的名单都对得上表', () => {
    expect(towns.map((t) => t.town).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const t of towns) expect(names(townRoster(files, t.next.mapName)), `城镇 ${t.town}`).toBe(sorted(ROSTER[t.town]));
  });

  it('城镇 8（郓城县，Act11-2 之后）没有宋江，朱武、陈达、杨春在', () => {
    const t = towns.find((x) => x.town === 8)!;
    const r = townRoster(files, t.next.mapName);
    expect(r).not.toContain(6);
    expect(r).toEqual(expect.arrayContaining([5, 13, 15]));
  });

  it('名单里只有已经入伙的人：每个人在主线上之前就以我方身份出场过', () => {
    for (const t of towns) {
      const upto = stages.slice(0, stages.indexOf(t.stage) + 1);
      const seen = new Set(upto.flatMap((s) => (stageJson(files, s.mapName) ? stageUnits(stageJson(files, s.mapName)!) : []).filter((u) => u.side === 'player').map((u) => u.type)));
      for (const id of townRoster(files, t.next.mapName)) expect(seen.has(id), `城镇 ${t.town} ${data.charNames[id]}`).toBe(true);
    }
  });

  it('选关直接进城镇：人物和整备名单与正常进城一样，不带客串的人', () => {
    for (const t of towns) {
      const c = jumpToTown(files, data, stages, t.stage.index, t.town, t.next.index, newCampaign(0));
      const roster = townRoster(files, t.next.mapName);
      expect(c.active, `城镇 ${t.town}`).toEqual(roster);
      expect(names(c.members.map((m) => m.classId)), `城镇 ${t.town}`).toBe(names(roster));
      expect(names(partyMembers(c).map((m) => m.classId))).toBe(sorted(ROSTER[t.town]));
    }
  });
});
