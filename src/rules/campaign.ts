// 关卡串联：我方人物在关卡之间延续等级、经验、装备与金钱（docs/game-design.md §10）。
import type { Battle } from './battle.ts';

/** 我方一个人物的延续状态（按角色号保存） */
export interface Member {
  classId: number;
  level: number;
  exp: number;
  slots: number[];
}

export interface CampaignState {
  version: 1;
  /** 当前（或下一场要打的）关卡在 EXE 关卡表里的序号 */
  stage: number;
  members: Member[];
  gold: number;
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
 * 路线选择的真正条件还没解开，现在交给玩家选【待核】。
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

/** 关卡开始时套用的我方状态 */
export const partyOf = (c: CampaignState) => new Map(c.members.map((m) => [m.classId, m]));

/** 关卡结束：记下我方人物（含战败的）的等级、经验、装备，加上本关得到的黄金 */
export function recordResult(c: CampaignState, battle: Battle): CampaignState {
  const members = new Map(c.members.map((m) => [m.classId, m]));
  let gold = c.gold;
  for (const u of battle.units) {
    if (u.side !== 'player') continue;
    gold += u.gold;
    members.set(u.classId, { classId: u.classId, level: u.level, exp: u.exp, slots: [...u.slots] });
  }
  return { ...c, members: [...members.values()], gold };
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
