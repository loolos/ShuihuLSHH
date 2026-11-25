// 第三十三章「宋公明三打祝家庄」（docs/game-design.md §15.34）：庄门、门卫隔墙、刷兵 / 补位、挠钩拖进囚车、城楼、发号
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
import { insertTownIntro, insertTownName } from '../src/packs/towns.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第三十三章 三打祝家庄', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const open = (id = 'sanda', seed = 1) => {
    const stage = rt.stages.find((s) => s.id === id)!;
    const b = new Battle(compileStage(rt, stage, files, { seed }));
    b.begin();
    return { b, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const priv = (b: Battle) => b as unknown as { kill(u: Unit, t: Unit): void; snare(t: Unit): void; phase: string; spectators: Set<number>; prisonCarts: Set<number> };
  const put = (u: Unit, x: number, y: number) => { u.x = x; u.y = y; };

  it('大仗和三段战后过场排在第三十三章，开场单位不重叠、都走得到', () => {
    for (const id of ['sanda', 'zhongli', 'liying-shangshan']) expect(chapterOf(`mainline/${id}`)).toBe(33);
    const { b, stage } = open();
    const seen = new Set<string>();
    for (const u of stage.units.filter((x) => !x.hidden)) {
      expect(seen.has(`${u.x},${u.y}`), `${u.id} 重叠`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
    // 每个敌人（庄门除外）都连得到梁山营寨（庄门格算通）
    const gates = new Set(b.siege!.gates.flatMap((g) => g.cells.map((c) => c.y * 64 + c.x)));
    const f = b.board.distanceField([{ x: 31, y: 55 }], gates);
    for (const u of b.units.filter((x) => x.side === 'enemy' && !b.isDoor(x.uid))) expect(Number.isFinite(f[u.y * 64 + u.x]), `${u.name} (${u.x},${u.y})`).toBe(true);
  });

  it('第三十三章开头有营寨整备：解珍解宝双越狱之后进城镇，入城对白的人都在大仗开场的我方里', () => {
    expect(rt.stages.find((s) => s.id === 'jielao')!.townAfter).toBe(11);
    expect(insertTownName('mainline/ruzhuang')).toBe('独龙冈营寨');
    const sanda = rt.stages.find((s) => s.id === 'sanda')!;
    const actors = new Set(sanda.units.filter((u) => u.side === 'player' && !u.hidden && !u.prisonCart).map((u) => u.class));
    for (const l of insertTownIntro('mainline/ruzhuang')) expect(actors.has(l.actor), l.actor).toBe(true);
  });

  it('庄门：体力 1000，挡住我方；敌人能从关着的门里穿过，但不能停在门上', () => {
    const { b, get } = open();
    const door = get('door-front');
    expect(b.isDoor(door.uid)).toBe(true);
    expect(door.hp).toBe(1000);
    const lin = get('linchong');
    put(lin, 31, 24);
    expect([...b.reachOf(lin, 4).keys()].some((k) => Number(k.split(',')[1]) <= 22)).toBe(false);
    const guard = get('gd-front0');
    const reach = b.reachOf(guard, 5);
    expect(reach.has('31,23')).toBe(true);
    expect([...reach.keys()].some((k) => k.endsWith(',22'))).toBe(false);
  });

  it('庄门打到 0 就开，不给经验银子，门板格变成能走', () => {
    const { b, get } = open();
    const lin = get('linchong'), door = get('door-front');
    const exp = lin.exp, gold = lin.gold;
    priv(b).kill(lin, door);
    expect(b.gateOpen(1)).toBe(true);
    expect(b.gateOpen(0)).toBe(false);
    expect(b.board.passable(30, 22) && b.board.passable(33, 22)).toBe(true);
    expect([lin.exp, lin.gold]).toEqual([exp, gold]);
  });

  it('从里面开门：守门庄客都倒了、回合结束时有人站在门里侧，下回合开门', () => {
    const { b, get, stage } = open();
    const sunli = get('sunli');
    put(sunli, 31, 21);
    b.endPlayerPhase();
    expect(b.gateOpen(1)).toBe(false); // 守门庄客还在
    for (const s of stage.units.filter((u) => u.id.startsWith('gd-front'))) get(s.id).alive = false;
    put(sunli, 31, 21);
    b.endPlayerPhase();
    expect(b.gateOpen(1)).toBe(true);
    expect(get('door-front').alive).toBe(false);
  });

  it('守门庄客不受墙外的人伤害；墙里的弓手照样打得着', () => {
    const { b, get } = open();
    expect(b.walled(get('gd-west0'), { x: 14, y: 30 })).toBe(true);
    expect(b.walled(get('gd-west0'), { x: 14, y: 21 })).toBe(false);
    expect(b.walled(get('ar-west0'), { x: 10, y: 30 })).toBe(false);
  });

  it('城楼：弓手射程 +6，远程伤害按加长后的射程递减', () => {
    const { b, get } = open();
    const ar = get('ar-front0'); // (27, 21) 城楼格
    expect(b.towerCells.has(21 * 64 + 27)).toBe(true);
    const [lo, hi] = b.onTower(ar, [1, 8]);
    expect([lo, hi]).toEqual([1, 14]);
    expect(b.towerSelf(ar).stats.rangeBonus).toBe(ar.stats.rangeBonus + 6);
    expect(b.towerSelf(get('ar-front4')).stats.rangeBonus).toBe(get('ar-front4').stats.rangeBonus); // 墙内普通格
  });

  it('庄门轮流出击：前门第 1 回合、西门第 2 回合；门开了那一轮就空着', () => {
    const { b, get } = open();
    expect(get('w-front00').present).toBe(true);
    expect(get('w-west00').present).toBe(false);
    priv(b).kill(get('linchong'), get('door-west'));
    b.endPlayerPhase();
    expect(b.turn).toBe(2);
    expect(get('w-west00').present).toBe(false);
  });

  it('弓手补位：每回合最多补一个，只补还没破的门', () => {
    const { b, get } = open();
    const a = get('ar-east0'), c = get('ar-west0');
    a.alive = false; c.alive = false;
    priv(b).kill(get('linchong'), get('door-west'));
    b.endPlayerPhase();
    expect(a.alive && a.present).toBe(true);
    expect([a.x, a.y]).toEqual([44, 21]);
    expect(c.alive).toBe(false);
  });

  it('挠钩拖翻：好汉拖进空囚车、囚车旁刷出 4 个看守；我方走到车旁放出来，半血', () => {
    const { b, get } = open();
    const lin = get('linchong');
    priv(b).spectators.delete(lin.uid);
    lin.hp = 10;
    priv(b).snare(lin);
    expect(b.isBound(lin)).toBe(true);
    expect(priv(b).prisonCarts.has(lin.uid)).toBe(true);
    expect([lin.x, lin.y]).toEqual([10, 8]); // 前 7 辆关着人，第 8 辆空着
    expect(['cg00', 'cg01', 'cg02', 'cg03'].every((id) => get(id).present)).toBe(true);
    const gu = get('gudasao');
    put(gu, 7, 12);
    // 4 个看守把囚车围住了：打倒一个才挤得过去
    for (const id of ['cg00', 'cg01', 'cg02', 'cg03']) if (Math.abs(get(id).y - lin.y) === 1 && get(id).x === lin.x && get(id).y > lin.y) get(id).alive = false;
    const range = b.moveRange(gu).green;
    const next = range.find((c) => Math.abs(c.x - lin.x) + Math.abs(c.y - lin.y) === 1)!;
    if (!next) throw new Error(JSON.stringify({ n: range.length, at: [gu.x, gu.y], can: b.canMove(gu), lin: [lin.x, lin.y], occ: b.active().filter((u) => Math.abs(u.x - lin.x) + Math.abs(u.y - lin.y) === 1).map((u) => [u.name, u.x, u.y]) }));
    b.move(gu, next.x, next.y);
    expect(b.isBound(lin)).toBe(false);
    expect(b.spectators.has(lin.uid)).toBe(false);
    expect(lin.hp).toBe(Math.ceil(lin.stats.maxHp / 2)); // 放出来是半血
  });

  it('挠钩技能打中三成体力以下的好汉才拖，宋江不拖', () => {
    const { stage } = open();
    expect(stage.siege!.snare).toEqual({ skills: ['ng-la', 'zt-la'], pct: 30, spare: ['sj-fugitive'] });
  });

  it('乐和发号：小兵三成昏迷、三成乱窜，宋江一队归玩家指挥', () => {
    const { b, get } = open();
    const lehe = get('lehe');
    const hao = learnedSkills(lehe, b.data).find((s) => s.name === '铁叫子发号')!;
    expect(hao).toBeTruthy();
    b.useSkill(lehe, hao, lehe);
    expect(b.spectators.has(get('linchong').uid)).toBe(false);
    expect(b.spectators.has(get('songjiang').uid)).toBe(false);
    const troops = b.units.filter((u) => u.side === 'enemy' && u.present && u.alive && (u.stunTurns > 0 || u.panicTurns));
    expect(troops.length).toBeGreaterThan(10);
    expect(lehe.disguised).toBeFalsy();
  });

  it('祝龙开场在前门外列阵，发号后只下令、留在门外；栾廷玉改追孙新，追上有对白', () => {
    const { b, get } = open();
    const zl = get('zhulong'), luan = get('luan'), sx = get('sunxin');
    expect(zl.y).toBeGreaterThan(22);
    const lehe = get('lehe');
    b.useSkill(lehe, learnedSkills(lehe, b.data).find((s) => s.name === '铁叫子发号')!, lehe);
    expect(zl.y).toBeGreaterThan(22);
    expect(luan.ai.mode).toBe(10);
    expect(b.unitByChar(luan.ai.target)).toBe(sx);
  });
});
