// 主线模拟（sim-exp.ts、gen-entry-levels.ts 共用）：双方都用 AI，沿剧本头把主线（大道）从头打到尾。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables } from '../src/formats/exe.ts';
import { parsePasHeader } from '../src/formats/pas.ts';
import { planAi } from '../src/rules/ai.ts';
import { Battle } from '../src/rules/battle.ts';
import { joinLevel, newCampaign, nextByHeader, partyOf, recordResult, type CampaignState } from '../src/rules/campaign.ts';
import { buildT2S, loadGameData, loadStage, type FileSource } from '../src/rules/load.ts';

declare module '../src/rules/unit.ts' {
  interface Unit {
    weakened?: boolean;
  }
}

export const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');

export class NodeFiles implements FileSource {
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

export interface SimOptions {
  /** 敌方攻击力乘数（AI 打不过人类玩家，默认减半） */
  weak?: number;
  /** 每回合给我方回体力：'full' 回满（默认）、'low' 只给低于 40% 的回满（像玩家吃药、休息）、'none' 不回 */
  heal?: 'full' | 'low' | 'none';
  /** 我方没有可攻击目标时选"防御"而不是待命 */
  defend?: boolean;
  seed?: number;
  /** 最多打几关 */
  limit?: number;
}

export interface SimStage {
  map: string;
  index: number;
  battle: Battle;
  /** 进这一关时（开打前）我方每个人的等级：角色号 → 等级 */
  entry: Map<number, number>;
}

export function simulate(opts: SimOptions = {}): SimStage[] {
  const weak = opts.weak ?? 0.5;
  const heal = opts.heal ?? 'full';
  const seed0 = opts.seed ?? 10;
  const files = new NodeFiles(DATA);
  const tr = buildT2S(files);
  const data = loadGameData(files, tr);
  const stages = readExeTables(files.get('ShuiHu.exe')).stages;

  const play = (map: string, c: CampaignState, seed: number) => {
    const b = new Battle(loadStage(files, data, map, { seed, text: tr, party: partyOf(c), joinLevel: joinLevel(c), simplified: true }));
    const entry = new Map(b.units.filter((u) => u.side === 'player').map((u) => [u.classId, u.level]));
    b.begin();
    // 选人关（Train、N-add15）：选默认推荐的人
    if (b.pendingPick) b.choose(b.pendingPick.recommended);
    // AI 打不过人类玩家：把敌方攻击力减半，我方回体力；两种经验规则用同样的设置，只比较相对节奏
    const weaken = () => b.units.forEach((u) => u.side === 'enemy' && !u.weakened && ((u.stats.attack = Math.floor(u.stats.attack * weak)), (u.weakened = true)));
    weaken();
    let guard = 0;
    while (b.status === 'playing' && guard++ < 80) {
      if (b.awaitingSignal) b.signal();
      for (const u of b.active().filter((x) => x.side === 'player')) {
        if (b.status !== 'playing') break;
        const plan = planAi(b, u);
        if (plan.path && plan.path.length > 1) {
          const last = plan.path.at(-1)!;
          b.move(u, last.x, last.y);
        }
        if (plan.target && b.attackTargets(u).includes(plan.target)) b.attack(u, plan.target);
        else if (opts.defend) b.defend(u);
        else b.wait(u);
      }
      if (b.status === 'playing') b.endPlayerPhase();
      weaken();
      if (heal !== 'none') for (const u of b.units) if (u.side !== 'enemy' && u.alive && (heal === 'full' || u.hp < u.stats.maxHp * 0.4)) u.hp = u.stats.maxHp;
    }
    return { b, entry };
  };

  let c = newCampaign(0);
  const out: SimStage[] = [];
  for (let n = 0, i = 0; n < (opts.limit ?? 99) && stages[i]?.mapName; n++) {
    const map = stages[i].mapName;
    let r = play(map, c, seed0);
    for (let seed = seed0 + 1; r.b.status !== 'won' && seed <= seed0 + 3; seed++) r = play(map, c, seed);
    if (r.b.status !== 'won') r.b.settleTeamExp(); // 输了的关当作玩家最终打赢，照样结算全队经验
    c = recordResult(c, r.b);
    out.push({ map, index: i, battle: r.b, entry: r.entry });
    i = nextByHeader(parsePasHeader(files.get(`Map/${map}.pab`))).next;
  }
  return out;
}
