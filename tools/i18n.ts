// 多语言工具（docs/game-design.md §10.3）
//
//   npm run i18n -- ids <关卡...>          给关卡里还没有编号的剧本文字分配编号（已有的不动，新号 = 本关最大号 + 1）
//   npm run i18n -- sync <语言> <关卡...>  建 / 更新 gamedata/lang/<语言>/stages/<关卡>.json：补上新句子（繁体预填：原版有的句子
//                                         用原版 .pab 的繁体原文，重制版加的句子用 OpenCC 转换），
//                                         去掉删掉的句子；中文改过的句子保留旧译文，列为「过期」
//   npm run i18n -- check [语言]           列出每关已翻 / 未翻 / 过期的句数
//
// 关卡名照 gamedata/stages 的文件名（N01、N-add01）；扩展包关卡写「包/关卡」（mainline/jiaochang）：
// 编号写在剧本步骤末尾（["say", "wangjin", "……", "#3"]，剧情选项的每个选项也一样），译文在 gamedata/lang/<语言>/packs/<包>/<关卡>.json。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatStageJson, type StageJson } from '../src/formats/stage-json.ts';
import { LANGS, type Lang, type LineEntry } from '../src/i18n/index.ts';
import { parsePasBlocks } from '../src/formats/pas.ts';

/** 要翻译的剧本指令：13 对白、29 过关旁白、30 结局、31–33 胜负条件、111 场景字幕 */
export const TEXT_OPS = new Set([13, 29, 30, 31, 32, 33, 111]);
const STAGES = 'gamedata/stages';
const langDir = (l: string) => `gamedata/lang/${l}/stages`;
/** 译文文件：原版关卡 stages/<关卡>.json，扩展包关卡 packs/<包>/<关卡>.json */
const langFile = (l: string, s: string) => (isPack(s) ? `gamedata/lang/${l}/packs/${s}.json` : `${langDir(l)}/${s}.json`);

const readStage = (s: string) => JSON.parse(readFileSync(`${STAGES}/${s}.json`, 'utf8')) as StageJson;
const isPack = (s: string) => s.includes('/');
const packFile = (s: string) => `packs/${s.split('/')[0]}/stages/${s.split('/')[1]}.json`;
/** 有编号的扩展包关卡（剧本里出现 "#n"） */
const packStages = () =>
  readdirSync('packs', { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`packs/${d.name}/stages`))
    .flatMap((d) => readdirSync(`packs/${d.name}/stages`).filter((f) => f.endsWith('.json')).map((f) => `${d.name}/${f.slice(0, -5)}`))
    .filter((s) => /"#\d+"/.test(readFileSync(packFile(s), 'utf8')));
const allStages = () => [...readdirSync(STAGES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)), ...packStages()];

/** 扩展包剧本里带文字的步骤：步骤名 → 文字在第几项 */
const PACK_TEXT: Record<string, number> = { say: 2, narrate: 1, objective: 1, victory: 1, defeat: 1, title: 1, choice: 1 };
const isId = (v: unknown) => typeof v === 'string' && /^#\d+$/.test(v);

/** 扩展包关卡的剧本文字：编号 → 中文 */
function packLines(s: string): Map<string, string> {
  const m = new Map<string, string>();
  const j = JSON.parse(readFileSync(packFile(s), 'utf8')) as { script: { do: unknown[][] }[] };
  for (const b of j.script)
    for (const step of b.do) {
      const k = PACK_TEXT[String(step[0])];
      if (k === undefined) continue;
      const last = step[step.length - 1];
      if (isId(last) && typeof step[k] === 'string' && step[k]) m.set(`${s}#${(last as string).slice(1)}`, step[k] as string);
      if (step[0] === 'choice')
        for (const o of step.slice(2)) if (Array.isArray(o) && isId(o[o.length - 1])) m.set(`${s}#${(o[o.length - 1] as string).slice(1)}`, String(o[0]));
    }
  return m;
}

/** 一关的全部剧本文字：编号 → 中文 */
function stageLines(s: string): Map<string, string> {
  if (isPack(s)) return packLines(s);
  const m = new Map<string, string>();
  for (const b of readStage(s).blocks) for (const o of b.ops) if (o.id !== undefined && o.text !== undefined) m.set(`${s}#${o.id}`, o.text);
  return m;
}

/** JSON 文本里从 i（'['）起到配对的 ']' 的位置，跳过字符串 */
function closeOf(src: string, i: number): number {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '"') {
      for (k++; src[k] !== '"'; k++) if (src[k] === '\\') k++;
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return k;
  }
  throw new Error('括号不配对');
}

/** 扩展包关卡：给带文字的步骤（和剧情选项）末尾补 "#n"，直接改文本，不动原来的排版 */
function assignPackIds(s: string) {
  const file = packFile(s);
  let src = readFileSync(file, 'utf8');
  const used = new Set(stageLines(s).keys());
  let next = Math.max(0, ...[...used].map((k) => Number(k.split('#')[1]))) + 1;
  const re = new RegExp(`\\[\\s*"(${Object.keys(PACK_TEXT).join('|')})"\\s*,`, 'g');
  const inserts: { at: number; id: number }[] = [];
  let total = 0;
  for (const m of src.matchAll(re)) {
    const end = closeOf(src, m.index!);
    const step = JSON.parse(src.slice(m.index!, end + 1)) as unknown[];
    const targets: { end: number; has: boolean }[] = [];
    if (step[0] === 'choice') {
      // 选项是 [文字, 标志]：逐个找出它们的结尾
      let k = m.index! + 1;
      while (k < end) {
        if (src[k] === '"') { for (k++; src[k] !== '"'; k++) if (src[k] === '\\') k++; k++; continue; }
        if (src[k] === '[') { const e = closeOf(src, k); const o = JSON.parse(src.slice(k, e + 1)) as unknown[]; targets.push({ end: e, has: isId(o[o.length - 1]) }); k = e + 1; continue; }
        k++;
      }
    }
    targets.push({ end, has: isId(step[step.length - 1]) });
    for (const t of targets) {
      total++;
      if (!t.has) inserts.push({ at: t.end, id: 0 });
    }
  }
  inserts.sort((a, b) => a.at - b.at).forEach((x) => (x.id = next++));
  for (const x of [...inserts].reverse()) src = `${src.slice(0, x.at)}, "#${x.id}"${src.slice(x.at)}`;
  writeFileSync(file, src);
  console.log(`${s}：新分配 ${inserts.length} 个编号，共 ${total} 句`);
}

