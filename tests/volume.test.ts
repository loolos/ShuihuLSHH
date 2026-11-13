import { describe, expect, it } from 'vitest';
import { LEVELS, MUSIC_GAIN, SFX_GAIN, musicVolume, wrapLevel } from '../src/game/volume.ts';

describe('音量档位', () => {
  it('四档：关 / 小 / 中 / 大，音效和音乐各有一张表', () => {
    expect(LEVELS).toEqual(['关', '小', '中', '大']);
    expect(SFX_GAIN).toHaveLength(4);
    expect(MUSIC_GAIN).toHaveLength(4);
  });
  it('「关」档音效和音乐都是 0', () => {
    expect(SFX_GAIN[0]).toBe(0);
    expect(MUSIC_GAIN[0]).toBe(0);
    expect(musicVolume(0, 1, 1)).toBe(0);
  });
  it('音乐逐档变大，相邻两档至少差 1.5 倍（约 3.5 dB 以上，听得出来）', () => {
    for (let i = 2; i < 4; i++) expect(MUSIC_GAIN[i] / MUSIC_GAIN[i - 1]).toBeGreaterThanOrEqual(1.5);
    for (let i = 1; i < 4; i++) expect(MUSIC_GAIN[i]).toBeGreaterThan(MUSIC_GAIN[i - 1]);
  });
  it('同一档音乐比音效轻', () => {
    for (let i = 1; i < 4; i++) expect(MUSIC_GAIN[i]).toBeLessThan(SFX_GAIN[i]);
  });
  it('实际音量 = 档位 × 压低 × 淡入进度，夹在 0–1', () => {
    expect(musicVolume(3, 1, 1)).toBeCloseTo(MUSIC_GAIN[3]);
    expect(musicVolume(2, 0.2, 1)).toBeCloseTo(MUSIC_GAIN[2] * 0.2);
    expect(musicVolume(1, 1, 0.5)).toBeCloseTo(MUSIC_GAIN[1] * 0.5);
    expect(musicVolume(3, 1, 0)).toBe(0);
    expect(musicVolume(3, 5, 5)).toBe(1);
  });
  it('档位折回 0–3', () => {
    expect(wrapLevel(4)).toBe(0);
    expect(wrapLevel(-1)).toBe(3);
    expect(wrapLevel(2)).toBe(2);
  });
});
