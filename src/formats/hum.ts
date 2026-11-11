// HUM 职业表（Human.hum）：13 B 头 + 72 × (51 B 基础记录 + n × 58 B 技能子项)。
// 字段语义与置信度见 docs/binary-formats.md §10。
import { expectMagic, hex } from './bytes.ts';

export interface SkillHit {
  frame: number; // 动画帧（推测）
  percent: number; // 本段伤害比例 %
  dir: number; // 迴旋技等：本段打的方向（推测）
}

export interface ClassSkill {
  skillId: number; // +0 u16，查 EXE 技能名表
  type: number; // +2：5 普通、6/10 遠程、7 連續、2 迴旋、8 集氣、0/1/3/4 氣功、9/11 回復
  group: number; // +3 技能组号（LV1/2/3 共用）
  hidden: boolean; // +5 u8 = 1 时为隐藏技（古武術祕笈）
  effect: number; // +6 特效号：Effect.lib 第 (effect − 1) 组，0 = 无（一柱擎天 39 → 光柱）
  power: number; // +8 威力；回复技/集气技为回复除数
  poison: number; // +10 中毒率 %
  stun: number; // +11 昏迷率 %
  rangeMin: number; // +12 射程下限（推测）
  rangeMax: number; // +13 射程上限（推测）
  area: number; // +16 范围大小
  learnLevel: number; // +17 u8
  mpCost: number; // +18
  hitMod: number; // +20 s16
  critMod: number; // +22 s16
  hits: SkillHit[]; // +28 起，每段 6 B，帧号为 0 时结束
  raw: string; // 58 B 原样（十六进制），未解字段保留
}

export interface StatGrowth {
  base: number;
  grade: string; // 成长百分比的字母写法（'i' = 0x69 = 105）
  growth: number; // 成长百分比：属性(L) = 基础值 × (growth / 100)^L
}

export interface ClassRecord {
  id: number;
  hpGrade: string; // +3
  mpGrade: string; // +4
  hpGrowth: number; // +3 生命成长百分比
  mpGrowth: number; // +4 气力成长百分比
  hp: number; // +5 生命基础值
  mp: number; // +7 气力基础值
  move: number; // +9 基础移动力
  stats: StatGrowth[]; // +10 起 5 组 {u16 值, u8 成长}：攻/防/命/敏/必
  weaponType: number; // +25
  goldCap: number; // +29 被击倒时掉落金钱的上限
  defaultItems: number[]; // +31 起 7 个 u16：默认道具（EXE 0x4048ac 逐个装备，0 = 空）
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
      stats.push({ base: buf.readUInt16LE(p), grade: letter(buf[p + 2]), growth: buf[p + 2] });
    }
    const skills: ClassSkill[] = [];
    for (let k = 0; k < count; k++) {
      const s = o + 51 + 58 * k;
      const hits: SkillHit[] = [];
      for (let h = s + 28; h + 6 <= s + 58; h += 6) {
        const frame = buf.readUInt16LE(h);
        if (!frame) break;
        hits.push({ frame, percent: buf.readUInt16LE(h + 2), dir: buf.readUInt16LE(h + 4) });
      }
      skills.push({
        skillId: buf.readUInt16LE(s),
        type: buf[s + 2],
        group: buf[s + 3],
        hidden: buf[s + 5] === 1,
        effect: buf.readUInt16LE(s + 6),
        power: buf.readInt16LE(s + 8),
        poison: buf[s + 10],
        stun: buf[s + 11],
        rangeMin: buf[s + 12],
        rangeMax: buf[s + 13],
        area: buf[s + 16],
        learnLevel: buf[s + 17],
        mpCost: buf.readInt16LE(s + 18),
        hitMod: buf.readInt16LE(s + 20),
        critMod: buf.readInt16LE(s + 22),
        hits,
        raw: hex(buf.subarray(s, s + 58)),
      });
    }
    out.push({
      id: buf.readUInt16LE(o),
      hpGrade: letter(buf[o + 3]),
      mpGrade: letter(buf[o + 4]),
      hpGrowth: buf[o + 3],
      mpGrowth: buf[o + 4],
      hp: buf.readUInt16LE(o + 5),
      mp: buf.readUInt16LE(o + 7),
      move: buf[o + 9],
      stats,
      weaponType: buf[o + 25],
      goldCap: buf.readUInt16LE(o + 29),
      defaultItems: [0, 1, 2, 3, 4, 5, 6].map((k) => buf.readUInt16LE(o + 31 + 2 * k)),
      skills,
      raw: hex(buf.subarray(o, o + 51)),
    });
    o += 51 + 58 * count;
  }
  if (o !== buf.length) throw new Error('Human.hum: 记录未恰好消耗整个文件');
  return out;
}
