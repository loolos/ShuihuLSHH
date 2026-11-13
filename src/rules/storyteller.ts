// 酒店说书【新】（docs/game-design.md §7.5「说书」）：原版没有。
// 先试做一段：城镇 3（桃花村之后、往延安府路上）的酒店说「鲁提辖拳打镇关西」。
// 故事的主角鲁智深若在队里，说完后他会站起来认账，并由玩家二选一；第一次选「亲口说」时店家送一坛女儿红。
// 全部是纯数据和纯函数，界面在 src/game/town.ts。
import type { CampaignState } from './campaign.ts';
import { freeBagSlot, itemOf, SLOT_COUNT, type GameData } from './data.ts';
import { partyMembers } from './town.ts';

/** 说话的人：职业号（有头像，名字取职业名表，0 号是主角名）或旁人的称呼 */
export type Speaker = number | string;

export interface TaleLine {
  who: Speaker;
  text: string;
  /** 这些人都在队里才说这句（例：史進说自己就是出十两银子的史大郎） */
  need?: number[];
}

export interface TaleOption {
  label: string;
  /** 选项下面的一行小字 */
  note: string;
  lines: TaleLine[];
  /** 第一次选这一项时的小礼物：送给故事主角的道具号，及送礼的台词 */
  gift?: { item: number; lines: TaleLine[] };
}

export interface Tale {
  id: string;
  town: number;
  title: string;
  /** 故事里的好汉（职业号） */
  hero: number;
  /** 说书先生一页一页地说 */
  pages: string[];
  /** 好汉不在队里时的收尾 */
  absent: TaleLine[];
  /** 好汉在队里：说完后的互动，然后二选一 */
  present: TaleLine[];
  choice: { title: string; text: string; options: TaleOption[] };
}

export const TELLER = '说书先生';
const LU = 16, SHI = 3, HERO = 0;
/** 女兒紅：酒店最便宜的酒（道具 169，买价 150 两） */
export const NVERHONG = 169;

export const TALES: Tale[] = [
  {
    id: 'lu-zhenguanxi',
    town: 3,
    title: '鲁提辖拳打镇关西',
    hero: LU,
    pages: [
      '（醒木一拍）列位看官！今日不说帝王将相，单表一位好汉。话说渭州城里，经略府有个提辖，姓鲁名达，生得面圆耳大，鼻直口方，腮边一部貉獭胡须，身长八尺，腰阔十围。',
      '这一日，鲁提辖同史大郎、李忠三个上潘家酒楼吃酒。正吃得热闹，只听隔壁阁子里有人哽哽咽咽地啼哭。提辖焦躁起来，便把碟儿盏儿都丢在楼板上。',
      '唤来一问，却是东京来的金老汉父女。那女儿唤作翠莲，被本处一个财主强媒硬保，写了三千贯文书，虚钱实契，要了她身子；不到三个月，又被大娘子打将出来，倒追那三千贯典身钱！',
      '列位道这财主是谁？便是状元桥下卖肉的郑屠，绰号「镇关西」！提辖听了大怒：「呸！俺只道哪个郑大官人，却原来是杀猪的郑屠！这个腌臜泼才，倒如此欺负人！」',
      '提辖摸出五两银子，史大郎拿出十两，李忠只摸得二两来银子，提辖嫌他不爽利，丢还了他。当下赍发金老父女回乡；次日一早，提辖亲自守在店门口，坐了两个时辰，约莫他们去得远了，方才起身。',
      '提辖径到状元桥下，叫郑屠切十斤精肉，不要见半点肥的，细细切做臊子；再要十斤肥的，不要见些精的，也切做臊子；末了又要十斤寸金软骨，也要细细剁了，不要见些肉在上面。',
      '郑屠道：「却不是特地来消遣我！」提辖跳起身来，把两包臊子劈面打去，却似下了一阵「肉雨」。郑屠大怒，拔出一把剔骨尖刀，托地跳将下来。',
      '提辖只一拳，正打在鼻子上，打得鲜血迸流，却便似开了个油酱铺：咸的、酸的、辣的，一发都滚出来。再一拳，打在眼眶际眉梢，却似开了个彩帛铺：红的、黑的、紫的，都绽将出来。',
      '第三拳，太阳上正着，却似做了一个全堂水陆的道场：磬儿、钹儿、铙儿一齐响。只见郑屠挺在地下，口里只有出的气，没了入的气，动弹不得。',
      '提辖口里只骂：「你这厮诈死，洒家再打！」一头骂，一头大踏步去了。正是：三拳打死镇关西，世上少了个鲁提辖，多了个花和尚！欲知后事如何——且听下回分解！（醒木一拍）',
    ],
    absent: [
      { who: '酒客', text: '好！说得痛快！只可惜那鲁提辖，如今不知流落到何方去了。' },
      { who: TELLER, text: '客官莫急，好汉自有好汉的去处。下回分解，下回分解。' },
    ],
    present: [
      { who: LU, text: '好！说得好！只是有一处说岔了——洒家那三拳，原只想教训那厮一顿，谁知他恁地不经打！' },
      { who: TELLER, text: '这、这位师父……这等细处，您老如何知道？' },
      { who: SHI, text: '先生，那日在潘家酒楼上出十两银子的史大郎，便是在下。', need: [SHI] },
      { who: LU, text: '哈哈哈！洒家便是关西鲁达！如今剃了头，唤作鲁智深！' },
      { who: '酒客', text: '啊？！真是鲁提辖本人？！' },
      { who: HERO, text: '（鲁兄这一嗓子，只怕半条街都听见了……）' },
    ],
    choice: {
      title: '说书',
      text: '满堂酒客都望着鲁智深。',
      options: [
        {
          label: '请鲁大哥亲口说一段',
          note: '让他上台讲讲后来的事',
          lines: [
            { who: LU, text: '说便说！那郑屠倒在地下，洒家心里其实也慌了，嘴上却骂他诈死，一溜烟出了南门。后来上了五台山，又吃酒吃狗肉，打坏了山门的金刚……' },
            { who: TELLER, text: '妙！妙！这一段小老儿明日就编进书里，题目便叫「花和尚醉打山门」！' },
            { who: '酒客', text: '好——！再来一段！' },
          ],
          gift: {
            item: NVERHONG,
            lines: [{ who: '店小二', text: '掌柜的说了，师父今日的酒钱全免！再送一坛女儿红，给师父路上解渴！' }],
          },
        },
        {
          label: '按住鲁大哥，莫要声张',
          note: '他还在官府的榜文上',
          lines: [
            { who: HERO, text: '鲁兄，你如今还在官府的榜文上，莫要声张。' },
            { who: LU, text: '……也罢也罢。先生，你接着说下回，洒家不吭声便是。' },
            { who: TELLER, text: '（擦汗）好、好……列位，下回再说，下回再说。' },
          ],
        },
      ],
    },
  },
];

