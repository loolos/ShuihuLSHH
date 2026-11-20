import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '../src/rules/battle.ts';
import { batchLength } from '../src/game/event-batch.ts';

const status = (uid: number, text = '收手'): BattleEvent => ({ type: 'status', uid, text });
const look = (uid: number): BattleEvent => ({ type: 'look', uid, classId: 1 });
const msg: BattleEvent = { type: 'message', text: 'x' };

describe('连着的状态变化一起播放', () => {
  it('多人收手（状态 + 换样子）合成一批', () => {
    const ev = [status(1), look(1), status(2), look(2), status(3), look(3), msg];
    expect(batchLength(ev, 0)).toBe(6); // 尾巴上的文字不算进来
  });
  it('只有一个人不成批', () => {
    expect(batchLength([status(1), look(1), msg], 0)).toBe(0);
  });
  it('同一个人再出现同一种事件就断开', () => {
    expect(batchLength([status(1), status(2), status(1)], 0)).toBe(2);
  });
  it('对白打断一批', () => {
    const say: BattleEvent = { type: 'say', uid: 1, speaker: 'a', text: 'b' };
    expect(batchLength([status(1), say, status(2)], 0)).toBe(0);
  });
  it('群体回复的数字一起弹，中间夹的状态条更新不打断', () => {
    const ev: BattleEvent[] = [
      { type: 'hp', uid: 1, hp: 9, mp: 0, delta: 3, text: '回復' },
      { type: 'hp', uid: 9, hp: 9, mp: 0, delta: 0 },
      { type: 'hp', uid: 2, hp: 9, mp: 0, delta: 3, text: '回復' },
    ];
    expect(batchLength(ev, 0)).toBe(3);
  });
  it('几个人一起倒下，中间的战败文字、银子不打断', () => {
    expect(batchLength([{ type: 'die', uid: 1 }, msg, msg, { type: 'die', uid: 2 }], 0)).toBe(4);
  });
  it('剧本走位一起走，战斗里的移动照旧一个个', () => {
    const mv = (uid: number, script?: boolean): BattleEvent => ({ type: 'move', uid, path: [{ x: 0, y: 0 }, { x: 0, y: 1 }], facing: 2, script });
    expect(batchLength([mv(1, true), mv(2, true), mv(3, true)], 0)).toBe(3);
    expect(batchLength([mv(1), mv(2)], 0)).toBe(0);
    // 走位和之后的绑缚不混在一批
    expect(batchLength([mv(1, true), mv(2, true), status(1, '被綁')], 0)).toBe(2);
  });
  it('一起倒地的动作合成一批，你来我往的对打不合', () => {
    const act = (uid: number, action: 'attack' | 'hurt' | 'defend'): BattleEvent => ({ type: 'act', uid, action, facing: 0 });
    expect(batchLength([act(1, 'hurt'), act(2, 'hurt'), act(3, 'hurt')], 0)).toBe(3);
    expect(batchLength([act(1, 'attack'), act(2, 'defend'), act(2, 'attack'), act(1, 'defend')], 0)).toBe(0);
  });
});
