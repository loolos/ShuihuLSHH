// N01 整场测试：用原版数据跑开场事件、胜负触发，以及双方都由 AI 操作的完整模拟。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import { buildT2S, loadGameData, loadStage, type FileSource } from '../src/rules/load.ts';
import { basicAttack, type SkillDef } from '../src/rules/data.ts';
import { rollAttack } from '../src/rules/combat.ts';
import { Rng } from '../src/rules/rng.ts';
import { computeStats, type Unit } from '../src/rules/unit.ts';
import { readExeTables } from '../src/formats/exe.ts';
import { newCampaign, nextByHeader, partyOf, recordResult } from '../src/rules/campaign.ts';
import { parsePasHeader } from '../src/formats/pas.ts';

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

class NodeFiles implements FileSource {
  private index = new Map<string, string>();
  constructor(root: string) {
    const walk = (d: string, rel: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else this.index.set(r.toLowerCase(), path.join(d, e.name));
      }
    };
    walk(root, '');
  }
  get(p: string) {
    const f = this.index.get(p.toLowerCase());
    if (!f) throw new Error(`missing ${p}`);
    return fs.readFileSync(f);
  }
  has(p: string) {
    return this.index.has(p.toLowerCase());
  }
  list(dir: string, ext: string) {
    return [...this.index.keys()].filter((k) => k.startsWith(dir.toLowerCase() + '/') && k.endsWith(ext));
  }
}

