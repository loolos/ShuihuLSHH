import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parseGoods } from '../src/formats/goo.ts';
import { withItemOverrides, type ClassDef, type GameData } from '../src/rules/data.ts';
import { EQUIPMENT_CATEGORIES, GEAR_TABLE, HERO_KITS, LEVEL_BANDS, MEDICINE_TABLE, WEAPON_TABLE, kitBand, levelKit } from '../src/rules/equipment.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
const data = { items: withItemOverrides(parseGoods(fs.readFileSync('gamedata/original/Data/Goods.dab'))) } as GameData;
it('每个档位道具都存在，武器类型正确，攻防不会倒退', () => {
  // 弓（类型 11）是 mainline 扩展包新增的道具，不在原版道具表里
  const packItems = loadPackFromDisk('mainline').data.items;
  for (const [type, row] of Object.entries(WEAPON_TABLE)) {
    let previous = -1;
    for (const name of row.filter(Boolean)) {
      const item = (Number(type) === 11 ? packItems : data.items).find((it) => it.name === name)!;
      expect(item, name).toBeDefined();
      expect(item.type).toBe(Number(type));
      expect(item.attack).toBeGreaterThanOrEqual(previous);
      previous = item.attack;
    }
  }
  for (const [category, row] of Object.entries(GEAR_TABLE)) {
    let previous = -1;
    for (const name of row) {
      expect(EQUIPMENT_CATEGORIES[category]).toContain(name);
      const item = data.items.find((it) => it.name === name)!;
      expect(item, name).toBeDefined();
      expect(item.defense).toBeGreaterThanOrEqual(previous);
      previous = item.defense;
    }
  }
  expect(Object.keys(HERO_KITS)).toHaveLength(18);
  for (const row of MEDICINE_TABLE) {
    expect(row.length).toBeLessThanOrEqual(7);
    expect(row.filter((n) => n === '天山雪蓮').length).toBeLessThanOrEqual(1);
    expect(row.filter((n) => n === '大還金丹').length).toBeLessThanOrEqual(1);
    for (const name of row) expect(data.items.some((it) => it.name === name), name).toBe(true);
  }
});
it('档位边界与超过最高等级均可查表', () => {
  expect(kitBand(0)).toBe(0);
  LEVEL_BANDS.forEach((lv, i) => {
    expect(kitBand(lv)).toBe(i);
    if (i) expect(kitBand(lv - 1)).toBe(i - 1);
  });
  expect(kitBand(99)).toBe(6);
});
it('低级小药，高级天山雪蓮最多一个；清理剧本回复药，保留剧情物品', () => {
  const id = (name: string) => data.items.findIndex((it) => it.name === name) + 1;
  const cls = { id: 0, defaultItems: [], weaponType: 0 } as unknown as ClassDef;
  const slots = [0, 0, 0, id('狗皮膏藥'), id('狗皮膏藥'), id('古武術祕笈')];
  levelKit(data, cls, 1, slots);
  expect(slots.slice(3).filter((v) => v === id('跌打藥'))).toHaveLength(1);
  expect(slots.slice(3).filter((v) => v === id('狗皮膏藥'))).toHaveLength(2);
  levelKit(data, cls, 30, slots);
  expect(slots.slice(3).filter((v) => v === id('天山雪蓮'))).toHaveLength(1);
  expect(slots.slice(3).filter((v) => v === id('牛肉包子'))).toHaveLength(1);
  expect(slots).toContain(id('古武術祕笈'));
  const special = slots[0];
  levelKit(data, cls, 1, slots, (v) => v === special);
  expect(slots[0]).toBe(special);
});
