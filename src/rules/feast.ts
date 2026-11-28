// 酒店请客【新】（负责人 2026-11-26，docs/game-design.md §7.5「请客」）：原版没有。
// 几个有代表性的城镇（下一关就是一场仗、开场的人正好是城镇名单）的酒店可以花一笔固定的银子请众人吃一顿，
// 三种酒菜三种增益，数值按城镇名单的平均等级算；下一场仗开场时在场的我方全员都有，持续 FEAST_TURNS 回合。
// 纯数据和纯函数，界面在 src/game/town.ts，开场加增益在 Battle.begin（StageInput.feast）。
import type { CampaignState } from './campaign.ts';
import { buffName, type Buff } from './data.ts';
import type { TaleLine } from './storyteller.ts';
import { partyMembers } from './town.ts';

/** 一桌的价钱（固定，不按人数；负责人 2026-11-26） */
export const FEAST_PRICE = 800;
/** 增益持续的回合数（和酒一样） */
export const FEAST_TURNS = 5;

export interface FeastDrink {
  label: string;
  /** 店小二端上来时说的话 */
  serve: string;
  /** 按平均等级算出的增益 */
  buffs: (level: number) => Buff[];
}

const b = (stat: Buff['stat'], value: number): Buff => ({ stat, value, turns: FEAST_TURNS });

/**
 * 三种酒菜（负责人 2026-11-26：攻击必杀 / 回体回气 / 防御敏捷）。L = 城镇名单的平均等级。
 * 参照原版好汉平均（10 / 20 / 30 / 40 级）：攻 99 / 133 / 167 / 202、防 67 / 108 / 149 / 190、敏 68 / 100 / 132 / 164、
 * 必 23 / 32 / 41 / 50、体 138 / 182 / 225 / 269，加的大约是两成；回体每回合约为体力上限的 7%–9%。
 */
export const FEAST_DRINKS: FeastDrink[] = [
  { label: '透瓶香·大块牛肉', serve: '好酒来了！透瓶香，又唤作出门倒，再切几斤熟牛肉。', buffs: (L) => [b('attack', 5 + L), b('crit', 3 + Math.floor(L / 5))] },
  { label: '药酒·炖鸡汤', serve: '人参药酒，配一锅炖得稀烂的老母鸡，最是补气养身。', buffs: (L) => [b('regenHp', 5 + Math.floor(L / 2)), b('regenMp', 5 + Math.floor(L / 2))] },
  { label: '清茶·素面', serve: '清茶一壶，素面管够。客官们明日有事，少吃两碗酒也好。', buffs: (L) => [b('defense', 5 + L), b('agility', 5 + Math.floor((L * 3) / 4))] },
];

/** 一个城镇的请客：入席后谁说什么（只说给名单里在的人；who 是职业号，续篇城镇的包人物写 '@包职业名'，由界面换成职业号） */
export interface FeastPlace {
  /** 增益管的那一场仗（续篇城镇之后先演一段过场时写；不写就是城镇之后那一关） */
  battle?: string;
  lines: { who: number | string; text: string }[];
}

/**
 * 可以请客的城镇：原版城镇按城镇号，续篇城镇按下一关（<包>/<关卡>）。
 * 负责人 2026-11-26 要求只挑 5、6 个最有代表性的；都是下一关直接开打、开场在场的人就是城镇名单
 * （野猪林前、沧州城、梁山泊畔、阳谷整备、村镇整备之后换人或隔着剧情，不做）。
 */