describe.skipIf(!has)('N01', () => {
  const files = has ? new NodeFiles(DATA) : (null as unknown as NodeFiles);
  const tr = has ? buildT2S(files) : (s: string) => s;
  const data = has ? loadGameData(files, tr) : (null as never);
  const make = (seed = 1) => new Battle(loadStage(files, data, 'N01', { simplified: true, seed, text: tr }));

  it('全部职业的第一个技能是 1 级、零消耗的普通/远程攻击', () => {
    for (const c of data.classes) {
      const s = basicAttack(c);
      if (!s) continue; // 宋江等没有技能
      expect(s.learnLevel).toBeLessThanOrEqual(1);
      expect(s.mpCost).toBe(0);
    }
  });

  it('史進 龍爭虎鬥LV1 比普通攻击明显更强（威力 25，原版 10）', () => {
    const cls = data.classes[3];
    const basic = basicAttack(cls)!;
    const s = cls.skills.find((k) => k.skillId === 33)!;
    expect(s.power).toBe(25);
    expect(cls.skills.find((k) => k.skillId === 34)!.power).toBe(45);
    expect(cls.skills.find((k) => k.skillId === 35)!.power).toBe(65);
    expect(s.mpCost).toBe(15);
    // 2 级史進（初始装备）打同级杂兵：期望伤害至少高 30%
    const unit = (classId: number, y: number, facing: number) => {
      const c = data.classes[classId];
      const slots = [...c.defaultItems, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
      return { classId, level: 2, x: 0, y, facing, slots, buffs: [], defending: false, stats: computeStats(c, 2, slots, data) } as unknown as Unit;
    };
    const a = unit(3, 0, 2), t = unit(32, 1, 0);
    const avg = (sk: SkillDef) => {
      const rng = new Rng(7);
      let sum = 0;
      for (let i = 0; i < 4000; i++) sum += rollAttack(a, t, sk, rng).damage;
      return sum / 4000;
    };
    expect(avg(s)).toBeGreaterThan(avg(basic) * 1.3);
  });

  it('武龍 隔山打虎：原版数值，拆成 4 段各 25%，每段单独判定', () => {
    const s = data.classes[0].skills.find((k) => k.skillId === 8)!;
    expect([s.power, s.hitMod, s.critMod, s.mpCost]).toEqual([60, 40, 50, 30]);
    expect(s.hits.map((h) => h.percent)).toEqual([25, 25, 25, 25]);
    const c = data.classes[0];
    const slots = [...c.defaultItems, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
    const a = { classId: 0, level: 2, x: 0, y: 0, facing: 2, slots, buffs: [], defending: false, stats: computeStats(c, 2, slots, data) } as unknown as Unit;
    const g = data.classes[32];
    const gs = [...g.defaultItems, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
    const t = { classId: 32, level: 2, x: 0, y: 1, facing: 0, slots: gs, buffs: [], defending: false, stats: computeStats(g, 2, gs, data) } as unknown as Unit;
    const r = rollAttack(a, t, s, new Rng(1));
    expect(r.parts).toHaveLength(4);
    expect(r.partCrit).toHaveLength(4);
  });

  it('通行：开局起点 (4,4) 能走到的格子数（EXE 规则）', () => {
    const b = make();
    const seen = new Set(['4,4']);
    const q = [[4, 4]];
    while (q.length) {
      const [x, y] = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || !b.board.passable(x + dx, y + dy)) continue;
        seen.add(k);
        q.push([x + dx, y + dy]);
      }
    }
    expect(seen.size).toBe(2051);
  });

  it('训练关：选人后显示回合限制，第 25 回合结束时过关（组合条件"回合 25 或我方全灭"）', () => {
    const b = new Battle(loadStage(files, data, 'Train1', { simplified: true, seed: 1, text: tr }));
    const ev = b.begin();
    expect(ev.some((e) => e.type === 'objective')).toBe(true);
    for (let i = 0; i < 40 && b.status === 'playing'; i++) b.endPlayerPhase();
    expect(b.status).toBe('won');
  });

  it('%M 代入主角绰号', () => {
    expect(data.heroNickname).toBe('关西之虎');
  });

  it('繁→简对照来自 .pab/.pas 对齐', () => {
    expect(tr('王進')).toBe('王进');
    expect(data.heroName).toBe('武龙');
    expect(tr('得到黃金')).toBe('得到黄金');
  });

  it('开场：王進、王母走到 (6,6)/(6,5)，显示对白与胜负条件，武龍未登场', () => {
    const b = make();
    const ev = b.begin();
    expect(ev.filter((e) => e.type === 'say')).toHaveLength(6);
    expect(ev.find((e) => e.type === 'objective')).toBeTruthy();
    expect(b.turnLimit).toBe(50);
    const wj = b.unitByChar(1)!, mom = b.unitByChar(18)!;
    expect([wj.x, wj.y, mom.x, mom.y]).toEqual([6, 6, 6, 5]);
    expect(b.unitByChar(0)).toBeUndefined();
    expect(wj.slots.filter(Boolean).length).toBeGreaterThan(0); // 职业默认道具（EXE 0x4048ac）
    // 开局武龍、王進各带 2 个狗皮膏藥（156）【新】
    for (const u of b.units.filter((x) => x.classId === 0 || x.classId === 1)) expect(u.slots.filter((s) => s === 156)).toHaveLength(2);
  });

  it('第 3 回合武龍登场', () => {
    const b = make();
    b.begin();
    b.endPlayerPhase(); // → 第 2 回合
    expect(b.unitByChar(0)).toBeUndefined();
    const ev = b.endPlayerPhase(); // → 第 3 回合
    expect(b.turn).toBe(3);
    expect(ev.find((e) => e.type === 'appear')).toBeTruthy();
    expect(b.unitByChar(0)).toBeTruthy();
  });

  it('王母进入撤退区域即胜利；王進战败即失败', () => {
    const b = make();
    b.begin();
    const mom = b.unitByChar(18)!;
    mom.x = 24;
    mom.y = 52;
    // 任意一次行动后检查区域
    const ev: BattleEvent[] = b.move(b.unitByChar(1)!, 6, 7);
    expect(b.status).toBe('won');
    expect(ev.at(-1)).toMatchObject({ type: 'end', result: 'won' });

    const c = make();
    c.begin();
    const wj = c.unitByChar(1)!;
    wj.hp = 1;
    wj.stats.agility = 0;
    // 让敌人连续行动直到王進战败
    for (let i = 0; i < 30 && c.status === 'playing'; i++) c.endPlayerPhase();
    expect(c.status).toBe('lost');
  });

  it('整场模拟：双方都用 AI，不出错，并在 50 回合内结束', () => {
    for (const seed of [1, 2, 3]) {
      const b = make(seed);
      b.begin();
      let guard = 0;
      while (b.status === 'playing' && guard++ < 60) {
        for (const u of b.active().filter((x) => x.side === 'player')) {
          if (b.status !== 'playing') break;
          const plan = planAi(b, u);
          if (plan.path && plan.path.length > 1) {
            const last = plan.path.at(-1)!;
            b.move(u, last.x, last.y);
          }
          if (plan.target && b.attackTargets(u).includes(plan.target)) b.attack(u, plan.target);
          else b.wait(u);
        }
        b.endPlayerPhase();
      }
      expect(b.status).not.toBe('playing');
      expect(b.turn).toBeLessThanOrEqual(51);
    }
  });

  it('剧本：1000 + 编组号点名、点名即登场、17 = 2 退场', () => {
    const add01 = new Battle(loadStage(files, data, 'N-add01', { seed: 1, text: tr }));
    add01.begin();
    expect(add01.active().filter((u) => u.side === 'enemy')).toHaveLength(7);
    expect(add01.status).toBe('playing');
    const add02 = new Battle(loadStage(files, data, 'N-add02', { seed: 1, text: tr }));
    const ev = add02.begin();
    expect(ev.filter((e) => e.type === 'leave').map((e) => e.type === 'leave' && add02.unit(e.uid)!.classId).sort()).toEqual([1, 18]);
    // N-add03：王進与莊客埋伏（17 = 2 / 模式 9），嘍囉登场逃跑；我方阶段开始时询问是否号令
    const add03 = new Battle(loadStage(files, data, 'N-add03', { seed: 1, text: tr }));
    const ev3 = add03.begin();
    expect(ev3.find((e) => e.type === 'say')).toMatchObject({ uid: 5 }); // 编组 6 = 王進
    expect(add03.active().filter((u) => u.side === 'enemy')).toHaveLength(5);
    expect(add03.active().filter((u) => u.side !== 'enemy')).toHaveLength(0);
    expect(ev3.at(-1)).toMatchObject({ type: 'ask', prompt: data.prompts![0] });
    expect(data.prompts![0].options).toEqual(['是', '否']);
    expect(data.prompts![0].replies[0].text).toBe('好！大家上！');
    const sig = add03.signal();
    expect(add03.active().filter((u) => u.side !== 'enemy')).toHaveLength(3);
    expect(sig.some((e) => e.type === 'say' && e.text.includes('有埋伏'))).toBe(true);
    expect(add03.awaitingSignal).toBe(false);
  });

  it('第 1–3 章：关卡顺序、过场开场即过关、人物延续', () => {
    const stages = readExeTables(files.get('ShuiHu.exe')).stages.filter((s) => s.mapName && files.has(`Map/${s.mapName}.act`));
    const order: string[] = [];
    let c = newCampaign(0);
    for (let i = 0; i < 14; i++) {
      const st = stages.find((s) => s.index === c.stage)!;
      order.push(st.mapName);
      const b = new Battle(loadStage(files, data, st.mapName, { seed: 1, text: tr, party: partyOf(c) }));
      b.begin();
      if (/^act/i.test(st.mapName)) expect(b.status, st.mapName).toBe('won');
      for (const u of b.units) if (u.side === 'player') u.level += 1; // 假装打赢升了级
      c = recordResult(c, b);
      const h = nextByHeader(b.header!);
      if (st.mapName === 'act3-4') expect(h).toEqual({ next: 14, route: { prompt: 1, alt: 15 } });
      c = { ...c, stage: h.next };
    }
    expect(order.join(' ')).toBe('n01 n-add01 n-add02 act2-2 act2-3 n02 n-add03 act3-1 act3-2 act3-3 n03 act3-4 n-add04a act5-1a');
    expect(c.members.find((m) => m.classId === 0)!.level).toBeGreaterThan(5);
  });

  it('剧本头串起全部关卡，分路两条线汇合', () => {
    const stages = readExeTables(files.get('ShuiHu.exe')).stages;
    const header = (i: number) => parsePasHeader(files.get(`Map/${stages[i].mapName}.pab`));
    const seen: string[] = [];
    for (let i = 0; i < stages.length && stages[i]?.mapName; ) {
      seen.push(stages[i].mapName);
      const h = nextByHeader(header(i));
      if (h.route) {
        // 小径那一关结束后回到大道那一关的下一关
        expect(header(h.route.alt).next).toBe(header(h.next).next);
        seen.push(stages[h.route.alt].mapName);
      }
      i = h.next;
    }
    expect(seen.length).toBeGreaterThan(55);
    expect(seen.at(-1)).toBe('n14');
    expect(seen).toContain('n-add09b');
    expect(data.prompts![1].options).toEqual(['大道', '小径']);
  });
});
