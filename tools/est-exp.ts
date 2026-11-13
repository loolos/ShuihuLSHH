// 经验快速估算（不跑战斗，几秒出结果）：沿主线逐关按"期望值"算我方能拿到多少经验、打完是几级。
// 用法：node --experimental-transform-types tools/est-exp.ts [关数上限]
// 环境变量：NA/NB（升级所需经验 = 100 + NA×(等级−1) + NB×(等级−1)²，试公式用）、KB/KP（击倒经验参数），SCALE=整体经验乘数（试调用），ATT=每个敌人平均出手几次的系数（默认见 ENEMY_ATTACKS）
//
// 模型（每关）：
// - 用 loadStage + new Battle 构造这一关（我方带着上一关估出来的等级，敌人用修正后的等级和保底），不 begin、不跑 AI。
// - 只算 2 级以上的敌人（1 级是过场摆设），假定全部由我方击倒。
// - 我方对某个敌人的一次攻击：期望伤害 = 命中率 × (普通 × (1 − 必杀率) + 必杀 × 必杀率)，按我方所有人取平均（正面、普通攻击）。
//   打倒它的出手次数 N = 生命 / 期望伤害；伤害经验总量 ≈ (生命 + 击倒溢出) / 10 + 1.5 × 命中次数（击倒那一下也算，溢出最多算 20% 生命）。
//   击倒经验 = killBase + killPerLevel × 等级 + 2（0–4 的平均）。
// - 敌人对我方：每个敌人一生出手 ENEMY_ATTACKS × N / 我方人数 次（至少 1 次，围攻的人越多它活得越短），
//   命中给挨打经验（伤害 / 15 + 2），落空给闪避经验 4。
// - 休息、用药、回复技、反击、防御奖励：按 OTHER 比例加在上面之和上（实测约 5%）。
// - 全队经验注水分配，所以近似为平均分给本关出场的我方人物，算出每人新等级后进下一关。
import { readExeTables } from '../src/formats/exe.ts';
import { parsePasHeader } from '../src/formats/pas.ts';
import { Battle } from '../src/rules/battle.ts';
import { previewAttack } from '../src/rules/combat.ts';
import { joinLevel, newCampaign, nextByHeader, partyOf, recordResult } from '../src/rules/campaign.ts';
import { ENEMY_LEVEL } from '../src/rules/enemy-level.ts';
import { EXP_PER_LEVEL, EXP_RULES, OVERKILL_CAP } from '../src/rules/exp.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { attackSkill, refreshStats, type Unit } from '../src/rules/unit.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

if (process.env.KB) EXP_RULES.killBase = Number(process.env.KB);
if (process.env.KP) EXP_RULES.killPerLevel = Number(process.env.KP);
if (process.env.NOFLOOR === '1') ENEMY_LEVEL.floor = false;
const SCALE = Number(process.env.SCALE ?? 1);
const ENEMY_ATTACKS = Number(process.env.ATT ?? 1.5);
const OTHER = 0.05;
const NA = Number(process.env.NA ?? 0), NB = Number(process.env.NB ?? 0);
const need = (lv: number) => EXP_PER_LEVEL + NA * (lv - 1) + NB * (lv - 1) ** 2;

const files = new NodeFiles(DATA);
const tr = buildT2S(files);
const data = loadGameData(files, tr);
const stages = readExeTables(files.get('ShuiHu.exe')).stages;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

const expected = (att: Unit, def: Unit) => {
  const p = previewAttack(att, def, attackSkill(att, data));
  const h = p.hit / 100, c = p.crit / 100;
  return { hit: h, dmg: Math.max(1, p.damage * (1 - c) + p.critDamage * c) };
};

export interface EstRow { map: string; design: number; foes: number; foeAvg: number; enter: number; exit: number; kill: number; dmg: number; taken: number; total: number; n: number }

