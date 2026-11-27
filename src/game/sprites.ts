// 人物动画：Man.lib 中每个职业的动作组按 4 个一组（4 个朝向）。
// 动作组的 param 就是动作类型（负责人看图确认，2026-11-11）：
//   1 = 走路（动作 0），2 = 受击（动作 1），3 = 防御（动作 2，1 帧），
//   0 = 攻击 / 技能（动作 3 起，每个技能一组；士兵的动作 3 是普通攻击）。
// 原版没有单独的站立动作；待机时显示"第一个出手动作（param 0，通常是动作 3 普通攻击）的第 1 帧"，
// 即摆好架势的姿势；没有出手动作的职业（平民等）用走路第 1 帧。见 idleAction。
import Phaser from 'phaser';
import { frameToCanvas, manClassOf, manSource, type Assets } from './assets.ts';
import { paintShoes, recolorLut } from '../packs/recolor.ts';
import type { PackAssets } from './packs.ts';
import { ACTION_FRAME_MS, EFFECT_FRAME_MS } from './cast-timing.ts';

export const ACTION = { walk: 0, hurt: 1, defend: 2, firstSkill: 3 } as const;
export const FRAME_MS = 120;
export { ACTION_FRAME_MS, EFFECT_FRAME_MS };

/** 本文件建的纹理、动画（换关时 releaseSprites 一起删掉） */
const madeTextures = new Set<string>();
const madeAnims = new Set<string>();

export function textureFor(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): string {
  // 用普通纹理，不用 addCanvas：addCanvas 建的 CanvasTexture 会 getImageData 再存一份像素（每张图多占一倍内存）。
  // 这些画布画好后不再改，用不着 CanvasTexture。
  if (!scene.textures.exists(key)) {
    scene.textures.addImage(key, make() as unknown as HTMLImageElement);
    madeTextures.add(key);
  }
  return key;
}

function createAnim(scene: Phaser.Scene, config: Phaser.Types.Animations.Animation & { key: string }) {
  scene.anims.create(config);
  madeAnims.add(config.key);
}

/** 建过的纹理大约占多少字节（RGBA） */
export function spriteBytes(game: Phaser.Game): number {
  let n = 0;
  for (const k of madeTextures) for (const s of game.textures.get(k)?.source ?? []) n += s.width * s.height * 4;
  return n;
}

/**
 * 删掉建过的人物、特效纹理和动画，释放内存（画布 + 显存）。只能在没有游戏对象还用着它们时调用（战斗场景已停）；
 * 之后用到时会按需重新建。不删的话每换一关多占几十 MB，玩久了浏览器会因内存不足把网页重新载入。
 */
export function releaseSprites(game: Phaser.Game): void {
  for (const k of madeAnims) game.anims.remove(k);
  madeAnims.clear();
  for (const k of madeTextures) if (game.textures.exists(k)) game.textures.remove(k);
  madeTextures.clear();
}

/**
 * 待机姿势用的动作号。原版 0x4058d0（行动结束、解除防御时调用）：防御中显示防御帧；否则
 * 0x41bf80 在职业的动作组里按 4 个一组找第一个 param = 0 的组（出手动作），取当前朝向的第 1 帧；
 * 找不到就退回职业的第一组（走路）。全部 72 个职业里找到的都是动作 3，平民等 9 个职业没有出手动作。
 */
export function idleAction(assets: Assets, cls: number): number {
  if (sheetLook(assets, cls)) return PACK_IDLE;
  if (assets.pack?.rt.looks.get(cls)?.idleWalk) return ACTION.walk;
  const c = assets.man.classes[manClassOf(assets, cls)];
  if (!c) return ACTION.walk;
  for (let g = c.first; g <= c.last; g += 4) if (assets.man.actions[g]?.param === 0) return (g - c.first) / 4;
  return ACTION.walk;
}

