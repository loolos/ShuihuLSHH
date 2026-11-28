// 夺渡口（白龙庙，负责人 2026-11-28，docs/game-design.md §15.23.1）：回合末 3×3 比人数定归属、占着的一边刷兵、
// 援军点数招好汉、到齐后复活、占齐三处加刷马军；AI 17 守渡 / 夺渡、AI 18 都监亲随
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { planAi } from '../src/rules/ai.ts';
import { inZone } from '../src/rules/ferry.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import type { Unit } from '../src/rules/unit.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('白龙庙夺渡口', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = rt.stages.find((s) => s.id === 'bailongmiao')!;
  const ids = stage.units.map((u) => u.id);
  const make = () => {
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    b.begin();
    return b;
  };
  const byId = (b: Battle, id: string) => b.units[ids.indexOf(id)];
  /** 把渡口里的人都挪走（敌人挪去地图角落藏起来），再放几个我方的人进去 */
  const seize = (b: Battle, zone: number, heroes: Unit[]) => {
    const z = b.ferries!.zones[zone];
    for (const u of b.active()) if (u.side === 'enemy' && inZone(z, u)) u.present = false;
    const cells: { x: number; y: number }[] = [];
    for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) cells.push({ x, y });
    heroes.forEach((u, k) => { u.x = cells[k].x; u.y = cells[k].y; });
  };
  const tickOf = (b: Battle) => () => (b as unknown as { ferryTick(): void }).ferryTick();
  const spawn = (b: Battle, side: 'ally' | 'enemy') => (b as unknown as { ferrySpawn(s: string): void }).ferrySpawn(side);
  const heroes = (b: Battle) => b.active().filter((u) => u.side === 'player' && !u.name.includes('宋江'));

  it('开场三处渡口都在官军手里，援军按点数来', () => {
    const b = make();
    expect(b.ferries!.zones.map((z) => z.name)).toEqual(['庙前渡', '北塘渡', '东湾渡']);
    expect(b.ferry!.owner).toEqual(['enemy', 'enemy', 'enemy']);
    expect(b.ferryInfo()).toMatchObject({ points: 0, held: 0, next: { at: 2 } });
    expect(b.objectiveZones().filter((z) => z.kind === 'ferryFoe')).toHaveLength(3);
    // 开场守渡口的官军有任务字样
    const g = b.active().find((u) => u.side === 'enemy' && u.ai.mode === 17)!;
    expect(b.ferryTaskLabel(g)?.short).toBe('守');
  });

  it('回合末我方人多就夺下渡口：攒点、刷梁山喽啰，攒够了庙旁来援军', () => {
    const b2 = make();
    seize(b2, 0, heroes(b2).slice(0, 3));
    // 直接结算（不让敌人行动）；刷兵在友军 / 敌方回合开始时
    tickOf(b2)();
    expect(b2.ferry!.owner[0]).toBe('ours');
    spawn(b2, 'ally');
    spawn(b2, 'enemy');
    expect(b2.ferry!.points).toBe(1);
    const louluo = b2.active().filter((u) => u.side === 'ally' && u.name === '梁山喽啰');
    expect(louluo.length).toBeGreaterThanOrEqual(1);
    expect(louluo.length).toBeLessThanOrEqual(2);
    expect(b2.ferryTaskLabel(louluo[0])?.text).toBe('守·庙前渡');
    // 官军占着的渡口每回合刷官兵，同一渡口同时最多 4 个
    const spawned = b2.active().filter((u) => ids[u.uid].startsWith('ferry-enemy-1-'));
    expect(spawned.length).toBeGreaterThanOrEqual(1);
    (b2 as unknown as { ferryTick(): void }).ferryTick();
    expect(b2.ferry!.points).toBe(2);
    // 2 点：清风山众好汉在庙旁登场
    expect(byId(b2, 'yanshun').present).toBe(true);
    expect(byId(b2, 'huangxin').present).toBe(true);
    expect(b2.ferryInfo()!.next!.at).toBe(5);
  });

  it('守满 3 人后新刷的兵去进攻；人数一样多不换主人', () => {
    const b = make();
    seize(b, 0, heroes(b).slice(0, 3));
    const tick = tickOf(b);
    for (let k = 0; k < 4; k++) { tick(); spawn(b, 'ally'); }
    const mine = b.active().filter((u) => ids[u.uid].startsWith('ferry-ours-0-'));
    expect(mine.length).toBe(4);
    expect(mine.filter((u) => b.ferry!.role[u.uid] === 'd').length).toBe(3);
    const raider = mine.find((u) => b.ferry!.role[u.uid] === 'a')!;
    expect(b.ferryTaskLabel(raider)?.short).toBe('夺');
    // 一样多：归属不变
    const z = b.ferries!.zones[0];
    const n = b.ferryCount(0);
    expect(n.ours).toBeGreaterThan(0);
    for (const u of b.active()) if (u.side !== 'enemy' && inZone(z, u)) u.present = false;
    tick();
    expect(b.ferry!.owner[0]).toBe('ours');
  });

  it('AI 17 守渡的官军附近没人时不出渡口，AI 18 亲随在我方有渡口时去夺', () => {
    const b = make();
    const g = b.active().find((u) => u.side === 'enemy' && u.ai.mode === 17 && b.ferry!.home[u.uid] === 1)!;
    const plan = planAi(b, g);
    const end = plan.path?.at(-1) ?? g;
    expect(Math.abs(end.x - g.x) + Math.abs(end.y - g.y)).toBeLessThanOrEqual(3);
    const boss = b.active().find((u) => u.ai.mode === 18)!;
    expect(b.ferryTask(boss)).toBeNull();
    seize(b, 0, heroes(b).slice(0, 3));
    (b as unknown as { ferryTick(): void }).ferryTick();
    expect(b.ferryTask(boss)).toEqual({ kind: 'take', zone: 0 });
  });

  it('占齐三处：都监身边加刷马军；援军到齐后攒点复活倒下的好汉；撑满 20 回合要有两处渡口', () => {
    const b = make();
    const hs = heroes(b);
    seize(b, 0, hs.slice(0, 3));
    seize(b, 1, hs.slice(3, 6));
    seize(b, 2, hs.slice(6, 9));
    const tick = tickOf(b);
    tick();
    expect(b.ferry!.owner).toEqual(['ours', 'ours', 'ours']);
    expect(b.active().filter((u) => ids[u.uid].startsWith('ferry-allheld-'))).toHaveLength(0);
    spawn(b, 'enemy');
    expect(b.active().filter((u) => ids[u.uid].startsWith('ferry-allheld-'))).toHaveLength(6);
    expect((b as unknown as { flags: Set<number> }).flags.size).toBeGreaterThan(0);
    // 援军到齐（14 点）后再攒 5 点复活一个
    const dead = byId(b, 'liutang');
    for (let k = 0; k < 5; k++) tick();
    expect(b.ferry!.points).toBe(18);
    expect(b.ferryInfo()!.next).toEqual({ at: 19, name: '复活一位倒下的好汉' });
    dead.alive = false;
    dead.present = false;
    tick();
    expect(dead.alive).toBe(true);
    expect(dead.hp).toBe(dead.stats.maxHp);
    expect(b.ferryInfo()!.next!.at).toBe(24);
  });
});
