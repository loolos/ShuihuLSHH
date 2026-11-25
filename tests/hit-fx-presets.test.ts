import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { HIT_FX, fxGroups } from '../src/game/effects.ts';
import effects from '../gamedata/sprites/effects.json' with { type: 'json' };

// 原版特效换色、组合出的命中特效（负责人 2026-11-25）：蓝色光柱、金色佛光、寒光、打昏冒星、震劲
describe('命中特效预设', () => {
  it('每层都引用存在的原版特效组，染色、缩放在合理范围', () => {
    for (const [name, p] of Object.entries(HIT_FX)) {
      expect(p!.layers.length, name).toBeGreaterThan(0);
      for (const l of p!.layers) {
        expect(effects.actions[l.group], `${name} 组 ${l.group}`).toBeTruthy();
        if (l.scale !== undefined) expect(l.scale).toBeGreaterThan(0.3);
        if (l.scale !== undefined) expect(l.scale).toBeLessThanOrEqual(1);
      }
    }
    expect(HIT_FX.pillar!.layers[0].group).toBe(24); // 一刀兩斷 的蓝白光柱
    expect(HIT_FX.pillar!.lastOnly).toBe(true); // 多段技只在最后一段升一根
    expect(HIT_FX.stars!.onStun).toBe(true);
  });

  const available = fs.existsSync(path.join(DATA, 'Data/Human.hum'));
  it.skipIf(!available)('配到这几招上，下载列表带上各层特效组', () => {
    const main = loadPackFromDisk('mainline');
    const sk = (cls: string | number, name: string) => {
      const id = typeof cls === 'number' ? cls : main.classIds.get(cls)!;
      return main.data.classes[id].skills.find((s) => s.name === name)!;
    };
    const want: [string | number, string, string][] = [
      [0, '一夫當關', 'pillar'], [0, '一夫當關LV2', 'pillar'],
      ['sj-fugitive', '四海归心', 'pillar'], ['sj-fugitive', '四海归心LV2', 'pillar'],
      [16, '佛光普照', 'gold'],
      ['huangxin', '寒锋五叠', 'frost'], ['huangxin', '寒锋五叠LV2', 'frost'],
      ['jiezhen', '钢叉叉虎', 'stars'],
      ['shiyong', '一拳毙命', 'shock'], ['shiyong', '一拳毙命LV2', 'shock'],
    ];
    for (const [cls, name, fx] of want) {
      const s = sk(cls, name);
      expect(s?.hitFx, `${cls} ${name}`).toBe(fx);
      for (const l of HIT_FX[s.hitFx!]!.layers) expect(fxGroups(s)).toContain(l.group);
    }
    // 敌方版好汉不跟着变
    const enemyWulong = main.data.classes.findIndex((c, i) => i >= 18 && c?.name === '武龍');
    if (enemyWulong > 0) expect(main.data.classes[enemyWulong].skills.find((s) => s.name === '一夫當關')?.hitFx).toBeUndefined();
  });
});
