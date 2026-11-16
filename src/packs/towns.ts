// 主线续篇城镇的名称、阵容与入城对白。商品仍使用 townAfter 指定的现有城镇表。
import { joinLevel, type CampaignState } from '../rules/campaign.ts';
import { levelKit } from '../rules/equipment.ts';
import type { PackRuntime } from './build.ts';
import { townParty } from './campaign.ts';

export const insertTownName = (next: string): string => next === 'mainline/yuanyanglou' ? '孟州整备' : '阳谷整备';

/** 鸳鸯楼前开放下一战全部我方；阳谷保留宋江、武松、武龙三人。只初始化缺失人物，不覆盖已有资产。 */
export function prepareInsertTown(c: CampaignState, rt: PackRuntime, next: string): CampaignState {
  const mengzhou = next === 'mainline/yuanyanglou';
  const ids = mengzhou
    ? rt.stages.find(s => `${rt.id}/${s.id}` === next)!.units.filter(u => u.side === 'player').map(u => typeof u.class === 'number' ? u.class : rt.classIds.get(u.class)!)
    : [rt.classIds.get('sj-fugitive')!, rt.classIds.get('wusong')!, 0];
  const active = [...new Set(ids)];
  const view = townParty(c, rt);
  const level = joinLevel({ ...view, active }) || 28;
  for (const classId of active) if (!view.members.some(m => m.classId === classId)) {
    const cls = rt.data.classes[classId];
    const slots = [...cls.defaultItems];
    if (mengzhou) levelKit(rt.data, cls, level, slots);
    view.members.push({ classId, level, exp: 0, slots, forge: [] });
  }
  return { ...view, active };
}

export function insertTownIntro(next: string): { actor: string; text: string }[] {
  return next === 'mainline/yuanyanglou' ? [
    { actor: 'sj-fugitive', text: '前面便是孟州城。诸位先到街边补齐药品，整顿兵器，再去寻那三个主谋。' },
    { actor: 'wusong', text: '好！买齐所需，便去鸳鸯楼问个明白，休叫那伙贼人又害旁人！' },
  ] : [
    { actor: 'sj-fugitive', text: '二郎，你既要依文投营，哥哥不拦。只是孟州路远，我与武龙陪你走一程，也好从中照应。' },
    { actor: 'wusong', text: '哥哥肯这般相待，武松感激不尽。只是不可坏了公人的差事。' },
    { actor: 'sj-fugitive', text: '只照应盘缠行李，不劫官差。且在城中置办些衣药，再一同上路。' },
  ];
}
