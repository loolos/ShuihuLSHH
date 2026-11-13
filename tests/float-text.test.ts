// 战斗飘字颜色（src/game/float-text.ts）。对照原版调色板的部分需要 gamedata/shuihu，没有时跳过。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLOAT_COLOR, FLOAT_PAL_INDEX, MISS_FLOAT, damageFloat, recoveryFloats } from '../src/game/float-text.ts';

const PAL = path.resolve(import.meta.dirname, '../gamedata/shuihu/Data/Default.pal');

describe('战斗飘字', () => {
  it('伤害、必杀、MISS 都是红字；回血绿字、回气黄字在上一行；不带正负号', () => {
    expect(damageFloat(37, false)).toEqual({ text: '37', color: FLOAT_COLOR.damage, lift: 0 });
    expect(damageFloat(80, true).color).toBe(FLOAT_COLOR.damage);
    expect(MISS_FLOAT.color).toBe(FLOAT_COLOR.damage);
    expect(recoveryFloats(10, 10)).toEqual([
      { text: '10', color: FLOAT_COLOR.hp, lift: 0 },
      { text: '10', color: FLOAT_COLOR.mp, lift: 1 },
    ]);
    expect(recoveryFloats(0, 5)).toEqual([{ text: '5', color: FLOAT_COLOR.mp, lift: 1 }]);
    expect(recoveryFloats(-3, -12)).toEqual([]); // 掉血、扣气不弹回复数字
  });

  it.skipIf(!fs.existsSync(PAL))('颜色就是原版 Default.pal 里对应调色板号的颜色', () => {
    const pal = fs.readFileSync(PAL);
    for (const k of ['damage', 'hp', 'mp'] as const) {
      const i = FLOAT_PAL_INDEX[k];
      const hex = '#' + [0, 1, 2].map((c) => pal[i * 3 + c].toString(16).padStart(2, '0')).join('');
      expect(FLOAT_COLOR[k]).toBe(hex);
    }
  });
});
