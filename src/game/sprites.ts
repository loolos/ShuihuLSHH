// 人物动画：Man.lib 中每个职业的动作组按 4 个一组（4 个朝向）。
// 动作组的 param 就是动作类型（负责人看图确认，2026-11-11）：
//   1 = 走路（动作 0），2 = 受击（动作 1），3 = 防御（动作 2，1 帧），
//   0 = 攻击 / 技能（动作 3 起，每个技能一组；士兵的动作 3 是普通攻击）。
// 原版没有单独的站立动作；站立时显示走路的第 1 帧。
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

/** 技能特效帧间隔（Effect.lib 组表 param 都是 4，推测为 4 个 tick；这里取 60 ms【待核】） */
export const EFFECT_FRAME_MS = 60;

/**
 * 技能特效动画：技能子项 +6 为特效号，1 起，对应 Effect.lib 第 (特效号 − 1) 组。
 * 证据：一柱擎天 +6 = 39 → 第 38 组是一道竖直光柱（负责人记得原版有光柱）；石破天驚 2 → 第 1 组火柱。0 表示没有特效。
 */
export function effectAnim(scene: Phaser.Scene, assets: Assets, effect: number): string | null {
  const range = effect > 0 ? assets.effects.actions[effect - 1] : undefined;
  if (!range) return null;
  const key = `fx:${effect}`;
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
