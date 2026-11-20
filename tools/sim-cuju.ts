// 蹴鞠外传试打（docs/game-design.md §15.25）：双方都交给蹴鞠 AI，打印胜率、比分、出界 / 拦截次数和踢球距离。
// 用法：node --experimental-transform-types tools/sim-cuju.ts [局数] [我方等级偏移] [敌方等级偏移]
import { Battle } from '../src/rules/battle.ts';
import { compileStage } from '../src/packs/build.ts';
import { loadGameData } from '../src/rules/load.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { DATA, NodeFiles } from './sim-lib.ts';
import { loadPackFromDisk } from './sim-pack.ts';

useDiskCustomMaps();
const [n = '40', dp = '0', de = '0'] = process.argv.slice(2);
const files = new NodeFiles(DATA);
const rt = loadPackFromDisk('mainline', loadGameData(files));
const stage = rt.stages.find((s) => s.id === 'cuju')!;
if (process.env.BONUS) { const [pw, ht] = process.env.BONUS.split(",").map(Number); stage.cuju!.bonus = { enemy: { power: pw, hit: ht } }; }
stage.units.forEach((u) => (u.level += Number(u.side === 'player' ? dp : de)));
if (process.env.SAME) for (let i = 0; i < 5; i++) stage.units[i + 5].class = stage.units[i].class;
if (process.env.SWAP) for (let i = 0; i < 5; i++) [stage.units[i].class, stage.units[i + 5].class] = [stage.units[i + 5].class, stage.units[i].class];
let won = 0, turns = 0;
const tally = { goal: 0, own: 0, out: 0, intercept: 0, stop: 0, kicks: 0, dist: 0 };
const scores: string[] = [];
for (let seed = 1; seed <= Number(n); seed++) {
  const b = new Battle(compileStage(rt, stage, files, { seed }));
  const ev = [...b.begin()];
  while (b.status === 'playing' && b.turn < 40) {
    ev.push(...b.autoPhase('player'));
    ev.push(...b.endPlayerPhase());
  }
  for (const e of ev) {
    if (e.type === 'ball' && e.result !== 'place') {
      tally.kicks++;
      tally[e.result]++;
      if (e.result === 'goal' && e.text === '乌龙球！') tally.own++;
    }
    if (e.type === 'message' && /球飞出 (\d+) 格/.test(e.text)) tally.dist += Number(/球飞出 (\d+) 格/.exec(e.text)![1]);
  }
  if (b.status === 'won') won++;
  turns += b.turn;
  scores.push(`${b.cuju!.score.player}:${b.cuju!.score.enemy}`);
}
console.log(`我方胜 ${won}/${n}（${Math.round((100 * won) / Number(n))}%），平均 ${(turns / Number(n)).toFixed(1)} 回合`);
console.log(`比分：${scores.join(' ')}`);
console.log(`每局：踢 ${(tally.kicks / Number(n)).toFixed(1)} 脚，平均 ${(tally.dist / Math.max(1, tally.kicks)).toFixed(1)} 格；进球 ${tally.goal}（乌龙 ${tally.own}）、出界 ${tally.out}、拦截 ${tally.intercept}、停住 ${tally.stop}`);
