// 扩展包的 JSON 格式（docs/game-design.md §15.2）。包放在仓库 packs/<包名>/，内容用字符串 id，
// 载入时（src/packs/build.ts）接到原版编号后面。原版素材一律按编号引用，不复制。

import type { RecolorGroup } from './recolor.ts';

export type StatBlock = { hp: number; mp: number; attack: number; defense: number; hit: number; agility: number; crit: number };

export interface PackJson {
  id: string;
  name: string;
  description?: string;
  /**
   * 在游戏流程里的位置：standalone = 外传，从标题「选关」单独进入，等级固定，不碰主线存档；
   * mainline = 主线插关与续篇（docs/game-design.md §15.8），插在哪里、属于哪一章写在章节表 src/rules/chapters.ts
   */
  entry: 'standalone' | 'mainline';
  /** 素材来源与署名（CC-BY 的必须写） */
  credits?: string[];
  classes: PackClassJson[];
  items?: PackItemJson[];
  /** 关卡文件（相对包目录，如 stages/jingyanggang.json） */
  stages: string[];
}

export interface PackClassJson {
  id: string;
  name: string;
  /** 1 级时的属性；之后按 §5 的成长公式（growth.ts）涨 */
  base: StatBlock;
  move: number;
  /** 武器类型（同原版职业表，1 = 棍） */
  weaponType?: number;
  /** 默认装备与随身物品：原版道具号，或本包道具的字符串 id */
  items?: (number | string)[];
  /** 好汉（我方可操作的人物）：技能不带命中修正，载入时改成 0 并折算威力（heroSkillNoHitMod，负责人 2026-11-22） */
  hero?: boolean;
  /** 第一项是普通攻击 */
  skills: PackSkillJson[];
  /** 形象：包里的精灵图条（SheetSprite），或者借原版职业的动画并换色（BorrowSprite） */
  sprite: SheetSprite | BorrowSprite;
  /** 对话头像：借原版 Head.lib 第几张，或者包里自己的图（相对包目录，宽 140、透明底，tools/make-portrait.py 生成）；null = 不显示 */
  face?: { fromHead: number } | { file: string } | null;
}

/** 精灵图条目录（相对包目录，含 sprites.json），和动作对应 */
export interface SheetSprite {
  sheet: string;
  /** 待机、走路、受击、防御用哪个动作（sprites.json 里的名字） */
  idle: string;
  walk: string;
  hurt: string;
  defend: string;
  /** 头顶状态条的高度（像素，脚下往上），不填用普通身材 */
  head?: number;
}

/**
 * 借原版职业（Man.lib）的全部动作，按调色板换色（src/packs/recolor.ts）。
 * 技能的 anim 写原版职业第几个出手动作（0 = 动作 3，通常是普通攻击），命中帧沿用 from 技能的原版数据。
 */
export interface BorrowSprite {
  fromClass: number;
  recolor?: RecolorGroup[];
  head?: number;
  /**
   * 个别动作改借别的原版职业（混搭）：键是 walk / hurt / defend，或技能 anim 的数字（0 = 第一个出手动作）。
   * 宋江原版只有走路：走路用自己的，受击、防御、出手借王伦、公孙胜（docs/game-design.md §15.2）。
   */
  parts?: Record<string, BorrowPart>;
  /** parts 用的换色方案，按名字引用 */
  recolors?: Record<string, RecolorGroup[]>;
  /** walk = 待机姿势用走路第 1 帧（出手动作是别人的身体时，站着仍是自己的样子） */
  idle?: 'walk';
  /** parts 里写了 shoes 的动作，把脚染成这个色阶（如红鞋 36–46），按形状找脚，见 recolor.ts paintShoes */
  shoes?: { dst: [number, number]; k?: number };
}

export interface BorrowPart {
  fromClass: number;
  /** 被借职业的 Man.lib 动作号：0 走路、1 受击、2 防御，3 起出手 */
  action: number;
  /** 换色：recolors 里的名字，或直接写换色组 */
  recolor?: string | RecolorGroup[];
  shoes?: boolean;
}

