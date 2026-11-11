// HUM 职业表（Human.hum）：13 B 头 + 72 × (51 B 基础记录 + n × 58 B 技能子项)。
// 字段语义除"技能编号/隐藏/学习等级/基础移动"外均为推测，见 docs/binary-formats.md §10。
import { expectMagic, hex } from './bytes.ts';

export interface ClassSkill {
  skillId: number; // +0 u16，查 EXE 技能名表
  hidden: boolean; // +5 u8 = 1 时为隐藏技（古武術祕笈）
  learnLevel: number; // +17 u8
  raw: string; // 58 B 原样（十六进制），未解字段保留
}

export interface StatGrowth {
  base: number;
  grade: string; // 成长等级字母（推测）
}

export interface ClassRecord {
  id: number;
  hpGrade: string; // +3（推测）
  mpGrade: string; // +4（推测）
  hp: number; // +5 初始生命（推测）
  mp: number; // +7 初始气力（推测）
  move: number; // +9 基础移动力
  stats: StatGrowth[]; // +10 起 5 组 {u16 值, u8 字母}，顺序推测为 攻/防/命/敏/必
  weaponType: number; // +25
  defaultItems: number[]; // +31 起 4 个 u16（推测为默认装备：武器/衣服/头饰/物品）
  skills: ClassSkill[];
  raw: string; // 51 B 原样
}

const letter = (b: number) => (b >= 0x61 && b <= 0x7a ? String.fromCharCode(b) : '');

export function parseHuman(buf: Buffer): ClassRecord[] {
  expectMagic(buf, 'HUM\0', 'Human.hum');
  const n = buf.readUInt16LE(5);
  const out: ClassRecord[] = [];
  let o = 13;
  for (let i = 0; i < n; i++) {
    const count = buf.readUInt16LE(o + 45);
    const stats: StatGrowth[] = [];
    for (let k = 0; k < 5; k++) {
      const p = o + 10 + 3 * k;
      stats.push({ base: buf.readUInt16LE(p), grade: letter(buf[p + 2]) });
    }
    const skills: ClassSkill[] = [];
    for (let k = 0; k < count; k++) {
      const s = o + 51 + 58 * k;
      skills.push({
        skillId: buf.readUInt16LE(s),
        hidden: buf[s + 5] === 1,
        learnLevel: buf[s + 17],
        raw: hex(buf.subarray(s, s + 58)),
      });
    }
    out.push({
      id: buf.readUInt16LE(o),
      hpGrade: letter(buf[o + 3]),
      mpGrade: letter(buf[o + 4]),
      hp: buf.readUInt16LE(o + 5),
      mp: buf.readUInt16LE(o + 7),
      move: buf[o + 9],
      stats,
      weaponType: buf[o + 25],
      defaultItems: [0, 1, 2, 3].map((k) => buf.readUInt16LE(o + 31 + 2 * k)),
      skills,
      raw: hex(buf.subarray(o, o + 51)),
    });
    o += 51 + 58 * count;
  }
  if (o !== buf.length) throw new Error('Human.hum: 记录未恰好消耗整个文件');
  return out;
}
