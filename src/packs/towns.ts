// 主线续篇城镇的名称、阵容与入城对白。商品仍使用 townAfter 指定的现有城镇表。
import { joinLevel, type CampaignState } from '../rules/campaign.ts';
import { levelKit } from '../rules/equipment.ts';
import type { PackRuntime } from './build.ts';
import { townParty } from './campaign.ts';
import entryLevels from '../data/entry-levels.json' with { type: 'json' };

const NAMES: Record<string, string> = { 'mainline/shiyong': '村镇整备', 'mainline/yuanyanglou': '孟州整备', 'mainline/jieyangzhen': '揭阳岭整备', 'mainline/fachang': '梁山泊整备', 'mainline/yekun': '清风山整备', 'mainline/zhujiadian': '独龙冈整备', 'mainline/panduolu': '独龙冈下寨', 'mainline/ruzhuang': '独龙冈营寨' };
/** 这些城镇开放下一战的全部我方，缺的人物按入场等级配齐装备。 */
const NEXT_ROSTER = new Set(['mainline/yuanyanglou', 'mainline/jieyangzhen', 'mainline/fachang', 'mainline/yekun', 'mainline/zhujiadian', 'mainline/panduolu', 'mainline/ruzhuang']);
/** 下一战里中途才来的我方（隐藏开场）不进城镇名单：独龙冈整备只有杨雄、石秀、时迁、武龙，鲁智深、武松半路赶到 */
const OPENING_ONLY = new Set(['mainline/zhujiadian', 'mainline/panduolu', 'mainline/ruzhuang']);
/** 名单照哪一关的开场我方配：三打祝家庄前的营寨（负责人 2026-11-25）下一关是孙立入庄的过场，名单按大仗 sanda 开场（内应 + 宋江一队，押在囚车里的不算） */
const ROSTER_FROM: Record<string, string> = { 'mainline/ruzhuang': 'mainline/sanda' };
export const insertTownName = (next: string): string => NAMES[next] ?? '阳谷整备';

/** 鸳鸯楼前开放下一战全部我方；阳谷保留宋江、武松、武龙三人。解甲留锋后三将与同行的宋江、武龙、李逵、王英整备。只初始化缺失人物，不覆盖已有资产。 */
export function prepareInsertTown(c: CampaignState, rt: PackRuntime, next: string): CampaignState {
  const mengzhou = NEXT_ROSTER.has(next);
  const roadside = next === 'mainline/shiyong';
  const ids = roadside
    ? [0, ...['sj-fugitive','huarong','huangxin','qinming','likui','wangying'].map(id => rt.classIds.get(id)!)]
    : mengzhou
    ? rt.stages.find(s => `${rt.id}/${s.id}` === (ROSTER_FROM[next] ?? next))!.units.filter(u => u.side === 'player' && !u.prisonCart && !(OPENING_ONLY.has(next) && u.hidden)).map(u => typeof u.class === 'number' ? u.class : rt.classIds.get(u.class)!)
    : [rt.classIds.get('sj-fugitive')!, rt.classIds.get('wusong')!, 0];
  const active = [...new Set(ids)];
  const view = townParty(c, rt);
  const level = joinLevel({ ...view, active }) || 28;
  // 选关直接进城镇（手上没有人）：每人按下一战的入场等级配（entry-levels.json），不再一律 28 级（负责人 2026-11-25 发现独龙冈营寨全是 28 级）
  const fresh = !view.members.length;
  const preset = (entryLevels.levels as Record<string, Record<string, number>>)[ROSTER_FROM[next] ?? next] ?? {};
  const keyOf = (classId: number) => [...rt.classIds].find(([, v]) => v === classId)?.[0] ?? String(classId);
  for (const classId of active) if (!view.members.some(m => m.classId === classId)) {
    const cls = rt.data.classes[classId];
    const own = fresh ? preset[String(classId)] ?? preset[keyOf(classId)] : undefined;
    const lv = own ?? level;
    const slots = [...cls.defaultItems];
    if (mengzhou || roadside) levelKit(rt.data, cls, lv, slots);
    view.members.push({ classId, level: lv, exp: 0, slots, forge: [] });
  }
  return { ...view, active };
}

