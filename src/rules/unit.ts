// 战场单位与属性计算。成长规则见 growth.ts 与 docs/game-design.md §3。
import { statAt, tierGear } from './growth.ts';
import { basicAttack, type Buff, EQUIP_SLOTS, equipHitBonus, equipMoveBonus, forgedStats, isEquipment, itemOf, type ClassDef, type GameData, type SkillDef } from './data.ts';

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
  /** 本关体力倍率，随属性重算和倒流保留。 */
  hpMultiplier?: number;
  /** 按哪一方算属性（移动力的等级加成只给我方）；蹴鞠两队都按我方算，免得一边跑得快【新】 */
  statSide?: Side;
  /** 各自为战的阵营号【新】（好汉聚义，§15.31）：设了的人只和同号的人一伙，不看 side */
  team?: number;
  /** 潜行关里还没发现我方的哨兵【新】：被从背后打伤害 ×3、侧面 ×2（负责人 2026-11-19） */
  unaware?: boolean;
  /** 伪装【新】（劫牢的顾大嫂、三打混进庄里的孙立一伙，负责人 2026-11-23）：敌人认不出、不打他；主动出手打敌人（劝酒、吹曲这类不伤人的不算）就被识破 */
  disguised?: boolean;
  /** 伪装时移动力加减【新】（伪装的顾大嫂 −3）：refreshStats 按 disguised 算进 stats.move，最低 1 */
  disguiseMove?: number;
  mp: number;
  /** 本关临时会的技能号【新】（朱贵扮酒保会劝酒）：不随结算带出本关 */
  extraSkills?: number[];
  stats: Stats;
  /** 7 个道具槽，0 = 空；前 3 格是装备栏（武器、衣服、头饰），见 data.ts EQUIP_SLOTS */
  slots: number[];
  /** 每格道具打铁的次数（随道具移动） */
  forge: number[];
  /** 剧情临时借装：原装备随倒流一起保存，结算时恢复。 */
  storyGear?: Record<number, { item: number; forge: number }>;
  gold: number;
  ai: AiState;
  present: boolean; // 是否在场（未登场或已战败为 false）
  alive: boolean;
  defending: boolean;
  poisonTurns: number;
  stunTurns: number;
  /** 逃窜还剩几回合【新】（怒破何观察放火，指令 124）：乱走，不攻击、不防御 */
  panicTurns?: number;
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

/** 己方队员等级移动加成：5 级 +1，20 级累计 +2；按阵营判断，外传队员同样适用。 */
export function levelMoveBonus(level: number, side: Side): number {
  return side === 'player' ? Number(level >= 5) + Number(level >= 20) : 0;
}

/** 敌方 16 级起基础移动力至少 5（负责人 2026-11-15）：本来就 ≥ 5 的不变；只看阵营为敌方。 */
export const ENEMY_MOVE_LEVEL = 16;
export const ENEMY_MIN_MOVE = 5;
export function baseMove(cls: ClassDef, level: number, side: Side): number {
  return side === 'enemy' && level >= ENEMY_MOVE_LEVEL ? Math.max(cls.move, ENEMY_MIN_MOVE) : cls.move;
}

export function computeStats(cls: ClassDef, level: number, slots: number[], data: GameData, poisoned = false, forge: number[] = [], buffs: Buff[] = [], side: Side = 'enemy'): Stats {
  const st: Stats = {
    maxHp: statAt(cls, 'hp', level),
    maxMp: statAt(cls, 'mp', level),
    attack: statAt(cls, 'attack', level),
    defense: statAt(cls, 'defense', level),
    hit: statAt(cls, 'hit', level),
    agility: statAt(cls, 'agility', level),
    crit: statAt(cls, 'crit', level),
    move: baseMove(cls, level, side) + levelMoveBonus(level, side),
    rangeBonus: 0,
    poison: 0,
    stun: 0,
    regenHp: 0,
    regenMp: 0,
  };
  const tmplGear = tierGear(cls);
  if (tmplGear) {
    st.maxHp += tmplGear.hp ?? 0;
    st.maxMp += tmplGear.mp ?? 0;
    st.attack += tmplGear.attack ?? 0;
    st.defense += tmplGear.defense ?? 0;
    st.agility += tmplGear.agility ?? 0;
  }
  for (let k = 0; k < EQUIP_SLOTS; k++) {
    const it = itemOf(data, slots[k]);
    if (!isEquipment(it)) continue;
    // 模板兵：装备只保留射程、中毒、昏迷、回复这些"攻击方式"类效果
    if (tmplGear) {
      st.rangeBonus += it!.range;
      st.regenHp += it!.regenHp;
      st.regenMp += it!.regenMp;
      st.poison += it!.poison;
      st.stun += it!.stun;
      continue;
    }
    const f = forgedStats(it!, forge[k] ?? 0);
    st.attack += f.attack;
    st.defense += f.defense;
    st.hit += equipHitBonus(it!);
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
  u.stats = computeStats(data.classes[u.classId], u.level, u.slots, data, u.poisonTurns > 0, u.forge, u.buffs, u.statSide ?? u.side);
  u.stats.maxHp = Math.max(1, Math.round(u.stats.maxHp * (u.hpMultiplier ?? 1)));
  if (u.disguised && u.disguiseMove) u.stats.move = Math.max(1, u.stats.move + u.disguiseMove);
  u.hp = Math.min(u.hp, u.stats.maxHp);
  u.mp = Math.min(u.mp, u.stats.maxMp);
}

/** 没有技能的职业（如宋江）用这个兜底的普通攻击 */
const FALLBACK_ATTACK: SkillDef = {
  name: '普通攻擊', skillId: 221, type: 5, group: 0, hidden: false, effect: 0, effect2: 0, effect3: 0, power: 0, poison: 0, stun: 0,
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
/** 两人是不是对头：都设了阵营号（各自为战，§15.31）就比阵营号，否则按 side */
export const hostile = (a: { side: Side; team?: number }, b: { side: Side; team?: number }) =>
  a.team !== undefined && b.team !== undefined ? a.team !== b.team : isFoe(a.side, b.side);
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 从 a 看向 b 的朝向（取差值较大的轴） */
export function facingTowards(a: { x: number; y: number }, b: { x: number; y: number }, fallback = 0): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 3 : 1;
  return dy > 0 ? 2 : 0;
}
