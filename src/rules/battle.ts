// 战斗状态机：回合、指令、AI 行动、PAS 事件与胜负。只改状态并输出事件流，画面由 game/ 播放。
import { markLine } from '../i18n/index.ts';
import type { ActUnit } from '../formats/act.ts';
import type { DidAction, PasBlock, PasCond, PasHeader, PasOp, PasTrigger } from '../formats/pas.ts';
import type { ExePrompt } from '../formats/exe.ts';
import { alertRadius, planAi } from './ai.ts';
import type { Member } from './campaign.ts';
import { Board, key, pathTo, type Cell } from './board.ts';
import { attackParts, canCounter, previewAttack, rollAttack, watcherSees, type AttackPreview, type HitResult } from './combat.ts';
import { killGold, stageClearGold } from './gold.ts';
import { counterExp, dodgeExp, expToNext, healExp, hitExp, itemExp, killDamage, killerShare, killExp, restExp, splitTeamExp, takenExp, teamShare } from './exp.ts';
import { BAG_SLOTS, buffName, type BuffStat, canEquip, EQUIP_SLOTS, equipSlotOf, freeBagSlot, SLOT_COUNT, isUsable, itemBuffs, itemOf, type GameData, type SkillDef } from './data.ts';
import { areaCells, castCells, castRange, isAllyChargeSkill, isChargeSkill, isSelfChargeSkill, isHealSkill, isSupportSkill, learnedSkills, skillById, skillsLearnedAt } from './skills.ts';
import { Rng } from './rng.ts';
import { Fire, type FireInput } from './fire.ts';
import { basicReaches, canStand, inField as fieldHas, kickCritChance, kickDistance, kickHitChance, kickPower, MISS_FACTOR, otherTeam, resolveBall, rollKick, throwIn, traceLine, type BallPlayer, type BallResult, type CujuRules, type Team } from './cuju.ts';
import { cujuPhase } from './cuju-ai.ts';
import { firstZone, inZone, mainArea, nextZone, openCells, NPC_TEAM, type RoyaleRules, type RoyaleState, type Zone } from './royale.ts';
import { planRoyale, royaleHealSlot } from './royale-ai.ts';
import { relativeEnemyLevel, type EnemyRank, enemyFloor, ENEMY_LEVEL } from './enemy-level.ts';
import type { StageRules } from '../formats/stage-json.ts';
import {
  attackRange, attackSkill, computeStats, DIRS, dist, facingTowards, hostile, inAttackRange, refreshStats, resists, type Side, type Unit,
} from './unit.ts';

export { expToNext } from './exp.ts';
/** 强行军：黄色范围 = 剩余移动力 + 移动力的一半（向上取整）。原版固定 +1，负责人决定用这个【新】 */
export const forcedExtra = (u: Unit) => Math.ceil(u.stats.move / 2);
/** 休息：体力、气力各恢复上限的 1/5（负责人 2026-11-12 决定；原版恢复得更少）【新】 */
export const REST_DIVISOR = 5;

/**
 * 开局多带的道具【新】（负责人 2026-11-12）：第一关 N01 里武龍（0）、王進（1）各带 2 个狗皮膏藥（156），
 * 原版默认只有 1 个。只对没有延续状态的人物生效；按"补足到 N 个"处理，放进随身物品栏的空位。
 */
export const START_ITEMS: Record<string, Record<number, [item: number, count: number][]>> = {
  n01: { 0: [[156, 2]], 1: [[156, 2]] },
};

export function addStartItems(stage: string, classId: number, slots: number[]) {
  for (const [item, count] of START_ITEMS[stage.toLowerCase()]?.[classId] ?? []) {
    let have = slots.filter((s, k) => k >= EQUIP_SLOTS && s === item).length;
    for (const k of BAG_SLOTS) {
      if (have >= count) break;
      if (slots[k]) continue;
      slots[k] = item;
      have++;
    }
  }
}

/** 走进回合结束才生效的区域时的提示（不算触发剧情，还能撤销移动） */
const AREA_HINT = '回合结束时生效';
/** 教学提示里不改局面的事件 */
const SOFT_EVENTS = new Set<BattleEvent['type']>(['say', 'narrate', 'objective', 'subtitle', 'focus', 'wait', 'sound', 'message']);

export type BattleEvent =
  | { type: 'say'; uid: number | null; speaker: string; text: string }
  | { type: 'narrate'; text: string }
  | { type: 'objective'; lines: string[] }
  | { type: 'phase'; side: Side; turn: number }
  /** ambush：埋伏的人现身，或开打后敌方新冒出来（重制版插播「伏兵」短曲用） */
  | { type: 'appear'; uid: number; x: number; y: number; ambush?: boolean }
  /** 剧情里退场或埋伏（离开地图，不算战败） */
  | { type: 'leave'; uid: number }
  /** 二选一：伏兵号令（EXE 0x407af3：AI 模式 9 的单位行动时弹出）。选第一项时调用 signal() */
  | { type: 'ask'; prompt: ExePrompt }
  /** 剧情选项（扩展包指令 120）：选好后调用 answer() */
  | { type: 'choice'; choice: ChoiceRequest }
  /** 选人（剧本指令 27，见 PickRequest）：选好后调用 choose() */
  | { type: 'pick'; pick: PickRequest }
  /** script：剧本让人走位（指令 17 / 116），连着几个一起走【新】 */
  | { type: 'move'; uid: number; path: Cell[]; facing: number; script?: boolean }
  | { type: 'face'; uid: number; facing: number }
  /** 普通攻击与技能：cell 为施放点，area 为作用范围，hits 为每个受到攻击的单位的结算（回复/集气技为空） */
  | { type: 'attack'; uid: number; skill: SkillDef; cell: Cell; area: Cell[]; facing: number; hits: { uid: number; result: HitResult }[]; counter: boolean }
  | { type: 'hp'; uid: number; hp: number; mp: number; delta: number; /** 气的变化（回复时弹黄字） */ mpDelta?: number; text?: string }
  | { type: 'status'; uid: number; text: string }
  /** 换了职业（扩展包指令 102）：重画人物、状态条 */
  | { type: 'look'; uid: number; classId: number }
  | { type: 'defend'; uid: number; on: boolean }
  | { type: 'die'; uid: number }
  | { type: 'message'; text: string }
  | { type: 'subtitle'; text: string }
  /** 剧情演出（扩展包指令 109–113【新】）：只放画面，不改战斗状态 */
  | { type: 'uproot'; cells: { x: number; y: number }[] }
  /** 指令 127 打开封死的格子（门板消失）【新】 */
  | { type: 'unseal'; cells: { x: number; y: number }[] }
  /** 剧本临时摆路障（指令 129，盘陀路）：这些格子被路障堵住，画面上摆 tile 号地上物【新】 */
  | { type: 'seal'; cells: { x: number; y: number }[]; tile?: number }
  | { type: 'flourish'; uid: number; facing: number }
  | { type: 'shot'; uid: number; x: number; y: number; facing: number; target?: number; text: string }
  | { type: 'act'; uid: number; action: 'attack' | 'hurt' | 'defend'; facing: number }
  | { type: 'tint'; tint: string }
  /** 火势蔓延【新】：现在正在烧的全部格子（画面照这份同步） */
  | { type: 'fire'; cells: Cell[] }
  /** 黑尘 / 怪风【新】（还道村玄女庙，指令 126）：以 (x, y) 为中心、radius 格内的画面效果 */
  | { type: 'gust'; x: number; y: number; radius: number; style: 'dust' | 'wind' }
  | { type: 'focus'; x: number; y: number }
  | { type: 'wait'; ms: number }
  /** 换头像（扩展包指令 114【新】）：本关里这个职业的对白、面板改用包里的另一张图；file 空 = 恢复 */
  | { type: 'portrait'; classId: number; file: string }
  /** 原版音效（Sound/ 里的名字，不含扩展名） */
  | { type: 'sound'; name: string }
  | { type: 'pickup'; uid: number; x: number; y: number; item: number }
  /** 地上新冒出一个宝箱【新】（好汉聚义刷宝箱、小头目掉药） */
  | { type: 'chest'; x: number; y: number; item: number }
  /** 毒圈变了【新】（好汉聚义）：现在的圈和下一个圈 */
  | { type: 'zone'; zone: Zone; next: Zone | null }
  | { type: 'end'; result: 'won' | 'lost'; text: string }
  /** 蹴鞠【新】：球滚过 path 停在 (x, y)；result 见 BallResult；by = 拦下球的人；score = 进球后的比分 */
  | { type: 'ball'; path: Cell[]; x: number; y: number; result: BallResult['kind'] | 'place'; by?: number; text?: string; score?: Record<Team, number> };

/** 蹴鞠的场上状态（docs/game-design.md §15.25） */
export interface CujuState {
  rules: CujuRules;
  ball: Cell;
  score: Record<Team, number>;
  /** 本方回合里球被对方拦下：这回合球踢不动了（还能走位） */
  locked: boolean;
  /** 出界或进球：本方回合已经结束 */
  over: boolean;
  /** 开球站位（进球后双方回到这里） */
  starts: Record<number, { x: number; y: number; facing: number }>;
  /** AI 用的分工：守门、后卫、前锋 */
  roles: Record<number, 'keeper' | 'back' | 'forward'>;
}

/** 踢球预览：命中率、必杀率、命中 / 必杀 / 踢偏时大约踢几格，以及正中时球会怎么走 */
export interface KickPreview {
  hit: number;
  crit: number;
  distance: number;
  critDistance: number;
  missDistance: number;
  line: BallResult;
}

export interface GroundItem {
  x: number;
  y: number;
  item: number;
  /** ACT 里标了"开局隐藏"的宝物：地图上不画，但照样能拾（原版只清掉显示标志 0x2，仍挂在格子上，0x4033e8 → 0x40c240） */
  hidden: boolean;
}

/** 胜利条件只看回合数、原版文字又容易误解的关卡，胜利条件后面补一句回合提示（见 objectiveHint）【新】 */
export const TURN_HINT_STAGES = ['N13'] as const;

/**
 * 胜负条件里的区域（格子坐标，含两端）【新：画在小地图和地图上】。
 * goal = 某人进入就过关（指令 29，如 N01 王母、N12 晁蓋、N-add16 主角的撤退出口）；
 * danger = 某人进入就判负（指令 30，如 N13 何濤、N-add03 嘍囉逃走的出口）。
 * trap = 写了字、要敌人走进去的区域（登州山射虎的窝弓：老虎踩着就中箭）【新】，换一种颜色，免得和要我方走到的格子混在一起。
 * chars 是要进去的角色号（劫法场这类要几个人都到的，列出全部）。
 */
export interface ObjectiveZone {
  kind: 'goal' | 'danger' | 'trap';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  chars: number[];
  /** 区域旁写的字；没有时按 kind（撤退 / 敌逃） */
  label?: string;
}

/** 条件树里"选定某人（4）且坐标在范围内（5–10）"的部分 → 矩形；"或"的两边各算一个 */
export function condZones(c: PasCond): { char: number; x1: number; y1: number; x2: number; y2: number }[] {
  if ('op' in c && c.op === 'or') return [...condZones(c.a), ...condZones(c.b)];
  const leaves: { type: number; arg: number }[] = [];
  const walk = (n: PasCond): boolean => ('op' in n ? n.op === 'and' && walk(n.a) && walk(n.b) : (leaves.push(n), true));
  if (!walk(c)) return 'op' in c ? [...condZones(c.a), ...condZones(c.b)] : [];
  const sel = leaves.find((l) => l.type === 4);
  if (!sel) return [];
  const r = { char: sel.arg, x1: 0, y1: 0, x2: 0xffff, y2: 0xffff };
  for (const l of leaves) {
    if (l.type === 5) r.x1 = r.x2 = l.arg;
    else if (l.type === 6) r.y1 = r.y2 = l.arg;
    else if (l.type === 7) r.x1 = l.arg;
    else if (l.type === 8) r.y1 = l.arg;
    else if (l.type === 9) r.x2 = l.arg;
    else if (l.type === 10) r.y2 = l.arg;
  }
  return [r];
}

/** 条件树里「标志设上」（条件 100）的标志号，只看 and 连着的叶子 */
function flagLeaves(c: PasCond): number[] {
  if ('op' in c) return c.op === 'and' ? [...flagLeaves(c.a), ...flagLeaves(c.b)] : [];
  return c.type === 100 ? [c.arg] : [];
}

export interface StageInput {
  /** 仅战斗敌人：最终等级按实际参战好汉均级限制到兵种区间。 */
  enemyRanks?: Record<number, EnemyRank>;
  /** 本关单位体力倍率：ACT索引→倍率。 */
  hpMultipliers?: Record<number, number>;
  /** 观战演员的ACT索引，不参与战斗。 */
  spectators?: number[];
  /** 潜行关【新】：哨兵的 ACT 索引 → 警戒半径（格子步数，不看墙）。我方有人进了半径就被发现，见 Battle.checkSpotted */
  watchers?: Record<number, number>;
  /** 哨兵认得的职业（ACT 索引 → 职业号），这些人进了范围不算被发现【新】 */
  watchTrust?: Record<number, number[]>;
  /** 认得人的哨兵会盘问【新】（石秀探庄巡庄庄客）：认得的人进了警戒范围不算被发现，但被拦下盘问，这回合剩下的行动作废（每回合每个哨兵对每人只盘问一次） */
  watchQuestion?: number[];
  /** 潜行关【新】：AI 13 巡逻的路线（ACT 索引 → 依次走过的格子，走完回到第一个） */
  patrols?: Record<number, { x: number; y: number }[]>;
  /** 潜行关【新】：被发现后没在期限内打倒发现的人就判负；flag：被发现时设上的剧本标志 */
  stealth?: { lose: string; flag?: number };
  /** 扩展包 map.seal 封死的格子（打开的记在 Battle.unsealed，读档 / 倒流时据此恢复）【新】 */
  sealed?: { x: number; y: number; /** 画面上摆的地上物（路障），不填就是地图本来的图块（门板） */ tile?: number }[];
  /** 囚车外观的 ACT 序号，只影响表现。 */
  prisonCarts?: number[];
  /** 火势蔓延【新】（rules.fire 换成格子号，见 src/rules/fire.ts） */
  fire?: FireInput;
  name: string;
  /** 过关奖励银子；不写时按关卡名查 STAGE_CLEAR_GOLD（扩展包关卡用 rewards.gold） */
  clearGold?: number;
  board: Board;
  units: ActUnit[];
  /** 剧本区块（原版关卡来自 gamedata/stages，文字已是简体） */
  blocks: PasBlock[];
  /** 关卡特例规则（增援提前、全灭要连增援一起算等，见 StageRules） */
  rules?: StageRules;
  data: GameData;
  seed?: number;
  /** 文字转换（繁→简等），用于原版字符串以外的名字 */
  text?: (s: string) => string;
  /** 前面关卡延续下来的我方人物（按角色号） */
  party?: Map<number, Member>;
  /** 新入伙的我方人物的入队等级（当前队伍的平均等级，见 campaign.ts joinLevel）；不低于剧本等级 */
  joinLevel?: number;
  /** .pab 文件头：城镇号、下一关 */
  header?: PasHeader;
  /**
   * 扩展包【新】：AI 优先用还没用过的这些技能（角色号 → 技能号）。如老虎的一扑、一掀、一剪要轮着用，
   * 三招都用过才触发"气势减半"（docs/game-design.md §15.3）。
   */
  aiPrefer?: Record<number, number[]>;
  /** 扩展包【新】：单位显示的名字（ACT 序号 → 名字），不填用职业名 */
  names?: Record<number, string>;
  /** 本关临时会的技能（单位序号 → 技能号）【新】 */
  extraSkills?: Record<number, number[]>;
  /** 蹴鞠外传【新】：有这一项就是蹴鞠关（攻击只能踢球，见 cuju.ts） */
  cuju?: CujuRules;
  /** 伪装【新】：开场伪装的人（ACT 索引）；被识破时设上 flag；seers = 看得穿伪装的人（ACT 索引 → 警戒半径，只看正前方，他认得的人 watchTrust 不算） */
  disguise?: { units: number[]; flag?: number; seers?: Record<number, number> };
  /** 酒席【新】（杯酒救铁牛）：flag 没设上之前，我方出手时目标身边 sight 格内有醒着的敌人就设上 flag */
  banquet?: { flag: number; sight: number };
  /** 劝酒【新】：ACT 索引 → 推辞几次、麻翻几回合、只喝谁劝的（职业号） */
  drinks?: Record<number, { refuse: number; turns?: number; by?: number[]; light?: boolean }>;
  /** 劝酒时说的话（单位序号 → 台词，轮着说）【新】 */
  toasts?: Record<number, string[]>;
  /** 好汉聚义（吃鸡，§15.31）【新】：规则，和各单位的阵营号（ACT 序号 → 阵营；参赛好汉各自一号，小头目共用 NPC_TEAM） */
  royale?: { rules: RoyaleRules; teams: Record<number, number> };
}

/**
 * 选人（剧本指令 27，EXE 0x411d38 置标志 0x100 → 玩家在地图上点一个我方人物 0x405d10 → 0x40de90 让其余我方、友军全部退场）。
 * 原版只出现在三关：Train1/Train2 选一人与王進过招，N-add15 主角先退场、选一人和主角一起断后（主角随后被剧本点名回到场上）。
 */
/** 剧情选项（扩展包指令 120） */
export interface ChoiceRequest {
  prompt: string;
  options: { label: string; flag: number }[];
}

export interface PickRequest {
  /** 面板标题（原版旁白"請選擇留下的人"；训练关原版没有提示，用重制版的文字） */
  prompt: string;
  /** 可以选的人（在场、活着的我方人物） */
  candidates: number[];
  /** 不用选也一定出战的人（N-add15 的主角），只用来显示 */
  required: number[];
  /** 要选几个人（原版点一个人就定了，所以是 1） */
  count: number;
  /** 默认选中的人：等级最高的 */
  recommended: number[];
  /** 没选上的人留在场上观战（叫阵晁家庄单挑）【新】 */
  watch?: boolean;
}

/** 时光倒流最多能回到几个回合之前（记录最近几个我方回合开始时的状态）【新】 */
export const REWIND_TURNS = 2;

export type ExpSource = 'hit' | 'counter' | 'taken' | 'dodge' | 'heal' | 'item' | 'rest' | 'kill' | 'team';

/** 被绑（指令 103）的昏迷回合数：足够大，等剧本 104 解开 */
const BOUND_TURNS = 9999;

/** 哨兵盘问时说的话（石秀探庄） */
const QUESTIONS = ['站住！卖柴的，你往哪里去？', '兀那汉子，哪里来的？把担子放下看看！', '卖柴的，这条路不许乱走！', '你是哪个村的？怎地面生？']

export class Battle {
  readonly spectators: ReadonlySet<number>;
  /** 潜行关的哨兵：uid → 警戒半径【新】 */
  readonly watchers: ReadonlyMap<number, number>;
  private readonly watchTrust: ReadonlyMap<number, number[]>;
  private readonly watchQuestion: ReadonlySet<number>;
  /** 看得穿伪装的人：uid → 警戒半径【新】 */
  private readonly seers: ReadonlyMap<number, number>;
  private readonly disguiseFlag?: number;
  /** 「哨兵:被盘问的人」→ 盘问的回合；盘问过以后两回合内放行 */
  private questioned = new Map<string, number>();
  private readonly patrols: Map<number, { x: number; y: number }[]>;
  private readonly stealth?: { lose: string; flag?: number };
  private readonly banquet?: { flag: number; sight: number };
  private readonly drinks: ReadonlyMap<number, { refuse: number; turns?: number; by?: number[]; light?: boolean }>;
  private readonly toasts: ReadonlyMap<number, string[]>;
  /** 劝酒【新】：已经推辞过几次（uid → 次数） */
  private refused: Record<number, number> = {};
  /** 被蒙汗药麻翻、还没醒的人（醒来时提示、触发 did wake） */
  private drugged = new Set<number>();
  /** 发现了我方的哨兵：uid → 要在第几回合的我方回合结束前打倒他（否则判负），即发现时的下一回合【新】 */
  spotters: Record<number, number> = {};
  readonly prisonCarts: ReadonlySet<number>;
  /** 火势蔓延【新】（火烧草料场） */
  readonly fire?: Fire;
  readonly name: string;
  /** .pab 文件头（城镇号、下一关）；没有剧本时为 undefined */
  readonly header?: PasHeader;
  readonly board: Board;
  readonly data: GameData;
  readonly rng: Rng;
  readonly units: Unit[] = [];
  readonly items: GroundItem[] = [];
  /** 蹴鞠关的场上状态；不是蹴鞠关为 null */
  cuju: CujuState | null = null;
  /** 好汉聚义的场上状态（毒圈、出局顺序）；不是吃鸡关为 null */
  royale: RoyaleState | null = null;
  readonly royaleRules?: RoyaleRules;
  /** 吃鸡：地图上最大的一块可走区域（刷宝箱、挑圆心用） */
  private royaleArea: Cell[] = [];
  turn = 0;
  phase: Side = 'player';
  turnLimit = 0;
  /** 正在做回合结束的检查（atTurnEnd 的区域）【新】 */
  private turnEndCheck = false;
  /** 正在求值的 cond 区块写了 atTurnEnd【新】 */
  private condAtTurnEnd = false;
  /** 回合结束才生效的区域已经提示过的「区块:回合」【新】 */
  /** 正在结算的这一步移动走过的格子（区域触发 pass 用）【新】 */
  private passed: { uid: number; path: Cell[] } | null = null;
  private areaHinted = new Set<string>();
  /** 正在执行教学提示（did 区块）【新】 */
  private teaching = false;
  /** 教学提示里只是说话的事件：不让这次移动锁住撤销【新】 */
  private soft = new WeakSet<BattleEvent>();
  status: 'playing' | 'won' | 'lost' = 'playing';
  objectives: string[] = [];
  private blocks: PasBlock[];
  private fired = new Set<number>();
  /** 剧本放的火（指令 124，只是画面，不挡路、不烧人）【新】 */
  private blaze: Cell[] = [];
  /** 潜行结束【新】（智取无为军：骗开大门以后，指令 125）：哨兵不再警戒、发现也不再判负 */
  private stealthOver = false;
  private sealed: { x: number; y: number; tile?: number }[] = [];
  /** 剧本临时摆的路障（指令 129，盘陀路）：跟着倒流、读档保存【新】 */
  private trapSeals: { x: number; y: number; tile?: number }[] = [];
  /** 已打开的封死格子（y * 宽 + x） */
  private unsealed = new Set<number>();
  /** 剧本区块是否已经触发过（试打工具用） */
  hasFired(index: number) {
    return this.fired.has(index);
  }
  /** 剧本指令 27 设置的全局标志（EXE 0x411d38，条件 3 读取）：选人期间为 true，选完清掉 */
  private scriptFlag = false;
  /** 等待玩家选人（指令 27）；选完为 null */
  pendingPick: PickRequest | null = null;
  /** 剧情选项（指令 120）等玩家选：选好后调用 answer() */
  pendingChoice: ChoiceRequest | null = null;
  /** 因为没被选上而退场的人（不出战，不分全队经验，下一关照常归队） */
  private benched = new Set<number>();
  /** 单挑选人（指令 27 的 keep）【新】：本关上过场的人；当前出战的人和他原来站的格子（下一次选人前走回去观战）；这次选上的人要走到哪 */
  private fought = new Set<number>();
  private duelist: { uid: number; x: number; y: number } | null = null;
  private pickTo: { x: number; y: number } | null = null;
  /** 当前回合参数（条件 0：第 N + 1 回合开始时为 N） */
  private turnParam = -1;
  /** 扩展包剧本的标志（指令 103 设上，条件 100 / 101 判断有没有）【新】 */
  private flags = new Set<number>();
  private pendingDeaths: number[] = [];
  /** 提前了的回合增援区块：区块序号 → 新的回合参数（stage-tune 的 rushOnDeath）【新】 */
  private turnAt: Record<number, number> = {};
  readonly tune?: StageRules;
  /** 本关累计的全队经验（击倒经验的 35%），胜利后结算 */
  teamExp = 0;
  /** 开场时是敌人的单位（poolLeftoverExp 用） */
  private readonly foesAtStart = new Set<number>();
  /** 收手时已经给身边的我方算过击败经验的单位 */
  private credited = new Set<number>();
  /** 敌人最后一次被我方哪个人打到（收手时算谁打倒的，指令 121 的 reward）【新】 */
  private lastHitBy: Record<number, number> = {};
  /** 过关奖励的银子（胜利时按地图名给，见 gold.ts），关卡结束时记进战役 */
  clearGold = 0;
  private clearGoldOverride?: number;
  private tr: (s: string) => string;
  private out: BattleEvent[] = [];
  /** 开场时有我方人物（纯过场的 Act 关卡没有，不做全军覆没判定） */
  private hadPlayers: boolean;
  /** 开局站在地面以外的场外占位单位（见构造函数） */
  private readonly offstage = new Set<number>();
  /** ACT 的编组号 → 单位（剧本用 1000 + 编组号指定单位） */
  private groups = new Map<number, number>();
  /** 埋伏中的单位（EXE 标志 0x40000，AI 模式 6/9）：剧本点名不会让它们登场 */
  private ambushers = new Set<number>();
  /** 时光倒流：最近 REWIND_TURNS 个我方回合开始时的完整状态（JSON，不含随机数状态），旧的在前【新】 */
  private history: { turn: number; state: string }[] = [];
  /** 每个单位出手用过的技能号（按顺序，含普通攻击和反击），扩展包的 used 触发用 */
  private used: Record<number, number[]> = {};
  /** 刚做过、还没判过 did 触发的操作（教学关，§15.26）；判完就清空，不进存档 */
  private didQueue: { uid: number; action: DidAction }[] = [];
  /** 扩展包：AI 优先用的技能（StageInput.aiPrefer） */
  private readonly aiPrefer: Record<number, number[]>;

