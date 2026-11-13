// 战斗状态机：回合、指令、AI 行动、PAS 事件与胜负。只改状态并输出事件流，画面由 game/ 播放。
import type { ActUnit } from '../formats/act.ts';
import type { PasBlock, PasCond, PasHeader } from '../formats/pas.ts';
import type { ExePrompt } from '../formats/exe.ts';
import { alertRadius, planAi } from './ai.ts';
import type { Member } from './campaign.ts';
import { Board, key, pathTo, type Cell } from './board.ts';
import { canCounter, previewAttack, rollAttack, type AttackPreview, type HitResult } from './combat.ts';
import { killGold, stageClearGold } from './gold.ts';
import { counterExp, dodgeExp, expToNext, healExp, hitExp, itemExp, killDamage, killerShare, killExp, restExp, splitTeamExp, takenExp, teamShare } from './exp.ts';
import { BAG_SLOTS, buffName, canEquip, EQUIP_SLOTS, equipSlotOf, freeBagSlot, SLOT_COUNT, isUsable, itemBuffs, itemOf, type GameData, type SkillDef } from './data.ts';
import { areaCells, castCells, castRange, isChargeSkill, isHealSkill, isSupportSkill, learnedSkills, skillsLearnedAt } from './skills.ts';
import { Rng } from './rng.ts';
import { enemyFloor } from './enemy-level.ts';
import {
  attackRange, attackSkill, computeStats, DIRS, dist, facingTowards, inAttackRange, isFoe, refreshStats, resists, type Side, type Unit,
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

export type BattleEvent =
  | { type: 'say'; uid: number | null; speaker: string; text: string }
  | { type: 'narrate'; text: string }
  | { type: 'objective'; lines: string[] }
  | { type: 'phase'; side: Side; turn: number }
  | { type: 'appear'; uid: number; x: number; y: number }
  /** 剧情里退场或埋伏（离开地图，不算战败） */
  | { type: 'leave'; uid: number }
  /** 二选一：伏兵号令（EXE 0x407af3：AI 模式 9 的单位行动时弹出）。选第一项时调用 signal() */
  | { type: 'ask'; prompt: ExePrompt }
  /** 选人（剧本指令 27，见 PickRequest）：选好后调用 choose() */
  | { type: 'pick'; pick: PickRequest }
  | { type: 'move'; uid: number; path: Cell[]; facing: number }
  | { type: 'face'; uid: number; facing: number }
  /** 普通攻击与技能：cell 为施放点，area 为作用范围，hits 为每个受到攻击的单位的结算（回复/集气技为空） */
  | { type: 'attack'; uid: number; skill: SkillDef; cell: Cell; area: Cell[]; facing: number; hits: { uid: number; result: HitResult }[]; counter: boolean }
  | { type: 'hp'; uid: number; hp: number; mp: number; delta: number; /** 气的变化（回复时弹黄字） */ mpDelta?: number; text?: string }
  | { type: 'status'; uid: number; text: string }
  | { type: 'defend'; uid: number; on: boolean }
  | { type: 'die'; uid: number }
  | { type: 'message'; text: string }
  /** 原版音效（Sound/ 里的名字，不含扩展名） */
  | { type: 'sound'; name: string }
  | { type: 'pickup'; uid: number; x: number; y: number; item: number }
  | { type: 'end'; result: 'won' | 'lost'; text: string };

export interface GroundItem {
  x: number;
  y: number;
  item: number;
  /** ACT 里标了"开局隐藏"的宝物：地图上不画，但照样能拾（原版只清掉显示标志 0x2，仍挂在格子上，0x4033e8 → 0x40c240） */
  hidden: boolean;
}

export interface StageInput {
  name: string;
  board: Board;
  units: ActUnit[];
  /** .pab（Big5）：用于逻辑 */
  blocks: PasBlock[];
  /** 显示文字用的版本（如 .pas 的简体）；结构与 blocks 一致时逐条替换文字 */
  displayBlocks?: PasBlock[];
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
}

/**
 * 选人（剧本指令 27，EXE 0x411d38 置标志 0x100 → 玩家在地图上点一个我方人物 0x405d10 → 0x40de90 让其余我方、友军全部退场）。
 * 原版只出现在三关：Train1/Train2 选一人与王進过招，N-add15 主角先退场、选一人和主角一起断后（主角随后被剧本点名回到场上）。
 */
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
}

