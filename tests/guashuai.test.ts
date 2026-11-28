// 第三十五章「呼延灼挂帅」：过场高太尉大兴三路兵、战斗呼延灼挂帅（车轮战单挑、连环马阵后候着、活捉彭玘即冲锋、连环马光环、打倒 8 匹后全员退进水寨，docs/game-design.md §15.36）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, CHAIN_CAP } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('呼延灼挂帅', () => {
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
    const ev = b.begin();
    return { b, ev, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const kill = (b: Battle, t: Unit, by: Unit) => (b as unknown as { kill(u: Unit, k: Unit): void }).kill(by, t);
  const after = (b: Battle) => (b as unknown as { afterAction(): void }).afterAction();
  const freeze = (b: Battle) => { for (const u of b.units) if (u.side !== 'player') u.ai.mode = 8; };
  const horses = (b: Battle) => b.units.filter((u) => u.classId === rt.classIds.get('lianhuan'));

  it('两关新开第三十五章', () => {
    for (const id of ['gaotaiwei', 'guashuai']) expect(chapterOf(`mainline/${id}`)).toBe(35);
  });

  it('高太尉大兴三路兵：高俅保举呼延灼，呼延灼保举韩滔、彭玘，说出连环马之计，演完过关', () => {
    const { b, ev } = open('gaotaiwei');
    const said = ev.filter((e) => e.type === 'say').map((e) => (e as { text: string }).text).join('\n');
    expect(said).toContain('呼延赞');
    expect(said).toContain('连环马');
    expect(said).toContain('枣木槊');
    expect(b.status).toBe('won');
  });

  it('连环马光环：4 格内有同伴防御 +30%、受伤按 ×100/130 折算，每多一匹 +5%，封顶 +60%；倒下时紧挨着的马少走 3 格', () => {
    const { b, get } = open('guashuai');
    const hs = horses(b);
    // 先把 16 匹马都放到场上排开：每匹之间隔 9 格，谁也不挨着
    hs.forEach((u, i) => { Object.assign(u, { present: true, x: 3 + (i % 4) * 9, y: 14 + Math.floor(i / 4) * 5 }); });
    for (const u of b.units) if (u.side === 'enemy' && !hs.includes(u)) u.present = false;
    b.refreshChains();
    const [a, c, d] = hs;
    expect(a.chainBonus ?? 0).toBe(0);
    const def0 = a.stats.defense;
    // 两匹相距 4 格：各 +30%
    Object.assign(c, { x: a.x + 2, y: a.y + 2 });
    b.refreshChains();
    expect(a.chainBonus).toBe(30);
    expect(a.stats.defense).toBe(def0 + Math.round(def0 * 0.3));
    expect(a.buffs.find((x) => x.source?.startsWith('连环马'))?.source).toBe('连环马×2');
    // 第三匹挨着：+35%
    Object.assign(d, { x: a.x + 1, y: a.y });
    b.refreshChains();
    expect(a.chainBonus).toBe(35);
    // 受伤：和体力多 35% 一样耐打
    const hero = get('hero');
    const plain = { ...a, chainBonus: 0 };
    expect(b.preview(hero, a).damage).toBeLessThan(b.preview(hero, plain as Unit).damage);
    // 全挤在一处：封顶 +60%
    hs.forEach((u, i) => Object.assign(u, { x: 10 + (i % 4), y: 18 + Math.floor(i / 4) }));
    b.refreshChains();
    expect(Math.max(...hs.map((u) => u.chainBonus ?? 0))).toBe(CHAIN_CAP);
    // 倒下一匹：紧挨着它的马「连环绊」少走 3 格，隔一格的不受影响
    const t = hs[5]; // (11,19)
    const nb = hs.filter((u) => u !== t && Math.abs(u.x - t.x) + Math.abs(u.y - t.y) === 1);
    const far = hs.filter((u) => Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > 1);
    const mv = far[0].stats.move;
    kill(b, t, hero);
    for (const u of nb) expect(u.stats.move, u.name).toBe(mv - 3);
    expect(far[0].stats.move).toBe(mv);
    // 走开的马：同伴少了，加成立刻变
    Object.assign(hs[0], { x: 30, y: 30 });
    b.refreshChains();
    expect(hs[0].chainBonus).toBe(0);
    expect(hs[0].buffs.some((x) => x.source?.startsWith('连环马'))).toBe(false);
  });

  const watching = (b: Battle) => (b as unknown as { spectators: Set<number> }).spectators;
  /** 一路单挑打到活捉彭玘（直接改体力再结算） */
  const toCapture = (b: Battle, get: (id: string) => Unit) => {
    for (const [id, pct] of [['hantao', 0.4], ['huyanzhuo', 0.6], ['huyanzhuo', 0.35], ['pengqi', 0.2]] as const) {
      const u = get(id);
      u.hp = Math.floor(u.stats.maxHp * pct);
      after(b);
    }
    freeze(b);
    b.endPlayerPhase();
  };

  it('车轮战：开场只有秦明、韩滔出阵单挑，其余人（连同阵后候着的连环马）观战；一阵打完换下一阵', () => {
    const { b, get } = open('guashuai');
    const sp = watching(b);
    const active = (id: string) => !sp.has(get(id).uid);
    const y0ma = get('ma0').y;
    expect(active('qinming') && active('hantao')).toBe(true);
    for (const id of ['hero', 'linchong', 'huyanzhuo', 'pengqi', 'lb0']) expect(active(id), id).toBe(false);
    // 观战的官兵、连环马原地不动，但打得着（打倒了就坏了规矩）
    for (const id of ['g00', 'ma0', 'mb0']) expect(active(id) && get(id).ai.mode === 8, id).toBe(true);
    // 连环马一开场就在场上
    for (const id of ['ma0', 'ma7', 'mb0', 'mb7']) expect(get(id).present, id).toBe(true);
    expect(get('nu0').present).toBe(false);
    expect(get('nb0').present).toBe(false);
    // 韩滔败走 → 林冲战呼延灼
    get('hantao').hp = Math.floor(get('hantao').stats.maxHp * 0.4);
    after(b);
    expect(get('hantao').present).toBe(false);
    expect(active('qinming')).toBe(false);
    expect(active('linchong') && active('huyanzhuo')).toBe(true);
    // 林冲自己撑不住也换人：孙立接着战呼延灼
    get('linchong').hp = Math.floor(get('linchong').stats.maxHp * 0.2);
    after(b);
    expect(get('linchong').hp).toBeGreaterThan(0);
    expect(active('linchong')).toBe(false);
    expect(active('sunli') && active('huyanzhuo')).toBe(true);
    // 呼延灼退回本阵 → 扈三娘战彭玘
    get('huyanzhuo').hp = Math.floor(get('huyanzhuo').stats.maxHp * 0.35);
    after(b);
    expect(active('huyanzhuo') || active('sunli')).toBe(false);
    expect(active('husanniang') && active('pengqi')).toBe(true);
    // 扈三娘撑不住：花荣替下；花荣也撑不住：众人一齐上
    get('husanniang').hp = 1;
    after(b);
    expect(active('husanniang')).toBe(false);
    expect(active('huarong')).toBe(true);
    get('huarong').hp = 1;
    after(b);
    for (const id of ['hero', 'qinming', 'linchong', 'husanniang', 'sunli']) expect(active(id), id).toBe(true);
    expect(get('ma0').y).toBe(y0ma);
  });

  it('活捉彭玘后单挑的好汉回原位、回合结束；敌军回合一开始连环马冲锋（撞人、挤开、喽啰逃窜、冲到跟前顺手砍一下）；两回合后两翼第二批冲锋（带两队步军）', () => {
    const { b, get } = open('guashuai');
    const lead = ['ma0', 'ma1', 'ma2', 'ma3', 'ma4', 'ma5', 'ma6', 'ma7'].map(get);
    const m = get('ma0');
    const y0 = m.y;
    const qm = get('qinming');
    const hs = get('husanniang');
    const home = { x: hs.x, y: hs.y };
    for (const [id, pct] of [['hantao', 0.4], ['huyanzhuo', 0.6], ['huyanzhuo', 0.35]] as const) { get(id).hp = Math.floor(get(id).stats.maxHp * pct); after(b); }
    const pq = get('pengqi');
    pq.hp = Math.floor(pq.stats.maxHp * 0.2);
    after(b);
    expect(pq.present).toBe(false);
    // 扈三娘回到原位，好汉都在观战：我方回合打完了，连环马还没动
    expect({ x: hs.x, y: hs.y }).toEqual(home);
    expect(b.playerPhaseDone()).toBe(true);
    expect(m.y).toBe(y0);
    // 把秦明挪到马的正前方，结束回合
    Object.assign(qm, { x: m.x, y: m.y - 14 });
    const hp0 = qm.hp;
    const ev = b.endPlayerPhase();
    const horseIds = new Set(lead.map((u) => u.uid));
    expect(ev.some((e) => e.type === 'attack' && horseIds.has((e as { uid: number }).uid))).toBe(true);
    expect(b.units.filter((u) => u.present && !u.name.match(/宋江|吴用/) && watching(b).has(u.uid)).map((u) => u.name)).toEqual([]);
    for (const id of ['nu0', 'nu3']) expect(get(id).present, id).toBe(true);
    expect(m.y).toBeLessThan(y0);
    expect(qm.hp).toBeLessThan(hp0);
    expect(qm.x).not.toBe(m.x);
    expect(b.units.filter((u) => u.side === 'ally' && u.alive && u.panicTurns).length).toBeGreaterThan(0);
    expect(lead.every((u) => u.ai.mode === 0)).toBe(true);
    // 第二批还在两翼候着，两回合后冲锋
    const mb = get('mb0');
    const mb0 = { x: mb.x, y: mb.y };
    freeze(b); b.endPlayerPhase(); expect(mb.y).toBe(mb0.y);
    freeze(b);
    b.endPlayerPhase();
    expect(mb.y).toBeLessThan(mb0.y);
    for (const id of ['nb0', 'nb15']) expect(get(id).present, id).toBe(true);
  });

  it('坏了规矩：单挑的好汉打倒观战的官兵，连环马当场冲锋，单挑的人不回原位，彭玘也上阵；混战里彭玘不到三成照样被活捉', () => {
    const { b, get } = open('guashuai');
    const qm = get('qinming');
    const spot = { x: qm.x, y: qm.y };
    const m = get('ma0');
    const y0 = m.y;
    kill(b, get('g00'), qm);
    after(b);
    expect(m.y).toBeLessThan(y0);
    expect({ x: qm.x, y: qm.y }).not.toEqual({ x: 14, y: 14 }); // 没回原位（可能被马挤开一格）
    expect(Math.abs(qm.x - spot.x) + Math.abs(qm.y - spot.y)).toBeLessThanOrEqual(1);
    expect(watching(b).has(get('pengqi').uid)).toBe(false);
    expect(watching(b).has(get('linchong').uid)).toBe(false);
    // 当回合冲过的马不再动，下回合起自由行动
    expect(m.ai.mode).toBe(8);
    b.endPlayerPhase();
    expect(m.ai.mode).toBe(0);
    const pq = get('pengqi');
    pq.hp = Math.floor(pq.stats.maxHp * 0.2);
    after(b);
    expect(pq.present).toBe(false);
  });

  it('打倒 8 匹连环马之后，在场的好汉全部退进水寨（回合结束判定）才过关，彭玘入伙成我方；阵亡到 4 人判负', () => {
    const { b, get } = open('guashuai');
    toCapture(b, get);
    const hero = get('hero');
    const ws = horses(b).slice(0, 8);
    // 先全员进水寨：还没打满 8 匹，不算
    const ps = b.units.filter((u) => u.side === 'player' && u.present && u.alive);
    const inside = [...Array(14 * 6).keys()].map((k) => ({ x: 11 + (k % 14), y: 4 + Math.floor(k / 14) })).filter((c) => b.board.passable(c.x, c.y));
    ps.forEach((u, i) => Object.assign(u, { x: inside[i * 3].x, y: inside[i * 3].y }));
    freeze(b);
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    // 打倒 8 匹
    for (const u of ws) kill(b, u, hero);
    after(b);
    expect(b.objectives.join('\n')).toContain('水寨');
    // 留一个在外面：不过关
    const out = ps[1];
    Object.assign(out, { x: 18, y: 20 });
    freeze(b);
    b.endPlayerPhase();
    expect(b.status).toBe('playing');
    // 他倒下了，在场的都在水寨里：过关；彭玘作为我方登场
    kill(b, out, hero);
    after(b);
    freeze(b);
    b.endPlayerPhase();
    expect(b.status).toBe('won');
    const pq = get('pengqi-p');
    expect(pq.side).toBe('player');
    expect(pq.present).toBe(true);
  });

  it('我方阵亡到 4 人判负', () => {
    const { b, get } = open('guashuai');
    toCapture(b, get);
    const e = get('g00');
    for (const id of ['qinming', 'linchong', 'huarong']) kill(b, get(id), e);
    after(b);
    expect(b.status).toBe('playing');
    kill(b, get('sunli'), e);
    after(b);
    expect(b.status).toBe('lost');
  });
});
