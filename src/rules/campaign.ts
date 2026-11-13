// 关卡串联：我方人物在关卡之间延续等级、经验、装备与金钱（docs/game-design.md §10）。
import type { Battle } from './battle.ts';

/** 我方一个人物的延续状态（按角色号保存） */
export interface Member {
  classId: number;
  level: number;
  exp: number;
  slots: number[];
  /** 每格道具打铁的次数（旧存档没有） */
  forge?: number[];
}

export interface CampaignState {
  version: 1;
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

/** 关卡结束：记下我方人物（含战败的）的等级、经验、装备，加上本关得到的黄金（击倒掉落 + 过关奖励） */
export function recordResult(c: CampaignState, battle: Battle): CampaignState {
  const members = new Map(c.members.map((m) => [m.classId, m]));
  let gold = c.gold + (battle.status === 'won' ? battle.clearGold : 0);
  const active: number[] = [];
  for (const u of battle.units) {
    if (u.side !== 'player') continue;
    gold += u.gold;
    if (u.present || !u.alive) active.push(u.classId); // 没登场或中途退场（如王進）的不算
    members.set(u.classId, { classId: u.classId, level: u.level, exp: u.exp, slots: [...u.slots], forge: [...u.forge] });
  }
  return { ...c, members: [...members.values()], gold, active };
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
