// 物品价格审计（game-design §7.6）：按效果给每件商店货一个指导价，列出买价偏离太多的。
// 用法：node --experimental-transform-types tools/price-audit.ts [--all]
//   默认只列偏离超过 ±40% 的；--all 列全部。
//
// 指导价怎么算：
// - 装备：把各项效果按重制版规则折成「点数」（命中按 1/4 扣法、移动不扣，见 equipHitBonus / equipMoveBonus），
//   武器、衣服、头饰、饰品（玉、兵法）各拟合一条 价格 = c × 点数^b（各组的 c 取中位数），拟合用原版自带价格（剔除偏离过大的再拟合一次），
//   所以指导价代表「原版大多数同类货的定价水平」。
// - 回复药：按实际能回的量计价，体力 2.5 两/点、气力 2 两/点；回满和超过上限的都按好汉 45 级的上限算（体力 300、气力 200），
//   解毒、解昏各 50 两。
// - 限时增益：小加值按 加值 × 回合 × 17 两（原版五种酒的平均）；+255 / 必杀 100% / 加移动这类质变的没法线性比，按同组比较给一个判断价。
import { loadGameData } from '../src/rules/load.ts';
import type { Item } from '../src/formats/goo.ts';
import { equipHitBonus, equipMoveBonus, equipSlotOf, ITEM_OVERRIDES, itemBuffs } from '../src/rules/data.ts';
import { nodeGameFiles } from './sim-lib.ts';
import t2s from '../gamedata/tables/t2s.json' with { type: 'json' };

const conv = (s: string) => [...s].map((c) => (t2s as Record<string, string>)[c] ?? c).join('');
const data = loadGameData(nodeGameFiles());
const showAll = process.argv.includes('--all');

const HP_RATE = 2.5;
const MP_RATE = 2;
const HP_CAP = 300;
const MP_CAP = 200;
const CURE = 50;
const BUFF_RATE = 17;

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
  162: [5000, '3 回合必杀 100%'],
  163: [3000, '5 回合移动 +2'],
  164: [3500, '3 回合移动 +3，与旋风相当（总移动 9 对 10）'],
  185: [300, '3 回合抗毒，约解毒草药 6 倍'],
  187: [300, '3 回合抗昏，约解昏草药 6 倍'],
  188: [8000, '3 回合防御 +255（近乎不受伤）'],
  189: [8000, '3 回合命中 +255（必中）'],
  190: [8000, '3 回合敏捷 +255（近乎必闪）'],
  191: [4000, '3 回合攻击带毒 20%'],
  192: [4000, '3 回合攻击致昏 20%'],
};

function consumableGuide(it: Item): [number, string] | null {
  if (JUDGED[it.id]) return JUDGED[it.id];
  if (it.type < 15 || it.type > 22) return null;
  const hp = it.healHp < 0 ? HP_CAP : Math.min(HP_CAP, it.healHp);
  const mp = it.healMp < 0 ? MP_CAP : Math.min(MP_CAP, it.healMp);
  const cure = (it.curePoison || it.type === 18 ? CURE : 0) + (it.cureStun || it.type === 19 ? CURE : 0);
  const buff = itemBuffs(it).reduce((s, b) => s + Math.abs(b.value) * b.turns * BUFF_RATE, 0);
  const parts = [hp && `体${hp}`, mp && `气${mp}`, cure && '解状态', buff && '增益'].filter(Boolean).join(' ');
  return [Math.round(hp * HP_RATE + mp * MP_RATE + cure + buff), parts];
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

const shop = data.items.filter((it) => it && it.buyPrice > 0 && it.category > 0);
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
const curves = fitCurves(Object.fromEntries(Object.entries(groups).map(([g, l]) => [g, l.filter((it) => !ITEM_OVERRIDES[it.id]).map((it) => ({ x: equipPoints(it), p: it.buyPrice }))])));
console.log(`装备：价 ∝ 点数^${curves.b.toFixed(2)}`);
for (const [g, list] of Object.entries(groups)) {
  for (const it of list) {
    const x = equipPoints(it);
    rows.push({ id: it.id, name: it.name, group: g, price: it.buyPrice, guide: Math.round(curves.at(g, x) / 10) * 10, note: `${x.toFixed(1)} 点${ITEM_OVERRIDES[it.id] ? '（重制版上架）' : ''}` });
  }
}
for (const it of shop) {
  const c = consumableGuide(it);
  if (c) rows.push({ id: it.id, name: it.name, group: '消耗品', price: it.buyPrice, guide: Math.max(10, Math.round(c[0] / 10) * 10), note: c[1] });
}

console.log('\n| 道具 | 类 | 买价 | 指导价 | 买价/指导 | 依据 |\n|---|---|---|---|---|---|');
for (const r of rows) {
  const ratio = r.price / r.guide;
  if (!showAll && ratio < 1.4 && ratio > 1 / 1.4) continue;
  console.log(`| ${r.id} ${conv(r.name)} | ${r.group} | ${r.price} | ${r.guide} | ${ratio.toFixed(2)}${ratio >= 1.4 ? ' 贵' : ratio <= 1 / 1.4 ? ' 便宜' : ''} | ${r.note} |`);
}