/** 这个城镇的酒店有没有说书 */
export const taleOf = (town: number): Tale | undefined => TALES.find((t) => t.town === town);

const inParty = (c: CampaignState, id: number) => partyMembers(c).some((m) => m.classId === id);

/** 说完书之后的台词：好汉在队里时是认账的几句（不在队里的人的台词略去），否则是收尾 */
export function afterTale(c: CampaignState, tale: Tale): { present: boolean; lines: TaleLine[] } {
  const present = inParty(c, tale.hero);
  const lines = (present ? tale.present : tale.absent).filter((l) => !l.need || l.need.every((id) => inParty(c, id)));
  return { present, lines };
}

export interface TaleResult {
  c: CampaignState;
  lines: TaleLine[];
  /** 送出的道具号（没送为 0） */
  got: number;
}

/**
 * 选了第 k 项：返回要说的台词和新的状态。礼物每个存档只送一次（记在 tales），
 * 主角的物品栏满了就当场喝掉（不给东西）。
 */
export function chooseTale(c: CampaignState, data: GameData, tale: Tale, k: number): TaleResult {
  const opt = tale.choice.options[k];
  if (!opt) return { c, lines: [], got: 0 };
  const lines = [...opt.lines];
  const g = opt.gift;
  if (!g || c.tales?.includes(tale.id)) return { c, lines, got: 0 };
  const it = itemOf(data, g.item);
  const m = c.members.find((x) => x.classId === tale.hero);
  if (!it || !m) return { c, lines, got: 0 };
  const tales = [...(c.tales ?? []), tale.id];
  lines.push(...g.lines);
  const slots = [...m.slots];
  while (slots.length < SLOT_COUNT) slots.push(0);
  const k2 = freeBagSlot(slots);
  if (k2 < 0) {
    lines.push({ who: tale.hero, text: '洒家身上塞不下了——拿碗来，就在这里喝了它！' });
    return { c: { ...c, tales }, lines, got: 0 };
  }
  slots[k2] = g.item;
  const forge = slots.map((_, i) => (i === k2 ? 0 : (m.forge?.[i] ?? 0)));
  lines.push({ who: '', text: `〔${data.charNames[tale.hero]}得到了${it.name}。〕` });
  return { c: { ...c, tales, members: c.members.map((x) => (x === m ? { ...m, slots, forge } : x)) }, lines, got: g.item };
}
