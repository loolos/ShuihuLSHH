// 战场预览场景（M-A）：渲染一张原版地图和其中的单位，可以拖动、缩放。
import Phaser from 'phaser';
import { parseMap } from '../formats/map.ts';
import { parseAct, type ActUnit } from '../formats/act.ts';
import { frameToCanvas, type Assets } from './assets.ts';
import { cellToWorld, depthOf, worldToCell } from './iso.ts';

/**
 * 人物动画：Man.lib 中每个职业的动作组按 4 个一组（4 个朝向）。
 * 动作组的 param 就是动作类型（负责人看图确认，2026-11-11）：
 *   1 = 走路（动作 0），2 = 受击（动作 1），3 = 防御（动作 2，1 帧），
 *   0 = 攻击 / 技能（动作 3 起，每个技能一组；士兵的动作 3 是普通攻击）。
 * 原版没有单独的站立动作；站立时显示走路的第 1 帧。
 */
export const ACTION = { walk: 0, hurt: 1, defend: 2, firstSkill: 3 } as const;
const FRAME_MS = 120;

export interface MapSceneData {
  assets: Assets;
  stage: string; // 地图名，如 "N01"
  showHidden: boolean;
  onHover?: (text: string) => void;
}

export class MapScene extends Phaser.Scene {
  private assets!: Assets;
  private stageName = 'N01';
  private showHidden = false;
  private onHover?: (text: string) => void;
  private dragging: { x: number; y: number; sx: number; sy: number } | null = null;
  private pinch: number | null = null;

  constructor() {
    super('map');
  }

  init(data: MapSceneData) {
    this.assets = data.assets;
    this.stageName = data.stage;
    this.showHidden = data.showHidden;
    this.onHover = data.onHover;
  }

  private texture(key: string, make: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    return key;
  }

  private tileTexture(lib: 'ground' | 'upper', i: number) {
    const fr = this.assets[lib].frame(i);
    return { key: this.texture(`${lib}:${i}`, () => frameToCanvas(fr, this.assets.palette)), fr };
  }

  create() {
    const { files } = this.assets;
    const mapFile = files.list('Map', '.map').find((p) => p.endsWith(`/${this.stageName.toLowerCase()}.map`));
    if (!mapFile) throw new Error(`找不到地图 ${this.stageName}`);
    const map = parseMap(files.get(mapFile), mapFile);
    const actFile = mapFile.replace(/\.map$/, '.act');
    const units = files.has(actFile) ? parseAct(files.get(actFile), actFile) : [];

    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const layers = map.cells[y * map.width + x];
        const p = cellToWorld(x, y);
        layers.forEach((l, k) => {
          const { key, fr } = this.tileTexture(k === 0 ? 'ground' : 'upper', l.tile);
          this.add
            .image(p.x, p.y, key)
            .setOrigin(fr.anchorX / Math.max(1, fr.width), fr.anchorY / Math.max(1, fr.height))
            .setDepth(k === 0 ? -1 : depthOf(x, y, k));
        });
      }

    for (const u of units) this.addUnit(u);

    // 相机：初始对准我方第一个单位，或地图中心
    const cam = this.cameras.main;
    const corners = [cellToWorld(0, 0), cellToWorld(map.width - 1, 0), cellToWorld(0, map.height - 1), cellToWorld(map.width - 1, map.height - 1)];
    const minX = Math.min(...corners.map((c) => c.x)) - 200;
    const maxX = Math.max(...corners.map((c) => c.x)) + 200;
    const minY = -300;
    const maxY = Math.max(...corners.map((c) => c.y)) + 200;
    cam.setBounds(minX, minY, maxX - minX, maxY - minY);
    const focus = units.find((u) => u.side === 'player') ?? { x: map.width / 2, y: map.height / 2 };
    const f = cellToWorld(focus.x, focus.y);
    cam.setZoom(this.scale.width < 700 ? 1 : 2);
    cam.centerOn(f.x, f.y);
    cam.roundPixels = true;

    this.setupInput();
  }

  private addUnit(u: ActUnit) {
    const hidden = (u.flags & 0xff) !== 0 || u.flags >> 8 === 7;
    if (hidden && !this.showHidden) return;
    const p = cellToWorld(u.x, u.y);
    const depth = depthOf(u.x, u.y, 8);

    if (u.side === 'object') {
      const item = this.assets.items[u.type - 1];
      if (!item) return;
      const fr = this.assets.objects.frame(item.icon);
      const key = this.texture(`obj:${item.icon}`, () => frameToCanvas(fr, this.assets.palette));
      this.add.image(p.x, p.y - 8, key).setDepth(depth);
      return;
    }
    const cls = this.assets.man.classes[u.type];
    if (!cls) return;
    const group = cls.first + ACTION.walk * 4 + (u.facing & 3);
    const range = this.assets.man.actions[group];
    const animKey = `man:${group}`;
    if (!this.anims.exists(animKey)) {
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = range.first; i <= range.last; i++) {
        const fr = this.assets.man.frame(i);
        const key = this.texture(`man:${i}`, () => frameToCanvas(fr, this.assets.palette));
        // 每帧锚点不同：用帧的自定义原点
        const tex = this.textures.get(key);
        tex.get().customPivot = true;
        tex.get().pivotX = fr.anchorX / Math.max(1, fr.width);
        tex.get().pivotY = fr.anchorY / Math.max(1, fr.height);
        frames.push({ key });
      }
      this.anims.create({ key: animKey, frames, frameRate: 1000 / FRAME_MS, repeat: -1 });
    }
    const s = this.add.sprite(p.x, p.y, `man:${range.first}`).setDepth(depth);
    // 站立：停在走路的第 1 帧；悬停时播放走路动画，方便检查各朝向
    s.play(animKey);
    s.anims.pause(s.anims.currentAnim!.frames[0]);
    s.on('pointerout', () => s.anims.pause(s.anims.currentAnim!.frames[0]));
    if (hidden) s.setAlpha(0.45);
    s.setData('info', `${this.assets.exe.characterNames[u.type] ?? u.type}（${sideName(u.side)}，Lv${u.level}，AI ${u.flags >> 8}）`);
    s.setInteractive({ pixelPerfect: false });
    s.on('pointerover', () => {
      this.onHover?.(s.getData('info'));
      s.anims.resume();
    });
  }

  private setupInput() {
    const cam = this.cameras.main;
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on('pointerup', () => {
      this.dragging = null;
      this.pinch = null;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinch) this.zoomBy(d / this.pinch);
        this.pinch = d;
        this.dragging = null;
        return;
      }
      if (this.dragging && p.isDown) {
        cam.scrollX = this.dragging.sx - (p.x - this.dragging.x) / cam.zoom;
        cam.scrollY = this.dragging.sy - (p.y - this.dragging.y) / cam.zoom;
      } else {
        const w = cam.getWorldPoint(p.x, p.y);
        const c = worldToCell(w.x, w.y);
        this.onHover?.(`格子 (${c.x}, ${c.y})`);
      }
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.25 : 1.25));
  }

  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.25, 4));
  }
}

function sideName(s: string) {
  return ({ player: '我方', ally: '友军', enemy: '敌方', object: '物件' } as Record<string, string>)[s] ?? s;
}
