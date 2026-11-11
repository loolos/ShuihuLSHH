// 战斗场景（M-B）：渲染地图与单位，接收玩家操作，播放规则引擎输出的事件流。
import Phaser from 'phaser';
import { parseMap } from '../formats/map.ts';
import { Battle, type BattleEvent } from '../rules/battle.ts';
import type { Cell } from '../rules/board.ts';
import { findStageFile, loadStage } from '../rules/load.ts';
import { itemOf } from '../rules/data.ts';
import { attackSkill, type Unit } from '../rules/unit.ts';
import { frameToCanvas, type Assets } from './assets.ts';
import { cellToWorld, depthOf, HALF_H, HALF_W, worldToCell } from './iso.ts';
import { ACTION, ACTION_FRAME_MS, animFor, textureFor } from './sprites.ts';
import type { BattleUI, Command } from './ui.ts';

export interface BattleSceneData {
  assets: Assets;
  stage: string;
  ui: BattleUI;
  seed?: number;
}

type Mode = { kind: 'idle' } | { kind: 'selected'; u: Unit } | { kind: 'attack'; u: Unit } | { kind: 'item'; u: Unit };

/** 人物身体的点击范围（相对格子中心，世界坐标） */
const BODY_HALF_W = 24;
const BODY_H = 82;
const PHASE_NAME = { player: '我方', ally: '友军', enemy: '敌方' } as const;
const SIDE_COLOR = { player: 0x6fbf5a, ally: 0x5aa0d8, enemy: 0xd0603e } as const;
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));

export class BattleScene extends Phaser.Scene {
  private assets!: Assets;
  private ui!: BattleUI;
  private stageName = 'N01';
  private seed?: number;
  battle!: Battle;
  private sprites = new Map<number, { spr: Phaser.GameObjects.Sprite; bar: Phaser.GameObjects.Graphics }>();
  /**
   * 画面上的人物状态。规则引擎一次算完整个敌方回合，事件再逐个回放；
   * 回放期间画面必须按事件推进，不能直接读引擎里的最终位置和体力。
   */
  private view = new Map<number, { x: number; y: number; facing: number; hp: number }>();
  private groundItems = new Map<string, Phaser.GameObjects.Image>();
  private overlay!: Phaser.GameObjects.Graphics;
  private hoverG!: Phaser.GameObjects.Graphics;
  private mode: Mode = { kind: 'idle' };
  private busy = false;
  private down: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private hoverCell: Cell | null = null;

  constructor() {
    super('battle');
  }

  init(data: BattleSceneData) {
    this.assets = data.assets;
    this.ui = data.ui;
    this.stageName = data.stage;
    this.seed = data.seed;
    this.sprites = new Map();
    this.view = new Map();
    this.groundItems = new Map();
    this.mode = { kind: 'idle' };
    this.busy = false;
  }

  create() {
    const { files } = this.assets;
    const mapFile = findStageFile(files, this.stageName, '.map');
    if (!mapFile) throw new Error(`找不到地图 ${this.stageName}`);
    const map = parseMap(files.get(mapFile), mapFile);
    this.battle = new Battle(loadStage(files, this.assets.data, this.stageName, { simplified: true, seed: this.seed, text: this.assets.tr }));

    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const p = cellToWorld(x, y);
        map.cells[y * map.width + x].forEach((l, k) => {
          const lib = k === 0 ? 'ground' : 'upper';
          const fr = this.assets[lib].frame(l.tile);
          const key = textureFor(this, `${lib}:${l.tile}`, () => frameToCanvas(fr, this.assets.palette));
          this.add
            .image(p.x, p.y, key)
            .setOrigin(fr.anchorX / Math.max(1, fr.width), fr.anchorY / Math.max(1, fr.height))
            .setDepth(k === 0 ? -2 : depthOf(x, y, k));
        });
      }
    this.overlay = this.add.graphics().setDepth(-1);
    this.hoverG = this.add.graphics().setDepth(-0.5);