function assignIds(s: string) {
  if (isPack(s)) return assignPackIds(s);
  const j = readStage(s);
  const ops = j.blocks.flatMap((b) => b.ops).filter((o) => TEXT_OPS.has(o.op) && o.text !== undefined);
  const used = new Set<number>();
  for (const o of ops) {
    if (o.id === undefined) continue;
    if (used.has(o.id)) throw new Error(`${s}：编号 ${o.id} 重复`);
    used.add(o.id);
  }
  let next = Math.max(0, ...used) + 1;
  let added = 0;
  for (const o of ops) if (o.id === undefined) (o.id = next++), added++;
  writeFileSync(`${STAGES}/${s}.json`, formatStageJson(j));
  console.log(`${s}：新分配 ${added} 个编号，共 ${ops.length} 句`);
}

const readLang = (l: string, s: string): Record<string, LineEntry> => {
  const p = langFile(l, s);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
};
/** 每句一行，按编号排 */
function writeLang(l: string, s: string, entries: Record<string, LineEntry>) {
  mkdirSync(dirname(langFile(l, s)), { recursive: true });
  const keys = Object.keys(entries).sort((a, b) => Number(a.split('#')[1]) - Number(b.split('#')[1]));
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify({ zh: entries[k].zh, t: entries[k].t })}`).join(',\n');
  writeFileSync(langFile(l, s), `{\n${body}\n}\n`);
}

/**
 * 原版的繁体原文：gamedata/original/Map/<关卡>.pab（Big5）与 .pas（简体）同结构，逐条对齐，
 * 得到「简体原文 → 繁体原文」。重制版改过或新加的句子对不上，留给 OpenCC。
 */
function originalHant(s: string): Map<string, string> {
  const pab = `gamedata/original/Map/${s}.pab`, pas = `gamedata/original/Map/${s}.pas`;
  const m = new Map<string, string>();
  if (!existsSync(pab) || !existsSync(pas)) return m;
  const big5 = parsePasBlocks(readFileSync(pab), 'big5').flatMap((b) => b.ops).filter((o) => o.text);
  const gbk = parsePasBlocks(readFileSync(pas), 'gbk').flatMap((b) => b.ops).filter((o) => o.text);
  if (big5.length !== gbk.length) return m;
  gbk.forEach((o, i) => m.set(o.text!, big5[i].text!));
  return m;
}

async function sync(l: Lang, stages: string[]) {
  let s2t: ((x: string) => string) | undefined;
  if (l === 'zh-Hant') {
    const { ConverterFactory } = await import('opencc-js/core');
    const cn = (await import('opencc-js/from/cn')).default;
    const tw = (await import('opencc-js/to/tw')).default;
    s2t = ConverterFactory(cn, tw);
  }
  for (const s of stages) {
    const lines = stageLines(s);
    const orig = l === 'zh-Hant' ? originalHant(s) : new Map<string, string>();
    if (!lines.size) {
      console.log(`${s}：还没有编号，先跑 ids`);
      continue;
    }
    const old = readLang(l, s);
    const out: Record<string, LineEntry> = {};
    let added = 0, stale = 0, removed = 0;
    for (const [id, zh] of lines) {
      const e = old[id];
      if (!e) {
        const o = orig.get(zh);
        out[id] = { zh, t: o ?? (s2t ? s2t(zh) : '') };
        added++;
      } else {
        out[id] = e;
        if (e.zh !== zh) stale++;
      }
    }
    for (const id of Object.keys(old)) if (!lines.has(id)) removed++;
    writeLang(l, s, out);
    console.log(`${s} [${l}]：新增 ${added}，过期 ${stale}，删掉 ${removed}`);
  }
}

function check(only?: string) {
  for (const l of LANGS.map((x) => x.id).filter((x) => x !== 'zh-Hans' && (!only || x === only))) {
    if (!existsSync(langDir(l))) continue;
    console.log(`== ${l}`);
    for (const s of allStages()) {
      const lines = stageLines(s);
      if (!lines.size) continue;
      const tr = readLang(l, s);
      let done = 0, stale = 0;
      for (const [id, zh] of lines) {
        const e = tr[id];
        if (e?.t) done++;
        if (e && e.zh !== zh) stale++;
      }
      console.log(`${s.padEnd(18)} 共 ${lines.size}，已翻 ${done}，未翻 ${lines.size - done}，过期 ${stale}`);
    }
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'ids') for (const s of args) assignIds(s);
else if (cmd === 'sync') {
  const [l, ...stages] = args;
  if (!LANGS.some((x) => x.id === l) || l === 'zh-Hans') throw new Error(`语言写 ${LANGS.slice(1).map((x) => x.id).join(' / ')}`);
  await sync(l as Lang, stages.length ? stages : allStages());
} else if (cmd === 'check') check(args[0]);
else console.log('用法：npm run i18n -- ids <关卡...> | sync <语言> [关卡...] | check [语言]');
