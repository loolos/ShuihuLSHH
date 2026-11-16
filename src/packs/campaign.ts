// Stable save identities for mainline package characters/items. Runtime ids stay inside a loaded pack.
import { recordResult, type CampaignState, type Member } from '../rules/campaign.ts';
import type { Battle } from '../rules/battle.ts';
import type { PackRuntime } from './build.ts';

const keyOf = (rt: PackRuntime, id: string) => `${rt.id}/${id}`;
const classLimit = (rt: PackRuntime) => rt.data.classes.length - rt.classIds.size;
function itemId(rt: PackRuntime, key: string): number {
  const id = key.startsWith(`${rt.id}/`) ? rt.itemIds.get(key.slice(rt.id.length + 1)) : undefined;
  if (id === undefined) throw new Error(`存档道具 ${key} 未加载，保留原存档后再试。`);
  return id;
}

export function packParty(c: CampaignState, rt: PackRuntime): Map<number, Member> {
  const party = new Map<number, Member>();
  for (const m of c.members.filter(m => m.classId < classLimit(rt))) {
    party.set(m.classId, { ...m, slots: m.slots.map(v => m.itemKeys?.[v] ? itemId(rt, m.itemKeys[v]) : v) });
  }
  for (const [id, classId] of rt.classIds) {
    const saved = c.companions?.[keyOf(rt, id)];
    if (!saved) continue;
    party.set(classId, { ...saved, classId, slots: saved.slots.map(v => typeof v === 'number' ? v : itemId(rt, v)) });
  }
  return party;
}

/** Pack members materialized for TownUI only; never write their numeric runtime ids into a save. */
export function townParty(c: CampaignState, rt: PackRuntime): CampaignState {
  return { ...c, members: [...packParty(c, rt).values()] };
}
export function saveTownParty(c: CampaignState, rt: PackRuntime): CampaignState {
  const classKeys = new Map([...rt.classIds].map(([id, n]) => [n, keyOf(rt, id)]));
  const itemKeys = new Map([...rt.itemIds].map(([id, n]) => [n, keyOf(rt, id)]));
  const companions = { ...c.companions };
  for (const m of c.members) {
    const key = classKeys.get(m.classId);
    if (key) companions[key] = {
      level: m.level, exp: m.exp, slots: m.slots.map(v => itemKeys.get(v) ?? v),
      forge: m.forge ? [...m.forge] : undefined,
    };
  }
  const members = c.members.filter(m => m.classId < classLimit(rt)).map(m => ({
    ...m, itemKeys: Object.fromEntries(m.slots.filter(v => itemKeys.has(v)).map(v => [v, itemKeys.get(v)!])),
  }));
  return { ...c, members, active: c.active?.filter(n => n < classLimit(rt)), companions };
}
export function recordPackResult(c: CampaignState, b: Battle, rt: PackRuntime): CampaignState {
  const before = townParty(c, rt);
  const after = recordResult(before, b, { keepActive: true });
  // Never initialize hidden reinforcements that have not actually appeared.
  const appeared = new Set(b.units.filter(u => u.side === 'player' && (u.present || !u.alive || b.benchedUids.includes(u.uid))).map(u => u.classId));
  after.members = after.members.filter(m => before.members.some(old => old.classId === m.classId) || appeared.has(m.classId));
  return saveTownParty(after, rt);
}
