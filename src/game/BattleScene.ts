// 战斗场景（M-B）：渲染地图与单位，接收玩家操作，播放规则引擎输出的事件流。
import Phaser from 'phaser';
import { parseMap } from '../formats/map.ts';
import { Battle, type BattleEvent } from '../rules/battle.ts';
import type { Cell } from '../rules/board.ts';
import type { Member } from '../rules/campaign.ts';
import { findStageFile, loadStage } from '../rules/load.ts';
import { canEquip, EQUIP_SLOTS, equipSlotOf, isUsable, itemOf, itemSummary, type SkillDef } from '../rules/data.ts';
import { isSupportSkill } from '../rules/skills.ts';
import { attackSkill, type Unit } from '../rules/unit.ts';
import { frameToCanvas, ICON_KEY, type Assets } from './assets.ts';
import { cellToWorld, depthOf, HALF_H, HALF_W, worldToCell } from './iso.ts';
import { dirIndex, fxChain, fxSpots, skillFx } from './effects.ts';
import { ACTION, ACTION_FRAME_MS, animFor, EFFECT_FRAME_MS, effectAnim, textureFor } from './sprites.ts';
import type { BattleUI, Command } from './ui.ts';

export interface BattleSceneData {
  assets: Assets;
  stage: string;
  ui: BattleUI;
  seed?: number;
  /** 前面关卡延续下来的我方人物 */
  party?: Map<number, Member>;
  /** 关卡结束（胜负面板由调用方决定） */
  onEnd?: (battle: Battle, won: boolean, text: string) => void;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'selected'; u: Unit }
  | { kind: 'attack'; u: Unit }
  | { kind: 'item'; u: Unit }
  /** 选中了一格道具；op = 正在选使用 / 给予的对象，或确认丢弃 */
  | { kind: 'itemSlot'; u: Unit; slot: number; op?: 'use' | 'give' | 'discard' }
  | { kind: 'skills'; u: Unit }
  | { kind: 'skill'; u: Unit; skill: SkillDef };
const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** 人物身体的点击范围（相对格子中心，世界坐标） */
const BODY_HALF_W = 24;
const BODY_H = 82;
const PHASE_NAME = { player: '我方', ally: '友军', enemy: '敌方' } as const;
const SIDE_COLOR = { player: 0x6fbf5a, ally: 0x5aa0d8, enemy: 0xd0603e } as const;
const SLOT_LABEL = ['武器', '衣服', '头饰', '物品', '物品', '物品', '物品'];
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));

export class BattleScene extends Phaser.Scene {
  private assets!: Assets;
  private ui!: BattleUI;
  private stageName = 'N01';
  private seed?: number;
  private party?: Map<number, Member>;
  private onEnd?: BattleSceneData['onEnd'];
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
  /** 非我方阶段双击后快进：时间、补间、动画都加速，镜头直接跳过去【新】 */
  private fast = false;
  private lastTap = 0;
  /** 正在回放的阶段（引擎已经算到下一回合，不能用 battle.phase） */
  private playingSide: 'player' | 'ally' | 'enemy' = 'player';
  private down: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private hoverCell: Cell | null = null;

  constructor() {
    super('battle');
  }

