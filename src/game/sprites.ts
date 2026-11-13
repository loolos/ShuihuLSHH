// 人物动画：Man.lib 中每个职业的动作组按 4 个一组（4 个朝向）。
// 动作组的 param 就是动作类型（负责人看图确认，2026-11-11）：
//   1 = 走路（动作 0），2 = 受击（动作 1），3 = 防御（动作 2，1 帧），
//   0 = 攻击 / 技能（动作 3 起，每个技能一组；士兵的动作 3 是普通攻击）。
// 原版没有单独的站立动作；待机时显示"第一个出手动作（param 0，通常是动作 3 普通攻击）的第 1 帧"，
// 即摆好架势的姿势；没有出手动作的职业（平民等）用走路第 1 帧。见 idleAction。
import Phaser from 'phaser';
import { frameToCanvas, type Assets } from './assets.ts';

export const ACTION = { walk: 0, hurt: 1, defend: 2, firstSkill: 3 } as const;
export const FRAME_MS = 120;
/** 一次性动作（攻击、受击）的帧间隔：比循环动作快，免得出手拖沓【新】 */
export const ACTION_FRAME_MS = 45;

export function textureFor(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): string {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
  return key;
}

/**
 * 待机姿势用的动作号。原版 0x4058d0（行动结束、解除防御时调用）：防御中显示防御帧；否则
 * 0x41bf80 在职业的动作组里按 4 个一组找第一个 param = 0 的组（出手动作），取当前朝向的第 1 帧；
 * 找不到就退回职业的第一组（走路）。全部 72 个职业里找到的都是动作 3，平民等 9 个职业没有出手动作。
 */
export function idleAction(assets: Assets, cls: number): number {
  const c = assets.man.classes[cls];
  if (!c) return ACTION.walk;
  for (let g = c.first; g <= c.last; g += 4) if (assets.man.actions[g]?.param === 0) return (g - c.first) / 4;
  return ACTION.walk;
}

/** 职业 cls 的动作 action、朝向 facing 对应的动画键；不存在时返回 null */
export function animFor(scene: Phaser.Scene, assets: Assets, cls: number, action: number, facing: number, repeat = -1): string | null {
  const c = assets.man.classes[cls];
  if (!c) return null;
  const group = c.first + action * 4 + (facing & 3);
  if (group > c.last) return null;
  const range = assets.man.actions[group];
  if (!range) return null;
  const key = `man:${group}:${repeat}`;
  if (!scene.anims.exists(key)) {
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = range.first; i <= range.last; i++) {
      const fr = assets.man.frame(i);
      const tk = textureFor(scene, `man:${i}`, () => frameToCanvas(fr, assets.palette));
      // 每帧锚点不同：用帧的自定义原点
      const f = scene.textures.get(tk).get();
      f.customPivot = true;
      f.pivotX = fr.anchorX / Math.max(1, fr.width);
      f.pivotY = fr.anchorY / Math.max(1, fr.height);
      frames.push({ key: tk });
    }
    scene.anims.create({ key, frames, frameRate: 1000 / (repeat === 0 ? ACTION_FRAME_MS : FRAME_MS), repeat });
  }
  return key;
}

/**
 * 技能特效帧间隔。原版每个特效对象自带 75 ms 计时（EXE 构造函数 0x4036ad 写 +0x2f = 0x4B，0x403610 按毫秒比较）；
 * 这里和人物出手动作一样加快一些【新】。
 */
export const EFFECT_FRAME_MS = 60;

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
    scene.anims.create({ key, frames, frameRate: 1000 / EFFECT_FRAME_MS, repeat: 0 });
  }
  return key;
}
