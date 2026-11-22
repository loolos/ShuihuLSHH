// 章节表（src/rules/chapters.ts）：分章、插关位置、校验。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readExeTables } from '../src/formats/exe.ts';
import { parsePasHeader } from '../src/formats/pas.ts';
import { CHAPTERS, chapterLabel, chapterOf, chapterSequence, insertPlaces, validateChapters, type ChapterDef } from '../src/rules/chapters.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

/** packs/index.json 里启用的、entry = mainline 的包登记的关卡 */
function registeredInserts(): string[] {
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/index.json'), 'utf8')) as string[];
  return ids.flatMap((id) => {
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', id, 'pack.json'), 'utf8'));
    if (pack.entry !== 'mainline') return [];
    // sideStory：主线包里的独立外传（蹴鞠），不进章节表
    return (pack.stages as string[]).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', id, f), 'utf8'))).filter((s) => !s.sideStory).map((s) => `${id}/${s.id}`);
  });
}

describe('章节表', () => {
  const toy: ChapterDef[] = [
    { name: '甲', stages: ['A', 'p/x'] },
    { name: '乙', stages: ['p/y', 'B', 'C'] },
    { name: '丙', stages: ['p/z', 'p/w'] },
  ];
  it('章号、章名按表里的位置', () => {
    expect(chapterOf('b', toy)).toBe(2);
    expect(chapterOf('p/w', toy)).toBe(3);
    expect(chapterOf('nope', toy)).toBe(0);
    expect(chapterLabel(16)).toBe('第十六章 景阳冈打虎');
    expect(chapterLabel(99)).toBe('');
  });
  it('插关打在后面那个原版关卡之前；最后一个原版关卡之后的是终章续篇', () => {
    expect(insertPlaces(toy)).toEqual([
      { ref: 'p/x', before: 'B' },
      { ref: 'p/y', before: 'B' },
      { ref: 'p/z', after: 'C' },
      { ref: 'p/w', after: 'C' },
    ]);
  });
  it('校验：漏写、重复、顺序调换、未登记的插关都会报出来', () => {
    expect(validateChapters(['A', 'B', 'C'], ['p/x', 'p/y', 'p/z', 'p/w'], toy)).toEqual([]);
    const bad: ChapterDef[] = [{ name: '甲', stages: ['B', 'A', 'p/x', 'p/x', 'p/q'] }, { name: '', stages: [] }];
    const errs = validateChapters(['A', 'B', 'C'], ['p/x', 'p/y'], bad);
    expect(errs.some((e) => e.includes('重复'))).toBe(true);
    expect(errs.some((e) => e.includes('c 不在章节表'))).toBe(true);
    expect(errs.some((e) => e.includes('顺序不能调换'))).toBe(true);
    expect(errs.some((e) => e.includes('p/y 已登记但不在章节表'))).toBe(true);
    expect(errs.some((e) => e.includes('p/q 没有登记'))).toBe(true);
    expect(errs.some((e) => e.includes('没有章名'))).toBe(true);
  });
  it('现有的插关和续篇都在表里，各在原来的位置', () => {
    const inserts = registeredInserts();
    expect(chapterSequence().filter((x) => x.key.includes('/')).map((x) => x.key).sort()).toEqual([...inserts].sort());
    const at = Object.fromEntries(insertPlaces().map((p) => [p.ref, p.before ?? `after ${p.after}`]));
    expect(at['mainline/wawasi']).toBe('N-add06');
    expect(at['mainline/zhizhulin']).toBe('Act7-1a');
    expect(at['mainline/chifagui']).toBe('Act10-1');
    expect(at['mainline/sanruan']).toBe('Act10-1');
    expect(at['mainline/yuanyanglou']).toBe('after N14');
    // 续篇各章：坐楼杀惜、义释宋公明留在第十五章；第十六、十七章各一组
    expect(chapterOf('mainline/songjiazhuang')).toBe(15);
    expect(chapterOf('mainline/chaijin-liubin')).toBe(16);
    expect(chapterOf('mainline/shizipo')).toBe(17);
    expect(chapterOf('mainline/zhangfu')).toBe(17);
    expect(chapterOf('mainline/yuanyanglou')).toBe(17);
    expect(chapterOf('mainline/xingzhe')).toBe(18);
    expect(chapterOf('mainline/wugongling')).toBe(18);
    // 负责人 2026-11-16：蜈蚣岭、孔亮两章合成第十八章「行者武松」，后面各章减一
    expect(chapterOf('mainline/kongliang')).toBe(18);
    expect(chapterOf('mainline/kongjiazhuang')).toBe(18);
    expect(chapterLabel(18)).toBe('第十八章 行者武松');
    expect(chapterOf('mainline/qingfengshan')).toBe(19);
    expect(chapterOf('mainline/jieqiuche')).toBe(19);
    expect(chapterOf('mainline/yekun')).toBe(20);
    expect(chapterOf('mainline/shiyong')).toBe(20);
    expect(chapterOf('mainline/bensang')).toBe(21);
    expect(chapterOf('mainline/jieyangling')).toBe(21);
    expect(chapterLabel(21)).toBe('第二十一章 刺配江州');
    expect(chapterOf('mainline/huandaocun')).toBe(26);
    expect(chapterLabel(26)).toBe('第二十六章 还道村受天书');
    expect(chapterOf('mainline/zhufu')).toBe(27);
    expect(chapterOf('mainline/yinmachuan')).toBe(28);
    expect(chapterOf('mainline/zhujiadian')).toBe(29);
    expect(chapterLabel(27)).toBe('第二十七章 沂岭杀四虎');
    expect(CHAPTERS).toHaveLength(29);
  });
});

const EXE = path.join(ROOT, 'gamedata/original/ShuiHu.exe');
const MAP = path.join(ROOT, 'gamedata/original/Map');
describe.skipIf(!fs.existsSync(EXE))('章节表与原版', () => {
  const maps = fs.existsSync(MAP) ? new Map(fs.readdirSync(MAP).map((f) => [f.toLowerCase(), f])) : new Map<string, string>();
  const stages = fs.existsSync(EXE) ? readExeTables(fs.readFileSync(EXE)).stages.filter((s) => s.mapName && maps.has(`${s.mapName.toLowerCase()}.act`)) : [];
  it('原版关卡一个不漏、顺序不变，插关都登记过', () => {
    expect(validateChapters(stages.map((s) => s.mapName), registeredInserts())).toEqual([]);
  });
  it('原版关卡表的顺序 = 剧本头串起来的顺序（选关按表排，流程按剧本头走）', () => {
    const order = stages.map((s) => s.index);
    for (const s of stages) {
      const pab = maps.get(`${s.mapName.toLowerCase()}.pab`);
      if (!pab) continue;
      const next = parsePasHeader(fs.readFileSync(path.join(MAP, pab))).next;
      if (!order.includes(next)) continue; // 最后一关
      expect(order.indexOf(next), `${s.mapName} → ${next}`).toBeGreaterThan(order.indexOf(s.index));
    }
  });
  it('原版关卡的分章和 EXE 标题里的"第N章"一致，负责人调整过的除外（再调整时把它加进 moved）', () => {
    // 负责人调整过的：#234 两关归第七章；沧州设毒计（原第八章）、摆脱追骑（原第十章）归第九章
    const moved: Record<string, number> = { 'act7-1a': 7, 'n-add09a': 7, 'act9-1': 9, 'n-add11': 9 };
    for (const s of stages) expect(chapterOf(s.mapName), s.mapName).toBe(moved[s.mapName.toLowerCase()] ?? Number(/第\s*(\d+)\s*章/.exec(s.title)?.[1]));
  });
});