/** 时光倒流最多能回到几个回合之前（记录最近几个我方回合开始时的状态）【新】 */
export const REWIND_TURNS = 2;

export type ExpSource = 'hit' | 'counter' | 'taken' | 'dodge' | 'heal' | 'item' | 'rest' | 'kill' | 'team';

export class Battle {
  readonly name: string;
  /** .pab 文件头（城镇号、下一关）；没有剧本时为 undefined */
  readonly header?: PasHeader;
  readonly board: Board;
  readonly data: GameData;
  readonly rng: Rng;
  readonly units: Unit[] = [];
  readonly items: GroundItem[] = [];
  turn = 0;
  phase: Side = 'player';
  turnLimit = 0;
  status: 'playing' | 'won' | 'lost' = 'playing';
  objectives: string[] = [];
  private blocks: PasBlock[];
  private display?: PasBlock[];
  private fired = new Set<number>();
  /** 剧本指令 27 设置的全局标志（EXE 0x411d38，条件 3 读取）：选人期间为 true，选完清掉 */
  private scriptFlag = false;
  /** 等待玩家选人（指令 27）；选完为 null */
  pendingPick: PickRequest | null = null;
  /** 因为没被选上而退场的人（不出战，不分全队经验，下一关照常归队） */
  private benched = new Set<number>();
  /** 当前回合参数（条件 0：第 N + 1 回合开始时为 N） */
  private turnParam = -1;
  private pendingDeaths: number[] = [];
  /** 本关累计的全队经验（击倒经验的 35%），胜利后结算 */
  teamExp = 0;
  /** 过关奖励的银子（胜利时按地图名给，见 gold.ts），关卡结束时记进战役 */
  clearGold = 0;
  private tr: (s: string) => string;
  private out: BattleEvent[] = [];
  /** 开场时有我方人物（纯过场的 Act 关卡没有，不做全军覆没判定） */
  private hadPlayers: boolean;
  /** ACT 的编组号 → 单位（剧本用 1000 + 编组号指定单位） */
  private groups = new Map<number, number>();
  /** 埋伏中的单位（EXE 标志 0x40000，AI 模式 6/9）：剧本点名不会让它们登场 */
  private ambushers = new Set<number>();
  /** 时光倒流：最近 REWIND_TURNS 个我方回合开始时的完整状态（JSON，不含随机数状态），旧的在前【新】 */
  private history: { turn: number; state: string }[] = [];

