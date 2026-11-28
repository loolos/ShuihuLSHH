// 第三十五章「呼延灼挂帅」：过场高太尉大兴三路兵、战斗呼延灼挂帅（连环马光环、集体冲锋、打倒 8 匹后全员退进水寨，docs/game-design.md §15.36）
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

  it('车轮战捉彭玘：彭玘体力不到三成被扈三娘活捉；下一回合敌军回合开始第一批连环马冲锋（撞人、挤开、喽啰逃窜）；三回合后第二批从两翼冲锋', () => {
    const { b, get } = open('guashuai');
    const pq = get('pengqi');
    expect(pq.present).toBe(true);
    for (const id of ['ma0', 'mb0', 'nu0']) expect(get(id).present, id).toBe(false);
    // 彭玘体力打到三成以下
    pq.hp = Math.floor(pq.stats.maxHp * 0.2);
    after(b);
    expect(pq.present).toBe(false);
    // 第 1 回合的敌军回合：连环马还不来（给玩家一整个回合）
    freeze(b);
    b.endPlayerPhase();
    expect(get('ma0').present).toBe(false);
    // 第 2 回合：把一个好汉、一个喽啰摆在第一排马的正前方
    const lead = horses(b).filter((u) => u.uid <= get('ma7').uid && u.uid >= get('ma0').uid);
    const m = lead.find((u) => u.uid === get('ma0').uid)!;
    const qm = get('qinming');
    Object.assign(qm, { x: m.x, y: m.y - 6 });
    const lb = get('lb0');
    const hp0 = qm.hp;
    freeze(b);
    const ev = b.endPlayerPhase();
    for (const u of lead) expect(u.present, u.name).toBe(true);
    for (const id of ['nu0', 'nu3']) expect(get(id).present, id).toBe(true);
    expect(get('mb0').present).toBe(false);
    // 秦明被撞：掉血、被挤到旁边（不在原来那一列），撞不死
    expect(qm.hp).toBeLessThan(hp0);
    expect(qm.hp).toBeGreaterThan(0);
    expect(qm.x).not.toBe(m.x);
    expect(ev.some((e) => e.type === 'hp' && e.uid === qm.uid && (e as { text?: string }).text === '被撞')).toBe(true);
    // 马冲了十来格；喽啰逃窜两回合
    expect(m.y).toBeLessThan(get('ma0').y + 1);
    expect(lb.alive && lb.panicTurns).toBeTruthy();
    // 三回合后第二批从两翼冲锋
    for (let i = 0; i < 2; i++) { freeze(b); b.endPlayerPhase(); expect(get('mb0').present).toBe(false); }
    freeze(b);
    b.endPlayerPhase(); // 第 5 回合的敌军回合
    expect(b.turn).toBe(6);
    for (let i = 0; i < 8; i++) expect(get(`mb${i}`).present, `mb${i}`).toBe(true);
  });

  it('没捉到彭玘也是第 6 回合敌军回合开始出阵', () => {
    const { b, get } = open('guashuai');
    for (let i = 0; i < 5; i++) { freeze(b); b.endPlayerPhase(); expect(get('ma0').present, `第 ${b.turn} 回合`).toBe(false); }
    freeze(b);
    b.endPlayerPhase();
    expect(get('ma0').present).toBe(true);
  });

  it('打倒 8 匹连环马之后，在场的好汉全部退进水寨（回合结束判定）才过关，彭玘入伙成我方；阵亡到 4 人判负', () => {
    const { b, get } = open('guashuai');
    for (let i = 0; i < 6; i++) { freeze(b); b.endPlayerPhase(); }
    const hero = get('hero');
    const ws = horses(b).filter((u) => u.present);
    expect(ws.length).toBe(8);
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
    const e = get('g00');
    for (const id of ['qinming', 'linchong', 'huarong']) kill(b, get(id), e);
    after(b);
    expect(b.status).toBe('playing');
    kill(b, get('sunli'), e);
    after(b);
    expect(b.status).toBe('lost');
  });
});