  constructor(input: StageInput) {
    this.spectators = new Set(input.spectators ?? []);
    this.watchers = new Map(Object.entries(input.watchers ?? {}).map(([k, v]) => [Number(k), v]));
    this.watchTrust = new Map(Object.entries(input.watchTrust ?? {}).map(([k, v]) => [Number(k), v]));
    this.watchQuestion = new Set(input.watchQuestion ?? []);
    this.seers = new Map(Object.entries(input.disguise?.seers ?? {}).map(([k, v]) => [Number(k), v]));
    this.disguiseFlag = input.disguise?.flag;
    this.patrols = new Map(Object.entries(input.patrols ?? {}).map(([k, v]) => [Number(k), v]));
    this.stealth = input.stealth;
    this.banquet = input.banquet;
    this.drinks = new Map(Object.entries(input.drinks ?? {}).map(([k, v]) => [Number(k), v]));
    this.toasts = new Map(Object.entries(input.toasts ?? {}).map(([k, v]) => [Number(k), v]));
    this.sealed = input.sealed ?? [];
    this.prisonCarts = new Set(input.prisonCarts ?? []);
    if (input.fire) this.fire = new Fire(input.fire, input.board);
    this.name = input.name;
    this.clearGoldOverride = input.clearGold;
    this.header = input.header;
    this.board = input.board;
    this.data = input.data;
    this.rng = new Rng(input.seed);
    this.blocks = input.blocks;
    this.tr = input.text ?? ((s) => s);
    this.aiPrefer = input.aiPrefer ?? {};
    this.tune = input.rules;
    for (const a of input.units) if (a.side === 'enemy') this.foesAtStart.add(a.index);
    // 开场时我方的等级（与下面逐个建单位时同一算法），用来给敌人等级保底
    const playerLevel = (a: ActUnit) => {
      const kept = input.party?.get(a.type);
      return kept?.level ?? Math.max(1, a.level, input.joinLevel ?? 0);
    };
    const mine = input.units.filter((a) => a.side === 'player' && !this.spectators.has(a.index) && !this.prisonCarts.has(a.index) && this.board.onGround(a.x,a.y) && this.data.classes[a.type]?.skills.length).map(playerLevel);
    const heroAverage = mine.length ? mine.reduce((sum,n)=>sum+n,0)/mine.length : 0;
    const floor = enemyFloor(mine);
    for (const a of input.units) {
      if (a.side === 'object') {
        if (a.type > 0 && a.type <= this.data.items.length) this.items.push({ x: a.x, y: a.y, item: a.type, hidden: (a.flags & 0xff) !== 0 });
        continue;
      }
      if (a.side === 'unknown') continue;
      const cls = this.data.classes[a.type];
      if (!cls) continue;
      const slots = cls.defaultItems.slice(0, 7);
      while (slots.length < SLOT_COUNT) slots.push(0);
      a.items.forEach((id, k) => id && (slots[k] = id));
      // 原版会按ACT调高；重制版已有好汉保持存档等级、经验和装备，不再强制抬级。
      const kept = a.side === 'player' ? input.party?.get(a.type) : undefined;
      if (kept) {
        slots.splice(0, slots.length, ...kept.slots);
        while (slots.length < SLOT_COUNT) slots.push(0); // 旧存档只有 7 格
      } else if (a.side === 'player') addStartItems(input.name, a.type, slots);
      const forge = slots.map((_, k) => kept?.forge?.[k] ?? 0);
      // 新入伙的人（之前没出现过）按当前队伍的平均等级入队，不低于剧本等级【新】
      const join = a.side === 'player' && !kept ? (input.joinLevel ?? 0) : 0;
      // 正式战斗用兵/将相对区间；无角色策略的旧自定义输入仍保留原有等级保底。
      const rank = input.enemyRanks?.[a.index];
      const level = a.side === 'enemy' && rank && heroAverage > 0 && ENEMY_LEVEL.floor
        ? relativeEnemyLevel(a.level, heroAverage, rank)
        : kept?.level ?? (a.side === 'enemy' && a.level > 1 ? Math.max(a.level, floor) : Math.max(1,a.level,join));
      const exp = kept?.exp ?? 0;
      // ACT 读入（EXE 0x4032cc 起）：flags 低字节非 0 → 隐藏（0x20000）；模式 7 → 隐藏并改为 0；模式 6/9 → 埋伏（0x40000）
      let mode = a.flags >> 8;
      let hidden = (a.flags & 0xff) !== 0;
      if (mode === 7) {
        mode = 0;
        hidden = true;
      }
      // 起始格在地面以外（越界或地表图块号为 0）的单位当作场外占位，开局不登场【新】：
      // 原版 Act9-1 的 ACT 里有两条主角记录摆在 (0,0)，那一格没有地面，剧本也没有点名，重制版原样摆出来就悬在地图外的黑底上。
      // 仍保留单位本身，剧本点名时由 appear() 挪到最近的可通行空格
      const offstage = !this.board.onGround(a.x, a.y);
      if (offstage) {
        hidden = true;
        this.offstage.add(a.index);
      }
      if (mode === 6 || mode === 9) this.ambushers.add(a.index);
      if (a.group && !this.groups.has(a.group)) this.groups.set(a.group, a.index);
      const team = input.royale?.teams[a.index];
      // 蹴鞠两队、吃鸡的参赛好汉都按我方算属性（一样的移动力加成、命中必杀不打折）
      const statSide = input.cuju || (team !== undefined && team !== NPC_TEAM) ? 'player' : a.side;
      const stats = computeStats(cls, level, slots, this.data, false, forge, [], statSide);
      const hpMultiplier = input.hpMultipliers?.[a.index] ?? 1;
      if (!Number.isFinite(hpMultiplier) || hpMultiplier <= 0) throw new Error(`单位 ${a.index} 的体力倍率必须为正数`);
      stats.maxHp = Math.max(1, Math.round(stats.maxHp * hpMultiplier));
      this.units.push({
        uid: a.index, classId: a.type, name: input.names?.[a.index] ?? this.charName(a.type), side: a.side, x: a.x, y: a.y, facing: a.facing & 3,
        level, exp, hp: stats.maxHp, mp: stats.maxMp, stats, slots, forge, gold: 0,
        ...(hpMultiplier !== 1 ? { hpMultiplier } : {}),
        ...(input.extraSkills?.[a.index]?.length ? { extraSkills: [...input.extraSkills[a.index]] } : {}),
        ...(statSide !== a.side ? { statSide } : {}),
        ...(team !== undefined ? { team } : {}),
        ai: { mode, target: a.extra[0], point: { x: a.extra[1], y: a.extra[2] } },
        present: !hidden && !this.ambushers.has(a.index), alive: true, defending: false, poisonTurns: 0, stunTurns: 0, buffs: [],
        movementRemaining: stats.move, forcedMarch: false, acted: false, ended: false, turnStart: null,
      });
    }
    this.hadPlayers = this.units.some((u) => u.side === 'player' && !this.offstage.has(u.uid));
    if (input.cuju) this.setupCuju(input.cuju);
    if (input.royale) {
      this.royaleRules = input.royale.rules;
      this.setupRoyale();
    }
    for (const uid of this.watchers.keys()) if (this.units[uid]) this.units[uid].unaware = true;
    for (const uid of input.disguise?.units ?? []) {
      const u = this.unit(uid);
      if (u) u.disguised = true;
    }
  }

  // ───────────── 查询 ─────────────

  charName(id: number): string {
    if (id === 0 || id === 1000) return this.data.heroName;
    return this.tr(this.data.charNames[id] ?? `#${id}`);
  }
  unit(uid: number) {
    return this.units.find((u) => u.uid === uid);
  }
  /** 角色号 → 在场单位；1000 = 主角（角色 0） */
  unitByChar(char: number, includeAbsent = false) {
    const id = char === 1000 ? 0 : char;
    return this.units.find((u) => u.classId === id && u.alive && (includeAbsent || u.present));
  }
  active() {
    return this.units.filter((u) => u.alive && u.present);
  }
  /** 扩展包：AI 是否该优先用这个技能（列在 aiPrefer 里、本关还没用过） */
  prefers(u: Unit, skill: SkillDef): boolean {
    return !!this.aiPrefer[u.classId]?.includes(skill.skillId) && !this.used[u.uid]?.includes(skill.skillId);
  }
  unitAt(x: number, y: number) {
    return this.active().find((u) => u.x === x && u.y === y);
  }
  foesOf(u: Unit) {
    return this.active().filter((t) => !this.spectators.has(t.uid) && hostile(u, t) && !(t.disguised && u.side === 'enemy'));
  }
  /** 被剧情绑住（bind）的人：AI 默认跳过，不追、不打、技能也不波及（负责人 2026-11-16，青州道劫囚的宋江）【新】 */
  isBound(u: Unit) {
    return u.stunTurns >= BOUND_TURNS - 1000; // 每回合照常减 1，留足余量
  }
  /** AI 眼里的敌人：去掉被绑住的 */
  aiFoesOf(u: Unit) {
    return this.foesOf(u).filter((t) => !this.isBound(t));
  }
  /** 剧情临时出镜（show）的人占的格子：只是画面，不算在场，但几个人别叫到同一格 */
  private shown = new Map<number, Cell>();
  occupied(except?: Unit) {
    return new Set(this.active().filter((u) => u !== except).map((u) => key(u.x, u.y)));
  }
  /**
   * 移动范围。【新：负责人 2026-11-13】我方和友军互不阻挡：可以穿过对方所在的格子，但不能停在上面；
   * 敌人照旧挡住所有人，敌人之间也互相阻挡。
   */
  reachOf(u: Unit, budget: number) {
    const blocked = new Set<string>(), pass = new Set<string>();
    for (const t of this.active()) {
      if (t === u) continue;
      // 蹴鞠：两队一样，队友互相穿过、对手挡路
      const through = this.cuju ? t.side === u.side : u.side !== 'enemy' && t.side !== 'enemy';
      (through ? pass : blocked).add(key(t.x, t.y));
    }
    if (this.cuju) {
      // 蹴鞠：球所在的格子能走过、不能停；最多走出球场一格（球门口不能站）
      pass.add(key(this.cuju.ball.x, this.cuju.ball.y));
      for (let y = 0; y < this.board.height; y++) for (let x = 0; x < this.board.width; x++) if (!canStand(this.cuju.rules, { x, y })) blocked.add(key(x, y));
    }
    return this.board.reach(u, budget, blocked, pass);
  }
  pathOf(reach: ReturnType<Board['reach']>, c: Cell) {
    return pathTo(reach, c.x, c.y);
  }

  /** 玩家移动范围：green 为普通移动，yellow 为强行军 */
  moveRange(u: Unit): { green: Cell[]; yellow: Cell[] } {
    if (!this.canMove(u)) return { green: [], yellow: [] };
    const all = this.reachOf(u, u.movementRemaining + (u.forcedMarch ? 0 : forcedExtra(u)));
    const green: Cell[] = [], yellow: Cell[] = [];
    for (const n of all.values()) {
      if (n.cost === 0) continue;
      (n.cost <= u.movementRemaining ? green : yellow).push({ x: n.x, y: n.y });
    }
    return { green, yellow };
  }
  canMove(u: Unit) {
    return this.status === 'playing' && !this.spectators.has(u.uid) && u.side === this.phase && !u.ended && !u.acted && u.alive && u.present;
  }
  canAct(u: Unit) {
    return this.status === 'playing' && !this.spectators.has(u.uid) && u.side === this.phase && !u.ended && u.alive && u.present;
  }
  /** 我方回合里已经没有能行动的我方人物（死亡、未登场、昏迷、行动完毕的都不算） */
  playerPhaseDone() {
    return this.status === 'playing' && this.phase === 'player' && !this.units.some((u) => u.side === 'player' && this.canAct(u));
  }
  attackTargets(u: Unit): Unit[] {
    if (!this.canAct(u) || u.acted || this.cuju) return [];
    const r = attackRange(u, this.data);
    return this.foesOf(u).filter((t) => inAttackRange(u, t, r));
  }
  /** 当前位置的攻击范围格子（显示用） */
  attackCells(u: Unit): Cell[] {
    const [lo, hi] = attackRange(u, this.data);
    const out: Cell[] = [];
    for (const d of DIRS)
      for (let k = lo; k <= hi; k++) if (this.board.inBounds(u.x + d.x * k, u.y + d.y * k)) out.push({ x: u.x + d.x * k, y: u.y + d.y * k });
    return out;
  }
  preview(u: Unit, t: Unit, skill = attackSkill(u, this.data)): AttackPreview {
    return previewAttack(u, t, skill);
  }

  /**
   * 技能菜单：已习得的技能。usable = 现在能选（能行动、没出过手、气力足够），
   * 范围里没有目标也能选来查看射程和作用范围（lolo 2026-11-13）【新】；hasTarget = 有可施放的位置。
   */
  skillsOf(u: Unit): { skill: SkillDef; usable: boolean; hasTarget: boolean }[] {
    return learnedSkills(u, this.data).map((skill) => {
      const usable = this.canAct(u) && !u.acted && u.mp >= skill.mpCost;
      return { skill, usable, hasTarget: usable && this.skillTargets(u, skill).length > 0 };
    });
  }
  /** 施放距离内的全部格子（显示用）；at 为假设的站位 */
  skillCells(u: Unit, skill: SkillDef, at: Cell = u): Cell[] {
    return castCells(this.board, at, castRange(u, skill, this.data), skill.targetShape);
  }
  /** 施放点 cell 的作用范围 */
  skillArea(u: Unit, skill: SkillDef, cell: Cell, at: Cell = u): Cell[] {
    return areaCells(this.board, at, skill, cell);
  }
  /** 攻击技只影响敌人；回复与援气只影响同阵营，援气不含自身或满气目标。 */
  affected(u: Unit, skill: SkillDef, cell: Cell, at: Cell = u): Unit[] {
    if (isSelfChargeSkill(skill)) return [u];
    const area = new Set(this.skillArea(u, skill, cell, at).map((c) => key(c.x, c.y)));
    const allyCharge = isAllyChargeSkill(skill);
    const heal = isHealSkill(skill) || allyCharge;
    return this.active().filter((t) => {
      if (this.spectators.has(t.uid)) return false;
      const pos = t === u ? at : t;
      if (skill.drug && t.stunTurns > 0) return false; // 已经麻翻的不用再劝
      if (!heal && t.disguised && u.side === 'enemy') return false; // 敌人认不出伪装的人，招式也不打他【新】
      return area.has(key(pos.x, pos.y)) && (heal ? !hostile(u, t) : hostile(u, t))
        && (!allyCharge || (t !== u && t.mp < t.stats.maxMp));
    });
  }
  /** 能施放的格子（范围内至少有一个可作用的单位） */
  skillTargets(u: Unit, skill: SkillDef, at: Cell = u): Cell[] {
    if (this.cuju && !isSupportSkill(skill)) return this.kickCells(u, skill, at);
    return this.skillCells(u, skill, at).filter((c) => this.affected(u, skill, c, at).length > 0);
  }

  // ───────────── 流程 ─────────────

  /** 开战：执行开战事件，进入第 1 回合我方阶段 */
  begin(): BattleEvent[] {
    this.out = [];
    if (this.fire) this.emit({ type: 'fire', cells: this.fireCells() });
    this.runTurnTriggers(0);
    // 开场剧本要求选人：等 choose() 选完再进第 1 回合（这样时光倒流不会回到选人之前）
    if (this.pendingPick || this.pendingChoice) return this.flush();
    this.startTurn(1);
    this.record();
    return this.flush();
  }

  /**
   * 现在还有效的区域胜负条件（见 ObjectiveZone）：区块没执行过、要进去的人还活着（在不在场都算，可能还没登场）。
   * 区域由地图尺寸截断（条件只写了一边时另一边到地图边缘）。
   */
  /** 地图上正在烧的格子：火势蔓延（rules.fire）加剧本放的火（指令 124） */
  fireCells(): Cell[] {
    return [...(this.fire?.cells() ?? []), ...this.blaze];
  }

  objectiveZones(): ObjectiveZone[] {
    if (this.status !== 'playing') return [];
    const out: ObjectiveZone[] = [];
    const W = this.board.width, H = this.board.height;
    const wins = (b: (typeof this.blocks)[number]) => b.ops.some((o) => o.op === 29 || (o.op === 115 && o.value === 1));
    // 区域只设个标志、由 { flag } 区块再过关的（琵琶亭：赶到栈桥中段设 reach，水战标志也设了才过关）也算过关区域
    const winFlags = new Set<number>();
    for (const b of this.blocks) if (!this.fired.has(b.index) && b.cond && wins(b)) for (const f of flagLeaves(b.cond)) winFlags.add(f);
    for (const b of this.blocks) {
      if (this.fired.has(b.index)) continue;
      // 只设标志的区域（怒破何观察放火点：几个人都能点）标志已经设上了，就不再标出【新】
      if (b.ops.length && b.ops.every((o) => o.op === 103 && this.flags.has(o.value))) continue;
      // 敌人走进去就退场（火烧草料场：富安、洪教头从侧门逃走）也标成敌逃【新】
      const flees = (b: (typeof this.blocks)[number]) =>
        b.trigger.kind === 'area' && b.ops.some((o) => o.op === 17 && o.value & 2) && this.units.some((u) => b.trigger.kind === 'area' && u.classId === b.trigger.char && u.side === 'enemy');
      // 写了字、只有敌人进去才算的区域（射虎的窝弓）【新】
      const enemyOnly = (b: (typeof this.blocks)[number]) => {
        const t = b.trigger;
        if (t.kind !== 'area' || t.side) return false;
        const cs = t.chars ?? [t.char];
        return cs.length > 0 && cs.every((c) => this.units.some((u) => u.classId === c && u.side === 'enemy') && !this.units.some((u) => u.classId === c && u.side !== 'enemy'));
      };
      // 放火点（指令 124，怒破何观察）不是胜利条件，也标出来【新】
      const kind = wins(b) || b.ops.some((o) => o.op === 124) ? 'goal' : flees(b) ? 'danger' : b.ops.some((o) => o.op === 103 && winFlags.has(o.value)) ? 'goal' : b.ops.some((o) => o.op === 30) ? 'danger' : b.trigger.kind === 'area' && b.trigger.label ? (enemyOnly(b) ? 'trap' : 'goal') /* 写了字的区域（智取无为军的探查点）也标出【新】；要敌人进去的（窝弓）另换颜色 */ : null;
      if (!kind) continue;
      const t = b.trigger;
      // 写了 if / unless 的区域：标志不满足时还没轮到，不标出（教学关的将台，§15.26）
      if (t.kind === 'area' && t.flagged && !this.flagsOk(b)) continue;
      const rects =
        t.kind === 'area'
          ? [{ chars: t.side ? [] : t.chars ?? [t.char], x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, label: t.label }]
          : t.kind === 'cond'
            ? condZones(b.cond).map((r) => ({ ...r, chars: [r.char >= 1000 ? r.char - 1000 : r.char] }))
            : [];
      for (const r of rects) {
        const chars = r.chars.map((c) => (c === 1000 ? 0 : c));
        if (!chars.every((c) => this.units.some((u) => u.classId === c && u.alive))) continue;
        const z: ObjectiveZone = {
          kind,
          x1: Math.max(0, Math.min(r.x1, r.x2)),
          y1: Math.max(0, Math.min(r.y1, r.y2)),
          x2: Math.min(W - 1, Math.max(r.x1, r.x2)),
          y2: Math.min(H - 1, Math.max(r.y1, r.y2)),
          chars,
          ...('label' in r && r.label ? { label: r.label } : {}),
        };
        if (z.x1 > z.x2 || z.y1 > z.y2) continue;
        // N-add03：两种嘍囉各有一个区块指向同一个出口，合成一个
        const same = out.find((o) => o.kind === z.kind && o.x1 === z.x1 && o.y1 === z.y1 && o.x2 === z.x2 && o.y2 === z.y2);
        if (same) same.chars.push(...chars.filter((c) => !same.chars.includes(c)));
        else out.push(z);
      }
    }
    return out;
  }