  init(data: BattleSceneData) {
    this.assets = data.assets;
    this.ui = data.ui;
    this.ui.onSkip = () => this.busy && this.setFast(true);
    this.stageName = data.stage;
    this.seed = data.seed;
    this.party = data.party;
    this.onEnd = data.onEnd;
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
    this.battle = new Battle(loadStage(files, this.assets.data, this.stageName, { simplified: true, seed: this.seed, text: this.assets.tr, party: this.party }));

    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const p = cellToWorld(x, y);
        map.cells[y * map.width + x].forEach((l, k) => {
          // 地表图块 0 是地图外的空格（通行判断 0x40bc30 也把它当不可走）；它的图是一块绿网格，不画（推测原版也不画）
          if (k === 0 && l.tile === 0) return;
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
      const key = textureFor(this, `obj:${item.icon}`, () => frameToCanvas(fr, this.assets.palette, ICON_KEY));
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
    if (m.kind === 'skill' && !this.busy && this.battle.skillTargets(m.u, m.skill).some((t) => sameCell(t, c)))
      for (const a of this.battle.skillArea(m.u, m.skill, c)) this.diamond(g, a, 0xf09030, 0.45);
    this.diamond(g, c, 0xffffff, 0.5, true);
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
    if (m.kind === 'skill') {
      this.setFloatCommands(m);
      const c = this.hoverCell;
      const b = this.battle;
      const name = this.assets.tr(m.skill.name);
      if (c && b.skillTargets(u, m.skill).some((t) => sameCell(t, c))) {
        const hit = b.affected(u, m.skill, c);
        const t = hit.find((h) => sameCell(h, c)) ?? hit[0];
        const more = hit.length > 1 ? `${name}：范围内 ${hit.length} 人` : name;
        if (isSupportSkill(m.skill)) this.ui.showUnit(t, null, more);
        else this.ui.showUnit(t, b.preview(u, t, m.skill), more);
      } else this.ui.showUnit(u, null, `${name}（气力 ${m.skill.mpCost}）：选择施放位置`);
      return;
    }
    if (m.kind === 'item' || m.kind === 'itemSlot') {
      this.ui.setCommands(this.commands(m)); // 道具、装备菜单仍在右下角
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
        title: `${SLOT_LABEL[m.slot]} · ${name}${n ? ` +${n}` : ''}`,
        lines: [itemSummary(it, n), this.assets.tr(it.description)],
        warn: m.op === 'discard' ? `确定丢弃${name}？丢掉就找不回来了。` : m.slot >= EQUIP_SLOTS && equipSlotOf(it) >= 0 ? (canEquip(this.assets.data.classes[u.classId], it, this.assets.data) ? '放在物品栏里不算加成，装备后才生效' : `${u.name}不能装备这件`) : '',
      });
    }
    const target = hovered && u.side === 'player' && this.battle.attackTargets(u).includes(hovered) ? hovered : undefined;
    if (target) this.ui.showUnit(target, this.battle.preview(u, target));
    else if (hovered && hovered !== u) this.ui.showUnit(hovered);
    else this.ui.showUnit(u, null, m.kind === 'attack' ? '选择攻击目标' : '');
    this.setFloatCommands(m);
  }

  /** 攻击、技能、防御等指令放在人物旁边，跟着镜头移动（位置在 update 里每帧更新） */
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
    if (m.kind === 'skills' || m.kind === 'skill') {
      return [
        ...b.skillsOf(u).map(({ skill, usable }) => ({
          label: `${this.assets.tr(skill.name)} ${skill.mpCost}`,
          enabled: usable,
          on: m.kind === 'skill' && m.skill === skill,
          run: () => this.select({ kind: 'skill', u, skill }),
        })),
        { label: '返回', run: () => this.select({ kind: 'selected', u }) },
      ];
    }
    const skills = b.skillsOf(u);
    return [
      { label: '攻击', enabled: b.attackTargets(u).length > 0, on: m.kind === 'attack', run: () => this.select(m.kind === 'attack' ? { kind: 'selected', u } : { kind: 'attack', u }) },
      ...(skills.length ? [{ label: '技能', enabled: skills.some((k) => k.usable), run: () => this.select({ kind: 'skills', u }) }] : []),
      { label: '防御', run: () => this.exec(u, () => b.defend(u)) },
      { label: '休息', enabled: !u.acted, run: () => this.exec(u, () => b.rest(u)) },
      { label: '道具', enabled: u.slots.some(Boolean), run: () => this.select({ kind: 'item', u }) },
      { label: '待机', run: () => this.exec(u, () => b.wait(u)) },
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
        label: `${SLOT_LABEL[k]}｜${it ? this.assets.tr(it.name) + (n ? ` +${n}` : '') : '—'}`,
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
    if (m.op === 'use') {
      const self = b.itemTargets(u, slot).includes(u);
      return [
        ...(self ? [{ label: '对自己使用', run: () => this.exec(u, () => b.useItem(u, slot, u), list) }] : []),
        ...b.itemTargets(u, slot).filter((t) => t !== u).map((t) => ({ label: `给${t.name}使用`, run: () => this.exec(u, () => b.useItem(u, slot, t), list) })),
        { label: '返回', run: () => this.select({ ...m, op: undefined }) },
      ];
    }
    if (m.op === 'give') {
      return [
        ...b.giveTargets(u, slot).map((t) => ({ label: `交给${t.name}`, run: () => this.exec(u, () => b.giveItem(u, slot, t), list) })),
        { label: '返回', run: () => this.select({ ...m, op: undefined }) },
      ];
    }
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
      if (this.busy && this.playingSide !== 'player' && !this.ui.inDialog) {
        const now = performance.now();
        if (now - this.lastTap < 400) this.setFast(true);
        this.lastTap = now;
        return;
      }
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
    if (m.kind === 'skill') {
      const cells = b.skillTargets(m.u, m.skill);
      if (cells.some((t) => sameCell(t, c))) return c;
      const t = hits.find((h) => cells.some((k) => sameCell(k, h)));
      if (t) return { x: t.x, y: t.y };
    }
    if (m.kind === 'itemSlot' && m.op) {
      const targets = this.itemOpTargets(m);
      const at = b.unitAt(c.x, c.y);
      if (at && targets.includes(at)) return c;
      const t = hits.find((h) => targets.includes(h));
      if (t) return { x: t.x, y: t.y };
    }
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
    this.drawHover();
    if (!this.busy && !this.ui.inDialog) this.updatePanel();
  }

