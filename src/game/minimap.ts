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
import { text as loc } from '../i18n/index.ts';

/** 小地图上的一个标记点（格子坐标） */
export interface MiniMark {
  x: number;
  y: number;
  color: string;
}

/** 小地图上的区域（格子坐标矩形，含两端）：撤退出口等【新】 */
export interface MiniZone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  label: string;
}

/** 区域外框：格子矩形四个角（格子边缘）在世界坐标里的平行四边形（上、右、下、左） */
export function zoneCorners(z: { x1: number; y1: number; x2: number; y2: number }) {
  const at = (gx: number, gy: number) => ({ x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H });
  return [at(z.x1 - 0.5, z.y1 - 0.5), at(z.x2 + 0.5, z.y1 - 0.5), at(z.x2 + 0.5, z.y2 + 0.5), at(z.x1 - 0.5, z.y2 + 0.5)];
}

/** 毒圈（格子坐标的圆，圆心 + 半径，多算半格同 royale.ts inZone）在世界坐标里的一圈点（等距投影后是个扁椭圆） */
export function ringPoints(z: { x: number; y: number; r: number }, n = 72) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, gx = z.x + (z.r + 0.5) * Math.cos(a), gy = z.y + (z.r + 0.5) * Math.sin(a);
    out.push({ x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H });
  }
  return out;
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

  /** 每帧：目标区域、人物、宝物、镜头范围（世界坐标矩形） */
  draw(marks: MiniMark[], view: { x: number; y: number; width: number; height: number }, zones: MiniZone[] = [], fire: readonly { x: number; y: number }[] = [], ring: { zone: { x: number; y: number; r: number }; next: { x: number; y: number; r: number } | null } | null = null) {
    if (!this.open) return;
    const l = this.layout;
    const g = this.top.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, l.width, l.height);
    // 好汉聚义的毒圈【新】：地图范围里圈外的部分染紫，现在的圈紫线、下一个圈白线
    if (ring) {
      const poly = (pts: { x: number; y: number }[]) => pts.map((p) => worldToMini(l, p.x, p.y)).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      const map = zoneCorners({ x1: 0, y1: 0, x2: this.src.width - 1, y2: this.src.height - 1 });
      g.save();
      g.beginPath();
      poly(map);
      g.closePath();
      g.clip();
      g.beginPath();
      poly(map);
      g.closePath();
      poly(ringPoints(ring.zone));
      g.closePath();
      g.fillStyle = 'rgba(160,80,240,0.35)';
      g.fill('evenodd');
      g.restore();
      const line = (z: { x: number; y: number; r: number }, color: string) => {
        g.beginPath();
        poly(ringPoints(z));
        g.closePath();
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.stroke();
        g.lineWidth = 1.5;
        g.strokeStyle = color;
        g.stroke();
      };
      line(ring.zone, '#b070ff');
      if (ring.next) line(ring.next, '#ffffff');
    }
    // 着火的格子【新】（火烧草料场）：橙红色
    if (fire.length) {
      g.fillStyle = 'rgba(255,96,16,0.75)';
      g.beginPath();
      for (const c of fire) {
        const pts = zoneCorners({ x1: c.x, y1: c.y, x2: c.x, y2: c.y }).map((p) => worldToMini(l, p.x, p.y));
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      }
      g.fill();
    }
    // 撤退出口等区域【新】：半透明填色 + 实线外框，外面再套一个闪动的圈（区域只有两三格时缩小后太小，圈保证看得见），旁边写字
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    for (const z of zones) {
      const pts = zoneCorners(z).map((p) => worldToMini(l, p.x, p.y));
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.globalAlpha = 0.35 + 0.25 * pulse;
      g.fillStyle = z.color;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = '#000';
      g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = z.color;
      g.stroke();
      const cx = (pts[0].x + pts[2].x) / 2, cy = (pts[1].y + pts[3].y) / 2;
      const r = Math.max(7, Math.hypot(pts[1].x - pts[3].x, pts[0].y - pts[2].y) / 2 + 3) + 2 * pulse;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.stroke();
      g.lineWidth = 1.5;
      g.strokeStyle = z.color;
      g.stroke();
      // 字放在圈的上方；靠地图上边时放到下方，左右不出边
      g.font = 'bold 11px sans-serif';
      const label = loc(z.label); // 多语言（§10.3）：画布上的字不经过页面翻译，这里自己换
      const tw = g.measureText(label).width;
      const ty = cy - r - 3 < 12 ? cy + r + 12 : cy - r - 3;
      const tx = Math.max(2, Math.min(l.width - tw - 2, cx - tw / 2));
      g.lineWidth = 3;
      g.strokeStyle = '#000';
      g.strokeText(label, tx, ty);
      g.fillStyle = z.color;
      g.fillText(label, tx, ty);
    }
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