export interface PackSkillJson {
  /** 本包内的字符串 id，剧本里用它指技能 */
  id: string;
  name: string;
  /** 借哪个原版技能（技能号）的类型、范围、特效和声音；下面的字段覆盖它 */
  from: number;
  /** 出手动画：sprites.json 里的名字；借原版动画的职业写原版第几个出手动作（0 起） */
  anim: string | number;
  /** 在出手动画的什么位置命中（0–1，一段一个数）；借原版动画的职业不用写 */
  hitAt?: number[];
  /** 和 hitAt 一一对应的伤害百分比（合计 100）；省略 = 平均分 */
  hitPercent?: number[];
  power?: number;
  mpCost?: number;
  learnLevel?: number;
  /** 可在距离内的整个菱形选点，不限四条直线。 */
  targetShape?: 'diamond';
  /** 类型 8 的回气技作用于队友，而非自己。 */
  chargeTarget?: 'ally';
  /** 远程技能的距离伤害系数：[最近、最远]；未指定用通用50%→10%。 */
  rangedDamage?: [number, number];
  /** 一次施放连续重复出手动作的次数；默认1，命中帧按完整动作周期配置。 */
  castCycles?: number;
  /** 长方形范围以选中格为第一排中心；不填仍从施放者身前开始。 */
  areaOrigin?: 'target';
  /** 相对选中格的范围偏移：[横向,前方]，随施放方向旋转。 */
  areaPattern?: [number, number][];
  /** 出手动作与命中帧的播放倍率，默认1；不改变规则伤害。 */
  castSpeed?: number;
  /** 命中时受击者身上的简单画面效果：blood = 溅血、explosion = 爆炸（Effect.lib 第 40 组）（只是画面） */
  hitFx?: 'blood' | 'explosion' | 'impact' | 'fire';
  /** 遠程技飞行中的箭的画面效果：fire = 火箭（只是画面） */
  arrowFx?: 'fire';
  /** 穿透：从施放者身前一格起整条直线都受击（长 max(area, 到施放点的距离)） */
  pierce?: boolean;
  rangeMin?: number;
  rangeMax?: number;
  area?: number;
  stun?: number;
  /** 蒙汗药酒【新】：不伤人、必定喝下，敌人麻翻这么多回合（已经麻翻的不能再劝）；用在没被麻翻的人身上以外的攻击，见关卡 banquet */
  drug?: number;
  poison?: number;
  hitMod?: number;
  critMod?: number;
  /** 范围类型：14 = 前方长方形；15 = 正前、前两格及左右前方，共四格；16 = 身前一格为柄，其前方展开三条各 area 格的射线；17 = 前方倒锥形，area行，第一排2×area−1格，逐排减2至1格【新】。 */
  type?: number;
  /** 特效：Effect.lib 组号 + 1 */
  effect?: number;
  /** 后续两段特效：组号+1；显式0禁用借用技能的后续段。 */
  effect2?: number;
  effect3?: number;
  /** 命中段（借原版动画时用）：原版帧号、伤害百分比、方向（迴旋技 0–3 四个方向） */
  hits?: { frame: number; percent: number; dir: number }[];
}

export interface PackItemJson {
  id: string;
  name: string;
  /** 借哪个原版道具（道具号）的全部字段（图标、类型等）；下面的字段覆盖它 */
  from: number;
  description?: string;
  attack?: number;
  defense?: number;
  agility?: number;
  hit?: number;
  /** 道具类型码（0–12 武器类，如 11 = 弓）；不写沿用 from */
  type?: number;
  /** 买价；卖价取一半 */
  buyPrice?: number;
  /** 在哪些城镇（原版城镇号）的武器店有卖 */
  shop?: number[];
  /** 27×27 图标 PNG（包内路径）；没有这张图时沿用 from 的原版图标 */
  icon?: string;
}

