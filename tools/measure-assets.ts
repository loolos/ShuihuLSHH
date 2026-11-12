// 网页版下载量统计：启动时的基础文件、每关进关前下载、开打后后台下载的技能动画，以及重复的文件和帧。
// 用法：node --experimental-transform-types tools/measure-assets.ts
// 只统计、不写文件。按关卡表顺序累计时，前面关卡下载过的部分不再计入（浏览器 IndexedDB 里已有）。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadAssets, preloadStage, prefetchSkills } from '../src/game/assets.ts';
import { fxGroups } from '../src/game/effects.ts';
import { parseAct } from '../src/formats/act.ts';
import { parseMap } from '../src/formats/map.ts';
import { learnedSkills } from '../src/rules/skills.ts';
import type { Unit } from '../src/rules/unit.ts';
import type { GameFiles } from '../src/platform/gamefiles.ts';

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const LAZY = ['Data/Man.lib', 'Data/Effect.lib', 'Data/Upper.grp', 'Data/Ground.grp'];
const UNUSED = ['Data/Panel.lib'];
const MB = (n: number) => (n / 1048576).toFixed(2).padStart(6);

const index = new Map<string, string>();
const walk = (d: string, rel: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r);
    else index.set(r.toLowerCase(), r);
  }
};
walk(DATA, '');
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/manifest.json'), 'utf8')).files as { path: string; size: number; sha256: string }[];

type Spans = [number, number][];
const union = (spans: Spans, gap = 0) => {
  const out: Spans = [];
  for (const r of [...spans].sort((a, b) => a[0] - b[0])) {
    const l = out.at(-1);
    if (l && r[0] - l[1] <= gap) l[1] = Math.max(l[1], r[1]);
    else out.push([...r]);
  }
  return out;
};
const sum = (s: Spans) => s.reduce((n, [a, b]) => n + b - a, 0);

/** 假的 GameFiles：读本地文件，ensure 只记下要下载的范围（相距 32 KB 内合并，同网页版） */
function fakeFiles(have: Map<string, Spans>) {
  let got = 0;
  const files = {
    get: (p: string) => fs.readFileSync(path.join(DATA, index.get(p.toLowerCase()) ?? p)),
    has: (p: string) => index.has(p.toLowerCase()),
    list: (dir: string, ext: string) => [...index.values()].filter((p) => p.toLowerCase().startsWith(dir.toLowerCase() + '/') && p.toLowerCase().endsWith(ext)),
    copy() {},
    async ensure(want: Map<string, Spans>) {
      for (const [p, spans] of want) {
        const h = have.get(p) ?? [];
        const before = sum(h);
        have.set(p, union([...h, ...union(spans, 32767)]));
        got += sum(have.get(p)!) - before;
      }
      return 0;
    },
  };
  return { files: files as unknown as GameFiles, taken: () => ((got = 0), got) || 0, get: () => got };
}

const probe = loadAssets(fakeFiles(new Map()).files);
const small = manifest.filter((e) => !LAZY.includes(e.path) && !UNUSED.includes(e.path));
console.log(`启动时整份下载的基础文件 ${small.length} 个：${MB(small.reduce((n, e) => n + e.size, 0))} MB`);
for (const e of [...small].sort((a, b) => b.size - a.size).slice(0, 3)) console.log(`  ${e.path.padEnd(18)} ${MB(e.size)} MB`);
for (const p of [...LAZY, ...UNUSED]) console.log(`${UNUSED.includes(p) ? '不下载' : '按需下载'} ${p.padEnd(16)} ${MB(manifest.find((e) => e.path === p)!.size)} MB`);

