// 测试用跳关【新】：从关卡下拉框直接进后面的关卡时，按那一关的难度给我方人物补上等级和装备，
// 免得拿 1 级人物打后期关卡。原版没有这个功能。
import { parseAct, type ActUnit } from '../formats/act.ts';
import { parsePasHeader } from '../formats/pas.ts';
import type { CampaignState, Member } from './campaign.ts';
import { canEquip, equipSlotOf, isHealing, itemOf, SLOT_COUNT, type GameData } from './data.ts';
import { findStageFile, type FileSource } from './load.ts';
import { stock } from './town.ts';

/** 城镇按游戏进度的先后（道具 +146 城镇号表的排列顺序；6 与 12 是两条路线上的同一站） */
export const TOWN_ORDER = [1, 2, 3, 4, 5, 13, 6, 12, 7, 8, 9, 10, 11];

interface Stage {
  index: number;
  mapName: string;
}

function readStage(files: FileSource, s: Stage): { units: ActUnit[]; town: number } {
  const act = findStageFile(files, s.mapName, '.act');
  const pab = findStageFile(files, s.mapName, '.pab');
  return { units: act ? parseAct(files.get(act), act) : [], town: pab ? parsePasHeader(files.get(pab)).town : 0 };
}

/**
 * 跳到第 target 关时的推荐状态：
 * - 等级 = 这一关敌人的平均等级（四舍五入；敌人全是 1 级的过场关看后面第一场真正的战斗），不低于原有等级；
 * - 装备 = 之前去过的最后一个城镇的武器店里，本职业能用的攻击最高的武器、防御最高的衣服和头饰（比原有的好才换）；
 * - 物品栏补 2 个药铺里回复最多的药；
 * - 技能随等级自动领悟。
 */
export function jumpTo(files: FileSource, data: GameData, stages: Stage[], target: number, c: CampaignState): CampaignState {
  const pos = stages.findIndex((s) => s.index === target);
  if (pos < 0) return c;
  const info = new Map<number, ReturnType<typeof readStage>>();
  const at = (i: number) => info.get(i) ?? info.set(i, readStage(files, stages[i])).get(i)!;

  let level = 1;
  for (let i = pos; i < stages.length; i++) {
    const foes = at(i).units.filter((u) => u.side === 'enemy');
    if (!foes.some((u) => u.level > 1)) continue; // 过场关的敌人都是 1 级摆设
    level = Math.round(foes.reduce((a, u) => a + u.level, 0) / foes.length);
    break;
  }
  let town = 0;
  for (let i = 0; i < pos; i++) {
    const t = at(i).town;
    if (t && TOWN_ORDER.indexOf(t) > TOWN_ORDER.indexOf(town)) town = t;
  }

  const shop = town ? stock(data, 1, town).map((id) => itemOf(data, id)!) : [];
  const drugs = town ? stock(data, 3, town) : [];
  const potion = drugs.filter((id) => isHealing(itemOf(data, id))).sort((a, b) => heal(data, b) - heal(data, a))[0];

  const members = new Map(c.members.map((m) => [m.classId, m]));
  for (const u of at(pos).units) {
    if (u.side !== 'player' || !data.classes[u.type]) continue;
    const cls = data.classes[u.type];
    const old = members.get(u.type);
    const slots = old ? [...old.slots] : cls.defaultItems.slice(0, SLOT_COUNT);
    u.items.forEach((id, k) => !old && id && (slots[k] = id));
    while (slots.length < SLOT_COUNT) slots.push(0);
    const forge = slots.map((_, k) => old?.forge?.[k] ?? 0);
    for (let k = 0; k < 3; k++) {
      const score = (id: number) => {
        const it = itemOf(data, id);
        return it ? (k === 0 ? it.attack : it.defense) : -1;
      };
      const best = shop.filter((it) => equipSlotOf(it) === k && canEquip(cls, it, data)).sort((a, b) => (k === 0 ? b.attack - a.attack : b.defense - a.defense))[0];
      if (!best) continue;
      const id = data.items.indexOf(best) + 1;
      if (score(id) > score(slots[k])) {
        slots[k] = id;
        forge[k] = 0;
      }
    }
    if (potion) {
      let n = slots.filter((id, k) => k >= 3 && id === potion).length;
      for (let k = 3; k < SLOT_COUNT && n < 2; k++) if (!slots[k]) (slots[k] = potion), (forge[k] = 0), n++;
    }
    const m: Member = { classId: u.type, level: Math.max(level, u.level, old?.level ?? 1), exp: old && old.level >= level ? old.exp : 0, slots, forge };
    members.set(u.type, m);
  }
  return { ...c, town: undefined, stage: target, members: [...members.values()] };
}

const heal = (data: GameData, id: number) => {
  const it = itemOf(data, id)!;
  return it.healHp < 0 ? 999 : it.healHp;
};