export const FEAST_PLACES: Record<string, FeastPlace> = {
  // 桃花山下 → 关西道遇伏 / 山林小径遇伏：少华山四人跟武龙下山去延安府
  '2': {
    lines: [
      { who: 3, text: '店家，好酒好肉只管上来！史进一把火烧了庄子，今日难得兄弟们聚在一处。' },
      { who: 13, text: '大郎爽快！吃饱了，路上撞见官兵强人，陈达一枪一个。' },
      { who: 5, text: '前路不知是官兵把守还是强人出没，吃过这顿，明日都要打起精神。' },
    ],
  },
  // 东京城 → 倒拔垂杨柳：鲁智深看守大相国寺菜园，明日去会那伙泼皮
  '4': {
    lines: [
      { who: 16, text: '洒家在寺里口中淡出鸟来，今日有酒有肉，来得正好！' },
      { who: 3, text: '师兄慢些吃。明日去菜园子，那伙泼皮怕是要寻事。' },
      { who: 16, text: '怕他甚鸟！吃饱了，洒家正好拿他们消食。' },
    ],
  },
  // 郓城县 → 叫阵晁家庄：去东溪村会托塔天王
  '8': {
    lines: [
      { who: 11, text: '都说东溪村晁保正仗义疏财，明日去他庄上，不知肯不肯相见。' },
      { who: 14, text: '他若要较量手段，杨某奉陪。今日先吃饱了，好使力气。' },
      { who: 16, text: '好酒！明日洒家打头阵，叫那晁天王出来说话！' },
    ],
  },
  // 石碣村 → 梁山泊前夺路：七星聚义之后，三阮的老家，明日杀奔梁山泊
  '10': {
    lines: [
      { who: 9, text: '这几碗酒，比当初吴教授请咱弟兄吃的那顿还痛快！' },
      { who: 10, text: '吃了这顿便上梁山泊。只是官兵追得紧，王伦那里也未必肯收留。' },
      { who: 12, text: '众兄弟满饮此碗！明日同心协力，杀出一条路去。' },
    ],
  },
  // 清风山整备 → 夜困霹雳：秦明要来打清风山
  'mainline/yekun': {
    lines: [
      { who: '@wangying', text: '哥哥只管吃！山寨里有的是酒肉，莫替小弟省银子。' },
      { who: '@likui', text: '好酒好肉！铁牛吃饱了，明日砍那姓秦的兵，一斧一个！' },
      { who: '@huarong', text: '秦明性如烈火，明日须用计困他。兄弟们吃饱便好，莫要贪杯。' },
      { who: '@sj-fugitive', text: '众兄弟且吃几碗，养足了精神，明日一同迎敌。' },
    ],
  },
  // 独龙冈下寨 → 盘陀路：石秀探庄未回、杨林被拿，宋江要硬闯祝家庄（负责人 2026-11-26 加）
  'mainline/panduolu': {
    lines: [
      { who: '@sj-fugitive', text: '石秀兄弟探庄未回，杨林又被拿了去。众兄弟今夜吃饱，明日只好打进庄去。' },
      { who: '@likui', text: '怕他甚么！铁牛打头阵，见一个砍一个！' },
      { who: '@huarong', text: '听说庄里的路七弯八绕，明日进去，大伙紧跟着走，莫要走散。' },
      { who: '@yangxiong', text: '只盼石秀兄弟平安回来。' },
    ],
  },
  // 独龙冈营寨 → 孙立入庄（过场）→ 宋公明三打祝家庄：孙立一伙来投、愿做内应（负责人 2026-11-26 加）
  'mainline/ruzhuang': {
    battle: 'mainline/sanda',
    lines: [
      { who: '@sj-fugitive', text: '两番打祝家庄都折了兄弟。这回有孙提辖做内应，众兄弟满饮此碗！' },
      { who: '@sunli', text: '小弟明日便领一伙人入庄，到时里应外合，叫他首尾不能相顾。' },
      { who: '@gudasao', text: '老娘先干了这碗！到时候里头外头一齐杀。' },
      { who: '@likui', text: '这回总该让铁牛杀个痛快了吧？' },
      { who: 10, text: '众位依计而行，切莫走漏了风声。' },
    ],
  },
  // 独龙冈整备 → 火烧祝家店：杨雄、石秀、时迁投梁山，路过独龙冈
  'mainline/zhujiadian': {
    lines: [
      { who: '@shiqian', text: '有酒有肉，只可惜少只下酒的鸡。' },
      { who: '@shixiu', text: '前面便是祝家庄地界，那里的人不好惹。吃了这顿，路上少惹是非。' },
      { who: '@yangxiong', text: '兄弟说得是。时迁，你那手脚也收着些。' },
    ],
  },
  // 武冈镇 → 入云龙斗法破高廉：李逵、公孙胜在镇上认了汤隆，明日赶回高唐州
  'mainline/polian': {
    lines: [
      { who: '@likui', text: '店家，好酒好肉只管上来！今日认了个打铁的兄弟，铁牛做东！' },
      { who: '@tanglong', text: '到了高唐州，哥哥们看小弟这条铁瓜锤！' },
      { who: 2, text: '贫道以茶代酒。明日破那高廉妖法，众位只管向前。' },
    ],
  },
};

/** 名单的平均等级（四舍五入，至少 1） */
export function feastLevel(c: CampaignState): number {
  const list = partyMembers(c);
  return Math.max(1, list.length ? Math.round(list.reduce((a, m) => a + m.level, 0) / list.length) : 1);
}

/** 已经为下一关请过客（stages 是这一城之后可能去的关：原版地图名或 <包>/<关卡>） */
export const feasted = (c: CampaignState, stages: string[]) => !!c.feast && c.feast.stages.some((s) => stages.includes(s));

/** 请客：扣银子，记下下一关开场的增益 */
export function orderFeast(c: CampaignState, drink: number, stages: string[]): { ok: boolean; c: CampaignState; text: string } {
  const d = FEAST_DRINKS[drink];
  if (!d) return { ok: false, c, text: '' };
  if (feasted(c, stages)) return { ok: false, c, text: '已经请过众人了。' };
  if (c.gold < FEAST_PRICE) return { ok: false, c, text: `银子不够，一桌要 ${FEAST_PRICE} 两。` };
  const buffs = d.buffs(feastLevel(c));
  return { ok: true, c: { ...c, gold: c.gold - FEAST_PRICE, feast: { stages, drink, buffs } }, text: `众人吃了${d.label}。下一场战斗开场${feastText(buffs)}。` };
}

/** 例："攻击+35、必杀+9，持续 5 回合" */
export function feastText(buffs: Buff[]): string {
  return `${buffs.map((x) => `${buffName(x.stat)}+${x.value}`).join('、')}，持续 ${FEAST_TURNS} 回合`;
}

/** 这一关开场要加的请客增益（存档里记的关要对得上） */
export function feastFor(c: CampaignState, stage: string): Buff[] | undefined {
  if (!c.feast?.stages.some((s) => s.toLowerCase() === stage.toLowerCase())) return undefined;
  // 状态栏显示的来源名：酒菜名的头一样（透瓶香 / 药酒 / 清茶）
  const source = FEAST_DRINKS[c.feast.drink]?.label.split('·')[0] ?? '请客';
  return c.feast.buffs.map((b) => ({ ...b, source }));
}

/** 入席后的对白，只留名单里在的人 */
export function feastLines(place: FeastPlace, c: CampaignState, resolve: (who: string) => number | undefined): TaleLine[] {
  const party = new Set(partyMembers(c).map((m) => m.classId));
  return place.lines.flatMap((l) => {
    const who = typeof l.who === 'number' ? l.who : resolve(l.who.slice(1));
    return who !== undefined && party.has(who) ? [{ who, text: l.text }] : [];
  });
}