export function estimate(limit = 99): EstRow[] {
  let c = newCampaign(0);
  const rows: EstRow[] = [];
  for (let k = 0, i = 0; k < limit && stages[i]?.mapName; k++) {
    const map = stages[i].mapName;
    const input = loadStage(files, data, map, { seed: 1, text: tr, party: partyOf(c), joinLevel: joinLevel(c), simplified: true });
    const b = new Battle(input);
    const mine = b.units.filter((u) => u.side === 'player');
    const battle = !/^(act|train)/i.test(map);
    // 战役关的敌人全算（N01 的莊客是 1 级）；过场、陪练关不算
    const foes = battle ? b.units.filter((u) => u.side === 'enemy') : [];
    // 设计等级：ACT 敌人等级（含每关修正，不含保底）的平均 + 1，即按原版节奏的主角团等级（enemy-levels.json 的来源）
    const lv = input.units.filter((a) => a.side === 'enemy' && data.classes[a.type]).map((a) => a.level);
    const design = avg(lv.some((x) => x > 1) ? lv.filter((x) => x > 1) : lv) + 1;
    const enter = avg(mine.map((u) => u.level));
    let kill = 0, dmg = 0, taken = 0;
    if (mine.length) {
      const RB = Number(process.env.RB ?? 0);
      for (const e of foes) {
        const m = RB ? Math.min(2, Math.max(0.2, 1 + RB * (e.level - enter))) : 1;
        const k0 = kill, d0 = dmg, t0 = taken;
        const out = mine.map((p) => expected(p, e));
        const per = avg(out.map((o) => o.hit * o.dmg));
        const hitRate = avg(out.map((o) => o.hit));
        const N = e.stats.maxHp / Math.max(1, per);
        kill += EXP_RULES.killBase + EXP_RULES.killPerLevel * e.level + 2;
        // 击倒那一下的溢出：平均约半次命中的伤害，最多算最大生命的 20%（OVERKILL_CAP）
        const over = Math.min(per / Math.max(0.01, hitRate) / 2, e.stats.maxHp * OVERKILL_CAP);
        dmg += (e.stats.maxHp + over) / 10 + 1.5 * N * hitRate;
        const attacks = Math.max(1, (ENEMY_ATTACKS * N) / mine.length);
        const back = mine.map((p) => expected(e, p));
        const eh = avg(back.map((o) => o.hit));
        const ed = avg(back.map((o) => o.dmg));
        taken += attacks * (eh * (ed / 15 + 2) + (1 - eh) * 4);
        kill = k0 + (kill - k0) * m; dmg = d0 + (dmg - d0) * m; taken = t0 + (taken - t0) * m;
      }
    }
    const total = (kill + dmg + taken) * (1 + OTHER) * SCALE;
    // 平均分给本关的我方人物
    for (const u of mine) {
      let e = u.exp + total / mine.length;
      while (e >= need(u.level)) e -= need(u.level++);
      u.exp = Math.round(e);
      refreshStats(u, data);
    }
    rows.push({ map, design: battle ? design : 0, foes: foes.length, foeAvg: avg(foes.map((u) => u.level)), enter, exit: avg(mine.map((u) => u.level)), kill, dmg, taken, total, n: mine.length });
    (b as { status: string }).status = 'won';
    c = recordResult(c, b);
    i = nextByHeader(parsePasHeader(files.get(`Map/${map}.pab`))).next;
  }
  return rows;
}

if (import.meta.main) {
  const t0 = Date.now();
  const rows = estimate(Number(process.argv[2] ?? 99));
  console.log('关卡       设计 敌数 敌均   我方进→出   人数  击倒  伤害  挨打/闪  合计  人均');
  for (const r of rows) {
    if (!r.n || !r.foes) continue;
    console.log(
      `${r.map.padEnd(10)} ${r.design ? r.design.toFixed(1).padStart(4) : '   -'} ${String(r.foes).padStart(4)} ${r.foeAvg.toFixed(1).padStart(5)}  ${r.enter.toFixed(1).padStart(5)}→${r.exit.toFixed(1).padEnd(5)} ${String(r.n).padStart(4)} ${r.kill.toFixed(0).padStart(5)} ${r.dmg.toFixed(0).padStart(5)} ${r.taken.toFixed(0).padStart(7)} ${r.total.toFixed(0).padStart(6)} ${(r.total / r.n).toFixed(0).padStart(5)}`,
    );
  }
  console.error(`用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
}
