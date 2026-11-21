// 检查关卡里每个人开场的朝向（负责人 2026-11-21：士兵要看着要抓的人）：
// 每个单位应当大致朝向最近的对手（开场就在场上的对手优先；都没登场就看全部对手）。
// 背对着对手（朝向和对手所在方向相反）就列出来；加 --side 连侧对的也列。dx、dy 都不为零时两个轴向都算对。
// 只查开场就在场上的人；原版关卡里和原版 ACT 朝向一样的不查；潜行关的哨兵 / 巡逻（watch、patrol、AI 13）、观战演员、没有对手的单位不查。
//
//   node --experimental-transform-types tools/check-facing.ts [--side]  列出扩展包关卡和改过的原版关卡里朝向不对的单位
//   node --experimental-transform-types tools/check-facing.ts --fix    直接改关卡 JSON（扩展包 packs/*/stages、原版 gamedata/stages）
import fs from 'node:fs';
import path from 'node:path';
import { compileStage } from '../src/packs/build.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { facingTowards } from '../src/rules/unit.ts';
import { Battle } from '../src/rules/battle.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { parseAct } from '../src/formats/act.ts';
import { DATA, NodeFiles } from './sim-lib.ts';
import { loadPackFromDisk } from './sim-pack.ts';

interface Pos { x: number; y: number; side: string; present: boolean }
interface Check extends Pos { label: string; facing: number; skip: boolean; prop?: boolean }

const fix = process.argv.includes('--fix');
const sideToo = process.argv.includes('--side');
const ROOT = path.resolve(import.meta.dirname, '..');
const NAMES = ['北(−y)', '西(−x)', '南(+y)', '东(+x)'];

/** 这个单位该朝哪些方向（主方向在前）；没有对手时返回 null */
function wanted(u: Pos, all: Pos[]): number[] | null {
  const foes = all.filter((o) => o !== u && !(o as Check).prop && (u.side === 'enemy' ? o.side !== 'enemy' : o.side === 'enemy'));
  const pool = foes.some((o) => o.present) ? foes.filter((o) => o.present) : foes;
  if (!pool.length) return null;
  const t = pool.reduce((a, o) => (Math.abs(o.x - u.x) + Math.abs(o.y - u.y) < Math.abs(a.x - u.x) + Math.abs(a.y - u.y) ? o : a));
  const main = facingTowards(u, t, -1);
  if (main < 0) return null;
  const dx = t.x - u.x, dy = t.y - u.y;
  const ok = [main];
  if (dx && dy) ok.push(main === 1 || main === 3 ? (dy > 0 ? 2 : 0) : dx > 0 ? 3 : 1);
  return ok;
}

function report(stage: string, units: Check[], apply: (i: number, facing: number) => void): number {
  let n = 0;
  units.forEach((u, i) => {
    // 中途登场的援兵出场时的位置和局面都变了，只查开场就在场上的
    if (u.skip || !u.present) return;
    const ok = wanted(u, units);
    if (!ok || ok.includes(u.facing)) return;
    // 默认只抓背对的（和主方向相反、也不在次方向上）；--side 连侧对的也列
    if (!sideToo && (ok[0] + 2) % 4 !== u.facing) return;
    n++;
    console.log(`${stage}\t${u.label}\t(${u.x},${u.y})\t${NAMES[u.facing] ?? u.facing} → ${NAMES[ok[0]]}`);
    if (fix) apply(i, ok[0]);
  });
  return n;
}


/** 只改这个单位的 "facing"，不动文件其余排版（扩展包关卡按 id 找；没写 facing 就补在 id 后面） */
function setFacing(text: string, id: string, f: number): string {
  const at = text.indexOf(`"id": ${JSON.stringify(id)}`);
  if (at < 0) return text;
  const end = text.indexOf('}', at);
  const body = text.slice(at, end);
  const m = /"facing":\s*\d+/.exec(body);
  if (m) return text.slice(0, at) + body.replace(m[0], `"facing": ${f}`) + text.slice(end);
  const idEnd = at + `"id": ${JSON.stringify(id)}`.length;
  return text.slice(0, idEnd) + `, "facing": ${f}` + text.slice(idEnd);
}
/** 原版关卡：units 里第 i 个单位的 "facing" */
function setFacingAt(text: string, i: number, f: number): string {
  const re = /"index":\s*(\d+)/g;
  let m: RegExpExecArray | null;
  const start = text.indexOf('"units"');
  re.lastIndex = start;
  while ((m = re.exec(text))) {
    if (Number(m[1]) !== i) continue;
    const end = text.indexOf('}', m.index);
    const body = text.slice(m.index, end);
    return text.slice(0, m.index) + body.replace(/"facing":\s*\d+/, `"facing": ${f}`) + text.slice(end);
  }
  return text;
}

