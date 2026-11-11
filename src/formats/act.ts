// ACT 关卡单位配置：11 B 头 + n × 38 B（19 个 u16）。字段见 docs/binary-formats.md §7。
import { expectMagic } from './bytes.ts';

export type Side = 'player' | 'ally' | 'enemy' | 'object' | 'unknown';
const SIDES: Record<number, Side> = { 0: 'player', 1: 'ally', 2: 'enemy', 4: 'object' };

export interface ActUnit {
  index: number;
  type: number; // w0：0–71 职业/角色；阵营为 object 时为道具编号；1000 为特殊标记
  group: number; // w1
  side: Side; // w2 高字节
  facing: number; // w2 低字节
  x: number; // w3
  y: number; // w4
  level: number; // w6
  flags: number; // w7（AI/出场条件，未解）
  extra: number[]; // w8–w10
  items: number[]; // w12–w18：武器、衣服、头饰、物品×4（0 可能表示空，也可能是道具 0，见文档）
  raw: number[];
}

export function parseAct(buf: Buffer, file = 'act'): ActUnit[] {
  expectMagic(buf, 'ACT\x02', file);
  const n = buf.readUInt16LE(5);
  if (11 + 38 * n !== buf.length) throw new Error(`${file}: 长度与单位数不符`);
  const units: ActUnit[] = [];
  for (let i = 0; i < n; i++) {
    const w = Array.from({ length: 19 }, (_, k) => buf.readUInt16LE(11 + 38 * i + 2 * k));
    units.push({
      index: i,
      type: w[0],
      group: w[1],
      side: SIDES[w[2] >> 8] ?? 'unknown',
      facing: w[2] & 0xff,
      x: w[3],
      y: w[4],
      level: w[6],
      flags: w[7],
      extra: w.slice(8, 11),
      items: w.slice(12, 19),
      raw: w,
    });
  }
  return units;
}
