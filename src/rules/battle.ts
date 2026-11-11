// 战斗状态机：回合、指令、AI 行动、PAS 事件与胜负。只改状态并输出事件流，画面由 game/ 播放。
import type { ActUnit } from '../formats/act.ts';
import type { PasBlock } from '../formats/pas.ts';
import { planAi } from './ai.ts';
import { Board, key, pathTo, type Cell } from './board.ts';
import { canCounter, hitExp, killExp, killGold, previewAttack, rollAttack, type AttackPreview, type HitResult } from './combat.ts';
import { isHealing, itemOf, type GameData } from './data.ts';
import { Rng } from './rng.ts';
import {
  attackRange, attackSkill, computeStats, DIRS, facingTowards, inAttackRange, isFoe, refreshStats, type Side, type Unit,
} from './unit.ts';

export const MAX_PLAYER_LEVEL = 30;
export const EXP_PER_LEVEL = 100;
/** 强行军：黄色范围 = 剩余移动力 + 移动力的一半（向上取整）。原版固定 +1，负责人决定用这个【新】 */
export const forcedExtra = (u: Unit) => Math.ceil(u.stats.move / 2);
/** 休息：恢复上限的 1/15（暂定【待核】） */
export const REST_DIVISOR = 15;

export type BattleEvent =
  | { type: 'say'; uid: number | null; speaker: string; text: string }
  | { type: 'narrate'; text: string }
  | { type: 'objective'; lines: string[] }
  | { type: 'phase'; side: Side; turn: number }
  | { type: 'appear'; uid: number; x: number; y: number }
  | { type: 'move'; uid: number; path: Cell[]; facing: number }
  | { type: 'face'; uid: number; facing: number }
  | { type: 'attack'; uid: number; target: number; facing: number; result: HitResult; counter: boolean }
  | { type: 'hp'; uid: number; hp: number; mp: number; delta: number; text?: string }
  | { type: 'status'; uid: number; text: string }
  | { type: 'defend'; uid: number; on: boolean }
  | { type: 'die'; uid: number }
  | { type: 'message'; text: string }
  | { type: 'pickup'; uid: number; x: number; y: number; item: number }
  | { type: 'end'; result: 'won' | 'lost'; text: string };

export interface GroundItem {
  x: number;
  y: number;
  item: number;
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
}

export class Battle {
  readonly name: string;
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
  private pendingDeaths: number[] = [];
  private tr: (s: string) => string;
  private out: BattleEvent[] = [];

