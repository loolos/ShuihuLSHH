// 好汉聚义（吃鸡外传，docs/game-design.md §15.31）：参赛名单、各自为战、毒圈、宝箱、小头目掉药与整局对打。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { royalePool } from '../src/packs/royale.ts';
import { loadGameData } from '../src/rules/load.ts';
import { firstZone, inZone, mainArea, nextZone, NPC_TEAM } from '../src/rules/royale.ts';
import { Rng } from '../src/rules/rng.ts';
import { STARS_108 } from '../src/rules/nicknames.ts';
import { hostile } from '../src/rules/unit.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';

describe('毒圈几何', () => {
  it('一百单八将名单正好 108 人', () => {
    expect(STARS_108.size).toBe(108);
    expect(STARS_108.has('宋江')).toBe(true);
    expect(STARS_108.has('段景住')).toBe(true);
    expect(STARS_108.has('晁盖')).toBe(false);
  });
  it('阵营号：都设了就比阵营号，否则按 side', () => {
    expect(hostile({ side: 'enemy', team: 3 }, { side: 'enemy', team: 4 })).toBe(true);
    expect(hostile({ side: 'enemy', team: NPC_TEAM }, { side: 'enemy', team: NPC_TEAM })).toBe(false);
    expect(hostile({ side: 'player', team: 0 }, { side: 'enemy', team: NPC_TEAM })).toBe(true);
    expect(hostile({ side: 'enemy' }, { side: 'enemy' })).toBe(false);
  });
});

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('好汉聚义', () => {
  const files = new NodeFiles(DATA);
  const rt = loadPackFromDisk('mainline', loadGameData(files));
  const stage = rt.stages.find((s) => s.id === 'juyi')!;
  const make = (seed: number, pick?: number) => new Battle(compileStage(rt, stage, files, { seed, royalePick: pick }));

  it('名单：出场过的好汉，同名只留一个，不含官军', () => {
    const pool = royalePool(rt, files);
    const names = pool.map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ['林冲', '鲁智深', '武松', '李逵', '宋江', '晁盖', '武龙']) expect(names).toContain(n);
    for (const n of ['高俅', '洪教头', '都头']) expect(names).not.toContain(n);
    expect(pool.length).toBeGreaterThanOrEqual(40);
  });

  it('开局：选的好汉 + 15 个不同的对手 + 小头目，30 级、各自为战、不带药', () => {
    const b = make(7, 11);
    b.begin();
    const heroes = b.units.filter((u) => u.team !== undefined && u.team !== NPC_TEAM);
    expect(heroes).toHaveLength(16);
    expect(new Set(heroes.map((u) => u.classId)).size).toBe(16);
    const me = b.units.find((u) => u.side === 'player')!;
    expect(me.classId).toBe(11);
    for (const u of heroes) {
      expect(u.level).toBe(30);
      expect(u.statSide ?? u.side).toBe('player');
      expect(u.slots.slice(3).every((id) => !id)).toBe(true);
      expect(u.slots[0]).toBeGreaterThan(0);
    }
    const foe = heroes.find((u) => u !== me)!;
    expect(b.foesOf(foe)).toContain(heroes.find((u) => u !== me && u !== foe));
    const npcs = b.units.filter((u) => u.team === NPC_TEAM);
    expect(npcs).toHaveLength(stage.royale!.npcs.count);
    expect(b.foesOf(npcs[0])).not.toContain(npcs[1]);
    expect(b.items.length).toBe(stage.royale!.chestStart);
    // 出生点不重叠
    expect(new Set(b.units.map((u) => `${u.x},${u.y}`)).size).toBe(b.units.length);
  });

  it('下一个圈整个落在现在的圈里', () => {
    const b = make(3);
    const area = mainArea(b.board);
    let z = firstZone(area);
    const rng = new Rng(5);
    for (const r of stage.royale!.radii) {
      const n = nextZone(area, z, r, rng);
      expect(Math.hypot(n.x - z.x, n.y - z.y) + n.r).toBeLessThanOrEqual(z.r);
      expect(b.board.passable(n.x, n.y)).toBe(true);
      z = n;
    }
  });

  it('圈外每回合掉 1/5 体力，能掉死；缩圈后公布下一圈', () => {
    const b = make(4);
    b.begin();
    const st = b.royale!;
    // 把圈缩成一格，除了站在圆心的人全都在圈外
    st.zone = { x: st.zone.x, y: st.zone.y, r: 0 };
    const victim = b.royaleHeroes().find((u) => u.side === 'enemy' && !inZone(st.zone, u))!;
    victim.hp = Math.floor(victim.stats.maxHp / 5);
    const me = b.units.find((u) => u.side === 'player')!;
    me.hp = me.stats.maxHp;
    const ev = b.endPlayerPhase();
    expect(victim.alive).toBe(false);
    expect(st.out).toContain(victim.uid);
    expect(ev.some((e) => e.type === 'hp' && e.uid === me.uid && e.delta === -Math.floor(me.stats.maxHp / 5))).toBe(true);
  });

  it('小头目被打倒：打倒的人包里有空就直接拿到药', () => {
    const b = make(5);
    b.begin();
    const me = b.units.find((u) => u.side === 'player')!;
    const npc = b.units.find((u) => u.team === NPC_TEAM)!;
    npc.hp = 1;
    (b as unknown as { kill(u: unknown, t: unknown): void }).kill(me, npc);
    expect(me.slots.slice(3).some((id) => stage.royale!.npcs.drops.includes(id))).toBe(true);
  });

  it('整局对打：AI 会跑圈，最后只剩一位好汉', () => {
    for (const seed of [1, 2]) {
      const b = make(seed);
      b.royaleWatch = true;
      b.begin();
      while (b.status === 'playing' && b.turn < 60) {
        for (const u of b.units.filter((x) => x.side === 'player')) b.aiAct(u);
        if (b.status === 'playing') b.endPlayerPhase();
      }
      expect(b.status).not.toBe('playing');
      expect(b.royaleHeroes()).toHaveLength(1);
    }
  });
});
