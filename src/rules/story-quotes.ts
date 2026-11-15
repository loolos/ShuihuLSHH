// 主线对白里补的原著原文【新】（负责人 2026-11-15）：在原版对白之间插几句《水浒传》原文或按原著改写的句子。
// 不改原版文件：载入关卡时按原版某句对白定位，在它前后插入对白 / 旁白；原版剧本（Big5）和简体显示剧本插在同一位置，
// 保持两份区块一一对应。出处和核对情况见 docs/game-design.md §9.4。
import type { PasBlock, PasOp } from '../formats/pas.ts';

/** 说话者：角色号（0 = 主角，即 HUM 职业号），'旁白' = 旁白 */
export type Speaker = number | '旁白';
export type QuoteLine = [Speaker, string];

export interface StoryInsert {
  /** 插在含这段文字的那句之后（按简体文字匹配，替换过的按替换后的文字；每处只插一次） */
  after?: string;
  /** 插在这句（连同它前面点名说话者的指令）之前 */
  before?: string;
  lines: QuoteLine[];
}

/** 新加的死亡触发区块：角色号 death 的单位倒下时说几句 */
export interface StoryDeathBlock {
  death: number;
  lines: QuoteLine[];
}

const HERO = 0, WANG_JIN = 1, SHI_JIN = 3, LIN = 11, LU = 16, LI_ZHONG = 25, CHAI = 26,
  BAI_SHENG = 47, LI_JI = 49, CHEN_DA_ENEMY = 59, LU_QIAN = 64, HONG = 71;
const N = '旁白';

