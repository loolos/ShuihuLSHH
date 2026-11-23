// 每处循环的背景音乐至少两首轮放（负责人 2026-11-14 / 2026-11-23 复查），曲名都要在 gamedata/bgm/index.json 里
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const idx = JSON.parse(readFileSync('gamedata/bgm/index.json', 'utf8')) as { tracks: Record<string, string>; stages: Record<string, string[]> };
const known = (list: unknown) => (Array.isArray(list) ? new Set(list.filter((t) => typeof t === 'string' && t in idx.tracks)).size : 0);

describe('背景音乐歌单', () => {
  it('原版关卡的歌单至少两首', () => {
    for (const [stage, list] of Object.entries(idx.stages)) expect(known(list), stage).toBeGreaterThanOrEqual(2);
  });
  it('主线插关和外传的 bgm 是至少两首的歌单', () => {
    const dir = 'packs/mainline/stages/';
    for (const f of readdirSync(dir)) {
      const stage = JSON.parse(readFileSync(dir + f, 'utf8'));
      expect(known(stage.bgm), f).toBeGreaterThanOrEqual(2);
      expect(stage.map?.bgm, f).toBeUndefined();
    }
  });
});