let total = 0;
// 扩展包关卡
useDiskCustomMaps();
const files = new NodeFiles(DATA);
for (const id of fs.readdirSync(path.join(ROOT, 'packs')).filter((d) => fs.existsSync(path.join(ROOT, 'packs', d, 'pack.json')))) {
  const rt = loadPackFromDisk(id);
  for (const s of rt.stages) {
    let c: ReturnType<typeof compileStage>;
    try { c = compileStage(rt, s, files, { seed: 1 }); } catch { continue; }
    const spect = new Set(c.spectators ?? []);
    // 开场剧情（走位、转身）演完以后才是玩家看到的样子；剧情里动过的人不归 JSON 的朝向管
    const b = new Battle(c);
    const before = b.units.map((u) => ({ x: u.x, y: u.y, facing: u.facing }));
    try { b.begin(); } catch { /* 开场剧情出错就按开场前的样子查 */ }
    const units: Check[] = s.units.map((u, i) => ({
      x: b.units[i].x, y: b.units[i].y, side: b.units[i].side, present: b.units[i].present,
      facing: b.units[i].facing,
      label: u.id,
      prop: !!u.spectator || spect.has(i),
      skip: b.units[i].x !== before[i].x || b.units[i].y !== before[i].y || b.units[i].facing !== before[i].facing || !b.units[i].alive || !!(u.spectator || u.watch || u.patrol || u.offstage || u.ai === 13 || u.ai === 8 && u.side !== 'enemy' || spect.has(i)),
    }));
    const file = path.join(ROOT, 'packs', id, 'stages', `${s.id}.json`);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const n = report(`${id}/${s.id}`, units, (i, f) => { text = setFacing(text, s.units[i].id, f); });
    total += n;
    if (fix && n && text) fs.writeFileSync(file, text);
  }
}
// 改过的原版关卡（edited 1 / 2）
const tr = buildT2S(files);
const data = loadGameData(files, tr);
for (const f of fs.readdirSync(path.join(ROOT, 'gamedata/stages')).sort()) {
  const file = path.join(ROOT, 'gamedata/stages', f);
  if (!JSON.parse(fs.readFileSync(file, 'utf8')).edited) continue;
  const map = f.replace(/\.json$/, '');
  let input: ReturnType<typeof loadStage>;
  try { input = loadStage(files, data, map, { seed: 1, text: tr }); } catch { continue; }
  const spect = new Set(input.spectators ?? []);
  const b = new Battle(input);
  const before = b.units.map((u) => ({ x: u.x, y: u.y, facing: u.facing }));
  try { b.begin(); } catch { /* 同上 */ }
  const watchers = (b as unknown as { watchers: Map<number, unknown> }).watchers;
  // 原版就这么摆的朝向不算（还原原版）；只查负责人加的、挪过朝向的人
  const actFile = path.join(ROOT, 'gamedata/original/Map', `${map}.act`);
  const orig = fs.existsSync(actFile) ? parseAct(fs.readFileSync(actFile), map) : [];
  const units: Check[] = b.units.map((u, i) => ({
    x: u.x, y: u.y, side: u.side, present: u.present, facing: u.facing, label: `#${u.uid} ${u.name}`, prop: spect.has(u.uid),
    skip: !u.alive || orig[u.uid]?.facing === before[i].facing || spect.has(u.uid) || watchers?.has(u.uid) || u.ai.mode === 13 || (u.ai.mode === 8 && u.side !== 'enemy') || (u.x === 0 && u.y === 0)
      || u.x !== before[i].x || u.y !== before[i].y || u.facing !== before[i].facing,
  }));
  let text = fs.readFileSync(file, 'utf8');
  const n = report(map, units, (i, fc) => { text = setFacingAt(text, b.units[i].uid, fc); });
  total += n;
  if (fix && n) fs.writeFileSync(file, text);
}
console.log(`共 ${total} 个${fix ? '，已改' : ''}`);