export const STORY_INSERTS: Record<string, StoryInsert[]> = {
  // 第 2 回：王进母子出逃前的两句原文
  'n-add01': [
    {
      after: '他以前曾被我父亲一棒打倒',
      lines: [[WANG_JIN, '那日他当着众人骂我：『你爷是街市上使花棒卖药的，你省的甚么武艺！』回到家中，我娘只说了一句：『我儿，三十六着，走为上着。』']],
    },
  ],
  // 第 2 回：王进看出史进棒法的破绽，一棒打翻史进；半年学成十八般武艺
  'act2-2': [
    {
      after: '可是，我只服那位大哥的功夫',
      lines: [
        [WANG_JIN, '这棒也使得好了，只是有破绽，赢不得真好汉。'],
        [SHI_JIN, '俺经了七八个有名的师父，我不信倒不如你！你敢和我扠一扠么？'],
        [N, '王进将棒一掣，却望史进怀里直搠将来，只一缴，史进的棒丢在一边，扑地望后倒了。'],
        [SHI_JIN, '……我枉自经了许多师父，原来不值半分！师父在上，受徒弟一拜！'],
      ],
    },
    {
      after: '呵呵...今天真是双喜临门',
      lines: [[N, '自此王进每日点拨史进：矛、锤、弓、弩、铳，鞭、简、剑、链、挝，斧、钺并戈、戟，牌、棒与枪、杈——十八般武艺，从头指教。']],
    },
  ],
  // 第 2 回：陈达借路，原文"好汉教我问谁？"
  n02: [
    {
      after: '陈达！就算我肯，还有一个不肯！',
      lines: [
        [CHEN_DA_ENEMY, '好汉教我问谁？'],
        [SHI_JIN, '你问得我手中这条棍棒肯时，便放你过去！'],
      ],
    },
  ],
  // 第 3 回：史进不肯落草
  'act3-4': [
    {
      after: '这样可好，有『九纹龙』史进在',
      lines: [[SHI_JIN, '我是个清白好汉，如何肯把父母遗体来点污了。你劝我落草，再也休题。']],
    },
  ],
  // 第 4–5 回：智真长老的四句偈；李忠认出鲁达（第 3 回三人同在渭州潘家酒楼吃酒）
  'act5-1': [
    {
      after: '结果在五台山上喝酒吃狗肉',
      lines: [
        [LU, '临走时，智真长老送了洒家四句偈子：『遇林而起，遇山而富，遇水而兴，遇江而止。』洒家到如今也参不透。'],
        [HERO, '（遇林而起……）'],
      ],
    },
    {
      after: '刚才被你们打的那名大汉叫做『小霸王』周通',
      lines: [
        [LI_ZHONG, '……咦，这位师父，你的声音好厮熟。莫不是渭州的鲁提辖？'],
        [LU, '洒家不是别人，老种经略相公帐前提辖鲁达的便是。如今出了家做和尚，唤做鲁智深。李忠，你还在街上使枪棒卖膏药么？'],
        [LI_ZHONG, '哥哥别来无恙！小弟如今在桃花山落草，惭愧，惭愧。'],
      ],
    },
  ],
  // 第 7 回：鲁智深认得林冲之父，二人结义
  'act5-2': [
    {
      after: '在下就是林冲。',
      lines: [
        [LU, '原来是林教头！洒家年幼时也曾到东京，认得令尊林提辖。'],
        [N, '林冲大喜，就当结义智深为兄。'],
      ],
    },
  ],
  // 第 7 回：鲁智深"洒家怕他甚鸟"
  n05: [
    {
      after: '有架可以打怎么不通知俺呢？',
      lines: [[LU, '林兄弟，你却怕他本官太尉，洒家怕他甚鸟！俺若撞见那撮鸟时，且教他吃洒家三百禅杖了去！']],
    },
  ],
  // 第 9 回：柴进相貌、家世
  'act8-1': [
    {
      before: '小可就是柴进。',
      lines: [[N, '只见一位官人，生得龙眉凤目，皓齿朱唇，三牙掩口髭须，三十四五年纪。']],
    },
    {
      after: '那有什么问题！我柴进平生不好什么',
      lines: [[CHAI, '不瞒教头，小可乃大周柴世宗嫡派子孙。自陈桥让位有德，太祖武德皇帝敕赐誓书铁券在家，谁敢到我庄上拿人？']],
    },
  ],
  // 第 9 回：比棒的利物；一棒扫倒洪教头
  'n-add10': [
    {
      after: '洪师父，请指教。',
      lines: [[CHAI, '二位教头比试，非比其他，这锭银子权为利物。哪位赢了，便拿了去。']],
    },
    {
      before: '呜啊！',
      lines: [[N, '林冲把棒一横，那棒直扫着洪教头臁儿骨上，洪教头撇了棒，扑地倒了。']],
    },
  ],
  // 第 10 回：风雪；陆谦临死
  n09: [
    {
      before: '地点是这里没错...洪教头！',
      lines: [[N, '正是严冬天气，彤云密布，朔风渐起，那雪正下得紧。']],
    },
    {
      before: '沧州也不能待下去了',
      lines: [
        [N, '林冲赶上陆谦，劈胸只一提，掼翻在雪地上。'],
        [LU_QIAN, '饶命！不干小人事，太尉差遣，不敢不来。'],
        [LIN, '奸贼！我与你自幼相交，今日倒来害我，怎不干你事！'],
        [N, '林冲手起一刀，结果了陆谦。'],
      ],
    },
  ],
  // 第 16 回：白胜挑酒上冈唱的歌
  'act10-1': [
    {
      after: '哈哈哈...原来是一场误会...咦？！又有人来了！',
      lines: [
        [N, '远远地一个汉子，挑着一副担桶，唱上冈子来。'],
        [BAI_SHENG, '赤日炎炎似火烧，野田禾稻半枯焦。农夫心内如汤煮，公子王孙把扇摇。'],
      ],
    },
  ],
  // 梁山泊（第 11 回起）
  'act14-2': [
    {
      after: '一行人在延安府待了三天',
      lines: [[N, '但见八百里梁山泊，港汊纵横，芦苇连天，宛子城雄踞在山顶上。']],
    },
  ],
  // 第 19 回：吴用拈须为号；林冲骂王伦
  'act14-3': [
    {
      before: '就算梁山粮少房稀',
      lines: [[N, '只见吴用把手来拈髭须。']],
    },
    {
      after: '哈哈哈...嘲笑我没什么本事？',
      lines: [[LIN, '你这嫉贤妒能的贼，不杀了要你何用！你也无大量之才，也做不得山寨之主！']],
    },
  ],
};

