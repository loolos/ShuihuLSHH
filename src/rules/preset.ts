import { levelKit } from './equipment.ts';
// 测试用跳关【新】：从关卡下拉框直接进某一关时，按那一关的难度重新配好我方人物的等级和装备，
// 免得拿 1 级人物打后期关卡。原版没有这个功能。
// 跳关不沿用之前的任何状态（否则先跳到后期再跳回前面，人物还是后期的等级和装备）；银子也按关卡固定。
import type { ActUnit } from '../formats/act.ts';
import { stageUnits as jsonUnits } from '../formats/stage-json.ts';
import { ROUTES, startingParty, type CampaignState, type Member } from './campaign.ts';
import { SLOT_COUNT, type GameData } from './data.ts';
import { stageJson, type FileSource } from './load.ts';
import { goldBase, stageClearGold } from './gold.ts';
import entryLevels from '../data/entry-levels.json' with { type: 'json' };

/** 主线估算得出的每关入场等级：关卡名（小写）→ 角色号 → 等级（tools/gen-entry-levels.ts 生成） */
const ENTRY_LEVELS: Record<string, Record<string, number>> = entryLevels.levels;

/** 城镇按游戏进度的先后（道具 +146 城镇号表的排列顺序；6 与 12 是两条路线上的同一站） */
export const TOWN_ORDER = [1, 2, 3, 4, 5, 13, 6, 12, 7, 8, 9, 10, 11];

interface Stage {
  index: number;
  mapName: string;
}

function readStage(files: FileSource, s: Stage): { units: ActUnit[]; town: number } {
  const j = stageJson(files, s.mapName);
  return { units: j ? jsonUnits(j) : [], town: j?.header.town ?? 0 };
}

/**
 * 跳到第 target 关时的推荐状态：
 * - 我方人物从头配起，之前的等级、经验、装备一概不用；
 * - 等级 = 照常从头打到这一关时这个人的等级（entry-levels.json，由主线期望值估算生成，见 tools/gen-entry-levels.ts）；
 *   表里没有的人（或没有模拟到的关）用这一关敌人的平均等级（foeLevel）；都不低于剧本里写的等级；
 * - 再校验：我方平均等级和这一关敌人平均等级相差不超过 JUMP_LEVEL_GAP（balanceLevels），超过就全员一起升 / 降；
 * - 装备与药品：等级平衡完成后，按 equipment.ts 的人物类别和等级表生成；
 * - 技能随等级自动领悟；
 * - 银子 = 打到上一关为止的期望收入 expectedGold（掉钱基数 + 过关奖励，不扣沿途花销），不沿用手上的钱。
 */
