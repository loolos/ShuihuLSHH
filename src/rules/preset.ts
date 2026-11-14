// 测试用跳关【新】：从关卡下拉框直接进某一关时，按那一关的难度重新配好我方人物的等级和装备，
// 免得拿 1 级人物打后期关卡。原版没有这个功能。
// 跳关不沿用之前的任何状态（否则先跳到后期再跳回前面，人物还是后期的等级和装备）；银子也按关卡固定。
import { parseAct, type ActUnit } from '../formats/act.ts';
import { parsePasHeader } from '../formats/pas.ts';
import { adjustEnemies } from './enemy-level.ts';
import { ROUTES, type CampaignState, type Member } from './campaign.ts';
import { canEquip, equipSlotOf, isHealing, itemOf, SLOT_COUNT, type GameData } from './data.ts';
import { findStageFile, type FileSource } from './load.ts';
import { stock } from './town.ts';
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
  const act = findStageFile(files, s.mapName, '.act');
  const pab = findStageFile(files, s.mapName, '.pab');
  return { units: act ? adjustEnemies(s.mapName, parseAct(files.get(act), act)) : [], town: pab ? parsePasHeader(files.get(pab)).town : 0 };
}

/**
 * 跳到第 target 关时的推荐状态：
 * - 我方人物从头配起，之前的等级、经验、装备一概不用；
 * - 等级 = 照常从头打到这一关时这个人的等级（entry-levels.json，由主线期望值估算生成，见 tools/gen-entry-levels.ts）；
 *   表里没有的人（或没有模拟到的关）用这一关敌人的平均等级（foeLevel）；都不低于剧本里写的等级；
 * - 再校验：我方平均等级和这一关敌人平均等级相差不超过 JUMP_LEVEL_GAP（balanceLevels），超过就全员一起升 / 降；
 * - 装备 = 剧本里的初始装备；武器：之前去过的最后一个城镇的武器店里本职业能用的攻击最高的，比它好就换上；
 *   衣服、头饰按 ARMOR_LINE / HEAD_LINE 阶梯取那家店有卖的最后一件（gearFromLine）；
 * - 物品栏补 2 个药铺里回复最多的药；
 * - 技能随等级自动领悟；
 * - 银子 = 打到上一关为止的期望收入 expectedGold（掉钱基数 + 过关奖励，不扣沿途花销），不沿用手上的钱。
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

  const shopIds = town ? stock(data, 1, town) : [];
  /** 目标关是不是已经到了（或过了）地图名为 map 的那一关 */
  const reached = (map: string) => {
    const i = stages.findIndex((s) => s.mapName.toLowerCase() === map);
    return i >= 0 && pos >= i;
  };
  const shop = shopIds.map((id) => itemOf(data, id)!);
  const drugs = town ? stock(data, 3, town) : [];
  const potion = drugs.filter((id) => isHealing(itemOf(data, id))).sort((a, b) => heal(data, b) - heal(data, a))[0];

  const members = new Map<number, Member>();
  const script = new Map<number, number>();
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
    // 衣服、头饰按固定的阶梯配（负责人 2026-11-14），武器仍取武器店里最好的
    for (let k = 1; k < 3; k++) {
      const id = gearFromLine(data, k === 1 ? ARMOR_LINE : HEAD_LINE, shopIds, slots[k], reached);
      if (id !== slots[k]) (slots[k] = id), (forge[k] = 0);
    }
    const atk = (id: number) => itemOf(data, id)?.attack ?? -1;
    const weapon = shop.filter((it) => equipSlotOf(it) === 0 && canEquip(cls, it, data)).sort((a, b) => b.attack - a.attack)[0];
    const wid = weapon ? data.items.indexOf(weapon) + 1 : 0;
    if (wid && atk(wid) > atk(slots[0])) (slots[0] = wid), (forge[0] = 0);
    if (potion) {
      let n = slots.filter((id, k) => k >= 3 && id === potion).length;
      for (let k = 3; k < SLOT_COUNT && n < 2; k++) if (!slots[k]) (slots[k] = potion), (forge[k] = 0), n++;
    }
    members.set(u.type, { classId: u.type, level: Math.max(table[u.type] ?? level, u.level), exp: 0, slots, forge });
    script.set(u.type, u.level);
  }
  balanceLevels([...members.values()], script, foeAverage(stages.length, lpos < 0 ? pos : lpos, (i) => at(i).units));
  // 银子固定为打到上一关为止的期望收入（负责人 2026-11-14），不沿用手上的钱
  return { version: 1, stage: target, gold: pos > 0 ? expectedGold(files, data, stages, pos - 1) : 0, members: [...members.values()] };
}

