// 酒店请客（docs/game-design.md §7.5「请客」，src/rules/feast.ts）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/rules/battle.ts';
import { newCampaign, type CampaignState } from '../src/rules/campaign.ts';
import { FEAST_DRINKS, FEAST_PLACES, FEAST_PRICE, FEAST_TURNS, feasted, feastFor, feastLevel, feastLines, orderFeast } from '../src/rules/feast.ts';
import { buildT2S, loadGameData, loadStage } from '../src/rules/load.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const party = (levels: number[], gold = 1000): CampaignState => ({
  ...newCampaign(),
  gold,
  members: levels.map((level, i) => ({ classId: [0, 3, 13, 5, 15][i], level, exp: 0, slots: [], forge: [] })),
  active: [0, 3, 13, 5, 15].slice(0, levels.length),
});

describe('请客', () => {
  it('固定价格，增益按名单平均等级', () => {
    const c = party([10, 12, 14]);
    expect(feastLevel(c)).toBe(12);
    const r = orderFeast(c, 0, ['N-add04a', 'N-add04b']);
    expect(r.ok).toBe(true);
    expect(r.c.gold).toBe(1000 - FEAST_PRICE);
    expect(r.c.feast!.buffs).toEqual([{ stat: 'attack', value: 17, turns: FEAST_TURNS }, { stat: 'crit', value: 5, turns: FEAST_TURNS }]);
    expect(feasted(r.c, ['N-add04a', 'N-add04b'])).toBe(true);
    expect(orderFeast(r.c, 1, ['N-add04a']).ok).toBe(false); // 一城只请一次
    expect(feastFor(r.c, 'n-add04b')).toEqual(r.c.feast!.buffs);
    expect(feastFor(r.c, 'N-add05')).toBeUndefined(); // 别的关不算
  });

  it('三种酒菜：攻击必杀 / 回体回气 / 防御敏捷', () => {
    expect(FEAST_DRINKS.map((d) => d.buffs(40).map((b) => b.stat))).toEqual([['attack', 'crit'], ['regenHp', 'regenMp'], ['defense', 'agility']]);
  });

  it('银子不够不能请', () => {
    expect(orderFeast(party([5], FEAST_PRICE - 1), 0, ['N-add02']).ok).toBe(false);
  });

  it('对白只给名单里的人', () => {
    const c = party([10, 10]); // 武龍、史進
    const lines = feastLines(FEAST_PLACES['2'], c, () => undefined);
    expect(lines.map((l) => l.who)).toEqual([3]);
  });
});

const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe')) || fs.existsSync(path.join(DATA, '..', 'stages', 'N-add16.json'));
describe.skipIf(!has)('请客：开场增益', () => {
  it('开场在场的我方全员都有，管满 5 个我方回合', () => {
    const files = new NodeFiles(DATA);
    const tr = buildT2S(files);
    const data = loadGameData(files, tr);
    const buffs = FEAST_DRINKS[2].buffs(30);
    const b = new Battle({ ...loadStage(files, data, 'N-add16', { seed: 1, text: tr }), feast: buffs });
    const plain = new Battle(loadStage(files, data, 'N-add16', { seed: 1, text: tr }));
    b.begin();
    plain.begin();
    const heroes = b.units.filter((u) => u.side === 'player' && u.present);
    expect(heroes.length).toBeGreaterThan(10);
    for (const u of heroes) {
      expect(u.buffs.find((x) => x.stat === 'defense')).toMatchObject({ value: 35, turns: FEAST_TURNS });
      const p = plain.units.find((x) => x.uid === u.uid)!;
      expect(u.stats.defense - p.stats.defense).toBe(35);
    }
    expect(b.units.filter((u) => u.side === 'enemy').every((u) => !u.buffs.length)).toBe(true);
  });
});
