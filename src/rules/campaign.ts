// 关卡串联：我方人物在关卡之间延续等级、经验、装备与金钱（docs/game-design.md §10）。
import type { Battle } from './battle.ts';
import type { ActUnit } from '../formats/act.ts';

/** 我方一个人物的延续状态（按角色号保存） */
export interface Member {
  classId: number;
  level: number;
  exp: number;
  slots: number[];
  /** 每格道具打铁的次数（旧存档没有） */
  forge?: number[];
  /** 原版好汉携带包道具时也保留稳定道具键。 */
  itemKeys?: Record<number, string>;
}

export interface CampaignState {
  version: 1;
  /** 包人物以稳定的包/职业id保存，装备也不依赖运行时编号。 */
  companions?: Record<string, Omit<Member, "classId" | "slots"> & { slots: (number | string)[] }>;
  /** 续篇城镇：不借原版下一关推算名单或去向。 */
  insertTown?: { pack: string; next: string; seen: boolean; town: number };
  /** 当前（或下一场要打的）关卡在 EXE 关卡表里的序号 */
  stage: number;
  members: Member[];
  gold: number;
  /** 正在城镇里（过关后、去下一关之前），值为城镇号 1–13；存档时也记下，读档回到城镇 */
  town?: number;
  /** 上一关出场的我方角色号（整备、买东西只列这些人；旧存档没有时列全部） */
  active?: number[];
  /** 已领过礼物的说书（src/rules/storyteller.ts 的故事 id）【新】 */
  tales?: string[];
  /** 主线插关 / 续篇（docs/game-design.md §15.8、§15.10）：当前要演的段落（<包>/<关卡>） */
  insert?: string;
  /** 全新存档直接选主线插关：仅本次载入使用完整流程推荐等级。 */
  insertPreset?: string;
  /** 已经打过的插关（<包>/<关卡>），读档、重进不再重复 */
  inserts?: string[];
  /** 主线已经通关；重载时显示通关画面而不是重打最后一关 */
  finished?: boolean;
}

export interface StageEntry {
  index: number;
  mapName: string;
  title: string;
}

export const newCampaign = (stage = 0): CampaignState => ({ version: 1, stage, members: [], gold: 0 });

const isBattle = (s: StageEntry) => !/^act/i.test(s.mapName);

/**
 * 当前关卡之后可以进入的关卡（按 EXE 里关卡表的顺序）：
 * - 跳过空位；
 * - 表里相邻两项标题相同且都是战役时，是二选一的路线（如 14/15 N-add04a/b），返回两项；
 * - 从这样的一条路线出来时跳过它的另一条。
 * 只在关卡没有剧本头时用；有剧本头时用 nextByHeader。
 */
export function nextStages<T extends StageEntry>(stages: T[], current: number): T[] {
  const list = stages.filter((s) => s.mapName);
  const pos = list.findIndex((s) => s.index === current);
  if (pos < 0) return [];
  const cur = list[pos];
  let i = pos + 1;
  const sibling = (a: T | undefined, b: T | undefined) => !!a && !!b && a.title === b.title && isBattle(a) && isBattle(b);
  while (i < list.length && sibling(cur, list[i]) && list[i].index === list[i - 1].index + 1) i++;
  const a = list[i];
  if (!a) return [];
  const b = list[i + 1];
  return sibling(a, b) && b.index === a.index + 1 ? [a, b] : [a];
}

/**
 * 分路（EXE 0x418c60 → 0x418bd0 → 0x413650，答案处理 0x4138b9）：离开城镇 2（Act3-4 之后）问对话框 1，
 * 离开城镇 5（N07 之后）问对话框 2。选第一项「大道」照剧本头的下一关走（14 N-add04a / 41 N-add09a），
 * 选第二项「小徑」时 EXE 直接载入写死的关卡 15（N-add04b）/ 42（N-add09b）（0x401660(0xf) / (0x2a)）。
 */
export const ROUTES: Record<number, { prompt: number; alt: number }> = {
  2: { prompt: 1, alt: 15 },
  5: { prompt: 2, alt: 42 },
};

/** 剧本头决定的下一关；城镇 2、5 还要问分路（返回对话框序号与小径关卡） */
export function nextByHeader(header: { town: number; next: number }): { next: number; route?: { prompt: number; alt: number } } {
  return { next: header.next, route: ROUTES[header.town] };
}

/**
 * 城镇整备名单（docs/game-design.md §7.5.1）：城镇之后那一关开局就在场的我方人物（ACT 里我方、不隐藏、不埋伏、不摆在场外），按角色号去重。
 * 不用"上一关出场的人"：进城前那一关常是剧情关，名单不全或带着客串的人（如 Act11-2 只剩宋江，城镇 8 一个好汉都不列）。
 */
export function startingParty(units: ActUnit[]): number[] {
  const ids: number[] = [];
  for (const u of units) {
    const mode = u.flags >> 8;
    if (u.side !== 'player' || u.flags & 0xff || mode === 6 || mode === 7 || mode === 9 || (!u.x && !u.y)) continue;
    if (!ids.includes(u.type)) ids.push(u.type);
  }
  return ids;
}

