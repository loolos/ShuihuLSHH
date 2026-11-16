// 出手动作的时长（纯函数，不依赖 Phaser；tests/cast-timing.test.ts、tools/charge-anim.ts 共用）。
// 帧数与帧间隔和 src/game/sprites.ts 的 animFor / packAnim 一致：原版 Man.lib 的一次性动作按 ACTION_FRAME_MS，
// 扩展包图条按 sprites.json 里每个动作自己的 ms × cycles。
import { manSource, type Assets } from './assets.ts';
import type { SkillDef } from '../rules/data.ts';
import { FX_CHARGE } from './effects.ts';

/** 一次性动作（攻击、受击）的帧间隔：比循环动作快，免得出手拖沓【新】 */
export const ACTION_FRAME_MS = 45;
/** 技能特效帧间隔（原版 75 ms，加快一些【新】；见 sprites.ts effectAnim） */
export const EFFECT_FRAME_MS = 60;
/** 动作号：0 走路、1 受击、2 防御，3 起每个技能组一个出手动作（同 sprites.ts ACTION） */
const FIRST_SKILL = 3;

/**
 * 集气技（类型 8）出手动作最长播多久（负责人 2026-11-15：武松、李逵这类借蹲姿循环动作的集气要好几秒，太慢）【新】。
 * 超过的按比例加快播完，不截掉，动作样子不变；原版大多数集气动作只有 1 帧，不受影响。
 * 加上之后放的第 7 组特效（10 帧 × EFFECT_FRAME_MS = 600 ms），出手 + 特效不超过 CHARGE_TOTAL_MAX_MS。
 */
export const CHARGE_CAST_MAX_MS = 400;
/** 集气技出手动作 + 特效的总时长上限（回复数字弹出后另停 400 ms，所有技能一样，不算在内） */
export const CHARGE_TOTAL_MAX_MS = 1000;

/** 职业 cls 的第 action 个动作、朝向 facing：帧数与每帧毫秒（一次性播放时）；没有这个动作时返回 null */
export function actionFrames(assets: Pick<Assets, 'man' | 'pack'>, cls: number, action: number, facing: number): { frames: number; frameMs: number } | null {
  const look = assets.pack?.rt.looks.get(cls);
  if (look && look.from === undefined) {
    const name = look.actions[action];
    const act = name ? assets.pack!.rt.sheets[look.sheet]?.actions[name] : undefined;
    if (!act) return null;
    const strip = (facing & 3) >= 2 ? act.front : act.back;
    return { frames: strip.frames * (strip.cycles ?? 1), frameMs: strip.ms };
  }
  const src = manSource(assets as Assets, cls, action);
  const c = assets.man.classes[src.cls];
  if (!c) return null;
  const group = c.first + src.action * 4 + (facing & 3);
  const range = group <= c.last ? assets.man.actions[group] : undefined;
  if (!range) return null;
  return { frames: range.last - range.first + 1, frameMs: ACTION_FRAME_MS };
}

/** 动作原本一次播完要多少毫秒 */
export function actionMs(assets: Pick<Assets, 'man' | 'pack'>, cls: number, action: number, facing: number): number | null {
  const a = actionFrames(assets, cls, action, facing);
  return a ? a.frames * a.frameMs : null;
}

/**
 * 出手动作实际播多久：集气技压到 CHARGE_CAST_MAX_MS 以内，其它技能照原样。
 * 返回 null 表示按动画原速播（没有这个动作，或不用加快）。
 */
export function castPlayMs(assets: Pick<Assets, 'man' | 'pack'>, cls: number, skill: Pick<SkillDef, 'type' | 'group'>, facing: number): number | null {
  if (skill.type !== 8) return null;
  const ms = actionMs(assets, cls, FIRST_SKILL + skill.group, facing);
  return ms !== null && ms > CHARGE_CAST_MAX_MS ? CHARGE_CAST_MAX_MS : null;
}

/** 集气技一次施放：出手动作原长、实际播放长度、特效长度（4 个朝向里取最长） */
export function chargeTiming(assets: Pick<Assets, 'man' | 'pack' | 'effects'>, cls: number, skill: Pick<SkillDef, 'type' | 'group'>) {
  const fxRange = assets.effects.actions[FX_CHARGE];
  const fx = fxRange ? (fxRange.last - fxRange.first + 1) * EFFECT_FRAME_MS : 0;
  let natural = 0, played = 0;
  for (let f = 0; f < 4; f++) {
    const ms = actionMs(assets, cls, FIRST_SKILL + skill.group, f) ?? 0;
    natural = Math.max(natural, ms);
    played = Math.max(played, castPlayMs(assets, cls, skill, f) ?? ms);
  }
  return { natural, played, fx, before: natural + fx, after: played + fx };
}

/** 单招出手与命中时间轴共用的倍率，未配置或配置无效时保持原速。 */
export function castPlaybackRate(skill: Pick<SkillDef, 'castSpeed'>): number {
  const speed = skill.castSpeed ?? 1;
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/** HUM命中帧按原45ms换算后，与该招动作同步加速。 */
export function castSegmentMs(frame: number, skill: Pick<SkillDef, 'castSpeed'>): number {
  return (frame - 1) * ACTION_FRAME_MS / castPlaybackRate(skill);
}