  /** 剧情选项选好（第 k 项）：设标志，接着执行 { flag } 区块；开场的选项选完才进第 1 回合【新】 */
  answer(k: number): BattleEvent[] {
    this.out = [];
    const c = this.pendingChoice;
    if (!c) return [];
    const o = c.options[k];
    if (!o) throw new Error(`没有第 ${k} 个选项`);
    this.pendingChoice = null;
    this.flags.add(o.flag);
    this.runCondBlocks();
    if (this.pendingChoice || this.pendingPick) return this.flush();
    if (this.turn === 0 && this.status === 'playing') {
      this.startTurn(1);
      this.record();
    } else this.afterAction();
    return this.flush();
  }

  /** 本关因为没被选上而退场的我方人物 */
  get benchedUids(): number[] {
    return [...this.benched];
  }

  /**
   * 选人完成（EXE 0x405d10 → 0x40de90）：没被选上的我方、友军全部退场，清掉剧本标志，
   * 于是条件 3（参数 0）的区块接着执行（回合限制、条件文字；N-add15 主角被点名回到场上）。
   */
  choose(uids: number[]): BattleEvent[] {
    this.out = [];
    const p = this.pendingPick;
    if (!p) return [];
    const picked = [...new Set(uids)].filter((id) => p.candidates.includes(id));
    if (picked.length !== Math.min(p.count, p.candidates.length)) throw new Error(`要选 ${p.count} 人`);
    if (this.pickTo) return this.chooseDuelist(picked);
    for (const u of this.units) {
      if (u.side === 'enemy' || !u.alive || !u.present || picked.includes(u.uid)) continue;
      this.hide(u, false);
      if (u.side === 'player') this.benched.add(u.uid);
    }
    this.pendingPick = null;
    this.scriptFlag = false;
    this.runCondBlocks();
    if (this.turn === 0 && this.status === 'playing') {
      this.startTurn(1);
      this.record();
    } else this.afterAction();
    return this.flush();
  }

  /**
   * 单挑选人选好【新】（叫阵晁家庄）：其余在场的我方原地观战（不能行动、不能被打），选上的人出列走到擂台，
   * 开场选的进第 1 回合；回合中间选的把本回合开始的时光倒流记录换成选好之后的（免得倒流回到没人出战的时候）。
   */
  private chooseDuelist(picked: number[]): BattleEvent[] {
    const to = this.pickTo!;
    this.pickTo = null;
    this.pendingPick = null;
    this.scriptFlag = false;
    const sp = this.spectators as Set<number>;
    for (const u of this.units) {
      if (u.side !== 'player' || !u.alive || !u.present) continue;
      if (picked.includes(u.uid)) continue;
      if (!sp.has(u.uid)) {
        sp.add(u.uid);
        u.defending = false;
        this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
      }
    }
    for (const id of picked) {
      const u = this.unit(id);
      if (!u) continue;
      sp.delete(u.uid);
      this.fought.add(u.uid);
      this.duelist = { uid: u.uid, x: u.x, y: u.y };
      this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
      this.walkNear(u, to.x, to.y);
      if (u.side === this.phase) {
        u.ended = u.stunTurns > 0;
        u.acted = false;
        u.movementRemaining = u.stats.move;
        u.turnStart = null;
      }
    }
    this.runCondBlocks();
    if (this.turn === 0 && this.status === 'playing') {
      this.startTurn(1);
      this.record();
    } else {
      this.afterAction();
      if (this.status === 'playing' && this.phase === 'player' && this.history.at(-1)?.turn === this.turn) {
        this.history.pop();
        this.record();
      }
    }
    return this.flush();
  }

  /** 上一阵出战的人走回出列前的位置（站不了就站最近的空格），改成观战 */
  private sendDuelistBack() {
    const d = this.duelist;
    this.duelist = null;
    const u = d && this.unit(d.uid);
    if (!d || !u || !u.alive || !u.present || u.side !== 'player') return;
    (this.spectators as Set<number>).add(u.uid);
    u.defending = false;
    this.walkNear(u, d.x, d.y);
    this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
  }

  /** 走到 (x, y)，或走得到的、离它最近的空格（剧本演出，不耗移动力） */
  private walkNear(u: Unit, x: number, y: number) {
    const reach = this.reachOf(u, 99);
    const taken = this.occupied(u);
    let best: Cell[] = [], bestD = Math.abs(u.x - x) + Math.abs(u.y - y);
    for (const k of reach.keys()) {
      if (taken.has(k)) continue;
      const [cx, cy] = k.split(',').map(Number);
      const d = Math.abs(cx - x) + Math.abs(cy - y);
      if (d > bestD) continue;
      const path = pathTo(reach, cx, cy);
      if (path.length > 1 && (d < bestD || path.length < best.length)) { best = path; bestD = d; }
    }
    if (best.length) this.walk(u, best, true);
  }

  /** 我方回合结束：友军、敌方依次行动，然后进入下一回合 */
  endPlayerPhase(): BattleEvent[] {
    this.out = [];
    if (this.status !== 'playing' || this.phase !== 'player') return [];
    // 潜行关：发现我方的人到期还站着，就喊醒了全庄【新】
    if (this.stealth && !this.stealthOver && Object.entries(this.spotters).some(([uid, t]) => t <= this.turn && this.units[Number(uid)].alive && this.units[Number(uid)].present)) {
      this.finish('lost', this.stealth.lose);
      return this.flush();
    }
    if (this.cuju) {
      this.startPhase('enemy');
      this.runCujuAi('enemy');
      if (this.status !== 'playing') return this.flush();
      this.startTurn(this.turn + 1);
      this.record();
      return this.flush();
    }
    for (const side of ['ally', 'enemy'] as const) {
      this.startPhase(side);
      for (const u of this.units.filter((x) => x.side === side && x.alive && !this.spectators.has(x.uid) && (x.present || this.ambushers.has(x.uid)))) {
        if (this.status !== 'playing') break;
        if (!u.alive || u.ended) continue;
        if (!u.present) {
          if (this.ambushers.has(u.uid)) this.ambushTurn(u);
          continue;
        }
        this.runAi(u);
      }
      if (this.status !== 'playing') return this.flush();
    }
    this.startTurn(this.turn + 1);
    this.record();
    return this.flush();
  }

  // ───────────── 时光倒流【新】 ─────────────

  /** 会随战斗变化的全部状态（地图、剧本、编组是固定的；随机数单独处理） */
  private state(): string {
    return JSON.stringify({
      units: this.units, items: this.items, turn: this.turn, phase: this.phase, turnLimit: this.turnLimit, status: this.status,
      objectives: this.objectives, fired: [...this.fired], scriptFlag: this.scriptFlag, turnParam: this.turnParam, flags: [...this.flags],
      pendingDeaths: this.pendingDeaths, teamExp: this.teamExp, clearGold: this.clearGold, ambushers: [...this.ambushers],
      expBySource: this.expBySource, benched: [...this.benched], used: this.used, turnAt: this.turnAt, spectators: [...this.spectators],
      spotters: this.spotters, cuju: this.cuju, royale: this.royale, credited: [...this.credited], lastHitBy: this.lastHitBy, fire: this.fire?.save(), blaze: this.blaze, stealthOver: this.stealthOver, unsealed: [...this.unsealed], trapSeals: this.trapSeals.map((c) => ({ ...c })),
      fought: [...this.fought], duelist: this.duelist, refused: this.refused, drugged: [...this.drugged],
    });
  }

  /** 我方回合开始时记一份状态，只留最近 REWIND_TURNS 份 */
  private record() {
    if (this.status !== 'playing' || this.phase !== 'player') return;
    this.history.push({ turn: this.turn, state: this.state() });
    while (this.history.length > REWIND_TURNS) this.history.shift();
  }

  /** 本回合开始后有没有变化（行动过、或者已经分出胜负） */
  private changedSinceTurnStart() {
    const top = this.history.at(-1);
    return !!top && this.state() !== top.state;
  }

  /**
   * 时光倒流会回到第几回合的开始；不能倒流时为 null。
   * 本回合动过（或打输了）就回到本回合开始，否则回到上一回合开始。
   */
  rewindTarget(): number | null {
    if (this.status === 'won') return null;
    if (this.changedSinceTurnStart()) return this.history.at(-1)!.turn;
    return this.history.length >= 2 ? this.history.at(-2)!.turn : null;
  }

  /** 时光倒流：恢复到 rewindTarget() 那一回合的我方回合开始，换种子重新掷随机数 */
  rewind(seed?: number): BattleEvent[] {
    this.out = [];
    if (this.rewindTarget() === null) return [];
    if (!this.changedSinceTurnStart()) this.history.pop();
    const s = JSON.parse(this.history.at(-1)!.state);
    // 单位按原对象原地恢复（画面和 AI 拿着的引用不失效）
    s.units.forEach((u: Unit, i: number) => Object.assign(this.units[i], u));
    this.items.splice(0, this.items.length, ...s.items);
    this.turn = s.turn;
    this.phase = s.phase;
    this.turnLimit = s.turnLimit;
    this.status = s.status;
    this.objectives = s.objectives;
    this.fired = new Set(s.fired);
    this.scriptFlag = s.scriptFlag;
    this.turnParam = s.turnParam;
    this.flags = new Set(s.flags ?? []);
    this.pendingDeaths = s.pendingDeaths;
    this.turnAt = s.turnAt ?? {};
    this.teamExp = s.teamExp;
    this.clearGold = s.clearGold;
    this.ambushers = new Set(s.ambushers);
    this.expBySource = s.expBySource;
    this.benched = new Set(s.benched ?? []);
    this.used = s.used ?? {};
    this.spotters = s.spotters ?? {};
    this.credited = new Set(s.credited ?? []);
    this.lastHitBy = s.lastHitBy ?? {};
    this.fought = new Set(s.fought ?? []);
    this.duelist = s.duelist ?? null;
    this.refused = s.refused ?? {};
    this.drugged = new Set(s.drugged ?? []);
    if (this.cuju && s.cuju) this.cuju = s.cuju;
    if (this.royale && s.royale) this.royale = s.royale;
    if (this.fire && s.fire) this.fire.load(s.fire);
    this.blaze = s.blaze ?? [];
    this.stealthOver = s.stealthOver ?? false;
    this.unsealed = new Set(s.unsealed ?? []);
    for (const c of this.trapSeals) this.board.blocked[c.y * this.board.width + c.x] = 0;
    this.trapSeals = (s.trapSeals ?? []).map((c: { x: number; y: number; tile?: number }) => ({ ...c }));
    for (const c of [...this.sealed, ...this.trapSeals]) {
      const i = c.y * this.board.width + c.x;
      this.board.blocked[i] = this.unsealed.has(i) ? 0 : 1;
    }
    if (this.fire || this.blaze.length) this.emit({ type: 'fire', cells: this.fireCells() });
    if (s.spectators) { const sp = this.spectators as Set<number>; sp.clear(); for (const id of s.spectators) sp.add(id); }
    this.rng.reseed(seed);
    this.emit({ type: 'phase', side: 'player', turn: this.turn });
    const prompt = this.data.prompts?.[0];
    if (this.awaitingSignal && prompt) this.emit({ type: 'ask', prompt });
    return this.flush();
  }

