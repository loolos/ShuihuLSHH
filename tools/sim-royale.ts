// 好汉聚义（吃鸡外传，docs/game-design.md §15.31）试打：玩家的好汉也交给吃鸡 AI，跑若干局，
// 打印玩家吃鸡率（16 人随机应在 1/16 上下）、平均名次、打几回合、多少人死在毒圈里、宝箱开了多少，以及每回合 AI 耗时。
// 用法：node --experimental-transform-types tools/sim-royale.ts [局数] [玩家职业号]；WATCH=1 玩家倒下后接着打完（看整局回合数）
import { Battle } from '../src/rules/battle.ts';
import { buildT2S, loadGameData } from '../src/rules/load.ts';
import { compileStage } from '../src/packs/build.ts';
import { NPC_TEAM } from '../src/rules/royale.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { DATA, NodeFiles } from './sim-lib.ts';
import { loadPackFromDisk } from './sim-pack.ts';

useDiskCustomMaps();
const [n = '20', pickArg] = process.argv.slice(2);
const files = new NodeFiles(DATA);
const tr = buildT2S(files);
const rt = loadPackFromDisk('mainline', loadGameData(files, tr));
const stage = rt.stages.find((s) => s.id === 'juyi')!;
let wins = 0, rankSum = 0, turnSum = 0, zoneDeaths = 0, chests = 0, npcKills = 0, ms = 0, rounds = 0;
const winners = new Map<string, number>();
for (let seed = 1; seed <= Number(n); seed++) {
  const b = new Battle(compileStage(rt, stage, files, { seed, text: tr, royalePick: pickArg ? Number(pickArg) : undefined }));
  const msgs: string[] = [];
  const log = (ev: { type: string; text?: string }[]) => { for (const e of ev) if (e.type === 'message' && e.text) msgs.push(e.text); };
  b.royaleWatch = process.env.WATCH === '1';
  log(b.begin());
  const me = b.units.find((u) => u.side === 'player')!;
  const chests0 = b.items.length;
  let spawned = 0;
  while (b.status === 'playing' && b.turn < 80) {
    const t0 = performance.now();
    for (const u of b.units.filter((x) => x.side === 'player')) log(b.aiAct(u));
    if (b.status !== 'playing') break;
    const ev = b.endPlayerPhase();
    spawned += ev.filter((e) => e.type === 'chest').length;
    log(ev);
    ms += performance.now() - t0;
    rounds++;
  }
  const won = b.status === 'won';
  wins += Number(won);
  const heroes = b.units.filter((u) => u.team !== undefined && u.team !== NPC_TEAM);
  const rank = me.alive ? 1 : heroes.length - b.royale!.out.indexOf(me.uid);
  const lastOut = b.royale!.out.length;
  rankSum += rank;
  turnSum += b.turn;
  zoneDeaths += msgs.filter((m) => m.includes('毒圈里')).length;
  npcKills += b.units.filter((u) => u.team === NPC_TEAM && !u.alive).length;
  chests += chests0 + spawned - b.items.length;
  const last = b.royaleHeroes()[0];
  if (last) winners.set(last.name, (winners.get(last.name) ?? 0) + 1);
  console.log(`种子 ${seed}：${me.name} 第 ${rank} 名，${b.turn} 回合，${b.status}${last ? `，吃鸡 ${last.name}` : ''}`);
}
const N = Number(n);
console.log(`\n玩家吃鸡 ${wins}/${N}，平均名次 ${(rankSum / N).toFixed(1)}，平均 ${(turnSum / N).toFixed(1)} 回合，平均每局毒死 ${(zoneDeaths / N).toFixed(1)} 人、打倒小头目 ${(npcKills / N).toFixed(1)} 个、开宝箱 ${(chests / N).toFixed(1)} 个`);
console.log(`每回合（全部 AI）平均 ${(ms / Math.max(1, rounds)).toFixed(0)} ms`);
console.log(`吃鸡次数：${[...winners].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ')}`);
