// 多语言【新】（docs/game-design.md §10.3）：不依赖 Phaser / DOM，规则引擎和界面都能用。
//
// - 剧本对白、旁白、胜负条件按固定编号「关卡名#编号」查译文（gamedata/lang/<语言>/stages/<关卡>.json），
//   没有译文就显示中文原文。引擎在文字前后加不可见的标记（markLine），显示层（src/game/i18n-dom.ts）认出标记再查表，
//   所以存档里的胜负条件、正在显示的对白在换语言后也能跟着换。
// - 人名、界面文字按中文原文查对照表（terms.json / ui.json），可带 {n}（数字）、{s}（任意文字，再查一次表）占位。
// - 繁体：没有逐句译文时整段自动简→繁（OpenCC，切到繁体时才下载）。

export type Lang = 'zh-Hans' | 'zh-Hant' | 'en';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'zh-Hans', label: '简体中文' },
  { id: 'zh-Hant', label: '繁體中文' },
  { id: 'en', label: 'English' },
];

/** 译文文件的一条：zh = 翻译时的中文原文（改了原文就能查出译文过期），t = 译文（空 = 还没翻） */
export interface LineEntry {
  zh: string;
  t: string;
}

interface Table {
  /** 「关卡名#编号」→ 译文（键转成小写：浏览器里关卡名是小写的） */
  lines: Map<string, string>;
  /** 中文原文 → 译文（人名、界面文字） */
  terms: Map<string, string>;
  /** 带占位的模板：正则 + 译文模板 + 每个占位的种类 */
  patterns: { re: RegExp; out: string; kinds: ('n' | 's')[] }[];
}

const empty = (): Table => ({ lines: new Map(), terms: new Map(), patterns: [] });
const tables = new Map<Lang, Table>();
let lang: Lang = 'zh-Hans';
let s2t: ((s: string) => string) | null = null;
const listeners = new Set<() => void>();
/** 主角名、主角绰号（%N/%X、%M 的替换值，中文） */
const vars = { hero: '', heroNick: '' };

export const getLang = (): Lang => lang;
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  for (const f of listeners) f();
}
export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function setHero(name: string, nick: string) {
  vars.hero = name;
  vars.heroNick = nick;
}
/** 简→繁转换（由界面在切到繁体时载入 OpenCC 后设置） */
export function setS2T(f: (s: string) => string) {
  s2t = f;
  for (const g of listeners) g();
}
export const hasS2T = () => !!s2t;

/** 载入一种语言的译文。lines 来自 stages/*.json（可多次调用合并），terms / ui 是中文 → 译文 */
export function addTable(l: Lang, part: { lines?: Record<string, LineEntry>; terms?: Record<string, string> }) {
  const t = tables.get(l) ?? empty();
  tables.set(l, t);
  for (const [id, e] of Object.entries(part.lines ?? {})) if (e.t) t.lines.set(id.toLowerCase(), e.t);
  for (const [zh, out] of Object.entries(part.terms ?? {})) {
    if (!out) continue;
    if (/\{[ns]\}/.test(zh)) {
      const kinds: ('n' | 's')[] = [];
      const src = zh
        .split(/(\{[ns]\})/)
        .map((p) => {
          if (p === '{n}') return kinds.push('n'), '(-?\\d+(?:\\.\\d+)?)';
          if (p === '{s}') return kinds.push('s'), '(.+?)';
          return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      t.patterns.push({ re: new RegExp(`^${src}$`, 's'), out, kinds });
    } else t.terms.set(zh, out);
  }
}

// ---- 剧本文字的标记： 编号  中文 （私用区字符，不会出现在正文里） ----
const M0 = '', M1 = '', M2 = '';
const MARK_RE = /([^]*)([^]*)/g;
/** 引擎是否给剧本文字加标记（只有浏览器里打开；测试、模拟工具拿到的是纯中文） */
let marking = false;
export const enableLineMarks = (on = true) => void (marking = on);
export const markLine = (id: string | undefined, zh: string): string => (marking && id ? `${M0}${id}${M1}${zh}${M2}` : zh);
export const hasMarks = (s: string) => s.includes(M0);

const heroSub = (s: string) => s.replace(/%[NX]/g, term(vars.hero)).replace(/%M/g, term(vars.heroNick));

/** 一句剧本文字：有译文用译文（%N 等换成当前语言的主角名），没有就是中文原文 zh（已替换好主角名） */
export function line(id: string, zh: string): string {
  if (lang === 'zh-Hans') return zh;
  const t = tables.get(lang)?.lines.get(id.toLowerCase());
  if (t !== undefined) return heroSub(t);
  return lang === 'zh-Hant' && s2t ? s2t(zh) : zh;
}

/** 名字、界面上的一段文字：对照表里有就换，没有原样返回（繁体整段转换） */
export function term(zh: string): string {
  if (lang === 'zh-Hans' || !zh) return zh;
  const t = tables.get(lang);
  const hit = t?.terms.get(zh);
  if (hit !== undefined) return hit;
  if (lang === 'zh-Hant') return s2t ? s2t(zh) : zh;
  return pattern(t, zh) ?? zh;
}

function pattern(t: Table | undefined, zh: string): string | undefined {
  if (!t) return undefined;
  for (const p of t.patterns) {
    const m = p.re.exec(zh);
    if (!m) continue;
    let i = 0;
    return p.out.replace(/\{[ns]\}/g, () => {
      const v = m[++i] ?? '';
      return p.kinds[i - 1] === 's' ? text(v) : v;
    });
  }
  return undefined;
}

/**
 * 显示前的一段文字：先换掉剧本标记，再按当前语言翻译。英文按整段查表，
 * 查不到再按行、按空白分开的词各查一次（单位面板「史进 3级」这类拼起来的字）。
 */
export function text(s: string): string {
  if (!s) return s;
  if (hasMarks(s)) {
    const parts: string[] = [];
    let last = 0;
    for (const m of s.matchAll(MARK_RE)) {
      parts.push(rest(s.slice(last, m.index)), line(m[1], m[2]));
      last = m.index! + m[0].length;
    }
    parts.push(rest(s.slice(last)));
    return parts.join('');
  }
  return rest(s);
}
function rest(s: string): string {
  if (!s || lang === 'zh-Hans') return s;
  if (lang === 'zh-Hant') return term(s);
  const whole = s.trim();
  if (!whole || !/[㐀-鿿]/.test(whole)) return s;
  const hit = term(whole);
  if (hit !== whole) return s.replace(whole, hit);
  if (whole.includes('\n')) return s.split('\n').map(rest).join('\n');
  // 按空白分词各查一次（保留原来的空白）
  if (/\s/.test(whole)) return s.replace(/[^\s]+/g, (w) => term(w));
  return s;
}

/** 测试用：清空译文和语言 */
export function resetI18n() {
  tables.clear();
  lang = 'zh-Hans';
  s2t = null;
  marking = false;
}
