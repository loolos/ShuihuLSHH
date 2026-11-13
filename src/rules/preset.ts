// 测试用跳关【新】：从关卡下拉框直接进某一关时，按那一关的难度重新配好我方人物的等级和装备，
// 免得拿 1 级人物打后期关卡。原版没有这个功能。
// 跳关不沿用之前的人物状态（否则先跳到后期再跳回前面，人物还是后期的等级和装备），只保留银子。
import { parseAct, type ActUnit } from '../formats/act.ts';
import { parsePasHeader } from '../formats/pas.ts';
import { adjustEnemies } from './enemy-level.ts';
import { ROUTES, type CampaignState, type Member } from './campaign.ts';
import { canEquip, equipSlotOf, isHealing, itemOf, SLOT_COUNT, type GameData } from './data.ts';
import { findStageFile, type FileSource } from './load.ts';
import { stock } from './town.ts';
import { goldBase, stageClearGold } from './gold.ts';
import entryLevels from '../data/entry-levels.json' with { type: 'json' };

/** 主线模拟得出的每关入场等级：关卡名（小写）→ 角色号 → 等级（tools/gen-entry-levels.ts 生成） */
const ENTRY_LEVELS: Record<string, Record<string, number>> = entryLevels.levels;

/** 城镇按游戏进度的先后（道具 +146 城镇号表的排列顺序；6 与 12 是两条路线上的同一站） */
export const TOWN_ORDER = [1, 2, 3, 4, 5, 13, 6, 12, 7, 8, 9, 10, 11];

interface Stage {
  index: number;
  mapName: string;
}

function readStage(files: FileSource, s: Stage): { units: ActUnit[]; town: number } {
  const act = findStageFile(files, s.mapName, '.act');
  const pab = findStageFile(files, s.mapName, '.pab');
  return { units: act ? adjustEnemies(s.mapName, parseAct(files.get(act), act)) : [], town: pab ? parsePasHeader(files.get(pab)).town : 0 };
}

/**
 * 跳到第 target 关时的推荐状态：
 * - 我方人物从头配起，之前的等级、经验、装备一概不用；
 * - 等级 = 照常从头打到这一关时这个人的等级（entry-levels.json，由主线模拟生成，见 tools/gen-entry-levels.ts）；
 *   表里没有的人（或没有模拟到的关）用这一关敌人的平均等级（foeLevel）；都不低于剧本里写的等级；
 * - 装备 = 剧本里的初始装备；之前去过的最后一个城镇的武器店里，本职业能用的攻击最高的武器、防御最高的衣服和头饰比它好就换上；
 * - 物品栏补 2 个药铺里回复最多的药；
 * - 技能随等级自动领悟。
 */
export function jumpTo(files: FileSource, data: GameData, stages: Stage[], target: number, c: CampaignState, opts: { levelFrom?: number } = {}): CampaignState {
  const pos = stages.findIndex((s) => s.index === target);
  if (pos < 0) return c;
  const info = new Map<number, ReturnType<typeof readStage>>();
  const at = (i: number) => info.get(i) ?? info.set(i, readStage(files, stages[i])).get(i)!;

  // 进城镇时人物按城镇之后那一关的难度配等级
  const lpos = opts.levelFrom === undefined ? pos : stages.findIndex((s) => s.index === opts.levelFrom);
  const lstage = stages[lpos < 0 ? pos : lpos];
  const table = ENTRY_LEVELS[lstage.mapName.toLowerCase()] ?? {};
  const level = foeLevel(stages.length, lpos < 0 ? pos : lpos, (i) => at(i).units);
  let town = 0;
  for (let i = 0; i < pos; i++) {
    const t = at(i).town;
    if (t && TOWN_ORDER.indexOf(t) > TOWN_ORDER.indexOf(town)) town = t;
  }

  const shop = town ? stock(data, 1, town).map((id) => itemOf(data, id)!) : [];
  const drugs = town ? stock(data, 3, town) : [];
  const potion = drugs.filter((id) => isHealing(itemOf(data, id))).sort((a, b) => heal(data, b) - heal(data, a))[0];

  const members = new Map<number, Member>();
  // 没有我方出场的过场（如 Act13-1 之后进城镇 9）用城镇之后那一关的人
  const hasParty = (i: number) => at(i).units.some((u) => u.side === 'player');
  const from = hasParty(pos) || lpos < 0 ? pos : lpos;
  for (const u of at(from).units) {
    if (u.side !== 'player' || !data.classes[u.type]) continue;
    const cls = data.classes[u.type];
    const slots = cls.defaultItems.slice(0, SLOT_COUNT);
    u.items.forEach((id, k) => id && (slots[k] = id));
    while (slots.length < SLOT_COUNT) slots.push(0);
    const forge = slots.map(() => 0);
    for (let k = 0; k < 3; k++) {
      const score = (id: number) => {
        const it = itemOf(data, id);
        return it ? (k === 0 ? it.attack : it.defense) : -1;
      };
      const best = shop.filter((it) => equipSlotOf(it) === k && canEquip(cls, it, data)).sort((a, b) => (k === 0 ? b.attack - a.attack : b.defense - a.defense))[0];
      if (!best) continue;
      const id = data.items.indexOf(best) + 1;
      if (score(id) > score(slots[k])) {
        slots[k] = id;
        forge[k] = 0;
      }
    }
    if (potion) {
      let n = slots.filter((id, k) => k >= 3 && id === potion).length;
      for (let k = 3; k < SLOT_COUNT && n < 2; k++) if (!slots[k]) (slots[k] = potion), (forge[k] = 0), n++;
    }
    members.set(u.type, { classId: u.type, level: Math.max(table[u.type] ?? level, u.level), exp: 0, slots, forge });
  }
  return { version: 1, stage: target, gold: c.gold, members: [...members.values()] };
}

