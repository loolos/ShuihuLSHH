// 续篇城镇的酒馆传闻和说书（src/packs/tavern.ts，docs/game-design.md §7.5「说书」）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/rules/campaign.ts';
import { afterTale, chooseTale } from '../src/rules/storyteller.ts';
import { insertTavern, TAVERNS } from '../src/packs/tavern.ts';
import { prepareInsertTown } from '../src/packs/towns.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('续篇城镇酒馆', () => {
  const rt = loadPackFromDisk('mainline');

  it('六个续篇城镇都有传闻和说书，挂在「下一关」上', () => {
    expect(Object.keys(TAVERNS).sort()).toEqual(['mainline/fachang', 'mainline/jieyangzhen', 'mainline/panduolu', 'mainline/ruzhuang', 'mainline/shiyong', 'mainline/shizipo', 'mainline/yekun', 'mainline/yuanyanglou', 'mainline/zhujiadian']);
    // 每个下一关前面那一关都写了 townAfter
    const towns = rt.stages.filter((s) => s.townAfter).length;
    expect(towns).toBe(Object.keys(TAVERNS).length);
    const ids = new Set<string>();
    for (const next of Object.keys(TAVERNS)) {
      const t = insertTavern(rt, next)!;
      expect(t.rumors.length).toBeGreaterThanOrEqual(3);
      expect(ids.has(t.tale.id)).toBe(false);
      ids.add(t.tale.id);
      for (const p of t.tale.pages) expect([...p].length, `${next} ${p}`).toBeLessThanOrEqual(110);
      for (const r of t.rumors) expect([...r].length).toBeLessThanOrEqual(110);
    }
  });

  it('故事里的好汉正好在城里：说完认账、二选一，第一次选第一项送礼', () => {
    for (const next of Object.keys(TAVERNS)) {
      const t = insertTavern(rt, next)!.tale;
      const c = prepareInsertTown({ ...newCampaign(22), members: [] }, rt, next);
      expect(c.active, next).toContain(t.hero);
      const a = afterTale(c, t);
      expect(a.present, next).toBe(true);
      expect(a.lines.length).toBeGreaterThan(0);
      const r = chooseTale(c, rt.data, t, 0);
      expect(r.got, next).toBe(t.choice!.options[0].gift!.item);
      expect(chooseTale(r.c, rt.data, t, 0).got).toBe(0); // 只送一次
      expect(chooseTale(c, rt.data, t, 1).lines.length).toBeGreaterThan(0);
    }
  });

  it('原版城镇不受影响：没有挂的下一关返回空', () => {
    expect(insertTavern(rt, 'mainline/bailongmiao')).toBeUndefined();
  });
});
