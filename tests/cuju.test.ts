// 蹴鞠外传（docs/game-design.md §15.25）：球路、拦截、出界、进球与整场对打。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { basicReaches, canStand, kickDistance, resolveBall, throwIn, traceLine, type BallPlayer, type CujuRules } from '../src/rules/cuju.ts';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadGameData } from '../src/rules/load.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';

const rules: CujuRules = {
  field: [2, 2, 28, 16],
  goals: { player: { x: 1, y1: 7, y2: 11 }, enemy: { x: 29, y1: 7, y2: 11 } },
  kickoff: [15, 9],
  goalsToWin: 3,
  turns: 12,
  extraTurns: 3,
};
const P = (uid: number, side: 'player' | 'enemy', x: number, y: number, defending = false): BallPlayer => ({ uid, side, x, y, defending });

describe('球路', () => {
  it('沿人到球的延长线走，转角时偏开', () => {
    expect(traceLine({ x: 10, y: 9 }, 1, 0, 0, 3)).toEqual([{ x: 11, y: 9 }, { x: 12, y: 9 }, { x: 13, y: 9 }]);
    const bent = traceLine({ x: 10, y: 9 }, 1, 0, 45, 4);
    expect(bent.at(-1)!.y).toBeGreaterThan(9);
    expect(bent.at(-1)!.x).toBeLessThan(14);
  });

  it('近战可以踢身边 8 格的球，远程按射程', () => {
    expect(basicReaches({ x: 5, y: 5 }, { x: 6, y: 6 }, [1, 1])).toBe(true);
    expect(basicReaches({ x: 5, y: 5 }, { x: 7, y: 5 }, [1, 1])).toBe(false);
    expect(basicReaches({ x: 5, y: 5 }, { x: 8, y: 7 }, [1, 8])).toBe(true);
    expect(kickDistance(0)).toBe(1);
    expect(kickDistance(1000)).toBe(10);
  });

  it('对方站在路上：停在他脚前；自己人不挡', () => {
    const line = traceLine({ x: 10, y: 9 }, 1, 0, 0, 6);
    const r = resolveBall(rules, { x: 10, y: 9 }, line, 'player', [P(1, 'player', 12, 9), P(2, 'enemy', 14, 9)]);
    expect(r).toMatchObject({ kind: 'intercept', by: 2, at: { x: 13, y: 9 } });
  });

  it('防御中的对方：路过他上下左右相邻的格子也会被拦下', () => {
    const line = traceLine({ x: 10, y: 9 }, 1, 0, 0, 6);
    expect(resolveBall(rules, { x: 10, y: 9 }, line, 'player', [P(2, 'enemy', 13, 10)])).toMatchObject({ kind: 'stop', at: { x: 16, y: 9 } });
    expect(resolveBall(rules, { x: 10, y: 9 }, line, 'player', [P(2, 'enemy', 13, 10, true)])).toMatchObject({ kind: 'intercept', by: 2, at: { x: 13, y: 9 } });
  });

  it('出界、进球、乌龙球', () => {
    const out = resolveBall(rules, { x: 15, y: 3 }, traceLine({ x: 15, y: 3 }, 0, -1, 0, 4), 'player', []);
    expect(out).toMatchObject({ kind: 'out', at: { x: 15, y: 2 } });
    const goal = resolveBall(rules, { x: 25, y: 9 }, traceLine({ x: 25, y: 9 }, 1, 0, 0, 6), 'player', []);
    expect(goal).toMatchObject({ kind: 'goal', scorer: 'player' });
    const own = resolveBall(rules, { x: 4, y: 9 }, traceLine({ x: 4, y: 9 }, -1, 0, 0, 6), 'player', []);
    expect(own).toMatchObject({ kind: 'goal', scorer: 'enemy' });
  });

  it('人最多走出球场一格，球门里也能站', () => {
    expect(canStand(rules, { x: 15, y: 1 })).toBe(true);
    expect(canStand(rules, { x: 15, y: 0 })).toBe(false);
    expect(canStand(rules, { x: 1, y: 3 })).toBe(true);
    expect(canStand(rules, { x: 1, y: 9 })).toBe(true);
    expect(canStand(rules, { x: 29, y: 11 })).toBe(true);
    expect(canStand(rules, { x: 0, y: 9 })).toBe(false);
  });

  it('出界后球放到离出界点最近的对方身边、朝他要攻的门', () => {
    const t = throwIn(rules, { x: 15, y: 2 }, 'player', [P(1, 'player', 15, 3), P(2, 'enemy', 16, 4), P(3, 'enemy', 25, 9)]);
    expect(t?.to).toBe(2);
    expect(t!.at.x).toBe(15); // 敌方往 x 小的方向攻
  });
});

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('鞠场争锋', () => {
  useDiskCustomMaps();
  const files = new NodeFiles(DATA);
  const rt = loadPackFromDisk('mainline', loadGameData(files));
  const stage = rt.stages.find((s) => s.id === 'cuju')!;
  const make = (seed: number) => new Battle(compileStage(rt, stage, files, { seed }));

  it('攻击只能踢球，不能打人；两队都按我方算移动力', () => {
    const b = make(1);
    b.begin();
    for (const u of b.active()) expect(b.attackTargets(u)).toEqual([]);
    const ws = b.active().find((u) => u.name === '武松')!;
    const gq = b.active().find((u) => u.name === '高俅')!;
    expect(ws.statSide ?? ws.side).toBe('player');
    expect(gq.statSide).toBe('player');
    expect(b.usableSlots(ws)).toEqual([]);
  });

  it('被拦下后本回合球踢不动，但还能走位', () => {
    const b = make(2);
    b.begin();
    const c = b.cuju!;
    const ws = b.active().find((u) => u.name === '武松')!;
    const lc = b.active().find((u) => u.name === '林沖')!;
    const gq = b.active().find((u) => u.name === '高俅')!;
    // 武松站球左边，高俅挡在球右边一格：一踢就被拦
    Object.assign(ws, { x: 14, y: 9 });
    Object.assign(gq, { x: 17, y: 9 });
    const ev = b.kick(ws);
    const ball = ev.find((e): e is Extract<BattleEvent, { type: 'ball' }> => e.type === 'ball');
    expect(ball?.result).toBe('intercept');
    expect(c.locked).toBe(true);
    expect(b.kickable(lc, { x: c.ball.x - 1, y: c.ball.y })).toBe(false);
    expect(b.canMove(lc)).toBe(true);
  });

  it('双方 AI 能打完整场，有进球、比分和胜负', () => {
    let goals = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const b = make(seed);
      b.begin();
      while (b.status === 'playing' && b.turn < 40) {
        b.autoPhase('player');
        b.endPlayerPhase();
      }
      expect(b.status).not.toBe('playing');
      expect(b.turn).toBeLessThanOrEqual(rules.turns + rules.extraTurns + 1);
      goals += b.cuju!.score.player + b.cuju!.score.enemy;
    }
    expect(goals).toBeGreaterThan(0);
  });
});
