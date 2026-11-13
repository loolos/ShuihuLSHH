// 战斗画面左上角的小地图【新：可开关、半透明、点击移动镜头】。
//
// 原版的微缩地图（静态分析，未运行 EXE）：
// - 0x412b10 建一个和画面一样大的窗口（宽高取自 0x44a7d0 / 0x44a7c6，镜头居中 0x40be7d 也用这两个值），
//   缩小比例 sx = (W+H)×46 / 窗口宽 + 1、sy = (W+H)×23 / 窗口高 + 1，整张等距地图缩进窗口里；
// - 0x412cf0 逐格把地表图块缩小画上去（0x412c00 → 0x422040），只画地表，不画上层（房屋、树木）；
// - 人物和宝物画成 8×8 的小方块（0x412ba0：中心 ((H−y+x)×46/sx, (x+y)×23/sy)，0x422670 填色）。
//   人物按阵营取色（0x405a50：+0x3b 为 0 → 色号 0xf，1 → 0x8，2 → 0xc），宝物取 0xa / 0xd（0x401190，
//   只画显示标志 0x2 置位的，开局隐藏的宝物不画）。色号对应的调色板没有核实【待核】。
// 网页版：保留"整图缩小 + 地表 + 彩色方块"的做法，另外把不能走的格子压暗、画出当前镜头范围，
// 不占满全屏而是放在左上角，可以随时收起。
import { HALF_H, HALF_W } from './iso.ts';

/** 小地图上的一个标记点（格子坐标） */
export interface MiniMark {
  x: number;
  y: number;
  color: string;
}

export interface MiniLayout {
  /** 世界坐标 → 小地图像素的缩放 */
  scale: number;
  /** 小地图像素尺寸（CSS 像素） */
  width: number;
  height: number;
  /** 世界坐标左上角 */
  minX: number;
  minY: number;
}

/**
 * 整张等距地图的世界范围（每格是以中心为准、半宽 45、半高 23 的菱形），缩放到不超过 maxW × maxH。
 * 与原版一样按 (W+H) 计算外接矩形。
 */
export function miniLayout(mapW: number, mapH: number, maxW: number, maxH: number): MiniLayout {
  const minX = -(mapH - 1) * HALF_W - HALF_W;
  const maxX = (mapW - 1) * HALF_W + HALF_W;
  const minY = -HALF_H;
  const maxY = (mapW + mapH - 2) * HALF_H + HALF_H;
  const scale = Math.min(maxW / (maxX - minX), maxH / (maxY - minY));
  return { scale, minX, minY, width: Math.round((maxX - minX) * scale), height: Math.round((maxY - minY) * scale) };
}

export const worldToMini = (l: MiniLayout, wx: number, wy: number) => ({ x: (wx - l.minX) * l.scale, y: (wy - l.minY) * l.scale });
export const miniToWorld = (l: MiniLayout, mx: number, my: number) => ({ x: mx / l.scale + l.minX, y: my / l.scale + l.minY });

/** 小地图最大尺寸：电脑上约 300×220；手机（窄屏或矮屏）可以占到半个屏幕 */
export function miniMaxSize(viewW: number, viewH: number): { w: number; h: number } {
  const small = viewW < 700 || viewH < 500;
  if (small) return { w: Math.min(viewW - 16, 480), h: Math.round(viewH * 0.45) };
  return { w: Math.min(300, Math.round(viewW * 0.3)), h: 220 };
}

const STORE = 'shuihu.minimap';

export interface MinimapSource {
  width: number;
  height: number;
  /** 地表图块号（0 = 地图外的空格，不画） */
  ground: (x: number, y: number) => number;
  blocked: (x: number, y: number) => boolean;
  /** 地表图块的图和锚点 */
  tile: (t: number) => { img: CanvasImageSource; w: number; h: number; ax: number; ay: number } | null;
}

/** 小地图（HTML 画布，盖在 Phaser 画布上）。底图只画一次，标记和镜头框每帧重画。 */
export class Minimap {
  private root: HTMLElement;
  private btn: HTMLButtonElement;
  private wrap: HTMLElement;
  private base = document.createElement('canvas');
  private top = document.createElement('canvas');
  private layout!: MiniLayout;
  private dpr = 1;
  private dragging = false;
  private sig = '';
  open: boolean;
  /** 点击 / 拖动小地图：把镜头中心移到这个世界坐标 */
  onJump: (wx: number, wy: number) => void = () => {};

