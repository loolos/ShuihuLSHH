// 蹴鞠外传的画面（docs/game-design.md §15.25）：地图上的皮毬、踢出去时的滚动动画、球路预览。
// 球不用另做图，画布上现画一个缝线的皮毬。
import Phaser from 'phaser';
import type { Cell } from '../rules/board.ts';
import type { KickPreview } from '../rules/battle.ts';
import { cellToWorld, depthOf } from './iso.ts';
import { textureFor } from './sprites.ts';

const R = 9;

function ballCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = R * 2 + 2;
  const g = c.getContext('2d')!;
  const o = R + 1;
  const grad = g.createRadialGradient(o - 3, o - 3, 1, o, o, R);
  grad.addColorStop(0, '#f2c27a');
  grad.addColorStop(0.55, '#b9722e');
  grad.addColorStop(1, '#5a3010');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(o, o, R, 0, Math.PI * 2);
  g.fill();
  // 十二瓣的缝线（宋代的毬是十二片皮缝成）
  g.strokeStyle = 'rgba(60,25,5,0.85)';
  g.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    g.ellipse(o, o, R * (0.35 + k * 0.28), R, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(o - R, o);
  g.lineTo(o + R, o);
  g.stroke();
  g.strokeStyle = '#000';
  g.beginPath();
  g.arc(o, o, R, 0, Math.PI * 2);
  g.stroke();
  return c;
}

export class CujuView {
  private ball: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;
  /** 画面上球现在在哪一格 */
  cell: Cell;

  constructor(private scene: Phaser.Scene, at: Cell) {
    this.shadow = scene.add.ellipse(0, 0, 20, 8, 0x000000, 0.35);
    this.ball = scene.add.image(0, 0, textureFor(scene, 'cuju-ball', ballCanvas));
    this.cell = { ...at };
    this.place(at);
  }

  private set(wx: number, wy: number, h: number, depth: number) {
    this.shadow.setPosition(wx, wy + 4).setDepth(depth - 0.01);
    this.ball.setPosition(wx, wy - R + 2 - h).setDepth(depth);
  }

  place(c: Cell) {
    this.cell = { x: c.x, y: c.y };
    const p = cellToWorld(c.x, c.y);
    this.set(p.x, p.y, 0, depthOf(c.x, c.y, 8) - 0.05);
  }

  /** 从 from 沿 path 滚过去：先腾空飞一段，再落地滚两下；out 时最后一格在场外，淡出 */
  roll(from: Cell, path: Cell[], fast: boolean): Promise<void> {
    if (!path.length) return Promise.resolve();
    const pts = [from, ...path].map((c) => ({ ...cellToWorld(c.x, c.y), c }));
    const n = pts.length - 1;
    const duration = Math.max(200, n * (fast ? 35 : 80));
    const peak = Math.min(60, 10 + n * 6);
    return new Promise((resolve) => {
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration,
        ease: 'Sine.easeOut',
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          const f = t * n;
          const i = Math.min(n - 1, Math.floor(f));
          const k = f - i;
          const a = pts[i], b = pts[i + 1];
          const h = t < 0.65 ? peak * Math.sin((Math.PI * t) / 0.65) : peak * 0.15 * Math.sin((Math.PI * (t - 0.65)) / 0.35);
          const c = k < 0.5 ? a.c : b.c;
          this.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, h, depthOf(c.x, c.y, 8) + (h > 4 ? 0.2 : -0.05));
          this.ball.setRotation(t * n * 1.3);
        },
        onComplete: () => resolve(),
      });
    });
  }

  /** 球路预览：正中时球经过的格子，停的格子画圈；拦截红、出界灰、进球金 */
  drawPreview(g: Phaser.GameObjects.Graphics, ball: Cell, p: KickPreview, diamond: (g: Phaser.GameObjects.Graphics, c: Cell, color: number, alpha: number, outline?: boolean) => void) {
    const color = { stop: 0xf0e070, intercept: 0xe04030, out: 0x909090, goal: 0xffc000 }[p.line.kind];
    for (const c of p.line.path) diamond(g, c, color, 0.3);
    const end = p.line.kind === 'out' ? p.line.path.at(-1) ?? ball : p.line.at;
    diamond(g, end, color, 0.95, true);
    diamond(g, ball, 0xffffff, 0.9, true);
  }

  destroy() {
    this.ball.destroy();
    this.shadow.destroy();
  }
}