/** 职业 cls 的动作 action、朝向 facing 对应的动画键；不存在时返回 null */
export function animFor(scene: Phaser.Scene, assets: Assets, cls: number, action: number, facing: number, repeat = -1): string | null {
  if (sheetLook(assets, cls)) return packAnim(scene, assets.pack!, cls, action, facing, repeat);
  const { lut, shoes, tag } = paintOf(assets, cls, action);
  const src = manSource(assets, cls, action);
  const c = assets.man.classes[src.cls];
  if (!c) return null;
  const group = c.first + src.action * 4 + (facing & 3);
  if (group > c.last) return null;
  const range = assets.man.actions[group];
  if (!range) return null;
  const key = `man:${group}:${repeat}${tag}`;
  if (!scene.anims.exists(key)) {
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = range.first; i <= range.last; i++) {
      const fr = assets.man.frame(i);
      const tk = textureFor(scene, `man:${i}${tag}`, () => {
        if (!lut && !shoes) return frameToCanvas(fr, assets.palette);
        const pixels = lut ? fr.pixels.map((p) => lut[p]) : Uint8Array.from(fr.pixels);
        if (shoes) paintShoes(pixels, fr.width, fr.height, shoes);
        return frameToCanvas({ ...fr, pixels }, assets.palette);
      });
      // 每帧锚点不同：用帧的自定义原点
      const f = scene.textures.get(tk).get();
      f.customPivot = true;
      f.pivotX = fr.anchorX / Math.max(1, fr.width);
      f.pivotY = fr.anchorY / Math.max(1, fr.height);
      frames.push({ key: tk });
    }
    createAnim(scene, { key, frames, frameRate: 1000 / (repeat === 0 ? ACTION_FRAME_MS : FRAME_MS), repeat });
  }
  return key;
}

// 技能特效帧间隔 EFFECT_FRAME_MS（cast-timing.ts）：原版每个特效对象自带 75 ms 计时
// （EXE 构造函数 0x4036ad 写 +0x2f = 0x4B，0x403610 按毫秒比较）；这里和人物出手动作一样加快一些【新】。

/**
 * Effect.lib 第 group 组（0 起）的动画。技能用哪一组见 src/game/effects.ts（不是直接拿技能子项 +6）。
 */
export function effectAnim(scene: Phaser.Scene, assets: Assets, group: number): string | null {
  const range = group >= 0 ? assets.effects.actions[group] : undefined;
  if (!range) return null;
  const key = `fx:g${group}`;
  if (!scene.anims.exists(key)) {
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = range.first; i <= range.last; i++) {
      const fr = assets.effects.frame(i);
      const tk = textureFor(scene, `fx:f${i}`, () => frameToCanvas(fr, assets.palette));
      const f = scene.textures.get(tk).get();
      f.customPivot = true;
      f.pivotX = fr.anchorX / Math.max(1, fr.width);
      f.pivotY = fr.anchorY / Math.max(1, fr.height);
      frames.push({ key: tk });
    }
    createAnim(scene, { key, frames, frameRate: 1000 / EFFECT_FRAME_MS, repeat: 0 });
  }
  return key;
}

/**
 * 着火格子上一直烧着的火（火势蔓延【新】，火烧草料场）：取 Effect.lib 第 group 组（41：地上一圈火焰）中段火势最旺的几帧，
 * 来回循环播放。
 */
export function blazeAnim(scene: Phaser.Scene, assets: Assets, group: number, from = 4, to = 10): string | null {
  const range = assets.effects.actions[group];
  if (!range || range.first + to > range.last) return null;
  const key = `fx:blaze${group}`;
  if (!scene.anims.exists(key)) {
    const base = effectAnim(scene, assets, group);
    if (!base) return null;
    const frames = scene.anims.get(base)!.frames.slice(from, to + 1).map((f) => ({ key: f.textureKey }));
    createAnim(scene, { key, frames, frameRate: 1000 / (EFFECT_FRAME_MS * 1.6), repeat: -1, yoyo: true });
  }
  return key;
}

const headCache = new Map<number, number>();
/** 普通身材的人物头顶状态条一律按这个高度放（世界像素，脚下往上）【新】 */
export const HEAD_STD = 62;

/**
 * 职业 cls 的头顶高度（负责人 2026-11-14：所有人状态条差不多高）。取走路动作 4 个朝向第 1 帧里
 * 最高不透明像素离锚点高度的最小值（举起的兵器只在部分朝向冒出来，取最小值就去掉了）；
 * 普通身材（不超过 70）一律按 HEAD_STD，只有骑马、巨汉这类明显高大的职业（42、43、48、54 等）按实际高度。
 */
export function classHead(assets: Assets, cls: number): number {
  const look = assets.pack?.rt.looks.get(cls);
  if (look?.head !== undefined) return look.head;
  if (look && look.from === undefined) return HEAD_STD;
  cls = manClassOf(assets, cls);
  let h = headCache.get(cls);
  if (h !== undefined) return h;
  const c = assets.man.classes[cls];
  let min = Infinity;
  for (let d = 0; c && d < 4; d++) {
    const g = c.first + d;
    const range = g <= c.last ? assets.man.actions[g] : undefined;
    if (!range) continue;
    const fr = assets.man.frame(range.first);
    let top = 0;
    while (top < fr.height && !rowOpaque(fr.pixels, fr.width, top)) top++;
    min = Math.min(min, fr.anchorY - top);
  }
  h = min > 70 && min !== Infinity ? min : HEAD_STD;
  headCache.set(cls, h);
  return h;
}

