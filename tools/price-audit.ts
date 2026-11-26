// 物品价格审计（game-design §7.6）：按效果给每件商店货一个指导价，列出买价偏离太多的。
// 用法：node --experimental-transform-types tools/price-audit.ts [--all]
//   默认只列买价不在指导价 0.5–1.5 倍之间的；--all 列全部；--json 输出把它们挪进区间的改价表。
//
// 指导价怎么算：
// - 装备：把各项效果按重制版规则折成「点数」（命中按 1/4 扣法、移动不扣，见 equipHitBonus / equipMoveBonus），
//   武器、衣服、头饰、饰品（玉、兵法）各拟合一条 价格 = c × 点数^b（各组的 c 取中位数），拟合用原版自带价格（剔除偏离过大的再拟合一次），
//   所以指导价代表「原版大多数同类货的定价水平」。
// - 回复药：按实际能回的量计价，体力 2.5 两/点、气力 2 两/点；回满和超过上限的都按好汉 45 级的上限算（体力 300、气力 200），
//   解毒、解昏各 50 两。
// - 限时增益：小加值按 加值 × 回合 × 17 两（原版五种酒的平均）；+255 / 必杀 100% / 加移动这类质变的没法线性比，按同组比较给一个判断价。
import type { Item } from '../src/formats/goo.ts';
import { equipHitBonus, equipMoveBonus, equipSlotOf, itemBuffs, ITEM_REGEN_TURNS } from '../src/rules/data.ts';
import { loadPackFromDisk } from './sim-pack.ts';
import t2s from '../gamedata/tables/t2s.json' with { type: 'json' };
import goods from '../gamedata/tables/goods.json' with { type: 'json' };

const conv = (s: string) => [...s].map((c) => (t2s as Record<string, string>)[c] ?? c).join('');
// 连 mainline 包的商店货（弓、续篇分档新货）一起审
const data = loadPackFromDisk('mainline').data;
const showAll = process.argv.includes('--all');
const asJson = process.argv.includes('--json');
/** 原版的买价（曲线只按原版本来就在商店卖的货拟合，重制版改过的价不影响指导价） */
const ORIGINAL = new Map((goods as { id: number; category: number; buyPrice: number }[]).map((g) => [g.id, g.category > 0 ? g.buyPrice : 0]));
/** 合理区间：买价在指导价的 0.5–1.5 倍之间（负责人 2026-11-25） */
const LOW = 0.5;
const HIGH = 1.5;

const HP_RATE = 2.5;
const MP_RATE = 2;
const HP_CAP = 300;
const MP_CAP = 200;
const CURE = 50;
// 限时增益：1 点·回合 的价。负责人 2026-11-26：只是临时的，约为装备永久加成的 1/5（原 17）
const BUFF_RATE = 3.5;

/** 装备的效果点数（主属性 1 点 = 1） */
function equipPoints(it: Item): number {
  const main = equipSlotOf(it) === 0 ? it.attack : it.defense;
  const forge = equipSlotOf(it) === 0 ? it.attackStep * it.attackSteps : it.defenseStep * it.defenseSteps;
  const side = equipSlotOf(it) === 0 ? it.defense : it.attack;
  return (
    main + side +
    0.6 * forge +
    0.5 * (equipHitBonus(it) + it.agility + it.crit) +
    0.5 * (it.maxHp + it.maxMp) +
    1.5 * (it.regenHp + it.regenMp) +
    6 * it.range +
    8 * equipMoveBonus(it) +
    0.4 * (it.poison + it.stun)
  );
}

/** 判断价：质变的增益没法线性折算，按同组比较给的价 */
const JUDGED: Record<number, [number, string]> = {
  163: [600, '5 回合移动 +2（临时增益按 1/5，原判 3000）'],
  164: [700, '3 回合移动 +3，与旋风相当（总移动 9 对 10）'],
  185: [300, '3 回合抗毒，约解毒草药 6 倍'],
  187: [300, '3 回合抗昏，约解昏草药 6 倍'],
};

function consumableGuide(it: Item): [number, string] | null {
  if (JUDGED[it.id]) return JUDGED[it.id];
  if (it.type < 15 || it.type > 22) return null;
  // 持续回复（高级药，负责人 2026-11-26）按总量算进回复，和立即回复一起封顶
  const regen = (v: number) => (it.type >= 15 ? v * ITEM_REGEN_TURNS : 0);
  const hp = it.healHp < 0 ? HP_CAP : Math.min(HP_CAP, it.healHp + regen(it.regenHp));
  const mp = it.healMp < 0 ? MP_CAP : Math.min(MP_CAP, it.healMp + regen(it.regenMp));
  const cure = (it.curePoison || it.type === 18 ? CURE : 0) + (it.cureStun || it.type === 19 ? CURE : 0);
  const buff = itemBuffs(it).filter((b) => !b.stat.startsWith('regen')).reduce((s, b) => s + Math.abs(b.value) * b.turns * BUFF_RATE, 0);
  const parts = [hp && `体${hp}`, mp && `气${mp}`, cure && '解状态', buff && '增益'].filter(Boolean).join(' ');
  // 群体药按平均 2 人计（自己 + 约 1 个相邻同伴）
  const n = it.area ? 2 : 1;
  return [Math.round((hp * HP_RATE + mp * MP_RATE) * n + cure + buff), (it.area ? '群体×2 ' : '') + parts];
}

