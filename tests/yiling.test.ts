// 第二十七章「沂岭杀四虎」（docs/game-design.md §15.29）：沂岭杀四虎；朱富酒店下蒙汗药（劝酒、酒席上动手会惊动旁人）救李逵、劝李云入伙
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { compileStage, stageKind } from '../src/packs/build.ts';
import { chapterOf } from '../src/rules/chapters.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('第二十七章 沂岭杀四虎', () => {
  useDiskCustomMaps();
  const rt = loadPackFromDisk('mainline'), files = new NodeFiles(DATA);
  const open = (id: string) => {
    const stage = rt.stages.find((s) => s.id === id)!;
    const b = new Battle(compileStage(rt, stage, files, { seed: 1 }));
    b.begin();
    return { b, stage, get: (uid: string) => b.units[stage.units.findIndex((u) => u.id === uid)] };
  };
  const after = (b: Battle) => (b as unknown as { afterAction: () => void }).afterAction();
  const kill = (u: Unit) => { u.hp = 0; u.alive = false; u.present = false; };
  const flagged = (b: Battle) => (b as unknown as { flags: Set<number> }).flags.size > 0;
  const skill = (b: Battle, u: Unit, name: string) => learnedSkills(u, b.data).find((s) => s.name === name)!;

  it('两关接在父子团圆后面，单位站在可通行的格子上、互不重叠', () => {
    expect(chapterOf('mainline/yiling')).toBe(27);
    expect(chapterOf('mainline/caozhuang')).toBe(27);
    expect(chapterOf('mainline/zhufu')).toBe(27);
    for (const id of ['yiling', 'caozhuang', 'zhufu']) {
      const { b, stage } = open(id);
      const seen = new Set<string>();
      for (const u of stage.units) {
        expect(b.board.passable(u.x, u.y), `${id} ${u.id}`).toBe(true);
        expect(seen.has(`${u.x},${u.y}`), `${id} ${u.id} 重叠`).toBe(false);
        seen.add(`${u.x},${u.y}`);
      }
    }
  });

  it('沂岭：先两只小虎，打完母大虫出洞，再起一阵风跳出吊睛白额虎，四虎杀尽过关', () => {
    const { b, get } = open('yiling');
    expect(b.status).toBe('playing');
    expect([get('cub1').present, get('cub2').present, get('tigress').present, get('tiger').present]).toEqual([true, true, false, false]);
    expect(get('niang').present).toBe(false);
    kill(get('cub1')); kill(get('cub2')); after(b);
    expect(get('tigress').present).toBe(true);
    expect(get('tiger').present).toBe(false);
    kill(get('tigress')); after(b);
    expect(get('tiger').present).toBe(true);
    expect(b.status).toBe('playing');
    kill(get('tiger')); after(b);
    expect(b.status).toBe('won');
  });

  it('选关里沂岭、杯酒救铁牛标战役，曹庄醉缚标剧情', () => {
    const kind = (id: string) => stageKind(rt.stages.find((s) => s.id === id)!);
    expect([kind('yiling'), kind('caozhuang'), kind('zhufu'), kind('chuanhuoer')]).toEqual(['战役', '剧情', '战役', '剧情']);
  });

  it('曹庄醉缚是过场：演完就过关', () => {
    const { b } = open('caozhuang');
    expect(b.status).toBe('won');
  });

  it('朱贵扮店小二，只在这一关会劝酒', () => {
    const { b, get } = open('zhufu');
    const zg = get('zhugui'), g = get('b1');
    const jiu = skill(b, zg, '劝酒');
    expect(jiu).toBeDefined();
    zg.x = 10; zg.y = 17;
    const ev = b.useSkill(zg, jiu, g);
    expect(g.stunTurns).toBe(8);
    // 劝酒时说一句台词（扮店小二的口吻）
    expect(ev.find((e) => e.type === 'say')).toMatchObject({ uid: zg.uid, text: '热酒热肉管够，都是我家主人孝敬的！' });
    expect(flagged(b)).toBe(false);
    // 换一关（或这一关之外）就没有了
    expect(learnedSkills({ ...zg, extraSkills: undefined }, b.data).some((s) => s.name === '劝酒')).toBe(false);
  });

  it('沂岭的老虎比景阳冈那只弱得多', () => {
    const { get } = open('yiling');
    const jy = open('jingyanggang').get('tiger');
    expect(get('tiger').stats.maxHp).toBeLessThan(jy.stats.maxHp * 0.6);
    expect(get('tigress').stats.maxHp).toBeLessThan(jy.stats.maxHp * 0.5);
    expect(get('tiger').stats.attack).toBeLessThan(jy.stats.attack * 0.85);
  });

  it('劝酒：不伤人、麻翻土兵，不惊动人；打麻翻了、身边没人醒着的也不惊动', () => {
    const { b, get } = open('zhufu');
    const jb = get('jiubao2'), g = get('b1');
    const jiu = skill(b, jb, '劝酒');
    jb.x = 10; jb.y = 17;
    const hp = g.hp;
    b.useSkill(jb, jiu, g);
    expect(g.hp).toBe(hp);
    expect(g.stunTurns).toBe(8);
    expect(flagged(b)).toBe(false);
    expect(get('b2').ai.mode).toBe(8);
    // 已经麻翻的不能再劝
    expect(b.affected(get('jiubao1'), skill(b, get('jiubao1'), '劝酒'), g)).toEqual([]);
    // 把乙队都麻翻，再打其中一个：身边两格没人醒着，不惊动
    for (const id of ['b2', 'b3', 'b4', 'b5', 'b6']) get(id).stunTurns = 8;
    const zf = get('zhufu');
    zf.x = 10; zf.y = 17; zf.acted = false; jb.x = 13; jb.y = 15;
    b.attack(zf, get('b1'));
    expect(flagged(b)).toBe(false);
  });

  it('打醒着的人就惊动：押解的人都动起来，曹太公往板桥跑', () => {
    const { b, get } = open('zhufu');
    const zf = get('zhufu');
    zf.x = 17; zf.y = 9;
    b.attack(zf, get('a1'));
    expect(get('a2').ai.mode).toBe(0);
    expect(get('c1').ai.mode).toBe(0);
    expect(get('caotaigong').ai.mode).toBe(4);
    // 一开打两个酒保就退场
    expect([get('jiubao1').present, get('jiubao2').present]).toEqual([false, false]);
  });

  it('李云只喝朱富劝的酒，还要推辞一次，喝了只麻翻两回合', () => {
    const { b, get } = open('zhufu');
    const ly = get('liyun'), jb = get('jiubao1'), zf = get('zhufu');
    jb.x = 20; jb.y = 11;
    b.useSkill(jb, skill(b, jb, '劝酒'), ly);
    expect(ly.stunTurns).toBe(0);
    jb.x = 13; jb.y = 15; zf.x = 20; zf.y = 11;
    const jiu = skill(b, zf, '劝酒');
    b.useSkill(zf, jiu, ly);
    expect(ly.stunTurns).toBe(0);
    zf.acted = false; zf.ended = false; zf.mp = zf.stats.maxMp;
    b.useSkill(zf, jiu, ly);
    expect(ly.stunTurns).toBe(2);
    expect(flagged(b)).toBe(true); // 推辞过一次（剧本标志），没有惊动
    expect(get('a1').ai.mode).toBe(8);
  });

  it('朱贵走到李逵身边割断绳索：李逵能动了，同时惊动众人；把敌人都打倒就过关', () => {
    const { b, stage, get } = open('zhufu');
    const lk = get('likui');
    expect(lk.stunTurns).toBeGreaterThan(0);
    const zg = get('zhugui');
    zg.x = 18; zg.y = 10; after(b);
    expect(lk.stunTurns).toBe(0);
    expect(get('a1').ai.mode).toBe(0);
    for (const u of stage.units) if (u.side === 'enemy') kill(get(u.id));
    after(b);
    expect(b.status).toBe('won');
  });

  it('李云还麻翻着时救出李逵，台词不一样：李云不喊「有奸细」', () => {
    const { b, get } = open('zhufu');
    const ly = get('liyun'), zf = get('zhufu');
    zf.x = 20; zf.y = 11;
    const jiu = skill(b, zf, '劝酒');
    b.useSkill(zf, jiu, ly);
    zf.acted = false; zf.ended = false; zf.mp = zf.stats.maxMp;
    b.useSkill(zf, jiu, ly);
    expect(ly.stunTurns).toBe(2);
    const zg = get('zhugui');
    zg.x = 18; zg.y = 10;
    const out = (b as unknown as { out: { type: string; text?: string }[] }).out;
    out.length = 0;
    after(b);
    const texts = out.filter((e) => e.type === 'say' || e.type === 'narrate').map((e) => e.text ?? '').join('|');
    expect(get('likui').stunTurns).toBe(0);
    expect(get('a1').ai.mode).toBe(0);
    expect(texts).toContain('李都头还醉着');
    expect(texts).toContain('叫唤不醒');
    expect(texts).not.toContain('有奸细');
  });

  it('李云血少了，朱富走到身边就劝他入伙：土兵逃散、李云成了友军，还要打倒猎户才过关', () => {
    const { b, get } = open('zhufu');
    const ly = get('liyun');
    get('b1').stunTurns = 8; // 麻翻的土兵不跑，继续睡
    ly.hp = Math.floor(ly.stats.maxHp * 0.4);
    after(b);
    const zf = get('zhufu');
    zf.x = 20; zf.y = 11; after(b);
    expect(b.status).toBe('playing');
    expect(get('b1').present).toBe(true);
    kill(get('b1'));
    expect(ly.side).toBe('ally');
    for (const id of ['a1', 'a6', 'b2', 'b6']) expect(get(id).present, id).toBe(false);
    const hunters = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(get);
    expect(hunters.every((h) => h.present && h.ai.mode === 0)).toBe(true);
    expect(get('caotaigong').ai.mode).toBe(4);
    for (const h of hunters) kill(h);
    kill(get('caotaigong'));
    after(b);
    expect(b.status).toBe('won');
  });

});