export function jumpTo(files: FileSource, data: GameData, stages: Stage[], target: number, c: CampaignState, opts: { levelFrom?: number; partyFrom?: number } = {}): CampaignState {
  const pos = stages.findIndex((s) => s.index === target);
  if (pos < 0) return c;
  const info = new Map<number, ReturnType<typeof readStage>>();
  const at = (i: number) => info.get(i) ?? info.set(i, readStage(files, stages[i])).get(i)!;

  // 进城镇时人物按城镇之后那一关的难度配等级
  const lpos = opts.levelFrom === undefined ? pos : stages.findIndex((s) => s.index === opts.levelFrom);
  const lstage = stages[lpos < 0 ? pos : lpos];
  const table = ENTRY_LEVELS[lstage.mapName.toLowerCase()] ?? {};
  const level = foeLevel(stages.length, lpos < 0 ? pos : lpos, (i) => at(i).units);
  const members = new Map<number, Member>();
  const script = new Map<number, number>();
  // 没有我方出场的过场（如 Act13-1 之后进城镇 9）用城镇之后那一关的人
  const hasParty = (i: number) => at(i).units.some((u) => u.side === 'player');
  // 进城镇时人物取城镇之后那一关开局在场的人（townRoster），不取进城前那一关（可能是剧情关，带着客串的人）
  const ppos = opts.partyFrom === undefined ? -1 : stages.findIndex((s) => s.index === opts.partyFrom);
  const from = ppos >= 0 ? ppos : hasParty(pos) || lpos < 0 ? pos : lpos;
  const roster = ppos >= 0 ? startingParty(at(from).units) : null;
  for (const u of at(from).units) {
    if (u.side !== 'player' || !data.classes[u.type] || (roster && !roster.includes(u.type))) continue;
    const cls = data.classes[u.type];
    const slots = cls.defaultItems.slice(0, SLOT_COUNT);
    u.items.forEach((id, k) => id && (slots[k] = id));
    while (slots.length < SLOT_COUNT) slots.push(0);
    const forge = slots.map(() => 0);

    members.set(u.type, { classId: u.type, level: table[u.type] ?? Math.max(level,u.level), exp: 0, slots, forge });
    script.set(u.type, u.level);
  }
  // 已有整条主线的经验估算预设时不再被旧敌人绝对等级反向压低。
  if (!Object.keys(table).length) balanceLevels([...members.values()], script, foeAverage(stages.length, lpos < 0 ? pos : lpos, (i) => at(i).units));
  for (const m of members.values()) levelKit(data, data.classes[m.classId], m.level, m.slots);
  // 银子固定为打到上一关为止的期望收入（负责人 2026-11-14），不沿用手上的钱
  return { version: 1, stage: target, gold: pos > 0 ? expectedGold(files, data, stages, pos - 1) : 0, members: [...members.values()] };
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

/** 跳关时我方平均等级和敌人平均等级最多差几级（负责人 2026-11-13） */
export const JUMP_LEVEL_GAP = 2;

/**
 * 第 pos 关 2 级以上敌人（自有配置的）的平均等级，不取整；全是 1 级摆设的过场关看后面第一场真正的战斗；后面都没有战斗时为 0。
 */
export function foeAverage(count: number, pos: number, units: (i: number) => ActUnit[]): number {
  for (let i = pos; i < count; i++) {
    const foes = units(i).filter((u) => u.side === 'enemy' && u.level > 1);
    if (foes.length) return foes.reduce((a, u) => a + u.level, 0) / foes.length;
  }
  return 0;
}

/**
 * 跳关等级校验【新】（负责人 2026-11-13）：我方平均等级和敌人平均等级 foe 相差超过 JUMP_LEVEL_GAP 时，
 * 全员一起升 / 降，直到差距不超过 JUMP_LEVEL_GAP；每人不低于剧本等级 script（剧本等级卡住时可能仍差得多）。
 */
export function balanceLevels(members: Member[], script: Map<number, number>, foe: number): void {
  if (!foe || !members.length) return;
  const avg = () => members.reduce((a, m) => a + m.level, 0) / members.length;
  for (let guard = 0; guard < 100; guard++) {
    const d = avg() - foe;
    if (Math.abs(d) <= JUMP_LEVEL_GAP + 1e-9) return;
    const step = d > 0 ? -1 : 1;
    let moved = false;
    for (const m of members) {
      const lv = Math.max(script.get(m.classId) ?? 1, 1, m.level + step);
      if (lv !== m.level) (m.level = lv), (moved = true);
    }
    if (!moved) return;
  }
}

/** 第 i 关的 ACT 单位（生成入场等级表用） */
export const stageUnits = (files: FileSource, s: Stage) => readStage(files, s).units;

/**
 * 测试用：直接进第 stage 关之后的城镇 town（关卡下拉框里的「城镇」项，或网址 `?stage=town:<关卡名>`）。
 * - 人物 = 城镇整备名单（城镇之后那一关开局在场的人，townRoster），active 也设成它；
 * - 装备和药品也按下一关的人物等级配，不再依赖城镇商店；
 * - 等级按城镇之后的下一关 next 配（和直接跳到 next 一样）；
 * - 银子 = 从第一关打到第 stage 关、每个敌人掉钱的基数（上限的一半）与过关奖励之和，
 *   固定这个数，不沿用手上的钱（负责人 2026-11-14）。
 */
export function jumpToTown(files: FileSource, data: GameData, stages: Stage[], stage: number, town: number, next: number, c: CampaignState): CampaignState {
  const pos = stages.findIndex((s) => s.index === stage);
  if (pos < 0) return c;
  const base = jumpTo(files, data, stages, stage, c, { levelFrom: next, partyFrom: next });
  const n = stages.find((s) => s.index === next);
  return { ...base, town, gold: expectedGold(files, data, stages, pos), active: n ? townRoster(files, n.mapName) : undefined };
}

/** 城镇整备名单：城镇之后那一关（mapName）开局在场的我方角色号（startingParty） */
export const townRoster = (files: FileSource, mapName: string): number[] => startingParty(readStage(files, { index: -1, mapName }).units);

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
