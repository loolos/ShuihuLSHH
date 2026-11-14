// 酒店说书【新】（docs/game-design.md §7.5「说书」）：原版没有。
// 四段：城镇 3 鲁提辖拳打镇关西、城镇 4 豹子头林冲、城镇 8 杨志卖刀、城镇 9 托塔天王晁盖。
// 故事里的好汉在队里时，说完后他会站起来认账，并由玩家二选一（第一次选某项时有一点小礼物）；
// 不在队里时由酒客或队里相关的人说几句收尾。
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
  gift?: { item: number; lines: TaleLine[]; /** 物品栏满了时的台词 */ full?: TaleLine[] };
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
  /** 好汉在队里：说完后的互动，然后二选一（好汉这时还没入伙的故事没有这两项） */
  present?: TaleLine[];
  choice?: { title: string; text: string; options: TaleOption[] };
  /** 好汉入过伙就算在队里（上一关他是友军、不算出场时用，例：东溪村突围里的晁盖） */
  joined?: boolean;
}

export const TELLER = '说书先生';
const LU = 16, SHI = 3, HERO = 0, LIN = 11, YANG = 14, CHAO = 12, WU = 10, LIU = 17;
/** 女兒紅：酒店最便宜的酒（道具 169，买价 150 两） */
export const NVERHONG = 169;
/** 白酒（道具 168，买价 300 两） */
export const WHITE_WINE = 168;
/** 牛肉包子（道具 178，买价 400 两） */
export const BEEF_BUN = 178;

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
            full: [{ who: LU, text: '洒家身上塞不下了——拿碗来，就在这里喝了它！' }],
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
  {
    id: 'lin-baozitou',
    town: 4,
    title: '豹子头林冲',
    hero: LIN,
    pages: [
      '（醒木一拍）列位，到了东京，不可不知一个人。此人生得豹头环眼，燕颔虎须，八尺长短身材，三十四五年纪，一条丈八蛇矛使得出神入化。江湖上送他一个绰号，唤作「豹子头」——便是林冲林教头！',
      '林冲是东京人氏，父亲林提辖也是军中好手。他自小随父习武，十八般武艺件件精通，尤其一手枪棒，满东京的禁军，没有一个接得住他三十合。',
      '列位可还记得前任的王进王教头？只因他父亲当年一棒打翻了高俅，高俅做了殿帅府太尉，头一件事便要寻王进的晦气。王教头连夜挑着老娘，私走延安府去了。',
      '王教头一走，这八十万禁军枪棒教头的位子，便落在了林冲身上。林教头教起枪棒来，一招一式，规规矩矩，禁军上下哪个不服？背地里都说：「有林教头在，东京的枪棒便倒不了。」',
      '林冲家中有一位娘子，是张教头的女儿，生得端庄贤惠，夫妻二人恩爱和睦，左邻右舍都夸。林教头为人谦和，见了谁都是三分笑，只是一提起王教头的遭遇，便要皱眉叹气。',
      '可列位须知，这东京城里，太尉府的人惹不得，偏偏高太尉还有个干儿子「花花太岁」高衙内，专爱寻良家妇女的事。林教头这般人物，偏又娶了这般一位好娘子……（醒木一拍）祸福如何，且听下回分解！',
    ],
    absent: [
      { who: SHI, text: '林冲……正是师父信里要我们去找的那位林教头！', need: [SHI] },
      { who: LU, text: '豹子头？好名号！洒家倒想会一会他，看看是他的枪快，还是洒家的禅杖快！', need: [LU] },
      { who: HERO, text: '先找到人，把王教头的信交给他要紧。听这先生说，高衙内的事倒教人放心不下。' },
      { who: '酒客', text: '外乡人，在东京说话小声些。太尉府的人耳朵长着呢。' },
    ],
  },
  {
    id: 'yang-maidao',
    town: 8,
    title: '青面兽杨志卖刀',
    hero: YANG,
    pages: [
      '（醒木一拍）今日说一位将门之后。此人乃三代将门杨令公的后人，姓杨名志，因脸上生着老大一搭青记，人都唤他「青面兽」。武举出身，做到殿司制使官。',
      '只因道君皇帝要盖万岁山，差他押送花石纲上京。不料船到黄河，遭风打翻，失陷了花石纲，不敢回京交差，只得逃去他处躲避。后来遇了大赦，才收拾一担金银，回东京枢密院打点，想官复原职。',
      '谁知钱都使尽了，到殿帅府见高太尉，太尉把文书一笔都批倒了，喝道：「你这厮失陷了花石纲，又不来首告，倒又在逃！」一顿骂，赶出了殿帅府。',
      '杨志闷闷不已，盘缠也用尽了，只得把祖上留下的一口宝刀插了草标，拿到天汉州桥上去卖，要价三千贯。这口刀有三件好处：砍铜剁铁，刀口不卷；吹毛得过；杀人刀上没血。',
      '偏偏撞着京师有名的破落户泼皮「没毛大虫」牛二，喝得半醉，一步一攧撞将来，便要强买这刀。杨志剁了一叠铜钱，又吹断了头发，牛二只是不依，定要杨志当场杀个人来看。',
      '牛二揪住杨志，又劈胸来打。杨志一时性起，望他嗓子上只一刀，扑地倒了；赶入去，又搠了两刀，血流满地，死在地上。杨志也不逃走，叫街坊作证，径投开封府自首去了。',
      '府尹从轻发落，刺配北京大名府。梁中书爱他武艺，抬举他押送十万贯生辰纲上京。谁知前些日子在黄泥冈上，被一伙贩枣子的客人用蒙汗药麻翻，生辰纲劫得干干净净！那杨制使如今下落不明——且听下回分解！（醒木一拍）',
    ],
    absent: [{ who: '酒客', text: '可怜一身好武艺，三番两次都栽在别人手里。不知这杨制使如今流落何方。' }],
    present: [
      { who: YANG, text: '……先生说得倒也不差。只是那牛二，原本不该死在那口刀下。' },
      { who: TELLER, text: '这位客官，听口气……莫非认得杨制使？' },
      { who: LU, text: '哈哈！杨兄弟，你脸上那一搭青记，帽子再压低也藏不住啊！', need: [LU] },
      { who: LIN, text: '（原来杨兄也是被高俅所害……）', need: [LIN] },
      { who: '酒客', text: '青……青面兽？！官府正在满城拿他呢！' },
    ],
    choice: {
      title: '说书',
      text: '满堂酒客都偷眼望着杨志。',
      options: [
        {
          label: '让杨志当场认了',
          note: '大丈夫行不更名',
          lines: [
            { who: YANG, text: '不错，在下便是杨志。祖宗的刀卖了，生辰纲丢了，杨某不躲不藏。' },
            { who: TELLER, text: '好汉落难，非战之罪！这段书，小老儿往后要替制使多说几句好话。' },
          ],
          gift: {
            item: WHITE_WINE,
            lines: [{ who: '店小二', text: '杨制使，这坛白酒算小店敬您的，莫嫌粗陋！' }],
            full: [{ who: YANG, text: '身上带不下了。小二哥，心意杨某领了。' }],
          },
        },
        {
          label: '说先生认错人了',
          note: '这里是郓城县，何涛的人就在城里',
          lines: [
            { who: HERO, text: '先生认错人了。我这位兄弟是贩枣子的……不，是贩布的客人。' },
            { who: YANG, text: '……（压低帽檐，一言不发）' },
            { who: TELLER, text: '是、是，小老儿眼拙。列位，下回再说，下回再说。' },
          ],
        },
      ],
    },
  },
  {
    id: 'chao-tuota',
    town: 9,
    title: '托塔天王晁盖',
    hero: CHAO,
    joined: true,
    pages: [
      '（醒木一拍）列位，今日说的就是咱们本地的人物。济州郓城县东门外有两个村坊，一个东溪村，一个西溪村，只隔着一条大溪。东溪村的保正，姓晁名盖，祖上是本县本乡的富户。',
      '这晁保正平生仗义疏财，专爱结识天下好汉。但有人来投奔他的，不论好歹，便留在庄上住；若要去时，又将银两赍助他起身。他最爱刺枪使棒，身强力壮，不娶妻室，终日只是打熬筋骨。',
      '当初那西溪村常常有鬼，白日里迷人下水，在溪里无可奈何。忽一日，有个僧人经过，村中人备细说知此事。僧人指个去处，教用青石凿个宝塔，放在所在，镇住溪边。',
      '那塔一放，西溪村的鬼都赶过东溪村来了。晁保正听得，大怒，从溪里走将过去，把那座青石宝塔独自夺了过来，放在东溪边！列位，那可是青石凿的塔，晁保正一个人便扛过了溪！',
      '因此人皆称他做「托塔天王」。晁盖独霸在那村坊，江湖上都闻他的名字。只是近来听说……保正庄上出了些事，官府里的人进进出出。是福是祸，小老儿也不敢乱说——且听下回分解！（醒木一拍）',
    ],
    absent: [{ who: '酒客', text: '晁保正是好人，咱们东溪村谁没受过他的恩惠？但愿他平安无事。' }],
    present: [
      { who: CHAO, text: '……那座塔可重得很。晁某那日也是一时气不过，扛到半路才觉得腰快断了。' },
      { who: WU, text: '保正，官府四处拿你，你倒好，坐在这里听自己的书。', need: [WU] },
      { who: '酒客', text: '咦？这声音……您、您是晁保正？！' },
      { who: LIU, text: '（按住朴刀）哥哥，要不要俺先……', need: [LIU] },
      { who: '酒客', text: '莫慌莫慌！保正，俺们东溪村的人，谁会去报官？' },
    ],
    choice: {
      title: '说书',
      text: '满堂都是东溪村的乡亲，一齐望着晁盖。',
      options: [
        {
          label: '与乡亲们道别',
          note: '这一走，不知何时才能回来',
          lines: [
            { who: CHAO, text: '诸位乡亲，晁某连累大家受惊了。此去山高水远，诸位多多保重！' },
            { who: TELLER, text: '保正放心，这段书小老儿要说一辈子。' },
          ],
          gift: {
            item: BEEF_BUN,
            lines: [{ who: '店小二', text: '保正，这几个牛肉包子是掌柜的一点心意，路上吃！' }],
            full: [{ who: CHAO, text: '晁某身上带不下了，心意领了，留给乡亲们吃吧。' }],
          },
        },
        {
          label: '压低斗笠，悄悄离开',
          note: '免得连累乡亲',
          lines: [
            { who: WU, text: '保正，此地不宜久留。人多口杂，悄悄走罢。', need: [WU] },
            { who: CHAO, text: '……说得是。（放下一锭银子）先生，这是书钱。' },
          ],
        },
      ],
    },
  },
];