/**
 * 第 pos 关敌人的平均等级（四舍五入）；敌人全是 1 级的过场关看后面第一场真正的战斗；后面都没有战斗时为 1。
 * units(i) 给出第 i 关的 ACT 单位。
 */
export function foeLevel(count: number, pos: number, units: (i: number) => ActUnit[]): number {
  for (let i = pos; i < count; i++) {
    const foes = units(i).filter((u) => u.side === 'enemy');
    if (!foes.some((u) => u.level > 1)) continue; // 过场关的敌人都是 1 级摆设
    return Math.round(foes.reduce((a, u) => a + u.level, 0) / foes.length);
  }
  return 1;
}

/** 第 i 关的 ACT 单位（生成入场等级表用） */
export const stageUnits = (files: FileSource, s: Stage) => readStage(files, s).units;

/**
 * 测试用：直接进第 stage 关之后的城镇 town（关卡下拉框里的「城镇」项，或网址 `?stage=town:<关卡名>`）。
 * - 人物和装备按刚打完第 stage 关配：装备只用这个城镇之前的武器店（这个城镇的货留给玩家自己买）；
 * - 等级按城镇之后的下一关 next 配（和直接跳到 next 一样）；
 * - 银子 = 从第一关打到第 stage 关、每个敌人掉钱的基数（上限的一半）与过关奖励之和，
 *   手上的银子更多就保留。
 */
export function jumpToTown(files: FileSource, data: GameData, stages: Stage[], stage: number, town: number, next: number, c: CampaignState): CampaignState {
  const pos = stages.findIndex((s) => s.index === stage);
  if (pos < 0) return c;
  const base = jumpTo(files, data, stages, stage, c, { levelFrom: next });
  return { ...base, town, gold: Math.max(c.gold, expectedGold(files, data, stages, pos)) };
}

/** 打到第 pos 关（含）为止，敌人掉钱的期望加过关奖励的总和；分路的两关只算一条（目标在小径上就算小径，否则算大道） */
export function expectedGold(files: FileSource, data: GameData, stages: Stage[], pos: number): number {
  const target = stages[pos].index;
  const skip = new Set(Object.values(ROUTES).map((r) => (target === r.alt ? r.alt - 1 : r.alt)));
  let sum = 0;
  for (let i = 0; i <= pos; i++) {
    if (skip.has(stages[i].index)) continue;
    const units = readStage(files, stages[i]).units;
    for (const u of units) if (u.side === 'enemy') sum += goldBase(data, u.type);
    if (units.some((u) => u.side === 'player')) sum += stageClearGold(stages[i].mapName);
  }
  return Math.round(sum);
}

const heal = (data: GameData, id: number) => {
  const it = itemOf(data, id)!;
  return it.healHp < 0 ? 999 : it.healHp;
};
