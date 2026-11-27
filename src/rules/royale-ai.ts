// 好汉聚义（吃鸡，docs/game-design.md §15.31）的 AI【新：负责人 2026-11-22 要求单做，因为要跑圈】。
// 顺序：在圈外先跑圈（走得到圈里就顺手打）；体力低又没药就去找宝箱；能打就打（只站在圈里出手）；
// 包里有空、走得到的宝箱就去开；附近有对手就在圈里朝他走，没有就往圈中心靠。缩圈前两回合按下一个圈算。
// 吃药在行动前单独判断（royaleHealSlot），不算行动。小头目只守自己那一片：不追出警戒范围，出圈也往里跑。
import type { Cell } from './board.ts';
import type { Battle } from './battle.ts';
import { forcedExtra } from './battle.ts';
import { alertRadius, bestAttack, healSkill, withCharge, type AiPlan } from './ai.ts';
import { freeBagSlot, isHealing, itemBuffs, itemOf } from './data.ts';
import { inZone, NPC_TEAM, type Zone } from './royale.ts';
import { dist, type Unit } from './unit.ts';

/** 体力低于这个比例就吃药 */
export const HEAL_BELOW = 0.45;
/** 体力低于这个比例、身上又没药，就先去找宝箱 */
const LOOT_BELOW = 0.6;
/** 对手在这么多步以内才主动去找（远了就先往圈中心靠，不满地图追人） */
const HUNT = 12;
/** 离缩圈还有几回合起就按下一个圈走 */
const EARLY_RUN = 2;

/** 要不要吃药、吃哪一格：体力低于 HEAL_BELOW（在圈外、下回合要掉血时提前到 HEAL_BELOW + 圈的伤害）；挑补得最多又不浪费的那一种 */
export function royaleHealSlot(b: Battle, u: Unit): number {
  const st = b.royale;
  if (!st || !u.alive || !u.present || b.spectators.has(u.uid)) return -1;
  const zoneHit = inZone(st.zone, u) ? 0 : 1 / (b.royaleRules?.damageDivisor ?? 5);
  if (u.hp >= u.stats.maxHp * (HEAL_BELOW + zoneHit)) return -1;
  const missing = u.stats.maxHp - u.hp;
  let best = -1, bestScore = -Infinity;
  u.slots.forEach((id, k) => {
    const it = itemOf(b.data, id);
    if (k < 3 || !isHealing(it) || !it!.healHp) return;
    const heal = it!.healHp < 0 ? missing : it!.healHp;
    // 补满不溢出的里面挑补得多的；都会溢出就挑溢出最少的
    const score = heal <= missing ? heal : missing - heal;
    if (score > bestScore) { bestScore = score; best = k; }
  });
  return best;
}

/** 气低于这个比例就吃回气的药（包子） */
const QI_BELOW = 0.35;
/** 对手在这么多步以内就先喝加状态的药酒 */
const BOOST_NEAR = 8;

/**
 * 回体以外的药（打倒好汉搜出来的）【新】：气不够就吃回气的；附近有对手、身上又没有这种增益，就喝加状态的药酒。
 * 跟吃回体药一样不算行动；一回合最多再吃一样。
 */
export function royaleBoostSlot(b: Battle, u: Unit): number {
  if (!b.royale || !u.alive || !u.present || b.spectators.has(u.uid) || u.team === NPC_TEAM) return -1;
  let qi = -1, boost = -1;
  const foeNear = () => b.units.some((v) => v !== u && v.alive && v.present && v.team !== undefined && v.team !== u.team && dist(u, v) <= BOOST_NEAR);
  u.slots.forEach((id, k) => {
    const it = itemOf(b.data, id);
    if (k < 3 || !it || it.healHp) return;
    if (it.healMp && qi < 0 && u.mp < u.stats.maxMp * QI_BELOW) qi = k;
    const buffs = itemBuffs(it).filter((x) => x.value > 0);
    if (buffs.length && boost < 0 && !buffs.every((x) => u.buffs.some((y) => y.stat === x.stat && y.value >= x.value))) boost = k;
  });
  if (qi >= 0) return qi;
  return boost >= 0 && foeNear() ? boost : -1;
}

const hasHeal = (b: Battle, u: Unit) => u.slots.some((id, k) => k >= 3 && isHealing(itemOf(b.data, id)) && !!itemOf(b.data, id)!.healHp);

/** 这一步要守的圈：快缩圈了就按下一个圈 */
export function goalZone(b: Battle): Zone {
  const st = b.royale!;
  const cd = b.royaleCountdown();
  return st.next && cd !== null && cd <= EARLY_RUN ? st.next : st.zone;
}

