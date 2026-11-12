// 战场单位与属性计算。公式见 docs/game-design.md §3（EXE 0x408540）。
import { basicAttack, type Buff, EQUIP_SLOTS, equipMoveBonus, forgedStats, isEquipment, itemOf, type ClassDef, type GameData, type SkillDef } from './data.ts';

export type Side = 'player' | 'ally' | 'enemy';

export interface Stats {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  hit: number;
  agility: number;
  crit: number;
  move: number;
  rangeBonus: number;
  poison: number; // 装备附带中毒率
  stun: number; // 装备附带昏迷率
  regenHp: number;
  regenMp: number;
}

export interface AiState {
  mode: number; // ACT w7 高字节
  target: number; // w8：目标角色号
  point: { x: number; y: number }; // w9, w10
}

export interface Unit {
  uid: number; // 本场战斗内唯一，等于 ACT 序号
  classId: number; // = 角色号
  name: string;
  side: Side;
  x: number;
  y: number;
  facing: number; // 0 = −y，1 = −x，2 = +y，3 = +x
  level: number;
  exp: number;
  hp: number;
  mp: number;
  stats: Stats;
  /** 7 个道具槽，0 = 空；前 3 格是装备栏（武器、衣服、头饰），见 data.ts EQUIP_SLOTS */
  slots: number[];
  /** 每格道具打铁的次数（随道具移动） */
  forge: number[];
  gold: number;
  ai: AiState;
  present: boolean; // 是否在场（未登场或已战败为 false）
  alive: boolean;
  defending: boolean;
  poisonTurns: number;
  stunTurns: number;
  /** 道具带来的限时效果（增益、抗毒、抗昏） */
  buffs: Buff[];
  // 本回合行动状态
  movementRemaining: number;
  forcedMarch: boolean;
  acted: boolean; // 已攻击/使用道具等
  ended: boolean; // 本回合行动结束
  turnStart: { x: number; y: number; facing: number; movement: number } | null; // 撤销移动用
}

export const DIRS = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
] as const;

export const CAP_HPMP = 510;
export const CAP_STAT = 255;

/** 属性(L) = floor(基础值 × (成长 / 100)^L) */
export function grow(s: { base: number; growth: number }, level: number, cap = CAP_STAT): number {
  return Math.min(cap, Math.floor(s.base * Math.pow(s.growth / 100, level)));
}

const G = JSON.parse(process.env.GROW ?? '{"hp":[2,2.5],"mp":[2,2],"attack":[1.5,3],"defense":[2,8],"hit":[2,4],"agility":[1,6],"crit":[0.4,3.5]}');
type StatKey = 'hp' | 'mp' | 'attack' | 'defense' | 'hit' | 'agility' | 'crit';
const GRUNT: Record<StatKey, number> = { hp: 55, mp: 45, attack: 50, defense: 20, hit: 55, agility: 22, crit: 0 };
const OFFICER: Record<StatKey, number> = { hp: 70, mp: 80, attack: 62, defense: 25, hit: 70, agility: 30, crit: 12 };
const GRUNTS = new Set([19, 20, 21, 22, 23, 32, 33, 34, 36, 37, 40, 41, 44, 45, 67]);
const OFFICERS = new Set([38, 39, 42, 43, 65, 66]);
const baseOf = (cls: ClassDef, k: StatKey) => (GRUNTS.has(cls.id) ? GRUNT[k] : OFFICERS.has(cls.id) ? OFFICER[k] : cls[k].base);
const growU = (cls: ClassDef, k: StatKey, L: number) => { const b = baseOf(cls, k); return Math.floor(b + L * (G[k][0] + (b * G[k][1]) / 100)); };

export function computeStats(cls: ClassDef, level: number, slots: number[], data: GameData, poisoned = false, forge: number[] = [], buffs: Buff[] = []): Stats {
  const st: Stats = {
    maxHp: growU(cls, 'hp', level),
    maxMp: growU(cls, 'mp', level),
    attack: growU(cls, 'attack', level),
    defense: growU(cls, 'defense', level),
    hit: growU(cls, 'hit', level),
    agility: growU(cls, 'agility', level),
    crit: growU(cls, 'crit', level),
    move: cls.move,
    rangeBonus: 0,
    poison: 0,
    stun: 0,
    regenHp: 0,
    regenMp: 0,
  };
  for (let k = 0; k < EQUIP_SLOTS; k++) {
    const it = itemOf(data, slots[k]);
    if (!isEquipment(it)) continue;
    const f = forgedStats(it!, forge[k] ?? 0);
    st.attack += f.attack;
    st.defense += f.defense;
    st.hit += it!.hit;
    st.agility += it!.agility;
    st.crit += it!.crit;
    st.move += equipMoveBonus(it!);
    st.rangeBonus += it!.range;
    st.maxHp += it!.maxHp;
    st.maxMp += it!.maxMp;
    st.regenHp += it!.regenHp;
    st.regenMp += it!.regenMp;
    st.poison += it!.poison;
    st.stun += it!.stun;
  }
  for (const b of buffs) if (b.stat in st) st[b.stat as keyof Stats] += b.value;
  for (const k of ['attack', 'defense', 'hit', 'agility', 'crit'] as const) st[k] = Math.max(0, st[k]);
  if (poisoned) {
    st.attack = Math.floor(st.attack / 2);
    st.defense = Math.floor(st.defense / 2);
  }
  return st;
}

export function refreshStats(u: Unit, data: GameData) {
  u.stats = computeStats(data.classes[u.classId], u.level, u.slots, data, u.poisonTurns > 0, u.forge, u.buffs);
  u.hp = Math.min(u.hp, u.stats.maxHp);
  u.mp = Math.min(u.mp, u.stats.maxMp);
}

/** 没有技能的职业（如宋江）用这个兜底的普通攻击 */
const FALLBACK_ATTACK: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false, effect: 0, power: 0, poison: 0, stun: 0,
  rangeMin: 1, rangeMax: 1, area: 1, learnLevel: 1, mpCost: 0, hitMod: 0, critMod: 0, hits: [{ frame: 0, percent: 100, dir: 0 }], raw: '',
};

export function attackSkill(u: Unit, data: GameData): SkillDef {
  return basicAttack(data.classes[u.classId]) ?? FALLBACK_ATTACK;
}

/** 普通攻击的射程 [下限, 上限]（技能子项 +12/+13，加装备射程；推测） */
export function attackRange(u: Unit, data: GameData): [number, number] {
  const s = attackSkill(u, data);
  const lo = Math.max(1, s.rangeMin);
  return [lo, Math.max(lo, s.rangeMax + u.stats.rangeBonus)];
}

/**
 * 攻击只能沿 4 个方向直线进行：目标与攻方同行或同列，距离在射程内（EXE 0x40d850 按方向表 0x4460c4 逐格检查）。
 */
export function inAttackRange(a: { x: number; y: number }, t: { x: number; y: number }, [lo, hi]: [number, number]): boolean {
  if (a.x !== t.x && a.y !== t.y) return false;
  const d = Math.abs(a.x - t.x) + Math.abs(a.y - t.y);
  return d >= lo && d <= hi;
}

export const resists = (u: Unit, stat: 'resistPoison' | 'resistStun') => u.buffs.some((b) => b.stat === stat);

export const isFoe = (a: Side, b: Side) => (a === 'enemy') !== (b === 'enemy');
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 从 a 看向 b 的朝向（取差值较大的轴） */
export function facingTowards(a: { x: number; y: number }, b: { x: number; y: number }, fallback = 0): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 3 : 1;
  return dy > 0 ? 2 : 0;
}
