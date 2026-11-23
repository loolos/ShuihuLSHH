import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { addTable, enableLineMarks, line, markLine, resetI18n, setHero, setLang, term, text } from '../src/i18n/index.ts';
import type { StageJson } from '../src/formats/stage-json.ts';

afterEach(() => resetI18n());

describe('多语言查表（§10.3）', () => {
  it('剧本文字按编号查，没有译文显示中文；%N 换成当前语言的主角名', () => {
    setHero('武龙', '关西之虎');
    addTable('en', { lines: { 'N01#16': { zh: '我乃%N。', t: 'I am %N, the "%M".' } }, terms: { 武龙: 'Wu Long', 关西之虎: 'Tiger of Guanxi' } });
    expect(line('n01#16', '我乃武龙。')).toBe('我乃武龙。');
    setLang('en');
    expect(line('n01#16', '我乃武龙。')).toBe('I am Wu Long, the "Tiger of Guanxi".');
    expect(line('N01#99', '没翻的句子')).toBe('没翻的句子');
  });

  it('标记只在打开时加；显示时换掉标记，简体下就是原文', () => {
    expect(markLine('N01#1', '娘！')).toBe('娘！');
    enableLineMarks();
    const s = markLine('N01#1', '娘！') + '（提示）';
    expect(s).not.toBe('娘！（提示）');
    expect(text(s)).toBe('娘！（提示）');
    addTable('en', { lines: { 'N01#1': { zh: '娘！', t: 'Mother!' } }, terms: { '（提示）': ' (hint)' } });
    setLang('en');
    expect(text(s)).toBe('Mother! (hint)');
  });

  it('界面文字：整段、模板（{n} 数字、{s} 再查一次）、按空白分词', () => {
    addTable('en', { terms: { 我方: 'Player', '第 {n} / {n} 回合 · {s}': 'Turn {n} / {n} · {s}', '{s}的攻击落空了。': "{s}'s attack missed.", 士兵: 'Soldier', 战役一: 'Battle 1', 护母奔延安: 'Breaking Out' } });
    setLang('en');
    expect(text('第 3 / 50 回合 · 我方')).toBe('Turn 3 / 50 · Player');
    expect(text('士兵的攻击落空了。')).toBe("Soldier's attack missed.");
    expect(text('战役一 护母奔延安 ▾')).toBe('Battle 1 Breaking Out ▾');
    expect(term('没有的词')).toBe('没有的词');
  });

  it('一句能套上几个模板时用最具体的（写死的字最多）', () => {
    addTable('en', { terms: { '{s}：选择施放位置': '{s}: choose', '{s}（气力 {n}）：选择施放位置': '{s} (Qi {n}): choose', 龙争虎斗: 'Dragon' } });
    setLang('en');
    expect(text('龙争虎斗（气力 30）：选择施放位置')).toBe('Dragon (Qi 30): choose');
  });

  it('繁体：有逐句译文用译文，其余交给简→繁转换', () => {
    addTable('zh-Hant', { lines: { 'N01#5': { zh: '周五', t: '周五' } } });
    setLang('zh-Hant');
    expect(line('N01#5', '周五')).toBe('周五');
    expect(line('N01#6', '后来')).toBe('后来'); // 转换器还没载入：先显示原文
  });
});

describe('关卡里的剧本编号与译文文件', () => {
  const stages = readdirSync('gamedata/stages').filter((f) => f.endsWith('.json'));
  it('同一关里编号不重复（复制指令时别连 id 一起复制）', () => {
    for (const f of stages) {
      const j = JSON.parse(readFileSync(`gamedata/stages/${f}`, 'utf8')) as StageJson;
      const ids = j.blocks.flatMap((b) => b.ops).filter((o) => o.id !== undefined).map((o) => o.id);
      expect(new Set(ids).size, f).toBe(ids.length);
    }
  });
  it('译文文件的每个编号都在关卡里（删了句子要跑 npm run i18n -- sync）', () => {
    for (const lang of ['zh-Hant', 'en']) {
      const dir = `gamedata/lang/${lang}/stages`;
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const j = JSON.parse(readFileSync(`gamedata/stages/${f}`, 'utf8')) as StageJson;
        const ids = new Set(j.blocks.flatMap((b) => b.ops).filter((o) => o.id !== undefined).map((o) => `${f.slice(0, -5)}#${o.id}`));
        for (const k of Object.keys(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))) expect(ids.has(k), `${lang}/${f} ${k}`).toBe(true);
      }
    }
  });
});

describe('扩展包关卡的剧本编号（步骤末尾 "#n"）', () => {
  const packStage = (s: string) => JSON.parse(readFileSync(`packs/${s.split('/')[0]}/stages/${s.split('/')[1]}.json`, 'utf8')) as { script: { do: unknown[][] }[] };
  /** 一关里所有编号 → 中文（步骤和剧情选项） */
  const lines = (s: string) => {
    const m = new Map<string, string>();
    const at: Record<string, number> = { say: 2, narrate: 1, objective: 1, victory: 1, defeat: 1, title: 1, choice: 1 };
    const isId = (v: unknown) => typeof v === 'string' && /^#\d+$/.test(v);
    for (const b of packStage(s).script)
      for (const st of b.do) {
        const last = st[st.length - 1];
        if (isId(last)) {
          expect(m.has(`${s}${last}`), `${s} ${String(last)} 重复`).toBe(false);
          m.set(`${s}${last}`, String(st[at[String(st[0])]]));
        }
        if (st[0] === 'choice') for (const o of st.slice(2) as unknown[][]) if (isId(o[o.length - 1])) m.set(`${s}${String(o[o.length - 1])}`, String(o[0]));
      }
    return m;
  };
  for (const s of ['mainline/jiaochang', 'mainline/xihuamen'])
    it(`${s}：每句都有编号，英文、繁体逐句译好且没过期`, () => {
      const m = lines(s);
      const steps = packStage(s).script.flatMap((b) => b.do).filter((st) => ['say', 'narrate', 'objective', 'victory', 'defeat', 'title', 'choice'].includes(String(st[0])));
      expect(m.size).toBeGreaterThanOrEqual(steps.length);
      for (const lang of ['en', 'zh-Hant']) {
        const tr = JSON.parse(readFileSync(`gamedata/lang/${lang}/packs/${s}.json`, 'utf8')) as Record<string, { zh: string; t: string }>;
        expect(Object.keys(tr).sort(), lang).toEqual([...m.keys()].sort());
        for (const [k, zh] of m) {
          expect(tr[k].zh, `${lang} ${k} 过期`).toBe(zh);
          expect(tr[k].t, `${lang} ${k} 没翻`).not.toBe('');
          if (lang === 'en') expect(tr[k].t, `${lang} ${k}`).not.toMatch(/[㐀-鿿]/);
        }
      }
    });
});