/** 跳关配的衣服阶梯（负责人 2026-11-14）：戰袍 → 虎皮戰袍 → 金繡綠羅袍 → 綠羅花戰袍（城镇 1 / 2 / 3 / 4 的武器店开始有卖） */
export const ARMOR_LINE = ['戰袍', '虎皮戰袍', '金繡綠羅袍', '綠羅花戰袍'];
/**
 * 跳关配的头饰阶梯（负责人 2026-11-14）：前期遮日黑箬笠（城镇 1 起，移动 +1），
 * 第六章（第一关 N-add08）起紅纓氈笠（移动 +2；城镇 2 就有卖，但负责人要后期才换）。
 * 到过城镇 7（碧雲箬笠开始有卖，第一关 N-add11）之后配碧雲箬笠（移动 +3，负责人 2026-11-14）。
 * 「名称@关卡」表示从那一关起才配。
 */
export const HEAD_LINE = ['遮日黑箬笠', '紅纓氈笠@n-add08', '碧雲箬笠'];

/**
 * 从阶梯 line 里取武器店 shop 有卖、且目标关已经到了 @ 后那一关（reached）的最后一件，换掉剧本装备 current：
 * - 剧本装备是店里买不到的（买价 0，如公孫勝的七星道袍、晁蓋的萬字巾）就留着；
 * - 剧本装备防御更高的留着（衣服；如朱武的鑲銀生鐵甲要到綠羅花戰袍才换）；头饰不比防御，一律换成斗笠；
 * - 店里一件都没有（还没到过城镇）就不换。
 */
export function gearFromLine(data: GameData, line: string[], shop: number[], current: number, reached: (map: string) => boolean = () => true): number {
  const ids = line
    .filter((e) => !e.includes('@') || reached(e.split('@')[1]))
    .map((e) => data.items.findIndex((it) => it.name === e.split('@')[0]) + 1)
    .filter((id) => id > 0 && shop.includes(id));
  const pick = ids.at(-1);
  if (!pick) return current;
  const cur = itemOf(data, current);
  if (cur && !cur.buyPrice) return current;
  if (cur && equipSlotOf(cur) === 1 && cur.defense > itemOf(data, pick)!.defense) return current;
  return pick;
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
 * 第 pos 关 2 级以上敌人（修正后）的平均等级，不取整；全是 1 级摆设的过场关看后面第一场真正的战斗；后面都没有战斗时为 0。
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
 * - 人物和装备按刚打完第 stage 关配：装备只用这个城镇之前的武器店（这个城镇的货留给玩家自己买）；
 * - 等级按城镇之后的下一关 next 配（和直接跳到 next 一样）；
 * - 银子 = 从第一关打到第 stage 关、每个敌人掉钱的基数（上限的一半）与过关奖励之和，
 *   固定这个数，不沿用手上的钱（负责人 2026-11-14）。
 */
export function jumpToTown(files: FileSource, data: GameData, stages: Stage[], stage: number, town: number, next: number, c: CampaignState): CampaignState {
  const pos = stages.findIndex((s) => s.index === stage);
  if (pos < 0) return c;
  const base = jumpTo(files, data, stages, stage, c, { levelFrom: next });
  return { ...base, town, gold: expectedGold(files, data, stages, pos) };
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