/** 这个城镇的酒店有没有说书 */
export const taleOf = (town: number): Tale | undefined => TALES.find((t) => t.town === town);

const inParty = (c: CampaignState, id: number) => partyMembers(c).some((m) => m.classId === id);

/** 好汉算不算在队里 */
export const heroPresent = (c: CampaignState, tale: Tale) =>
  !!tale.present && (inParty(c, tale.hero) || (!!tale.joined && c.members.some((m) => m.classId === tale.hero)));

/** 说完书之后的台词：好汉在队里时是认账的几句，否则是收尾（不在队里的人的台词略去） */
export function afterTale(c: CampaignState, tale: Tale): { present: boolean; lines: TaleLine[] } {
  const present = heroPresent(c, tale);
  const lines = ((present ? tale.present : tale.absent) ?? []).filter((l) => !l.need || l.need.every((id) => inParty(c, id) || (id === tale.hero && present)));
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
  const opt = tale.choice?.options[k];
  if (!opt) return { c, lines: [], got: 0 };
  const lines = opt.lines.filter((l) => !l.need || l.need.every((id) => inParty(c, id)));
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
    lines.push(...(g.full ?? []));
    return { c: { ...c, tales }, lines, got: 0 };
  }
  slots[k2] = g.item;
  const forge = slots.map((_, i) => (i === k2 ? 0 : (m.forge?.[i] ?? 0)));
  lines.push({ who: '', text: `〔${data.charNames[tale.hero]}得到了${it.name}。〕` });
  return { c: { ...c, tales, members: c.members.map((x) => (x === m ? { ...m, slots, forge } : x)) }, lines, got: g.item };
}
