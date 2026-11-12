// 战斗结算（docs/game-design.md §4、§5；原版 EXE 0x406c60）。
import type { GameData, SkillDef } from './data.ts';
import type { Rng } from './rng.ts';
import { dist, facingTowards, type Unit } from './unit.ts';

/** 攻守双方朝向关系：相同 = 打背后，相反 = 打正面，其余 = 侧面 */
export function facingRelation(attackerFacing: number, defenderFacing: number): 'back' | 'side' | 'front' {
  if (attackerFacing === defenderFacing) return 'back';
  if ((attackerFacing + 2) % 4 === defenderFacing) return 'front';
  return 'side';
}

const FACING_FACTOR = { back: 1.5, side: 1.3, front: 1 } as const;

/** 命中率（%）。≥ 100 必中；我方攻击保底 90（原版 80，负责人 2026-11-11 改），其它保底 30。 */
export function hitChance(att: Unit, def: Unit, skill: SkillDef): number {
  let h = Math.max(0, att.stats.hit - def.stats.agility / 2 + skill.hitMod);
  h *= FACING_FACTOR[facingRelation(facingTowards(att, def, att.facing), def.facing)];
  if (def.defending) h *= 0.7;
  h = Math.floor(h);
  return Math.min(100, Math.max(att.side === 'player' ? 90 : 30, h));
}

export function critChance(att: Unit, skill: SkillDef): number {
  return Math.max(0, Math.floor((att.stats.crit + skill.critMod) / 2));
}

/**
 * 保底伤害比例【新】（负责人 2026-11-12 选）：原版"攻 − 防 ≤ 0 时改为 10–59 随机"。
 * 防御每级 ×1.10、攻击只有 ×1.04–1.05，后期攻防都到 255 封顶后，普通攻击几乎都落到这个随机数上。
 * 重制版改为：伤害至少是 (攻 + 威力) 的 35%，必杀至少 70%。前期攻远大于防时不起作用。
 */
export const DAMAGE_FLOOR = 0.35;

/** 不含随机部分的伤害：返回 [普通, 必杀] */
export function baseDamage(att: Unit, def: Unit, skill: SkillDef): [number, number] {
  const power = skill.type === 8 || skill.type === 9 || skill.type === 11 ? 0 : skill.power;
  const a = att.stats.attack + power;
  const d = def.stats.defense;
  return [Math.max(a - d, Math.floor(a * DAMAGE_FLOOR)), Math.max(2 * a - d, Math.floor(2 * a * DAMAGE_FLOOR))];
}

export interface AttackPreview {
  hit: number;
  crit: number;
  damage: number; // 普通命中时的期望伤害（不计浮动）
  critDamage: number;
}

export function previewAttack(att: Unit, def: Unit, skill: SkillDef): AttackPreview {
  const [n, c] = baseDamage(att, def, skill);
  const k = def.defending ? 0.7 : 1;
  return { hit: hitChance(att, def, skill), crit: critChance(att, skill), damage: Math.floor(n * k), critDamage: Math.floor(c * k) };
}

export interface HitResult {
  hit: boolean;
  crit: boolean;
  damage: number; // 总伤害
  parts: number[]; // 多段伤害
  poisoned: boolean;
  stunned: boolean;
  backstab: 'back' | 'side' | 'front';
}

/**
 * 一次攻击的结算（不改动单位状态）。
 * forceHit：反击必定命中。
 */
export function rollAttack(att: Unit, def: Unit, skill: SkillDef, rng: Rng, forceHit = false): HitResult {
  const rel = facingRelation(facingTowards(att, def, att.facing), def.facing);
  const hit = forceHit || rng.chance(hitChance(att, def, skill));
  if (!hit) return { hit, crit: false, damage: 0, parts: [], poisoned: false, stunned: false, backstab: rel };
  const crit = rng.chance(critChance(att, skill));
  const [n, c] = baseDamage(att, def, skill);
  let dmg: number = crit ? c : n;
  if (def.defending) dmg *= 0.7;
  dmg *= 0.9 + rng.next() * 0.2; // D-9【新】：±10% 浮动（原版无浮动）
  dmg = Math.max(0, Math.floor(dmg));
  const hits = skill.hits.length ? skill.hits.filter((h) => h.dir === skill.hits[0].dir) : [{ percent: 100 }];
  const total = hits.reduce((s, h) => s + h.percent, 0) || 100;
  const parts = hits.map((h) => Math.floor((dmg * h.percent) / total));
  parts[parts.length - 1] += dmg - parts.reduce((s, p) => s + p, 0);
  const poisonRate = skill.poison + att.stats.poison;
  const stunRate = skill.stun + att.stats.stun;
  return {
    hit,
    crit,
    damage: dmg,
    parts,
    poisoned: poisonRate > 0 && rng.chance(poisonRate),
    stunned: stunRate > 0 && rng.chance(stunRate),
    backstab: rel,
  };
}

/** 防御中闪避了正交相邻的攻击：50% 反击（原版） */
export function canCounter(att: Unit, def: Unit): boolean {
  return def.defending && def.alive && dist(att, def) === 1;
}

/** 击倒敌人掉落的黄金：1 + rand % 上限（上限为 0 时不掉） */
export function killGold(def: Unit, data: GameData, rng: Rng): number {
  const cap = data.classes[def.classId].goldCap;
  return cap > 0 ? 1 + rng.int(cap) : 0;
}
