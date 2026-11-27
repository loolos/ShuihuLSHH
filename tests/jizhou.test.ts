// 第三十四章「大破高唐州」后半：蓟州寻公孙胜五段（docs/game-design.md §15.35.3）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

const IDS = ['jiama', 'erxianshan', 'pijian', 'jizhoufu', 'chuanfa'];

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('蓟州寻公孙胜', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const open = (id: string, seed = 1) => {
    const stage = rt.stages.find((s) => s.id === id)!;
    const b = new Battle(compileStage(rt, stage, files, { seed }));
    const seen = new Set<string>();
    for (const u of stage.units) {
      expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
      if (!u.hidden) expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    b.begin();
    return { b, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const kill = (b: Battle, t: Unit, by: Unit) => (b as unknown as { kill(u: Unit, k: Unit): void }).kill(by, t);

  it('五段都排在第三十四章，接在神兵困公明之后', () => {
    for (const id of IDS) expect(chapterOf(`mainline/${id}`)).toBe(34);
  });

  it('甲马戏铁牛：开场李逵缚了甲马变成停不住脚的友军；戴宗赶到身边收法，李逵回到我方；毛贼打完过关', () => {
    const { b, get } = open('jiama');
    const likui = get('likui'), dz = get('daizong');
    expect(likui.side).toBe('ally');
    expect(likui.ai.mode).toBe(8);
    // 起点离戴宗远，一回合走不到（负责人 2026-11-27）
    expect(Math.abs(likui.x - dz.x) + Math.abs(likui.y - dz.y)).toBeGreaterThan(dz.stats.move + 2);
    // 戴宗追到李逵附近，再走到他身边
    dz.x = 6; dz.y = 26;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: likui.x + dx, y: likui.y + dy })).find((c) => b.board.passable(c.x, c.y) && !b.active().some((u) => u.x === c.x && u.y === c.y))!;
    b.move(dz, spot.x, spot.y);
    expect(likui.side).toBe('player');
    for (const u of b.units.filter((x) => x.side === 'enemy' && x.present)) kill(b, u, likui);
    b.endPlayerPhase();
    expect(b.status).toBe('won');
  });

  it('甲马戏铁牛：李逵每回合跑到别处；戴宗一直追不上，第 6 回合也自动收法', () => {
    const { b, get } = open('jiama');
    const likui = get('likui');
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.stats.attack = 0;
    const spots = new Set<string>();
    for (let t = 0; t < 5 && b.status === 'playing'; t++) { spots.add(`${likui.x},${likui.y}`); b.endPlayerPhase(); }
    expect(spots.size).toBe(5);
    expect(likui.side).toBe('player');
  });

  it('二仙山访道：两次选项都能走到公孙胜出来、过关', () => {
    for (const picks of [[0, 1], [1, 0, 0], [0, 0]]) {
      const { b, get } = open('erxianshan');
      for (const k of picks) if (b.pendingChoice) b.answer(k);
      expect(b.status, picks.join()).toBe('won');
      expect(get('gongsun').present).toBe(true);
    }
  });

  it('斧劈罗真人：潜行关，李逵走到罗真人身边就劈、次日罗真人好端端坐着，李逵被白云卷走，过关', () => {
    const { b, get } = open('pijian');
    const likui = get('likui'), luo = get('luo');
    expect(b.watchZones().length).toBeGreaterThan(0);
    likui.x = luo.x; likui.y = luo.y + 2;
    b.move(likui, luo.x, luo.y + 1);
    expect(b.status).toBe('won');
    expect(likui.present).toBe(false);
    expect(luo.present).toBe(true);
  });

  it('蓟州府吃苦：撑过第 6 回合，李逵被狗血淋倒、在牢里吓唬节级，黄巾力士取走他，过关', () => {
    const { b, get } = open('jizhoufu');
    const likui = get('likui');
    expect(likui.present).toBe(true);
    const gx = b.units.find((u) => u.side === 'enemy' && u.present && learnedSkills(u, b.data).some((s) => s.name === '狗血淋头'));
    expect(gx).toBeTruthy();
    for (const u of b.units.filter((x) => x.side === 'enemy')) u.stats.attack = 0;
    for (let t = 0; t < 8 && b.status === 'playing'; t++) b.endPlayerPhase();
    expect(b.status).toBe('won');
  });

  it('罗真人传法：纯剧情，开场演完就过关', () => {
    const { b } = open('chuanfa');
    expect(b.status).toBe('won');
  });
});