  constructor(private src: MinimapSource) {
    this.root = document.getElementById('minimap')!;
    this.root.replaceChildren();
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.id = 'minimap-toggle';
    this.wrap = document.createElement('div');
    this.wrap.className = 'mm-wrap';
    this.base.className = 'mm-base';
    this.top.className = 'mm-top';
    this.wrap.append(this.base, this.top);
    this.root.append(this.btn, this.wrap);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORE);
    } catch {
      /* 隐私模式 */
    }
    // 默认：电脑上打开，手机上收起（手机上小地图要占半个屏幕）
    this.open = saved === null ? !(innerWidth < 700 || innerHeight < 500) : saved === '1';
    this.btn.onclick = () => this.toggle();
    const jump = (e: PointerEvent) => {
      const r = this.top.getBoundingClientRect();
      const w = miniToWorld(this.layout, e.clientX - r.left, e.clientY - r.top);
      this.onJump(w.x, w.y);
    };
    this.top.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.dragging = true;
      this.top.setPointerCapture?.(e.pointerId);
      jump(e);
    });
    this.top.addEventListener('pointermove', (e) => this.dragging && jump(e));
    const stop = () => (this.dragging = false);
    this.top.addEventListener('pointerup', stop);
    this.top.addEventListener('pointercancel', stop);
    this.root.hidden = false;
    this.apply();
  }

  toggle(open = !this.open) {
    this.open = open;
    try {
      localStorage.setItem(STORE, open ? '1' : '0');
    } catch {
      /* 隐私模式 */
    }
    this.apply();
  }

  private apply() {
    this.btn.textContent = this.open ? '收起地图 ▴' : '小地图 ▾';
    this.btn.setAttribute('aria-expanded', String(this.open));
    this.wrap.hidden = !this.open;
    this.root.classList.toggle('open', this.open);
    if (this.open) this.resize();
  }

  /** 窗口大小变了就重排、重画底图 */
  resize() {
    const max = miniMaxSize(innerWidth, innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sig = `${max.w}x${max.h}@${dpr}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.dpr = dpr;
    this.layout = miniLayout(this.src.width, this.src.height, max.w, max.h);
    for (const c of [this.base, this.top]) {
      c.width = Math.round(this.layout.width * dpr);
      c.height = Math.round(this.layout.height * dpr);
      c.style.width = `${this.layout.width}px`;
      c.style.height = `${this.layout.height}px`;
    }
    this.drawBase();
  }

  private drawBase() {
    const { src, layout: l } = this;
    const g = this.base.getContext('2d')!;
    g.setTransform(this.dpr * l.scale, 0, 0, this.dpr * l.scale, -l.minX * l.scale * this.dpr, -l.minY * l.scale * this.dpr);
    g.imageSmoothingEnabled = true;
    // 原版只画地表图块（0x412cf0）
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const t = src.ground(x, y);
        if (!t) continue;
        const fr = src.tile(t);
        if (!fr) continue;
        const cx = (x - y) * HALF_W, cy = (x + y) * HALF_H;
        g.drawImage(fr.img, cx - fr.ax, cy - fr.ay, fr.w, fr.h);
      }
    // 网页版：不能走的格子压暗（地表上看不出房屋、城墙）
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.beginPath();
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        if (!src.ground(x, y) || !src.blocked(x, y)) continue;
        const cx = (x - y) * HALF_W, cy = (x + y) * HALF_H;
        g.moveTo(cx, cy - HALF_H);
        g.lineTo(cx + HALF_W, cy);
        g.lineTo(cx, cy + HALF_H);
        g.lineTo(cx - HALF_W, cy);
        g.closePath();
      }
    g.fill();
  }

  /** 每帧：人物、宝物、镜头范围（世界坐标矩形） */
  draw(marks: MiniMark[], view: { x: number; y: number; width: number; height: number }) {
    if (!this.open) return;
    const l = this.layout;
    const g = this.top.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, l.width, l.height);
    // 原版是 8×8 的方块；这里随小地图大小在 3～7 像素之间
    const s = Math.max(3, Math.min(7, Math.round(HALF_W * 2 * l.scale)));
    for (const m of marks) {
      const p = worldToMini(l, (m.x - m.y) * HALF_W, (m.x + m.y) * HALF_H);
      g.fillStyle = '#000';
      g.fillRect(Math.round(p.x - s / 2) - 1, Math.round(p.y - s / 2) - 1, s + 2, s + 2);
      g.fillStyle = m.color;
      g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    const a = worldToMini(l, view.x, view.y);
    g.strokeStyle = '#f1e6d0';
    g.lineWidth = 1.5;
    g.strokeRect(a.x, a.y, view.width * l.scale, view.height * l.scale);
  }

  destroy() {
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
