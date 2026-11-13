// 音量档位【新】：顶栏「♪」按钮在 关 / 小 / 中 / 大 之间切换，音效和背景音乐一起跟着变（负责人 2026-11-13 要求）。
// 纯数据和计算，不依赖浏览器音频，方便单元测试。

/** 音量档位：关 / 小 / 中 / 大 */
export const LEVELS = ['关', '小', '中', '大'] as const;
/** 各档音效的总增益（Web Audio 主音量） */
export const SFX_GAIN = [0, 0.25, 0.5, 0.9] as const;
/** 各档背景音乐的音量（HTMLAudio volume）：整体比音效轻，相邻两档约差 6–7 dB */
export const MUSIC_GAIN = [0, 0.15, 0.32, 0.6] as const;

/** 把任意整数折回 0–3 档 */
export function wrapLevel(level: number): number {
  const n = LEVELS.length;
  return ((Math.trunc(level) % n) + n) % n;
}

/** 某一刻背景音乐的实际音量：档位 × 压低比例 × 播放器的淡入淡出进度，夹在 0–1 */
export function musicVolume(level: number, duck: number, fade: number): number {
  const v = (MUSIC_GAIN[wrapLevel(level)] ?? 0) * duck * fade;
  return Math.max(0, Math.min(1, v));
}