  private click(c: Cell) {
    if (this.busy || this.ui.inDialog || this.battle.status !== 'playing') return;
    const b = this.battle;
    const at = b.unitAt(c.x, c.y);
    const m = this.mode;
    if (m.kind === 'skill') {
      const { u, skill } = m;
      if (b.skillTargets(u, skill).some((t) => sameCell(t, c))) return void this.exec(u, () => b.useSkill(u, skill, c));
      return this.select({ kind: 'selected', u });
    }
    if (m.kind === 'itemSlot' && (m.op === 'use' || m.op === 'give')) {
      const { u, slot } = m;
      if (at && this.itemOpTargets(m).includes(at)) {
        const list: Mode = { kind: 'item', u };
        return void this.exec(u, () => (m.op === 'use' ? b.useItem(u, slot, at) : b.giveItem(u, slot, at)), list);
      }
      return this.select({ ...m, op: undefined });
    }
    if (m.kind === 'item' || m.kind === 'itemSlot') {
      if (at && at !== m.u) return this.select({ kind: 'selected', u: at });
      return;
    }
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

  private setFast(on: boolean) {
    if (this.fast === on) return;
    this.fast = on;
    const k = on ? 12 : 1;
    this.time.timeScale = k;
    this.tweens.timeScale = k;
    this.anims.globalTimeScale = k;
    const b = this.battle;
    if (on) this.ui.setTurn(b.turn, b.turnLimit, PHASE_NAME[this.playingSide] + '　▸▸ 快进中');
  }

  /** 快进：不播动画，只做必须的画面变化；对白、结局照常显示 */
  private skip(e: BattleEvent) {
    switch (e.type) {
      case 'message':
        this.ui.message(e.text);
        break;
      case 'die':
      case 'leave': {
        const s = this.sprites.get(e.uid);
        s?.bar.destroy();
        s?.spr.destroy();
        this.sprites.delete(e.uid);
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
        this.ui.setTurn(e.turn, this.battle.turnLimit, PHASE_NAME[e.side] + (e.side === 'player' ? '' : '　▸▸ 快进中'));
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
    try {
      for (const e of events) {
        // 跳过剧情：对白不显示，也不为它移动镜头；其余事件按快进处理
        if (this.ui.skipping) {
          this.setFast(true);
          if (e.type === 'say' || e.type === 'narrate' || e.type === 'objective') continue;
        }
        const story = e.type === 'say' || e.type === 'narrate' || e.type === 'objective' || e.type === 'end' || e.type === 'ask';
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
    if (this.fast) return void cam.centerOn(p.x, p.y);
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
        const cls = u ? u.classId : this.assets.data.classes.findIndex((c) => c.name === e.speaker);
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
      case 'objective':
        await this.ui.say('', e.lines.join('\n'));
        break;
      case 'phase':
        this.playingSide = e.side;
        this.ui.setTurn(e.turn, b.turnLimit, PHASE_NAME[e.side] + (e.side === 'player' ? '' : this.fast ? '　▸▸ 快进中' : '　双击地图快进'));
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
        const u = b.unit(e.uid)!;
        const uv = this.vs(u);
        uv.facing = e.facing;
        const skill = e.skill;
        const basic = skill === attackSkill(u, this.assets.data);
        await this.focus(e.cell.x, e.cell.y);
        let area: Phaser.GameObjects.Graphics | null = null;
        if (!basic) {
          area = this.add.graphics().setDepth(-0.4);
          for (const c of e.area) this.diamond(area, c, isSupportSkill(skill) ? 0x40b0e0 : 0xf09030, 0.45);
          this.float(uv.x, uv.y, this.assets.tr(skill.name));
        }
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
            for (const part of sp.chain.parts) {
              const anim = effectAnim(this, this.assets, part.group);
              if (!anim) continue;
              all.push(
                new Promise<void>((r) => {
                  this.time.delayedCall((sp.ring + part.startFrame) * EFFECT_FRAME_MS, () => {
                    const p = cellToWorld(sp.cell.x, sp.cell.y);
                    const s = this.add.sprite(p.x, p.y, '__DEFAULT').setDepth(depthOf(sp.cell.x, sp.cell.y, 10));
                    s.play(anim);
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
        const segStart = (f: number) => (f - 1) * ACTION_FRAME_MS;
        const waves: Promise<void>[] = [];
        if (fx && !fx.atEnd) for (const f of frames) waves.push(new Promise<void>((r) => this.time.delayedCall(segStart(f), () => fxWave().then(r))));
        const impacts = frames.flatMap((f, i) =>
          e.hits.map(
            (h) =>
              new Promise<void>((r) => {
                const t = b.unit(h.uid)!;
                const tv = this.vs(t);
                this.time.delayedCall(segStart(f) + (fx && !fx.atEnd ? fxDelay(tv) : 0), () => {
                  const res = h.result;
                  if (!res.hit) {
                    // 落空也做受击动作，只是显示 MISS、不掉血（负责人对原版的记忆）
                    if (i > 0) return r();
                    this.float(tv.x, tv.y, 'MISS', '#9ab0c0');
                    return void this.playOnce(t, ACTION.hurt, tv.facing, 400).then(r);
                  }
                  const perPart = res.parts.length === frames.length;
                  if (perPart && !res.partHit[i]) {
                    this.float(tv.x, tv.y, 'MISS', '#9ab0c0'); // 多段攻击中落空的一段
                    return r();
                  }
                  const dmg = perPart ? res.parts[i] : i === frames.length - 1 ? res.damage : null;
                  const crit = perPart ? res.partCrit[i] : res.crit;
                  if (dmg !== null) this.float(tv.x, tv.y, (crit ? '必杀 ' : '') + dmg, crit ? '#ffd040' : '#ffffff');
                  this.playOnce(t, ACTION.hurt, tv.facing, 400).then(r);
                });
              }),
          ),
        );
        // 集气技、类型 9 的回复技：出手动画放完才放特效（原版 0x407522）
        const cast = this.playOnce(u, ACTION.firstSkill + skill.group, e.facing, 2500);
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
      case 'die':
      case 'leave': {
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
        if (this.onEnd) this.onEnd(this.battle, e.result === 'won', e.text);
        else this.ui.result(e.result === 'won', e.text, [{ label: '重新开始', run: () => this.scene.restart({ assets: this.assets, ui: this.ui, stage: this.stageName }) }]);
        break;
    }
  }
}
