// 解析器回归测试。需要仓库里的 gamedata/shuihu（仓库公开、移除素材后自动跳过）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openGrp, openLib, openPic } from '../src/formats/image.ts';
import { parseMap } from '../src/formats/map.ts';
import { parseAct } from '../src/formats/act.ts';
import { parseHuman } from '../src/formats/hum.ts';
import { parseGoods } from '../src/formats/goo.ts';
import { readExeTables } from '../src/formats/exe.ts';

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
const read = (...p: string[]) => fs.readFileSync(path.join(DATA, ...p));

describe.skipIf(!has)('原版文件解析', () => {
  it('EXE 表：72 个角色、76 个关卡', () => {
    const t = readExeTables(read('ShuiHu.exe'));
    expect(t.characterNames[0]).toBe('武龍');
    expect(t.stages).toHaveLength(76);
    expect(t.stages[0].mapName).toBe('n01');
  });

  it('Man.lib：72 个职业，每个职业的动作组是 4 的倍数', () => {
    const man = openLib(read('Data', 'Man.lib'), 'Man.lib');
    expect(man.count).toBe(26021);
    expect(man.classes).toHaveLength(72);
    for (const c of man.classes) expect((c.last - c.first + 1) % 4).toBe(0);
    const f = man.frame(0);
    expect(f.pixels.length).toBe(f.width * f.height);
  });

  it('图块与图标库可解码', () => {
    const g = openGrp(read('Data', 'Ground.grp'), 'Ground.grp');
    expect(g.frame(0).width).toBe(90);
    expect(openPic(read('Data', 'Head.lib'), 'Head.lib').count).toBe(79);
    expect(openLib(read('Data', 'Effect.lib'), 'Effect.lib').actions).toHaveLength(60);
  });

  it('N01：地图与单位', () => {
    const m = parseMap(read('Map', 'N01.map'), 'N01.map');
    expect([m.width, m.height]).toEqual([54, 54]);
    const units = parseAct(read('Map', 'N01.act'), 'N01.act');
    const hero = units.find((u) => u.type === 0)!;
    expect(hero.flags & 0xff).toBe(1); // 武龍开局不在场
    const mother = units.find((u) => u.type === 18)!;
    expect(mother.flags >> 8).toBe(5); // 王母：AI 模式 5，跟随
  });

  it('职业成长与道具表', () => {
    const wulong = parseHuman(read('Data', 'Human.hum'))[0];
    expect(wulong.stats[0].base).toBe(65);
    expect(wulong.stats[0].grade).toBe('i'); // 字节 105 = 每级 ×1.05
    expect(parseGoods(read('Data', 'Goods.dab'))[155].name).toBe('狗皮膏藥');
  });
});
