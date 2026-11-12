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

/**
 * 命中率（%）【新】（负责人 2026-11-12）：命中 / (命中 + 守方敏捷/2) × 100 + 技能修正，再乘朝向和防御系数，最高 100。
 * 敌我同一公式、没有保底。原版是"命中 − 敏捷/2"，我方保底 80、其它保底 30（EXE 0x406c60）。
 */
export function hitChance(att: Unit, def: Unit, skill: SkillDef): number {
  const hv = Math.max(1, att.stats.hit);
  let h = Math.max(0, (100 * hv) / (hv + def.stats.agility / 2) + skill.hitMod);
  h *= FACING_FACTOR[facingRelation(facingTowards(att, def, att.facing), def.facing)];
  if (def.defending) h *= 0.7;
  h = Math.floor(h);
  return Math.min(100, h);
}

export function critChance(att: Unit, skill: SkillDef): number {
  return Math.max(0, Math.floor((att.stats.crit + skill.critMod) / 2));
}

/**
 * 伤害公式【新】（负责人 2026-11-12 选，比例公式）：设 A = 攻 + 技能威力，D = 防，
 * 普通伤害 = A² / (A + 2D)；必杀 = 把 A 翻倍再代入 = (2A)² / (2A + 2D)（同原版"先翻倍攻击再减防"的思路）。
 * 防御权重取 2，是为了让前 5 章的伤害与原版相近（负责人要求前期节奏不变）。
 * 原版是 A − D（必杀 2A − D），≤ 0 时改为 10–59 随机（EXE 0x406c60）。防御每级 ×1.10、攻击只有 ×1.04–1.05，
 * 后期攻防都到 255 封顶后普通攻击几乎都落到这个随机数上；比例公式在任何阶段攻防都起作用。
 */
export const DEFENSE_WEIGHT = 2;

export function ratioDamage(a: number, d: number): number {
  return a > 0 ? (a * a) / (a + DEFENSE_WEIGHT * Math.max(0, d)) : 0;
}

/** 不含随机部分的伤害：返回 [普通, 必杀]（未取整） */
export function baseDamage(att: Unit, def: Unit, skill: SkillDef): [number, number] {
  const power = skill.type === 8 || skill.type === 9 || skill.type === 11 ? 0 : skill.power;
  const a = att.stats.attack + power;
  return [ratioDamage(a, def.stats.defense), ratioDamage(2 * a, def.stats.defense)];
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
  hit: boolean; // 至少一段命中
  crit: boolean; // 至少一段必杀
  damage: number; // 总伤害（各段之和）
  parts: number[]; // 多段伤害（落空的段为 0）
  partHit: boolean[];
  partCrit: boolean[];
  poisoned: boolean;
  stunned: boolean;
  backstab: 'back' | 'side' | 'front';
}

/**
 * 一次攻击的结算（不改动单位状态）。forceHit：反击必定命中。
 * 多段攻击【新】（负责人 2026-11-12）：先算出总伤害，按各段比例拆开，每段再单独判定命中和必杀。
 * 原版只判定一次，多段只是把同一次伤害分段显示。
 */
export function rollAttack(att: Unit, def: Unit, skill: SkillDef, rng: Rng, forceHit = false): HitResult {
  const rel = facingRelation(facingTowards(att, def, att.facing), def.facing);
  const hits = skill.hits.length ? skill.hits.filter((h) => h.dir === skill.hits[0].dir) : [{ percent: 100 }];
  const total = hits.reduce((s, h) => s + h.percent, 0) || 100;
  const hitRate = hitChance(att, def, skill);
  const critRate = critChance(att, skill);
  const partHit: boolean[] = [];
  const partCrit: boolean[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = forceHit || rng.chance(hitRate);
    partHit.push(h);
    partCrit.push(h && rng.chance(critRate));
  }
  const hit = partHit.some(Boolean);
  if (!hit) return { hit, crit: false, damage: 0, parts: hits.map(() => 0), partHit, partCrit, poisoned: false, stunned: false, backstab: rel };
  const [n, c] = baseDamage(att, def, skill);
  let k = def.defending ? 0.7 : 1;
  k *= 0.9 + rng.next() * 0.2; // D-9【新】：±10% 浮动（原版无浮动）
  const split = (v: number) => {
    const ps = hits.map((h) => Math.floor((v * h.percent) / total));
    ps[ps.length - 1] += v - ps.reduce((s, p) => s + p, 0);
    return ps;
  };
  const normal = split(Math.max(0, Math.floor(n * k)));
  const critical = split(Math.max(0, Math.floor(c * k)));
  const parts = hits.map((_, i) => (!partHit[i] ? 0 : partCrit[i] ? critical[i] : normal[i]));
  const poisonRate = skill.poison + att.stats.poison;
  const stunRate = skill.stun + att.stats.stun;
  return {
    hit,
    crit: partCrit.some(Boolean),
    damage: parts.reduce((s, p) => s + p, 0),
    parts,
    partHit,
    partCrit,
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