const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
};
/**
 * 指导价曲线 价 = c[组] × 点数^b。斜率 b 用武器和衣服一起拟合（两组单独拟合都在 1.9 左右），
 * 各组的 c 取中位数，这样几件定错价的不会把整条线带歪，偏离的就显出来。
 */
function fitCurves(groups: Record<string, { x: number; p: number }[]>) {
  const fitB = (ps: { x: number; p: number; g: string }[]) => {
    let sxy = 0;
    let sxx = 0;
    for (const g of new Set(ps.map((q) => q.g))) {
      const l = ps.filter((q) => q.g === g);
      const mx = l.reduce((s, q) => s + Math.log(q.x), 0) / l.length;
      const my = l.reduce((s, q) => s + Math.log(q.p), 0) / l.length;
      for (const q of l) {
        sxy += (Math.log(q.x) - mx) * (Math.log(q.p) - my);
        sxx += (Math.log(q.x) - mx) ** 2;
      }
    }
    return sxy / sxx;
  };
  const both = ['武器', '衣服'].flatMap((g) => groups[g].map((q) => ({ ...q, g })));
  let b = fitB(both);
  const a0 = (g: string) => median(groups[g].map((q) => Math.log(q.p) - b * Math.log(q.x)));
  // 第二遍剔除偏离超过 1.6 倍的再拟合斜率
  b = fitB(both.filter((q) => Math.abs(Math.log(q.p) - a0(q.g) - b * Math.log(q.x)) < Math.log(1.6)));
  const a = Object.fromEntries(Object.keys(groups).map((g) => [g, a0(g)]));
  return { b, at: (g: string, x: number) => Math.exp(a[g] + b * Math.log(Math.max(1, x))) };
}

const shop = data.items.filter((it) => it && it.buyPrice > 0 && it.category > 0 && it.seqA.some((t) => t > 0));
/** 饰品、玉、兵法：头饰栏里不加防御的那些 */
const isTrinket = (it: Item) => equipSlotOf(it) === 2 && it.defense === 0;
const groups: Record<string, Item[]> = { 武器: [], 衣服: [], 头饰: [], 饰品: [] };
for (const it of shop) {
  const k = equipSlotOf(it);
  if (k === 0) groups['武器'].push(it);
  else if (k === 1) groups['衣服'].push(it);
  else if (k === 2) groups[isTrinket(it) ? '饰品' : '头饰'].push(it);
}

interface Row { id: number; name: string; group: string; price: number; guide: number; note: string }
const rows: Row[] = [];
const curves = fitCurves(Object.fromEntries(Object.entries(groups).map(([g, l]) => [g, l.filter((it) => ORIGINAL.get(it.id)).map((it) => ({ x: equipPoints(it), p: ORIGINAL.get(it.id)! }))])));
console.log(`装备：价 ∝ 点数^${curves.b.toFixed(2)}`);
for (const [g, list] of Object.entries(groups)) {
  for (const it of list) {
    const x = equipPoints(it);
    rows.push({ id: it.id, name: it.name, group: g, price: it.buyPrice, guide: Math.round(curves.at(g, x) / 10) * 10, note: `${x.toFixed(1)} 点${ORIGINAL.get(it.id) ? '' : '（重制版上架）'}` });
  }
}
for (const it of shop) {
  const c = consumableGuide(it);
  if (c) rows.push({ id: it.id, name: it.name, group: '消耗品', price: it.buyPrice, guide: Math.max(10, Math.round(c[0] / 10) * 10), note: c[1] });
}

if (asJson) {
  // 落在区间外的，挪到最近的边上（取整到 10）
  const fix = rows.flatMap((r) => {
    if (r.price > r.guide * HIGH) return [{ id: r.id, name: conv(r.name), from: r.price, to: Math.floor((r.guide * HIGH) / 10) * 10 }];
    if (r.price < r.guide * LOW) return [{ id: r.id, name: conv(r.name), from: r.price, to: Math.ceil((r.guide * LOW) / 10) * 10 }];
    return [];
  });
  console.log(JSON.stringify(fix));
} else {
  console.log('\n| 道具 | 类 | 买价 | 指导价 | 买价/指导 | 依据 |\n|---|---|---|---|---|---|');
  for (const r of rows) {
    const ratio = r.price / r.guide;
    const tag = ratio > HIGH ? ' 贵' : ratio < LOW ? ' 便宜' : '';
    if (!showAll && !tag) continue;
    console.log(`| ${r.id} ${conv(r.name)} | ${r.group} | ${r.price} | ${r.guide} | ${ratio.toFixed(2)}${tag} | ${r.note} |`);
  }
}
