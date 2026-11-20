// 连着的几个人的状态变化一起播放（BattleScene.run）【新】
import type { BattleEvent } from '../rules/battle.ts';

/** 可以和别人同时播放的事件属于哪一类（同一批只放同一类）；null = 不能一起放 */
export function batchFamily(e: BattleEvent): 'state' | 'move' | `act-${string}` | null {
  switch (e.type) {
    case 'status':
    case 'look':
    case 'die':
    case 'leave':
      return 'state';
    case 'hp':
      return e.text ? 'state' : null;
    case 'defend':
      return e.on ? 'state' : null;
    case 'move':
      return e.script && e.path.length > 1 ? 'move' : null;
    case 'act':
      return `act-${e.action}`;
    default:
      return null;
  }
}

/** 夹在一批中间也不打断它的瞬时事件（文字、音效、转身、只改状态条） */
function batchPassThrough(e: BattleEvent) {
  return e.type === 'message' || e.type === 'sound' || e.type === 'face' || (e.type === 'hp' && !e.text) || (e.type === 'defend' && !e.on);
}

/**
 * 从 events[i] 起能一起播放的一批有多长（0/1 = 照常一个个放）【新】：同一类事件、每人每种事件只出现一次、至少两个人，
 * 中间可以夹瞬时事件（尾巴上的瞬时事件不算进来）。
 */
export function batchLength(events: BattleEvent[], i: number): number {
  const fam = batchFamily(events[i]);
  if (!fam) return 0;
  const seen = new Set<string>(), uids = new Set<number>();
  let end = i;
  for (let j = i; j < events.length; j++) {
    const e = events[j];
    if (batchPassThrough(e)) continue;
    if (batchFamily(e) !== fam || !('uid' in e) || e.uid === null) break;
    const k = `${e.type}:${e.uid}`;
    if (seen.has(k)) break;
    seen.add(k);
    uids.add(e.uid);
    end = j;
  }
  return uids.size > 1 ? end - i + 1 : 0;
}
