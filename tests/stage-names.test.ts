// 关卡选择器的章名、关名、城镇名（src/game/stage-names.ts）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readExeTables } from '../src/formats/exe.ts';
import { CHAPTER_NAMES, STAGE_NAMES, TOWN_NAMES, cnNumber, stageLabel } from '../src/game/stage-names.ts';

const len = (s: string) => [...s].length;

describe('关卡名字', () => {
  it('中文数字', () => {
    expect([1, 9, 10, 11, 15, 20, 23].map(cnNumber)).toEqual(['一', '九', '十', '十一', '十五', '二十', '二十三']);
  });
  it('名字都是 3–6 个字', () => {
    for (const n of [...CHAPTER_NAMES.slice(1), ...Object.values(STAGE_NAMES), ...Object.values(TOWN_NAMES)]) {
      expect(len(n), n).toBeGreaterThanOrEqual(3);
      expect(len(n), n).toBeLessThanOrEqual(6);
    }
  });
  it('按原版标题拼出章节和类别', () => {
    expect(stageLabel('第3章 戰役2', 'N-add04b')).toMatchObject({ chapter: 3, chapterLabel: '第三章 夜走华阴县', short: '战役二 山径斗毛贼', full: '第三章 战役二 · 山径斗毛贼' });
    expect(stageLabel('第5章 訓練', 'Train1').short).toBe('训练 延安府练武');
    expect(stageLabel('第2章3-3', 'Act3-3').short).toBe('剧情 李吉告密');
  });
});

const EXE = path.resolve(import.meta.dirname, '../gamedata/shuihu/ShuiHu.exe');
const MAP = path.resolve(import.meta.dirname, '../gamedata/shuihu/Map');
describe.skipIf(!fs.existsSync(EXE))('原版关卡表', () => {
  it('每一关、每一章都有名字', () => {
    const maps = new Set(fs.readdirSync(MAP).map((f) => f.toLowerCase()));
    const stages = readExeTables(fs.readFileSync(EXE)).stages.filter((s) => s.mapName && maps.has(`${s.mapName.toLowerCase()}.act`));
    expect(stages.length).toBeGreaterThan(60);
    for (const s of stages) {
      expect(STAGE_NAMES[s.mapName.toLowerCase()], s.mapName).toBeTruthy();
      const l = stageLabel(s.title, s.mapName);
      expect(CHAPTER_NAMES[l.chapter], s.title).toBeTruthy();
    }
  });
});
