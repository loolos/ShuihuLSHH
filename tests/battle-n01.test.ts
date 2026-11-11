// N01 整场测试：用原版数据跑开场事件、胜负触发，以及双方都由 AI 操作的完整模拟。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import { buildT2S, loadGameData, loadStage, type FileSource } from '../src/rules/load.ts';
import { basicAttack } from '../src/rules/data.ts';

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
});