    for (const g of this.battle.items) {
      const item = itemOf(this.assets.data, g.item);
      if (!item) continue;
      const fr = this.assets.objects.frame(item.icon);
      const key = textureFor(this, `obj:${item.icon}`, () => frameToCanvas(fr, this.assets.palette));
      const p = cellToWorld(g.x, g.y);
      this.groundItems.set(`${g.x},${g.y}`, this.add.image(p.x, p.y - 8, key).setDepth(depthOf(g.x, g.y, 7)));
    }
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

    this.setupInput();
    this.ui.clearLog();
    this.ui.showUnit(null);
    this.ui.setCommands(null);
    this.run(this.battle.begin());
  }

  // ───────────── 单位精灵 ─────────────

  private vs(u: Unit) {
    let v = this.view.get(u.uid);
    if (!v) this.view.set(u.uid, (v = { x: u.x, y: u.y, facing: u.facing, hp: u.hp }));
    return v;
  }

  /** 回放结束后与引擎对齐 */
  private syncView() {
    for (const u of this.battle.units) if (this.view.has(u.uid)) this.view.set(u.uid, { x: u.x, y: u.y, facing: u.facing, hp: u.hp });
  }

  private spawn(u: Unit, at?: { x: number; y: number }) {
    const v = this.vs(u);
    if (at) Object.assign(v, at);
    const p = cellToWorld(v.x, v.y);
    const spr = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(v.x, v.y, 8));
    const bar = this.add.graphics().setDepth(depthOf(v.x, v.y, 9));
    this.sprites.set(u.uid, { spr, bar });
    this.pose(u);
    return spr;
  }

  /** 站立姿势：走路第 1 帧；防御中显示防御帧 */
  private pose(u: Unit) {
    const s = this.sprites.get(u.uid);
    if (!s) return;
    const v = this.vs(u);
    const action = u.defending ? ACTION.defend : ACTION.walk;
    const key = animFor(this, this.assets, u.classId, action, v.facing) ?? animFor(this, this.assets, u.classId, ACTION.walk, v.facing);
    if (key) {
      s.spr.play(key);
      s.spr.anims.pause(s.spr.anims.currentAnim!.frames[0]);
    }
    const p = cellToWorld(v.x, v.y);
    s.spr.setPosition(p.x, p.y).setDepth(depthOf(v.x, v.y, 8));
    const dim = u.side === 'player' && u.ended && this.battle.phase === 'player';
    if (dim) s.spr.setTint(0x808080);
    else s.spr.clearTint();
    this.drawBar(u);
  }

  private drawBar(u: Unit) {
    const s = this.sprites.get(u.uid);
    if (!s) return;
    const v = this.vs(u);
    const p = cellToWorld(v.x, v.y);
    const w = 30, r = Math.max(0, v.hp / Math.max(1, u.stats.maxHp));
    s.bar.clear().setDepth(depthOf(v.x, v.y, 9));
    s.bar.fillStyle(0x000000, 0.7).fillRect(p.x - w / 2 - 1, p.y + 10, w + 2, 5);
    s.bar.fillStyle(SIDE_COLOR[u.side], 1).fillRect(p.x - w / 2, p.y + 11, Math.round(w * r), 3);
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
    } else if (m.kind === 'attack') {
      for (const c of this.battle.attackCells(u)) this.diamond(g, c, 0xe04030, 0.25);
      for (const t of this.battle.attackTargets(u)) this.diamond(g, t, 0xe04030, 0.9, true);
    }
    this.diamond(g, u, 0xffffff, 0.8, true);
  }

  private select(m: Mode) {
    this.mode = m;
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
    const target = hovered && u.side === 'player' && this.battle.attackTargets(u).includes(hovered) ? hovered : undefined;
    if (target) this.ui.showUnit(target, this.battle.preview(u, target));
    else if (hovered && hovered !== u) this.ui.showUnit(hovered);
    else this.ui.showUnit(u, null, m.kind === 'attack' ? '选择攻击目标' : '');
    this.ui.setCommands(this.commands(m));
  }

  private commands(m: Mode): Command[] | null {
    if (m.kind === 'idle') return null;
    const u = m.u;
    const b = this.battle;
    if (u.side !== 'player' || !b.canAct(u) || this.busy) return null;
    if (m.kind === 'item') {
      return [
        ...b.usableSlots(u).map((k) => ({
          label: this.assets.tr(itemOf(this.assets.data, u.slots[k])!.name),
          run: () => this.exec(u, () => b.useItem(u, k)),
        })),
        { label: '返回', run: () => this.select({ kind: 'selected', u }) },
      ];
    }
    return [
      { label: '攻击', enabled: b.attackTargets(u).length > 0, on: m.kind === 'attack', run: () => this.select(m.kind === 'attack' ? { kind: 'selected', u } : { kind: 'attack', u }) },
      { label: '防御', run: () => this.exec(u, () => b.defend(u)) },
      { label: '休息', enabled: !u.acted, run: () => this.exec(u, () => b.rest(u)) },
      { label: '道具', enabled: b.usableSlots(u).length > 0, run: () => this.select({ kind: 'item', u }) },
      { label: '待机', run: () => this.exec(u, () => b.wait(u)) },
      ...(b.canUndo(u) ? [{ label: '撤销移动', run: () => this.exec(u, () => b.undoMove(u)) }] : []),
    ];
  }

  /** 执行一个玩家指令并播放结果；单位还能行动就保持选中 */
  private async exec(u: Unit, cmd: () => BattleEvent[]) {
    if (this.busy) return;
    this.overlay.clear();
    this.ui.setCommands(null);
    await this.run(cmd());
    if (this.battle.status !== 'playing') return;
    this.pose(u);
    this.select(this.battle.canAct(u) ? { kind: 'selected', u } : { kind: 'idle' });
  }

  async endTurn() {
    if (this.busy || this.battle.status !== 'playing' || this.battle.phase !== 'player') return;
    this.select({ kind: 'idle' });
    await this.run(this.battle.endPlayerPhase());
  }

  // ───────────── 输入 ─────────────

  private setupInput() {
    const cam = this.cameras.main;
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.down = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, moved: false };
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.down;
      this.down = null;
      this.pinch = null;
      if (d && !d.moved && p.button !== 2) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.click(this.pick(w.x, w.y));
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
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
      const w = cam.getWorldPoint(p.x, p.y);
      this.hover(this.pick(w.x, w.y));
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.2 : 1.2));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() && !this.busy) this.select({ kind: 'idle' });
    });
  }

  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.4, 4));
  }

  /**
   * 指针落点 → 格子。人物身体画在格子上方，玩家自然会点在身体上，
   * 而身体覆盖的是后面一格；所以点到人物身体时按人物所在格处理：
   * 攻击目标优先，其次是空格且不是可移动格时选中该人物。
   */
  private pick(wx: number, wy: number): Cell {
    const c = worldToCell(wx, wy);
    const b = this.battle;
    const hits = b
      .active()
      .filter((u) => {
        const p = cellToWorld(u.x, u.y);
        return Math.abs(wx - p.x) <= BODY_HALF_W && wy >= p.y - BODY_H && wy <= p.y + HALF_H;
      })
      .sort((a, z) => z.x + z.y - (a.x + a.y)); // 靠前（深度大）的优先
    if (!hits.length) return c;
    const m = this.mode;
    if (m.kind === 'selected' || m.kind === 'attack') {
      const targets = b.attackTargets(m.u);
      const at = b.unitAt(c.x, c.y);
      if (at && targets.includes(at)) return c;
      const t = hits.find((h) => targets.includes(h));
      if (t) return { x: t.x, y: t.y };
      if (m.kind === 'selected' && !at && m.u.side === 'player') {
        const { green, yellow } = b.moveRange(m.u);
        if ([...green, ...yellow].some((g) => g.x === c.x && g.y === c.y)) return c;
      }
    }
    if (b.unitAt(c.x, c.y)) return c;
    return { x: hits[0].x, y: hits[0].y };
  }

  private hover(c: Cell) {
    if (this.hoverCell && this.hoverCell.x === c.x && this.hoverCell.y === c.y) return;
    this.hoverCell = c;
    this.hoverG.clear();
    if (this.battle.board.inBounds(c.x, c.y)) this.diamond(this.hoverG, c, 0xffffff, 0.5, true);
    if (!this.busy && !this.ui.inDialog) this.updatePanel();
  }

  private click(c: Cell) {
    if (this.busy || this.ui.inDialog || this.battle.status !== 'playing') return;
    const b = this.battle;
    const at = b.unitAt(c.x, c.y);
    const m = this.mode;
    if (m.kind === 'selected' || m.kind === 'attack') {
      const u = m.u;
      if (at && u.side === 'player' && b.attackTargets(u).includes(at)) return void this.exec(u, () => b.attack(u, at));
      if (m.kind === 'selected' && u.side === 'player' && !at) {
        const { green, yellow } = b.moveRange(u);
        if ([...green, ...yellow].some((g) => g.x === c.x && g.y === c.y)) return void this.exec(u, () => b.move(u, c.x, c.y));
      }
      if (at === u) return this.select({ kind: 'idle' });
    }
    this.select(at ? { kind: 'selected', u: at } : { kind: 'idle' });
  }

  // ───────────── 事件播放 ─────────────

  private async run(events: BattleEvent[]) {
    this.busy = true;
    this.ui.setEndTurnEnabled(false);
    try {
      for (const e of events) await this.play(e);
    } finally {
      this.busy = false;
      this.syncView();
      this.refreshAll();
      const b = this.battle;
      this.ui.setTurn(b.turn, b.turnLimit, PHASE_NAME[b.phase]);
      this.ui.setEndTurnEnabled(b.status === 'playing' && b.phase === 'player');
      if (this.mode.kind !== 'idle') this.redraw();
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
    cam.pan(p.x, p.y, ms, 'Sine.easeInOut');
    await wait(this, ms);
  }

  /** 地图上的飘字：黑底白字，停留一会儿再淡出，保证看得清 */
  private float(x: number, y: number, text: string, _color?: string) {
    const p = cellToWorld(x, y);
    const t = this.add
      .text(p.x, p.y - 72, text, { fontFamily: 'serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#000000', padding: { x: 6, y: 2 } })
      .setOrigin(0.5)
      .setDepth(100000);
    this.tweens.add({ targets: t, y: p.y - 92, duration: 350, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
  }

  private async banner(text: string) {
    const cam = this.cameras.main;
    const t = this.add
      .text(0, 0, text, { fontFamily: 'serif', fontSize: '34px', color: '#f1e6d0', stroke: '#000', strokeThickness: 6, backgroundColor: '#00000088', padding: { x: 24, y: 10 } })
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
      const key = animFor(this, this.assets, u.classId, ACTION.walk, dir);
      if (key && s.spr.anims.currentAnim?.key !== key) s.spr.play(key);
      else s.spr.anims.resume();
      const p = cellToWorld(c.x, c.y);
      s.spr.setDepth(depthOf(Math.max(a.x, c.x), Math.max(a.y, c.y), 8));
      s.bar.clear();
      await new Promise<void>((r) => this.tweens.add({ targets: s.spr, x: p.x, y: p.y, duration: fast ? 110 : 150, onComplete: () => r() }));
    }
  }

  private async playOnce(u: Unit, action: number, facing: number, maxMs = 800) {
    const s = this.sprites.get(u.uid);
    const key = s && animFor(this, this.assets, u.classId, action, facing, 0);
    if (!s || !key) return wait(this, 250);
    s.spr.play(key);
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
      case 'say': {
        const u = e.uid !== null ? b.unit(e.uid) : undefined;
        if (u?.present) await this.focusOn(u);
        await this.ui.say(e.speaker, e.text);
        break;
      }
      case 'narrate':
        await this.ui.say('', e.text);
        break;
      case 'objective':
        await this.ui.say('', e.lines.join('\n'));
        break;
      case 'phase':
        this.ui.setTurn(e.turn, b.turnLimit, PHASE_NAME[e.side]);
        this.refreshAll();
        if (e.side === 'player') {
          const first = b.active().find((u) => u.side === 'player' && !u.ended);
          if (first) await this.focusOn(first, 400);
        }
        if (e.side === 'player' || b.units.some((u) => u.side === e.side && u.present && u.alive))
          await this.banner(e.side === 'player' ? `第 ${e.turn} 回合` : `${PHASE_NAME[e.side]}行动`);
        break;
      case 'appear': {
        const u = b.unit(e.uid)!;
        Object.assign(this.vs(u), { x: e.x, y: e.y });
        await this.focusOn(u);
        const spr = this.sprites.get(u.uid)?.spr ?? this.spawn(u, { x: e.x, y: e.y });
        spr.setAlpha(0);
        this.pose(u);
        await new Promise<void>((r) => this.tweens.add({ targets: spr, alpha: 1, duration: 400, onComplete: () => r() }));
        break;
      }
      case 'move': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        if (e.path.length > 1) await this.walkPath(u, e.path);
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
        const u = b.unit(e.uid)!, t = b.unit(e.target)!;
        const tv = this.vs(t);
        this.vs(u).facing = e.facing;
        await this.focusOn(t);
        // 受击与出手同步：按技能的命中帧（HUM 技能 +28，帧号从 1 起）在出手动画进行中触发
        const skill = attackSkill(u, this.assets.data);
        const hits = skill.hits.filter((h) => h.frame > 0 && h.dir === skill.hits[0].dir);
        const frames = hits.length ? hits.map((h) => h.frame) : [1];
        const parts = e.result.hit ? (e.result.parts.length === frames.length ? e.result.parts : [e.result.damage]) : [];
        const impacts = frames.map((f, i) => {
          const at = (f - 1) * ACTION_FRAME_MS;
          return new Promise<void>((r) =>
            this.time.delayedCall(at, () => {
              if (!e.result.hit) {
                if (i === 0) this.float(tv.x, tv.y, 'MISS', '#9ab0c0');
                return r();
              }
              const dmg = parts.length === frames.length ? parts[i] : i === frames.length - 1 ? e.result.damage : null;
              if (dmg !== null) this.float(tv.x, tv.y, (e.result.crit ? '必杀 ' : '') + dmg, e.result.crit ? '#ffd040' : '#ffffff');
              this.playOnce(t, ACTION.hurt, tv.facing, 400).then(r);
            }),
          );
        });
        await Promise.all([this.playOnce(u, ACTION.firstSkill + skill.group, e.facing, 2500), ...impacts]);
        this.pose(u);
        this.pose(t);
        break;
      }
      case 'hp': {
        const u = b.unit(e.uid)!;
        const v = this.vs(u);
        v.hp = e.hp;
        this.drawBar(u);
        if (e.text) this.float(v.x, v.y, tr(e.text) + (e.delta > 0 ? ` +${e.delta}` : ''), '#90e070');
        else if (e.delta > 0) this.float(v.x, v.y, `+${e.delta}`, '#90e070');
        if (e.text) await wait(this, 400);
        break;
      }
      case 'status': {
        const v = this.vs(b.unit(e.uid)!);
        this.float(v.x, v.y, tr(e.text), '#c080ff');
        await wait(this, 300);
        break;
      }
      case 'defend':
        this.pose(b.unit(e.uid)!);
        break;
      case 'die': {
        const s = this.sprites.get(e.uid);
        if (s) {
          s.bar.destroy();
          await new Promise<void>((r) => this.tweens.add({ targets: s.spr, alpha: 0, duration: 500, onComplete: () => r() }));
          s.spr.destroy();
          this.sprites.delete(e.uid);
        }
        break;
      }
      case 'message':
        this.ui.message(e.text);
        break;
      case 'pickup':
        this.groundItems.get(`${e.x},${e.y}`)?.destroy();
        this.groundItems.delete(`${e.x},${e.y}`);
        break;
      case 'end':
        this.select({ kind: 'idle' });
        await wait(this, 300);
        this.ui.result(e.result === 'won', e.text, () => this.scene.restart({ assets: this.assets, ui: this.ui, stage: this.stageName }));
        break;
    }
  }
}