/** 关卡开始时套用的我方状态 */
export const partyOf = (c: CampaignState) => new Map(c.members.map((m) => [m.classId, m]));

/**
 * 新入伙的人的入队等级【新】（负责人 2026-11-13）：当前队伍（上一关出场的人；旧存档没有记录时用全部人物）的平均等级，四舍五入。
 * 还没有队伍时为 0（照剧本等级）。Battle 里再和剧本等级取较高者。
 */
export function joinLevel(c: CampaignState): number {
  const active = c.active ? c.members.filter((m) => c.active!.includes(m.classId)) : c.members;
  const list = active.length ? active : c.members;
  return list.length ? Math.round(list.reduce((a, m) => a + m.level, 0) / list.length) : 0;
}

/**
 * 关卡结束：记下我方人物（含战败的）的等级、经验、装备，加上本关得到的银子（击倒掉落 + 过关奖励）。
 * keepActive（主线插关只出场几个人）：出场名单并进上一关的名单，城镇里不会只列这几个人
 * classLimit：职业号不小于它的我方单位（扩展包职业，如续篇里的宋江、武松）不记进梁山名单
 */
export function recordResult(c: CampaignState, battle: Battle, opts: { keepActive?: boolean; classLimit?: number } = {}): CampaignState {
  const members = new Map(c.members.map((m) => [m.classId, m]));
  const itemKeys = Object.assign({}, ...c.members.map(m=>m.itemKeys ?? {})) as Record<number, string>;
  let gold = c.gold + (battle.status === 'won' ? battle.clearGold : 0);
  const active: number[] = [];
  const benched = new Set(battle.benchedUids);
  for (const u of battle.units) {
    if (u.side !== 'player') continue;
    gold += u.gold;
    if (opts.classLimit !== undefined && u.classId >= opts.classLimit) continue;
    // 没登场或中途退场（如王進）的不算；选人关没被选上的人只是这一关不出战，仍在队里
    if (u.present || !u.alive || benched.has(u.uid)) active.push(u.classId);
    const slots = [...u.slots], forge = [...u.forge];
    for (const [k, gear] of Object.entries(u.storyGear ?? {})) { slots[Number(k)] = gear.item; forge[Number(k)] = gear.forge; }
    members.set(u.classId, { classId: u.classId, level: u.level, exp: u.exp, slots, forge, itemKeys: Object.fromEntries(slots.filter(id=>itemKeys[id]).map(id=>[id,itemKeys[id]])) });
  }
  // 没有我方出场的过场（如 Act13-1 只有官军）沿用上一关的出场名单，免得城镇里一个人都不列
  if (opts.keepActive && c.active) for (const id of c.active) if (!active.includes(id)) active.push(id);
  return { ...c, members: [...members.values()], gold, active: active.length ? active : c.active };
}

/** 主线插关的登记：ref = <包>/<关卡>，before = 插在哪一关（原版地图名）前面 */
export interface InsertEntry {
  ref: string;
  before?: string;
  after?: string;
}

/**
 * 要进 mapName 这一关前 / 之后，还没打过的插关（同一位置有多个时按登记顺序来）。
 * from = 刚打完的插关：严格接它后面的下一段，不受旧通关标记影响（不回头补前一段）。
 */
export function pendingInsert(c: CampaignState, list: InsertEntry[], mapName: string, position: 'before' | 'after' = 'before', from?: string): string | undefined {
  const done = new Set(c.inserts ?? []);
  const start = from === undefined ? 0 : list.findIndex((e) => e.ref === from) + 1;
  return list.slice(start).find((e) => e[position]?.toLowerCase() === mapName.toLowerCase() && (from !== undefined || !done.has(e.ref)))?.ref;
}

/** 选关重玩时重置本段及后续插关标记，保留此前进度和所有人物资产。 */
export function replayInsertProgress(c: CampaignState, list: InsertEntry[], ref: string): string[] {
  const index = list.findIndex((e) => e.ref === ref);
  if (index < 0) return c.inserts ?? [];
  const replay = new Set(list.slice(index).map((e) => e.ref));
  return (c.inserts ?? []).filter((r) => !replay.has(r));
}

/** 读取存档（坏档返回 null） */
export function parseCampaign(text: string | null): CampaignState | null {
  if (!text) return null;
  try {
    const c = JSON.parse(text) as CampaignState;
    if (c?.version !== 1 || typeof c.stage !== 'number' || !Array.isArray(c.members)) return null;
    return c;
  } catch {
    return null;
  }
}

/** 选关可调整等级，但已有资产优先；无记录才采用试玩初始化。 */
export function inheritAssets(previous: CampaignState, recommended: CampaignState): CampaignState {
  if (!previous.members.length && !Object.keys(previous.companions ?? {}).length) return recommended;
  const members = new Map(previous.members.map(m=>[m.classId,m]));
  for (const m of recommended.members) {
    const kept = members.get(m.classId);
    members.set(m.classId, kept ? { ...m, slots: [...kept.slots], forge: kept.forge ? [...kept.forge] : undefined, itemKeys: kept.itemKeys } : m);
  }
  return { ...previous, ...recommended, members: [...members.values()], gold: previous.gold, companions: previous.companions, insertTown: undefined };
}
