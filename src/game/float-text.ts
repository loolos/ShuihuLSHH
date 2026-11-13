// 战斗飘字的颜色与内容，照原版 EXE（证据见 docs/game-design.md「战斗飘字」）。
// 原版的数字对象（0x416940，0x46 字节）把字画进 8 位缓冲，颜色是 Data/Default.pal 的调色板号：
//   伤害 / MISS：0x406850 → 0x416a90 设色号 12（ff0000 红）
//   回血：0x404f20 → 0x416b30(0) 设色号 8（4fff4b 绿）
//   回气：0x405010 → 0x416b30(1) 设色号 10（ffff00 黄），并比回血数字高 40 像素（y − 0x28）
// 数字不带正负号；数值 ≤ 0 的回复不弹字（0x404f9d / 0x40508d），所以扣气不显示。

/** 原版飘字用的调色板号（Data/Default.pal） */
export const FLOAT_PAL_INDEX = { damage: 12, hp: 8, mp: 10 } as const;

/** 上面三个调色板号在 Default.pal 里的颜色 */
export const FLOAT_COLOR = { damage: '#ff0000', hp: '#4fff4b', mp: '#ffff00' } as const;

export interface FloatSpec {
  text: string;
  color: string;
  /** 往上抬几行：回气比回血高一行（原版 40 像素） */
  lift: number;
}

/** 一次回复要弹出的数字：回血绿字，回气黄字在上方；减少的不弹 */
export function recoveryFloats(hpDelta: number, mpDelta: number): FloatSpec[] {
  const out: FloatSpec[] = [];
  if (hpDelta > 0) out.push({ text: String(hpDelta), color: FLOAT_COLOR.hp, lift: 0 });
  if (mpDelta > 0) out.push({ text: String(mpDelta), color: FLOAT_COLOR.mp, lift: 1 });
  return out;
}

/** 伤害数字：红字，必杀也是同一个红色（原版必杀另放第 43 组特效，0x406ea5，数字不变色） */
export function damageFloat(damage: number, crit: boolean): FloatSpec {
  return { text: (crit ? '必杀 ' : '') + damage, color: FLOAT_COLOR.damage, lift: 0 };
}

/** 落空：原版伤害 ≤ 0 时同一个数字对象改写成 "MISS"（0x4169ad，字串 0x445ed4），颜色仍是伤害的红色 */
export const MISS_FLOAT: FloatSpec = { text: 'MISS', color: FLOAT_COLOR.damage, lift: 0 };
