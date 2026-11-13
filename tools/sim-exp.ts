// 经验节奏模拟：双方都用 AI，沿剧本头把主线（大道）从头打到尾，打印每关结束时我方的等级。
// 用法：node tools/sim-exp.ts [original|new] [关数上限]
// 环境变量：WEAK=敌方攻击乘数（默认 0.5），HEAL=0|low（默认每回合回满），DEFEND=1，SEED，KB/KP（击倒经验参数）
// 用来校准 src/rules/exp.ts：新规则下各章的全队平均等级应与原版规则相近，最低等级应明显更高。
import type { ExpSource } from '../src/rules/battle.ts';
import { EXP_RULES } from '../src/rules/exp.ts';
import { simulate } from './sim-lib.ts';

EXP_RULES.mode = process.argv[2] === 'original' ? 'original' : 'new';
if (process.env.KB) EXP_RULES.killBase = Number(process.env.KB);
if (process.env.KP) EXP_RULES.killPerLevel = Number(process.env.KP);
const heal = process.env.HEAL === '0' ? 'none' : process.env.HEAL === 'low' ? 'low' : 'full';
const result = simulate({
  weak: Number(process.env.WEAK ?? 0.5),
  heal,
  defend: process.env.DEFEND === '1',
  seed: Number(process.env.SEED ?? 1) * 10,
  limit: Number(process.argv[3] ?? 99),
});

const rows: string[] = [];
// 按来源统计经验：每 8 关一段，记录次数与总量
type Tally = Partial<Record<ExpSource, { n: number; total: number }>>;
const segs: { from: string; to: string; t: Tally }[] = [];
result.forEach(({ map, battle: b }, n) => {
  if (n % 8 === 0) segs.push({ from: map, to: map, t: {} });
  const seg = segs.at(-1)!;
  seg.to = map;
  for (const [k, v] of Object.entries(b.expBySource) as [ExpSource, { n: number; total: number }][]) {
    const e = (seg.t[k] ??= { n: 0, total: 0 });
    e.n += v.n;
    e.total += v.total;
  }
  const lv = b.units.filter((u) => u.side === 'player').map((u) => u.level);
  const foes = b.units.filter((u) => u.side === 'enemy').map((u) => u.level);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  rows.push(
    `${map.padEnd(10)} ${b.status.padEnd(7)} 敌均 ${avg(foes).toFixed(1).padStart(4)}  我方 均 ${avg(lv).toFixed(1).padStart(4)} 低 ${String(Math.min(...lv)).padStart(2)} 高 ${String(Math.max(...lv)).padStart(2)}  (${lv.length} 人)`,
  );
});
console.log(`规则：${EXP_RULES.mode}`);
console.log(rows.join('\n'));
const NAMES: Record<ExpSource, string> = { hit: '命中', counter: '反击', taken: '挨打', dodge: '闪避', heal: '回复技', item: '用药', rest: '休息', kill: '击倒(个人)', team: '击倒(入池)' };
console.log('\n经验来源（每次平均 / 占比）');
for (const { from, to, t } of segs) {
  const sum = Object.values(t).reduce((a, v) => a + v!.total, 0) || 1;
  const cells = (Object.keys(NAMES) as ExpSource[]).filter((k) => t[k]).map((k) => `${NAMES[k]} ${(t[k]!.total / t[k]!.n).toFixed(1)}/${Math.round((t[k]!.total / sum) * 100)}%`);
  console.log(`${from}–${to}: ${cells.join('  ')}`);
}
