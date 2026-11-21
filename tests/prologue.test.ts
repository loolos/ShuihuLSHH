// 序章「禁军教场」（教学关，docs/game-design.md §15.26）：按提示一步一步操作王进，每步做对了才放下一步，最后高俅点卯过关。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterLabel, chapterOf, chapterSequence, insertPlaces } from '../src/rules/chapters.ts';
import { newCampaign, pendingInsert } from '../src/rules/campaign.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import { attackSkill } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('序章 禁军教场', () => {
  const rt = loadPackFromDisk('mainline');
  const files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const make = (id = 'jiaochang', seed = 1) => new Battle(compileStage(rt, stage(id), files, { seed }));
  const get = (b: Battle, id: string) => b.units[stage('jiaochang').units.findIndex((u) => u.id === id)];
  const said = (ev: BattleEvent[], text: string) => ev.some((e) => 'text' in e && typeof e.text === 'string' && e.text.includes(text));

  it('排在第一章之前，新开战役先演序章两段再进 N01', () => {
    const seq = chapterSequence();
    expect(seq.slice(0, 3).map((x) => x.key)).toEqual(['mainline/jiaochang', 'mainline/xihuamen', 'N01']);
    expect(chapterOf('N01')).toBe(1);
    expect(chapterLabel(0)).toBe('序章 禁军教头');
    expect(chapterLabel(1)).toBe('第一章 私走延安府');
    const places = insertPlaces();
    expect(places.find((p) => p.ref === 'mainline/jiaochang')?.before).toBe('N01');
    expect(pendingInsert(newCampaign(), places, 'N01')).toBe('mainline/jiaochang');
    expect(pendingInsert(newCampaign(), places, 'N01', 'before', 'mainline/jiaochang')).toBe('mainline/xihuamen');
    expect(pendingInsert(newCampaign(), places, 'N01', 'before', 'mainline/xihuamen')).toBeUndefined();
  });

  it('落点都在能走的空格上；王进带着两贴狗皮膏药', () => {
    for (const id of ['jiaochang', 'xihuamen']) {
      const b = make(id);
      const seen = new Set<string>();
      for (const u of stage(id).units) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id}`).toBe(false);
        seen.add(`${u.x},${u.y}`);
      }
    }
    expect(get(make(), 'wangjin').slots.filter((x) => x === 156)).toHaveLength(2);
  });

  it('跳过教学：直接演高俅点卯，过关', () => {
    const b = make();
    b.begin();
    expect(b.pendingChoice).toBeTruthy();
    const ev = b.answer(1);
    expect(said(ev, '你爷是街市上使花棒卖药的')).toBe(true);
    expect(b.status).toBe('won');
  });

  it('剧本文字带多语言编号「mainline/关卡#n」（§10.3），剧情选项每项也有', () => {
    const input = compileStage(rt, stage('jiaochang'), files, { seed: 1 });
    const ops = input.blocks.flatMap((b) => b.ops);
    expect(ops.find((o) => o.op === 13 && o.text?.startsWith('教头病好了'))?.tid).toBe('mainline/jiaochang#5');
    const choice = ops.find((o) => o.op === 120)!;
    expect(choice.tid).toBe('mainline/jiaochang#10');
    expect(choice.args?.options?.map((o) => o.tid)).toEqual(['mainline/jiaochang#8', 'mainline/jiaochang#9']);
    expect(ops.filter((o) => o.text?.startsWith('#'))).toEqual([]);
  });

  it('纯剧情「夜出西华门」开战即过关', () => {
    const b = make('xihuamen');
    const ev = b.begin();
    expect(said(ev, '三十六着，走为上着')).toBe(true);
    expect(b.status).toBe('won');
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('照提示一步步操作能走完 8 步并过关（种子 %i）', (seed) => {
    const b = make('jiaochang', seed);
    const wj = get(b, 'wangjin');
    b.begin();
    let ev = b.answer(0);
    expect(said(ev, '教学 1/8')).toBe(true);
    // 1 移动到标记格（地图上标成目标区域）
    expect(b.objectiveZones().some((z) => z.x1 === 9 && z.y1 === 10)).toBe(true);
    ev = b.move(wj, 9, 10);
    expect(said(ev, '教学 2/8')).toBe(true);
    const p2 = get(b, 'p2');
    expect(p2.present).toBe(true);
    // 2 攻击：没打中就下回合再来
    b.move(wj, 9, 9);
    let guard = 0;
    while (p2.present && guard++ < 10) {
      if (b.canAct(wj)) ev = b.attack(wj, p2);
      if (p2.present) b.endPlayerPhase();
    }
    expect(said(ev, '教学 3/8')).toBe(true);
    // 3 背后：先从正面打一下只给提示，再绕到背后
    if (!b.canAct(wj)) b.endPlayerPhase();
    const p3a = get(b, 'p3a');
    // p3a 在 (7,8) 面朝北（朝向 0）：从南边 (7,9) 打是背后，(6,8)、(8,8) 是侧面，北边 (7,7) 是正面
    ev = b.move(wj, 7, 9);
    ev = b.attack(wj, p3a);
    expect(said(ev, '教学 4/8')).toBe(true);
    expect(get(b, 'p4a').present).toBe(true);
    // 4 防御：已出手，先过一回合；下回合选防御，等对方打过来
    ev = b.endPlayerPhase();
    guard = 0;
    while (!said(ev, '教学 5/8') && guard++ < 6) {
      b.defend(wj);
      ev = b.endPlayerPhase();
    }
    expect(said(ev, '教学 5/8')).toBe(true);
    // 5 技能：一柱擎天（射程 2）打陪练军士
    const skill = learnedSkills(wj, b.data).find((s) => s !== attackSkill(wj, b.data) && s.mpCost > 0 && b.skillTargets(wj, s).length)
      ?? learnedSkills(wj, b.data).find((s) => s !== attackSkill(wj, b.data) && s.mpCost > 0)!;
    guard = 0;
    while (!said(ev, '教学 6/8') && guard++ < 6) {
      if (!b.canAct(wj)) { ev = b.endPlayerPhase(); continue; }
      const targets = ['p5a', 'p5b', 'p5c'].map((id) => get(b, id));
      // 走到能打到的地方
      const spot = b.moveRange(wj).green.concat([{ x: wj.x, y: wj.y }]).find((c) => b.skillTargets(wj, skill, c).some((t) => targets.some((p) => p.x === t.x && p.y === t.y)));
      if (spot && (spot.x !== wj.x || spot.y !== wj.y)) b.move(wj, spot.x, spot.y);
      const cell = b.skillTargets(wj, skill).find((t) => targets.some((p) => p.x === t.x && p.y === t.y));
      ev = cell ? b.useSkill(wj, skill, cell) : b.endPlayerPhase();
    }
    expect(said(ev, '教学 6/8')).toBe(true);
    // 6 道具（出过手就不能用道具，下回合）7 休息
    if (!b.canAct(wj)) b.endPlayerPhase();
    ev = b.useItem(wj, wj.slots.indexOf(156), wj);
    expect(said(ev, '教学 7/8')).toBe(true);
    ev = b.rest(wj);
    expect(said(ev, '教学 8/8')).toBe(true);
    const zp = get(b, 'zhangpai');
    expect(zp.side).toBe('player');
    expect(b.objectiveZones().some((z) => z.x1 === 8 && z.y1 === 4)).toBe(true);
    // 8 张牌走进将台，过关
    guard = 0;
    while (b.status === 'playing' && guard++ < 12) {
      if (b.phase === 'player') {
        if (b.canMove(zp)) {
          const field = b.board.distanceField([{ x: 9, y: 4 }, { x: 8, y: 4 }, { x: 10, y: 4 }, { x: 9, y: 5 }]);
          const d = (c: { x: number; y: number }) => field[c.y * b.board.width + c.x];
          const c = b.moveRange(zp).green.reduce((a, g) => (d(g) < d(a) ? g : a), { x: zp.x, y: zp.y });
          if (c.x !== zp.x || c.y !== zp.y) b.move(zp, c.x, c.y);
        }
        if (b.status !== 'playing') break;
        const foe = b.attackTargets(wj)[0];
        if (foe && b.canAct(wj)) b.attack(wj, foe);
        if (b.status === 'playing') b.endPlayerPhase();
      }
    }
    expect(b.status).toBe('won');
    expect(wj.alive && zp.alive).toBe(true);
  });

  it('防御那一步把两个陪练都打得认输了，也接着往下教', () => {
    const b = make();
    const wj = get(b, 'wangjin');
    b.begin();
    b.answer(0);
    b.move(wj, 9, 10);
    const p2 = get(b, 'p2');
    b.move(wj, 9, 9);
    let guard = 0;
    while (p2.present && guard++ < 10) {
      if (b.canAct(wj)) b.attack(wj, p2);
      if (p2.present) b.endPlayerPhase();
    }
    if (!b.canAct(wj)) b.endPlayerPhase();
    b.move(wj, 7, 9);
    b.attack(wj, get(b, 'p3a'));
    const [a, c] = [get(b, 'p4a'), get(b, 'p4b')];
    b.endPlayerPhase();
    // 陪练站着不动，等王进摆出防御架势才攻上来
    expect([a.x, a.y, wj.hp]).toEqual([7, 7, wj.stats.maxHp]);
    a.hp = 1;
    c.hp = 1;
    b.defend(wj);
    const ev = b.endPlayerPhase();
    expect(said(ev, '日后临阵再练')).toBe(true);
    expect(said(ev, '教学 5/8')).toBe(true);
  });

  it('正面打背对的人只给提示，不算过这一步', () => {
    const b = make();
    const wj = get(b, 'wangjin');
    b.begin();
    b.answer(0);
    b.move(wj, 9, 10);
    const p2 = get(b, 'p2');
    b.move(wj, 9, 9);
    let guard = 0;
    while (p2.present && guard++ < 10) {
      if (b.canAct(wj)) b.attack(wj, p2);
      if (p2.present) b.endPlayerPhase();
    }
    b.endPlayerPhase();
    // p3a 在 (7,8) 面朝北（0）；站到北边 (7,7) 往南打是正面
    const p3a = get(b, 'p3a');
    expect(b.move(wj, 7, 7).length).toBeGreaterThan(0);
    const ev = b.attack(wj, p3a);
    expect(said(ev, '那是正面')).toBe(true);
    expect(said(ev, '教学 4/8')).toBe(false);
    expect(get(b, 'p4a').present).toBe(false);
  });
});