/** 剧本里指单位用关卡 units 的 id */
export interface PackStageJson {
  id: string;
  title: string;
  /**
   * 故事视角标签（切到武松等人物）。主线插关仍读写连续存档；独立外传才隔离主线资产。
   * 主线通过packParty/recordPackResult保存原版及包职业，不再由此字段跳过结算
   */
  pov?: boolean;
  /** 教学关（序章「禁军教场」，§15.26）【新】：不读也不写存档里的人物（等级、经验、装备、道具）和银子，人物按关卡写的等级出场 */
  tutorial?: boolean;
  /** 主线按本场实际队伍平均等级调整敌友，已有队友等级不重置。 */
  dynamicLevels?: boolean;
  /** 胜利后进入续篇城镇整备（原版商品表号）。 */
  townAfter?: number;
  /** 潜行关【新】：被哨兵发现后，没在期限内打倒发现的人就判负（lose 是判负文字）；flag 是被发现时设上的剧本标志 */
  stealth?: { lose: string; flag?: string };
  /**
   * 默认装备、药品按每个人的等级表生成。"none" 禁用自动配装（剧情中装备由关卡指定）。
   * 旧存档/包中的主线地图名仍可读取，但不再影响配装。
   */
  gearAt?: string;
  /** 外传：过关后「下一关」按钮进哪一关（本包关卡 id）；主线插关的先后按章节表 */
  next?: string;
  /** 过关奖励：银子（代替原版关卡的过关奖励表，视角关不给） */
  rewards?: { gold?: number };
  /** 地图：借原版地图（地表、地上物、通行都照原版），或用重制版自拼地图 */
  /** base：借用的原版地图；custom：自拼地图 packs/maps/<名字>.json（§15.15）；crop：只用其中一块 [x, y, 宽, 高]（格子坐标，单位坐标相对这一块）；
   *  open：改成可通行的格子 [[x, y], …]（坐标同单位，例如让人从原版堵死的大门走出来） */
  map: ({ base: string; custom?: undefined } | { custom: string; base?: undefined }) & { crop?: [number, number, number, number]; open?: [number, number][]; /** 封死的格子（关着的大门），剧本 ["unseal", 格子] 打开【新】（智取无为军）；第三项写地上物图块号时画面上在这格摆它（盘陀路的路障），不写就用地图本来的图块 */ seal?: ([number, number] | [number, number, number])[] };
  /** 路障候选路口【新】（盘陀路）：剧本 ["trap", …] 从这里挑离我方最近的堵上；tag 给 exclude 用 */
  traps?: { cells: [number, number][]; tag?: string; /** 这处路障的图块（不填用 trap 指令的 tile） */ tile?: number }[];
  /** 蹴鞠关（§15.25）【新】：攻击只能踢球；球场、球门、开球点、几球获胜、回合数 */
  cuju?: import('../rules/cuju.ts').CujuRules;
  /**
   * 好汉聚义（吃鸡，§15.31）【新】：玩家从出场过的好汉里选一人，另外随机 opponents 人，各自为战，活到最后获胜。
   * 参赛好汉和小头目在开打前按地图自动摆（src/packs/royale.ts），units 里只写别的东西（通常为空）。
   * 道具写原版道具号或本包道具 id；小头目的职业写原版职业号或本包职业 id。
   */
  royale?: Omit<import('../rules/royale.ts').RoyaleRules, 'chestItems' | 'npcs'> & {
    chestItems: (number | string)[];
    npcs: { classes: (number | string)[]; count: number; level: number; drops: (number | string)[] };
  };
  /** 主线包里的独立外传【新】：不进章节表，列在选关的「外传」组，等级固定、不碰主线存档（蹴鞠） */
  sideStory?: boolean;
  /**
   * 酒席【新】（杯酒救铁牛）：标志 flag 没设上之前，我方对敌人出手（劝酒以外的攻击、技能），
   * 只要目标身边 sight 格（默认 2）内有醒着的敌人（目标自己醒着也算），就设上 flag（惊动了押解的人）；打已经麻翻、身边没人醒着的不惊动
   */
  banquet?: { flag: string; sight?: number };
  /** 天色滤镜（§15.15）：夜、雪、黄昏；只改画面，不改规则 */
  tint?: 'night' | 'snow' | 'dusk';
  /** 背景音乐（music.ts 的曲目名；数组 = 轮放的歌单） */
  bgm?: string | string[];
  units: PackUnitJson[];
  script: PackBlockJson[];
  /** AI 优先轮着用的技能：单位 id → 技能 id（老虎的三招） */
  aiPrefer?: Record<string, string[]>;
}