  private startTurn(t: number) {
    this.turn = t;
    if (t > 1) this.runTurnTriggers(t - 1);
    if (this.status !== 'playing') return;
    if (this.cuju && this.cujuClock(t)) return;
    if (this.royale) {
      this.royaleTick(t);
      if (this.status !== 'playing') return;
    }
    if (this.turnLimit && t > this.turnLimit) return this.finish('lost', '限制回合數已到，未完成任務，遊戲失敗！');
    // 火势蔓延【新】：每回合开始烧开一圈（有人站着的格子不点着）
    const fire = this.fire;
    if (fire && t > 1) {
      fire.spread(new Set(this.active().map((u) => u.y * this.board.width + u.x)));
      this.emit({ type: 'fire', cells: this.fireCells() });
    }
    // 回合开始：装备回复 → 火燎 → 中毒 → 状态回合数 −1
    const burned: string[] = [];
    for (const u of this.active()) {
      const hp0 = u.hp, mp0 = u.mp;
      u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.regenHp);
      u.mp = Math.min(u.stats.maxMp, u.mp + u.stats.regenMp);
      // 火旁边的人掉血，不会烧死【新】
      if (fire && t > 1 && !this.spectators.has(u.uid) && fire.scorches(u.x, u.y)) {
        u.hp = Math.max(1, u.hp - Math.max(1, Math.floor((u.stats.maxHp * fire.input.damagePct) / 100)));
        burned.push(u.name);
      }
      if (u.poisonTurns > 0) {
        const loss = Math.max(1, Math.floor(u.stats.maxHp / 20));
        u.hp = Math.max(1, u.hp - loss); // 毒不致死【待核】
        this.emit({ type: 'message', text: `${u.name}毒發，生命力損失 ${loss} 點。` });
      }
      if (u.hp !== hp0 || u.mp !== mp0) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, mpDelta: u.mp - mp0 });
      if (u.poisonTurns > 0 && --u.poisonTurns === 0) refreshStats(u, this.data);
      if (u.stunTurns > 0) u.stunTurns--;
      // 蒙汗药的劲过了【新】
      if (u.stunTurns === 0 && this.drugged.delete(u.uid)) {
        this.emit({ type: 'status', uid: u.uid, text: '醒過來了' });
        this.noteDid(u, 'wake');
      }
      if (u.panicTurns && --u.panicTurns === 0) this.emit({ type: 'status', uid: u.uid, text: '回過神來' });
      if (u.buffs.length) {
        // 0 表示本关持续；限时效果扣到 0 时立即移除，不转成本关持续。
        u.buffs = u.buffs.filter((b) => b.turns === 0 || --b.turns > 0);
        refreshStats(u, this.data);
      }
    }
    if (burned.length) this.emit({ type: 'message', text: `${burned.join('、')}離火太近，被燒傷了。` });
    this.checkDid();
    if (this.status !== 'playing') return;
    this.startPhase('player');
  }

  private startPhase(side: Side) {
    this.phase = side;
    if (this.cuju) {
      this.cuju.locked = false;
      this.cuju.over = false;
    }
    for (const u of this.units.filter((x) => x.side === side)) {
      if (u.defending) {
        u.defending = false;
        this.emit({ type: 'defend', uid: u.uid, on: false });
      }
      u.movementRemaining = u.stats.move;
      u.forcedMarch = false;
      u.acted = false;
      u.turnStart = null;
      u.ended = u.stunTurns > 0;
    }
    this.emit({ type: 'phase', side, turn: this.turn });
    const prompt = this.data.prompts?.[0];
    if (side === 'player' && this.awaitingSignal && prompt) this.emit({ type: 'ask', prompt });
  }

  private flush() {
    const o = this.out;
    this.out = [];
    return o;
  }
  /** 正在执行剧本区块（>0）：这时发出的事件标上 script，画面双击快进时照常播放（负责人 2026-11-23：快进不跳剧情动画）【新】 */
  private scriptDepth = 0;
  private emit(e: BattleEvent) {
    if (this.scriptDepth > 0) Object.defineProperty(e, 'script', { value: true, enumerable: false });
    if (this.teaching && SOFT_EVENTS.has(e.type)) this.soft.add(e);
    this.out.push(e);
  }

  // ───────────── 指令 ─────────────

  move(u: Unit, x: number, y: number): BattleEvent[] {
    this.out = [];
    if (!this.canMove(u)) return [];
    const reach = this.reachOf(u, u.movementRemaining + (u.forcedMarch ? 0 : forcedExtra(u)));
    let n = reach.get(key(x, y));
    if (!n || n.cost === 0) return [];
    if (!u.turnStart) u.turnStart = { x: u.x, y: u.y, facing: u.facing, movement: u.movementRemaining };
    let path = pathTo(reach, x, y);
    // 盘问【新】：走进会盘问的哨兵眼前，就在那一格被拦下（后面的路不走了）
    const stop = this.questionStop(u, path);
    if (stop > 0 && stop < path.length - 1) {
      path = path.slice(0, stop + 1);
      n = reach.get(key(path[stop].x, path[stop].y))!;
    }
    const forced = n.cost > u.movementRemaining;
    this.walk(u, path);
    if (forced) {
      u.forcedMarch = true;
      u.movementRemaining = 0;
      u.ended = true;
    } else u.movementRemaining -= n.cost;
    if (u.side === 'player') this.noteDid(u, 'move');
    this.passed = { uid: u.uid, path };
    try {
      this.afterAction();
    } finally {
      this.passed = null;
    }
    // 移动中出了任何事（剧情区块、被哨兵发现、开宝箱、提示以外的消息……），这次移动就定下来，不能撤销【新】（负责人 2026-11-22）
    if (this.out.some((e) => !(e.type === 'move' && e.uid === u.uid) && !(e.type === 'status' && e.text === AREA_HINT) && !this.soft.has(e))) u.turnStart = null;
    return this.flush();
  }

  /** 这条路上第一格被会盘问、这回合还会拦人的哨兵看见的位置（0 = 没有） */
  private questionStop(u: Unit, path: { x: number; y: number }[]): number {
    if (u.side !== 'player' || !this.watchQuestion.size || this.stealthOver) return 0;
    for (let i = 1; i < path.length; i++)
      for (const [uid, r] of this.watchers) {
        const w = this.units[uid];
        if (!this.watchQuestion.has(uid) || !w?.alive || !w.present || w.side !== 'enemy' || w.stunTurns > 0 || uid in this.spotters) continue;
        if (!this.watchTrust.get(uid)?.includes(u.classId) || !this.mayQuestion(uid, u.uid)) continue;
        if (watcherSees(w, path[i], r)) return i;
      }
    return 0;
  }

  private mayQuestion(watcher: number, who: number) {
    const last = this.questioned.get(`${watcher}:${who}`);
    return last === undefined || this.turn - last > 2;
  }

  /**
   * 撤销移动【新】（负责人 2026-11-22）：本回合移动过、还没出手；原来的格子没被别人占住；
   * 移动后没有触发剧情、没开宝箱、没用 / 给 / 收道具（这些都会清掉 turnStart，见 lockUndo、move、pickup、useItem、giveItem）。
   */
  canUndo(u: Unit) {
    const s = u.turnStart;
    if (!s || u.acted || u.side !== this.phase || this.status !== 'playing') return false;
    return !this.units.some((t) => t !== u && t.alive && t.present && t.x === s.x && t.y === s.y);
  }

  /** 剧情一发生，本回合这一方已经走过的人都不能再撤销移动（剧情可能已经按他们的位置改了局面）【新】 */
  private lockUndo() {
    for (const t of this.units) if (t.side === this.phase) t.turnStart = null;
  }
  undoMove(u: Unit): BattleEvent[] {
    if (!this.canUndo(u)) return [];
    const s = u.turnStart!;
    u.x = s.x;
    u.y = s.y;
    u.facing = s.facing;
    u.movementRemaining = s.movement;
    u.forcedMarch = false;
    u.ended = false;
    u.turnStart = null;
    return [{ type: 'move', uid: u.uid, path: [{ x: u.x, y: u.y }], facing: u.facing }];
  }

  attack(u: Unit, t: Unit): BattleEvent[] {
    this.out = [];
    if (!this.attackTargets(u).includes(t)) return [];
    this.cast(u, attackSkill(u, this.data), t, false);
    this.endAction(u);
    return this.flush();
  }

  /** 使用技能：消耗气力，攻击后用完剩余移动力 */
  useSkill(u: Unit, skill: SkillDef, cell: Cell): BattleEvent[] {
    this.out = [];
    if (!this.canAct(u) || u.acted || u.mp < skill.mpCost) return [];
    if (!learnedSkills(u, this.data).includes(skill)) return [];
    if (!this.skillTargets(u, skill).some((c) => c.x === cell.x && c.y === cell.y)) return [];
    this.cast(u, skill, cell, false);
    this.endAction(u);
    return this.flush();
  }

  private endAction(u: Unit) {
    u.acted = true;
    u.ended = true;
    u.movementRemaining = 0;
    this.afterAction();
  }

  defend(u: Unit): BattleEvent[] {
    this.out = [];
    if (!this.canAct(u)) return [];
    u.defending = true;
    u.ended = true;
    this.emit({ type: 'defend', uid: u.uid, on: true });
    this.noteDid(u, 'defend');
    this.checkDid();
    return this.flush();
  }

  rest(u: Unit): BattleEvent[] {
    this.out = [];
    if (!this.canAct(u) || u.acted) return [];
    this.applyRest(u);
    u.ended = true;
    this.noteDid(u, 'rest');
    this.checkDid();
    return this.flush();
  }

  private applyRest(u: Unit) {
    const hp0 = u.hp;
    const mp0 = u.mp;
    u.hp = Math.min(u.stats.maxHp, u.hp + Math.max(1, Math.floor(u.stats.maxHp / REST_DIVISOR)));
    u.mp = Math.min(u.stats.maxMp, u.mp + Math.max(1, Math.floor(u.stats.maxMp / REST_DIVISOR)));
    this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, mpDelta: u.mp - mp0, text: '休息' });
    this.gainExp(u, restExp(u.hp - hp0, u.mp - mp0, this.rng), 'rest');
  }

  /**
   * 回合终了时还没行动的我方人物的默认行动【新】（负责人 2026-11-13，第 2 条 2026-11-14 改为用回气技能）：
   * 体力不满 → 休息；只有气力不满 → 有能用的集气技（回气的技能）就对自己用，没有就休息；都满 → 防御。
   * 道具不会被自动使用。
   */
  autoAct(u: Unit): BattleEvent[] {
    if (u.side !== 'player' || !this.canAct(u)) return [];
    const note = (text: string): BattleEvent => ({ type: 'message', text });
    const rest = () => [note(`${u.name}自動休息。`), ...this.rest(u)];
    const defend = () => [note(`${u.name}自動防禦。`), ...this.defend(u)];
    if (!u.acted && u.hp < u.stats.maxHp) return rest();
    if (u.mp < u.stats.maxMp) {
      const skill = this.mpSkill(u);
      if (skill) return [note(`${u.name}自動使用${this.tr(skill.name)}。`), ...this.useSkill(u, skill, u)];
      if (!u.acted) return rest();
    }
    return defend();
  }

  /** 我方还没行动、回合终了时会自动行动的人物 */
  autoActUnits(): Unit[] {
    return this.phase === 'player' ? this.units.filter((u) => u.side === 'player' && this.canAct(u)) : [];
  }

  /**
   * 回合终了自动用的回气技能：已习得、气力付得起、能对自己施放、用完气力净增的集气技里，
   * 挑用完后气力最多的；一样多就挑耗气少的。没有返回 undefined。
   */
  mpSkill(u: Unit): SkillDef | undefined {
    if (!this.canAct(u) || u.acted) return undefined;
    const after = (s: SkillDef) => Math.min(u.stats.maxMp, u.mp - s.mpCost + Math.floor(u.stats.maxMp / Math.max(1, s.power)));
    return learnedSkills(u, this.data)
      .filter((s) => isSelfChargeSkill(s) && u.mp >= s.mpCost && after(s) > u.mp)
      .filter((s) => this.skillTargets(u, s).some((c) => c.x === u.x && c.y === u.y))
      .sort((a, b) => after(b) - after(a) || a.mpCost - b.mpCost)[0];
  }

  wait(u: Unit): BattleEvent[] {
    if (!this.canAct(u)) return [];
    u.ended = true;
    return [];
  }

  /** 可以使用的道具槽（回复、解毒解昏、抗毒抗昏、增益；类型 15–22） */
  usableSlots(u: Unit): number[] {
    if (!this.canAct(u) || this.cuju) return [];
    return u.slots.flatMap((id, k) => (isUsable(itemOf(this.data, id)) ? [k] : []));
  }

  /**
   * 道具能用在谁身上：自己和上下左右相邻格的非敌方单位。
   * 原版"使用"指令（0x409618）调 0x40d5d0(位置, 0, 1)，沿 4 个方向标出距离 0–1 的格子；
   * 执行时（0x409798）只要光标处的单位不是敌方（unit+0x3b ≠ 2）就交给 0x408dc0。
   */
  itemTargets(u: Unit, slot: number): Unit[] {
    if (!this.usableSlots(u).includes(slot)) return [];
    return this.active().filter((t) => dist(u, t) <= 1 && !hostile(u, t));
  }

  /** 使用道具：不算行动、不消耗移动力、不限次数（原版 0x409798 → 0x408dc0 → 0x4094e0，不碰行动结束标志） */
  useItem(u: Unit, slot: number, target: Unit = u): BattleEvent[] {
    this.out = [];
    if (!this.itemTargets(u, slot).includes(target)) return [];
    this.applyItem(u, slot, target);
    this.gainExp(u, itemExp(this.rng), 'item');
    u.turnStart = null;
    target.turnStart = null; // 用在别人身上：对方也不能再撤销移动
    this.noteDid(u, 'item');
    this.checkDid();
    return this.flush();
  }

  /**
   * 给予的对象：上下左右相邻的我方人物。原版"給予"指令（0x4095ec）调 0x40d5d0(位置, 1, 1)，
   * 执行时（0x409752）要求对方是我方（unit+0x3b = 0）。
   */
  giveTargets(u: Unit, slot: number): Unit[] {
    if (!this.canAct(u) || u.side !== 'player' || !u.slots[slot] || u.slots[slot] > 200) return [];
    return this.active().filter((t) => t !== u && t.side === 'player' && dist(u, t) === 1);
  }

  /**
   * 给予：放进对方随身物品栏的第一个空位（装备也一样，交过去再由对方装上），打铁次数跟着走；
   * 对方道具栏满了就不给（0x409460 返回 0）。不算行动（0x409752 不碰行动结束标志）。
   */
  giveItem(u: Unit, slot: number, target: Unit): BattleEvent[] {
    this.out = [];
    if (!this.giveTargets(u, slot).includes(target)) return [];
    const it = itemOf(this.data, u.slots[slot])!;
    const k = freeBagSlot(target.slots);
    if (k < 0) {
      this.emit({ type: 'message', text: `${target.name}的道具已滿。` });
      return this.flush();
    }
    target.slots[k] = u.slots[slot];
    target.forge[k] = u.forge[slot] ?? 0;
    this.clearSlot(u, slot);
    u.turnStart = null;
    target.turnStart = null; // 收东西的人也不能再撤销移动（负责人 2026-11-22）
    this.emit({ type: 'message', text: `${u.name}把${this.tr(it.name)}交給了${target.name}。` });
    this.noteDid(u, 'give');
    this.checkDid();
    return this.flush();
  }

  /** 丢弃【新：原版战斗菜单里的丟棄未核对】 */
  discardItem(u: Unit, slot: number): BattleEvent[] {
    this.out = [];
    const it = itemOf(this.data, u.slots[slot]);
    if (!this.canAct(u) || u.side !== 'player' || !it) return [];
    this.clearSlot(u, slot);
    this.emit({ type: 'message', text: `${u.name}丟棄了${this.tr(it.name)}。` });
    return this.flush();
  }

  /**
   * 装备 / 卸下（原版命令 8"裝備"在菜单里直接完成，不算行动）：
   * 物品栏里的装备换进对应的装备栏（原来的换到这一格）；装备栏里的则卸到第一个空的物品栏。
   */
  equipItem(u: Unit, slot: number): BattleEvent[] {
    this.out = [];
    const it = itemOf(this.data, u.slots[slot]);
    if (!this.canAct(u) || u.side !== 'player' || !it) return [];
    let to: number;
    if (slot < EQUIP_SLOTS) {
      to = freeBagSlot(u.slots);
      if (to < 0) {
        this.emit({ type: 'message', text: '道具已滿，無法卸下。' });
        return this.flush();
      }
    } else {
      to = equipSlotOf(it);
      if (to < 0 || !canEquip(this.data.classes[u.classId], it, this.data)) {
        this.emit({ type: 'message', text: `${u.name}不能裝備${this.tr(it.name)}。` });
        return this.flush();
      }
    }
    if (u.storyGear?.[slot] || u.storyGear?.[to]) {
      this.emit({ type: 'message', text: '本场暂以拳脚应战，原武器已妥善保管。' });
      return this.flush();
    }
    [u.slots[slot], u.slots[to]] = [u.slots[to] ?? 0, u.slots[slot]];
    [u.forge[slot], u.forge[to]] = [u.forge[to] ?? 0, u.forge[slot] ?? 0];
    const before = u.stats.move;
    refreshStats(u, this.data);
    this.adjustMovement(u, u.stats.move - before);
    u.turnStart = null;
    this.emit({ type: 'message', text: `${u.name}${slot < EQUIP_SLOTS ? '卸下' : '裝備'}了${this.tr(it.name)}。` });
    this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
    return this.flush();
  }

  canEquipItem(u: Unit, slot: number): boolean {
    const it = itemOf(this.data, u.slots[slot]);
    if (!it || u.side !== 'player' || !this.canAct(u)) return false;
    if (u.storyGear?.[slot] || u.storyGear?.[equipSlotOf(it)]) return false;
    if (slot < EQUIP_SLOTS) return freeBagSlot(u.slots) >= 0;
    return equipSlotOf(it) >= 0 && canEquip(this.data.classes[u.classId], it, this.data);
  }

  private clearSlot(u: Unit, slot: number) {
    u.slots[slot] = 0;
    u.forge[slot] = 0;
    if (slot < EQUIP_SLOTS) {
      const before = u.stats.move;
      refreshStats(u, this.data);
      this.adjustMovement(u, u.stats.move - before);
    }
  }

  /** 移动力变了（换装备、增益）时，本回合还没走完的部分跟着变 */
  private adjustMovement(u: Unit, delta: number) {
    if (!delta || u.side !== this.phase || u.ended || u.acted) return;
    u.movementRemaining = Math.max(0, u.movementRemaining + delta);
  }

  /** 道具效果（EXE 0x408dc0）：回复、解毒解昏、限时效果；战报按原版"甲使用了某某，乙生命力恢復了 N 點。" */
  private applyItem(u: Unit, slot: number, t: Unit = u) {
    const it = itemOf(this.data, u.slots[slot])!;
    const name = this.tr(it.name);
    this.clearSlot(u, slot);
    this.emit({ type: 'sound', name: 'm10' }); // 使用道具音（EXE 0x408dc0）
    const hp0 = t.hp, mp0 = t.mp;
    if (it.healHp) t.hp = it.healHp < 0 ? t.stats.maxHp : Math.min(t.stats.maxHp, t.hp + it.healHp);
    if (it.healMp) t.mp = it.healMp < 0 ? t.stats.maxMp : Math.min(t.stats.maxMp, t.mp + it.healMp);
    const who = `${u.name}使用了${name}，${t === u ? '' : t.name}`;
    if (it.healHp) this.emit({ type: 'message', text: it.healHp < 0 ? `${who}生命力全部恢復` : `${who}生命力恢復了${t.hp - hp0}點。` });
    if (it.healMp) this.emit({ type: 'message', text: it.healMp < 0 ? `${who}氣力全部恢復` : `${who}氣力恢復了${t.mp - mp0}點。` });
    let cured = false;
    if ((it.type === 18 || it.curePoison) && t.poisonTurns > 0) (t.poisonTurns = 0), (cured = true);
    if ((it.type === 19 || it.cureStun) && t.stunTurns > 0) {
      t.stunTurns = 0;
      cured = true;
      // 昏迷时这回合本来不能行动；解昏后照常行动【新】
      if (t.side === this.phase && !t.acted) t.ended = false;
    }
    if (cured) this.emit({ type: 'message', text: `${who}狀態恢復正常了！` });
    const buffs = itemBuffs(it);
    const move0 = t.stats.move;
    for (const b of buffs) {
      // 同一项效果再用一次：以新的为准（不叠加）【新】
      t.buffs = t.buffs.filter((x) => x.stat !== b.stat);
      t.buffs.push({ ...b });
    }
    refreshStats(t, this.data);
    this.adjustMovement(t, t.stats.move - move0);
    if (buffs.length) this.emit({ type: 'message', text: `${who}${buffs.map((b) => `${buffName(b.stat)}${b.value ? `+${b.value}` : ''}`).join('、')}，持續 ${Math.max(...buffs.map((b) => b.turns))} 回合。` });
    if (!it.healHp && !it.healMp && !cured && !buffs.length) this.emit({ type: 'message', text: `${who}沒有效果。` });
    this.emit({ type: 'hp', uid: t.uid, hp: t.hp, mp: t.mp, delta: t.hp - hp0, mpDelta: t.mp - mp0, text: name });
  }

  // ───────────── 结算 ─────────────

  private walk(u: Unit, path: Cell[], script = false) {
    if (path.length < 2) return;
    const last = path[path.length - 1], prev = path[path.length - 2];
    u.x = last.x;
    u.y = last.y;
    u.facing = facingTowards(prev, last, u.facing);
    this.emit(script ? { type: 'move', uid: u.uid, path, facing: u.facing, script } : { type: 'move', uid: u.uid, path, facing: u.facing });
    // 原版只有我方在移动的每一帧检查脚下的格子（0x405500 → 0x409c30），踩上宝箱才拾起。
    // 重制版【新：负责人 2026-11-12】：只有我方，走到宝箱上或上下左右相邻的格子（路过也算）就自动打开
    if (u.side !== 'player' && !this.royale) return; // 吃鸡：谁都能开宝箱
    const full = new Set<GroundItem>();
    for (const c of path.slice(1))
      for (const g of this.items.filter((g) => dist(g, c) <= 1)) if (!full.has(g) && !this.pickup(u, g)) full.add(g);
  }

  /**
   * 打开宝箱（原版拾取 EXE 0x4054e0 / 0x409460）：物品号 ≤ 200 才能拾，放进随身物品栏的第一个空位；
   * 物品栏满了就留着，提示一句（原版不提示）【新】。返回是否拾到。
   */
  private pickup(u: Unit, g: GroundItem): boolean {
    if (g.item > 200 || !this.items.includes(g)) return false;
    const slot = freeBagSlot(u.slots);
    if (slot < 0) {
      if (u.side === 'player') this.emit({ type: 'message', text: `${u.name}的道具已滿，打不開寶箱。` });
      return false;
    }
    this.items.splice(this.items.indexOf(g), 1);
    u.slots[slot] = g.item;
    u.forge[slot] = 0;
    u.turnStart = null; // 拾取后不能撤销移动
    refreshStats(u, this.data);
    this.emit({ type: 'pickup', uid: u.uid, x: g.x, y: g.y, item: g.item });
    this.emit({ type: 'message', text: `${u.name}得到了${this.tr(itemOf(this.data, g.item)!.name)}。` });
    return true;
  }

  /**
   * 普通攻击与技能的结算。范围内每个目标各自判定命中、必杀与伤害（原版逐个目标调用 0x406c60），
   * 多段技能只是把这一次的伤害按比例分段显示。
   */
  private cast(u: Unit, skill: SkillDef, cell: Cell, counter: boolean) {
    if (this.cuju && !isSupportSkill(skill)) return this.kickCast(u, skill, cell);
    const targets = this.affected(u, skill, cell);
    const area = this.skillArea(u, skill, cell);
    if (cell.x !== u.x || cell.y !== u.y) u.facing = facingTowards(u, cell, u.facing);
    u.mp -= skill.mpCost;
    (this.used[u.uid] ??= []).push(skill.skillId);
    const basic = skill === attackSkill(u, this.data);
    // 教学关的 did 触发：从背后 / 侧面出手（flank）记在 attack / skill 前面，先判「打到背后了」再判「出手了」
    const did = counter ? 'counter' : basic ? 'attack' : 'skill';
    if (skill.drug) return this.serveDrug(u, skill, targets, area, cell);
    // 伪装的人主动出手打敌人就被识破【新】（反击不算：防御时被打才会反击，敌人本来不打他）
    if (u.disguised && !counter && !isSupportSkill(skill) && targets.some((t) => t.side === 'enemy')) this.unmask(u, '识破');
    if (this.banquet && u.side === 'player' && !this.flags.has(this.banquet.flag)) this.checkAlarm(targets);
    if (isSupportSkill(skill)) {
      this.noteDid(u, did);
      this.emit({ type: 'attack', uid: u.uid, skill, cell, area, facing: u.facing, hits: [], counter });
      if (skill.mpCost && !targets.includes(u)) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
      const name = this.tr(skill.name);
      let healed = 0;
      for (const t of targets) {
        if (t !== u) t.turnStart = null; // 被队友的回复 / 集气技照顾到，就不能再撤销移动（同给别人用道具）【新】（负责人 2026-11-22）
        const hp0 = t.hp, mp0 = t.mp;
        const div = Math.max(1, skill.power);
        if (isChargeSkill(skill)) t.mp = Math.min(t.stats.maxMp, t.mp + Math.floor(t.stats.maxMp / div));
        else t.hp = Math.min(t.stats.maxHp, t.hp + Math.floor(t.stats.maxHp / div));
        healed += t.hp - hp0;
        this.emit({ type: 'hp', uid: t.uid, hp: t.hp, mp: t.mp, delta: t.hp - hp0, mpDelta: t.mp - mp0, text: name });
      }
      if (isHealSkill(skill) && u.side === 'player') this.gainExp(u, healExp(healed, this.rng), 'heal');
      return;
    }
    const feint = this.tune?.feint;
    const hits = targets.map((t) => ({ t, r: feint && u.classId === feint.by && t.classId === feint.target ? feintHit(skill) : rollAttack(u, t, skill, this.rng, counter) }));
    if (feint?.flag !== undefined && hits.some(({ t }) => u.classId === feint.by && t.classId === feint.target)) this.flags.add(feint.flag);
    if (!counter && hits.some(({ r }) => r.backstab !== 'front')) this.noteDid(u, 'flank');
    this.noteDid(u, did);
    for (const { t } of hits) if (t.defending) this.noteDid(t, 'guard');
    this.emit({ type: 'attack', uid: u.uid, skill, cell, area, facing: u.facing, hits: hits.map(({ t, r }) => ({ uid: t.uid, result: r })), counter });
    if (skill.mpCost) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
    if (counter) this.emit({ type: 'message', text: `${u.name}施展反擊技，` });
    else if (!basic) this.emit({ type: 'message', text: `${u.name}使出${this.tr(skill.name)}！` });
    let total = 0;
    let counterBy: Unit | undefined;
    let exp = 0;
    for (const { t, r } of hits) {
      if (!r.hit) {
        if (hits.length === 1) this.emit({ type: 'message', text: `${u.name}的攻擊落空了。` });
        // 防御中闪避相邻攻击：50% 反击，必定命中
        if (!counter && !counterBy && canCounter(u, t) && this.rng.chance(50)) counterBy = t;
        if (t.side === 'player') this.gainExp(t, dodgeExp(t.defending, this.rng), 'dodge');
        continue;
      }
      const hp0 = t.hp;
      t.hp = Math.max(this.spared(t) ? 1 : 0, t.hp - r.damage);
      total += r.damage;
      if (u.side === 'player' && t.side === 'enemy' && r.damage > 0) this.lastHitBy[t.uid] = u.uid;
      t.facing = facingTowards(t, u, t.facing); // 受击时转向攻击者
      this.emit({ type: 'face', uid: t.uid, facing: t.facing });
      this.emit({ type: 'hp', uid: t.uid, hp: t.hp, mp: t.mp, delta: t.hp - hp0 });
      if (hits.length === 1) {
        const n = r.partHit.length, got = r.partHit.filter(Boolean).length;
        const seg = n > 1 && got < n ? `（${n} 段命中 ${got} 段）` : ''; // 多段攻击每段单独判定【新】
        this.emit({ type: 'message', text: r.damage > 0 ? `${r.crit ? '必殺！' : ''}${r.damage} 點傷害。${seg}` : '未造成敵方傷害。' });
      }
      if (t.hp === 0) {
        // 击倒的这一下也给伤害经验，与击倒经验合在一起按 65/35 分；溢出的伤害最多算目标最大生命的 20%【新】（负责人 2026-11-13）
        this.kill(u, t, u.side === 'player' ? hitExp(killDamage(r.damage, hp0, t.stats.maxHp), this.rng) : 0);
        if (counter && u.side === 'player') exp += counterExp(this.rng);
        continue;
      }
      if (r.poisoned && t.poisonTurns === 0 && !resists(t, 'resistPoison')) {
        t.poisonTurns = this.rng.range(2, 4);
        refreshStats(t, this.data);
        this.emit({ type: 'status', uid: t.uid, text: '中毒了！' });
      }
      // 只吃了一点药酒的人（李云）挨打就醒【新】
      if (r.damage > 0 && this.drinks.get(t.uid)?.light && this.drugged.delete(t.uid)) {
        t.stunTurns = 0;
        this.emit({ type: 'status', uid: t.uid, text: '醒過來了' });
        this.noteDid(t, 'wake');
      }
      if (r.stunned && t.stunTurns === 0 && !resists(t, 'resistStun')) {
        t.stunTurns = skill.stunFor ?? this.rng.range(2, 4);
        this.emit({ type: 'status', uid: t.uid, text: '昏迷了！' });
      }
      exp += hitExp(r.damage, this.rng) + (counter ? counterExp(this.rng) : 0);
      if (t.side === 'player') this.gainExp(t, takenExp(r.damage, t.defending, this.rng), 'taken');
    }
    if (hits.length > 1) this.emit({ type: 'message', text: total > 0 ? `造成敵方總共 ${total} 點傷害。` : `${u.name}的攻擊落空了。` });
    if (u.side === 'player' && exp && u.alive) this.gainExp(u, exp, counter ? 'counter' : 'hit');
    if (counterBy && counterBy.alive && u.alive) this.cast(counterBy, attackSkill(counterBy, this.data), u, true);
  }

  /**
   * 劝酒（蒙汗药酒）【新】（杯酒救铁牛）：不掷命中、不伤人；目标喝下就麻翻（stunTurns），
   * 单位的 drink 设定可以推辞几次、只喝某些人劝的酒（李云只认徒弟朱富）、改麻翻的回合数。
   */
  private serveDrug(u: Unit, skill: SkillDef, targets: Unit[], area: Cell[], cell: Cell) {
    this.noteDid(u, 'skill');
    // 劝酒的台词轮着说（第几次劝酒按本关用过的劝酒技能数，倒流也一样）；劝有 drink 设定的人（李云）由剧本自己写台词
    const lines = this.toasts.get(u.uid);
    if (lines?.length && !targets.some((t) => this.drinks.has(t.uid))) {
      const n = (this.used[u.uid] ?? []).filter((id) => skillById(this.data, id)?.drug).length - 1;
      this.emit({ type: 'say', uid: u.uid, speaker: u.name, text: lines[Math.max(0, n) % lines.length] });
    }
    this.emit({ type: 'attack', uid: u.uid, skill, cell, area, facing: u.facing, hits: [], counter: false });
    if (skill.mpCost) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
    this.emit({ type: 'message', text: `${u.name}使出${this.tr(skill.name)}！` });
    let exp = 0;
    for (const t of targets) {
      const d = this.drinks.get(t.uid);
      const picky = !!d?.by?.length && !d.by.includes(u.classId);
      if (picky || (d && (this.refused[t.uid] ?? 0) < d.refuse)) {
        if (!picky) this.refused[t.uid] = (this.refused[t.uid] ?? 0) + 1;
        this.emit({ type: 'status', uid: t.uid, text: '推辭不飲' });
        this.noteDid(t, 'refuse');
        continue;
      }
      t.stunTurns = Math.max(t.stunTurns, d?.turns ?? skill.drug ?? 1);
      t.defending = false;
      this.drugged.add(t.uid);
      this.emit({ type: 'status', uid: t.uid, text: skill.drugText ?? '麻翻了！' });
      this.noteDid(t, 'drunk');
      if (u.side === 'player') exp += hitExp(Math.floor(t.stats.maxHp / 4), this.rng);
    }
    if (exp && u.alive) this.gainExp(u, exp, 'hit');
  }

  /** 酒席上动手【新】：被打的人身边 sight 格内有醒着的敌人（自己醒着也算），就惊动了（设上 banquet.flag） */
  private checkAlarm(targets: Unit[]) {
    const b = this.banquet!;
    const awake = this.active().filter((w) => w.side === 'enemy' && w.stunTurns === 0 && !this.spectators.has(w.uid));
    if (targets.some((t) => t.side === 'enemy' && awake.some((w) => dist(w, t) <= b.sight))) this.flags.add(b.flag);
  }

  /** dmgExp：击倒那一下的伤害经验，并入击倒经验一起按 65/35 分 */
  private kill(u: Unit, t: Unit, dmgExp = 0) {
    t.alive = false;
    t.defending = false;
    this.emit({ type: 'die', uid: t.uid });
    this.emit({ type: 'message', text: `${t.name}戰敗了。` });
    this.pendingDeaths.push(t.classId);
    if (this.royale) return this.royaleOut(t, u);
    if (u.side === 'player' && t.side === 'enemy') {
      const gold = killGold(t.classId, this.data, this.rng);
      if (gold) {
        u.gold += gold;
        this.emit({ type: 'message', text: `擊退了敵人，得到銀子 ${gold} 兩！` });
      }
    }
    if (u.side !== 'enemy' && t.side === 'enemy') {
      const total = killExp(u, t, this.rng) + dmgExp;
      this.gainExp(u, killerShare(total, u.side === 'player'), 'kill');
      this.teamExp += teamShare(total);
      this.tallyExp('team', teamShare(total));
    }
  }

  /** 按来源累计本关我方获得的经验（tools/sim-exp.ts 统计用；全队经验按入池时计） */
  expBySource: Partial<Record<ExpSource, { n: number; total: number }>> = {};
  private tallyExp(src: ExpSource, n: number) {
    if (!n) return;
    const e = (this.expBySource[src] ??= { n: 0, total: 0 });
    e.n++;
    e.total += n;
  }

  /** src 为 null 表示调用方已经自己统计过 */
  private gainExp(u: Unit, n: number, src: ExpSource | null) {
    // 吃鸡不涨经验：升级会回满体力，对 AI 不公平
    if (u.side !== 'player' || !n || this.royale) return;
    if (src) this.tallyExp(src, n);
    u.exp += n;
    while (u.exp >= expToNext(u.level)) {
      u.exp -= expToNext(u.level);
      u.level++;
      refreshStats(u, this.data);
      u.hp = u.stats.maxHp;
      u.mp = u.stats.maxMp;
      this.emit({ type: 'sound', name: 'm04' }); // 升级音（EXE 0x406990）
      this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0, text: '升級了！' });
      this.emit({ type: 'message', text: `${u.name}升級了！（Lv${u.level}）` });
      for (const s of skillsLearnedAt(u, this.data, u.level)) {
        const text = `${u.name}領悟了${this.tr(s.name)}！`;
        this.emit({ type: 'message', text });
        this.emit({ type: 'subtitle', text });
      }
    }
  }

  /**
   * 埋伏中的单位轮到行动（EXE AI 跳转表 0x407bac）：
   * 模式 6 用与模式 2 相同的检查（0x407dd0 + 0x407fa0：警戒半径内有敌人），成立就现身（0x408450，模式改为 0）并照常行动；
   * 警戒半径见 ai.ts alertRadius。模式 9 是等玩家号令，由我方阶段开始时的 ask 事件处理。
   */
  /** 战后结算全队经验：本关出过场的我方人物（含战败的）按注水式分配，先补落后的人。胜利时自动调用 */
  settleTeamExp() {
    const pool = this.teamExp;
    this.teamExp = 0;
    const team = this.units.filter((u) => u.side === 'player' && (u.present || !u.alive));
    if (!pool || !team.length) return;
    this.emit({ type: 'message', text: `全隊分得經驗 ${pool}。` });
    splitTeamExp(team, pool).forEach((n, i) => {
      if (!n) return;
      this.emit({ type: 'message', text: `${team[i].name}得到經驗 ${n}。` });
      this.gainExp(team[i], n, null);
    });
  }

  /**
   * poolLeftoverExp【新】（负责人 2026-11-20）：不用打光敌人就能过关的关，过关时还没打倒的敌人（在场、埋伏中、收手或归顺了但没人拿到经验的；
   * 还没登场的增援不算）按击败经验整份放进全队经验，随后一起分掉
   */
  private poolLeftover() {
    const ref = this.units.find((u) => u.side === 'player');
    if (!ref) return;
    let sum = 0;
    for (const u of this.units) {
      if (!this.foesAtStart.has(u.uid) || !u.alive || this.credited.has(u.uid) || !(u.present || this.ambushers.has(u.uid))) continue;
      sum += killExp(ref, u, this.rng);
    }
    if (!sum) return;
    this.teamExp += sum;
    this.tallyExp('team', sum);
    this.emit({ type: 'message', text: `其餘敵人的經驗 ${sum} 併入全隊經驗。` });
  }

  private ambushTurn(u: Unit) {
    if (u.ai.mode !== 6) return void (u.ended = true);
    const r = alertRadius(this, u);
    if (!this.aiFoesOf(u).some((t) => Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= r)) return void (u.ended = true);
    u.ai.mode = 0;
    this.appear(u);
    u.ended = false;
    this.runAi(u);
  }

  /** 是否有等待号令的伏兵（AI 模式 9） */
  get awaitingSignal() {
    return this.status === 'playing' && this.units.some((u) => u.alive && u.side !== 'enemy' && u.ai.mode === 9);
  }

  /**
   * 伏兵号令（选"好！大家上！"，EXE 0x40de20）：我方与友军的隐藏、埋伏单位全部登场，AI 模式都改为 0；
   * 然后执行 w8 = 2 的区块（N-add03 "有埋伏！"，推测）。
   */
  signal(): BattleEvent[] {
    this.out = [];
    if (!this.awaitingSignal) return [];
    for (const u of this.units) {
      if (u.side === 'enemy' || !u.alive) continue;
      if (!u.present) {
        this.appear(u);
        u.ended = false;
      }
      u.ai.mode = 0;
    }
    for (const b of this.blocks) if (b.trigger.kind === 'signal' && b.trigger.type === 2) this.runBlock(b);
    this.afterAction();
    return this.flush();
  }

  /** 试打工具：我方回合里让 AI 替这个人行动（好汉聚义用吃鸡 AI） */
  aiAct(u: Unit): BattleEvent[] {
    this.out = [];
    if (!this.canAct(u) || u.acted) return [];
    this.runAi(u);
    return this.flush();
  }

  private runAi(u: Unit) {
    // 吃鸡：吃药不算行动，吃完照样走、打（AI 单独一套，要跑圈）
    if (this.royale) {
      const slot = royaleHealSlot(this, u);
      if (slot >= 0) this.applyItem(u, slot);
    }
    const plan = this.royale ? planRoyale(this, u) : planAi(this, u);
    if (plan.healSlot !== undefined) {
      this.applyItem(u, plan.healSlot);
    } else {
      if (plan.path && plan.path.length > 1) {
        // 路程超过移动力就是强行军（跟随型 AI 才会这样走）
        if (plan.path.length - 1 > u.stats.move) u.forcedMarch = true;
        this.walk(u, plan.path);
        this.afterAction();
      }
      if (this.status === 'playing' && plan.skill && plan.cell && u.alive && u.mp >= plan.skill.mpCost) {
        const ok = this.skillCells(u, plan.skill).some((c) => c.x === plan.cell!.x && c.y === plan.cell!.y);
        if (ok && this.affected(u, plan.skill, plan.cell).length) this.cast(u, plan.skill, plan.cell, false);
      }
      if (this.status === 'playing' && plan.rest && u.alive) this.applyRest(u);
    }
    u.ended = true;
    this.afterAction();
  }

  // ───────────── 事件与胜负 ─────────────

  private afterAction() {
    if (this.status !== 'playing') return;
    if (this.royale && this.royaleEnd()) return;
    while (this.pendingDeaths.length) {
      const c = this.pendingDeaths.shift()!;
      // 每倒下一次只执行一个还没执行过的区块：Train1/2 有 25 个"王進死亡"区块，每次被打倒说一句、换下一个分身上场
      // （原版 0x412000 每次只执行一个条件成立的区块，执行后分身已登场，下一个区块的条件就不成立了）
      const b = this.blocks.find(
        (x) => x.trigger.kind === 'death' && !this.fired.has(x.index) && (x.trigger.char === c || (x.trigger.char === 1000 && c === 0)),
      );
      if (b) this.runBlock(b);
      if (this.status !== 'playing') return;
      if (c === this.tune?.rushOnDeath) this.rushWaves();
      if (this.status !== 'playing') return;
    }
    // 角色号 255：敌方全灭（推测：只在全灭时出现，如 N-add01 的胜利区块）。
    // clearAllWaves 的关卡【新】：还没登场的回合增援也要打倒，增援没出完不算全灭（N14）
    if (!this.units.some((u) => u.side === 'enemy' && u.alive && u.present) && !(this.tune?.clearAllWaves && this.pendingWaves().length))
      for (const b of this.blocks) if (b.trigger.kind === 'death' && b.trigger.char === 255) this.runBlock(b);
    if (this.status !== 'playing') return;
    this.checkSpotted();
    if (this.status !== 'playing') return;
    this.checkSeers();
    if (this.status !== 'playing') return;
    this.checkDid();
    if (this.status !== 'playing') return;
    // 扩展包：出手之后的触发（用过某几招 / 出手满几次）
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'used' || this.fired.has(b.index)) continue;
      const u = this.units.find((x) => x.classId === t.char && x.alive);
      const list = u ? (this.used[u.uid] ?? []) : [];
      if (u && (t.skills ? t.skills.every((s) => list.includes(s)) : list.length >= (t.count ?? 1))) this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'area' || this.fired.has(b.index)) continue;
      if (t.flagged && !this.flagsOk(b)) continue;
      const who = this.areaHit(t);
      if (t.atTurnEnd) {
        // 回合结束才生效的区域：我方回合里走进去先在头上提示一次（每回合每个区块一次）【新】
        const key = `${b.index}:${this.turn}`;
        if (who && who.side === 'player' && this.phase === 'player' && !this.areaHinted.has(key)) {
          this.areaHinted.add(key);
          this.emit({ type: 'status', uid: who.uid, text: AREA_HINT });
        }
        continue;
      }
      if (who) this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    if (!this.checkNear()) return;
    // 扩展包：某人生命低于一定比例【新】
    let hpFired = false;
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'hp' || this.fired.has(b.index)) continue;
      const who = this.units.find((u) => (t.uid !== undefined ? u.uid === t.uid : u.classId === t.char) && u.alive && u.present);
      if (who && who.hp * 100 < who.stats.maxHp * t.below && this.flagsOk(b)) {
        this.runBlock(b);
        hpFired = true;
      }
      if (this.status !== 'playing') return;
    }
    // 体力区块刚设了标志（山径收草寇：头领伤重才能劝降），身边的人不用再动一下就能触发【新】
    if (hpFired && !this.checkNear()) return;
    this.runCondBlocks();
    if (this.status !== 'playing') return;
    // 选人关没被选上的人这一关不再登场，不算
    if (this.hadPlayers && !this.royale && !this.units.some((u) => u.side === 'player' && u.alive && !this.benched.has(u.uid)))
      this.finish('lost', '我方全軍覆沒。');
  }

  /**
   * 区域触发（区块头 w0 = 4：选人 且 坐标范围）里进了范围的人，没有就 undefined。原版条件 4 只选单位表里这个角色的第一个单位
   * （EXE 0x410ff0 → 0x40c360，不论死活），所以 N-add03 往 (10,0) 逃的那个嘍囉（不是第一个）跑到出口也不算。重制版【新】：这个角色
   * 任何一个在场的人进了范围都触发（只影响 N-add03"敵人從畫面端逃跑"；其它关只有一个这样的人：N01 王母、N13 何濤、N-add16 主角）。
   * side：这一方任何一个能动的人；chars：这几个人都得进去（返回最后一个）。
   */
  private areaHit(t: Extract<PasTrigger, { kind: 'area' }>): Unit | undefined {
    const cellIn = (c: Cell) => c.x >= Math.min(t.x1, t.x2) && c.x <= Math.max(t.x1, t.x2) && c.y >= Math.min(t.y1, t.y2) && c.y <= Math.max(t.y1, t.y2);
    // pass【新】：刚走的这一步路过区域里任何一格也算（射虎：大虫路过窝弓就中箭）
    const inside = (u: Unit) => cellIn(u) || (!!t.pass && this.passed?.uid === u.uid && this.passed.path.some(cellIn));
    if (t.side) return this.units.find((u) => u.side === t.side && u.alive && u.present && !this.spectators.has(u.uid) && !this.isBound(u) && inside(u));
    if (t.chars) {
      let last: Unit | undefined;
      for (const c of t.chars) {
        last = this.units.find((u) => u.classId === c && u.alive && u.present && inside(u));
        if (!last) return undefined;
      }
      return last;
    }
    const id = t.char === 1000 ? 0 : t.char;
    return this.units.find((u) => u.classId === id && u.alive && u.present && inside(u));
  }

  /** 走到某人身边的触发；返回 false 表示已经分出胜负 */
  private checkNear(turnEnd = false): boolean {
    // 扩展包：任一我方单位走到某人身边（劫法场走过去松绑）
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'near' || this.fired.has(b.index)) continue;
      // atTurnEnd【新】：只在回合结束时看（turnEnd = true 的那一遍只看这种）
      if (!!t.atTurnEnd !== turnEnd) {
        if (!t.atTurnEnd) continue;
      } else if (t.playerPhase && this.phase !== 'player') continue;
      const who = this.units.find((u) => (t.uid !== undefined ? u.uid === t.uid : u.classId === t.char) && u.alive && u.present);
      const by = who && this.units.find((u) => u !== who && u.side === 'player' && (t.by === undefined || u.classId === t.by) && u.alive && u.present && !this.isBound(u) && dist(u, who) >= 1 && dist(u, who) <= (t.range ?? 1));
      if (by && t.atTurnEnd && !turnEnd) {
        // 我方回合里走到身边先提示一次（每回合每个区块一次）
        const key = `${b.index}:${this.turn}`;
        if (this.phase === 'player' && !this.areaHinted.has(key) && this.flagsOk(b)) {
          this.areaHinted.add(key);
          this.emit({ type: 'status', uid: by.uid, text: AREA_HINT });
        }
        continue;
      }
      if (by && this.flagsOk(b)) this.runBlock(b);
      if (this.status !== 'playing') return false;
    }
    return true;
  }

  /** map.seal 封死的格子和现在开没开（画面据此显示 / 隐藏门板） */
  sealState(): { x: number; y: number; tile?: number; open: boolean }[] {
    return [...this.sealed, ...this.trapSeals].map((c) => ({ ...c, open: this.unsealed.has(c.y * this.board.width + c.x) }));
  }

  private runTurnTriggers(param: number) {
    this.turnEndCheck = true;
    try {
      this.turnTriggers(param);
    } finally {
      this.turnEndCheck = false;
    }
  }

  private turnTriggers(param: number) {
    this.turnParam = param;
    // 区域触发 atTurnEnd【新】（智赚二龙山，负责人 2026-11-20；2026-11-21 推广到撤退、好汉登场等关）：回合结束才看人到没到，
    // 下回合开始时大家一起行动。条件树里的坐标判断（N12 晁盖撤退）由 cond 区块的 atTurnEnd 管，见 evalCond 的条件 4
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'area' || !t.atTurnEnd || this.fired.has(b.index) || (t.flagged && !this.flagsOk(b))) continue;
      if (this.areaHit(t)) this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    if (!this.checkNear(true)) return;
    for (const b of this.blocks) {
      if (b.trigger.kind !== 'turn' || this.status !== 'playing') continue;
      // 回合 −1【新】：第 2 回合起任何一回合开始时，标志满足就执行（叫阵晁家庄：教头认输后，下一回合开始接着比下一阵）
      const at = b.trigger.turn === -1 && b.trigger.flagged ? param > 0 : (this.turnAt[b.index] ?? b.trigger.turn) === param;
      if (at && (!b.trigger.flagged || this.flagsOk(b))) this.runBlock(b);
    }
    this.runCondBlocks();
  }

  /** 还没执行的回合增援区块（回合触发、点名放人、不判胜负），按（可能提前了的）回合先后排 */
  private pendingWaves(): PasBlock[] {
    const at = (b: PasBlock) => this.turnAt[b.index] ?? (b.trigger.kind === 'turn' ? b.trigger.turn : 0);
    return this.blocks
      .filter((b) => b.trigger.kind === 'turn' && b.trigger.turn > 0 && !this.fired.has(b.index))
      .filter((b) => b.ops.some((o) => o.op === 12) && !b.ops.some((o) => o.op === 29 || o.op === 30))
      .sort((a, b) => at(a) - at(b) || a.index - b.index);
  }

  /**
   * stage-tune 的 rushOnDeath【新】（负责人 2026-11-15，N14 王倫）：那人倒下时下一波增援马上登场，
   * 再下一波在下一回合开始时登场，依此类推；本来就更早的不推后。
   */
  private rushWaves() {
    const [first, ...rest] = this.pendingWaves();
    if (!first) return;
    rest.forEach((b, i) => {
      const at = this.turnAt[b.index] ?? (b.trigger.kind === 'turn' ? b.trigger.turn : 0);
      this.turnAt[b.index] = Math.min(at, this.turn + i);
    });
    this.runBlock(first);
  }

  /** 记下刚做的操作，等 checkDid 判 did 触发（只记剧本里用得到的人，免得队列白长） */
  private noteDid(u: Unit, action: DidAction) {
    if (this.blocks.some((b) => b.trigger.kind === 'did' && !this.fired.has(b.index))) this.didQueue.push({ uid: u.uid, action });
  }

  /**
   * did 触发（教学关，§15.26）：按做的先后，每个操作执行配得上的、还没执行过、标志满足的区块。
   * 只判刚做的操作：判完就清空，所以先做了某个操作、后来才设上标志的不算。
   */
  private checkDid() {
    while (this.didQueue.length && this.status === 'playing') {
      const { uid, action } = this.didQueue.shift()!;
      const u = this.unit(uid);
      if (!u) continue;
      for (const b of this.blocks) {
        const t = b.trigger;
        if (t.kind !== 'did' || t.action !== action || this.fired.has(b.index)) continue;
        if (t.uid !== undefined ? t.uid !== uid : t.char !== u.classId) continue;
        if (!this.flagsOk(b)) continue;
        // 教学提示（did 区块）只是讲解刚做的操作，说话、旁白不锁撤销移动；真改了局面（登场、退场……）的照样锁
        this.teaching = true;
        try {
          this.runBlock(b);
        } finally {
          this.teaching = false;
        }
        if (this.status !== 'playing') break;
      }
    }
    this.didQueue = [];
  }

  /** 组合条件等其它区块：状态满足就执行（EXE 0x412000 逐块调用 0x411410 求值） */
  /** near / hp 区块的 if / unless 标志（没写时条件是默认的 {type 0}，不判） */
  /** 比武点到为止【新】：这人有还没执行、标志也满足的 spare 体力区块，挨打至少留 1 点体力（区块随后照常触发认输） */
  private spared(t: Unit): boolean {
    return this.blocks.some((b) => {
      const g = b.trigger;
      return g.kind === 'hp' && !!g.spare && !this.fired.has(b.index) && (g.uid !== undefined ? g.uid === t.uid : g.char === t.classId) && this.flagsOk(b);
    });
  }

  private flagsOk(b: PasBlock): boolean {
    const c = b.cond;
    if (!('op' in c) && c.type !== 100 && c.type !== 101) return true;
    let sel: Unit | undefined;
    return this.evalCond(c, (u) => (sel = u), () => sel);
  }

  /** AI 13 巡逻的路线【新】 */
  patrolOf(u: Unit): readonly { x: number; y: number }[] | undefined {
    return this.patrols.get(u.uid);
  }

  /** 还在警戒的哨兵（活着、在场、没被发现过的敌人）和他们的警戒半径，画面上画警戒范围用【新】 */
  watchZones(): { uid: number; x: number; y: number; facing: number; r: number; spotted: boolean }[] {
    if (this.status !== 'playing') return [];
    // 看得穿伪装的人（劫牢的包节级）：还有人伪装着就画他的视线【新】
    const seers = this.units.some((t) => t.disguised && t.alive && t.present)
      ? [...this.seers].flatMap(([uid, r]) => {
          const w = this.units[uid];
          return w && w.alive && w.present && w.side === 'enemy' && !(w.stunTurns > 0) ? [{ uid, x: w.x, y: w.y, facing: w.facing, r, spotted: false }] : [];
        })
      : [];
    if (this.stealthOver) return seers;
    return [...this.watchers].flatMap(([uid, r]) => {
      const w = this.units[uid];
      return w && w.alive && w.present && w.side === 'enemy' ? [{ uid, x: w.x, y: w.y, facing: w.facing, r, spotted: uid in this.spotters }] : [];
    }).concat(seers);
  }

  /** 去掉伪装【新】：text = 飘的字（空串不飘）；被识破（不是剧本去掉）时设上关卡的 disguise.flag 并判条件区块 */
  private unmask(u: Unit, text: string, reveal = true) {
    if (!u.disguised) return;
    u.disguised = false;
    this.lockUndo();
    if (text) this.emit({ type: 'status', uid: u.uid, text });
    if (reveal && this.disguiseFlag !== undefined && !this.flags.has(this.disguiseFlag)) {
      this.flags.add(this.disguiseFlag);
      this.runCondBlocks();
    }
  }

  /** 看得穿伪装的人（劫牢的包节级）正前方警戒半径里有伪装的人（他认得的不算）就识破【新】 */
  private checkSeers() {
    for (const [uid, r] of this.seers) {
      const w = this.unit(uid);
      if (!w || !w.alive || !w.present || w.side !== 'enemy' || w.stunTurns > 0) continue;
      for (const t of this.active()) {
        if (!t.disguised || this.watchTrust.get(uid)?.includes(t.classId) || !watcherSees(w, t, r)) continue;
        this.emit({ type: 'say', uid, speaker: w.name, text: '且慢！你是什么人？' });
        this.unmask(t, '识破');
        if (this.status !== 'playing') return;
      }
    }
  }

  /** 剧本把伪装的人现出原形（op 130）或扮上（op 131）【新】；all = 全部伪装的人 */
  scriptDisguise(on: boolean, u?: Unit, quiet = false) {
    if (!on) {
      for (const t of u ? [u] : this.units.filter((x) => x.disguised)) this.unmask(t, quiet ? '' : '现出原形', false);
      return;
    }
    if (u && !u.disguised) {
      u.disguised = true;
      if (!quiet) this.emit({ type: 'status', uid: u.uid, text: '伪装' });
    }
  }

  /**
   * 潜行关【新】：哨兵（活着、在场、没被打昏的敌人）正前方警戒半径内（watcherSees）有我方或友军的人，或者他挨了打，就被发现。发现的人喊起来、转为出战（AI 0），
   * 要在下个我方回合结束前打倒他（见 endPlayerPhase）。
   */
  private checkSpotted() {
    if (this.stealthOver) return;
    for (const [uid, r] of this.watchers) {
      const w = this.units[uid];
      if (!w || uid in this.spotters || !w.alive || !w.present || w.side !== 'enemy' || w.stunTurns > 0) continue;
      // 张千、李万这样跟着走的友军进了范围也算（负责人 2026-11-19）
      const seen = this.units.find(
        (t) => (t.side === 'player' || t.side === 'ally') && t.alive && t.present && !this.spectators.has(t.uid) && !this.watchTrust.get(uid)?.includes(t.classId) && watcherSees(w, t, r),
      );
      // 盘问【新】：认得的人走进会盘问的哨兵眼前，拦下问话。我方回合：这回合剩下的行动作废；
      // 敌方回合（巡逻的走过来看见他）：下个我方回合整回合动不了（负责人 2026-11-23）
      if (!seen && w.hp >= w.stats.maxHp && this.watchQuestion.has(uid)) {
        const asked = this.units.find(
          (t) => t.side === 'player' && t.alive && t.present && this.watchTrust.get(uid)?.includes(t.classId) && this.mayQuestion(uid, t.uid) && watcherSees(w, t, r),
        );
        if (asked) {
          this.questioned.set(`${uid}:${asked.uid}`, this.turn);
          this.lockUndo();
          if (this.phase === 'player') {
            asked.acted = true;
            asked.ended = true;
            asked.movementRemaining = 0;
          } else asked.stunTurns = Math.max(asked.stunTurns, 2); // 回合开始减 1，剩 1 → 下个我方回合跳过
          this.emit({ type: 'status', uid: asked.uid, text: '盘问' });
          this.emit({ type: 'say', uid, speaker: w.name, text: QUESTIONS[(this.turn + uid) % QUESTIONS.length] });
        }
      }
      // 挨了打也就惊醒了（偷袭没一下打倒，他照样喊）
      if (!seen && w.hp >= w.stats.maxHp) continue;
      this.spotters[uid] = this.turn + 1;
      this.lockUndo();
      w.unaware = false;
      w.ai.mode = 0;
      this.emit({ type: 'status', uid, text: '发现' });
      this.emit({ type: 'say', uid, speaker: w.name, text: this.phase === 'player' ? '有贼！快来人——' : '甚么人在那里？！' });
      if (this.stealth?.flag) {
        this.flags.add(this.stealth.flag);
        this.runCondBlocks();
      }
    }
  }

  private runCondBlocks() {
    for (const b of this.blocks) {
      if (this.status !== 'playing') return;
      if (b.trigger.kind !== 'cond' || this.fired.has(b.index)) continue;
      let sel: Unit | undefined;
      this.condAtTurnEnd = !!b.trigger.atTurnEnd;
      const ok = this.evalCond(b.cond, (u) => (sel = u), () => sel);
      this.condAtTurnEnd = false;
      if (ok) this.runBlock(b);
    }
  }

  /**
   * 条件求值（EXE 0x411220）。0 回合；1 死亡（0x400 = 我方全灭、0xFF = 敌方全灭）；2 某人已现身；3 指令 27 的标志；
   * 4 选定某人（之后 5–10 比较他的坐标：5 x =、6 y =、7 x ≥、8 y ≥、9 x ≤、10 y ≤）；11 某人活着（0xFF = 我方无人阵亡）。
   * 角色号 ≥ 1000 时为 角色号 − 1000，且不论是否隐藏；< 1000 时隐藏的人算不在。
   * "隐藏"只指退场标志 0x20000（EXE 0x411020 只看这一位）：埋伏中的单位（0x40000，AI 模式 6/9）虽然不在地图上，
   * 也算在。N12 的朱仝开场就被剧本改成埋伏，以前被当成"已死"，一开场就过关；N02 的"所有嘍囉死亡"也会漏算埋伏的嘍囉。
   */
  private evalCond(c: PasCond, select: (u: Unit | undefined) => void, selected: () => Unit | undefined): boolean {
    if ('op' in c) {
      const a = this.evalCond(c.a, select, selected), b = this.evalCond(c.b, select, selected);
      return c.op === 'and' ? a && b : a || b;
    }
    const find = (arg: number) => {
      const id = arg >= 1000 ? arg - 1000 : arg;
      return this.units.find((u) => u.classId === id && u.alive && (arg >= 1000 || u.present || this.ambushers.has(u.uid)));
    };
    const s = selected();
    switch (c.type) {
      case 0:
        return this.turnParam === c.arg;
      // 100 / 101：扩展包剧本标志已设上 / 还没设（指令 103）【新】
      case 100:
        return this.flags.has(c.arg);
      case 101:
        return !this.flags.has(c.arg);
      // 103：编号 arg 的那个人已经倒下（智赚二龙山：打倒山门头领）【新】
      case 103:
        return !!this.units.find((u) => u.uid === c.arg && !u.alive);
      // 扩展包全敌战败：尚未登场的隐藏增援也必须打倒。
      case 102:
        return !this.units.some(u => u.side === 'enemy' && u.alive);
      case 1:
        // 我方全灭（EXE 0x4111d0 → 0x408380）：只数在场的我方，退场（0x20000）、埋伏（0x40000）的不算。
        // 训练关选人后其余人退场，所以出场的人被打倒就是"全灭"，触发"回合 25 或我方全灭"的过关区块
        if (c.arg === 0x400) return !this.units.some((u) => u.side === 'player' && u.alive && u.present);
        if (c.arg === 0xff) return !this.units.some((u) => u.side === 'enemy' && u.alive && u.present);
        // 0xfe【新】（杯酒救铁牛）：被蒙汗药麻翻、还睡着的敌人不算
        if (c.arg === 0xfe) return !this.units.some((u) => u.side === 'enemy' && u.alive && u.present && !(this.drugged.has(u.uid) && u.stunTurns > 0));
        return !find(c.arg);
      case 2:
        return false; // 伏兵号令后由 signal() 执行（推测）
      case 3:
        return this.scriptFlag === (c.arg === 1);
      case 4: {
        // cond 区块写了 atTurnEnd【新】：坐标判断只在回合结束时算（N12 晁盖撤退）
        if (this.condAtTurnEnd && !this.turnEndCheck) return false;
        const u = this.unitByChar(c.arg);
        select(u);
        return !!u;
      }
      case 5:
        return !!s && s.x === c.arg;
      case 6:
        return !!s && s.y === c.arg;
      case 7:
        return !!s && s.x >= c.arg;
      case 8:
        return !!s && s.y >= c.arg;
      case 9:
        return !!s && s.x <= c.arg;
      case 10:
        return !!s && s.y <= c.arg;
      case 11:
        if (c.arg === 0xff) return !this.units.some((u) => u.side === 'player' && !u.alive);
        return !!find(c.arg);
    }
    return false;
  }

  /**
   * 胜利条件后面的提示【新】：原版文字没说清楚怎么达成、实际只看回合数的关卡，补一句第几回合。
   * N13「引诱何涛深入蓼儿洼」：区块 2 只有条件「回合 = 10」（没有坐标判断），第 11 回合开始时伏兵登场、胜利条件换成打败所有敌人。
   */
  private objectiveHint(b: PasBlock): string {
    if (!(TURN_HINT_STAGES as readonly string[]).includes(this.name.toUpperCase())) return '';
    const next = this.blocks.find(
      (x) => x.index > b.index && x.trigger.kind === 'turn' && x.trigger.turn > 0 && x.ops.some((o) => o.op === 32),
    );
    if (!next || next.trigger.kind !== 'turn') return '';
    return this.tr(`（堅持到第 ${next.trigger.turn + 1} 回合，伏兵出現）`);
  }

  /**
   * 执行一个 PAS 区块（指令 12–21 由 EXE 0x411690 分派）：12 选人（隐藏的随之登场）、13 说话、14/15 坐标、16 AI 模式、
   * 17 动作（见下）、29 过关旁白（区块结束后判胜）、30 失败结局、31–33 条件、35 回合限制。28 = 区块结束（0x411cf9）。
   */
  private runBlock(b: PasBlock) {
    if (this.fired.has(b.index)) return;
    this.scriptDepth++;
    try {
      this.runBlockOps(b);
    } finally {
      this.scriptDepth--;
    }
  }

  private runBlockOps(b: PasBlock) {
    this.fired.add(b.index);
    if (!this.teaching) this.lockUndo();
    const textOf = (i: number) => {
      const orig = b.ops[i].text ?? '';
      let t = orig;
      // rushOnDeath 那人已倒下才来的增援：换掉喊"谁敢动我大哥"之类的对白
      const rt = this.tune?.rushText;
      if (rt && this.units.some((u) => u.classId === this.tune!.rushOnDeath && !u.alive)) t = rt[this.tr(t)] ?? t;
      // EXE 0x4106b4：%N、%X = 主角名（名字表第 0 项），%M = 主角绰号（绰号表第 0 项）
      const zh = t.replace(/%[NX]/g, this.data.heroName).replace(/%M/g, this.data.heroNickname ?? '');
      // 多语言：带上这句的编号，显示时查译文（换过的增援台词没有编号）
      return t === orig ? markLine(b.ops[i].tid, zh) : zh;
    };
    let sel: Unit | undefined;
    let selName = '';
    let px = 0, py = 0;
    let mode = 0;
    let ending: string | null = null;
    let cleared = false;
    let objective: string[] = [];
    let quietGold = 0;
    // 一起收手（quiet）的经验和银子等这串收手指令跑完再给：升级字幕之类别插在退场中间，画面才能一次淡出
    let quietExp: [Unit, number][] = [];
    const flushQuiet = () => {
      for (const [u, n] of quietExp) this.gainExp(u, n, 'kill');
      quietExp = [];
      if (quietGold) this.emit({ type: 'message', text: `收手的敵人一共交出銀子 ${quietGold} 兩。` });
      quietGold = 0;
    };
    const flushObjective = () => {
      if (objective.length) {
        this.objectives = objective;
        this.emit({ type: 'objective', lines: objective });
        objective = [];
      }
    };
    b.ops.forEach((op, i) => {
      if (op.op < 31 || op.op > 33) flushObjective();
      if (op.op !== 12 && op.op !== 121) flushQuiet();
      switch (op.op) {
        case 12:
          // 1001 起为 1000 + ACT 编组号（N-add03 开场 1006 = 王進下令、1007/1008 = 莊客应答；N03 第 11 回合 1030–1037 = 编组 30–37 的伏兵）
          if (op.value > 1000 && op.value < 0x10000) sel = this.unit(this.groups.get(op.value - 1000) ?? -1);
          // args.side / stunned【新】（智赚二龙山倒戈、混乱时喽啰喊话）：只挑这一方在场的、还呆着的人，nth 挑第几个；没有就只剩名字没人
          else if (op.value <= 1000) {
            const a = op.args;
            const hits = this.units.filter(
              (u) => u.classId === (op.value === 1000 ? 0 : op.value) && (u.alive || !!op.actor) &&
                (!a?.side || (u.side === a.side && u.alive && u.present)) && (!a?.stunned || u.stunTurns > 0),
            );
            sel = hits[Math.min(a?.nth ?? 0, hits.length - 1)]; // nth：换个人说（只有一个时还是他）
          }
          else sel = undefined; // 0xFFFFFFFF：旁白
          selName = sel ? sel.name : op.value <= 1000 ? this.charName(op.value) : '';
          if (sel && op.actor?.action === 'show') {
            if (sel.present && sel.alive) break; // 本来就在场：不挪位置
            // near 也可以是只在对白里露面（show）的人（夜走东溪村：朱仝站到雷横旁边）【新】
            const shownNear = [...this.shown].map(([uid, c]) => ({ u: this.units.find((x) => x.uid === uid)!, c })).find(({ u }) => u.classId === op.actor!.near)?.c;
            const near = this.active().find(u => u.classId === op.actor!.near) ?? shownNear ?? sel;
            const taken = this.occupied();
            for (const c of this.shown.values()) taken.add(key(c.x, c.y));
            const at = this.board.nearestFree(near.x, near.y, taken) ?? sel;
            this.shown.set(sel.uid, { x: at.x, y: at.y });
            // 只发画面事件：不改alive/present/体力、掉落或经验，战败不会被撤销。
            this.emit({ type: 'appear', uid: sel.uid, x: at.x, y: at.y, ambush: false });
          } else if (sel && op.actor?.action === 'hide') {
            this.shown.delete(sel.uid);
            this.emit({ type: 'leave', uid: sel.uid });
          }
          // 被点名的隐藏人物随之登场（EXE 0x41154b：标志 0x20000 时调用 0x408430），埋伏中的不受影响
          if (sel && !op.quiet && !sel.present && sel.alive && !this.ambushers.has(sel.uid)) {
            // args.toward【新】（火烧祝家店：挠钩手钩走时迁）：登场在这个人身边，不在自己的开场格
            const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
            if (t?.present) (sel.x = t.x), (sel.y = t.y);
            this.appear(sel);
          }
          break;
        case 13:
          this.emit({ type: 'say', uid: sel?.uid ?? null, speaker: selName, text: textOf(i) });
          break;
        case 14:
          px = op.value;
          break;
        case 15:
          py = op.value;
          break;
        case 16:
          mode = op.value;
          break;
        case 17: {
          // 动作位（EXE 0x411580，按这个顺序）：8 改 AI 模式；4 设 AI 目标点；0x10 设 AI 目标角色；2 退场；1 走到 (14, 15)
          if (!sel || !sel.alive) break;
          // args.awake【新】（杯酒救铁牛）：只对醒着的人（没被麻翻、没昏迷）
          if (op.args?.awake && sel.stunTurns > 0) break;
          const v = op.value;
          if (v & 8) {
            sel.ai.mode = mode;
            if (mode === 7) {
              sel.ai.mode = 0;
              if (sel.present) this.hide(sel, false);
            } else if (mode === 6 || mode === 9) {
              if (sel.present) this.hide(sel, true);
              else this.ambushers.add(sel.uid);
            }
          }
          if (v & 4) sel.ai.point = { x: px, y: py };
          if (v & 0x10) sel.ai.target = px;
          if (v & 2) {
            if (sel.present) this.hide(sel, false);
          } else if (v & 1 && sel.present) {
            const reach = this.reachOf(sel, 99);
            const path = reach.has(key(px, py)) ? pathTo(reach, px, py) : [];
            if (path.length > 1) this.walk(sel, path, true);
          }
          break;
        }
        // 18/19：换背景音乐（EXE 0x411710 → 0x423970：曲目号经 0x447cb3 表映射，交给 0x448768 播放器；18 的值一并传入，推测为是否循环）。重制版用自己的配乐，忽略
        // 27：值为 1 时置全局标志（EXE 0x411d38），出现在 N-add15"請選擇留下的人"和训练关开场的末尾，推测是打开选人界面、
        // 选完后清掉标志，于是条件 3（参数 0）的下一个区块（回合限制、条件文字）才执行。重制版还没有选人界面，视为立即选完
        case 27:
          if (op.value === 1) this.openPick(b, i, textOf, op.args);
          break;
        // 21：播放音效，名字在载荷里（全部是 m08"某某加入了"；EXE 0x411748）。20 的载荷是 0x01，推测为播放标志
        case 21:
          if (op.text) this.emit({ type: 'sound', name: op.text });
          break;
        case 29:
          this.emit({ type: 'sound', name: 'm12' }); // 过关音（EXE 0x4117d0）
          this.emit({ type: 'narrate', text: textOf(i) });
          cleared = true;
          break;
        case 30:
          this.emit({ type: 'sound', name: 'm05' }); // 失败音（EXE 0x411a90）
          ending = textOf(i);
          break;
        case 31:
        case 33:
          objective.push(textOf(i));
          break;
        case 32:
          objective.push(textOf(i) + this.objectiveHint(b));
          break;
        case 35:
          this.turnLimit = op.value & 0xffff;
          break;
        // 100 起：扩展包的新指令【新】（src/packs/script.ts）
        // 100 换装备：flag = 格号（0 武器、1 衣服、2 头饰），value = 道具号，0 = 卸掉（武松的哨棒折断）
        case 107:
          if (sel) {
            const slot = op.flag ?? 0;
            sel.storyGear ??= {};
            sel.storyGear[slot] ??= { item: sel.slots[slot], forge: sel.forge[slot] ?? 0 };
          }
          // fall through: change this battle’s gear, keeping the original for settlement
        case 100:
          if (!sel) break;
          sel.slots[op.flag ?? 0] = op.value;
          sel.forge[op.flag ?? 0] = 0;
          refreshStats(sel, this.data);
          this.emit({ type: 'hp', uid: sel.uid, hp: sel.hp, mp: sel.mp, delta: 0 });
          break;
        // 108–113 剧情演出（扩展包【新】，挑帘裁衣等纯剧情关）：只改朝向或放画面，不动血量、位置和胜负
        // 108 转身：value = 朝向 0–3，或 args.toward = 朝向某个编组的人
        case 108: {
          if (!sel || !sel.present) break;
          const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
          sel.facing = t ? facingTowards(sel, t, sel.facing) : op.value & 3;
          this.emit({ type: 'face', uid: sel.uid, facing: sel.facing });
          break;
        }
        // 109 做一个动作（出手、受击、防御），args.toward 先转向那人
        case 109: {
          if (!sel || !sel.present) break;
          const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
          if (t) sel.facing = facingTowards(sel, t, sel.facing);
          const action = op.args?.action === 'hurt' || op.args?.action === 'defend' ? op.args.action : 'attack';
          this.emit({ type: 'act', uid: sel.uid, action, facing: sel.facing });
          break;
        }
        // 拔树在规则层同步清除占格，演出由场景完成；不修改原地图资源。
        case 118: {
          const cells = (op.args?.cells ?? []).filter(c=>this.board.inBounds(c.x,c.y));
          for (const c of cells) this.board.blocked[c.y*this.board.width+c.x]=0;
          this.emit({type:'uproot',cells});
          break;
        }
        case 119:
          if(sel?.present&&sel.alive)this.emit({type:'flourish',uid:sel.uid,facing:sel.facing});
          break;
        // 117 剧情射箭：仅记录演出，不走战斗攻击、耗气或经验结算。
        case 117: {
          if (!sel?.present || !sel.alive) break;
          const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
          if (op.args?.toward !== undefined && (!t?.present || !t.alive)) break;
          const x = t?.x ?? op.args?.x ?? -1, y = t?.y ?? op.args?.y ?? -1;
          if (!this.board.inBounds(x, y)) break;
          sel.facing = facingTowards(sel, { x, y }, sel.facing);
          this.emit({ type: 'shot', uid: sel.uid, x, y, facing: sel.facing, target: t?.uid, text: op.text ?? '' });
          break;
        }
        // 110 换天色（text = night / dusk / snow，空 = 恢复白天）
        case 110:
          this.emit({ type: 'tint', tint: op.text ?? '' });
          break;
        // 111 场景字幕（画面中间的大字，如「次日」「当夜」）
        case 111:
          this.emit({ type: 'subtitle', text: op.text ?? '' });
          break;
        // 112 镜头移到某格
        case 112: {
          const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
          this.emit({ type: 'focus', x: t?.x ?? op.args?.x ?? 0, y: t?.y ?? op.args?.y ?? 0 });
          break;
        }
        // 113 停顿（毫秒）
        case 113:
          this.emit({ type: 'wait', ms: op.value });
          break;
        // 114 换头像（value = 职业号，text = 包内头像文件；只放画面）
        case 114:
          this.emit({ type: 'portrait', classId: op.value, file: op.text ?? '' });
          break;
        // 120 剧情选项（扩展包【新】）：编译时保证是区块最后一条；等 answer()
        case 120:
          if (!op.args?.options?.length) break;
          this.pendingChoice = { prompt: textOf(i), options: op.args.options.map((o) => ({ label: markLine(o.tid, o.label), flag: o.flag })) };
          this.emit({ type: 'choice', choice: this.pendingChoice });
          break;
        // 121 收手（扩展包【新】，梁山截路被宋江劝住的喽啰）：改成友军、原地不动、不能被选中，不再算敌人
        case 121: {
          // 已经归顺 / 收手过的不再收手（山径收草寇：被别的头领带走归顺的手下）
          if (!sel || !sel.alive || !sel.present || sel.side !== 'enemy') break;
          // 劝住也算击败：身边的我方（梁山截路里是宋江）按正常击败算法拿经验（负责人 2026-11-20）【新】
          // args.reward（负责人 2026-11-20）：身边没有我方时算最后打到他的人、再不行算最近的我方，照正常打倒给经验；
          // args.goldPct：再交出击退银子的这么多百分比（只有剪径赤松林给 150）；args.leave：收手后直接离开地图；
          // args.quiet：不飘「收手」字
          const s0 = sel, a = op.args ?? {};
          const players = this.active().filter((t) => t.side === 'player');
          let by = s0.side === 'enemy' ? players.find((t) => dist(t, s0) === 1) : undefined;
          if (!by && a.reward && s0.side === 'enemy') {
            const last = this.lastHitBy[s0.uid];
            by = players.find((t) => t.uid === last) ?? players.reduce<Unit | undefined>((m, t) => (!m || dist(t, s0) < dist(m, s0) ? t : m), undefined);
          }
          if (by && !this.credited.has(s0.uid)) {
            this.credited.add(s0.uid);
            const total = killExp(by, sel, this.rng);
            if (a.quiet) quietExp.push([by, killerShare(total, true)]);
            else this.gainExp(by, killerShare(total, true), 'kill');
            this.teamExp += teamShare(total);
            this.tallyExp('team', teamShare(total));
            const gold = a.goldPct ? Math.round((killGold(s0.classId, this.data, this.rng) * a.goldPct) / 100) : 0;
            if (gold) {
              by.gold += gold;
              // 不飘字的（一起收手）银子合成一句，放在区块最后，免得打断连着的退场
              if (a.quiet) quietGold += gold;
              else this.emit({ type: 'message', text: `${s0.name}交出銀子 ${gold} 兩。` });
            }
          }
          sel.side = 'ally';
          sel.ai.mode = 8;
          sel.ended = true;
          sel.defending = false;
          (this.spectators as Set<number>).add(sel.uid);
          if (!a.quiet) this.emit({ type: 'status', uid: sel.uid, text: '收手' });
          if (a.leave) this.hide(sel, false);
          else this.emit({ type: 'look', uid: sel.uid, classId: sel.classId });
          break;
        }
        // 123 观战 / 出战【新】（叫阵晁家庄单挑）：value 1 = 改成观战演员（不能行动、不能被打），0 = 回来参战；
        // args.side = 这一方在场的人全部（翻脸混战时观战的好汉一起上；下一阵开始前全队观战），否则只改点名的人
        case 123: {
          const sp = this.spectators as Set<number>;
          // 整队改的时候，正在出战的人先走回出列前的位置（输了一阵的人别留在教头跟前；下一阵的教头进场前让出擂台）
          if (op.args?.side === 'player') this.sendDuelistBack();
          const who = op.args?.side ? this.units.filter((u) => u.side === op.args!.side && u.alive && u.present) : sel ? [sel] : [];
          for (const u of who) {
            if (op.value === 1) {
              if (sp.has(u.uid)) continue;
              sp.add(u.uid);
              u.defending = false;
            } else {
              if (!sp.has(u.uid)) continue;
              sp.delete(u.uid);
              if (u.side === this.phase && !u.acted) {
                u.ended = u.stunTurns > 0;
                u.movementRemaining = u.stats.move;
              }
            }
            this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
          }
          break;
        }
        // 124 放火【新】（怒破何观察，负责人 2026-11-21）：args.cells 上冒火（只是画面，不挡路、不烧人）；
        // 离火（区块的区域，或 args.x / y）最近的 args.panic 个敌人逃窜 args.turns 回合（乱走、不攻击），args.spare 列的职业不会逃窜。
        // 之后的指令 13 由离火最近的敌人（先挑逃窜的）来喊
        case 124: {
          const a = op.args ?? {};
          const t = b.trigger;
          const at = t.kind === 'area' ? { x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 } : { x: a.x ?? 0, y: a.y ?? 0 };
          const d = (u: Cell) => Math.abs(u.x - at.x) + Math.abs(u.y - at.y);
          // 有人站着的格子不冒火（放火的人就站在旁边）
          const cells = (a.cells ?? []).filter((c) => this.board.inBounds(c.x, c.y) && !this.unitAt(c.x, c.y) && !this.blaze.some((o) => o.x === c.x && o.y === c.y));
          if (cells.length) {
            if (a.focus) this.emit({ type: 'focus', x: Math.round(at.x), y: Math.round(at.y) });
            this.blaze.push(...cells);
            this.emit({ type: 'fire', cells: this.fireCells() });
          }
          const foes = this.active()
            .filter((u) => u.side === 'enemy' && !this.spectators.has(u.uid) && !this.isBound(u))
            .sort((p, q) => d(p) - d(q) || p.uid - q.uid);
          const fled = foes.filter((u) => !a.spare?.includes(u.classId) && !u.panicTurns).slice(0, a.panic ?? 0);
          for (const u of fled) {
            u.panicTurns = a.turns ?? 3;
            if (u.defending) {
              u.defending = false;
              this.emit({ type: 'defend', uid: u.uid, on: false });
            }
            this.emit({ type: 'status', uid: u.uid, text: '逃竄' });
          }
          sel = fled[0] ?? foes[0];
          selName = sel?.name ?? '';
          break;
        }
        // 126 黑尘 / 怪风【新】（还道村受天书，负责人 2026-11-21）：以区块的区域中心（或 args.x / y）为中心，
        // args.radius 格（步数）以内的敌人逃窜 args.turns 回合（同 124 放火的逃窜；args.panic 限人数，args.spare 不逃的职业）；
        // args.style = dust（黑尘迷眼）/ wind（怪风）只管画面。之后的指令 13 由离中心最近的逃窜者来喊
        case 126: {
          const a = op.args ?? {};
          const t = b.trigger;
          const at = t.kind === 'area' && a.x === undefined ? { x: Math.round((t.x1 + t.x2) / 2), y: Math.round((t.y1 + t.y2) / 2) } : { x: a.x ?? 0, y: a.y ?? 0 };
          const radius = a.radius ?? 3;
          const d = (u: Cell) => Math.abs(u.x - at.x) + Math.abs(u.y - at.y);
          if (a.focus) this.emit({ type: 'focus', x: at.x, y: at.y });
          // style none【新】（盘陀路灯落）：没有风尘画面，只让人乱逃
          if (a.style !== 'none') this.emit({ type: 'gust', x: at.x, y: at.y, radius, style: a.style === 'wind' ? 'wind' : 'dust' });
          const foes = this.active()
            .filter((u) => u.side === 'enemy' && !this.spectators.has(u.uid) && !this.isBound(u) && d(u) <= radius)
            .sort((p, q) => d(p) - d(q) || p.uid - q.uid);
          const fled = foes.filter((u) => !a.spare?.includes(u.classId) && !u.panicTurns).slice(0, a.panic ?? foes.length);
          for (const u of fled) {
            u.panicTurns = a.turns ?? 3;
            if (u.defending) {
              u.defending = false;
              this.emit({ type: 'defend', uid: u.uid, on: false });
            }
            this.emit({ type: 'status', uid: u.uid, text: '逃竄' });
          }
          sel = fled[0] ?? foes[0] ?? sel;
          selName = sel?.name ?? selName;
          break;
        }
        // 125 潜行结束【新】（智取无为军，负责人 2026-11-21）：骗开大门后不用再躲，哨兵不再警戒，已发现的也不再判负
        // 127 打开 map.seal 封死的格子【新】（智取无为军：侯健骗开大门）
        case 127:
          for (const c of op.args?.cells ?? []) {
            if (!this.board.inBounds(c.x, c.y)) continue;
            const i = c.y * this.board.width + c.x;
            this.board.blocked[i] = 0;
            this.unsealed.add(i);
          }
          this.emit({ type: 'unseal', cells: (op.args?.cells ?? []).map((c) => ({ x: c.x, y: c.y })) });
          if (op.args?.reach) this.openTrapsToward(op.args.reach);
          break;
        // 129 就近摆路障、放伏兵【新】（盘陀路：举灯庄客照灯号叫人）：在离我方最近（至少 min 步）的路口候选里挑 count 处，
        // 堵上路障，groups 里还没登场的人从路障靠我方的一侧杀出来
        case 129:
          this.trap(op.args ?? {});
          break;
        case 125:
          this.stealthOver = true;
          this.spotters = {};
          for (const uid of this.watchers.keys()) if (this.units[uid]) this.units[uid].unaware = false;
          break;
        // 128 剧情受伤（扩展包【新】，李应中祝彪的回马箭）：生命降到最大值的 value%，已经更低就不动，至少留 1 点
        case 128: {
          if (!sel?.present || !sel.alive) break;
          const hp = Math.max(1, Math.min(sel.hp, Math.round((sel.stats.maxHp * op.value) / 100)));
          const delta = hp - sel.hp;
          sel.hp = hp;
          this.emit({ type: 'hp', uid: sel.uid, hp: sel.hp, mp: sel.mp, delta });
          this.emit({ type: 'status', uid: sel.uid, text: '重傷' });
          break;
        }
        // 130 去掉伪装 / 131 扮上伪装（扩展包【新】，劫牢、三打）：value 1 = 全部伪装的人；args.quiet = 不飘字
        case 130:
          this.scriptDisguise(false, op.value ? undefined : sel, !!op.args?.quiet);
          break;
        case 131:
          if (sel) this.scriptDisguise(true, sel, !!op.args?.quiet);
          break;
        // 122 改 AI 模式（扩展包【新】）
        case 122:
          if (sel) sel.ai.mode = op.value;
          break;
        // 103 设剧本标志（扩展包【新】）：之后条件 100 成立、101 不成立
        case 103:
          if (op.args?.clear) this.flags.delete(op.value);
          else this.flags.add(op.value);
          break;
        // 105 绑住（扩展包【新】，劫法场的宋江、戴宗）：当成一直昏迷，不能行动，照样会挨打；106 解开
        case 105:
          if (!sel) break;
          // args.turns【新】：只呆住几回合（智赚二龙山山门守军措手不及），text 是头上的字；不在场、已倒下的不算
          if (op.args?.turns && (!sel.alive || !sel.present)) break;
          sel.stunTurns = op.args?.turns ?? BOUND_TURNS;
          if (sel.side === this.phase) sel.ended = true;
          this.emit({ type: 'status', uid: sel.uid, text: op.text ?? '被綁' });
          break;
        // 106 解开：清掉绑缚、昏迷、中毒和减益；是这一方的回合就马上能行动
        case 106: {
          if (!sel) break;
          sel.stunTurns = 0;
          sel.poisonTurns = 0;
          sel.buffs = sel.buffs.filter((x) => x.value > 0);
          refreshStats(sel, this.data);
          if (sel.side === this.phase && !sel.acted) {
            sel.ended = false;
            sel.movementRemaining = sel.stats.move;
          }
          this.emit({ type: 'status', uid: sel.uid, text: '解開' });
          break;
        }
        // 102 换职业（扩展包【新】，如披虎皮的猎户现出原形）：样子、属性、头像都换，血气回满；text 是新名字
        case 102:
          if (!sel || !this.data.classes[op.value]) break;
          sel.classId = op.value;
          sel.name = op.text ?? this.charName(op.value);
          refreshStats(sel, this.data);
          sel.hp = sel.stats.maxHp;
          sel.mp = sel.stats.maxMp;
          selName = sel.name;
          this.emit({ type: 'look', uid: sel.uid, classId: op.value });
          this.emit({ type: 'hp', uid: sel.uid, hp: sel.hp, mp: sel.mp, delta: 0 });
          break;
        // 116 走到某人身边（扩展包【新】，夜过清风山喽啰围上来）：args.toward = 目标编组；挑走得到、没人占、离目标最近的格子（同样近取路短的）；
        // 已经挨着就不动，走不近也不动（不在场或已倒下的人跳过）
        case 116: {
          const t = op.args?.toward !== undefined ? this.unit(this.groups.get(op.args.toward) ?? -1) : undefined;
          if (!sel || !t || !sel.present || !sel.alive || !t.present || dist(sel, t) === 1) break;
          const reach = this.reachOf(sel, 99);
          const taken = this.occupied(sel);
          // 身边四格都被占了（已经围满）就挤到离目标最近的空格
          let best: Cell[] = [], bestD = dist(sel, t);
          for (const k of reach.keys()) {
            if (taken.has(k)) continue;
            const [x, y] = k.split(',').map(Number);
            const d = Math.abs(x - t.x) + Math.abs(y - t.y);
            if (d === 0 || d > bestD) continue;
            const path = pathTo(reach, x, y);
            if (path.length > 1 && (d < bestD || path.length < best.length)) { best = path; bestD = d; }
          }
          if (best.length) this.walk(sel, best, true);
          break;
        }
        // 115 换阵营（扩展包【新】，黄信归降）：text = player / ally / enemy；换了以后本回合不再行动，血条换色
        case 115: {
          if (!sel || !op.text) break;
          const from = sel.side, s0 = sel;
          // args.nearest【新】（山径收草寇，负责人 2026-11-20）：连带身边 range 格内最近的 nearest 个同阵营手下（classes 限定职业）一起换
          // args.fraction：改成按比例（智赚二龙山：头领倒下，剩下的小兵一半归顺）；args.crewOnly：只换手下，不换选中的人本身（头领已倒下）
          const frac = op.args?.fraction, range = op.args?.range ?? 3, classes = op.args?.classes, only = op.args?.only; // only：只在这些编号里挑（开场就在的守军，不含增援）
          const pool = op.args?.nearest || frac
            ? this.active()
                .filter((u) => u !== s0 && u.side === from && dist(u, s0) <= range && (!classes || classes.includes(u.classId)) && (!only || only.includes(u.uid)))
                .sort((a, b) => dist(a, s0) - dist(b, s0) || a.uid - b.uid)
            : [];
          const crew = pool.slice(0, frac ? Math.round(pool.length * frac) : (op.args?.nearest ?? 0));
          for (const u of op.args?.crewOnly ? crew : [sel, ...crew]) {
            // 我方好汉转成友军（李应中箭后自己往回撤）：还按我方好汉算属性，免得移动、体力跟着换成友军模板【新】
            if (from === 'player' && op.text !== 'player' && !u.statSide) {
              u.statSide = 'player';
              refreshStats(u, this.data);
            }
            u.side = op.text as Unit['side'];
            u.ended = true;
            this.emit({ type: 'status', uid: u.uid, text: op.value === 1 ? '被擒' : this.spectators.has(u.uid) ? (u.side === 'ally' ? '观战' : '归队') : u.side === 'enemy' ? '倒戈' : from === 'player' ? '撤離' : '歸順' });
            // 观战/归队不换模型，避免重复播放逐人淡出淡入。
            if (!this.spectators.has(u.uid)) this.emit({ type: 'look', uid: u.uid, classId: u.classId });
          }
          break;
        }
        // 101 限时增减益：args.stat 属性，pct 按当前值的百分比（-50 = 减半）或 add 直接加，turns 回合（0 = 本关一直有效）
        case 101: {
          if (!sel || !op.args?.stat) break;
          const stat = op.args.stat as BuffStat;
          const cur = (sel.stats as unknown as Record<string, number>)[stat] ?? 0;
          const value = op.args.pct ? Math.round((cur * op.args.pct) / 100) : (op.args.add ?? 0);
          sel.buffs.push({ stat, value, turns: op.args.turns ?? 0 });
          refreshStats(sel, this.data);
          this.emit({ type: 'status', uid: sel.uid, text: `${buffName(stat)}${value > 0 ? '+' : ''}${value}` });
          break;
        }
      }
    });
    flushObjective();
    flushQuiet();
    if (ending !== null) return this.finish('lost', ending);
    if (cleared) this.finish('won', '');
  }

  /** 指令 27：打开选人（提示取同一区块里指令 27 之前最后一句旁白，没有就用重制版的文字） */
  private openPick(b: PasBlock, at: number, textOf: (i: number) => string, args?: PasOp['args']) {
    this.scriptFlag = true;
    let prompt = '';
    for (let i = at - 1; i >= 0 && !prompt; i--) {
      if (b.ops[i].op !== 13) continue;
      const who = b.ops.slice(0, i).filter((o) => o.op === 12).pop();
      if (who && who.value === 0xffffffff) prompt = textOf(i);
      break;
    }
    const mine = this.units.filter((u) => u.side === 'player' && u.alive);
    let candidates = mine.filter((u) => u.present);
    this.pickTo = null;
    if (args?.keep) {
      // 单挑【新】：上一阵出战的人走回原来的位置观战；选过的不再选；必须出场的人剩下的机会不多了就只能选他
      this.sendDuelistBack();
      if (args.fresh) candidates = candidates.filter((u) => !this.fought.has(u.uid));
      const must = candidates.filter((u) => args.must?.includes(u.classId));
      if (must.length && must.length >= (args.left ?? Infinity)) candidates = must;
      this.pickTo = { x: args.x ?? 0, y: args.y ?? 0 };
    }
    const best = candidates.reduce<Unit | undefined>((a, u) => (!a || u.level > a.level ? u : a), undefined);
    this.pendingPick = {
      prompt: prompt || (/^train/i.test(this.name) ? '請選擇與王進過招的人' : '請選擇出戰的人'),
      candidates: candidates.map((u) => u.uid),
      required: args?.keep ? [] : mine.filter((u) => !u.present && u.classId === 0).map((u) => u.uid),
      count: 1,
      recommended: best ? [best.uid] : [],
      ...(args?.keep ? { watch: true } : {}),
    };
    this.emit({ type: 'pick', pick: this.pendingPick });
  }

  /** 127 + reach【新】（盘陀路石秀带路，负责人 2026-11-23）：一处一处拽开 trap 设下的路障，直到原来能走的每一格路都通得到 goal；只开需要的 */
  private openTrapsToward(goal: Cell) {
    const W = this.board.width;
    const closed = () => this.trapSeals.map((c) => c.y * W + c.x).filter((i) => !this.unsealed.has(i) && this.board.blocked[i]);
    // 连在一起的路障格算一处
    const pieces: number[][] = [];
    for (const i of closed()) {
      const p = pieces.find((q) => q.some((j) => Math.abs((j % W) - (i % W)) + Math.abs(Math.floor(j / W) - Math.floor(i / W)) === 1));
      if (p) p.push(i); else pieces.push([i]);
    }
    const all = pieces.flat();
    for (const i of all) this.board.blocked[i] = 0;
    const want = this.board.distanceField([goal]);
    for (const i of all) this.board.blocked[i] = 1;
    const opened: Cell[] = [];
    for (let guard = 0; guard < pieces.length; guard++) {
      const f = this.board.distanceField([goal]);
      const shut = new Set(all.filter((i) => this.board.blocked[i]));
      if (want.every((d, i) => !Number.isFinite(d) || shut.has(i) || Number.isFinite(f[i]))) break;
      const nb = (i: number) => [i - 1, i + 1, i - W, i + W];
      const p = pieces.find((q) => this.board.blocked[q[0]] && q.some((i) => nb(i).some((j) => Number.isFinite(f[j]))) && q.some((i) => nb(i).some((j) => !shut.has(j) && Number.isFinite(want[j]) && !Number.isFinite(f[j]))));
      if (!p) break;
      for (const i of p) { this.board.blocked[i] = 0; this.unsealed.add(i); opened.push({ x: i % W, y: Math.floor(i / W) }); }
    }
    if (opened.length) this.emit({ type: 'unseal', cells: opened });
  }

  /** 指令 129：就近摆路障、放伏兵（盘陀路）【新】 */
  private trap(a: NonNullable<PasOp['args']>) {
    const W = this.board.width;
    const heroes = this.units.filter((u) => u.side === 'player' && u.present && u.alive && !this.spectators.has(u.uid));
    if (!heroes.length) return;
    const dHero = this.board.distanceField(heroes.map((u) => ({ x: u.x, y: u.y })));
    const taken = this.occupied();
    const sealedNow = new Set([...this.sealed, ...this.trapSeals].map((c) => c.y * W + c.x).filter((i) => !this.unsealed.has(i)));
    const sites = (a.sites ?? [])
      .filter((s) => !(s.tag && a.exclude?.includes(s.tag)))
      .filter((s) => s.cells.every((c) => this.board.inBounds(c.x, c.y) && !sealedNow.has(c.y * W + c.x) && !taken.has(key(c.x, c.y))))
      .map((s) => ({ s, d: Math.min(...s.cells.map((c) => dHero[c.y * W + c.x])) }))
      .filter((o) => Number.isFinite(o.d) && o.d >= (a.min ?? 2))
      .sort((p, q) => p.d - q.d);
    const groupUnits = (a.groups ?? []).map((g) => this.unit(this.groups.get(g) ?? -1)).filter((u): u is Unit => !!u && u.alive && !u.present);
    // 一次设几处时，尽量各找不同的好汉（分散的几波人各挨一处），找不够再照远近补
    const heroField = new Map(heroes.map((h) => [h.uid, this.board.distanceField([{ x: h.x, y: h.y }])]));
    const nearestHero = (st: (typeof sites)[number]['s']) => heroes.reduce((b, h) => {
      const dd = (v: Unit) => Math.min(...st.cells.map((c) => heroField.get(v.uid)![c.y * W + c.x]));
      return dd(h) < dd(b) ? h : b;
    });
    const want = a.count ?? 1;
    const chosen: typeof sites = [];
    const hit: Unit[] = [];
    // reach：连同已挑的几处一起堵上以后，每个好汉都还走得到 reach 这一格才挑
    const keeps = (o: (typeof sites)[number]) => {
      if (!a.reach) return true;
      // 不光好汉站的格子：原来通得到出口的每一格路，堵上以后也都要还通得到（负责人 2026-11-23：所有的路都至少能到出口）
      const cells = [...chosen, o].flatMap((v) => v.s.cells).map((c) => c.y * W + c.x).filter((i) => !this.board.blocked[i]);
      const before = this.board.distanceField([a.reach]);
      for (const i of cells) this.board.blocked[i] = 1;
      const f = this.board.distanceField([a.reach]);
      for (const i of cells) this.board.blocked[i] = 0;
      const shut = new Set(cells);
      return before.every((d, i) => !Number.isFinite(d) || shut.has(i) || Number.isFinite(f[i])) && heroes.every((h) => Number.isFinite(f[h.y * W + h.x]));
    };
    for (const o of sites) {
      if (chosen.length >= want) break;
      if (!keeps(o)) continue;
      const h = nearestHero(o.s);
      if (hit.some((v) => Math.abs(v.x - h.x) + Math.abs(v.y - h.y) <= 4)) continue;
      chosen.push(o);
      hit.push(h);
    }
    for (const o of sites) if (chosen.length < want && !chosen.includes(o) && keeps(o)) chosen.push(o);
    for (const [k, { s, d }] of chosen.entries()) {
      const tile = s.tile ?? a.tile;
      for (const c of s.cells) {
        const i = c.y * W + c.x;
        this.unsealed.delete(i);
        this.board.blocked[i] = 1;
        this.trapSeals = this.trapSeals.filter((t) => t.x !== c.x || t.y !== c.y);
        this.trapSeals.push({ x: c.x, y: c.y, ...(tile !== undefined ? { tile } : {}) });
      }
      this.emit({ type: 'seal', cells: s.cells.map((c) => ({ x: c.x, y: c.y })), ...(tile !== undefined ? { tile } : {}) });
      // 伏兵：分到这处的人前后包抄离路障最近的好汉（负责人 2026-11-23：别挤在一处，从前后围上来）。
      // 以那人为中心，走 3–6 步的空格里取两个落点：一个靠路障（前），一个离前点最远（后）；人马交替分到两边。
      const mine = groupUnits.filter((_, n) => n % chosen.length === k);
      if (!mine.length) continue;
      const fromSite = this.board.distanceField(s.cells.map((c) => ({ x: c.x, y: c.y })));
      const target = heroes.reduce((b, v) => (fromSite[v.y * W + v.x] < fromSite[b.y * W + b.x] ? v : b));
      const fromT = this.board.distanceField([{ x: target.x, y: target.y }]);
      const occ = this.occupied();
      // 落点不够（好汉被路障关在小块地方）就放宽距离，最后退到贴身
      let near: Cell[] = [];
      for (const [lo, hi, gap] of [[3, 6, 2], [3, 9, 2], [2, 12, 1], [1, 99, 1]]) {
        near = [];
        for (let y = 0; y < this.board.height; y++)
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (!this.board.passable(x, y) || occ.has(key(x, y)) || !(fromT[i] >= lo && fromT[i] <= hi) || !(dHero[i] >= gap)) continue;
            near.push({ x, y });
          }
        if (near.length >= mine.length) break;
      }
      if (!near.length) continue;
      const front = near.reduce((b, c) => (fromSite[c.y * W + c.x] < fromSite[b.y * W + b.x] ? c : b));
      const far = (c: Cell) => (c.x - front.x) ** 2 + (c.y - front.y) ** 2;
      const back = near.reduce((b, c) => (far(c) > far(b) ? c : b));
      const used = new Set<string>();
      const pick = (anchor: Cell) => {
        const c = near.filter((v) => !used.has(key(v.x, v.y))).sort((p, q) => Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) - (Math.abs(q.x - anchor.x) + Math.abs(q.y - anchor.y)) || fromT[q.y * W + q.x] - fromT[p.y * W + p.x])[0];
        if (c) used.add(key(c.x, c.y));
        return c;
      };
      // scatter：一个个散开站，每人挑离已站好的人最远的格子（开场第一波，负责人 2026-11-23：尽量分散）
      const spread = (): Cell | undefined => {
        const placed = near.filter((v) => used.has(key(v.x, v.y)));
        if (!placed.length) return pick(front);
        const gap = (c: Cell) => Math.min(...placed.map((v) => Math.abs(v.x - c.x) + Math.abs(v.y - c.y)));
        const c = near.filter((v) => !used.has(key(v.x, v.y))).sort((p, q) => gap(q) - gap(p))[0];
        if (c) used.add(key(c.x, c.y));
        return c;
      };
      for (const [n, u] of mine.entries()) {
        const c = a.scatter ? spread() : pick(n % 2 === 0 ? front : back);
        if (!c) break;
        u.x = c.x;
        u.y = c.y;
        this.ambushers.delete(u.uid);
        this.appear(u);
        const h = heroes.reduce((b, v) => (Math.abs(v.x - u.x) + Math.abs(v.y - u.y) < Math.abs(b.x - u.x) + Math.abs(b.y - u.y) ? v : b));
        u.facing = facingTowards(u, h);
      }
    }
  }

  /** 登场格：从 u 的位置走得到、没人占、路最短的格子（盘陀路石秀到宋江身边，别出在墙那边）；起点不可走就交给 nearestFree */
  private nearestReachableFree(u: Unit): Cell | null {
    if (!this.board.passable(u.x, u.y)) return null;
    const W = this.board.width;
    const occ = this.occupied(u);
    if (!occ.has(key(u.x, u.y))) return { x: u.x, y: u.y };
    const f = this.board.distanceField([{ x: u.x, y: u.y }]);
    let best: Cell | null = null;
    let bd = Infinity;
    for (let y = 0; y < this.board.height; y++)
      for (let x = 0; x < W; x++) {
        const d = f[y * W + x];
        if (d < bd && d > 0 && this.board.passable(x, y) && !occ.has(key(x, y))) { bd = d; best = { x, y }; }
      }
    return best;
  }

  private appear(u: Unit) {
    const c = this.nearestReachableFree(u) ?? this.board.nearestFree(u.x, u.y, this.occupied(u)) ?? u;
    u.x = c.x;
    u.y = c.y;
    u.present = true;
    const ambush = this.ambushers.has(u.uid) || (u.side === 'enemy' && this.turn > 1);
    this.ambushers.delete(u.uid);
    u.ended = u.side === this.phase;
    this.emit({ type: 'appear', uid: u.uid, x: u.x, y: u.y, ambush });
  }

  private hide(u: Unit, ambush: boolean) {
    u.present = false;
    u.defending = false;
    if (ambush) this.ambushers.add(u.uid);
    this.emit({ type: 'leave', uid: u.uid });
  }

  private finish(result: 'won' | 'lost', text: string) {
    if (this.status !== 'playing') return;
    if (result === 'won') {
      if (this.tune?.poolLeftoverExp) this.poolLeftover();
      this.settleTeamExp();
      this.clearGold = this.hadPlayers ? (this.clearGoldOverride ?? stageClearGold(this.name)) : 0;
      if (this.clearGold) this.emit({ type: 'message', text: `過關獎勵：得到銀子 ${this.clearGold} 兩！` });
    }
    this.status = result;
    this.emit({ type: 'end', result, text });
  }

  // ───────────── 好汉聚义【新】（吃鸡，docs/game-design.md §15.31，负责人 2026-11-22） ─────────────

  private setupRoyale() {
    const r = this.royaleRules!;
    // 宝箱只刷在开阔的格子上（不刷到地图边上石头后面的角落）
    const area = mainArea(this.board);
    const open = openCells(this.board, area);
    this.royaleArea = open.length ? open : area;
    // 参赛好汉不带药：随身物品栏清空，装备照等级表（编译关卡时配好）
    for (const u of this.units)
      if (u.team !== undefined && u.team !== NPC_TEAM)
        for (const k of BAG_SLOTS) {
          u.slots[k] = 0;
          u.forge[k] = 0;
        }
    this.royale = { zone: firstZone(area), next: null, shrinkAt: 1 + r.shrinkEvery, step: 0, out: [], kills: {}, npcKills: {} };
    this.planShrink();
    this.spawnChests(r.chestStart, false);
  }

  /** 试打工具：我方好汉倒下后接着打到只剩一人（看整局多长） */
  royaleWatch = false;

  /** 还活着的参赛好汉（小头目不算） */
  royaleHeroes(): Unit[] {
    return this.units.filter((u) => u.alive && u.team !== undefined && u.team !== NPC_TEAM);
  }

  /** 还要几回合缩圈（不再缩了为 null） */
  royaleCountdown(): number | null {
    const st = this.royale;
    return st?.next ? Math.max(0, st.shrinkAt - this.turn) : null;
  }

  /** 公布下一个圈（radii 用完就不再缩） */
  private planShrink() {
    const st = this.royale!, r = this.royaleRules!;
    const radius = r.radii[st.step];
    st.next = radius === undefined ? null : nextZone(this.royaleArea, st.zone, Math.min(radius, st.zone.r), this.rng);
  }

  /**
   * 回合开始：圈外的人先掉血（最大体力的 1/damageDivisor，能掉死），再缩圈、公布下一个圈，再刷宝箱。
   * 先掉血后缩圈：缩圈那一回合新落到圈外的人还有一个回合往里跑（下一个圈早就公布了）。
   */
  private royaleTick(t: number) {
    const st = this.royale!, r = this.royaleRules!;
    const dead: Unit[] = [];
    let hurt = 0;
    for (const u of this.active()) {
      if (this.spectators.has(u.uid) || inZone(st.zone, u)) continue;
      const hp0 = u.hp;
      u.hp = Math.max(0, u.hp - Math.max(1, Math.floor(u.stats.maxHp / r.damageDivisor)));
      hurt++;
      this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, text: '毒圈' });
      if (u.hp <= 0) dead.push(u);
    }
    if (hurt) this.emit({ type: 'message', text: `圈外 ${hurt} 人中了毒，各掉 1/${r.damageDivisor} 体力。` });
    for (const u of dead) {
      u.alive = false;
      u.defending = false;
      this.emit({ type: 'die', uid: u.uid });
      this.emit({ type: 'message', text: `${u.name}倒在了毒圈里。` });
      this.pendingDeaths.push(u.classId);
      this.royaleOut(u, null);
    }
    if (dead.length) this.afterAction();
    if (this.status !== 'playing') return;
    if (st.next && t >= st.shrinkAt) {
      st.zone = st.next;
      st.step++;
      st.shrinkAt = t + r.shrinkEvery;
      this.planShrink();
      this.emit({ type: 'zone', zone: st.zone, next: st.next });
      this.emit({ type: 'message', text: `毒圈缩小了！${st.next ? `下一圈已经标出，${r.shrinkEvery} 回合后再缩。` : '这是最后一圈。'}` });
    }
    if (t > 1 && r.chestEvery > 0 && (t - 1) % r.chestEvery === 0) this.spawnChests(r.chestCount, true);
  }

  /** 在下一个圈里（没有就现在的圈）随机的空格上刷宝箱 */
  private spawnChests(n: number, announce: boolean) {
    const st = this.royale!, r = this.royaleRules!;
    if (!r.chestItems.length || n <= 0) return;
    const busy = new Set([...this.active().map((u) => key(u.x, u.y)), ...this.items.map((g) => key(g.x, g.y))]);
    const free = (z: Zone) => this.royaleArea.filter((c) => inZone(z, c) && !busy.has(key(c.x, c.y)));
    let cells = free(st.next ?? st.zone);
    if (!cells.length) cells = free(st.zone);
    let placed = 0;
    for (; placed < n && cells.length; placed++) {
      const c = cells.splice(this.rng.int(cells.length), 1)[0];
      const item = r.chestItems[this.rng.int(r.chestItems.length)];
      this.items.push({ x: c.x, y: c.y, item, hidden: false });
      if (announce) this.emit({ type: 'chest', x: c.x, y: c.y, item });
    }
    if (announce && placed) this.emit({ type: 'message', text: `地上冒出了 ${placed} 个宝箱。` });
  }

  /** 有人出局：小头目掉药（打倒他的人包里有空就直接拿到，否则落在地上成宝箱）；好汉记进出局顺序 */
  private royaleOut(t: Unit, by: Unit | null) {
    const st = this.royale!;
    if (by && by !== t) {
      const tally = t.team === NPC_TEAM ? (st.npcKills ??= {}) : (st.kills ??= {});
      tally[by.uid] = (tally[by.uid] ?? 0) + 1;
    }
    if (t.team === NPC_TEAM) {
      const drops = this.royaleRules!.npcs.drops;
      if (!drops.length) return;
      const item = drops[this.rng.int(drops.length)];
      const name = this.tr(itemOf(this.data, item)?.name ?? '');
      const slot = by && by.alive && by.team !== NPC_TEAM ? freeBagSlot(by.slots) : -1;
      if (by && slot >= 0) {
        by.slots[slot] = item;
        by.forge[slot] = 0;
        this.emit({ type: 'message', text: `${by.name}从${t.name}身上搜出了${name}。` });
        return;
      }
      const taken = new Set([...this.active().map((u) => key(u.x, u.y)), ...this.items.map((g) => key(g.x, g.y))]);
      const c = this.board.nearestFree(t.x, t.y, taken);
      if (!c) return;
      this.items.push({ x: c.x, y: c.y, item, hidden: false });
      this.emit({ type: 'chest', x: c.x, y: c.y, item });
      this.emit({ type: 'message', text: `${t.name}掉下了${name}。` });
      return;
    }
    st.out.push(t.uid);
    this.emit({ type: 'message', text: `${t.name}出局${by ? `（被${by.name}打倒）` : ''}，还剩 ${this.royaleHeroes().length} 位好汉。` });
  }

  private killText(u: Unit) {
    const k = this.royaleKills(u);
    return `亲手击败 ${k.heroes} 位好汉${k.npcs ? `、${k.npcs} 个小头目` : ''}`;
  }

  /** 这个人亲手打倒的好汉数、小头目数 */
  royaleKills(u: Unit): { heroes: number; npcs: number } {
    return { heroes: this.royale?.kills?.[u.uid] ?? 0, npcs: this.royale?.npcKills?.[u.uid] ?? 0 };
  }

  /** 胜负：我方的好汉倒下就输（报名次），对手全部出局就赢 */
  private royaleEnd(): boolean {
    const me = this.units.find((u) => u.side === 'player' && u.team !== undefined);
    if (!me) return false;
    const left = this.royaleHeroes();
    if (!me.alive && this.royaleWatch && left.length > 1) return false;
    if (!me.alive) {
      this.finish('lost', `${me.name}倒下了，名列第 ${left.length + 1} 名（共 ${this.units.filter((u) => u.team !== undefined && u.team !== NPC_TEAM).length} 人），${this.killText(me)}。`);
      return true;
    }
    if (left.length === 1) {
      this.finish('won', `${me.name}力压群雄，成为最后站着的好汉！${this.killText(me)}。`);
      return true;
    }
    return false;
  }

  // ───────────── 蹴鞠【新】（docs/game-design.md §15.25，负责人 2026-11-20） ─────────────

  private setupCuju(rules: CujuRules) {
    const starts: CujuState['starts'] = {};
    const roles: CujuState['roles'] = {};
    for (const team of ['player', 'enemy'] as const) {
      const g = rules.goals[team];
      const gy = (g.y1 + g.y2) / 2;
      const mine = this.units.filter((u) => u.side === team && u.present && !this.spectators.has(u.uid));
      mine.sort((a, b) => Math.abs(a.x - g.x) + Math.abs(a.y - gy) - (Math.abs(b.x - g.x) + Math.abs(b.y - gy)));
      mine.forEach((u, i) => {
        starts[u.uid] = { x: u.x, y: u.y, facing: u.facing };
        roles[u.uid] = i === 0 ? 'keeper' : i <= 2 ? 'back' : 'forward';
      });
    }
    this.cuju = { rules, ball: { x: rules.kickoff[0], y: rules.kickoff[1] }, score: { player: 0, enemy: 0 }, locked: false, over: false, starts, roles };
  }

  /** 格子在不在球场里（不是蹴鞠关时 = 在地图上） */
  inField(c: Cell): boolean {
    return this.cuju ? fieldHas(this.cuju.rules, c) : this.board.inBounds(c.x, c.y);
  }

  /** 场上踢球的人（踢球的人可以假设站在 at） */
  ballPlayers(kicker?: Unit, at?: Cell): BallPlayer[] {
    return this.active()
      .filter((u) => !this.spectators.has(u.uid) && (u.side === 'player' || u.side === 'enemy'))
      .map((u) => ({ uid: u.uid, side: u.side, x: u === kicker && at ? at.x : u.x, y: u === kicker && at ? at.y : u.y, defending: u.defending }));
  }

  /** 这个人现在还能不能踢球（能行动、没出过手、球没被拦下锁住、本方回合没因出界 / 进球结束） */
  canKick(u: Unit): boolean {
    const c = this.cuju;
    return !!c && this.canAct(u) && !u.acted && !c.locked && !c.over;
  }

  /** 普通攻击能不能踢到球（at = 假设的站位） */
  kickable(u: Unit, at: Cell = u): boolean {
    return this.canKick(u) && basicReaches(at, this.cuju!.ball, attackRange(u, this.data));
  }

  /** 技能能踢到球的施放点：作用范围盖到球的格子 */
  kickCells(u: Unit, skill: SkillDef, at: Cell = u): Cell[] {
    if (!this.canKick(u) || isSupportSkill(skill)) return [];
    const b = this.cuju!.ball;
    if (skill === attackSkill(u, this.data)) return this.kickable(u, at) ? [{ ...b }] : [];
    return this.skillCells(u, skill, at).filter((c) => this.skillArea(u, skill, c, at).some((a) => a.x === b.x && a.y === b.y));
  }

  /** 踢球预览（at = 假设的站位） */
  kickPreview(u: Unit, skill: SkillDef = attackSkill(u, this.data), at: Cell = u): KickPreview {
    const ball = this.cuju!.ball;
    const bonus = this.kickBonus(u);
    const [n, c] = kickPower(u, skill, at, ball, bonus);
    const distance = kickDistance(n);
    const line = resolveBall(this.cuju!.rules, ball, traceLine(ball, ball.x - at.x, ball.y - at.y, 0, distance), u.side, this.ballPlayers(u, at));
    return { hit: kickHitChance(u, skill, bonus), crit: kickCritChance(u, skill), distance, critDistance: kickDistance(c), missDistance: kickDistance(n * MISS_FACTOR), line };
  }

  /** 这一队踢球的加成（CujuRules.bonus） */
  kickBonus(u: Unit) {
    return u.side === 'player' || u.side === 'enemy' ? this.cuju?.rules.bonus?.[u.side] : undefined;
  }

  /** 普通攻击踢球 */
  kick(u: Unit): BattleEvent[] {
    this.out = [];
    if (!this.kickable(u)) return [];
    this.cast(u, attackSkill(u, this.data), { ...this.cuju!.ball }, false);
    this.endAction(u);
    return this.flush();
  }

  /** 一方的回合交给 AI 踢（试打工具让我方也这样打） */
  autoPhase(side: Team): BattleEvent[] {
    this.out = [];
    if (this.cuju && this.phase === side && this.status === 'playing') this.runCujuAi(side);
    return this.flush();
  }

  private runCujuAi(side: Team) {
    // AI 调的是公开指令（它们会清空事件流），这里把每一步的事件接到当前事件流后面
    const nest = (fn: () => BattleEvent[]) => {
      const saved = this.out;
      const ev = fn();
      this.out = saved;
      this.out.push(...ev);
    };
    cujuPhase(this, side, {
      move: (u, c) => nest(() => this.move(u, c.x, c.y)),
      kick: (u) => nest(() => this.kick(u)),
      skill: (u, s, c) => nest(() => this.useSkill(u, s, c)),
      defend: (u) => nest(() => this.defend(u)),
      rest: (u) => nest(() => this.rest(u)),
    });
    for (const u of this.units) if (u.side === side) u.ended = true;
  }

  private kickCast(u: Unit, skill: SkillDef, cell: Cell) {
    const c = this.cuju!;
    const ball = { ...c.ball };
    u.facing = facingTowards(u, ball, u.facing);
    u.mp -= skill.mpCost;
    (this.used[u.uid] ??= []).push(skill.skillId);
    const basic = skill === attackSkill(u, this.data);
    this.emit({ type: 'attack', uid: u.uid, skill, cell, area: basic ? [ball] : this.skillArea(u, skill, cell), facing: u.facing, hits: [], counter: false });
    if (skill.mpCost) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
    if (!basic) this.emit({ type: 'message', text: `${u.name}使出${this.tr(skill.name)}！` });
    const r = rollKick(u, skill, u, ball, this.rng, this.kickBonus(u));
    const res = resolveBall(c.rules, ball, traceLine(ball, ball.x - u.x, ball.y - u.y, r.deviation, r.distance), u.side, this.ballPlayers());
    const how = r.crit ? '大力抽射！' : r.hits === 0 ? '踢偏了，' : r.hits < r.parts ? '踢得有点偏，' : '';
    this.emit({ type: 'message', text: `${how}球飞出 ${r.distance} 格。` });
    const name = (uid: number) => this.unit(uid)?.name ?? '';
    switch (res.kind) {
      case 'stop':
        c.ball = res.at;
        this.emit({ type: 'ball', path: res.path, x: res.at.x, y: res.at.y, result: 'stop' });
        break;
      case 'intercept':
        c.ball = res.at;
        c.locked = true;
        this.emit({ type: 'ball', path: res.path, x: res.at.x, y: res.at.y, result: 'intercept', by: res.by, text: '拦截！' });
        this.emit({ type: 'message', text: `球被${name(res.by)}拦下了！本回合球踢不动了，只能走位。` });
        break;
      case 'out': {
        this.emit({ type: 'ball', path: res.path, x: res.path.at(-1)!.x, y: res.path.at(-1)!.y, result: 'out', text: '出界！' });
        const t = throwIn(c.rules, res.at, u.side, this.ballPlayers());
        if (t) c.ball = t.at;
        this.emit({ type: 'ball', path: [], x: c.ball.x, y: c.ball.y, result: 'place' });
        this.emit({ type: 'message', text: `出界！${t ? `球交给${name(t.to)}，` : ''}本回合结束。` });
        this.endCujuPhase(u.side);
        break;
      }
      case 'goal': {
        c.score[res.scorer]++;
        const own = res.scorer !== u.side;
        this.emit({ type: 'ball', path: res.path, x: res.at.x, y: res.at.y, result: 'goal', text: own ? '乌龙球！' : '进球！', score: { ...c.score } });
        this.emit({ type: 'message', text: `${own ? `${u.name}踢进了自家球门！` : `${u.name}进球！`}比分 ${c.score.player} : ${c.score.enemy}。` });
        if (c.score[res.scorer] >= c.rules.goalsToWin || this.turn > c.rules.turns) {
          this.cujuResult();
          return;
        }
        this.cujuKickoff();
        this.endCujuPhase(u.side);
        break;
      }
    }
  }

  /** 出界、进球：这一方本回合立刻结束 */
  private endCujuPhase(side: Side) {
    this.cuju!.over = true;
    for (const u of this.units)
      if (u.side === side) {
        u.ended = true;
        u.movementRemaining = 0;
        u.turnStart = null;
      }
  }

  /** 进球后：双方回到开球站位，球放回开球点 */
  private cujuKickoff() {
    const c = this.cuju!;
    for (const u of this.active()) {
      const s = c.starts[u.uid];
      if (!s) continue;
      if (u.defending) {
        u.defending = false;
        this.emit({ type: 'defend', uid: u.uid, on: false });
      }
      u.x = s.x;
      u.y = s.y;
      u.facing = s.facing;
      this.emit({ type: 'move', uid: u.uid, path: [{ x: s.x, y: s.y }], facing: s.facing });
    }
    c.ball = { x: c.rules.kickoff[0], y: c.rules.kickoff[1] };
    this.emit({ type: 'ball', path: [], x: c.ball.x, y: c.ball.y, result: 'place' });
  }

  /** 按比分判胜负 */
  private cujuResult() {
    const { player, enemy } = this.cuju!.score;
    if (player > enemy) this.finish('won', `比分 ${player} : ${enemy}，我方获胜！`);
    else if (enemy > player) this.finish('lost', `比分 ${player} : ${enemy}，输给了对手。`);
    else this.finish('lost', `比分 ${player} : ${enemy}，加时也没分出胜负，本场算输。`);
  }

  /** 回合开始时看时间：常规回合打完领先的赢；平局进加时（先进球的赢）；加时打完还平算输。分出胜负时返回 true */
  private cujuClock(t: number): boolean {
    const c = this.cuju!;
    const tied = c.score.player === c.score.enemy;
    if (t > c.rules.turns && !tied) return this.cujuResult(), true;
    if (t > c.rules.turns + c.rules.extraTurns) return this.cujuResult(), true;
    if (t === c.rules.turns + 1) this.emit({ type: 'message', text: `常规 ${c.rules.turns} 回合打完，比分相同，进入加时：先进球者胜！` });
    return false;
  }
}

/** 手下留情（rules.feint）：必定打中、没有伤害的一下 */
function feintHit(skill: SkillDef): HitResult {
  const n = attackParts(skill).length;
  return { hit: true, crit: false, damage: 0, parts: Array(n).fill(0), partHit: Array(n).fill(true), partCrit: Array(n).fill(false), poisoned: false, stunned: false, backstab: 'front' };
}