export function planRoyale(b: Battle, u: Unit): AiPlan {
  if (b.spectators.has(u.uid) || !b.royale) return {};
  const goal = goalZone(b);
  const safe = (c: Cell) => inZone(goal, c);
  if (!safe(u)) return run(b, u, goal);
  if (u.team === NPC_TEAM) {
    // 小头目：守自己那一片，警戒范围里有人才动手，不出圈
    const near = b.aiFoesOf(u).filter((t) => dist(u, t) <= alertRadius(b, u));
    if (!near.length) return withCharge(b, u, {});
    return bestAttack(b, u, undefined, u.stats.move, safe) ?? withCharge(b, u, approach(b, u, near, safe));
  }
  const heal = u.hp < u.stats.maxHp / 2 ? healSkill(b, u) : null;
  if (heal) return heal;
  if (u.hp < u.stats.maxHp * LOOT_BELOW && !hasHeal(b, u)) {
    const loot = chestPlan(b, u, safe, true);
    if (loot) return loot;
  }
  const atk = bestAttack(b, u, undefined, u.stats.move, safe);
  if (atk) return atk;
  if (freeBagSlot(u.slots) >= 0) {
    const loot = chestPlan(b, u, safe, false);
    if (loot) return loot;
  }
  // 附近（HUNT 步以内）有对手就过去打，否则往圈中心靠（到了半径的一半以内就不动），路上捡宝箱
  const foes = nearestFoes(b, u);
  const field = b.board.distanceField([u]);
  if (foes.length && field[foes[0].y * b.board.width + foes[0].x] <= HUNT) return withCharge(b, u, approach(b, u, foes, safe));
  const st = b.royale;
  const centre = st.next ?? st.zone;
  if (Math.hypot(u.x - centre.x, u.y - centre.y) <= centre.r / 2) return withCharge(b, u, {});
  return withCharge(b, u, approach(b, u, [{ x: centre.x, y: centre.y }], safe));
}

/** 跑圈：能从圈里的格子出手就打；否则朝圈里走，正常走不进去就强行军 */
function run(b: Battle, u: Unit, goal: Zone): AiPlan {
  const atk = bestAttack(b, u, undefined, u.stats.move, (c) => inZone(goal, c));
  if (atk) return atk;
  const w = b.board.width;
  const cells: Cell[] = [];
  for (let y = 0; y < b.board.height; y++) for (let x = 0; x < w; x++) if (b.board.passable(x, y) && inZone(goal, { x, y })) cells.push({ x, y });
  const field = b.board.distanceField(cells);
  const pick = (budget: number) => {
    const reach = b.reachOf(u, budget);
    let best: { x: number; y: number; cost: number } | null = null;
    let bestD = field[u.y * w + u.x];
    for (const n of reach.values()) {
      const d = field[n.y * w + n.x];
      if (d < bestD || (d === bestD && best && n.cost < best.cost)) { bestD = d; best = n; }
    }
    return { reach, best, d: bestD };
  };
  const walk = pick(u.stats.move);
  if (walk.d > 0) {
    const forced = pick(u.stats.move + forcedExtra(u));
    if (forced.best && forced.d < walk.d) return { path: b.pathOf(forced.reach, forced.best) };
  }
  return walk.best ? { path: b.pathOf(walk.reach, walk.best) } : {};
}

/** 去开宝箱：走得到宝箱旁边（上下左右一格，或宝箱本身）的圈里格子；urgent = 走不到也朝最近的宝箱走 */
function chestPlan(b: Battle, u: Unit, safe: (c: Cell) => boolean, urgent: boolean): AiPlan | null {
  const chests = b.items.filter((g) => itemOf(b.data, g.item) && safe(g));
  if (!chests.length) return null;
  const reach = b.reachOf(u, u.stats.move);
  let best: { x: number; y: number; cost: number } | null = null;
  for (const n of reach.values()) {
    if (n.cost === 0 || !safe(n) || !chests.some((g) => dist(g, n) <= 1)) continue;
    if (!best || n.cost < best.cost) best = n;
  }
  // 走过去就开了（walk 里走到宝箱旁边就打开）
  if (best) return { path: b.pathOf(reach, best) };
  return urgent ? approach(b, u, chests, safe) : null;
}

/** 离得最近的对手（按格子步数，绕开墙）；先找好汉以外也算小头目 */
function nearestFoes(b: Battle, u: Unit): Unit[] {
  const foes = b.aiFoesOf(u);
  if (!foes.length) return [];
  const field = b.board.distanceField([u]);
  const d = (t: Unit) => field[t.y * b.board.width + t.x];
  const min = Math.min(...foes.map(d));
  return foes.filter((t) => d(t) === min);
}

/** 在圈里朝目标走：挑走得到的圈里格子里离目标最近的（停在相邻格） */
function approach(b: Battle, u: Unit, goals: Cell[], safe: (c: Cell) => boolean): AiPlan {
  if (!goals.length) return {};
  const w = b.board.width;
  const field = b.board.distanceField(goals);
  const reach = b.reachOf(u, u.stats.move);
  let best: { x: number; y: number; cost: number } | null = null;
  let bestD = Math.max(1, field[u.y * w + u.x]);
  if (bestD <= 1) return {};
  for (const n of reach.values()) {
    if (!safe(n)) continue;
    const d = Math.max(1, field[n.y * w + n.x]);
    if (d < bestD || (d === bestD && best && n.cost < best.cost)) { bestD = d; best = n; }
  }
  return best ? { path: b.pathOf(reach, best) } : {};
}
