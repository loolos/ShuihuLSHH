// 战斗场景（M-B）：渲染地图与单位，接收玩家操作，播放规则引擎输出的事件流。
import { text as loc } from '../i18n/index.ts';
import Phaser from 'phaser';
import { Battle, type BattleEvent, type StageInput } from '../rules/battle.ts';
import { watcherSees } from '../rules/combat.ts';
import { expToNext } from '../rules/exp.ts';
import type { Cell } from '../rules/board.ts';
import type { Member } from '../rules/campaign.ts';
import { loadStage, loadStageMap, stageMap } from '../rules/load.ts';
import { canEquip, EQUIP_SLOTS, equipSlotOf, isUsable, itemOf, itemSummary, type SkillDef } from '../rules/data.ts';
import { announcesSkill, isHealSkill, isSupportSkill, learnedSkills, skillBonusText } from '../rules/skills.ts';
import { sound } from './sound.ts';
import { music } from './music.ts';
import { attackSkill, type Unit } from '../rules/unit.ts';
import { ensureSkill, frameToCanvas, prefetchSkills, type Assets } from './assets.ts';
import { cellToWorld, depthOf, HALF_H, HALF_W, worldToCell } from './iso.ts';
import { Minimap, type MiniMark, type MiniZone, zoneCorners } from './minimap.ts';
import { multiTouch, releaseStalePointers } from './touch.ts';
import { coarseMask, OccluderIndex, type CoarseMask } from './occlusion.ts';
import { dirIndex, FIXED_FX, FX_BLAZE, FX_COUNTER, FX_DEFEND, HIT_FX_GROUP, fxChain, fxGroups, fxSpots, skillFx } from './effects.ts';
import { MISS_FLOAT, damageFloat, recoveryFloats } from './float-text.ts';
import { applyTint, isStageTint, type StageTint } from './tint.ts';
import { actionMs, castPlayMs, castPlaybackRate, castSegmentMs } from './cast-timing.ts';
import { ACTION, HEAD_STD, ACTION_FRAME_MS, animFor, EFFECT_FRAME_MS, effectAnim, blazeAnim, classHead, idleAction, textureFor } from './sprites.ts';
import type { BattleUI, Command } from './ui.ts';
import { prisonCartCanvas } from './prison-cart.ts';
import { packFaceUrl } from './packs.ts';
import { CujuView } from './cuju-view.ts';
import type { KickPreview } from '../rules/battle.ts';

export interface BattleSceneData {
  assets: Assets;
  stage: string;
  ui: BattleUI;
  seed?: number;
  /** 前面关卡延续下来的我方人物 */
  party?: Map<number, Member>;
  /** 新入伙的人的入队等级（campaign.ts joinLevel） */
  joinLevel?: number;
  /** 关卡结束（胜负面板由调用方决定） */
  onEnd?: (battle: Battle, won: boolean, text: string) => void;
  /** 扩展包关卡：画哪张原版地图，以及每次开打（含重新开始）时生成关卡数据 */
  map?: string;
  makeInput?: () => StageInput;
  /** 天色滤镜（扩展包关卡的 tint，§15.15） */
  tint?: StageTint;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'selected'; u: Unit }
  | { kind: 'move'; u: Unit }
  | { kind: 'attack'; u: Unit }
  | { kind: 'item'; u: Unit }
  /** 选中了一格道具；op = 正在选使用 / 给予的对象，或确认丢弃 */
  | { kind: 'itemSlot'; u: Unit; slot: number; op?: 'use' | 'give' | 'discard' }
  | { kind: 'skills'; u: Unit }
  | { kind: 'skill'; u: Unit; skill: SkillDef };
const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

type AppearEvent = Extract<BattleEvent, { type: 'appear' }>;
type LeaveEvent = Extract<BattleEvent, { type: 'leave' }>;
/** 剧情登场淡入、退场淡出的时长（ms）。原来分别是 400 / 500，而且一个接一个播；现在缩短，连着的几个人同时播【新】 */
const APPEAR_MS = 250;
const LEAVE_MS = 250;
/** 一批人同时登场时，最后一个人比第一个人最多晚多久开始淡入 */
const APPEAR_SPREAD_MS = 400;

const PHASE_NAME = { player: '我方', ally: '友军', enemy: '敌方' } as const;
// 友军墨绿（负责人 2026-11-13：原来的蓝色和经验条太像）
const SIDE_COLOR = { player: 0x6fbf5a, ally: 0x2e6e3e, enemy: 0xd0603e } as const;
/** 胜负条件区域的颜色【新】：撤退出口青色、敌人逃跑出口品红，和阵营色、宝箱黄都分得开 */
const ZONE_STYLE = { goal: { color: 0x4fe3ff, label: '撤退' }, danger: { color: 0xff5ad8, label: '敌逃' } } as const;
const MP_COLOR = 0xe0c040;
const EXP_COLOR = 0x4a8ff0;
const ACTED_FRAME = 0xb8b8b8; // 行动完的灰框
/** 行动完的状态条颜色：稍微去点饱和度再压暗到七成 */
function dimColor(c: number) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const f = (x: number) => Math.round((x * 0.7 + l * 0.3) * 0.7);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
/** 状态条最高处离脚下的高度（头顶往上空 3 像素，再按 3 条算），飘字从这上面弹出 */
const barTop = (head: number) => head + 3 + 3 * 3 + 1;
const SLOT_LABEL = ['武器', '衣服', '头饰'];
const slotLabel = (slot: number) => SLOT_LABEL[slot] ?? '物品';
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));

export class BattleScene extends Phaser.Scene {
  private assets!: Assets;
  private ui!: BattleUI;
  private stageName = 'N01';
  /** 画哪张地图（原版关卡 = 关卡名；扩展包关卡借的原版地图） */
  private mapName = 'N01';
  private tint: StageTint | undefined;
  /** 当前的天色滤镜（剧情里可以换，扩展包指令 tint） */
  private tintFilter?: Phaser.Filters.Controller;
  private makeInput?: () => StageInput;
  private seed?: number;
  private party?: Map<number, Member>;
  private joinLevel?: number;
  private onEnd?: BattleSceneData['onEnd'];
  battle!: Battle;
  /** head：头顶高度（世界像素，见 classHead），状态条和飘字放在它上面 */
  private sprites = new Map<number, { spr: Phaser.GameObjects.Sprite; bar: Phaser.GameObjects.Graphics; cart?: Phaser.GameObjects.Image; head: number }>();
  /**
   * 画面上的人物状态。规则引擎一次算完整个敌方回合，事件再逐个回放；
   * 回放期间画面必须按事件推进，不能直接读引擎里的最终位置和体力。
   */
  /** 画面上的状态（回放到哪一步就是哪一步；cls 是画面上的职业，剧本换职业时引擎先变、画面回放到 look 才变） */
  private view = new Map<number, { x: number; y: number; facing: number; hp: number; mp: number; cls: number }>();
  private groundItems = new Map<string, Phaser.GameObjects.Image>();
  /** 地上物的遮挡索引，和被挡住的人物的虚影（按单位 uid；key 记下上次判断时的位置和帧，没变就不重算） */
  private occluders = new OccluderIndex();
  private upperImages = new Map<string, Phaser.GameObjects.Image[]>();
  private ghosts = new Map<number, { img: Phaser.GameObjects.Image; key: string; cover: number | null }>();
  private overlay!: Phaser.GameObjects.Graphics;
  /** 地图上的撤退出口等区域（Battle.objectiveZones），变了才重画 */
  private zoneG!: Phaser.GameObjects.Graphics;
  private zoneSig = '';
  private zones: MiniZone[] = [];
  /** 火势蔓延【新】：着火的格子和格子上的火焰 */
  private fireCells: Cell[] = [];
  private fireSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private minimap: Minimap | null = null;
  private hoverG!: Phaser.GameObjects.Graphics;
  private mode: Mode = { kind: 'idle' };
  private busy = false;
  /** 正在执行回合终了（自动行动 + 友军敌方回合），防止重复点击 */
  private ending = false;
  /** 本场已经播过过关 / 失败音（剧本指令 29 / 30） */
  private endSound = false;
  /** 非我方阶段双击后快进：时间、补间、动画都加速，镜头直接跳过去【新】 */
  private fast = false;
  /** 蹴鞠关的球（画面）；不是蹴鞠关为 null */
  private cujuView: CujuView | null = null;
  private lastTap = 0;
  /** 正在回放的阶段（引擎已经算到下一回合，不能用 battle.phase） */
  private playingSide: 'player' | 'ally' | 'enemy' = 'player';
  private down: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private hoverCell: Cell | null = null;
  /** 触屏施放技能：第一次点只预览范围，记下这一格；再点同一格才施放【新】 */
  private armed: Cell | null = null;

  constructor() {
    super('battle');
  }

  init(data: BattleSceneData) {
    this.assets = data.assets;
    this.ui = data.ui;
    this.ui.faceOverride.clear();
    this.ui.onSkip = () => this.busy && this.setFast(true);
    this.stageName = data.stage;
    this.seed = data.seed;
    this.party = data.party;
    this.joinLevel = data.joinLevel;
    this.onEnd = data.onEnd;
    // 原版关卡的地图写在关卡 JSON 里（柳树下用狮子楼裁图）
    this.mapName = data.map ?? (data.assets.files ? stageMap(data.assets.files, data.stage) : data.stage);
    this.tint = data.tint;
    this.makeInput = data.makeInput;
    this.sprites = new Map();
    this.view = new Map();
    this.groundItems = new Map();
    this.occluders = new OccluderIndex();
    this.upperImages = new Map();
    this.ghosts = new Map();
    this.mode = { kind: 'idle' };
    this.busy = false;
    // restart 会复用 Scene 实例；旧场景的等待可被销毁，finally 未必有机会解锁。
    this.ending = false;
    this.fast = false;
    this.cujuView = null;
    this.playingSide = 'player';
  }

  create() {
    const { files } = this.assets;
    const loaded = loadStageMap(files, this.mapName);
    if (!loaded) throw new Error(`找不到地图 ${this.mapName}`);
    const { map } = loaded;
    this.battle = new Battle(this.makeInput ? this.makeInput() : loadStage(files, this.assets.data, this.stageName, { seed: this.seed, text: this.assets.tr, party: this.party, joinLevel: this.joinLevel }));
    this.ui.spectators = this.battle.spectators;
    for (const u of this.battle.units) this.vs(u); // 开场先记下每个人的样子（剧本换职业时画面要等回放到那一步）
    // 网页版：进关时只下载了走路、受击、防御和普通攻击，已学会的技能动画在后台接着下载
    void prefetchSkills(this.assets, this.battle.units.map((u) => ({ classId: u.classId, skills: learnedSkills(u, this.assets.data) })));
    // 原版技能音效（s<技能号> + 类型音）和菜单音也先下载好
    const allSkills = this.battle.units.flatMap((u) => [attackSkill(u, this.assets.data), ...learnedSkills(u, this.assets.data)]);
    sound.preload([
      ...['m01', 'm02', 'm03', 'm09', '44', '46', 'm13', 'm14', 'm04', 'm10', 'm07'],
      ...sound.skillSounds(allSkills),
      ...[...allSkills.flatMap((s) => fxGroups(s)), ...FIXED_FX].map((g) => String(g + 1)),
    ]);

    const masks = new Map<number, CoarseMask>();
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        map.cells[y * map.width + x].forEach((l, k) => {
          // 地表图块 0 是地图外的空格（通行判断 0x40bc30 也把它当不可走）；它的图是一块绿网格，不画（推测原版也不画）
          if (k === 0 && l.tile === 0) return;
          const p = cellToWorld(x, y, l.flags);
          const lib = k === 0 ? 'ground' : 'upper';
          const fr = this.assets[lib].frame(l.tile);
          const key = textureFor(this, `${lib}:${l.tile}`, () => frameToCanvas(fr, this.assets.palette));
          const depth = k === 0 ? -2 : depthOf(x, y, k);
          const image = this.add
            .image(p.x, p.y, key)
            .setOrigin(fr.anchorX / Math.max(1, fr.width), fr.anchorY / Math.max(1, fr.height))
            .setDepth(depth);
          if (k === 0 || !fr.width || !fr.height) return;
          const cellKey = `${x},${y}`;
          this.upperImages.set(cellKey,[...(this.upperImages.get(cellKey)??[]),image]);
          let mask = masks.get(l.tile);
          if (!mask) masks.set(l.tile, (mask = coarseMask(fr.width, fr.height, fr.pixels)));
          this.occluders.add(p.x - fr.anchorX, p.y - fr.anchorY, fr.width, fr.height, depth, mask, cellKey);
        });
      }
    this.zoneG = this.add.graphics().setDepth(-1.5);
    this.zoneSig = '';
    this.overlay = this.add.graphics().setDepth(-1);
    this.hoverG = this.add.graphics().setDepth(-0.5);

