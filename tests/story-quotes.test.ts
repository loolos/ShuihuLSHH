// 主线对白补的原著原文【新】：2026-11-19 起直接写在 gamedata/stages 的关卡剧本里，这里检查过场演出时按顺序说出来、原版的战斗触发不变。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePasBlocks } from '../src/formats/pas.ts';
import { Battle, type BattleEvent } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
describe.skipIf(!has)('主线对白补原著原文', () => {
  const files = new NodeFiles(DATA);
  const tr = buildT2S(files);

  /** 原版剧本原件（gamedata/original/Map/*.pab），用来对照重制版没动战斗触发 */
  const rawBlocks = (stage: string) => parsePasBlocks(files.get(`Map/${stage}.pab`), 'big5');

  const play = (stage: string) => {
    const data = loadGameData(files, tr);
    const b = new Battle(loadStage(files, data, stage, { seed: 1, text: tr }));
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
    expect(find('你竟不在草料场里')).toBeGreaterThan(challenge);
    expect(find('他身后还有人')).toBeGreaterThan(find('你竟不在草料场里'));
    expect(find('今日不杀你们')).toBe(challenge);
    expect(find('还敢来攀旧日情分')).toBeGreaterThan(find('何必闹到这般田地'));
    expect(find('众人一起上')).toBeGreaterThan(find('还敢来攀旧日情分'));
    expect(lines.join()).not.toMatch(/挑战书|不赴约|把你叫到这里/);
    expect(ev.some((e) => e.type === 'attack')).toBe(false);
    // 纯文字调整不改原版战斗触发、增援与胜负条件指令。
    const input = loadStage(files, loadGameData(files, tr), 'N09', { text: tr });
    const raw = rawBlocks('N09');
    const gameplay = (blocks: typeof raw) => blocks.map((b) => ({ trigger: b.trigger, ops: b.ops.filter((o) => o.op !== 12 && o.op !== 13).map((o) => ({ op: o.op, flag: o.flag, value: o.text === undefined ? o.value : 0 })) }));
    expect(gameplay(input.blocks)).toEqual(gameplay(raw));
  });

  it('草料场战后：陆谦求饶与林冲对峙在前，伏诛后才商议去向并结算', () => {
    const { b, ev: opening } = play('N09');
    expect(says(opening).join()).not.toContain('放我这一遭');
    for (const u of b.units.filter((u) => u.side === 'enemy')) {
      u.hp = 0;
      u.alive = false;
    }
    const player = b.units.find((u) => u.side === 'player' && b.canMove(u) && b.moveRange(u).green.length)!;
    const step = b.moveRange(player).green[0];
    const ev = b.move(player, step.x, step.y);
    expect(b.status).toBe('won');
    const lines = ev.flatMap((e) => e.type === 'say' || e.type === 'narrate' ? [e.text] : []);
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    const sequence = ['尚有一口气', '不干小人事', '放我这一遭', '你骗我去你家', '我必报答', '也要拿失守草料场', '太尉岂肯罢休', '还拿高俅来压我', '今日这一刀', '结果了陆谦', '沧州也不能待下去了', '过关了'];
    let previous = -1;
    for (const text of sequence) {
      expect(at(text), text).toBeGreaterThan(previous);
      previous = at(text);
    }
    expect(says(ev).find((l) => l.includes('不干小人事'))).toMatch(/^陆谦：/);
    expect(says(ev).find((l) => l.includes('今日这一刀'))).toMatch(/^林冲：/);
    expect(ev.find((e) => e.type === 'say' && e.text.includes('沧州也不能待下去了'))).toMatchObject({
      type: 'say', uid: b.units.find((u) => u.classId === 0)!.uid,
    });
    const lu = b.units.find(u => u.classId === 64)!;
    const show = ev.findIndex(e => e.type === 'appear' && e.uid === lu.uid);
    const plea = ev.findIndex(e => e.type === 'say' && e.text.includes('不干小人事'));
    const killed = ev.findIndex(e => e.type === 'say' && e.text.includes('结果了陆谦'));
    const hide = ev.findIndex(e => e.type === 'leave' && e.uid === lu.uid);
    const next = ev.findIndex(e => e.type === 'say' && e.text.includes('沧州也不能待下去了'));
    expect(show).toBeGreaterThanOrEqual(0);
    expect(show).toBeLessThan(plea);
    expect(hide).toBeGreaterThan(killed);
    expect(hide).toBeLessThan(next);
    expect(ev.filter(e => e.type === 'appear').map(e => e.uid)).toEqual([lu.uid]);
    expect(ev.find(e => e.type === 'say' && e.text.includes('不干小人事'))).toMatchObject({ uid: lu.uid });
    const appearance = ev[show];
    if (appearance.type !== 'appear') throw new Error('Missing actor');
    expect(b.board.passable(appearance.x, appearance.y)).toBe(true);
    expect(b.active().some(u => u.x === appearance.x && u.y === appearance.y)).toBe(false);
    expect(lu.alive).toBe(false); expect(lu.hp).toBe(0); expect(lu.gold).toBe(0);
    expect(b.foesOf(player)).toEqual([]);
    expect(ev.some(e => e.type === 'die' || e.type === 'attack')).toBe(false);
    // 已触发的胜利区块不会再次执行或重复处决陆谦。
    expect(b.endPlayerPhase()).toEqual([]);
  });

  it('黄泥冈：白胜先唱歌再卖酒，接上改写对白', () => {
    const { ev } = play('Act10-1');
    const lines = says(ev);
    const song = lines.findIndex((l) => l.includes('赤日炎炎似火烧'));
    expect(lines[song]).toBe('白胜：赤日炎炎似火烧，野田禾稻半枯焦。农夫心内如汤煮，公子王孙把扇摇。');
    expect(lines[song + 1]).toMatch(/^白胜：客官们买桶白酒吧！/);
  });

  it('黄泥冈军汉抱怨、都管争执与劝酒有因果，杨志昏倒后才搬走生辰纲，本关不演醒来', () => {
    const {b,ev}=play('Act10-1');
    const dialogue=ev.filter(e=>e.type==='say'||e.type==='narrate');
    const find=(s:string)=>dialogue.findIndex(e=>e.text.includes(s));
    expect(b.status).toBe('won');expect(dialogue.length).toBeLessThanOrEqual(55);expect(dialogue.reduce((n,e)=>n+e.text.length,0)).toBeLessThan(1600);
    const stages=['都是一般父母皮肉','谁敢五更半夜走','我在太师府里做奶公','今日天下怎地不太平','我等弟兄七人','赤日炎炎','多少好汉，被蒙汗药麻翻了','倾回桶里','那贩枣子客人已买了一桶','既然老都管说了','只吃半瓢','倒也！倒也！','不好！这酒里有蒙汗药','杨志也眼前一黑','快把金珠装上车','晁盖等人将十一担生辰纲'];
    const indexes=stages.map(find);for(const i of indexes)expect(i).toBeGreaterThanOrEqual(0);expect(indexes).toEqual([...indexes].sort((a,b)=>a-b));
    expect(dialogue.some(e=>/稍醒|醒来|领状|如何回去见得梁中书|有家难奔|又羞又愤|羞愧难当|独自向冈下/.test(e.text))).toBe(false);
    expect(dialogue.find(e=>e.text.includes('不好！这酒里有蒙汗药'))).toMatchObject({type:'say',speaker:'杨志'});
    const guan=dialogue.filter(e=>e.type==='say'&&e.speaker==='谢都管');expect(guan).toHaveLength(4);expect(guan.every(e=>e.type==='say'&&e.uid===5)).toBe(true);
    expect(dialogue.some(e=>e.text.includes('精神崩溃')||e.text.includes('提尿壶')||e.text.includes('六兄弟'))).toBe(false);
    expect(ev.some(e=>e.type==='attack'||e.type==='die')).toBe(false);expect(b.units).toHaveLength(13);
  });

  it('黄泥冈原版走位和结束指令保留', () => {
    const raw=rawBlocks('Act10-1');
    const patched=loadStage(files,loadGameData(files,tr),'Act10-1',{text:tr}).blocks;
    const movement=(bs:typeof raw)=>bs.flatMap(b=>b.ops.filter(o=>[14,15,16,17].includes(o.op)).map(o=>[o.op,o.flag,o.value]));
    expect(movement(patched)).toEqual(movement(raw));
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