  constructor(input: StageInput) {
    this.name = input.name;
    this.board = input.board;
    this.data = input.data;
    this.rng = new Rng(input.seed);
    this.blocks = input.blocks;
    this.display = input.displayBlocks?.length === input.blocks.length ? input.displayBlocks : undefined;
    this.tr = input.text ?? ((s) => s);
    for (const a of input.units) {
      if (a.side === 'object') {
        if (a.type > 0 && a.type <= this.data.items.length) this.items.push({ x: a.x, y: a.y, item: a.type });
        continue;
      }
      if (a.side === 'unknown') continue;
      const cls = this.data.classes[a.type];
      if (!cls) continue;
      const slots = cls.defaultItems.slice(0, 7);
      a.items.forEach((id, k) => id && (slots[k] = id));
      const level = Math.max(1, a.level); // 构造时等级为 1，ACT 只会调高（EXE 0x404808、0x403279）
      const mode = a.flags >> 8;
      const stats = computeStats(cls, level, slots, this.data);
      this.units.push({
        uid: a.index, classId: a.type, name: this.charName(a.type), side: a.side, x: a.x, y: a.y, facing: a.facing & 3,
        level, exp: 0, hp: stats.maxHp, mp: stats.maxMp, stats, slots, gold: 0,
        ai: { mode, target: a.extra[0], point: { x: a.extra[1], y: a.extra[2] } },
        present: (a.flags & 0xff) === 0 && mode !== 7, alive: true, defending: false, poisonTurns: 0, stunTurns: 0,
        movementRemaining: stats.move, forcedMarch: false, acted: false, ended: false, itemUsed: false, turnStart: null,
      });
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
  unitAt(x: number, y: number) {
    return this.active().find((u) => u.x === x && u.y === y);
  }
  foesOf(u: Unit) {
    return this.active().filter((t) => isFoe(u.side, t.side));
  }
  occupied(except?: Unit) {
    return new Set(this.active().filter((u) => u !== except).map((u) => key(u.x, u.y)));
  }
  reachOf(u: Unit, budget: number) {
    return this.board.reach(u, budget, this.occupied(u));
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
  preview(u: Unit, t: Unit): AttackPreview {
    return previewAttack(u, t, attackSkill(u, this.data));
  }

  // ───────────── 流程 ─────────────

  /** 开战：执行开战事件，进入第 1 回合我方阶段 */
  begin(): BattleEvent[] {
    this.out = [];
    this.runTurnTriggers(0);
    this.startTurn(1);
    return this.flush();
  }

  /** 我方回合结束：友军、敌方依次行动，然后进入下一回合 */
  endPlayerPhase(): BattleEvent[] {
    this.out = [];
    if (this.status !== 'playing' || this.phase !== 'player') return [];
    for (const side of ['ally', 'enemy'] as const) {
      this.startPhase(side);
      for (const u of this.active().filter((x) => x.side === side)) {
        if (this.status !== 'playing') break;
        if (!u.alive || !u.present || u.ended) continue;
        this.runAi(u);
      }
      if (this.status !== 'playing') return this.flush();
    }
    this.startTurn(this.turn + 1);
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
      if (u.hp !== hp0 || u.mp !== mp0) this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0 });
      if (u.poisonTurns > 0 && --u.poisonTurns === 0) refreshStats(u, this.data);
      if (u.stunTurns > 0) u.stunTurns--;
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
      u.itemUsed = false;
      u.turnStart = null;
      u.ended = u.stunTurns > 0;
    }
    this.emit({ type: 'phase', side, turn: this.turn });
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
    this.strike(u, t, false);
    u.acted = true;
    u.ended = true; // 攻击后用完剩余移动力
    u.movementRemaining = 0;
    this.afterAction();
    return this.flush();
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
    const hp0 = u.hp;
    u.hp = Math.min(u.stats.maxHp, u.hp + Math.max(1, Math.floor(u.stats.maxHp / REST_DIVISOR)));
    u.mp = Math.min(u.stats.maxMp, u.mp + Math.max(1, Math.floor(u.stats.maxMp / REST_DIVISOR)));
    u.ended = true;
    this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, text: '休息' });
    return this.flush();
  }

  wait(u: Unit): BattleEvent[] {
    if (!this.canAct(u)) return [];
    u.ended = true;
    return [];
  }

  /** 可以使用的道具槽（回复、解毒、解昏） */
  usableSlots(u: Unit): number[] {
    if (!this.canAct(u) || u.itemUsed) return [];
    return u.slots.flatMap((id, k) => {
      const it = itemOf(this.data, id);
      return it && (isHealing(it) || it.type === 18 || it.type === 19) ? [k] : [];
    });
  }

  /** 对自己使用道具：不消耗移动力，每回合一次【待核】 */
  useItem(u: Unit, slot: number): BattleEvent[] {
    this.out = [];
    if (!this.usableSlots(u).includes(slot)) return [];
    this.applyItem(u, slot);
    u.itemUsed = true;
    u.turnStart = null;
    return this.flush();
  }

  private applyItem(u: Unit, slot: number) {
    const it = itemOf(this.data, u.slots[slot])!;
    u.slots[slot] = 0;
    const hp0 = u.hp;
    if (it.healHp) u.hp = it.healHp < 0 ? u.stats.maxHp : Math.min(u.stats.maxHp, u.hp + it.healHp);
    if (it.healMp) u.mp = it.healMp < 0 ? u.stats.maxMp : Math.min(u.stats.maxMp, u.mp + it.healMp);
    if (it.type === 18 || it.curePoison) {
      u.poisonTurns = 0;
      refreshStats(u, this.data);
    }
    if (it.type === 19 || it.cureStun) u.stunTurns = 0;
    this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: u.hp - hp0, text: this.tr(it.name) });
  }

  // ───────────── 结算 ─────────────

  private walk(u: Unit, path: Cell[]) {
    if (path.length < 2) return;
    const last = path[path.length - 1], prev = path[path.length - 2];
    u.x = last.x;
    u.y = last.y;
    u.facing = facingTowards(prev, last, u.facing);
    this.emit({ type: 'move', uid: u.uid, path, facing: u.facing });
    if (u.side === 'player') this.pickup(u);
  }

  private pickup(u: Unit) {
    const i = this.items.findIndex((g) => g.x === u.x && g.y === u.y);
    if (i < 0) return;
    const slot = u.slots.indexOf(0);
    if (slot < 0) return this.emit({ type: 'message', text: `${u.name}的道具已滿。` });
    const g = this.items.splice(i, 1)[0];
    u.slots[slot] = g.item;
    u.turnStart = null; // 拾取后不能撤销移动
    refreshStats(u, this.data);
    this.emit({ type: 'pickup', uid: u.uid, x: g.x, y: g.y, item: g.item });
    this.emit({ type: 'message', text: `${u.name}得到了${this.tr(itemOf(this.data, g.item)!.name)}。` });
  }

  private strike(u: Unit, t: Unit, counter: boolean) {
    const skill = attackSkill(u, this.data);
    u.facing = facingTowards(u, t, u.facing);
    const r = rollAttack(u, t, skill, this.rng, counter);
    this.emit({ type: 'attack', uid: u.uid, target: t.uid, facing: u.facing, result: r, counter });
    if (counter) this.emit({ type: 'message', text: `${u.name}施展反擊技，` });
    if (!r.hit) {
      this.emit({ type: 'message', text: `${u.name}的攻擊落空了。` });
      // 防御中闪避相邻攻击：50% 反击，必定命中
      if (!counter && canCounter(u, t) && this.rng.chance(50)) this.strike(t, u, true);
      return;
    }
    const hp0 = t.hp;
    t.hp = Math.max(0, t.hp - r.damage);
    t.facing = facingTowards(t, u, t.facing); // 受击时转向攻击者
    this.emit({ type: 'face', uid: t.uid, facing: t.facing });
    this.emit({ type: 'hp', uid: t.uid, hp: t.hp, mp: t.mp, delta: t.hp - hp0 });
    this.emit({ type: 'message', text: r.damage > 0 ? `${r.crit ? '必殺！' : ''}${r.damage} 點傷害。` : '未造成敵方傷害。' });
    if (t.hp === 0) return this.kill(u, t);
    if (r.poisoned && t.poisonTurns === 0) {
      t.poisonTurns = this.rng.range(2, 4);
      refreshStats(t, this.data);
      this.emit({ type: 'status', uid: t.uid, text: '中毒了！' });
    }
    if (r.stunned && t.stunTurns === 0) {
      t.stunTurns = this.rng.range(2, 4);
      this.emit({ type: 'status', uid: t.uid, text: '昏迷了！' });
    }
    if (u.side === 'player') this.gainExp(u, hitExp(r.damage, this.rng));
  }

  private kill(u: Unit, t: Unit) {
    t.alive = false;
    t.defending = false;
    this.emit({ type: 'die', uid: t.uid });
    this.emit({ type: 'message', text: `${t.name}戰敗了。` });
    this.pendingDeaths.push(t.classId);
    if (u.side === 'player' && t.side === 'enemy') {
      const gold = killGold(t, this.data, this.rng);
      if (gold) {
        u.gold += gold;
        this.emit({ type: 'message', text: `擊退了敵人，得到黃金 ${gold} 兩！` });
      }
      this.gainExp(u, killExp(u, t, this.rng));
    }
  }

  private gainExp(u: Unit, n: number) {
    u.exp += n;
    while (u.exp >= EXP_PER_LEVEL) {
      u.exp -= EXP_PER_LEVEL;
      if (u.level < MAX_PLAYER_LEVEL) u.level++;
      refreshStats(u, this.data);
      u.hp = u.stats.maxHp;
      u.mp = u.stats.maxMp;
      this.emit({ type: 'hp', uid: u.uid, hp: u.hp, mp: u.mp, delta: 0, text: '升級了！' });
      this.emit({ type: 'message', text: `${u.name}升級了！（Lv${u.level}）` });
    }
  }

  private runAi(u: Unit) {
    const plan = planAi(this, u);
    if (plan.healSlot !== undefined) {
      this.applyItem(u, plan.healSlot);
    } else {
      if (plan.path && plan.path.length > 1) {
        this.walk(u, plan.path);
        this.afterAction();
      }
      if (this.status === 'playing' && plan.target && plan.target.alive && u.alive) {
        if (inAttackRange(u, plan.target, attackRange(u, this.data))) this.strike(u, plan.target, false);
      }
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
    for (const b of this.blocks) {
      const t = b.trigger;
      if (t.kind !== 'area' || this.fired.has(b.index)) continue;
      const u = this.unitByChar(t.char);
      if (u && u.x >= Math.min(t.x1, t.x2) && u.x <= Math.max(t.x1, t.x2) && u.y >= Math.min(t.y1, t.y2) && u.y <= Math.max(t.y1, t.y2))
        this.runBlock(b);
      if (this.status !== 'playing') return;
    }
    if (!this.units.some((u) => u.side === 'player' && u.alive)) this.finish('lost', '我方全軍覆沒。');
  }

  private runTurnTriggers(param: number) {
    for (const b of this.blocks) if (b.trigger.kind === 'turn' && b.trigger.turn === param) this.runBlock(b);
  }

  /** 执行一个 PAS 区块。已知指令：12 选人、13 说话、14/15/17 移动、18 登场（推测）、29/30 旁白/结局、31–33 条件、35 回合限制 */
  private runBlock(b: PasBlock) {
    if (this.fired.has(b.index)) return;
    this.fired.add(b.index);
    const shown = this.display?.[b.index];
    const textOf = (i: number) => {
      const d = shown?.ops[i];
      const t = d && d.op === b.ops[i].op && d.text ? d.text : (b.ops[i].text ?? '');
      return t.replace(/%[NX]/g, this.data.heroName);
    };
    let sel: Unit | undefined;
    let selName = '';
    let px = 0, py = 0;
    let ending: string | null = null;
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
          if (op.flag === 0 && op.value >= 1000) sel = this.units.find((u) => u.uid === op.value - 1000);
          else sel = this.units.find((u) => u.classId === (op.value === 1000 ? 0 : op.value) && u.alive);
          selName = sel ? sel.name : this.charName(op.value);
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
        case 17:
          if (sel && sel.present && sel.alive) {
            const reach = this.reachOf(sel, 99);
            const path = reach.has(key(px, py)) ? pathTo(reach, px, py) : [];
            if (path.length > 1) this.walk(sel, path);
          }
          break;
        case 18:
          if (sel && !sel.present && sel.alive) this.appear(sel);
          break;
        case 29:
          this.emit({ type: 'narrate', text: textOf(i) });
          break;
        case 30:
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
    if (b.trigger.kind === 'area') this.finish('won', '');
  }

  private appear(u: Unit) {
    const c = this.board.nearestFree(u.x, u.y, this.occupied(u)) ?? u;
    u.x = c.x;
    u.y = c.y;
    u.present = true;
    u.ended = u.side === this.phase;
    this.emit({ type: 'appear', uid: u.uid, x: u.x, y: u.y });
  }

  private finish(result: 'won' | 'lost', text: string) {
    if (this.status !== 'playing') return;
    this.status = result;
    this.emit({ type: 'end', result, text });
  }
}