    // 原版地图上的宝物一律画成宝箱（Grid.grp 第 4 帧：0x40c24f 调 0x4010e0 把帧号设为 4，0x4010d0 从 data\\grid 取帧），
    // 不显示里面是什么；走到（或路过）就拾起。开局隐藏的宝物不画（原版绘制时检查显示标志 0x2，0x410960）
    this.drawChests();
    this.placeBall();
    for (const u of this.battle.units) if (u.present) this.spawn(u);

    // 相机：可拖动范围覆盖整张地图
    const cam = this.cameras.main;
    const corners = [cellToWorld(0, 0), cellToWorld(map.width - 1, 0), cellToWorld(0, map.height - 1), cellToWorld(map.width - 1, map.height - 1)];
    const minX = Math.min(...corners.map((c) => c.x)) - 300;
    const maxX = Math.max(...corners.map((c) => c.x)) + 300;
    cam.setBounds(minX, -400, maxX - minX, Math.max(...corners.map((c) => c.y)) + 700);
    cam.setZoom(this.scale.width < 700 ? 1 : 1.5);
    const focus = this.battle.units.find((u) => u.side === 'player' && u.present) ?? { x: map.width / 2, y: map.height / 2 };
    const f = cellToWorld(focus.x, focus.y);
    cam.centerOn(f.x, f.y);
    cam.roundPixels = true;
    this.tintFilter = applyTint(cam, this.tint);

