// 关卡天色滤镜（§15.15）：夜、雪、黄昏。只改画面（相机上加一个颜色矩阵），不改规则。
// 原版没有夜景、雪景图块，赤发鬼夜战、林冲雪夜这类关卡以前只能靠旁白交代。
import type Phaser from 'phaser';

export type StageTint = 'night' | 'snow' | 'dusk';

/** 颜色矩阵 4×5（行 = 输出 R、G、B、A；第 5 列是偏移，按 0–255 写：Phaser 的 ColorMatrix.getData 会除以 255） */
const MATRIX: Record<StageTint, { saturate: number; m: number[] }> = {
  // 微暗、偏蓝。负责人 2026-11-16 嫌太暗，从 0.5 / 0.58 / 0.82 提亮到 0.72 / 0.78 / 0.95；2026-11-24 仍嫌暗，再提亮到 0.85 / 0.88 / 1
  night: { saturate: -0.15, m: [0.85, 0, 0, 0, 6, 0, 0.88, 0, 0, 10, 0, 0, 1, 0, 20, 0, 0, 0, 1, 0] },
  // 褪色、整体提亮发白，像落了一层雪
  snow: { saturate: -0.6, m: [0.72, 0, 0, 0, 62, 0, 0.74, 0, 0, 64, 0, 0, 0.76, 0, 72, 0, 0, 0, 1, 0] },
  // 偏暖、略暗
  dusk: { saturate: -0.15, m: [0.95, 0, 0, 0, 10, 0, 0.75, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0] },
};

/** 加上天色滤镜；prev 是之前 applyTint 返回的滤镜，先摘掉（剧情里换天色，扩展包指令 tint）。返回新滤镜，没有天色返回 undefined */
export function applyTint(cam: Phaser.Cameras.Scene2D.Camera, tint: StageTint | undefined, prev?: Phaser.Filters.Controller): Phaser.Filters.Controller | undefined {
  if (prev) cam.filters.internal.remove(prev, true);
  if (!tint || !MATRIX[tint]) return undefined;
  const { saturate, m } = MATRIX[tint];
  const f = cam.filters.internal.addColorMatrix();
  f.colorMatrix.saturate(saturate);
  f.colorMatrix.multiply(m, true);
  return f;
}

export const isStageTint = (s: unknown): s is StageTint => typeof s === 'string' && s in MATRIX;
