// 关卡天色滤镜（§15.15）：夜、雪、黄昏。只改画面（相机上加一个颜色矩阵），不改规则。
// 原版没有夜景、雪景图块，赤发鬼夜战、林冲雪夜这类关卡以前只能靠旁白交代。
import type Phaser from 'phaser';

export type StageTint = 'night' | 'snow' | 'dusk';

/** 颜色矩阵 4×5（行 = 输出 R、G、B、A；第 5 列是偏移，按 0–255 写：Phaser 的 ColorMatrix.getData 会除以 255） */
const MATRIX: Record<StageTint, { saturate: number; m: number[] }> = {
  // 压暗、偏蓝：红绿压得多，蓝留得多
  night: { saturate: -0.45, m: [0.5, 0, 0, 0, 0, 0, 0.58, 0, 0, 3, 0, 0, 0.82, 0, 10, 0, 0, 0, 1, 0] },
  // 褪色、整体提亮发白，像落了一层雪
  snow: { saturate: -0.6, m: [0.72, 0, 0, 0, 62, 0, 0.74, 0, 0, 64, 0, 0, 0.76, 0, 72, 0, 0, 0, 1, 0] },
  // 偏暖、略暗
  dusk: { saturate: -0.15, m: [0.95, 0, 0, 0, 10, 0, 0.75, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0] },
};

export function applyTint(cam: Phaser.Cameras.Scene2D.Camera, tint: StageTint | undefined): void {
  if (!tint || !MATRIX[tint]) return;
  const { saturate, m } = MATRIX[tint];
  const cm = cam.filters.internal.addColorMatrix().colorMatrix;
  cm.saturate(saturate);
  cm.multiply(m, true);
}
