import { expect, it, vi } from 'vitest';
import type { BattleSceneData } from '../src/game/BattleScene.ts';

// 只替换 Phaser 基类，调用真实的 init/endTurn，验证场景重用时的指令锁。
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/game/sound.ts', () => ({ sound: {} }));
vi.mock('../src/game/music.ts', () => ({ music: {} }));
import { BattleScene } from '../src/game/BattleScene.ts';

it('回合播放中重开场景后，第一回合仍能结束', async () => {
  const scene = new BattleScene();
  const data = { assets: {}, ui: {}, stage: 'pack:wusong/jingyanggang' } as BattleSceneData;
  scene.init(data);
  const s = scene as unknown as {
    busy: boolean; ending: boolean; fast: boolean; playingSide: string;
    battle: unknown; select: () => void; run: () => Promise<void>; autoEndTurn: () => void;
  };
  // 模拟旧场景正结束敌方回合时重开，旧等待已被场景关闭取消。
  Object.assign(s, { busy: true, ending: true, fast: true, playingSide: 'enemy' });
  scene.init(data);
  expect([s.busy, s.ending, s.fast, s.playingSide]).toEqual([false, false, false, 'player']);
  const advance = vi.fn(() => []);
  s.battle = { status: 'playing', phase: 'player', autoActUnits: () => [], endPlayerPhase: advance };
  s.select = vi.fn();
  s.run = vi.fn(async () => {});
  s.autoEndTurn = vi.fn();
  await scene.endTurn();
  expect(advance).toHaveBeenCalledOnce();
  expect(s.ending).toBe(false);
});
