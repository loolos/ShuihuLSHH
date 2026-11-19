// 第二十三章「戴宗传假信」（docs/game-design.md §15.24）：旱地忽律、梁山定计、赚上梁山、假信露馅；新好汉朱贵；萧让、金大坚是书生，由李俊、吕方、郭盛护送。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { chapterLabel, chapterOf } from '../src/rules/chapters.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十三章 戴宗传假信', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const stage = (id: string) => rt.stages.find((s) => s.id === id)!;
  const open = (id: string) => {
    const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
    const ev: BattleEvent[] = [...b.begin()];
    return { s, b, ev, get: (uid: string) => b.units[s.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const turn = (b: Battle, n: number) => (b as unknown as { runTurnTriggers: (n: number) => void }).runTurnTriggers(n);
  const killAll = (b: Battle, onlyPresent = false) => { for (const u of b.units) if (u.side === 'enemy' && (!onlyPresent || u.present)) { u.hp = 0; u.alive = false; u.present = false; } after(b); };
  const ids = ['zhuguidian', 'liangshan-dingji', 'zhuanshang', 'jiaxin'];

  it('第二十三章四关，排在浔阳楼和法场之间；单位站在可通行格、互不重叠，move 都走得到，假信露馅以外我方不超过 5 人（假信露馅负责人要求八人）', () => {
    expect(chapterLabel(23)).toBe('第二十三章 戴宗传假信');
    expect(chapterOf('mainline/xunyanglou')).toBe(22);
    expect(chapterOf('mainline/fachang')).toBe(24);
    for (const id of ids) {
      expect(chapterOf(`mainline/${id}`), id).toBe(23);
      const s = stage(id), b = new Battle(compileStage(rt, s, files, { seed: 1 }));
      const seen = new Set<string>();
      for (const u of s.units.filter((x) => !x.offstage)) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        if (!u.hidden) { expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false); seen.add(`${u.x},${u.y}`); }
      }
      for (const blk of s.script) for (const op of blk.do) if (op[0] === 'move') expect(b.board.passable(op[2] as number, op[3] as number), `${id} ${op.join()}`).toBe(true);
      if (id !== 'jiaxin') expect(s.units.filter((u) => u.side === 'player' && !u.offstage).length, id).toBeLessThanOrEqual(5);
    }
  });

  it('朱贵是新好汉（头领换色，技能按等级领悟）；萧让、金大坚是不动手的书生，只有普通一击', () => {
    const cid = rt.classIds.get('zhugui')!, cls = rt.data.classes[cid];
    expect(cls.skills).toHaveLength(6);
    expect(learnedSkills({ classId: cid, level: 30 } as Unit, rt.data)).toHaveLength(5); // 普通攻击不算
    expect(cls.skills.find((s) => s.name === '蒙汗药酒')!.stun).toBe(60);
    const defs = JSON.parse(fs.readFileSync('packs/mainline/pack.json', 'utf8')).classes as { id: string; sprite: { fromClass: number } }[];
    expect(Object.fromEntries(['zhugui', 'xiaorang', 'jindajian'].map((id) => [id, defs.find((c) => c.id === id)!.sprite.fromClass]))).toEqual({ zhugui: 65, xiaorang: 68, jindajian: 70 });
    for (const id of ['xiaorang', 'jindajian']) expect(rt.data.classes[rt.classIds.get(id)!].skills, id).toHaveLength(1);
  });

  it('旱地忽律：戴宗被麻翻后救醒；朱贵到水亭放号箭，杜迁、宋万坐船来接；打退官军才过关', () => {
    const { b, get, ev } = open('zhuguidian');
    expect(ev.some((e) => e.type === 'say' && /旱地忽律朱贵/.test(e.text))).toBe(true);
    expect(b.isBound(get('daizong'))).toBe(false);
    expect(get('duqian').present).toBe(false);
    killAll(b, true);
    expect(b.status).toBe('playing'); // 还没放号箭
    const zg = get('zhugui'); zg.x = 3; zg.y = 10; after(b);
    expect(get('duqian').present).toBe(true);
    expect(get('songwan').present).toBe(true);
    expect(get('shichen').present).toBe(true);
    killAll(b);
    expect(b.status).toBe('won');
  });

  it('梁山定计演完就过关', () => {
    const { b, ev } = open('liangshan-dingji');
    expect(b.status).toBe('won');
    expect(ev.some((e) => e.type === 'say' && /萧名让/.test(e.text))).toBe(true);
  });

  it('赚上梁山：王英假劫只是过场；戴宗和李俊、吕方、郭盛护着萧让、金大坚（友军、只会躲）打退济州官兵', () => {
    const { s: st, b, get } = open('zhuanshang');
    expect(st.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['daizong', 'guosheng', 'lijun', 'lvfang']);
    for (const id of ['xiaorang', 'jindajian']) expect(get(id)).toMatchObject({ side: 'ally', present: true });
    for (const id of ['wangying', 'yanshun']) expect(get(id)).toMatchObject({ side: 'ally', present: true });
    expect(get('xunjian').present).toBe(true);
    killAll(b);
    expect(b.status).toBe('won');
  });

  it('假信露馅：武龙带李俊、吕方、郭盛、朱贵、王英、燕顺冲进府衙；有人走到戴宗身边，戴宗交代后被擒；武龙从北面后门杀出去才过关（地图用大闹太尉府）；之后进梁山泊整备', () => {
    const { b, get, s } = open('jiaxin');
    expect(s.townAfter).toBe(11);
    expect(s.units.filter((u) => u.side === 'player').map((u) => u.id).sort()).toEqual(['daizong', 'guosheng', 'hero', 'lijun', 'lvfang', 'wangying', 'yanshun', 'zhugui']);
    const hero = get('hero'), dz = get('daizong'), wy = get('wangying');
    wy.x = dz.x + 1; wy.y = dz.y; after(b);
    expect(dz.present).toBe(false);
    expect(get('g1').present).toBe(true);
    expect(b.status).toBe('playing');
    hero.x = 16; hero.y = 0; after(b);
    expect(b.status).toBe('won');
  });
});