/** 旧做法：本关职业的全部动作组与全部技能特效，不去重 */
function oldBytes(stage: string, classes: Set<number>) {
  const s: Spans = [], f: Spans = [], t: Spans = [], u: Spans = [];
  const map = parseMap(probe.files.get(`Map/${stage}.map`), stage);
  for (const cell of map.cells)
    cell.forEach((l, k) => {
      const lib = k === 0 ? probe.ground : probe.upper;
      if (l.tile < lib.count && (k > 0 || l.tile > 0)) (k === 0 ? t : u).push(lib.span(l.tile));
    });
  for (const cls of classes) {
    const c = probe.man.classes[cls];
    if (c) for (let g = c.first; g <= c.last; g++) { const r = probe.man.actions[g]; if (r) for (let i = r.first; i <= r.last; i++) s.push(probe.man.span(i)); }
    for (const sk of probe.data.classes[cls]?.skills ?? []) for (const g of fxGroups(sk)) { const r = probe.effects.actions[g]; if (r) for (let i = r.first; i <= r.last; i++) f.push(probe.effects.span(i)); }
  }
  return [s, f, t, u].reduce((n, x) => n + sum(union(x)), 0);
}

const stages = probe.exe.stages.filter((s) => s.mapName && index.has(`map/${s.mapName.toLowerCase()}.act`));
const total = new Map<string, Spans>();
let oldMax = 0, newMax = 0, bgMax = 0;
console.log('\n关卡        旧:进关前   新:进关前  新:开打后后台   按顺序玩新增');
for (const s of stages) {
  const acts = parseAct(probe.files.get(`Map/${s.mapName}.act`), s.mapName).filter((a) => a.side !== 'object' && a.side !== 'unknown' && a.type < probe.data.classes.length);
  const classes = new Set([0, ...acts.map((a) => a.type)]);
  // 单独进这一关（缓存为空）
  const solo = fakeFiles(new Map());
  const A = loadAssets(solo.files);
  await preloadStage(A, s.mapName);
  const core = solo.get();
  // 已学会的技能按 ACT 里的等级算（主角按 99 级，偏多）
  const units = [{ type: 0, level: 99 }, ...acts].map((a) => ({ classId: a.type, skills: learnedSkills({ classId: a.type, level: a.level } as Unit, A.data) }));
  await prefetchSkills(A, units);
  const bg = solo.get() - core;
  // 按顺序玩
  const seq = fakeFiles(total);
  const B = loadAssets(seq.files);
  await preloadStage(B, s.mapName);
  await prefetchSkills(B, units);
  const old = oldBytes(s.mapName, classes);
  oldMax = Math.max(oldMax, old); newMax = Math.max(newMax, core); bgMax = Math.max(bgMax, bg);
  console.log(`${String(s.index).padStart(3)} ${s.mapName.padEnd(9)} ${MB(old)} MB  ${MB(core)} MB  ${MB(bg)} MB      ${MB(seq.get())} MB`);
}
console.log(`单关最多：旧 ${MB(oldMax)} MB → 新 进关前 ${MB(newMax)} MB + 后台 ${MB(bgMax)} MB`);
console.log(`全部关卡玩完共下载按需部分 ${MB([...total.values()].reduce((n, s) => n + sum(s), 0))} MB`);

const byHash = new Map<string, string[]>();
for (const e of manifest) (byHash.get(e.sha256) ?? byHash.set(e.sha256, []).get(e.sha256)!).push(e.path);
const dups = [...byHash.values()].filter((l) => l.length > 1);
console.log(`\n内容完全相同的文件 ${dups.length} 组，共多 ${MB(dups.reduce((n, l) => n + (l.length - 1) * manifest.find((e) => e.path === l[0])!.size, 0))} MB：${dups.map((l) => l.join('=')).join('，')}`);
for (const [p, lib] of [['Data/Man.lib', probe.man], ['Data/Effect.lib', probe.effects]] as const) {
  const buf = probe.files.get(p);
  const first = new Set<string>();
  let n = 0, bytes = 0;
  for (let i = 0; i < lib.count; i++) {
    const [a, b] = lib.span(i);
    const h = createHash('sha1').update(buf.subarray(a, b)).digest('hex');
    if (first.has(h)) (n++, (bytes += b - a));
    else first.add(h);
  }
  console.log(`${p}：${lib.count} 帧里有 ${n} 帧与前面的帧字节完全相同，共 ${MB(bytes)} MB（网页版只下载一份）`);
}