export interface PackUnitJson {
  id: string;
  /** 本包职业的字符串 id，或原版职业号 */
  class: string | number;
  side: 'player' | 'ally' | 'enemy';
  x: number;
  y: number;
  /** 0 背向右上、1 背向左上、2 面向左下、3 面向右下（同原版） */
  facing?: number;
  level: number;
  /** 本关最大体力倍率，含模板与装备；不改变其他属性，默认1。 */
  hpMultiplier?: number;
  /** 相对本场队伍平均等级的偏移（动态关卡敌人/友军）。 */
  levelOffset?: number;
  /** 明确区分借杂兵模型的头领与普通兵；省略时按职业分类。 */
  enemyRank?: 'troop' | 'leader';
  /** 开局不在场，剧本点名（appear / say）时登场 */
  hidden?: boolean;
  /** 被押送者的囚车外观；解开绑缚后移除，只影响画面。 */
  prisonCart?: boolean;
  /** 观战演员：不可行动、不可成为攻击或技能的目标；仍占据自己的格子。 */
  spectator?: boolean;
  /** 只在对话里出声、不上地图：开局隐藏，say 点名时也不登场（例如景阳冈的酒家） */
  offstage?: boolean;
  /** AI 模式（§8），默认 0 */
  ai?: number;
  /** AI 12（守屋）的屋子范围 [x1, y1, x2, y2]（含边界）：有敌人进来之前原地驻守，进来后转为模式 0 出战 */
  guardArea?: [number, number, number, number];
  /** AI 模式 1/5/10 的目标人物（单位 id；按职业找人，所以目标的职业要唯一） */
  target?: string;
  /** AI 模式 4 先走到的格子 */
  point?: [number, number];
  /** 潜行关的哨兵【新】：警戒半径（格子步数），我方有人进来就被发现（§15.21 穆家庄夜遁） */
  watch?: number;
  /** 潜行关哨兵认得的人（职业）：他们进了警戒范围也不算被发现（黄文炳家门子认得侯健）【新】 */
  trusts?: (string | number)[];
  /** AI 13 巡逻的路线【新】：依次走过这些格子，走完回到第一个 */
  patrol?: [number, number][];
  /** 劝酒【新】：refuse = 头几次推辞不喝；turns = 麻翻几回合（覆盖技能的 drug）；by = 只肯喝这些职业劝的酒（别人劝一律推辞） */
  drink?: { refuse?: number; turns?: number; by?: (string | number)[]; /** 只吃了一点：挨打就醒 */ light?: boolean };
  /** 劝酒时说的话，轮着说【新】 */
  toasts?: string[];
  /** 本关临时会的技能【新】（技能 id），只在这一关有，如朱贵扮酒保会劝酒 */
  skills?: (string | number)[];
  /** 显示的名字，不填用职业名 */
  name?: string;
  /** 各自为战的阵营号【新】（好汉聚义）：设了的人只和同号的人一伙、不看 side；参赛好汉各自一号，小头目共用 -1 */
  team?: number;
  /** 装备与物品，覆盖职业默认（7 格：武器、衣服、头饰、物品×4） */
  items?: (number | string)[];
}

export type PackTrigger =
  | 'start'
  /** 在场的敌人全部倒下（还没登场的隐藏单位不算，要等他们登场后也倒下） */
  | 'enemiesDefeated'
  /** 本关全部敌人战败，包含尚未登场的隐藏增援。 */
  | 'allEnemiesDefeated'
  /** 同 enemiesDefeated，但被蒙汗药麻翻、还睡着的敌人不算【新】（杯酒救铁牛） */
  | 'awakeEnemiesDefeated'
  | { turn: number }
  | { dead: string }
  /** 进入区域；写数组时这几个人都到了区域里才触发 */
  /** label：这个区域算过关目标、在地图上标出时旁边写的字（默认「撤退」，教学关写「目标」「将台」） */
  /** enter: "player" = 我方任何一个在场的人进去都算【新】 */
  | { enter: string | string[]; area: [number, number, number, number]; label?: string; /** 回合结束（敌方行动完、下回合开始前）人还在里面才触发【新】 */ atTurnEnd?: boolean } /* 可配 if / unless：标志不满足时不触发，也不在地图上标出 */
  /** 在场我方走到这个人身边（相邻一格）；by 可限定为指定角色 */
  | { near: string; by?: string; playerPhase?: boolean; /** 回合结束（敌方行动完、下回合开始前）还在身边才触发【新】 */ atTurnEnd?: boolean }
  /** 剧本标志设上时（["flag", 名字] 或 ["choice", ...] 选中某项） */
  | { flag: string }
  /** 目标生命低于最大值的 below%（可配 if / unless）；spare = 区块没执行时这人挨打至少留 1 点体力，不会在触发前被一下打死 */
  | { hp: string; below: number; spare?: boolean }
  /** 出手之后：用过全部 skills，或累计出手 count 次 */
  | { used: string; skills?: string[]; count?: number }
  /** 这个人刚做了某个操作（教学关，§15.26）：只看操作发生那一刻，可配 if / unless */
  | { did: string; action: import('../formats/pas.ts').DidAction };

