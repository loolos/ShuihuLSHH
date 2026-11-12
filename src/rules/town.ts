// 城镇与整备：买、典当、打铁、给予、装备、丢弃（docs/game-design.md §7.5）。
// 全部是对 CampaignState 的纯函数，返回新的状态和一句提示；界面在 src/game/town.ts。
import type { CampaignState, Member } from './campaign.ts';
import { canEquip, equipSlotOf, forgeLimit, itemOf, SLOT_COUNT, type GameData } from './data.ts';
import type { Item } from '../formats/goo.ts';

/**
 * 五家店（菜单顺序 = EXE 0x44392c 店名表）。可买的货 = 道具 +1 大类等于店序号 + 1、
 * 且 +146 起的城镇号表含本城镇的道具（EXE 0x414a40）。打铁铺没有货（大类 3 没有道具）。
 */
export const SHOPS = [
  { key: 'inn', actions: ['talk', 'buy', 'items'] },
  { key: 'weapon', actions: ['buy', 'items'] },
  { key: 'smith', actions: ['forge', 'items'] },
  { key: 'drug', actions: ['buy', 'items'] },
  { key: 'pawn', actions: ['pawn', 'buy', 'items'] },
] as const;
export type ShopAction = (typeof SHOPS)[number]['actions'][number];

export const stock = (data: GameData, shop: number, town: number): number[] =>
  data.items.flatMap((it, i) => (it.category === shop + 1 && it.buyPrice > 0 && it.seqA.includes(town) ? [i + 1] : []));

export interface Outcome {
  c: CampaignState;
  ok: boolean;
  text: string;
}

const fail = (c: CampaignState, text: string): Outcome => ({ c, ok: false, text });

function edit(c: CampaignState, classId: number, f: (m: Required<Member>) => void): CampaignState {
  return {
    ...c,
    members: c.members.map((m) => {
      if (m.classId !== classId) return m;
      const n = { ...m, slots: [...m.slots], forge: m.slots.map((_, k) => m.forge?.[k] ?? 0) };
      while (n.slots.length < SLOT_COUNT) n.slots.push(0), n.forge.push(0);
      f(n);
      return n;
    }),
  };
}

const memberOf = (c: CampaignState, classId: number) => c.members.find((m) => m.classId === classId);

/** 随身物品的空格（第 4–7 格）；装备栏空着且道具能装上时优先放进装备栏 */
function freeSlot(m: Member, it: Item | undefined, data: GameData): number {
  const k = equipSlotOf(it);
  if (k >= 0 && !m.slots[k] && canEquip(data.classes[m.classId], it, data)) return k;
  for (let i = 3; i < SLOT_COUNT; i++) if (!m.slots[i]) return i;
  return -1;
}

export function buy(c: CampaignState, data: GameData, classId: number, id: number): Outcome {
  const it = itemOf(data, id), m = memberOf(c, classId);
  if (!it || !m) return fail(c, '');
  if (c.gold < it.buyPrice) return fail(c, '金錢不夠！');
  const k = freeSlot(m, it, data);
  if (k < 0) return fail(c, `${data.charNames[classId]}的道具已滿。`);
  return {
    ok: true,
    text: `買了${it.name}，交給${data.charNames[classId]}。`,
    c: { ...edit(c, classId, (n) => ((n.slots[k] = id), (n.forge[k] = 0))), gold: c.gold - it.buyPrice },
  };
}

/** 典当：按道具表 +144 的卖价收钱 */
export function pawn(c: CampaignState, data: GameData, classId: number, slot: number): Outcome {
  const m = memberOf(c, classId), it = itemOf(data, m?.slots[slot] ?? 0);
  if (!m || !it) return fail(c, '');
  return {
    ok: true,
    text: `典當了${it.name}，得到黃金 ${it.sellPrice} 兩。`,
    c: { ...edit(c, classId, (n) => ((n.slots[slot] = 0), (n.forge[slot] = 0))), gold: c.gold + it.sellPrice },
  };
}

