import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parseGoods } from '../src/formats/goo.ts';
import { withItemOverrides, type ClassDef, type GameData } from '../src/rules/data.ts';
import { EQUIPMENT_CATEGORIES, GEAR_TABLE, HERO_KITS, LEVEL_BANDS, MEDICINE_TABLE, WEAPON_TABLE, kitBand, levelKit } from '../src/rules/equipment.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
const data = { items: withItemOverrides(parseGoods(fs.readFileSync('gamedata/original/Data/Goods.dab'))) } as GameData;
it('每个档位道具都存在，武器类型正确，攻防不会倒退', () => {
  // 弓（类型 11）和 35 级起的续篇商店货是 mainline 扩展包新增的道具，不在原版道具表里
  const packItems = loadPackFromDisk('mainline').data.items;
  const find = (name: string) => data.items.find((it) => it.name === name) ?? packItems.find((it) => it?.name === name);
  for (const [type, row] of Object.entries(WEAPON_TABLE)) {
    let previous = -1;
    for (const name of row.filter(Boolean)) {
      const item = find(name)!;
      expect(item, name).toBeDefined();
      expect(item.type).toBe(Number(type));
      expect(item.attack).toBeGreaterThanOrEqual(previous);
      previous = item.attack;
    }
  }
  for (const [category, row] of Object.entries(GEAR_TABLE)) {
    let previous = -1;
    for (const name of row) {
      // 僧帽一行只给鲁智深，商店里归帽子
      expect(EQUIPMENT_CATEGORIES[category === '僧帽' ? '帽子' : category]).toContain(name);
      const item = find(name)!;
      expect(item, name).toBeDefined();
      expect(item.defense).toBeGreaterThanOrEqual(previous);
      previous = item.defense;
    }
  }
  expect(Object.keys(HERO_KITS)).toHaveLength(18);
  for (const row of MEDICINE_TABLE) {
    expect(row.length).toBeLessThanOrEqual(4);
    expect(row.filter((n) => n === '天山雪蓮').length).toBeLessThanOrEqual(1);
    expect(row.filter((n) => n === '大還金丹').length).toBeLessThanOrEqual(1);
    for (const name of row) expect(find(name), name).toBeDefined();
  }
});
it('续篇的货原版数据里没有：退回前一档', () => {
  const id = (name: string) => data.items.findIndex((it) => it.name === name) + 1;
  const cls = { id: 99, name: '测试', defaultItems: [id('皮手套'), id('布衣'), id('一字巾')], weaponType: 0 } as unknown as ClassDef;
  const slots = [...cls.defaultItems];
  levelKit(data, cls, 45, slots);
  expect(slots[0]).toBe(id('金剛拳套'));
  expect(slots[1]).toBe(id('皂色繡襖'));
  expect(slots.slice(3).filter((v) => v === id('萬靈藥'))).toHaveLength(1);
  const pack = loadPackFromDisk('mainline').data;
  const packSlots = [...cls.defaultItems];
  levelKit(pack, cls, 45, packSlots);
  expect(pack.items[packSlots[0] - 1].name).toBe('伏虎鐵拳');
  expect(pack.items[packSlots[1] - 1].name).toBe('錦繡衫');
  expect(packSlots.slice(3).some((v) => pack.items[v - 1]?.name === '回春丹')).toBe(true);
});
it('档位边界与超过最高等级均可查表', () => {
  expect(kitBand(0)).toBe(0);
  LEVEL_BANDS.forEach((lv, i) => {
    expect(kitBand(lv)).toBe(i);
    if (i) expect(kitBand(lv - 1)).toBe(i - 1);
  });
  expect(kitBand(99)).toBe(LEVEL_BANDS.length - 1);
});
it('低级小药，高级天山雪蓮最多一个；清理剧本回复药，保留剧情物品', () => {
  const id = (name: string) => data.items.findIndex((it) => it.name === name) + 1;
  const cls = { id: 0, defaultItems: [], weaponType: 0 } as unknown as ClassDef;
  const slots = [0, 0, 0, id('狗皮膏藥'), id('狗皮膏藥'), id('古武術祕笈')];
  levelKit(data, cls, 1, slots);
  expect(slots.slice(3).filter((v) => v === id('跌打藥'))).toHaveLength(1);
  expect(slots.slice(3).filter((v) => v === id('狗皮膏藥'))).toHaveLength(2);
  levelKit(data, cls, 20, slots);
  expect(slots).not.toContain(id('解昏迷草藥'));
  levelKit(data, cls, 21, slots);
  expect(slots.slice(3).filter((v) => v === id('解昏迷草藥'))).toHaveLength(1);
  levelKit(data, cls, 30, slots);
  expect(slots.slice(3).filter((v) => v === id('解昏迷草藥'))).toHaveLength(1);
  expect(slots.slice(3).filter((v) => v === id('天山雪蓮'))).toHaveLength(1);
  expect(slots.slice(3).filter((v) => v === id('牛肉包子'))).toHaveLength(1);
  expect(slots).toContain(id('古武術祕笈'));
  const special = slots[0];
  levelKit(data, cls, 1, slots, (v) => v === special);
  expect(slots[0]).toBe(special);
});