/**
 * 指令（数组，第一项是名字）：
 * ["narrate", 文字] 旁白；["say", 单位, 文字] 对白；["appear", 单位] 登场（["appear", 单位, {near: 另一个人}]：登场在那人身边）；["leave", 单位] 退场（之后 appear / say 点名时再登场）；["move", 单位, x, y] 走过去；
 * ["objective", 文字] 胜负条件；["turnLimit", n]；["victory", 文字] 过关；["defeat", 文字] 失败；
 * ["setEquip", 单位, 格号, 道具（0 = 卸掉）]；["transform", 单位, 职业, 新名字（可省）] 换成另一个职业（样子、属性、头像都换，血气回满）；["buff", 单位, 属性, {"pct"|"add", "turns"}]；["sound", 原版音效名]；["flag", 名字] 设剧本标志（配合区块的 if / unless）；
 * ["show", 单位, 站在谁身边（可省）] 已倒下 / 退场的人临时回到地图上（只放画面，不复活，战后对话用）；["hide", 单位] 收起；
 * ["portrait", 职业, 头像文件或原版职业号] 本关里这个职业改用包里另一张头像（空串恢复，只放画面，如武松扮行者）；
 * ["shoot", 单位, x, y, 落点文字] / ["shoot", 单位, 目标单位, 落点文字] 剧情射箭（只有动画声音，不结算伤害或耗气）；
 * ["approach", 单位, 目标] 走到目标身边一格（自动挑空格，走不到就不动）；
 * ["capture", 单位] 擒获并押离战场（退出敌方、绑住退场，不代表归顺、不复活）；
 * ["defect", 单位, 阵营] 换阵营（player / ally / enemy，如黄信归降）；
 * ["bind", 单位] 绑住（不能行动，直到 cleanse）；["cleanse", 单位] 解开绑缚、昏迷、中毒和减益，本回合马上能行动
 * ["choice", 提示, [选项文字, 标志], ...] 剧情选项（必须是区块最后一条）：玩家选一项就设那个标志，接着执行 { flag } 触发的区块；
 * ["setAi", 单位, 模式] 改 AI 模式；
 * ["wound", 单位, 百分比] 剧情受伤：生命降到最大值的这个百分比（已经更低就不动，至少留 1 点），飘「重伤」【新】（李应中箭）；
 * ["fire", [[x, y], ...], {panic, turns, spare, focus}] 放火：格子冒火，离火最近的 panic 个敌人逃窜 turns 回合（spare = 不逃的职业）；
 * ["gust", {style, radius, turns, panic, spare, x, y, focus}] 黑尘（dust）/ 怪风（wind）：区域中心（或 x, y）radius 格内的敌人逃窜 turns 回合；
 * ["stealthEnd"] 潜行结束：哨兵不再警戒，发现也不再判负；
 * ["trap", [伏兵…], {count, min, exclude, tile}] 就近摆路障、放伏兵【新】（盘陀路，指令 129）：从关卡 traps 的候选路口里挑离我方最近（至少 min 步）的 count 处
 *   堵上路障（画 tile 号地上物，["unseal", 格子] 可再打开），列出的人里没登场的从路障靠我方一侧杀出来；exclude = 跳过这些 tag 的路口；
 * ["standDown", 单位, 参数（可省）] 收手：敌人不再参战，原地不动（改成友军、不能被选中，不算敌军全灭）；参数 {reward: 身边没我方也照打倒给经验, leave: 收手后离开地图, quiet: 不飘字（一起收手时一起淡出）, goldPct: 交出击退银子的百分之几}
 */
export type PackOpJson = [string, ...unknown[]];

export interface PackBlockJson {
  on: PackTrigger;
  /** 对 enemiesDefeated / allEnemiesDefeated / near / hp / turn / flag / did 有效：还要求某个剧本标志（["flag", 名字] 设上）已经设上 / 还没设上 */
  /** 写数组时每个标志都要满足（AND）【新】 */
  if?: string | string[];
  unless?: string | string[];
  do: PackOpJson[];
}
