// 技能特效选组与接力（src/game/effects.ts）。原版数据部分需要 gamedata/shuihu，没有时跳过。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHuman } from '../src/formats/hum.ts';
import { readExeTables } from '../src/formats/exe.ts';
import { FX_CHARGE, FX_HEAL, fxChain, fxSpots, skillFx } from '../src/game/effects.ts';

const sk = (type: number, effect: number, effect2 = 0, effect3 = 0) => ({ type, effect, effect2, effect3 });

describe('技能特效选组', () => {
  it('回复技固定第 17 组，集气技固定第 7 组，迴旋技没有特效', () => {
    expect(skillFx(sk(11, 19))?.first).toBe(FX_HEAL);
    expect(skillFx(sk(11, 0))).toBeNull();
    expect(skillFx(sk(9, 0))).toMatchObject({ first: FX_HEAL, atEnd: true });
    expect(skillFx(sk(8, 0))).toMatchObject({ first: FX_CHARGE, atEnd: true });
    expect(skillFx(sk(2, 5))).toBeNull();
    expect(skillFx(sk(0, 0))).toBeNull();
  });

  it('三段接力：命中特效只在有目标的格子播，结算在最后一段的触发帧', () => {
    const fx = skillFx(sk(4, 15, 36, 23))!;
    const trig = Array.from({ length: 60 }, () => 3);
    trig[14] = 6;
    trig[35] = 5;
    trig[22] = 2;
    expect(fxChain(fx, 0, true, trig)).toEqual({ parts: [{ group: 14, startFrame: 0 }, { group: 35, startFrame: 6 }, { group: 22, startFrame: 11 }], resolveFrame: 13 });
    expect(fxChain(fx, 0, false, trig)).toEqual({ parts: [{ group: 14, startFrame: 0 }, { group: 35, startFrame: 6 }], resolveFrame: 11 });
  });

  it('遠程：按方向选组，从施放者脚下飞到第一个目标', () => {
    const fx = skillFx(sk(10, 53))!;
    expect(fxChain(fx, 3, true, []).parts[0].group).toBe(55);
    const spots = fxSpots({ type: 10 }, { x: 2, y: 2 }, { x: 6, y: 2 }, [], (c) => c.x === 4);
    expect(spots.map((s) => s.cell.x)).toEqual([2, 3, 4]);
  });

  it('菱形范围一圈圈往外，线形按离施放点的距离', () => {
    const area = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 6 },
    ];
    expect(fxSpots({ type: 4 }, { x: 0, y: 5 }, { x: 5, y: 5 }, area).map((s) => s.ring)).toEqual([0, 1, 1]);
    expect(fxSpots({ type: 0 }, { x: 5, y: 3 }, { x: 5, y: 4 }, [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]).map((s) => s.ring)).toEqual([0, 1, 2]);
  });
});

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('原版技能特效', () => {
  const exe = readExeTables(fs.readFileSync(path.join(DATA, 'ShuiHu.exe')));
  const classes = parseHuman(fs.readFileSync(path.join(DATA, 'Data', 'Human.hum')));
  const find = (cls: number, name: string) => classes[cls].skills.find((s) => exe.skillNames[s.skillId] === name)!;

  it('触发帧表 60 项（EXE 0x4435e8）', () => {
    expect(exe.effectTriggers).toHaveLength(60);
    expect(exe.effectTriggers.slice(0, 4)).toEqual([2, 3, 3, 3]);
  });

  it('朱武回復計与史進天龍出雲的 +6 都是 19，但回復計实际播第 17 组', () => {
    expect(find(5, '回復計LV1').effect).toBe(19);
    expect(find(3, '天龍出雲LV1').effect).toBe(19);
    expect(skillFx(find(5, '回復計LV1'))!.first).toBe(17);
    expect(skillFx(find(3, '天龍出雲LV1'))).toMatchObject({ first: 18, then: null, onTarget: 38 });
  });

  it('五雷咒三段：+6 / +24 / +26 = 15 / 36 / 23', () => {
    expect(skillFx(find(2, '五雷咒LV1'))).toMatchObject({ first: 14, then: 35, onTarget: 22 });
  });
});
