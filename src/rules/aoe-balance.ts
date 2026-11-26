// 群伤技能审查定值：仅原版好汉职业生效，不改敌方同模型与原始 HUM。
import type { SkillDef } from './data.ts';
import { Board } from './board.ts';
import { areaCells, castCells } from './skills.ts';

export const HERO_AOE_COSTS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  0: {
    4: 50, // 千軍萬馬LV1
    5: 75, // 千軍萬馬LV2
    6: 110, // 千軍萬馬LV3
    1310: 150, // 千軍萬馬LV4
    1312: 190, // 千軍萬馬LV5
    10: 75, // 萬夫莫敵LV1
    11: 115, // 萬夫莫敵LV2
    12: 170, // 萬夫莫敵LV3
    1309: 210, // 萬夫莫敵LV4
    1314: 250, // 萬夫莫敵LV5
  },
  2: {
    21: 75, // 天雷滅敵正法
    22: 170, // 回風返火破陣
    23: 105, // 蒼風破軍正法
    24: 105, // 風雷天罡正法
    28: 75, // 五雷咒LV1
    29: 120, // 五雷咒LV2
    30: 190, // 五雷咒LV3
  },
  3: {
    37: 50, // 天龍出雲LV1
    38: 75, // 天龍出雲LV2
    39: 95, // 天龍出雲LV3
    42: 65, // 狂龍出海LV1
    43: 90, // 狂龍出海LV2
    44: 130, // 狂龍出海LV3
  },
  4: {
    1212: 60, // 撒钉封路
  },
  5: {
    60: 75, // 奇門遁甲LV1
    61: 90, // 奇門遁甲LV2
    62: 115, // 奇門遁甲LV3
    1208: 75, // 破阵飞石
    1209: 80, // 截阵连锋
  },
  7: {
    70: 80, // 天羅地網LV2
    71: 105, // 天羅地網LV3
    1200: 75, // 分水穿浪
  },
  8: {
    76: 60, // 翻江倒海LV1
    77: 80, // 翻江倒海LV2
    78: 105, // 翻江倒海LV3
  },
  9: {
    83: 60, // 怒海狂濤LV1
    84: 80, // 怒海狂濤LV2
    85: 105, // 怒海狂濤LV3
    1201: 80, // 横江拍浪
  },
  11: {
    101: 55, // 鏟惡除奸LV1
    102: 100, // 鏟惡除奸LV2
    103: 135, // 鏟惡除奸LV3
    1311: 175, // 鏟惡除奸LV4
    1211: 100, // 回马扫阵
    1003: 70, // 風雪交加
    1002: 60, // 懷璧其罪LV3（前方三格）
    1009: 75, // 懷璧其罪LV4（前方三格）
  },
  12: {
    107: 75, // 天王托塔LV1
    108: 100, // 天王托塔LV2
    109: 120, // 天王托塔LV3
    110: 140, // 天王托塔LV4
    111: 160, // 天王托塔LV5
    1213: 105, // 天王震岳
  },
  13: {
    1202: 70, // 跳涧飞枪
    1203: 85, // 猛虎摆尾
    1282: 70, // 跳涧飞枪·左折
  },
  14: {
    125: 60, // 一刀兩斷LV1
    126: 100, // 一刀兩斷LV2
    127: 135, // 一刀兩斷LV3
    1205: 85, // 青面飞刃
  },
  15: {
    1206: 60, // 蛇影分锋
    1207: 70, // 游蛇追命
    1287: 70, // 游蛇追命·左折
  },
  16: {
    140: 70, // 萬佛朝宗LV1
    141: 110, // 萬佛朝宗LV2
    142: 165, // 萬佛朝宗LV3
    1210: 105, // 伏虎震杖
  },
  17: {
    149: 80, // 鬼哭神號LV2
    150: 105, // 鬼哭神號LV3
    1204: 95, // 赤发断魂
  },
};

export function balanceHeroAoe(classId: number, skill: SkillDef): SkillDef {
  const mpCost = HERO_AOE_COSTS[classId]?.[skill.skillId];
  const hit = classId === 9 && skill.skillId === 84 ? { hitMod: 15 } : {};
  return mpCost === undefined ? skill : { ...skill, mpCost, ...hit };
}

/** 一招最多能罩住几格（在空地上试遍所有施放点，不算装备射程） */
export function aoeCellCount(s: SkillDef): number {
  const b = new Board(41, 41), at = { x: 20, y: 20 };
  let best = 0;
  for (const c of castCells(b, at, [s.rangeMin, Math.max(s.rangeMin, s.rangeMax)], s.targetShape)) best = Math.max(best, areaCells(b, at, s, c).length);
  return best;
}

/** 大范围技能上限（负责人 2026-11-26：范围太大、加成又多的技能清兵太猛）：25 格以上威力 ≤ 60、命中 / 必杀加成各 ≤ +10、最多 2 段；40 格以上威力 ≤ 50 */
export const AOE_CAP = { cells: 25, power: 60, hitMod: 10, critMod: 10, hits: 2, wideCells: 40, widePower: 50 };
/** 不受上限的：武龍 萬夫莫敵（负责人 2026-11-26 单独定了威力 55、必杀 +20、LV5 三段） */
const AOE_CAP_EXEMPT = new Set(['0:10', '0:11', '0:12', '0:1309', '0:1314']);

/** 好汉的大范围攻击技按 AOE_CAP 封顶；集气、回复、增益技不管 */
export function capHeroAoe(classId: number, s: SkillDef): SkillDef {
  if (s.type === 8 || s.type === 9 || s.type === 11 || s.power <= 0 || s.healRegen || AOE_CAP_EXEMPT.has(`${classId}:${s.skillId}`)) return s;
  const cells = aoeCellCount(s);
  if (cells < AOE_CAP.cells) return s;
  const power = Math.min(s.power, cells >= AOE_CAP.wideCells ? AOE_CAP.widePower : AOE_CAP.power);
  const hitMod = Math.min(s.hitMod, AOE_CAP.hitMod), critMod = Math.min(s.critMod, AOE_CAP.critMod);
  let hits = s.hits;
  // 只有一个方向的多段才合并（迴旋技各方向的分段另算）；留第一段和最后一段的帧，各 50%
  if (hits.length > AOE_CAP.hits && hits.every((h) => h.dir === hits[0].dir))
    hits = [{ ...hits[0], percent: 50 }, { ...hits[hits.length - 1], percent: 50 }];
  if (power === s.power && hitMod === s.hitMod && critMod === s.critMod && hits === s.hits) return s;
  return { ...s, power, hitMod, critMod, hits };
}
