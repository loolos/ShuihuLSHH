// 主线对白补的原著原文【新】：每处定位句都找得到，原版 / 简体两份剧本插在同一位置，过场演出时按顺序说出来。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePasBlocks } from '../src/formats/pas.ts';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, findStageFile, loadGameData, loadStage } from '../src/rules/load.ts';
import { STORY_DEATH_BLOCKS, STORY_INSERTS, STORY_REPLACE, applyStoryQuotes } from '../src/rules/story-quotes.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
const STAGES: Record<string, string> = {
  'n-add01': 'N-add01', 'act2-2': 'Act2-2', n02: 'N02', n03: 'N03', 'act3-4': 'Act3-4', 'act5-1': 'Act5-1', 'act5-2': 'Act5-2',
  'act5-3': 'Act5-3', n05: 'N05', 'act8-1': 'Act8-1', 'n-add10': 'N-add10', n09: 'N09', 'act10-1': 'Act10-1',
  'act9-1': 'Act9-1', 'act14-2': 'Act14-2', 'act14-3': 'Act14-3', n13: 'N13',
};

describe.skipIf(!has)('主线对白补原著原文', () => {
  const files = new NodeFiles(DATA);
  const tr = buildT2S(files);

  it('每处都插上、换上，两份剧本一一对应', () => {
    const keys = new Set([...Object.keys(STORY_INSERTS), ...Object.keys(STORY_REPLACE), ...Object.keys(STORY_DEATH_BLOCKS)]);
    for (const key of keys) {
      const stage = STAGES[key];
      expect(stage, key).toBeDefined();
      const big5 = applyStoryQuotes(stage, parsePasBlocks(files.get(findStageFile(files, stage, '.pab')!), 'big5'), tr);
      const gbk = applyStoryQuotes(stage, parsePasBlocks(files.get(findStageFile(files, stage, '.pas')!), 'gbk'));
      expect(big5.missing, stage).toEqual([]);
      expect(gbk.missing, stage).toEqual([]);
      expect(gbk.blocks.length, stage).toBe(big5.blocks.length);
      gbk.blocks.forEach((b, i) => expect(b.ops.map((o) => o.op), `${stage} #${i}`).toEqual(big5.blocks[i].ops.map((o) => o.op)));
      const texts = gbk.blocks.flatMap((b) => b.ops.map((o) => o.text ?? ''));
      const logicTexts = big5.blocks.flatMap((b) => b.ops.map((o) => o.text ?? ''));
      for (const r of Object.values(STORY_REPLACE[key] ?? {})) {
        expect(texts, stage).toContain(r);
        expect(logicTexts, stage).toContain(r);
      }
      for (const ins of STORY_INSERTS[key] ?? []) for (const [, t] of ins.lines) expect(texts, stage).toContain(t);
    }
  });

  const play = (stage: string) => {
    const data = loadGameData(files, tr);
    const b = new Battle(loadStage(files, data, stage, { simplified: true, seed: 1, text: tr }));
    return { b, ev: b.begin() };
  };
  const says = (ev: BattleEvent[]) => ev.flatMap((e) => (e.type === 'say' ? [`${e.speaker}：${e.text}`] : []));

  it('沧州设毒计：柴进安排草料场差事，洪教头只获悉消息，不再写信诱约', () => {
    const { b, ev } = play('Act9-1');
    expect(b.status).toBe('won');
    const lines = ev.flatMap((e) => e.type === 'say' || e.type === 'narrate' ? [e.text] : []).join('\n');
    expect(lines).toContain('柴进托人替林冲');
    expect(lines).toContain('这差事不是我安排的');
    expect(lines).toContain('纵然侥幸逃出');
    expect(lines).not.toMatch(/用信件|诱出来|要胁|出来私了/);
  });

  it('火烧草料场：采购归来见火，听完三人毒计后才现身交战', () => {
    const { b, ev } = play('N09');
    expect(b.status).toBe('playing');
    expect(b.turnLimit).toBe(40);
    const lines = ev.flatMap((e) => e.type === 'say' || e.type === 'narrate' ? [e.text] : []);
    const find = (text: string) => lines.findIndex((l) => l.includes(text));
    const supply = find('一道出外采买修屋的材料');
    const fire = find('不好！草料场怎么已经烧起来了');
    const hide = find('听听动静');
    const confession = find('点了十来处火');
    const sentence = find('也得个死罪');
    const reveal = find('随他现身');
    const challenge = find('泼贼！你们竟放火害我');
    expect(supply).toBeGreaterThanOrEqual(0);
    expect(fire).toBeGreaterThan(supply);
    expect(hide).toBeGreaterThan(fire);
    expect(confession).toBeGreaterThan(hide);
    expect(sentence).toBeGreaterThan(confession);
    expect(reveal).toBeGreaterThan(sentence);
    expect(challenge).toBeGreaterThan(reveal);
    expect(lines.join()).not.toMatch(/挑战书|不赴约|把你叫到这里/);
    expect(ev.some((e) => e.type === 'attack')).toBe(false);
    // 纯文字调整不改原版战斗触发、增援与胜负条件指令。
    const input = loadStage(files, loadGameData(files, tr), 'N09', { text: tr, simplified: true });
    const raw = parsePasBlocks(files.get(findStageFile(files, 'N09', '.pab')!), 'big5');
    const gameplay = (blocks: typeof raw) => blocks.map((b) => ({ trigger: b.trigger, ops: b.ops.filter((o) => o.op !== 12 && o.op !== 13) }));
    expect(gameplay(input.blocks)).toEqual(gameplay(raw));
  });

  it('黄泥冈：白胜先唱歌后登场，原来的对白照常接上', () => {
    const { ev } = play('Act10-1');
    const lines = says(ev);
    const song = lines.findIndex((l) => l.includes('赤日炎炎似火烧'));
    expect(lines[song]).toMatch(/^白胜：/);
    expect(lines[song + 1]).toMatch(/^白胜：客官们买桶白酒吧！/);
  });

  it('插入之后把原来的说话者点回来', () => {
    // 史家庄：王进说完"赢不得真好汉"之后，史太公接着说结义的话
    const lines = says(play('Act2-2').ev);
    const i = lines.findIndex((l) => l.includes('受徒弟一拜'));
    expect(lines[i]).toMatch(/^史进：/);
    expect(lines[i + 1]).toMatch(/^史太公：对了/);
    // 桃花村：李忠认出鲁达后，鲁智深说"原来都是故人"
    const t = says(play('Act5-1').ev);
    expect(t.find((l) => l.includes('原来都是故人'))).toMatch(/^鲁智深：/);
    expect(t.find((l) => l.includes('遇林而起，遇山而富'))).toMatch(/^鲁智深：/);
  });
});
