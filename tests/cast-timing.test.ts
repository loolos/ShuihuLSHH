// 集气技施放时长（负责人 2026-11-15：武松等人的集气要好几秒）：所有职业（原版 + 扩展包）出手动作 + 特效不超过上限。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARGE_CAST_MAX_MS, CHARGE_TOTAL_MAX_MS, castPlayMs, castPlaybackRate, castSegmentMs } from '../src/game/cast-timing.ts';
import { chargeRows } from '../tools/charge-anim.ts';

const has = fs.existsSync(path.resolve(import.meta.dirname, '../gamedata/original/ShuiHu.exe'));

describe.skipIf(!has)('集气技施放时长', () => {
  const rows = has ? chargeRows() : [];
  it('每个人的集气技出手 + 特效都在上限内', () => {
    expect(rows.length).toBeGreaterThan(20);
    const slow = rows.filter((r) => r.after > CHARGE_TOTAL_MAX_MS).map((r) => `${r.pack} ${r.name} ${r.skill} ${r.after}ms`);
    expect(slow).toEqual([]);
  });
  it('武松、李逵、公孫勝、朱武原来偏慢，现在被加快', () => {
    for (const n of ['武松', '李逵', '公孫勝', '朱武']) {
      const r = rows.find((x) => x.name === n)!;
      expect(r.before).toBeGreaterThan(CHARGE_TOTAL_MAX_MS);
      expect(r.after).toBeLessThanOrEqual(CHARGE_TOTAL_MAX_MS);
    }
  });
  it('原本就快的（1 帧出手）不变', () => {
    const r = rows.find((x) => x.name === '史進')!;
    expect(r.after).toBe(r.before);
  });
});

describe('只加快集气技', () => {
  const assets = { man: { classes: [{ first: 0, last: 31 }], actions: Array.from({ length: 32 }, () => ({ first: 0, last: 30 })) }, pack: null } as never;
  it('31 帧的攻击技不加快，集气技压到上限', () => {
    expect(castPlayMs(assets, 0, { type: 7, group: 0 }, 0)).toBeNull();
    expect(castPlayMs(assets, 0, { type: 8, group: 0 }, 0)).toBe(CHARGE_CAST_MAX_MS);
  });
});


describe('单招动作加速', () => {
  it('未指定倍率的招式维持原45ms命中时间轴', () => {
    expect(castPlaybackRate({})).toBe(1);
    expect(castSegmentMs(20, {})).toBe(855);
  });
  it('三连射的三次命中等比加快，与完整三次动作保持相位一致', () => {
    const skill = { castSpeed: 1.2 };
    expect([20, 46, 72].map(f => castSegmentMs(f, skill))).toEqual([712.5, 1687.5, 2662.5]);
    const cycleMs = 26 * 45 / castPlaybackRate(skill);
    expect(castSegmentMs(46, skill) - castSegmentMs(20, skill)).toBe(cycleMs);
    expect(cycleMs * 3).toBe(2925);
  });
  it.each([0, -1, NaN, Infinity])('无效倍率%f不会破坏时间轴', speed => {
    expect(castPlaybackRate({ castSpeed: speed })).toBe(1);
    expect(castSegmentMs(20, { castSpeed: speed })).toBe(855);
  });
});
