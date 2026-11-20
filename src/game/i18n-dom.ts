// 多语言的界面部分【新】（docs/game-design.md §10.3）：语言选单、译文载入、把页面上的文字换成当前语言。
//
// 界面代码照旧写中文；这里用 MutationObserver 看着整个页面，新出现或改动的文字（和 title 提示）在画出来之前
// 换成当前语言（src/i18n 的 text：剧本标记查编号、其余查对照表）。换语言时按记下的原文整页重新换一遍，
// 所以正在显示的对白、单位面板、顶栏会马上跟着变。画在 Phaser 画布上的字（回合横幅、飘字）由 BattleScene 调 text()。
import { LANGS, addTable, getLang, onLangChange, setLang, setS2T, hasS2T, text, enableLineMarks, type Lang, type LineEntry } from '../i18n/index.ts';

const LANG_KEY = 'shuihu.lang';
/** gamedata/lang/<语言>/ 下的译文：stages/<关卡>.json（逐句）、terms.json（人名等）、ui.json（界面文字）；切到哪种语言才载入 */
const files = import.meta.glob('/gamedata/lang/*/**/*.json', { import: 'default' }) as Record<string, () => Promise<unknown>>;
const loaded = new Set<Lang>();

async function loadLang(l: Lang) {
  if (l === 'zh-Hans' || loaded.has(l)) return;
  loaded.add(l);
  const prefix = `/gamedata/lang/${l}/`;
  const jobs = Object.entries(files)
    .filter(([p]) => p.startsWith(prefix))
    .map(async ([p, load]) => {
      const v = (await load()) as Record<string, unknown>;
      if (p.startsWith(`${prefix}stages/`)) addTable(l, { lines: v as Record<string, LineEntry> });
      else addTable(l, { terms: v as Record<string, string> });
    });
  if (l === 'zh-Hant' && !hasS2T()) {
    jobs.push(
      (async () => {
        // OpenCC 简→繁（台湾字形，和原版 Big5 一致）；约 400 KB，只在第一次切到繁体时下载
        const [{ ConverterFactory }, cn, tw] = await Promise.all([import('opencc-js/core'), import('opencc-js/from/cn'), import('opencc-js/to/tw')]);
        setS2T(ConverterFactory(cn.default, tw.default));
      })(),
    );
  }
  await Promise.all(jobs);
}

/** 记下每段文字的原文和换好的样子：换语言时从原文重来；看到的已经是换好的就不再动 */
const seen = new WeakMap<Text, { src: string; out: string }>();
const seenTitle = new WeakMap<Element, { src: string; out: string }>();
const skip = (n: Node) => !!(n.parentElement?.closest('script, style, textarea, [translate="no"]'));

function fixText(n: Text, force = false) {
  if (skip(n)) return;
  let rec = seen.get(n);
  if (!rec || (!force && n.data !== rec.out)) {
    rec = { src: n.data, out: n.data };
    seen.set(n, rec);
  }
  const out = text(rec.src);
  rec.out = out;
  if (n.data !== out) n.data = out;
  if (import.meta.env.DEV && getLang() === 'en' && /[\u3400-\u9fff]/.test(out)) missing.add(rec.src.trim().replace(/\d+/g, '{n}'));
}
/** 开发模式：英文界面里还没翻译的文字（控制台 __i18nMissing 查看），补进 gamedata/lang/en/ui.json */
const missing = new Set<string>();
if (import.meta.env.DEV) (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;
function fixTitle(el: Element, force = false) {
  const cur = el.getAttribute('title');
  if (cur === null || el.closest('[translate="no"]')) return;
  let rec = seenTitle.get(el);
  if (!rec || (!force && cur !== rec.out)) {
    rec = { src: cur, out: cur };
    seenTitle.set(el, rec);
  }
  const out = text(rec.src);
  rec.out = out;
  if (cur !== out) el.setAttribute('title', out);
}
function fixTree(root: Node, force = false) {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text, force);
  if (!(root instanceof Element)) return;
  if (root.hasAttribute('title')) fixTitle(root, force);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text, force);
    else if ((n as Element).hasAttribute('title')) fixTitle(n as Element, force);
  }
}

/** 开始看着页面换文字，读出上次选的语言；在建界面之前调用 */
export async function initI18n() {
  enableLineMarks();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target as Text);
      else if (m.type === 'attributes') fixTitle(m.target as Element);
      else m.addedNodes.forEach((n) => fixTree(n));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
  onLangChange(() => {
    document.documentElement.lang = getLang();
    fixTree(document.body, true);
  });
  setupLangButton();
  let saved: Lang = 'zh-Hans';
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (LANGS.some((x) => x.id === v)) saved = v as Lang;
  } catch {
    /* 读不到就用简体 */
  }
  fixTree(document.body);
  if (saved !== 'zh-Hans') await choose(saved);
}

async function choose(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 存不了就只在这次有效 */
  }
  await loadLang(l);
  setLang(l);
  // 繁体转换在 setLang 之后才载完时，setS2T 会再通知一次
  updateButton();
}

/** 按钮固定写「文/A」（负责人 2026-11-20），当前语言放在提示里 */
function updateButton() {
  const b = document.getElementById('lang');
  if (b) {
    b.textContent = '文/A';
    b.title = `语言 / Language：${LANGS.find((x) => x.id === getLang())?.label ?? ''}`;
  }
}

/** 顶栏的「文」按钮：点开选语言（游戏里、城镇、标题画面都在） */
function setupLangButton() {
  const btn = document.getElementById('lang') as HTMLButtonElement | null;
  if (!btn) return;
  btn.setAttribute('translate', 'no');
  const menu = document.createElement('div');
  menu.id = 'lang-menu';
  menu.hidden = true;
  menu.setAttribute('translate', 'no');
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lang = l.id;
    b.textContent = l.label;
    b.onclick = () => {
      menu.hidden = true;
      void choose(l.id);
    };
    menu.append(b);
  }
  document.body.append(menu);
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!menu.hidden) return void (menu.hidden = true);
    const r = btn.getBoundingClientRect();
    // 按钮在屏幕下半（标题画面底部的工具栏）时往上弹，免得选单跑到屏幕外
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    const h = menu.offsetHeight, w = menu.offsetWidth;
    const below = r.bottom + 4 + h <= window.innerHeight - 4;
    menu.style.top = `${Math.round(below ? r.bottom + 4 : Math.max(4, r.top - 4 - h))}px`;
    menu.style.left = `${Math.round(Math.max(4, Math.min(r.left, window.innerWidth - w - 4)))}px`;
    menu.style.visibility = '';
    for (const b of menu.querySelectorAll('button')) b.classList.toggle('on', b.dataset.lang === getLang());
    menu.hidden = false;
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !(e.target as Element).closest?.('#lang, #lang-menu')) menu.hidden = true;
  });
  updateButton();
}