/** 原版句子整句换掉（和插入配合；原著原文或为了接上插入的句子） */
export const STORY_REPLACE: Record<string, Record<string, string>> = {
  n02: { '陈达！就算我肯，还有一个不肯！你问得我手中棍棒答应时，才放你过去！': '陈达！就算我肯，还有一个不肯！' },
  // 第 7 回原话
  'act5-3': { '光天化日之下调戏良家妇女，成何体统！': '调戏良人妻子，当得何罪！' },
  // 李忠已认出鲁达，鲁智深这句不再说"史兄弟的师父啊？"
  'act5-1': { '哦，史兄弟的师父啊？来来，坐下喝酒... 啊，椅子不够了；太公，拿椅子来！': '哈哈，原来都是故人！来来，坐下喝酒... 啊，椅子不够了；太公，拿椅子来！' },
  // 第 19 回：公孙胜祭风，火烧官船
  n13: { '经过一场恶战，终于逃脱了官兵的追捕。': '忽地起一阵怪风，芦苇丛中火船齐出，官船烧作一片——船上那个先生，便是祭风的公孙胜。何涛的人马死的死、逃的逃，众好汉逃脱了官兵的追捕。' },
};

/** 第 3 回：史进一刀杀了出首的李吉 */
export const STORY_DEATH_BLOCKS: Record<string, StoryDeathBlock[]> = {
  n03: [{ death: LI_JI, lines: [[SHI_JIN, '李吉！你如何诬告平人？我史家哪里亏待了你！']] }],
};

const NARRATOR = 0xffffffff;

function lineOps(lines: QuoteLine[]): PasOp[] {
  // quiet：只点名说话，不让隐藏的人随之登场（白胜在登场之前先唱歌）
  return lines.flatMap(([who, text]) => [
    { op: 12, flag: 1, value: who === '旁白' ? NARRATOR : who, quiet: true },
    { op: 13, flag: 1, value: 0, text },
  ]);
}

const norm = (s: string) => s.trim();

/**
 * 对一份剧本（原版或简体）做替换、插入、追加死亡区块。text 把原版文字转成简体用来匹配。
 * 返回新区块和没找到的定位句（测试用来确认每处都插上了）。
 */
export function applyStoryQuotes(stage: string, blocks: PasBlock[], text: (s: string) => string = (s) => s): { blocks: PasBlock[]; missing: string[] } {
  const key = stage.toLowerCase();
  const replace = STORY_REPLACE[key] ?? {};
  const inserts = STORY_INSERTS[key] ?? [];
  const deaths = STORY_DEATH_BLOCKS[key] ?? [];
  const found = new Set<StoryInsert>();
  const out = blocks.map((block) => {
    let ops = block.ops.map((op) => {
      if (!op.text) return op;
      const r = replace[norm(text(op.text))];
      return r ? { ...op, text: r } : op;
    });
    for (const ins of inserts) {
      if (found.has(ins)) continue;
      const anchor = ins.after ?? ins.before ?? '';
      const i = ops.findIndex((op) => (op.op === 13 || op.op === 29) && !!op.text && norm(text(op.text)).includes(anchor));
      if (i < 0) continue;
      found.add(ins);
      let at = i + 1;
      if (ins.before) {
        at = i;
        while (at > 0 && ops[at - 1].op === 12) at--;
      }
      const add = lineOps(ins.lines);
      // 插在句子之后、下一句又没有重新点名时，把原来的说话者点回来
      const next = ops[at];
      if (next && next.op !== 12) {
        const prev = ops.slice(0, at).filter((o) => o.op === 12).pop();
        if (prev) add.push({ ...prev, quiet: true });
      }
      ops = [...ops.slice(0, at), ...add, ...ops.slice(at)];
    }
    return { ...block, ops };
  });
  for (const d of deaths) {
    out.push({
      index: out.length,
      head: [1, 0, 0, 0, 0, 0, 0, 0, 1],
      trigger: { kind: 'death', char: d.death },
      cond: { type: 1, arg: d.death },
      ops: lineOps(d.lines),
    });
  }
  const missing = inserts.filter((x) => !found.has(x)).map((x) => x.after ?? x.before ?? '');
  return { blocks: out, missing };
}