export const forgeCost = (it: Item) => Math.floor(it.buyPrice / 2);
/** 这件道具在这个城镇还能不能打铁（+172 起的城镇号表，EXE 0x418373） */
export const canForge = (it: Item | undefined, n: number, town: number) => !!it && it.seqB.includes(town) && n < forgeLimit(it);

export function forge(c: CampaignState, data: GameData, classId: number, slot: number, town: number): Outcome {
  const m = memberOf(c, classId), it = itemOf(data, m?.slots[slot] ?? 0);
  const n = m?.forge?.[slot] ?? 0;
  if (!m || !it || !canForge(it, n, town)) return fail(c, '');
  const cost = forgeCost(it);
  if (c.gold < cost) return fail(c, '金錢不夠，無法提升！');
  const lines = [];
  if (n < it.attackSteps && it.attackStep) lines.push(`攻擊力提升了${it.attackStep}點！`);
  if (n < it.defenseSteps && it.defenseStep) lines.push(`防御力提升了${it.defenseStep}點！`);
  return { ok: true, text: lines.join('') || '鍛造完成。', c: { ...edit(c, classId, (x) => x.forge[slot]++), gold: c.gold - cost } };
}

/** 给予：交给另一个人（放进他的空格） */
export function give(c: CampaignState, data: GameData, from: number, slot: number, to: number): Outcome {
  const a = memberOf(c, from), b = memberOf(c, to), id = a?.slots[slot] ?? 0;
  if (!a || !b || !id || from === to) return fail(c, '');
  const k = freeSlot(b, itemOf(data, id), data);
  if (k < 0) return fail(c, `${data.charNames[to]}的道具已滿。`);
  const f = a.forge?.[slot] ?? 0;
  const c1 = edit(c, from, (n) => ((n.slots[slot] = 0), (n.forge[slot] = 0)));
  return { ok: true, text: `${itemOf(data, id)!.name}交給了${data.charNames[to]}。`, c: edit(c1, to, (n) => ((n.slots[k] = id), (n.forge[k] = f))) };
}

/** 装备：随身物品换进对应的装备栏（原来的装备换到这一格）；对装备栏的道具则是卸下 */
export function equip(c: CampaignState, data: GameData, classId: number, slot: number): Outcome {
  const m = memberOf(c, classId), it = itemOf(data, m?.slots[slot] ?? 0);
  if (!m || !it) return fail(c, '');
  const k = equipSlotOf(it);
  if (slot < 3) {
    const free = m.slots.findIndex((id, i) => i >= 3 && !id);
    if (free < 0) return fail(c, '道具已滿，無法卸下。');
    return { ok: true, text: `卸下了${it.name}。`, c: edit(c, classId, (n) => swap(n, slot, free)) };
  }
  if (k < 0 || !canEquip(data.classes[classId], it, data)) return fail(c, `${data.charNames[classId]}不能裝備${it.name}。`);
  return { ok: true, text: `裝備了${it.name}。`, c: edit(c, classId, (n) => swap(n, slot, k)) };
}

function swap(n: Required<Member>, a: number, b: number) {
  [n.slots[a], n.slots[b]] = [n.slots[b], n.slots[a]];
  [n.forge[a], n.forge[b]] = [n.forge[b], n.forge[a]];
}

export function discard(c: CampaignState, data: GameData, classId: number, slot: number): Outcome {
  const it = itemOf(data, memberOf(c, classId)?.slots[slot] ?? 0);
  if (!it) return fail(c, '');
  return { ok: true, text: `丟棄了${it.name}。`, c: edit(c, classId, (n) => ((n.slots[slot] = 0), (n.forge[slot] = 0))) };
}

/** 整备、商店里列出的人：上一关出场的我方人物 */
export const partyMembers = (c: CampaignState) => (c.active ? c.active.flatMap((id) => c.members.find((m) => m.classId === id) ?? []) : c.members);
