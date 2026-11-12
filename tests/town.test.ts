// 城镇与整备：商店货品、买卖、打铁、给予、装备（docs/game-design.md §7.5）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/formats/goo.ts';
import { parsePasHeader } from '../src/formats/pas.ts';
import { readExeTables } from '../src/formats/exe.ts';
import { parseGoods } from '../src/formats/goo.ts';
import { newCampaign, nextStages, type CampaignState } from '../src/rules/campaign.ts';
import type { ClassDef, GameData } from '../src/rules/data.ts';
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

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('城镇（原版数据）', () => {
  const exe = readExeTables(fs.readFileSync(path.join(DATA, 'ShuiHu.exe')));
  const stages = exe.stages.filter((s) => s.mapName);
  const pab = (n: string) => {
    const f = fs.readdirSync(path.join(DATA, 'Map')).find((x) => x.toLowerCase() === `${n.toLowerCase()}.pab`)!;
    return parsePasHeader(fs.readFileSync(path.join(DATA, 'Map', f)));
  };

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
  it('按目标关敌人平均等级补等级，换上最后一个城镇能买到的最好装备', async () => {
    const { loadGameData } = await import('../src/rules/load.ts');
    const { jumpTo } = await import('../src/rules/preset.ts');
    const files = {
      index: new Map<string, string>(),
      init() {
        for (const d of ['', 'Data', 'Map']) for (const f of fs.readdirSync(path.join(DATA, d))) this.index.set((d ? `${d}/${f}` : f).toLowerCase(), path.join(DATA, d, f));
        return this;
      },
      get(p: string) { return fs.readFileSync(this.index.get(p.toLowerCase())!); },
      has(p: string) { return this.index.has(p.toLowerCase()); },
      list(dir: string, ext: string) { return [...this.index.keys()].filter((k) => k.startsWith(dir.toLowerCase() + '/') && k.endsWith(ext)); },
    }.init();
    const data = loadGameData(files);
    const exe = readExeTables(files.get('ShuiHu.exe'));
    const stages = exe.stages.filter((s) => s.mapName);
    const c = jumpTo(files, data, stages, 34, newCampaign(0)); // N06
    const lin = c.members.find((m) => m.classId === 11)!; // 林沖
    expect(c.stage).toBe(34);
    expect(lin.level).toBe(16);
    expect(c.members.find((m) => m.classId === 0)!.level).toBe(16);
    // 最后去过的城镇是 4（N-add07 之后）：主角用拳套类，换上城镇 4 武器店里攻击最高的
    const hero = c.members.find((m) => m.classId === 0)!;
    expect(data.items[hero.slots[0] - 1].name).toBe('鐵拳');
    expect(jumpTo(files, data, stages, 0, newCampaign(0)).members.find((m) => m.classId === 0)!.level).toBe(1);
    // 先跳到后期再跳回前面：不沿用后期的等级和装备，和直接跳过去一样（只保留黄金）
    const early = stages.find((s) => s.mapName.toLowerCase() === 'n01')!.index;
    const back = jumpTo(files, data, stages, early, { ...c, gold: 500 });
    expect(back.members).toEqual(jumpTo(files, data, stages, early, newCampaign(0)).members);
    expect(back.members.find((m) => m.classId === 0)!.level).toBeLessThan(5);
    expect(back.gold).toBe(500);

    // 直接进城镇：N-add07（25）之后是城镇 4，下一关 26
    const { jumpToTown, expectedGold } = await import('../src/rules/preset.ts');
    const t = jumpToTown(files, data, stages, 25, 4, 26, newCampaign(0));
    const pos25 = stages.findIndex((s) => s.index === 25);
    expect(t.stage).toBe(25);
    expect(t.town).toBe(4);
    // 等级按下一关配，装备只用城镇 4 之前的店（城镇 4 的鐵拳留给玩家自己买）
    const at26 = jumpTo(files, data, stages, 26, newCampaign(0));
    expect(t.members.find((m) => m.classId === 0)!.level).toBe(at26.members.find((m) => m.classId === 0)!.level);
    expect(data.items[t.members.find((m) => m.classId === 0)!.slots[0] - 1].name).not.toBe('鐵拳');
    expect(t.gold).toBe(expectedGold(files, data, stages, pos25));
    expect(t.gold).toBeGreaterThan(1000);
    // 手上钱更多就保留
    expect(jumpToTown(files, data, stages, 25, 4, 26, { ...newCampaign(0), gold: 999999 }).gold).toBe(999999);
    // 分路：小径（42）只算小径，不把大道（41）也算进去
    const p41 = stages.findIndex((s) => s.index === 41);
    const p42 = stages.findIndex((s) => s.index === 42);
    const prev = expectedGold(files, data, stages, p41 - 1);
    expect(expectedGold(files, data, stages, p42) - prev).toBeLessThan(expectedGold(files, data, stages, p41) - prev + 1000);
    expect(expectedGold(files, data, stages, p42)).toBeLessThan(expectedGold(files, data, stages, p41) * 1.5);
  });
});