    // 左上角的小地图（原版微缩地图只画地表，见 minimap.ts）
    const board = this.battle.board;
    this.minimap = new Minimap({
      width: map.width,
      height: map.height,
      ground: (x, y) => map.cells[y * map.width + x][0]?.tile ?? 0,
      blocked: (x, y) => !board.passable(x, y),
      tile: (t) => {
        const fr = this.assets.ground.frame(t);
        if (!fr.width || !fr.height) return null;
        const key = textureFor(this, `ground:${t}`, () => frameToCanvas(fr, this.assets.palette));
        return { img: this.textures.get(key).getSourceImage() as CanvasImageSource, w: fr.width, h: fr.height, ax: fr.anchorX, ay: fr.anchorY };
      },
    });
    this.minimap.onJump = (wx, wy) => cam.centerOn(wx, wy);
    const onResize = () => this.minimap?.resize();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.minimap?.destroy();
      this.minimap = null;
    });

    this.setupInput();
    this.ui.clearLog();
    this.ui.showUnit(null);
    this.ui.setCommands(null);
    this.run(this.battle.begin()).then(() => this.autoEndTurn());
  }

  /** 蹴鞠：按规则状态摆球（开场、时光倒流后） */
  private placeBall() {
    const c = this.battle.cuju;
    if (!c) return;
    this.cujuView ??= new CujuView(this, c.ball);
    this.cujuView.place(c.ball);
  }

  /** 踢球预览的说明（单位面板里） */
  private kickTip(name: string, p: KickPreview): string {
    const b = this.battle;
    const end = p.line.kind === 'stop' ? '球停在这里' : p.line.kind === 'intercept' ? `会被${b.unit(p.line.by)?.name ?? '对方'}拦下` : p.line.kind === 'out' ? '会出界' : p.line.scorer === this.battle.phase ? '能进球！' : '会踢进自家球门！';
    return `${name}：准头 ${p.hit}%，约 ${p.distance} 格（必杀 ${p.critDistance} 格，踢偏 ${p.missDistance} 格）；踢正的话${end}`;
  }

  /** 顶栏：回合、阶段，蹴鞠关加上比分 */
  private setTurn(turn: number, limit: number, phase: string) {
    const c = this.battle.cuju;
    if (!c) return this.ui.setTurn(turn, limit, phase);
    const extra = turn > c.rules.turns ? '（加时）' : '';
    this.ui.setTurn(turn, c.rules.turns + (extra ? c.rules.extraTurns : 0), `${phase}${extra}　比分 ${c.score.player} : ${c.score.enemy}`);
  }

  /** 地图上还没被拾起的宝物画成宝箱 */
  private drawChests() {
    const chest = this.assets.grid.frame(4);
    const chestKey = textureFor(this, 'grid:4', () => frameToCanvas(chest, this.assets.palette));
    for (const g of this.battle.items) {
      if (g.hidden || !itemOf(this.assets.data, g.item)) continue;
      const p = cellToWorld(g.x, g.y);
      const img = this.add
        .image(p.x, p.y, chestKey)
        .setOrigin(chest.anchorX / Math.max(1, chest.width), chest.anchorY / Math.max(1, chest.height))
        .setDepth(depthOf(g.x, g.y, 7));
      this.groundItems.set(`${g.x},${g.y}`, img);
    }
  }

  // ───────────── 单位精灵 ─────────────

  private vs(u: Unit) {
    let v = this.view.get(u.uid);
    if (!v) this.view.set(u.uid, (v = { x: u.x, y: u.y, facing: u.facing, hp: u.hp, mp: u.mp, cls: u.classId }));
    return v;
  }

  /** 回放结束后与引擎对齐 */
  private syncView() {
    for (const u of this.battle.units) if (this.view.has(u.uid)) this.view.set(u.uid, { x: u.x, y: u.y, facing: u.facing, hp: u.hp, mp: u.mp, cls: u.classId });
  }

  private spawn(u: Unit, at?: { x: number; y: number }) {
    const v = this.vs(u);
    if (at) Object.assign(v, at);
    const p = cellToWorld(v.x, v.y);
    const spr = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(v.x, v.y, 8));
    const bar = this.add.graphics().setDepth(depthOf(v.x, v.y, 9));
    let cart: Phaser.GameObjects.Image | undefined;
    if (this.battle.prisonCarts.has(u.uid)) {
      // 原版物件拼的囚车（prison-cart.ts），画在人物身后
      const pc = prisonCartCanvas(this.assets);
      cart = this.add.image(p.x, p.y, textureFor(this, 'prison-cart', () => pc.canvas)).setOrigin(pc.ax / pc.canvas.width, pc.ay / pc.canvas.height).setDepth(depthOf(v.x, v.y, 8) - 0.1);
    }
    this.sprites.set(u.uid, { spr, bar, cart, head: classHead(this.assets, v.cls) });
    this.pose(u);
    return spr;
  }

  /** 待机姿势：出手动作第 1 帧（摆好架势，见 idleAction）；防御中显示防御帧 */
  private pose(u: Unit) {
    const s = this.sprites.get(u.uid);
    if (!s) return;
    const v = this.vs(u);
    const action = u.defending ? ACTION.defend : idleAction(this.assets, v.cls);
    const key = animFor(this, this.assets, v.cls, action, v.facing) ?? animFor(this, this.assets, v.cls, ACTION.walk, v.facing);
    if (key) {
      s.spr.play(key);
      s.spr.anims.pause(s.spr.anims.currentAnim!.frames[0]);
    }
    const p = cellToWorld(v.x, v.y);
    s.spr.setPosition(p.x, p.y).setDepth(depthOf(v.x, v.y, 8));
    s.cart?.setPosition(p.x, p.y).setDepth(depthOf(v.x, v.y, 8) - 0.1);
    if (this.actedDone(u)) s.spr.setTint(0x808080);
    else s.spr.clearTint();
    this.drawBar(u);
  }

  /** 我方本回合已经行动完（待机的不算：待机不结束行动，见 §2.5） */
  private actedDone(u: Unit) {
    return u.side === 'player' && u.ended && this.battle.phase === 'player';
  }

  /**
   * 头顶的状态条【新】（负责人 2026-11-13 加，2026-11-14 从脚下挪到头顶）：体力（阵营色）、气力（黄）；
   * 我方好汉再加一条经验（蓝，满了就升级）。
   */
  private drawBar(u: Unit) {
    if (this.battle.spectators.has(u.uid)) { this.sprites.get(u.uid)?.bar.clear(); return; }
    const s = this.sprites.get(u.uid);
    if (!s) return;
    const v = this.vs(u);
    const p = cellToWorld(v.x, v.y);
    const w = 30;
    const rows: [number, number][] = [
      [SIDE_COLOR[u.side], v.hp / Math.max(1, u.stats.maxHp)],
      [MP_COLOR, v.mp / Math.max(1, u.stats.maxMp)],
    ];
    if (u.side === 'player') rows.push([EXP_COLOR, u.exp / expToNext(u.level)]);
    const top = p.y - s.head - 3 - (rows.length * 3 + 1); // 底边贴着头顶上方 3 像素
    s.bar.clear().setDepth(depthOf(v.x, v.y, 9));
    const done = this.actedDone(u);
    // 行动完的我方单位外面再套一圈灰框、三条颜色也调暗（负责人 2026-11-14），下个我方回合开始时消失
    if (done) s.bar.lineStyle(1, ACTED_FRAME, 1).strokeRect(p.x - w / 2 - 1.5, top - 0.5, w + 3, rows.length * 3 + 2);
    s.bar.fillStyle(0x000000, 0.7).fillRect(p.x - w / 2 - 1, top, w + 2, rows.length * 3 + 1);
    rows.forEach(([color, r], i) => s.bar.fillStyle(done ? dimColor(color) : color, 1).fillRect(p.x - w / 2, top + 1 + i * 3, Math.round(w * Math.min(1, Math.max(0, r))), 2));
  }

  /** 站在这一格的人物的头顶高度（飘字从状态条上面弹出） */
  private headAt(x: number, y: number) {
    for (const [uid, v] of this.view) if (v.x === x && v.y === y) {
      const s = this.sprites.get(uid);
      if (s) return s.head;
    }
    return HEAD_STD;
  }

  private refreshAll() {
    for (const u of this.battle.units) if (u.present && u.alive) this.pose(u);
  }

  // ───────────── 高亮 ─────────────

  private diamond(g: Phaser.GameObjects.Graphics, c: Cell, color: number, alpha: number, outline = false) {
    const p = cellToWorld(c.x, c.y);
    const k = 0.92;
    const pts = [
      new Phaser.Math.Vector2(p.x, p.y - HALF_H * k),
      new Phaser.Math.Vector2(p.x + HALF_W * k, p.y),
      new Phaser.Math.Vector2(p.x, p.y + HALF_H * k),
      new Phaser.Math.Vector2(p.x - HALF_W * k, p.y),
    ];
    if (outline) g.lineStyle(2, color, alpha).strokePoints(pts, true);
    else g.fillStyle(color, alpha).fillPoints(pts, true);
  }

  private redraw() {
    const g = this.overlay.clear();
    const m = this.mode;
    if (m.kind === 'idle') return;
    const u = m.u;
    if (m.kind === 'selected' && u.side === 'player') {
      const { green, yellow } = this.battle.moveRange(u);
      for (const c of green) this.diamond(g, c, 0x3fbf4f, 0.35);
      for (const c of yellow) this.diamond(g, c, 0xd8c040, 0.35);
      for (const t of this.battle.attackTargets(u)) this.diamond(g, t, 0xe04030, 0.9, true);
    } else if (m.kind === 'selected') {
      // 其它阵营：预览移动范围【新】
      const r = this.battle.reachOf(u, u.stats.move);
      for (const n of r.values()) this.diamond(g, n, u.side === 'enemy' ? 0xe04030 : 0x5aa0d8, 0.22);
    } else if (m.kind === 'move') {
      // 移动模式：菜单收起，只画移动格（lolo 2026-11-14）
      const { green, yellow } = this.battle.moveRange(u);
      for (const c of green) this.diamond(g, c, 0x3fbf4f, 0.4), this.diamond(g, c, 0x3fbf4f, 0.8, true);
      for (const c of yellow) this.diamond(g, c, 0xd8c040, 0.4), this.diamond(g, c, 0xd8c040, 0.8, true);
    } else if (m.kind === 'attack' && this.battle.cuju) {
      // 蹴鞠：踢得到球就画出正中时的球路
      const ball = this.battle.cuju.ball;
      if (this.battle.kickable(u)) this.cujuView?.drawPreview(g, ball, this.battle.kickPreview(u), this.diamond.bind(this));
      else this.diamond(g, ball, 0x909090, 0.8, true);
    } else if (m.kind === 'attack') {
      for (const c of this.battle.attackCells(u)) this.diamond(g, c, 0xe04030, 0.25);
      for (const t of this.battle.attackTargets(u)) this.diamond(g, t, 0xe04030, 0.9, true);
    } else if (m.kind === 'itemSlot' && (m.op === 'use' || m.op === 'give')) {
      const color = m.op === 'use' ? 0x40c0e0 : 0x6fbf5a;
      for (const t of this.itemOpTargets(m)) this.diamond(g, t, color, 0.35), this.diamond(g, t, color, 0.9, true);
    } else if (m.kind === 'skill') {
      const color = isSupportSkill(m.skill) ? 0x40b0e0 : 0xb050e0;
      for (const c of this.battle.skillCells(u, m.skill)) this.diamond(g, c, color, 0.25);
      for (const c of this.battle.skillTargets(u, m.skill)) this.diamond(g, c, color, 0.9, true);
    }
    this.diamond(g, u, 0xffffff, 0.8, true);
    this.drawHover();
  }

  /** 悬停框；技能模式下悬停在可施放的格子上时画出作用范围 */
  private drawHover() {
    const g = this.hoverG.clear();
    const c = this.hoverCell;
    if (!c || !this.battle.board.inBounds(c.x, c.y)) return;
    const m = this.mode;
    // 范围里没有目标的格子也画出作用范围，方便查看（不能施放）
    if (m.kind === 'skill' && !this.busy && this.battle.skillCells(m.u, m.skill).some((t) => sameCell(t, c)))
      for (const a of this.battle.skillArea(m.u, m.skill, c)) this.diamond(g, a, isSupportSkill(m.skill) ? 0x40b0e0 : 0xf09030, 0.45);
    if (m.kind === 'skill' && !this.busy && this.battle.cuju && !isSupportSkill(m.skill) && this.battle.skillTargets(m.u, m.skill).some((t) => sameCell(t, c)))
      this.cujuView?.drawPreview(g, this.battle.cuju.ball, this.battle.kickPreview(m.u, m.skill), this.diamond.bind(this));
    this.diamond(g, c, 0xffffff, 0.5, true);
  }

  private select(m: Mode) {
    this.mode = m;
    this.armed = null;
    this.redraw();
    this.updatePanel();
  }

  private updatePanel() {
    const m = this.mode;
    if (m.kind === 'idle') {
      this.ui.setCommands(null);
      const h = this.hoverCell && this.battle.unitAt(this.hoverCell.x, this.hoverCell.y);
      this.ui.showUnit(h || null);
      return;
    }
    const u = m.u;
    const hovered = this.hoverCell ? this.battle.unitAt(this.hoverCell.x, this.hoverCell.y) : undefined;
    if (m.kind === 'skill') {
      this.setTargetCommands(m);
      const c = this.hoverCell;
      const b = this.battle;
      const name = this.assets.tr(m.skill.name);
      if (c && b.cuju && !isSupportSkill(m.skill) && b.skillTargets(u, m.skill).some((t) => sameCell(t, c))) {
        const tip = this.kickTip(name, b.kickPreview(u, m.skill));
        this.ui.showUnit(u, null, this.armed && sameCell(this.armed, c) ? `${tip}　再点一次踢球` : tip);
      } else if (c && b.cuju && !isSupportSkill(m.skill) && b.skillCells(u, m.skill).some((t) => sameCell(t, c))) {
        this.ui.showUnit(u, null, `${name}：作用范围要盖到球才能踢`);
      } else if (c && b.skillTargets(u, m.skill).some((t) => sameCell(t, c))) {
        const hit = b.affected(u, m.skill, c);
        const t = hit.find((h) => sameCell(h, c)) ?? hit[0];
        const more = hit.length > 1 ? `${name}：范围内 ${hit.length} 人` : name;
        const tip = this.armed && sameCell(this.armed, c) ? `${more}　再点一次施放` : more;
        if (isSupportSkill(m.skill)) this.ui.showUnit(t, null, tip);
        else this.ui.showUnit(t, b.preview(u, t, m.skill), tip);
      } else if (c && b.skillCells(u, m.skill).some((t) => sameCell(t, c))) {
        this.ui.showUnit(u, null, `${name}：这里没有可作用的目标`);
      } else {
        const bonus = skillBonusText(m.skill);
        this.ui.showUnit(u, null, `${name}（气力 ${m.skill.mpCost}${bonus ? `　${bonus}` : ''}）：选择施放位置`);
      }
      return;
    }
    if (m.kind === 'item' || m.kind === 'itemSlot') {
      if (this.isTargeting(m)) this.setTargetCommands(m);
      else this.setFloatCommands(m); // 道具菜单也放在人物旁边
      if (m.kind === 'item') return this.ui.showUnit(u, null, this.battle.canAct(u) && u.side === 'player' ? '选择道具：可使用、装备、给予或丢弃' : '');
      const it = itemOf(this.assets.data, u.slots[m.slot]);
      if (!it) return this.ui.showUnit(u);
      const name = this.assets.tr(it.name);
      if (m.op === 'use' || m.op === 'give') {
        const t = hovered && this.itemOpTargets(m).includes(hovered) ? hovered : u;
        return this.ui.showUnit(t, null, m.op === 'use' ? `使用${name}：选择自己或相邻的队友` : `给予${name}：选择相邻的队友`);
      }
      const n = u.forge[m.slot] ?? 0;
      return this.ui.showUnit(u, null, '', {
        title: `${slotLabel(m.slot)} · ${name}${n ? ` +${n}` : ''}`,
        lines: [itemSummary(it, n), this.assets.tr(it.description)],
        warn: m.op === 'discard' ? `确定丢弃${name}？丢掉就找不回来了。` : m.slot >= EQUIP_SLOTS && equipSlotOf(it) >= 0 ? (canEquip(this.assets.data.classes[u.classId], it, this.assets.data) ? '放在物品栏里不算加成，装备后才生效' : `${u.name}不能装备这件`) : '',
      });
    }
    const target = hovered && u.side === 'player' && this.battle.attackTargets(u).includes(hovered) ? hovered : undefined;
    if (this.battle.cuju && m.kind === 'attack' && !(hovered && hovered !== u)) {
      const name = this.assets.tr(attackSkill(u, this.assets.data).name);
      this.ui.showUnit(u, null, this.battle.kickable(u) ? `${this.kickTip(name, this.battle.kickPreview(u))}。点球踢出去` : this.battle.cuju.locked ? '球被对方拦下了，本回合踢不动了，只能走位' : '够不着球：近战要站在球身边（斜着也行），远程要在射程内');
    } else if (target) this.ui.showUnit(target, this.battle.preview(u, target));
    else if (hovered && hovered !== u) this.ui.showUnit(hovered);
    else this.ui.showUnit(u, null, m.kind === 'attack' ? (this.battle.attackTargets(u).length ? '选择攻击目标' : '攻击范围内没有敌人') : m.kind === 'move' ? '选择移动位置（绿 = 移动，黄 = 强行军，走完本回合结束）' : '');
    if (this.isTargeting(m)) this.setTargetCommands(m);
    else this.setFloatCommands(m);
  }

  /** 在地图上选目标的模式：移动、攻击、技能施放位置、道具使用 / 给予的对象 */
  private isTargeting(m: Mode): boolean {
    if (m.kind === 'idle' || m.u.side !== 'player' || !this.battle.canAct(m.u)) return false;
    return m.kind === 'move' || m.kind === 'attack' || m.kind === 'skill' || (m.kind === 'itemSlot' && (m.op === 'use' || m.op === 'give'));
  }

  /**
   * 选目标时人物旁边的菜单收起来，不挡地图格子（lolo 2026-11-13）【新】；
   * 只在底部面板右边留一个"取消"，和右键、Esc 一样回到上一层菜单。说明和预计伤害在单位面板里。
   */
  private setTargetCommands(m: Mode) {
    if (this.busy) return this.ui.setCommands(null);
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.ui.setCommands([{ label: '取消', note: touch ? '' : '右键 / Esc', run: () => this.back() }]);
  }

  /** 回到上一层：选目标 → 原来的菜单，子菜单 → 主菜单，主菜单 → 取消选中 */
  private back() {
    const m = this.mode;
    if (this.busy || this.ui.inDialog || m.kind === 'idle') return;
    const u = m.u;
    if (m.kind === 'skill') return this.select({ kind: 'skills', u });
    if (m.kind === 'itemSlot') return this.select(m.op ? { ...m, op: undefined } : { kind: 'item', u });
    if (m.kind === 'selected') return this.select({ kind: 'idle' });
    this.select({ kind: 'selected', u });
  }

  /** 攻击、技能、防御、道具等指令放在人物旁边，跟着镜头移动（位置在 update 里每帧更新） */
  private setFloatCommands(m: Mode) {
    this.ui.setCommands(this.commands(m), true);
    this.placeFloat();
  }

  private placeFloat() {
    const m = this.mode;
    if (m.kind === 'idle' || !this.ui.floatingCommands) return;
    const s = this.sprites.get(m.u.uid);
    if (!s) return;
    const cam = this.cameras.main;
    const v = cam.worldView;
    // 人物身体中部大约在脚下格子中心往上 30 像素（世界坐标）
    this.ui.placeCommands((s.spr.x - v.x) * cam.zoom + cam.x, (s.spr.y - 30 - v.y) * cam.zoom + cam.y, (HALF_W + 16) * cam.zoom);
  }

  update() {
    this.placeFloat();
    this.drawZones();
    this.drawMinimap();
    this.syncGhosts();
  }

  /**
   * 被地上物挡住的人物（敌我都算）在遮挡物上面再画一份 50% 透明的虚影【新】（负责人 2026-11-14）。
   * 虚影和本体同帧同位置：没被挡住的部分叠在本体上看不出来，被挡住的部分透出半透明的轮廓。
   * 状态条也提到遮挡物上面，保证看得清。
   */
  private syncGhosts() {
    for (const [uid, g] of this.ghosts) {
      const s = this.sprites.get(uid);
      if (!s || !s.spr.active || s.spr !== g.img.getData('spr')) {
        g.img.destroy();
        this.ghosts.delete(uid);
      }
    }
    for (const [uid, s] of this.sprites) {
      const spr = s.spr;
      if (!spr.active || !spr.visible || spr.texture.key === '__DEFAULT') continue;
      const key = `${spr.x},${spr.y},${spr.depth},${spr.texture.key},${spr.frame.name}`;
      let g = this.ghosts.get(uid);
      if (!g || g.key !== key) {
        // 包围盒往上多算一段，把头顶的状态条也算进去
        const top = spr.y - Math.max(spr.displayOriginY, s.head + 14);
        const cover = this.occluders.cover({ x: spr.x - spr.displayOriginX, y: top, w: spr.width, h: spr.y - top + (spr.height - spr.displayOriginY) }, spr.depth);
        if (!g) {
          if (cover === null) continue;
          const img = this.add.image(0, 0, spr.texture.key).setData('spr', spr);
          this.ghosts.set(uid, (g = { img, key, cover }));
        }
        g.key = key;
        g.cover = cover;
      }
      const img = g.img;
      if (g.cover === null) {
        if (img.visible) s.bar.setDepth(spr.depth + 1);
        img.setVisible(false);
        continue;
      }
      img
        .setTexture(spr.texture.key, spr.frame.name)
        .setPosition(spr.x, spr.y)
        .setFlipX(spr.flipX)
        .setDepth(g.cover + 0.5)
        .setAlpha(spr.alpha * 0.5)
        .setVisible(true);
      if (spr.isTinted) img.setTint(spr.tintTopLeft);
      else img.clearTint();
      s.bar.setDepth(g.cover + 0.6);
    }
  }

  /**
   * 胜负条件里的区域【新】（负责人 2026-11-14：要到达撤退区域的关卡，小地图标出撤退到哪）：
   * 地表上画半透明格子和外框，小地图上另外画（drawMinimap）。区块执行过（已过关 / 条件已失效）或要进去的人倒下了就不画。
   */
  private drawZones() {
    const zs = this.battle.objectiveZones();
    const ws = this.battle.watchZones();
    const sig = zs.map((z) => `${z.kind}:${z.x1},${z.y1},${z.x2},${z.y2}`).join('|') + ws.map((w) => `/${w.x},${w.y},${w.facing},${w.r},${w.spotted}`).join('');
    if (sig === this.zoneSig) return;
    this.zoneSig = sig;
    this.zones = zs.map((z) => ({ ...z, color: `#${ZONE_STYLE[z.kind].color.toString(16).padStart(6, '0')}`, label: ZONE_STYLE[z.kind].label }));
    const g = this.zoneG.clear();
    for (const z of zs) {
      const color = ZONE_STYLE[z.kind].color;
      for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) this.diamond(g, { x, y }, color, 0.22);
      const pts = zoneCorners(z).map((p) => new Phaser.Math.Vector2(p.x, p.y));
      g.lineStyle(3, color, 0.9).strokePoints(pts, true);
    }
    // 潜行关的哨兵警戒范围（只有正前方）【新】：黄色 = 还没发现，红色 = 已经发现（要赶快打倒）
    const W = this.battle.board.width, H = this.battle.board.height;
    for (const w of ws)
      for (let y = Math.max(0, w.y - w.r); y <= Math.min(H - 1, w.y + w.r); y++)
        for (let x = Math.max(0, w.x - w.r); x <= Math.min(W - 1, w.x + w.r); x++)
          if (watcherSees(w, { x, y }, w.r) && this.battle.board.passable(x, y)) this.diamond(g, { x, y }, w.spotted ? 0xff4040 : 0xffd040, 0.2);
  }

  /** 小地图上的人物（按画面上的位置，回放期间跟着动）、宝箱和镜头范围 */
  private drawMinimap() {
    const mm = this.minimap;
    if (!mm?.open) return;
    const marks: MiniMark[] = [];
    for (const k of this.groundItems.keys()) {
      const [x, y] = k.split(',').map(Number);
      marks.push({ x, y, color: '#f0c860' });
    }
    // 敌方先画，我方压在上面
    const order = { enemy: 0, ally: 1, player: 2 } as const;
    const units = this.battle.units.filter((u) => this.sprites.has(u.uid)).sort((a, b) => order[a.side] - order[b.side]);
    for (const u of units) {
      const v = this.vs(u);
      marks.push({ x: v.x, y: v.y, color: `#${SIDE_COLOR[u.side].toString(16).padStart(6, '0')}` });
    }
    // 蹴鞠：球画成白点
    if (this.cujuView) marks.push({ x: this.cujuView.cell.x, y: this.cujuView.cell.y, color: '#ffffff' });
    mm.draw(marks, this.cameras.main.worldView, this.zones, this.fireCells);
  }

  private commands(m: Mode): Command[] | null {
    if (m.kind === 'idle') return null;
    const u = m.u;
    const b = this.battle;
    if (u.side !== 'player' || this.busy) return null;
    if (m.kind === 'item') return this.itemList(u);
    if (m.kind === 'itemSlot') return this.itemOps(m);
    // 不能行动的我方人物（已行动、敌方回合）也能查看道具
    if (!b.canAct(u)) return u.slots.some(Boolean) ? [{ label: '道具', run: () => this.select({ kind: 'item', u }) }] : null;
    if (m.kind === 'skills') {
      return [
        ...b.skillsOf(u).map(({ skill, usable, hasTarget }) => ({
          label: `${this.assets.tr(skill.name)} ${skill.mpCost}`,
          note: [skillBonusText(skill), usable && !hasTarget ? '范围内无目标' : ''].filter(Boolean).join('　'),
          enabled: usable,
          run: () => this.select({ kind: 'skill', u, skill }),
        })),
        { label: '返回', run: () => this.select({ kind: 'selected', u }) },
      ];
    }
    const skills = b.skillsOf(u);
    const range = b.moveRange(u);
    return [
      // 移动：菜单收起，只看地图上的移动格，方便点（lolo 2026-11-14）【新】
      ...(b.canMove(u) ? [{ label: '移动', enabled: range.green.length + range.yellow.length > 0, run: () => this.select({ kind: 'move', u }) }] : []),
      // 范围里没有敌人也能点"攻击"查看攻击范围（lolo 2026-11-13）【新】
      { label: b.cuju ? '踢球' : '攻击', enabled: !u.acted, on: m.kind === 'attack', run: () => this.select(m.kind === 'attack' ? { kind: 'selected', u } : { kind: 'attack', u }) },
      ...(skills.length ? [{ label: '技能', enabled: skills.some((k) => k.usable), run: () => this.select({ kind: 'skills', u }) }] : []),
      { label: '防御', run: () => this.exec(u, () => b.defend(u)) },
      { label: '休息', enabled: !u.acted, run: () => this.exec(u, () => b.rest(u)) },
      { label: '道具', enabled: u.slots.some(Boolean), run: () => this.select({ kind: 'item', u }) },
      // 待机：只是先放下这个人、收起菜单，不结束他的行动，本回合还能再选他（lolo 2026-11-14）【新】
      { label: '待机', run: () => this.select({ kind: 'idle' }) },
      ...(b.canUndo(u) ? [{ label: '撤销移动', run: () => this.exec(u, () => b.undoMove(u)) }] : []),
    ];
  }

  /** 执行一个玩家指令并播放结果；单位还能行动就保持选中 */
  private async exec(u: Unit, cmd: () => BattleEvent[], next?: Mode) {
    if (this.busy) return;
    this.overlay.clear();
    this.ui.setCommands(null);
    await this.run(cmd());
    if (this.battle.status !== 'playing') return;
    this.pose(u);
    this.select(this.battle.canAct(u) ? (next ?? { kind: 'selected', u }) : { kind: 'idle' });
    this.autoEndTurn();
  }

  /** 我方全员行动完毕就自动结束回合（稍等一下，让玩家看清最后一个动作的结果） */
  private autoEndTurn() {
    if (!this.battle.playerPhaseDone()) return;
    this.time.delayedCall(400, () => {
      if (this.busy || this.ui.inDialog || !this.battle.playerPhaseDone()) return;
      this.endTurn();
    });
  }

  // ───────────── 道具 ─────────────

  /** 道具栏：3 格装备（空着也列出来）+ 物品栏里有东西的格子 */
  private itemList(u: Unit): Command[] {
    const d = this.assets.data;
    const rows: Command[] = [];
    for (let k = 0; k < u.slots.length; k++) {
      const it = itemOf(d, u.slots[k]);
      if (!it && k >= EQUIP_SLOTS) continue;
      const n = u.forge[k] ?? 0;
      rows.push({
        label: `${slotLabel(k)}｜${it ? this.assets.tr(it.name) + (n ? ` +${n}` : '') : '—'}`,
        note: it ? itemSummary(it, n) : '',
        enabled: !!it,
        run: () => this.select({ kind: 'itemSlot', u, slot: k }),
      });
    }
    rows.push({ label: '返回', run: () => this.select({ kind: 'selected', u }) });
    return rows;
  }

  private itemOpTargets(m: Extract<Mode, { kind: 'itemSlot' }>): Unit[] {
    if (m.op === 'use') return this.battle.itemTargets(m.u, m.slot);
    if (m.op === 'give') return this.battle.giveTargets(m.u, m.slot);
    return [];
  }

  /** 选中一格道具后的操作：使用 / 装备或卸下 / 给予 / 丢弃 */
  private itemOps(m: Extract<Mode, { kind: 'itemSlot' }>): Command[] {
    const { u, slot } = m;
    const b = this.battle;
    const it = itemOf(this.assets.data, u.slots[slot]);
    const back = { label: '返回', run: () => this.select({ kind: 'item', u }) };
    if (!it || !b.canAct(u)) return [back];
    const list: Mode = { kind: 'item', u };
    // 使用 / 给予：菜单收起，在地图上点对象（setTargetCommands）
    if (m.op === 'discard') {
      return [
        { label: '确认丢弃', run: () => this.exec(u, () => b.discardItem(u, slot), list) },
        { label: '返回', run: () => this.select({ ...m, op: undefined }) },
      ];
    }
    const ops: Command[] = [];
    if (isUsable(it)) ops.push({ label: '使用', enabled: b.itemTargets(u, slot).length > 0, run: () => this.select({ ...m, op: 'use' }) });
    if (equipSlotOf(it) >= 0)
      ops.push({ label: slot < EQUIP_SLOTS ? '卸下' : '装备', enabled: b.canEquipItem(u, slot), run: () => this.exec(u, () => b.equipItem(u, slot), list) });
    ops.push({ label: '给予', enabled: b.giveTargets(u, slot).length > 0, note: b.giveTargets(u, slot).length ? '' : '旁边没有队友', run: () => this.select({ ...m, op: 'give' }) });
    ops.push({ label: '丢弃', run: () => this.select({ ...m, op: 'discard' }) });
    ops.push(back);
    return ops;
  }

  async endTurn() {
    if (this.busy || this.ending || this.battle.status !== 'playing' || this.battle.phase !== 'player') return;
    this.ending = true;
    try {
      this.select({ kind: 'idle' });
      // 还没行动的我方人物按默认规则自动休息 / 用回气技能 / 防御（§2.5），逐个移镜头播放
      for (const u of this.battle.autoActUnits()) {
        if (this.battle.status !== 'playing') return;
        this.busy = true; // 移镜头时也挡住点击
        if (!this.fast) await this.focusOn(u);
        await this.run(this.battle.autoAct(u));
        this.pose(u);
      }
      if (this.battle.status !== 'playing' || this.battle.phase !== 'player') return;
      await this.run(this.battle.endPlayerPhase());
    } finally {
      this.ending = false;
    }
    // 新的我方回合如果没人能动（比如全员昏迷），接着自动结束
    this.autoEndTurn();
  }

  /**
   * 时光倒流【新】：回到本回合（或上一回合）我方回合开始时的状态，随机数重新掷。
   * 画面上的人物、宝箱全部按引擎状态重建。返回是否倒流成功。
   */
  async rewind(): Promise<boolean> {
    const b = this.battle;
    const turn = b.rewindTarget();
    if (this.busy || this.ending || turn === null || this.ui.inDialog) return false;
    this.select({ kind: 'idle' });
    this.overlay.clear();
    const events = b.rewind();
    this.ui.hideResult();
    for (const s of this.sprites.values()) {
      s.spr.destroy();
      s.bar.destroy();
      s.cart?.destroy();
    }
    this.sprites.clear();
    this.view.clear();
    for (const img of this.groundItems.values()) img.destroy();
    this.groundItems.clear();
    this.drawChests();
    this.placeBall();
    for (const u of b.units) if (u.present && u.alive) this.spawn(u);
    this.endSound = false;
    this.ui.message(`时光倒流：回到第 ${turn} 回合开始。`);
    await this.run(events);
    this.autoEndTurn();
    return true;
  }

  // ───────────── 输入 ─────────────

  private setupInput() {
    const cam = this.cameras.main;
    this.input.addPointer(1);
    // 先把已经抬起、但因事件被拦而仍算「按下」的触摸指针复位，否则下一根手指会被当成双指缩放（见 touch.ts）
    const sweep = () => {
      if (releaseStalePointers(this.input)) this.pinch = null;
    };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sweep();
      this.down = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, moved: false };
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.down;
      this.down = null;
      this.pinch = null;
      if (this.busy && this.playingSide !== 'player' && !this.ui.inDialog) {
        const now = performance.now();
        if (now - this.lastTap < 400) this.setFast(true);
        this.lastTap = now;
        return;
      }
      if (d && !d.moved && p.button !== 2) {
        const w = cam.getWorldPoint(p.x, p.y);
        const c = this.pick(w.x, w.y);
        // 触屏没有悬停：点到哪格，下方面板就看哪格（不然会一直停在上次"悬停"的人身上）
        if (p.wasTouch) this.hoverCell = c;
        this.click(c, p.wasTouch);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      sweep();
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown && multiTouch()) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinch) this.zoomBy(d / this.pinch);
        this.pinch = d;
        if (this.down) this.down.moved = true;
        return;
      }
      if (this.down && p.isDown) {
        if (Math.abs(p.x - this.down.x) + Math.abs(p.y - this.down.y) > 8) this.down.moved = true;
        if (this.down.moved) {
          cam.scrollX = this.down.sx - (p.x - this.down.x) / cam.zoom;
          cam.scrollY = this.down.sy - (p.y - this.down.y) / cam.zoom;
        }
        return;
      }
      // 只有鼠标才有悬停。触屏双指缩放时先抬起一根手指，另一根手指的移动会落到这里，
      // 以前会把悬停格设成手指下的人，之后下方面板一直显示他（lolo 2026-11-13 手机上卡在一个士兵）
      if (p.wasTouch) return;
      const w = cam.getWorldPoint(p.x, p.y);
      this.hover(this.pick(w.x, w.y));
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.2 : 1.2));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() && !this.busy) this.back();
    });
    // Esc 回到上一层菜单（对白和回放期间由 BattleUI 处理跳过）
    this.input.keyboard?.on('keydown-ESC', () => this.back());
  }

  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.4, 4));
  }

  /**
   * 指针落点 → 格子：只看点击位置落在哪个格子的菱形里，不看人物精灵。
   * 人物身体画在格子上方、会盖住身后的格子，按精灵判定会点不到后面的格子（lolo 2026-11-13）。
   * 要选中或攻击人物，就点他脚下那一格。
   */
  private pick(wx: number, wy: number): Cell {
    return worldToCell(wx, wy);
  }

  private hover(c: Cell) {
    if (this.hoverCell && this.hoverCell.x === c.x && this.hoverCell.y === c.y) return;
    this.hoverCell = c;
    this.drawHover();
    if (!this.busy && !this.ui.inDialog) this.updatePanel();
  }

  private click(c: Cell, touch = false) {
    if (this.busy || this.ui.inDialog || this.battle.status !== 'playing') return;
    const b = this.battle;
    const at = b.unitAt(c.x, c.y);
    const m = this.mode;
    if (m.kind === 'skill') {
      const { u, skill } = m;
      if (b.skillTargets(u, skill).some((t) => sameCell(t, c))) {
        // 触屏没有悬停：第一次点先显示作用范围，再点同一格才施放
        if (touch && !(this.armed && sameCell(this.armed, c))) {
          this.armed = { x: c.x, y: c.y };
          this.hoverCell = null;
          return this.hover(c);
        }
        return void this.exec(u, () => b.useSkill(u, skill, c));
      }
      // 射程内但没有目标：只显示作用范围，不出手、不耗气（lolo 2026-11-13）
      if (b.skillCells(u, skill).some((t) => sameCell(t, c))) {
        this.armed = null;
        this.hoverCell = null;
        return this.hover(c);
      }
      // 点了范围外：回到技能列表（不必从头再点"技能"）
      return this.select({ kind: 'skills', u });
    }
    if (m.kind === 'itemSlot' && (m.op === 'use' || m.op === 'give')) {
      const { u, slot } = m;
      if (at && this.itemOpTargets(m).includes(at)) {
        const list: Mode = { kind: 'item', u };
        return void this.exec(u, () => (m.op === 'use' ? b.useItem(u, slot, at) : b.giveItem(u, slot, at)), list);
      }
      return this.select({ ...m, op: undefined });
    }
    if (m.kind === 'move') {
      const { u } = m;
      const { green, yellow } = b.moveRange(u);
      if (!at && [...green, ...yellow].some((g) => sameCell(g, c))) return void this.exec(u, () => b.move(u, c.x, c.y));
      // 点了范围外：回到行动菜单
      return this.select({ kind: 'selected', u });
    }
    if (m.kind === 'item' || m.kind === 'itemSlot') {
      if (at && at !== m.u) return this.select({ kind: 'selected', u: at });
      return;
    }
    if (m.kind === 'attack' && b.cuju && sameCell(b.cuju.ball, c) && b.kickable(m.u)) return void this.exec(m.u, () => b.kick(m.u));
    if (m.kind === 'selected' || m.kind === 'attack') {
      const u = m.u;
      if (at && u.side === 'player' && b.attackTargets(u).includes(at)) return void this.exec(u, () => b.attack(u, at));
      if (m.kind === 'selected' && u.side === 'player' && !at) {
        const { green, yellow } = b.moveRange(u);
        if ([...green, ...yellow].some((g) => g.x === c.x && g.y === c.y)) return void this.exec(u, () => b.move(u, c.x, c.y));
      }
      if (at === u) return this.select(m.kind === 'attack' ? { kind: 'selected', u } : { kind: 'idle' });
      // 攻击模式点了空地：回到主菜单
      if (m.kind === 'attack' && !at) return this.select({ kind: 'selected', u });
    }
    this.select(at ? { kind: 'selected', u: at } : { kind: 'idle' });
  }

  // ───────────── 事件播放 ─────────────

  private setFast(on: boolean) {
    if (this.fast === on) return;
    this.fast = on;
    const k = on ? 12 : 1;
    this.time.timeScale = k;
    this.tweens.timeScale = k;
    this.anims.globalTimeScale = k;
    const b = this.battle;
    if (on) this.setTurn(b.turn, b.turnLimit, PHASE_NAME[this.playingSide] + '　▸▸ 快进中');
  }

  private removeTree(cells: {x:number;y:number}[]) {
    return cells.flatMap(c=>{const key=`${c.x},${c.y}`,images=this.upperImages.get(key)??[];this.upperImages.delete(key);this.occluders.remove(key);return images;});
  }

  private setPortrait(e: Extract<BattleEvent, { type: 'portrait' }>) {
    const source = /^@class:(\d+)$/.exec(e.file);
    const url = source ? this.ui.portrait(Number(source[1])) : e.file && this.assets.pack ? packFaceUrl(this.assets.pack.rt.id, e.file) : undefined;
    if (url) this.ui.faceOverride.set(e.classId, url);
    else this.ui.faceOverride.delete(e.classId);
  }

  /** 快进：不播动画，只做必须的画面变化；对白、结局照常显示 */
  private skip(e: BattleEvent) {
    switch (e.type) {
      case 'ball':
        this.cujuView?.place({ x: e.x, y: e.y });
        if (e.score) this.setTurn(this.battle.turn, 0, PHASE_NAME[this.playingSide]);
        break;
      case 'portrait':
        this.setPortrait(e);
        break;
      case 'message':
        this.ui.message(e.text);
        break;
      case 'subtitle':
        break;
      case 'sound':
        if (e.name === 'm12' || e.name === 'm05') this.endSound = true;
        sound.sfx(e.name);
        break;
      case 'die':
      case 'leave': {
        const s = this.sprites.get(e.uid);
        s?.bar.destroy();
        s?.cart?.destroy();
        s?.spr.destroy();
        this.sprites.delete(e.uid);
        break;
      }
      case 'uproot':
        this.removeTree(e.cells).forEach(image=>image.destroy());
        break;
      case 'fire':
        this.syncFire(e.cells, true);
        break;
      case 'flourish':
        break;
      case 'shot': {
        const u = this.battle.unit(e.uid);
        if (u) { this.vs(u).facing = e.facing; this.pose(u); }
        break;
      }
      case 'look': {
        const u = this.battle.unit(e.uid)!;
        this.vs(u).cls = e.classId;
        const s = this.sprites.get(u.uid);
        if (s) s.head = classHead(this.assets, e.classId);
        this.pose(u);
        break;
      }
      case 'appear': {
        const u = this.battle.unit(e.uid)!;
        Object.assign(this.vs(u), { x: e.x, y: e.y });
        if (!this.sprites.has(u.uid)) this.spawn(u, { x: e.x, y: e.y });
        break;
      }
      case 'pickup':
        this.groundItems.get(`${e.x},${e.y}`)?.destroy();
        this.groundItems.delete(`${e.x},${e.y}`);
        break;
      case 'phase': {
        this.playingSide = e.side;
        this.setTurn(e.turn, this.battle.turnLimit, PHASE_NAME[e.side] + (e.side === 'player' ? '' : '　▸▸ 快进中'));
        // 回到我方阶段：镜头直接对准第一个能行动的人
        const first = e.side === 'player' && this.battle.active().find((u) => u.side === 'player' && !u.ended);
        if (first) {
          const p = cellToWorld(first.x, first.y);
          this.cameras.main.centerOn(p.x, p.y);
        }
        break;
      }
    }
  }

  private async run(events: BattleEvent[]) {
    this.busy = true;
    this.ui.playing = true;
    this.ui.setEndTurnEnabled(false);
    this.ui.setRewind(null);
    try {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        // 同伴一起观战/归队：不逐人移动镜头、淡出淡入或串行等待。
        if (!this.fast && !this.ui.skipping && e.type === 'status' && this.battle.spectators.has(e.uid) && (e.text === '观战' || e.text === '归队')) {
          const group = [e];
          while (true) {
            const next = events[i + 1];
            if (next?.type !== 'status' || next.text !== e.text || !this.battle.spectators.has(next.uid)) break;
            group.push(next); i++;
          }
          for (const notice of group) {
            const v = this.vs(this.battle.unit(notice.uid)!);
            this.float(v.x, v.y, this.assets.tr(notice.text), '#c080ff', 0, 0, 700);
          }
          await wait(this, 200);
          continue;
        }
        // 连着的几个登场（或几个退场）一起淡入淡出，不再一个接一个【新】（负责人 2026-11-14：伏兵逐一出现太慢）
        if (!this.fast && !this.ui.skipping && (e.type === 'appear' || e.type === 'leave')) {
          const group: BattleEvent[] = [e];
          while (events[i + 1]?.type === e.type) group.push(events[++i]);
          if (group.length > 1) {
            await (e.type === 'appear' ? this.appearAll(group as AppearEvent[]) : this.leaveAll(group as LeaveEvent[]));
            continue;
          }
        }
        // 跳过剧情：对白不显示，也不为它移动镜头；其余事件按快进处理
        if (this.ui.skipping) {
          this.setFast(true);
          if (e.type === 'say' || e.type === 'narrate' || e.type === 'objective') continue;
        }
        const story = e.type === 'say' || e.type === 'narrate' || e.type === 'objective' || e.type === 'end' || e.type === 'ask' || e.type === 'pick' || e.type === 'choice';
        if (this.fast && !story) {
          this.skip(e);
          continue;
        }
        if (this.fast) {
          // 剧情照常播放：先把画面对齐到引擎的当前状态
          this.syncView();
          this.refreshAll();
        }
        await this.play(e);
      }
    } finally {
      this.busy = false;
      this.setFast(false);
      this.ui.playing = false;
      this.ui.endSkip();
      this.syncView();
      this.refreshAll();
      for (const [uid, s] of this.sprites) s.cart?.setVisible(this.battle.isBound(this.battle.unit(uid)!));
      const b = this.battle;
      this.setTurn(b.turn, b.turnLimit, PHASE_NAME[b.phase]);
      this.ui.setTeamExp(b.teamExp);
      this.ui.setEndTurnEnabled(b.status === 'playing' && b.phase === 'player');
      this.ui.setRewind(b.rewindTarget());
      if (this.mode.kind !== 'idle') this.redraw();
    }
  }

  private fade(target: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[], alpha: number, duration: number) {
    return new Promise<void>((r) => this.tweens.add({ targets: target, alpha, duration, onComplete: () => r() }));
  }

  /** 登场：镜头移到这批人的中间，所有人同时淡入 */
  private async appearAll(group: AppearEvent[]) {
    if (group.some((e) => e.ambush)) void music.sting('ambush');
    const units = group.map((e) => {
      const u = this.battle.unit(e.uid)!;
      Object.assign(this.vs(u), { x: e.x, y: e.y });
      return u;
    });
    const n = group.length;
    await this.focus(Math.round(group.reduce((a, e) => a + e.x, 0) / n), Math.round(group.reduce((a, e) => a + e.y, 0) / n));
    const sprs = units.map((u, k) => {
      const spr = this.sprites.get(u.uid)?.spr ?? this.spawn(u, { x: group[k].x, y: group[k].y });
      spr.setAlpha(0);
      this.pose(u);
      return spr;
    });
    // 一批人稍微错开一点（总共不超过 APPEAR_SPREAD_MS），看得出是陆续涌出来的
    const step = n > 1 ? Math.min(40, APPEAR_SPREAD_MS / (n - 1)) : 0;
    await Promise.all(
      sprs.map((spr, k) => new Promise<void>((r) => this.tweens.add({ targets: spr, alpha: 1, delay: k * step, duration: APPEAR_MS, onComplete: () => r() }))),
    );
  }

  /** 剧情退场：几个人同时淡出 */
  private async leaveAll(group: LeaveEvent[]) {
    const gone = group.map((e) => this.sprites.get(e.uid)).filter((s) => !!s);
    for (const s of gone) {
      s.bar.destroy();
      s.cart?.destroy();
    }
    if (gone.length) await this.fade(gone.map((s) => s.spr), 0, LEAVE_MS);
    for (const e of group) {
      this.sprites.get(e.uid)?.spr.destroy();
      this.sprites.delete(e.uid);
    }
  }

  private focusOn(u: Unit, ms?: number) {
    const v = this.vs(u);
    return this.focus(v.x, v.y, ms);
  }

  private async focus(x: number, y: number, ms = 250) {
    const cam = this.cameras.main;
    const p = cellToWorld(x, y);
    const v = cam.worldView;
    const mx = v.width * 0.18, my = v.height * 0.22;
    if (p.x > v.x + mx && p.x < v.right - mx && p.y > v.y + my && p.y < v.bottom - my) return;
    if (this.fast) return void cam.centerOn(p.x, p.y);
    cam.pan(p.x, p.y, ms, 'Sine.easeInOut');
    await wait(this, ms);
  }

  /** 地图上的飘字：照原版用调色板色（伤害红、回血绿、回气黄，见 float-text.ts），加黑描边保证在地图上看得清【新】。
   *  side：同时弹出的几个字放在中线左边（−1）或右边（1）；lift：往上抬几行（多段攻击的后几段、回气数字） */
  /** 火苗（技能 arrowFx: 'fire'）：在 (wx, wy) 附近冒 n 个橙黄色小火团，往上飘、缩小、淡出；big = 命中处那一团【新】 */
  private flames(wx: number, wy: number, depth: number, n: number, big = false) {
    const colors = [0xfff0a0, 0xffc040, 0xff7a18, 0xe03a08];
    for (let i = 0; i < n; i++) {
      const r = (big ? 3.5 : 2.2) + Math.random() * (big ? 3 : 2);
      const x0 = wx + (Math.random() - 0.5) * (big ? 22 : 8);
      const y0 = wy + (Math.random() - 0.5) * (big ? 14 : 6);
      const f = this.add.circle(x0, y0, r, colors[Math.floor(Math.random() * colors.length)]).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: f,
        x: x0 + (Math.random() - 0.5) * 8,
        y: y0 - (big ? 18 + Math.random() * 18 : 6 + Math.random() * 10),
        scale: 0.25,
        alpha: 0,
        delay: big ? Math.random() * 160 : 0,
        duration: (big ? 420 : 260) + Math.random() * 160,
        ease: 'Quad.easeOut',
        onComplete: () => f.destroy(),
      });
    }
  }

  /** 溅血（技能 hitFx: 'blood'）：受击者胸口迸出几滴红点，抛物线落下后淡出；必杀多溅几滴 */
  private bloodSplash(x: number, y: number, crit = false) {
    const p = cellToWorld(x, y);
    const cy = p.y - 34; // 大约胸口高度
    const n = crit ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const r = 1.5 + Math.random() * 2;
      const drop = this.add.circle(p.x, cy, r, Math.random() < 0.3 ? 0x8a0a0a : 0xc81414).setDepth(depthOf(x, y, 11));
      const vx = (Math.random() - 0.5) * 60;
      const up = 18 + Math.random() * 22;
      const t = { k: 0 };
      this.tweens.add({
        targets: t,
        k: 1,
        duration: 420 + Math.random() * 180,
        ease: 'Linear',
        onUpdate: () => {
          drop.x = p.x + vx * t.k;
          drop.y = cy - up * t.k + 70 * t.k * t.k;
          drop.setAlpha(1 - t.k * t.k);
        },
        onComplete: () => drop.destroy(),
      });
    }
  }

  private float(x: number, y: number, text: string, color = '#ffffff', side = 0, lift = 0, lifetime = 1200) {
    const p = cellToWorld(x, y);
    p.y -= lift * 26 + barTop(this.headAt(x, y)) + 13; // 第一行字的中线在状态条上方
    const t = this.add
      .text(p.x + side * 4, p.y, loc(text), { fontFamily: 'serif', fontSize: '22px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 4 })
      .setOrigin(side < 0 ? 1 : side > 0 ? 0 : 0.5, 0.5)
      .setDepth(100000);
    this.tweens.add({ targets: t, y: p.y - 20, duration: 350, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: lifetime - 300, duration: 300, onComplete: () => t.destroy() });
  }

  private async banner(text: string) {
    const cam = this.cameras.main;
    const t = this.add
      .text(0, 0, loc(text), { fontFamily: 'serif', fontSize: '34px', color: '#f1e6d0', stroke: '#000', strokeThickness: 6, backgroundColor: '#00000088', padding: { x: 24, y: 10 } })
      .setOrigin(0.5)
      .setDepth(200000)
      .setScale(1 / cam.zoom)
      .setPosition(cam.worldView.centerX, cam.worldView.centerY);
    await wait(this, 700);
    t.destroy();
  }

  private async walkPath(u: Unit, path: Cell[]) {
    const s = this.sprites.get(u.uid);
    if (!s) return;
    const fast = u.side !== 'player';
    await this.focus(path[path.length - 1].x, path[path.length - 1].y);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], c = path[i];
      const dir = c.x > a.x ? 3 : c.x < a.x ? 1 : c.y > a.y ? 2 : 0;
      const key = animFor(this, this.assets, this.vs(u).cls, ACTION.walk, dir);
      if (key && s.spr.anims.currentAnim?.key !== key) s.spr.play(key);
      else s.spr.anims.resume();
      const p = cellToWorld(c.x, c.y);
      s.spr.setDepth(depthOf(Math.max(a.x, c.x), Math.max(a.y, c.y), 8));
      s.bar.clear();
      if (s.cart) {
        s.cart.setDepth(depthOf(Math.max(a.x, c.x), Math.max(a.y, c.y), 8) - 0.1);
        this.tweens.add({ targets: s.cart, x: p.x, y: p.y, duration: fast ? 110 : 150 });
      }
      await new Promise<void>((r) => this.tweens.add({ targets: s.spr, x: p.x, y: p.y, duration: fast ? 110 : 150, onComplete: () => r() }));
    }
  }

  /** 火势蔓延【新】：照规则里正在烧的格子增删火焰（新点着的淡入、熄灭的淡出） */
  private syncFire(cells: Cell[], instant: boolean) {
    this.fireCells = cells;
    const anim = blazeAnim(this, this.assets, FX_BLAZE);
    const want = new Set(cells.map((c) => `${c.x},${c.y}`));
    for (const [k, spr] of this.fireSprites) {
      if (want.has(k)) continue;
      this.fireSprites.delete(k);
      if (instant) spr.destroy();
      else this.tweens.add({ targets: spr, alpha: 0, duration: 500, onComplete: () => spr.destroy() });
    }
    if (!anim) return;
    for (const c of cells) {
      const k = `${c.x},${c.y}`;
      if (this.fireSprites.has(k)) continue;
      const p = cellToWorld(c.x, c.y);
      const spr = this.add.sprite(p.x, p.y + 6, '__DEFAULT').setDepth(depthOf(c.x, c.y, 6)).setScale(0.85).setTint(0xff9a50);
      spr.play({ key: anim, startFrame: Math.floor(Math.random() * 6) });
      this.fireSprites.set(k, spr);
      if (!instant) {
        spr.setAlpha(0);
        this.tweens.add({ targets: spr, alpha: 0.95, duration: 500 });
      } else spr.setAlpha(0.95);
    }
  }

  /** 命中特效（技能 hitFx）：在受击者格子上放一组特效，压在人物前面；放完自己消失 */
  private hitEffect(cell: Cell, group: number, audible: boolean): Promise<void> {
    const anim = effectAnim(this, this.assets, group);
    if (audible) sound.effect(group);
    if (!anim) return Promise.resolve();
    const p = cellToWorld(cell.x, cell.y);
    const s = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(cell.x, cell.y, 11));
    s.play(anim);
    return new Promise<void>((r) => {
      const done = () => {
        if (s.active) s.destroy();
        r();
      };
      s.once('animationcomplete', done);
      this.time.delayedCall(3000, done);
    });
  }

  /** 在格子上放一组固定特效（EXE 0x403860：直接指定组号），同时播特效音 <组号+1>（0x403880）；放完才返回 */
  private fixedFx(cell: Cell, group: number): Promise<void> {
    const anim = effectAnim(this, this.assets, group);
    sound.effect(group);
    if (!anim) return Promise.resolve();
    const p = cellToWorld(cell.x, cell.y);
    const s = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(cell.x, cell.y, 10));
    s.play(anim);
    return new Promise<void>((r) => {
      const done = () => {
        if (s.active) s.destroy();
        r();
      };
      s.once('animationcomplete', done);
      this.time.delayedCall(3000, done); // 保险：动画事件没来也不卡住
    });
  }

  /** 播一次动作；durationMs 给了就按比例加快到这么长播完（集气技，见 cast-timing.ts castPlayMs） */
  private async playOnce(u: Unit, action: number, facing: number, maxMs = 800, durationMs: number | null = null, cycles = 1, speed = 1) {
    const s = this.sprites.get(u.uid);
    const key = s && animFor(this, this.assets, this.vs(u).cls, action, facing, 0);
    if (!s || !key) return wait(this, 250);
    const n = durationMs ? (this.anims.get(key)?.getTotalFrames() ?? 0) : 0;
    if (n) s.spr.play({ key, frameRate: n / (durationMs! / 1000) });
    else if (cycles > 1 || speed !== 1) {
      s.spr.play({ key, repeat: cycles - 1, frameRate: (this.anims.get(key)?.frameRate ?? 1000 / ACTION_FRAME_MS) * speed });
    } else s.spr.play(key);
    await new Promise<void>((r) => {
      const done = () => r();
      s.spr.once('animationcomplete', done);
      this.time.delayedCall(maxMs, done);
    });
  }

  private async play(e: BattleEvent) {
    const b = this.battle;
    const tr = this.assets.tr;
    switch (e.type) {
      case 'ball': {
        const v = this.cujuView;
        if (!v) break;
        if (e.result === 'place') {
          v.place({ x: e.x, y: e.y });
          break;
        }
        await v.roll(v.cell, e.path, this.fast);
        v.place(e.result === 'out' ? (e.path.at(-1) ?? { x: e.x, y: e.y }) : { x: e.x, y: e.y });
        if (e.text) this.float(e.x, e.y, e.text, e.result === 'goal' ? '#ffd040' : e.result === 'intercept' ? '#ff8060' : '#e0e0e0', 0, 0, e.result === 'goal' ? 1800 : 1200);
        if (e.result === 'goal') {
          this.cameras.main.shake(300, 0.006);
          sound.sfx('m12', 'win');
          this.setTurn(b.turn, 0, PHASE_NAME[this.playingSide]);
          await wait(this, this.fast ? 300 : 900);
        } else if (e.result !== 'stop') await wait(this, this.fast ? 150 : 400);
        break;
      }
      case 'say': {
        const u = e.uid !== null ? b.unit(e.uid) : undefined;
        if (u?.present) await this.focusOn(u);
        const cls = u ? this.vs(u).cls : this.assets.data.classes.findIndex((c) => c.name === e.speaker);
        await this.ui.say(e.speaker, e.text, cls >= 0 ? cls : null);
        break;
      }
      case 'narrate':
        await this.ui.say('', e.text);
        break;
      case 'ask': {
        // 伏兵号令：原版在友军阶段由模式 9 的单位弹出（EXE 0x407b26），这里放在我方阶段开始时问【新】。
        // 文字取 EXE 对话框 0：问题 + 是/否，选后主角说对应台词；选「是」发出号令（0x413896 → 0x40de20）
        const p = e.prompt;
        const name = (cls: number) => this.assets.data.classes[cls]?.name ?? '';
        const k = await new Promise<number>((r) =>
          this.ui.result(true, `${name(p.speaker)}：${p.question}`, p.options.map((label, i) => ({ label, run: () => r(i) })), '号令', true),
        );
        this.ui.hideResult();
        await this.ui.say(name(p.replies[k].speaker), p.replies[k].text, p.replies[k].speaker);
        if (k === 0) for (const x of this.battle.signal()) await this.play(x);
        break;
      }
      case 'choice': {
        // 剧情选项（扩展包指令 120）：选一项，接着演对应的分支【新】
        const c = e.choice;
        const k = await new Promise<number>((r) =>
          this.ui.result(true, c.prompt, c.options.map((o, i) => ({ label: o.label, run: () => r(i) })), '抉择', true),
        );
        this.ui.hideResult();
        for (const x of this.battle.answer(k)) await this.play(x);
        break;
      }
      case 'pick': {
        // 选人（剧本指令 27）：原版在地图上点一个人，这里弹出名单【新】
        const p = e.pick;
        const units = p.candidates.map((id) => b.unit(id)!).filter(Boolean);
        const req = p.required.map((id) => b.unit(id)!).filter(Boolean);
        const chosen = await this.ui.pick(p.prompt, units, req, p.count, p.recommended);
        for (const x of this.battle.choose(chosen)) await this.play(x);
        break;
      }
      case 'objective':
        await this.ui.say('', e.lines.join('\n'));
        break;
      case 'phase':
        this.playingSide = e.side;
        this.setTurn(e.turn, b.turnLimit, PHASE_NAME[e.side] + (e.side === 'player' ? '' : this.fast ? '　▸▸ 快进中' : '　双击地图快进'));
        this.refreshAll();
        if (e.side === 'player') {
          const first = b.active().find((u) => u.side === 'player' && !u.ended);
          if (first) await this.focusOn(first, 400);
        }
        if (e.side === 'player' || b.units.some((u) => u.side === e.side && u.present && u.alive)) {
          await this.banner(e.side === 'player' ? `第 ${e.turn} 回合` : `${PHASE_NAME[e.side]}行动`);
        }
        break;
      case 'look': {
        // 换职业：淡出再淡入换样子（披虎皮的猎户现出原形）
        const u = b.unit(e.uid)!;
        const s = this.sprites.get(u.uid);
        if (!s) {
          this.vs(u).cls = e.classId;
          break;
        }
        await this.focusOn(u, 300);
        await new Promise<void>((r) => this.tweens.add({ targets: s.spr, alpha: 0, duration: 250, onComplete: () => r() }));
        this.vs(u).cls = e.classId;
        s.head = classHead(this.assets, e.classId);
        this.pose(u);
        this.drawBar(u);
        await new Promise<void>((r) => this.tweens.add({ targets: s.spr, alpha: 1, duration: 250, onComplete: () => r() }));
        break;
      }
      case 'appear':
        await this.appearAll([e]);
        break;
      case 'move': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        if (e.path.length > 1) {
          sound.sfx('m09'); // 开始移动（EXE 0x405f20）
          await this.walkPath(u, e.path);
        }
        const last = e.path[e.path.length - 1];
        Object.assign(v, { x: last.x, y: last.y, facing: e.facing });
        this.pose(u);
        break;
      }
      case 'face':
        this.vs(b.unit(e.uid)!).facing = e.facing;
        this.pose(b.unit(e.uid)!);
        break;
      case 'attack': {
        const u = b.unit(e.uid)!;
        const uv = this.vs(u);
        uv.facing = e.facing;
        const skill = e.skill;
        const basic = skill === attackSkill(u, this.assets.data);
        // 反击：先在反击者脚下放第 37 组特效（声音 38），放完再出手（EXE 0x4077a0 → 0x407850）
        if (e.counter) await this.fixedFx(uv, FX_COUNTER);
        await Promise.all([this.focus(e.cell.x, e.cell.y), ensureSkill(this.assets, u.classId, skill)]);
        let area: Phaser.GameObjects.Graphics | null = null;
        if (!basic) {
          area = this.add.graphics().setDepth(-0.4);
          for (const c of e.area) this.diamond(area, c, isSupportSkill(skill) ? 0x40b0e0 : 0xf09030, 0.45);
        }
        if (announcesSkill(u, skill, this.assets.data)) this.float(uv.x, uv.y, this.assets.tr(skill.name));
        // 受击与出手同步：按技能的命中帧（HUM 技能 +28，帧号从 1 起）在出手动画进行中触发；范围内的人同时受击
        const segs = skill.hits.filter((h) => h.frame > 0 && h.dir === skill.hits[0].dir);
        const frames = segs.length ? segs.map((h) => h.frame) : [1];
        // 技能特效（src/game/effects.ts，按原版 EXE 0x4073e0 / 0x403780 / 0x4041e0）：
        // 每个命中帧放一轮；从施放点一圈圈往外，每格按"第一段 → 第二段 → 命中特效"接力，最后一段到触发帧时这一格的人才受击
        const fx = skillFx(skill);
        const from = { x: uv.x, y: uv.y };
        const dir = dirIndex(from, e.cell, e.facing);
        const triggers = this.assets.data.effectTriggers ?? [];
        const key = (c: Cell) => `${c.x},${c.y}`;
        const hitAt = new Set(e.hits.map((h) => key(this.vs(b.unit(h.uid)!))));
        const spots = fx ? fxSpots(skill, from, e.cell, e.area, (c) => hitAt.has(key(c))) : [];
        const chains = spots.map((sp) => ({ ...sp, chain: fxChain(fx!, dir, hitAt.has(key(sp.cell)), triggers) }));
        /** 目标在特效开始后多久受击（ms） */
        const fxDelay = (c: Cell) => {
          const sp = chains.find((x) => x.cell.x === c.x && x.cell.y === c.y);
          return sp ? (sp.ring + sp.chain.resolveFrame) * EFFECT_FRAME_MS : 0;
        };
        const fxWave = (): Promise<void> => {
          const all: Promise<void>[] = [];
          for (const sp of chains)
            for (const [pi, part] of sp.chain.parts.entries()) {
              const anim = effectAnim(this, this.assets, part.group);
              if (!anim) continue;
              // 特效音 <组号+1>（EXE 0x403880）；遠程技的第一段不出声
              const audible = !(pi === 0 && fx?.directional);
              all.push(
                new Promise<void>((r) => {
                  this.time.delayedCall((sp.ring + part.startFrame) * EFFECT_FRAME_MS, () => {
                    if (audible) sound.effect(part.group);
                    const p = cellToWorld(sp.cell.x, sp.cell.y);
                    const s = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(sp.cell.x, sp.cell.y, 10));
                    s.play(anim);
                    // 火箭：飞行中的箭（遠程技第一段）染成橙红，每到一格在箭身上冒几簇火苗
                    if (skill.fxTint !== undefined) s.setTint(skill.fxTint);
                    if (pi === 0 && fx?.projectile && skill.arrowFx === 'fire') {
                      s.setTint(0xffa060);
                      const c = s.getCenter();
                      this.flames(c.x ?? p.x, c.y ?? p.y - 30, depthOf(sp.cell.x, sp.cell.y, 10.5), 4);
                    }
                    const done = () => {
                      if (s.active) s.destroy();
                      r();
                    };
                    s.once('animationcomplete', done);
                    this.time.delayedCall(4000, done); // 保险：动画事件没来也不卡住
                  });
                }),
              );
            }
          return Promise.all(all).then(() => undefined);
        };
        const segStart = (f: number) => castSegmentMs(f, skill);
        const waves: Promise<void>[] = [];
        if (fx && !fx.atEnd) for (const f of new Set(frames)) waves.push(new Promise<void>((r) => this.time.delayedCall(segStart(f), () => fxWave().then(r))));
        // 同一帧的几段同时结算（如武龍的两段普攻）：数字左右错开一起弹出，受击动作和声音只做一次
        const sameFrame = frames.map((f, i) => ({ k: frames.slice(0, i).filter((g) => g === f).length, n: frames.filter((g) => g === f).length }));
        const impacts = frames.flatMap((f, i) =>
          e.hits.map(
            (h) =>
              new Promise<void>((r) => {
                const t = b.unit(h.uid)!;
                const tv = this.vs(t);
                this.time.delayedCall(segStart(f) + (fx && !fx.atEnd ? fxDelay(tv) : 0), () => {
                  const res = h.result;
                  const { k, n } = sameFrame[i];
                  const side = n > 1 ? Math.sign(k - (n - 1) / 2) : 0; // 两段：左边那个右对齐、右边那个左对齐，中间留一点缝
                  const lift = [...new Set(frames)].indexOf(f); // 不同帧的段依次往上错开
                  if (!res.hit) {
                    // 落空也做受击动作，只是显示 MISS、不掉血（负责人对原版的记忆）
                    if (i > 0) return r();
                    this.float(tv.x, tv.y, MISS_FLOAT.text, MISS_FLOAT.color);
                    return void this.playOnce(t, ACTION.hurt, tv.facing, 400).then(r);
                  }
                  const perPart = res.parts.length === frames.length;
                  if (perPart && !res.partHit[i]) {
                    this.float(tv.x, tv.y, MISS_FLOAT.text, MISS_FLOAT.color, side, lift); // 多段攻击中落空的一段
                    return r();
                  }
                  const dmg = perPart ? res.parts[i] : i === frames.length - 1 ? res.damage : null;
                  const crit = perPart ? res.partCrit[i] : res.crit;
                  // 同一帧里第一段命中的负责受击动作和受击声（另一段必杀时再补一声必杀音）
                  const lead = frames.findIndex((g, j) => g === f && (!perPart || res.partHit[j])) === i;
                  if (dmg !== null && dmg > 0 && (lead || crit)) sound.hurt(crit);
                  if (dmg !== null && dmg > 0 && skill.hitFx === 'blood') this.bloodSplash(tv.x, tv.y, crit);
                  // 爆炸：每段命中都在受击者身上炸一次，不等它放完（声音只在受击动作那段出）
                  const hg = skill.hitFx ? HIT_FX_GROUP[skill.hitFx] : undefined;
                  if (dmg !== null && dmg > 0 && hg !== undefined) void this.hitEffect(tv, hg, lead);
                  if (dmg !== null && dmg > 0 && skill.arrowFx === 'fire') this.flames(cellToWorld(tv.x, tv.y).x, cellToWorld(tv.x, tv.y).y - 34, depthOf(tv.x, tv.y, 11), crit ? 16 : 10, true);
                  if (dmg !== null) {
                    const df = damageFloat(dmg, crit);
                    this.float(tv.x, tv.y, df.text, df.color, side, perPart ? lift : 0);
                  }
                  if (!lead) return r();
                  this.playOnce(t, ACTION.hurt, tv.facing, 400).then(r);
                });
              }),
          ),
        );
        // 集气技、类型 9 的回复技：出手动画放完才放特效（原版 0x407522）
        sound.cast(skill.soundId ?? skill.skillId, skill.type, basic);
        // 集气技的出手动作压到 CHARGE_CAST_MAX_MS 内（武松、李逵借的蹲姿循环原本要近 3 秒）
        const castMs = castPlayMs(this.assets, uv.cls, skill, e.facing);
        const cycles = Math.max(1, skill.castCycles ?? 1);
        const speed = castPlaybackRate(skill);
        const naturalMs = actionMs(this.assets, uv.cls, ACTION.firstSkill + skill.group, e.facing) ?? 0;
        const maxCastMs = cycles > 1 ? Math.max(2500, naturalMs * cycles / speed + 300) : 2500;
        const cast = this.playOnce(u, ACTION.firstSkill + skill.group, e.facing, castMs ? castMs + 300 : maxCastMs, castMs, cycles, speed);
        if (fx?.atEnd) waves.push(cast.then(fxWave));
        await Promise.all([cast, ...waves, ...impacts]);
        area?.destroy();
        this.pose(u);
        for (const h of e.hits) this.pose(b.unit(h.uid)!);
        break;
      }
      case 'hp': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        v.hp = e.hp;
        v.mp = e.mp;
        this.drawBar(u);
        // 回复只弹数字（原版不写道具名、技能名）：回血绿字，回气黄字在上一行；"升級了！"这类没有数字的照旧弹文字
        const nums = recoveryFloats(e.delta, e.mpDelta ?? 0);
        for (const f of nums) this.float(v.x, v.y, f.text, f.color, 0, f.lift);
        if (e.text && !nums.length && e.delta === 0 && !e.mpDelta) this.float(v.x, v.y, tr(e.text));
        if (e.text) await wait(this, 400);
        break;
      }
      case 'status': {
        if (e.text === '解開') this.sprites.get(e.uid)?.cart?.setVisible(false);
        const v = this.vs(b.unit(e.uid)!);
        this.float(v.x, v.y, tr(e.text), '#c080ff');
        await wait(this, 300);
        break;
      }
      case 'defend': {
        const u = b.unit(e.uid)!;
        this.pose(u);
        // 原版只给我方（阵营 0）放防御特效第 48 组和声音 49（EXE 0x4075c0 → 0x40765f）；敌方、友军防御没有
        if (e.on && u.side === 'player') await this.fixedFx(this.vs(u), FX_DEFEND);
        break;
      }
      case 'die':
      case 'leave': {
        if (e.type === 'die') {
          // 原版 0x404c80：我方（阵营 0）倒下播 m13「戰敗了！」；敌方（阵营 2）只在掉落道具时播 m14，友军不出声。
          // 重制版敌方倒下一律播 m14（负责人 2026-11-12：敌方不该用 m13，可以给一个专门的声音）【新】
          const side = b.unit(e.uid)?.side;
          if (side === 'player') sound.sfx('m13', 'ko');
          else if (side === 'enemy') sound.sfx('m14', 'ko');
        }
        const s = this.sprites.get(e.uid);
        if (s) {
          s.bar.destroy();
          s.cart?.destroy();
          await this.fade(s.spr, 0, e.type === 'die' ? 500 : LEAVE_MS);
          s.spr.destroy();
          this.sprites.delete(e.uid);
        }
        break;
      }
      case 'message':
        this.ui.message(e.text);
        break;
      case 'subtitle':
        await this.banner(tr(e.text));
        break;
      // 剧情演出（扩展包指令 109–113）
      case 'uproot': {
        const images=this.removeTree(e.cells);
        if(!images.length)break;
        const base=cellToWorld(3,13),group=this.add.container(base.x,base.y).setDepth(Math.max(...images.map(i=>i.depth))+32);
        for(const image of images){image.setPosition(image.x-base.x,image.y-base.y);group.add(image);}
        await this.focus(3,13,300);
        sound.hurt(false);
        await new Promise<void>(resolve=>this.tweens.add({targets:group,x:base.x+6,duration:70,yoyo:true,repeat:5,onComplete:()=>resolve()}));
        const dust=this.add.graphics().setPosition(base.x,base.y).setDepth(group.depth+1);
        for(let i=0;i<14;i++)dust.fillStyle(0xbaa078,0.65).fillCircle((i%7-3)*11,Math.floor(i/7)*-9,5+i%4);
        this.tweens.add({targets:dust,alpha:0,scaleX:2,scaleY:1.6,duration:900,onComplete:()=>dust.destroy()});
        sound.hurt(false);
        await new Promise<void>(resolve=>this.tweens.add({targets:group,y:base.y-110,angle:-12,alpha:0,duration:850,ease:'Cubic.easeOut',onComplete:()=>resolve()}));
        group.destroy(true);
        break;
      }
      case 'flourish': {
        const u=b.unit(e.uid)!;const v=this.vs(u);v.facing=e.facing;
        const skill=attackSkill(u,this.assets.data);await ensureSkill(this.assets,v.cls,skill);
        await this.focusOn(u,250);sound.cast(skill.soundId??skill.skillId,skill.type,true);
        const action=ACTION.firstSkill+skill.group;
        await this.playOnce(u,action,e.facing,(actionMs(this.assets,v.cls,action,e.facing)??1200)+100);
        this.pose(u);break;
      }
      case 'shot': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        v.facing = e.facing;
        const skill = attackSkill(u, this.assets.data);
        await ensureSkill(this.assets, v.cls, skill);
        await this.focusOn(u, 250);
        const action = ACTION.firstSkill + skill.group;
        const duration = actionMs(this.assets, v.cls, action, e.facing) ?? 1200;
        const release = Math.min(duration - 1, Math.max(0, ((skill.hits.find(h => h.frame > 0)?.frame ?? 12) - 1) * ACTION_FRAME_MS));
        const cast = this.playOnce(u, action, e.facing, duration + 100);
        await wait(this, release);
        sound.cast(skill.soundId ?? skill.skillId, skill.type, true);
        const from = cellToWorld(v.x, v.y), to = cellToWorld(e.x, e.y);
        // 简洁箭影，箭头、箭杆、尾羽沿真实起点到落点飞行；高层绘制避免被屋檐遮掉。
        const arrow = this.add.graphics().setDepth(100000);
        arrow.lineStyle(2, 0xe8d4a0).lineBetween(-24, 0, 7, 0);
        arrow.fillStyle(0xd9e2eb).fillTriangle(11, 0, 3, -4, 3, 4);
        arrow.lineStyle(2, 0xf2eee0).lineBetween(-23, -4, -17, 0).lineBetween(-23, 4, -17, 0);
        arrow.setPosition(from.x, from.y - 40).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
        try {
          // 镜头随箭向目标移动，手机也能看到落点。
          const flight = this.focus(e.x, e.y, 500);
          await new Promise<void>(resolve => {
            this.tweens.add({ targets: arrow, x: to.x, y: to.y - 40, duration: 500, onComplete: () => resolve() });
          });
          await flight;
          sound.hurt(false);
          this.float(e.x, e.y, e.text, '#ffe6a3');
          const spark = this.add.graphics().setPosition(to.x, to.y - 40).setDepth(100001);
          spark.lineStyle(2, 0xffe6a3);
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            spark.lineBetween(Math.cos(a) * 4, Math.sin(a) * 4, Math.cos(a) * 15, Math.sin(a) * 15);
          }
          this.tweens.add({ targets: spark, alpha: 0, duration: 250, onComplete: () => spark.destroy() });
          if (e.target !== undefined) {
            const target = b.unit(e.target)!;
            await this.playOnce(target, ACTION.hurt, this.vs(target).facing, 450);
            this.pose(target);
          } else await wait(this, 250);
          await cast;
        } finally { arrow.destroy(); this.pose(u); }
        break;
      }
      case 'act': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        v.facing = e.facing;
        await this.focusOn(u, 300);
        if (e.action === 'hurt') sound.hurt(false);
        const action = e.action === 'hurt' ? ACTION.hurt : e.action === 'defend' ? ACTION.defend : idleAction(this.assets, v.cls);
        await this.playOnce(u, action, e.facing, 1200);
        if (e.action !== 'defend') this.pose(u);
        break;
      }
      case 'fire':
        this.syncFire(e.cells, this.fast);
        break;
      case 'tint':
        this.tintFilter = applyTint(this.cameras.main, isStageTint(e.tint) ? e.tint : undefined, this.tintFilter);
        await wait(this, 200);
        break;
      case 'focus':
        await this.focus(e.x, e.y, 400);
        break;
      case 'wait':
        await wait(this, this.fast ? 0 : e.ms);
        break;
      case 'portrait': {
        this.setPortrait(e);
        break;
      }
      case 'sound':
        if (e.name === 'm12' || e.name === 'm05') this.endSound = true;
        sound.sfx(e.name);
        break;
      case 'pickup':
        sound.sfx('m07'); // 拾到宝物（EXE 0x4054e0「得到了」）
        this.groundItems.get(`${e.x},${e.y}`)?.destroy();
        this.groundItems.delete(`${e.x},${e.y}`);
        break;
      case 'end':
        // 过关 / 失败音由剧本指令 29 / 30 发出；全灭等没有剧本的结局在这里补上
        if (!this.endSound) sound.sfx(e.result === 'won' ? 'm12' : 'm05', e.result === 'won' ? 'win' : 'lose');
        this.select({ kind: 'idle' });
        await wait(this, 300);
        if (this.onEnd) this.onEnd(this.battle, e.result === 'won', e.text);
        else this.ui.result(e.result === 'won', e.text, [{ label: '重新开始', run: () => this.scene.restart({ assets: this.assets, ui: this.ui, stage: this.stageName, map: this.mapName, makeInput: this.makeInput }) }]);
        break;
    }
  }
}