  constructor(input: StageInput) {
    this.name = input.name;
    this.header = input.header;
    this.board = input.board;
    this.data = input.data;
    this.rng = new Rng(input.seed);
    this.blocks = input.blocks;
    this.display = input.displayBlocks?.length === input.blocks.length ? input.displayBlocks : undefined;
    this.tr = input.text ?? ((s) => s);
    // 开场时我方的等级（与下面逐个建单位时同一算法），用来给敌人等级保底
    const playerLevel = (a: ActUnit) => {
      const kept = input.party?.get(a.type);
      return Math.max(1, a.level, kept?.level ?? 0, kept ? 0 : (input.joinLevel ?? 0));
    };
    const mine = input.units.filter((a) => a.side === 'player' && this.data.classes[a.type]).map(playerLevel);
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
      // 构造时等级为 1，ACT 只会调高（EXE 0x404808、0x403279）。延续的人物取两者较高者，装备沿用
      const kept = a.side === 'player' ? input.party?.get(a.type) : undefined;
      if (kept) {
        slots.splice(0, slots.length, ...kept.slots);
        while (slots.length < SLOT_COUNT) slots.push(0); // 旧存档只有 7 格
      } else if (a.side === 'player') addStartItems(input.name, a.type, slots);
      const forge = slots.map((_, k) => kept?.forge?.[k] ?? 0);
      // 新入伙的人（之前没出现过）按当前队伍的平均等级入队，不低于剧本等级【新】
      const join = a.side === 'player' && !kept ? (input.joinLevel ?? 0) : 0;
      // 敌人等级保底【新】：2 级以上的敌人不低于我方平均等级 − 5（1 级的过场摆设不动）
      const level = a.side === 'enemy' && a.level > 1 ? Math.max(a.level, floor) : Math.max(1, a.level, kept?.level ?? 0, join);
      const exp = kept && kept.level >= a.level ? kept.exp : 0;
      // ACT 读入（EXE 0x4032cc 起）：flags 低字节非 0 → 隐藏（0x20000）；模式 7 → 隐藏并改为 0；模式 6/9 → 埋伏（0x40000）
      let mode = a.flags >> 8;
      let hidden = (a.flags & 0xff) !== 0;
      if (mode === 7) {
        mode = 0;
        hidden = true;
      }
      if (mode === 6 || mode === 9) this.ambushers.add(a.index);
      if (a.group && !this.groups.has(a.group)) this.groups.set(a.group, a.index);
      const stats = computeStats(cls, level, slots, this.data, false, forge);
      this.units.push({
        uid: a.index, classId: a.type, name: this.charName(a.type), side: a.side, x: a.x, y: a.y, facing: a.facing & 3,
        level, exp, hp: stats.maxHp, mp: stats.maxMp, stats, slots, forge, gold: 0,
        ai: { mode, target: a.extra[0], point: { x: a.extra[1], y: a.extra[2] } },
        present: !hidden && !this.ambushers.has(a.index), alive: true, defending: false, poisonTurns: 0, stunTurns: 0, buffs: [],
        movementRemaining: stats.move, forcedMarch: false, acted: false, ended: false, turnStart: null,
      });
    }
    this.hadPlayers = this.units.some((u) => u.side === 'player');
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
  unitAt(x: number, y: number) {
    return this.active().find((u) => u.x === x && u.y === y);
  }
  foesOf(u: Unit) {
    return this.active().filter((t) => isFoe(u.side, t.side));
  }
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
      (u.side !== 'enemy' && t.side !== 'enemy' ? pass : blocked).add(key(t.x, t.y));
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
    return this.status === 'playing' && u.side === this.phase && !u.ended && !u.acted && u.alive && u.present;
  }
  canAct(u: Unit) {
    return this.status === 'playing' && u.side === this.phase && !u.ended && u.alive && u.present;
  }
  /** 我方回合里已经没有能行动的我方人物（死亡、未登场、昏迷、行动完毕的都不算） */
  playerPhaseDone() {
    return this.status === 'playing' && this.phase === 'player' && !this.units.some((u) => u.side === 'player' && this.canAct(u));
  }
  attackTargets(u: Unit): Unit[] {
    if (!this.canAct(u) || u.acted) return [];
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
    return castCells(this.board, at, castRange(u, skill, this.data));
  }
  /** 施放点 cell 的作用范围 */
  skillArea(u: Unit, skill: SkillDef, cell: Cell, at: Cell = u): Cell[] {
    return areaCells(this.board, at, skill, cell);
  }
  /** 施放点 cell 会影响的单位：攻击技为范围内的敌人，回复技为范围内的己方，集气技为自己 */
  affected(u: Unit, skill: SkillDef, cell: Cell, at: Cell = u): Unit[] {
    if (isChargeSkill(skill)) return [u];
    const area = new Set(this.skillArea(u, skill, cell, at).map((c) => key(c.x, c.y)));
    const heal = isHealSkill(skill);
    return this.active().filter((t) => {
      const pos = t === u ? at : t;
      return area.has(key(pos.x, pos.y)) && (heal ? !isFoe(u.side, t.side) : isFoe(u.side, t.side));
    });
  }
  /** 能施放的格子（范围内至少有一个可作用的单位） */
  skillTargets(u: Unit, skill: SkillDef, at: Cell = u): Cell[] {
    return this.skillCells(u, skill, at).filter((c) => this.affected(u, skill, c, at).length > 0);
  }

  // ───────────── 流程 ─────────────

  /** 开战：执行开战事件，进入第 1 回合我方阶段 */
  begin(): BattleEvent[] {
    this.out = [];
    this.runTurnTriggers(0);
    // 开场剧本要求选人：等 choose() 选完再进第 1 回合（这样时光倒流不会回到选人之前）
    if (this.pendingPick) return this.flush();
    this.startTurn(1);
    this.record();
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

  /** 我方回合结束：友军、敌方依次行动，然后进入下一回合 */
  endPlayerPhase(): BattleEvent[] {
    this.out = [];
    if (this.status !== 'playing' || this.phase !== 'player') return [];
    for (const side of ['ally', 'enemy'] as const) {
      this.startPhase(side);
      for (const u of this.units.filter((x) => x.side === side && x.alive && (x.present || this.ambushers.has(x.uid)))) {
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
      objectives: this.objectives, fired: [...this.fired], scriptFlag: this.scriptFlag, turnParam: this.turnParam,
      pendingDeaths: this.pendingDeaths, teamExp: this.teamExp, clearGold: this.clearGold, ambushers: [...this.ambushers],
      expBySource: this.expBySource, benched: [...this.benched],
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
    this.pendingDeaths = s.pendingDeaths;
    this.teamExp = s.teamExp;
    this.clearGold = s.clearGold;
    this.ambushers = new Set(s.ambushers);
    this.expBySource = s.expBySource;
    this.benched = new Set(s.benched ?? []);
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
    if (this.turnLimit && t > this.turnLimit) return this.finish('lost', '限制回合數已到，未完成任務，遊戲失敗！');
    // 回合开始：装备回复 → 中毒 → 状态回合数 −1
    for (const u of this.active()) {
      const hp0 = u.hp, mp0 = u.mp;
      u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.regenHp);
      u.mp = Math.min(u.stats.maxMp, u.mp + u.stats.regenMp);
      if (u.poisonTurns > 0) {
        const loss = Math.max(1, Math.floor(u.stats.maxHp / 20));
        u.hp = Math.max(1, u.hp - loss); // 毒不致死【待核】
        this.emit({ type: 'message', text: `${u.name}毒發，生命力損失 ${loss} 點。` });
      }
      if (u.hp !== hp0 || u.mp !== mp0) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, mpDelta: u.mp - mp0 });
      if (u.poisonTurns > 0 && --u.poisonTurns === 0) refreshStats(u, this.data);
      if (u.stunTurns > 0) u.stunTurns--;
      if (u.buffs.length) {
        for (const b of u.buffs) b.turns--;
        u.buffs = u.buffs.filter((b) => b.turns > 0);
        refreshStats(u, this.data);
      }
    }
    this.startPhase('player');
  }

  private startPhase(side: Side) {
    this.phase = side;
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
  private emit(e: BattleEvent) {
    this.out.push(e);
  }

  // ───────────── 指令 ─────────────

  move(u: Unit, x: number, y: number): BattleEvent[] {
    this.out = [];
    if (!this.canMove(u)) return [];
    const reach = this.reachOf(u, u.movementRemaining + (u.forcedMarch ? 0 : forcedExtra(u)));
    const n = reach.get(key(x, y));
    if (!n || n.cost === 0) return [];
    if (!u.turnStart) u.turnStart = { x: u.x, y: u.y, facing: u.facing, movement: u.movementRemaining };
    const forced = n.cost > u.movementRemaining;
    this.walk(u, pathTo(reach, x, y));
    if (forced) {
      u.forcedMarch = true;
      u.movementRemaining = 0;
      u.ended = true;
    } else u.movementRemaining -= n.cost;
    this.afterAction();
    return this.flush();
  }

  canUndo(u: Unit) {
    return !!u.turnStart && !u.acted && u.side === this.phase && this.status === 'playing';
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
    return this.flush();
  }

  rest(u: Unit): BattleEvent[] {
    this.out = [];
    if (!this.canAct(u) || u.acted) return [];
    this.applyRest(u);
    u.ended = true;
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
   * 回合终了时还没行动的我方人物的默认行动【新】（负责人 2026-11-13）：
   * 体力不满 → 休息；只有气力不满 → 身上有回气剂（只回气、不回血的道具）就先对自己用，再防御，没有就休息；
   * 都满 → 防御。用道具本身不算行动，所以用完回气剂接着防御（此时体力是满的，按第 3 条）。
   */
  autoAct(u: Unit): BattleEvent[] {
    if (u.side !== 'player' || !this.canAct(u)) return [];
    const note = (text: string): BattleEvent => ({ type: 'message', text });
    const rest = () => [note(`${u.name}自動休息。`), ...this.rest(u)];
    const defend = () => [note(`${u.name}自動防禦。`), ...this.defend(u)];
    if (!u.acted && u.hp < u.stats.maxHp) return rest();
    if (u.mp < u.stats.maxMp) {
      const slot = this.mpPotionSlot(u);
      if (slot >= 0) return [...this.useItem(u, slot, u), ...defend()];
      if (!u.acted) return rest();
    }
    return defend();
  }

  /** 我方还没行动、回合终了时会自动行动的人物 */
  autoActUnits(): Unit[] {
    return this.phase === 'player' ? this.units.filter((u) => u.side === 'player' && this.canAct(u)) : [];
  }

  /**
   * 身上最合适的回气剂：只回气、不回血的道具里，挑能补满缺口的最小的一瓶；都补不满就挑回得最多的。
   * "气力全满"（healMp < 0）当作无穷大。没有返回 -1。
   */
  mpPotionSlot(u: Unit): number {
    const lack = u.stats.maxMp - u.mp;
    const amount = (k: number) => {
      const v = itemOf(this.data, u.slots[k])!.healMp;
      return v < 0 ? Infinity : v;
    };
    const slots = this.usableSlots(u).filter((k) => {
      const it = itemOf(this.data, u.slots[k])!;
      return it.healMp !== 0 && !it.healHp;
    });
    if (!slots.length) return -1;
    const enough = slots.filter((k) => amount(k) >= lack).sort((a, b) => amount(a) - amount(b));
    if (enough.length) return enough[0];
    return slots.sort((a, b) => amount(b) - amount(a))[0];
  }

  wait(u: Unit): BattleEvent[] {
    if (!this.canAct(u)) return [];
    u.ended = true;
    return [];
  }

  /** 可以使用的道具槽（回复、解毒解昏、抗毒抗昏、增益；类型 15–22） */
  usableSlots(u: Unit): number[] {
    if (!this.canAct(u)) return [];
    return u.slots.flatMap((id, k) => (isUsable(itemOf(this.data, id)) ? [k] : []));
  }

  /**
   * 道具能用在谁身上：自己和上下左右相邻格的非敌方单位。
   * 原版"使用"指令（0x409618）调 0x40d5d0(位置, 0, 1)，沿 4 个方向标出距离 0–1 的格子；
   * 执行时（0x409798）只要光标处的单位不是敌方（unit+0x3b ≠ 2）就交给 0x408dc0。
   */
  itemTargets(u: Unit, slot: number): Unit[] {
    if (!this.usableSlots(u).includes(slot)) return [];
    return this.active().filter((t) => dist(u, t) <= 1 && !isFoe(u.side, t.side));
  }

  /** 使用道具：不算行动、不消耗移动力、不限次数（原版 0x409798 → 0x408dc0 → 0x4094e0，不碰行动结束标志） */
  useItem(u: Unit, slot: number, target: Unit = u): BattleEvent[] {
    this.out = [];
    if (!this.itemTargets(u, slot).includes(target)) return [];
    this.applyItem(u, slot, target);
    this.gainExp(u, itemExp(this.rng), 'item');
    u.turnStart = null;
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
    this.emit({ type: 'message', text: `${u.name}把${this.tr(it.name)}交給了${target.name}。` });
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

  private walk(u: Unit, path: Cell[]) {
    if (path.length < 2) return;
    const last = path[path.length - 1], prev = path[path.length - 2];
    u.x = last.x;
    u.y = last.y;
    u.facing = facingTowards(prev, last, u.facing);
    this.emit({ type: 'move', uid: u.uid, path, facing: u.facing });
    // 原版只有我方在移动的每一帧检查脚下的格子（0x405500 → 0x409c30），踩上宝箱才拾起。
    // 重制版【新：负责人 2026-11-12】：只有我方，走到宝箱上或上下左右相邻的格子（路过也算）就自动打开
    if (u.side !== 'player') return;
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
      this.emit({ type: 'message', text: `${u.name}的道具已滿，打不開寶箱。` });
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
    const targets = this.affected(u, skill, cell);
    const area = this.skillArea(u, skill, cell);
    if (cell.x !== u.x || cell.y !== u.y) u.facing = facingTowards(u, cell, u.facing);
    u.mp -= skill.mpCost;
    const basic = skill === attackSkill(u, this.data);
    if (isSupportSkill(skill)) {
      this.emit({ type: 'attack', uid: u.uid, skill, cell, area, facing: u.facing, hits: [], counter });
      if (skill.mpCost && !targets.includes(u)) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0 });
      const name = this.tr(skill.name);
      let healed = 0;
      for (const t of targets) {
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
    const hits = targets.map((t) => ({ t, r: rollAttack(u, t, skill, this.rng, counter) }));
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
      t.hp = Math.max(0, t.hp - r.damage);
      total += r.damage;
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
      if (r.stunned && t.stunTurns === 0 && !resists(t, 'resistStun')) {
        t.stunTurns = this.rng.range(2, 4);
        this.emit({ type: 'status', uid: t.uid, text: '昏迷了！' });
      }
      exp += hitExp(r.damage, this.rng) + (counter ? counterExp(this.rng) : 0);
      if (t.side === 'player') this.gainExp(t, takenExp(r.damage, t.defending, this.rng), 'taken');
    }
    if (hits.length > 1) this.emit({ type: 'message', text: total > 0 ? `造成敵方總共 ${total} 點傷害。` : `${u.name}的攻擊落空了。` });
    if (u.side === 'player' && exp && u.alive) this.gainExp(u, exp, counter ? 'counter' : 'hit');
    if (counterBy && counterBy.alive && u.alive) this.cast(counterBy, attackSkill(counterBy, this.data), u, true);
  }

  /** dmgExp：击倒那一下的伤害经验，并入击倒经验一起按 65/35 分 */
  private kill(u: Unit, t: Unit, dmgExp = 0) {
    t.alive = false;
    t.defending = false;
    this.emit({ type: 'die', uid: t.uid });
    this.emit({ type: 'message', text: `${t.name}戰敗了。` });
    this.pendingDeaths.push(t.classId);
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
    if (u.side !== 'player' || !n) return;
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
      for (const s of skillsLearnedAt(u, this.data, u.level)) this.emit({ type: 'message', text: `${u.name}領悟了${this.tr(s.name)}！` });
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

  private ambushTurn(u: Unit) {
    if (u.ai.mode !== 6) return void (u.ended = true);
    const r = alertRadius(this, u);
    if (!this.foesOf(u).some((t) => Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= r)) return void (u.ended = true);
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

  private runAi(u: Unit) {
    const plan = planAi(this, u);
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
    while (this.pendingDeaths.length) {
      const c = this.pendingDeaths.shift()!;
      for (const b of this.blocks)
        if (b.trigger.kind === 'death' && (b.trigger.char === c || (b.trigger.char === 1000 && c === 0))) this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    // 角色号 255：敌方全灭（推测：只在全灭时出现，如 N-add01 的胜利区块）
    if (!this.units.some((u) => u.side === 'enemy' && u.alive && u.present))
      for (const b of this.blocks) if (b.trigger.kind === 'death' && b.trigger.char === 255) this.runBlock(b);
    if (this.status !== 'playing') return;
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'area' || this.fired.has(b.index)) continue;
      const u = this.unitByChar(t.char);
      if (u && u.x >= Math.min(t.x1, t.x2) && u.x <= Math.max(t.x1, t.x2) && u.y >= Math.min(t.y1, t.y2) && u.y <= Math.max(t.y1, t.y2))
        this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    this.runCondBlocks();
    if (this.status !== 'playing') return;
    if (this.hadPlayers && !this.units.some((u) => u.side === 'player' && u.alive)) this.finish('lost', '我方全軍覆沒。');
  }

  private runTurnTriggers(param: number) {
    this.turnParam = param;
    for (const b of this.blocks) if (b.trigger.kind === 'turn' && b.trigger.turn === param) this.runBlock(b);
    this.runCondBlocks();
  }

  /** 组合条件等其它区块：状态满足就执行（EXE 0x412000 逐块调用 0x411410 求值） */
  private runCondBlocks() {
    for (const b of this.blocks) {
      if (this.status !== 'playing') return;
      if (b.trigger.kind !== 'cond' || this.fired.has(b.index)) continue;
      let sel: Unit | undefined;
      if (this.evalCond(b.cond, (u) => (sel = u), () => sel)) this.runBlock(b);
    }
  }

  /**
   * 条件求值（EXE 0x411220）。0 回合；1 死亡（0x400 = 我方全灭、0xFF = 敌方全灭）；2 某人已现身；3 指令 27 的标志；
   * 4 选定某人（之后 5–10 比较他的坐标：5 x =、6 y =、7 x ≥、8 y ≥、9 x ≤、10 y ≤）；11 某人活着（0xFF = 我方无人阵亡）。
   * 角色号 ≥ 1000 时为 角色号 − 1000，且不论是否隐藏；< 1000 时隐藏的人算不在。
   */
  private evalCond(c: PasCond, select: (u: Unit | undefined) => void, selected: () => Unit | undefined): boolean {
    if ('op' in c) {
      const a = this.evalCond(c.a, select, selected), b = this.evalCond(c.b, select, selected);
      return c.op === 'and' ? a && b : a || b;
    }
    const find = (arg: number) => {
      const id = arg >= 1000 ? arg - 1000 : arg;
      return this.units.find((u) => u.classId === id && u.alive && (arg >= 1000 || u.present));
    };
    const s = selected();
    switch (c.type) {
      case 0:
        return this.turnParam === c.arg;
      case 1:
        if (c.arg === 0x400) return !this.units.some((u) => u.side === 'player' && u.alive);
        if (c.arg === 0xff) return !this.units.some((u) => u.side === 'enemy' && u.alive && u.present);
        return !find(c.arg);
      case 2:
        return false; // 伏兵号令后由 signal() 执行（推测）
      case 3:
        return this.scriptFlag === (c.arg === 1);
      case 4: {
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
   * 执行一个 PAS 区块（指令 12–21 由 EXE 0x411690 分派）：12 选人（隐藏的随之登场）、13 说话、14/15 坐标、16 AI 模式、
   * 17 动作（见下）、29 过关旁白（区块结束后判胜）、30 失败结局、31–33 条件、35 回合限制。28 = 区块结束（0x411cf9）。
   */
  private runBlock(b: PasBlock) {
    if (this.fired.has(b.index)) return;
    this.fired.add(b.index);
    const shown = this.display?.[b.index];
    const textOf = (i: number) => {
      const d = shown?.ops[i];
      const t = d && d.op === b.ops[i].op && d.text ? d.text : (b.ops[i].text ?? '');
      // EXE 0x4106b4：%N、%X = 主角名（名字表第 0 项），%M = 主角绰号（绰号表第 0 项）
      return t.replace(/%[NX]/g, this.data.heroName).replace(/%M/g, this.data.heroNickname ?? '');
    };
    let sel: Unit | undefined;
    let selName = '';
    let px = 0, py = 0;
    let mode = 0;
    let ending: string | null = null;
    let cleared = false;
    let objective: string[] = [];
    const flushObjective = () => {
      if (objective.length) {
        this.objectives = objective;
        this.emit({ type: 'objective', lines: objective });
        objective = [];
      }
    };
    b.ops.forEach((op, i) => {
      if (op.op < 31 || op.op > 33) flushObjective();
      switch (op.op) {
        case 12:
          // 1001 起为 1000 + ACT 编组号（N-add03 开场 1006 = 王進下令、1007/1008 = 莊客应答；N03 第 11 回合 1030–1037 = 编组 30–37 的伏兵）
          if (op.value > 1000 && op.value < 0x10000) sel = this.unit(this.groups.get(op.value - 1000) ?? -1);
          else if (op.value <= 1000) sel = this.units.find((u) => u.classId === (op.value === 1000 ? 0 : op.value) && u.alive);
          else sel = undefined; // 0xFFFFFFFF：旁白
          selName = sel ? sel.name : op.value <= 1000 ? this.charName(op.value) : '';
          // 被点名的隐藏人物随之登场（EXE 0x41154b：标志 0x20000 时调用 0x408430），埋伏中的不受影响
          if (sel && !sel.present && sel.alive && !this.ambushers.has(sel.uid)) this.appear(sel);
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
            if (path.length > 1) this.walk(sel, path);
          }
          break;
        }
        // 18/19：换背景音乐（EXE 0x411710 → 0x423970：曲目号经 0x447cb3 表映射，交给 0x448768 播放器；18 的值一并传入，推测为是否循环）。重制版用自己的配乐，忽略
        // 27：值为 1 时置全局标志（EXE 0x411d38），出现在 N-add15"請選擇留下的人"和训练关开场的末尾，推测是打开选人界面、
        // 选完后清掉标志，于是条件 3（参数 0）的下一个区块（回合限制、条件文字）才执行。重制版还没有选人界面，视为立即选完
        case 27:
          if (op.value === 1) this.openPick(b, i, textOf);
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
        case 32:
        case 33:
          objective.push(textOf(i));
          break;
        case 35:
          this.turnLimit = op.value & 0xffff;
          break;
      }
    });
    flushObjective();
    if (ending !== null) return this.finish('lost', ending);
    if (cleared) this.finish('won', '');
  }

  /** 指令 27：打开选人（提示取同一区块里指令 27 之前最后一句旁白，没有就用重制版的文字） */
  private openPick(b: PasBlock, at: number, textOf: (i: number) => string) {
    this.scriptFlag = true;
    let prompt = '';
    for (let i = at - 1; i >= 0 && !prompt; i--) {
      if (b.ops[i].op !== 13) continue;
      const who = b.ops.slice(0, i).filter((o) => o.op === 12).pop();
      if (who && who.value === 0xffffffff) prompt = textOf(i);
      break;
    }
    const mine = this.units.filter((u) => u.side === 'player' && u.alive);
    const candidates = mine.filter((u) => u.present);
    const best = candidates.reduce<Unit | undefined>((a, u) => (!a || u.level > a.level ? u : a), undefined);
    this.pendingPick = {
      prompt: prompt || (/^train/i.test(this.name) ? '請選擇與王進過招的人' : '請選擇出戰的人'),
      candidates: candidates.map((u) => u.uid),
      required: mine.filter((u) => !u.present && u.classId === 0).map((u) => u.uid),
      count: 1,
      recommended: best ? [best.uid] : [],
    };
    this.emit({ type: 'pick', pick: this.pendingPick });
  }

  private appear(u: Unit) {
    const c = this.board.nearestFree(u.x, u.y, this.occupied(u)) ?? u;
    u.x = c.x;
    u.y = c.y;
    u.present = true;
    this.ambushers.delete(u.uid);
    u.ended = u.side === this.phase;
    this.emit({ type: 'appear', uid: u.uid, x: u.x, y: u.y });
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
      this.settleTeamExp();
      this.clearGold = this.hadPlayers ? stageClearGold(this.name) : 0;
      if (this.clearGold) this.emit({ type: 'message', text: `過關獎勵：得到銀子 ${this.clearGold} 兩！` });
    }
    this.status = result;
    this.emit({ type: 'end', result, text });
  }
}
