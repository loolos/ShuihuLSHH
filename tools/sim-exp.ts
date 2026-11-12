// 经验节奏模拟：双方都用 AI，沿剧本头把主线（大道）从头打到尾，打印每关结束时我方的等级。
// 用法：node tools/sim-exp.ts [original|new] [关数上限]
// 用来校准 src/rules/exp.ts：新规则下各章的全队平均等级应与原版规则相近，最低等级应明显更高。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { parsePasHeader } from '../src/formats/pas.ts';
import { planAi } from '../src/rules/ai.ts';
import { Battle } from '../src/rules/battle.ts';

declare module '../src/rules/unit.ts' {
  interface Unit {
    weakened?: boolean;
  }
}
import { newCampaign, nextByHeader, partyOf, recordResult, type CampaignState } from '../src/rules/campaign.ts';
import { EXP_RULES } from '../src/rules/exp.ts';
import { buildT2S, loadGameData, loadStage, type FileSource } from '../src/rules/load.ts';

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');

class NodeFiles implements FileSource {
  private index = new Map<string, string>();
  constructor(root: string) {
    const walk = (d: string, rel: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else this.index.set(r.toLowerCase(), path.join(d, e.name));
      }
    };
    walk(root, '');
  }
  get(p: string) {
    const f = this.index.get(p.toLowerCase());
    if (!f) throw new Error(`missing ${p}`);
    return fs.readFileSync(f);
  }
  has(p: string) {
    return this.index.has(p.toLowerCase());
  }
  list(dir: string, ext: string) {
    return [...this.index.keys()].filter((k) => k.startsWith(dir.toLowerCase() + '/') && k.endsWith(ext));
  }
}

EXP_RULES.mode = process.argv[2] === 'original' ? 'original' : 'new';
if (process.env.KB) EXP_RULES.killBase = Number(process.env.KB);
if (process.env.KP) EXP_RULES.killPerLevel = Number(process.env.KP);
const WEAK = Number(process.env.WEAK ?? 0.5);
const HEAL = process.env.HEAL !== '0';
const SEED = Number(process.env.SEED ?? 1) * 10;
const limit = Number(process.argv[3] ?? 99);
const files = new NodeFiles(DATA);
const tr = buildT2S(files);
const data = loadGameData(files, tr);
const stages = readExeTables(files.get('ShuiHu.exe')).stages;

function play(map: string, c: CampaignState, seed: number) {
  const b = new Battle(loadStage(files, data, map, { seed, text: tr, party: partyOf(c), simplified: true }));
  const log: unknown[] = [];
  const wrap = <T extends unknown[]>(ev: T) => (log.push(...ev), ev);
  wrap(b.begin());
  // AI 打不过人类玩家：把敌方攻击力减半（WEAK），我方每回合回满（HEAL），两种规则用同样的设置，只比较相对节奏
  const weaken = () => b.units.forEach((u) => u.side === 'enemy' && !u.weakened && ((u.stats.attack = Math.floor(u.stats.attack * WEAK)), (u.weakened = true)));
  weaken();
  let guard = 0;
  while (b.status === 'playing' && guard++ < 80) {
    if (b.awaitingSignal) wrap(b.signal());
    for (const u of b.active().filter((x) => x.side === 'player')) {
      if (b.status !== 'playing') break;
      const plan = planAi(b, u);
      if (plan.path && plan.path.length > 1) {
        const last = plan.path.at(-1)!;
        wrap(b.move(u, last.x, last.y));
      }
      if (plan.target && b.attackTargets(u).includes(plan.target)) wrap(b.attack(u, plan.target));
      else b.wait(u);
    }
    if (b.status === 'playing') wrap(b.endPlayerPhase());
    weaken();
    // 每回合给我方回满体力（同上：只为让 AI 能把关打完）
    if (HEAL) for (const u of b.units) if (u.side !== 'enemy' && u.alive) u.hp = u.stats.maxHp;
  }
  if (process.env.DEBUG) console.log(map, b.turn, JSON.stringify(log.filter((e: any) => e.type === 'end' || e.type === 'die' || e.type === 'ask')).slice(0, 600));
  return b;
}

let c = newCampaign(0);
const rows: string[] = [];
for (let n = 0, i = 0; n < limit && stages[i]?.mapName; n++) {
  const map = stages[i].mapName;
  let b = play(map, c, SEED);
  for (let seed = SEED + 1; b.status !== 'won' && seed <= SEED + 3; seed++) b = play(map, c, seed);
  if (b.status !== 'won') b.settleTeamExp(); // 输了的关当作玩家最终打赢，照样结算全队经验
  c = recordResult(c, b);
  const lv = b.units.filter((u) => u.side === 'player').map((u) => u.level);
  const foes = b.units.filter((u) => u.side === 'enemy').map((u) => u.level);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  rows.push(
    `${map.padEnd(10)} ${b.status.padEnd(7)} 敌均 ${avg(foes).toFixed(1).padStart(4)}  我方 均 ${avg(lv).toFixed(1).padStart(4)} 低 ${String(Math.min(...lv)).padStart(2)} 高 ${String(Math.max(...lv)).padStart(2)}  (${lv.length} 人)`,
  );
  i = nextByHeader(parsePasHeader(files.get(`Map/${map}.pab`))).next;
}
console.log(`规则：${EXP_RULES.mode}`);
console.log(rows.join('\n'));