export function insertTownIntro(next: string): { actor: string; text: string }[] {
  if (next === 'mainline/yekun') return [
    { actor: 'huarong', text: '多亏二龙山三位兄弟援手，救得哥哥出来。只是黄信那厮逃了回去，青州必然发兵来打清风山。' },
    { actor: 'sj-fugitive', text: '鲁大师、武二郎、杨制使已自回山。我等且在山下村坊补些药品，整顿兵器，提防官军。' },
    { actor: 'wangying', text: '山寨里有的是金银，兄弟们只管去置办！' },
  ];
  if (next === 'mainline/ruzhuang') return [
    { actor: 'sunli', text: '小弟孙立，带着登州一伙兄弟，特来投奔宋头领。祝家庄的教师栾廷玉，和小弟是一个师父教的。' },
    { actor: 'sj-fugitive', text: '原来如此！两番打那祝家庄，折了好几个兄弟，正愁没个门路进去。' },
    { actor: 'sunli', text: '小弟只说是登州调来郓州守把，路过拜望师兄。他不疑我，便好在庄里做个内应。' },
    { actor: 'sj-fugitive', text: '好计！诸位且在营里补齐药品，整顿兵器。这一回里应外合，定要打破祝家庄，救出众兄弟。' },
  ];
  if (next === 'mainline/panduolu') return [
    { actor: 'sj-fugitive', text: '石秀、杨林两个兄弟去探路，到这早晚还不见回来。庄上又点起灯来，只怕凶多吉少。' },
    { actor: 'likui', text: '哥哥等甚么！铁牛先杀进去，把那祝家庄砍个干净，两个兄弟自然救出来了！' },
    { actor: 'sj-fugitive', text: '也罢，等不得了。众兄弟且在寨里补些药品，整顿兵器，今夜便进兵。遇着岔路，千万莫要乱走。' },
  ];
  if (next === 'mainline/zhujiadian') return [
    { actor: 'yangxiong', text: '出了蓟州地界，追兵是不会来了。前面是郓州，再走几日便到梁山泊。' },
    { actor: 'shiqian', text: '哥哥，小弟身上一文也无，路上的盘缠、刀枪伤药，都靠二位哥哥置办了。嘿嘿。' },
    { actor: 'shixiu', text: '且在这镇上补些药品，换口好刀。听说前面独龙冈不太平，小心为上。' },
  ];
  if (next === 'mainline/fachang') return [
    { actor: 'huarong', text: '武龙兄弟连夜报信，公明哥哥和戴院长定在江州十字路口问斩。晁头领已点起十七个兄弟，分作四伙，扮了客商、丐者、脚夫、使枪棒的。' },
    { actor: 'likui', text: '（江州城里）铁牛自在城里等着，到时候从茶坊楼上跳下去，一斧一个！' },
    { actor: 'huarong', text: '诸位且在山上补齐药品，整顿兵器。下山之后，便要一路杀进江州了。' },
  ];
  if (next === 'mainline/jieyangzhen') return [
    { actor: 'lijun', text: '哥哥在小弟家歇了这几日，棒疮也好些了。岭下店里刀枪药物都有，缺甚么只管置办。' },
    { actor: 'sj-fugitive', text: '多得兄弟相救。也好，路上用得着的，都置办齐了再走。' },
  ];
  if (next === 'mainline/shiyong') return [
    { actor: 'huarong', text: '前面便是村镇。两位且补些衣药，整顿兵刃，再同大队上路。' },
    { actor: 'huangxin', text: '也罢。眼前所需，先置办齐了。' },
    { actor: 'qinming', text: '买齐便走，休在此处耽搁。' },
  ];
  return next === 'mainline/yuanyanglou' ? [
    { actor: 'sj-fugitive', text: '前面便是孟州城。诸位先到街边补齐药品，整顿兵器，再去寻那三个主谋。' },
    { actor: 'wusong', text: '好！买齐所需，便去鸳鸯楼问个明白，休叫那伙贼人又害旁人！' },
  ] : next === 'mainline/shizipo' ? [
    { actor: 'sj-fugitive', text: '二郎，你既要依文投营，哥哥不拦。只是孟州路远，我与武龙陪你走一程，也好从中照应。' },
    { actor: 'wusong', text: '哥哥肯这般相待，武松感激不尽。只是不可坏了公人的差事。' },
    { actor: 'sj-fugitive', text: '只照应盘缠行李，不劫官差。且在城中置办些衣药，再一同上路。' },
  ] : []; // 没登记的城镇不说话，免得落到阳谷的对白（负责人 2026-11-23）
}