const rowOpaque = (px: ArrayLike<number>, w: number, y: number) => {
  for (let x = 0; x < w; x++) if (px[y * w + x]) return true;
  return false;
};

/** 扩展包里用自己图条的职业（不是借原版动画的） */
const sheetLook = (assets: Assets, cls: number) => {
  const look = assets.pack?.rt.looks.get(cls);
  return !!look && look.from === undefined;
};

interface Paint {
  /** 换色表；不换色为 null */
  lut: Uint8Array | null;
  /** 染鞋的换色表；不染为 null */
  shoes: Uint8Array | null;
  /** 纹理键的后缀：换过色的帧按职业（混搭的再按动作）单独缓存，不和被借的原版职业共用 */
  tag: string;
}
const NO_PAINT: Paint = { lut: null, shoes: null, tag: '' };
/** 借原版动画的扩展包职业第 action 个动作的换色（按包缓存） */
const paints = new WeakMap<object, Map<string, Paint>>();
function paintOf(assets: Assets, cls: number, action: number): Paint {
  const look = assets.pack?.rt.looks.get(cls);
  if (!look) return NO_PAINT;
  const part = look.parts?.get(action);
  const groups = part ? part.recolor : look.recolor;
  const shoes = part?.shoes ? look.shoes : undefined;
  if (!groups?.length && !shoes) return NO_PAINT;
  const k = part ? `${cls}:${action}` : `${cls}`;
  const m = paints.get(assets.pack!) ?? paints.set(assets.pack!, new Map()).get(assets.pack!)!;
  if (!m.has(k))
    m.set(k, {
      lut: groups?.length ? recolorLut(assets.palette, groups) : null,
      shoes: shoes ? recolorLut(assets.palette, [{ src: [[1, 255]], dst: shoes.dst, k: shoes.k }]) : null,
      tag: part ? `:c${cls}a${action}` : `:c${cls}`,
    });
  return m.get(k)!;
}

/** 扩展包职业的待机动作号（不是 Man.lib 的动作组，animFor 里换成包里的 idle 动作） */
export const PACK_IDLE = 1000;

/**
 * 扩展包职业的动画（图条见 packs/<包>/sprites/，tools/render-sprites.py 渲染）。图条只有 front / back 两个方向：
 * 和原版一样，front 面向左下 = 朝向 2（+y）、back 面向右上 = 朝向 0（−y）；朝向 3、1 用水平翻转（屏幕方向见 iso.ts）。
 */
function packAnim(scene: Phaser.Scene, pack: PackAssets, cls: number, action: number, facing: number, repeat: number): string | null {
  const look = pack.rt.looks.get(cls)!;
  const name = action === PACK_IDLE ? look.idle : look.actions[action];
  const sheet = pack.rt.sheets[look.sheet];
  const act = name ? sheet?.actions[name] : undefined;
  if (!act) return null;
  const front = (facing & 3) >= 2;
  const flip = (facing & 3) === 3 || (facing & 3) === 1;
  const strip = front ? act.front : act.back;
  const key = `pack:${look.sheet}:${name}:${facing & 3}:${repeat}`;
  if (!scene.anims.exists(key)) {
    const img = pack.images.get(`${look.sheet}/${strip.file}`);
    if (!img) return null;
    const [fw, fh] = sheet.frame;
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let k = 0; k < strip.frames; k++) {
      const tk = textureFor(scene, `pack:${look.sheet}/${strip.file}:${k}:${flip ? 'f' : ''}`, () => {
        const c = document.createElement('canvas');
        c.width = fw;
        c.height = fh;
        const ctx = c.getContext('2d')!;
        if (flip) {
          ctx.translate(fw, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(img, k * fw, 0, fw, fh, 0, 0, fw, fh);
        return c;
      });
      const f = scene.textures.get(tk).get();
      f.customPivot = true;
      f.pivotX = (flip ? fw - sheet.anchor[0] : sheet.anchor[0]) / fw;
      f.pivotY = sheet.anchor[1] / fh;
      frames.push({ key: tk });
    }
    const sequence = Array.from({ length: strip.cycles ?? 1 }, () => frames).flat();
    createAnim(scene, { key, frames: sequence, frameRate: 1000 / strip.ms, repeat });
  }
  return key;
}
