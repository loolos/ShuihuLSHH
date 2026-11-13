// 酒店说书（docs/game-design.md §7.5「说书」）：好汉在不在队里、选项、礼物只送一次。
import { describe, expect, it } from 'vitest';
import { newCampaign, type CampaignState } from '../src/rules/campaign.ts';
import type { GameData } from '../src/rules/data.ts';
import type { Item } from '../src/formats/goo.ts';
import { afterTale, chooseTale, NVERHONG, TALES, taleOf } from '../src/rules/storyteller.ts';

const items = Array.from({ length: NVERHONG }, (_, i) => ({ name: i === NVERHONG - 1 ? '女兒紅' : `i${i}`, type: 22, category: 1 }) as Item);
const charNames = Array.from({ length: 30 }, (_, i) => `c${i}`);
charNames[16] = '魯智深';
const data = { classes: [], items, charNames, heroName: '武龍' } as unknown as GameData;
const member = (classId: number, slots = Array(13).fill(0)) => ({ classId, level: 10, exp: 0, slots });
const camp = (ids: number[], active?: number[]): CampaignState => ({ ...newCampaign(22), gold: 100, members: ids.map((id) => member(id)), active });
const tale = taleOf(3)!;

describe('说书', () => {
  it('只有城镇 3 的酒店有说书，说的是鲁智深', () => {
    expect(TALES).toHaveLength(1);
    expect(tale.hero).toBe(16);
    expect(taleOf(1)).toBeUndefined();
    // 每页不宜太长，手机上对白框放得下
    for (const p of tale.pages) expect([...p].length).toBeLessThanOrEqual(110);
  });

  it('鲁智深不在队里：只有收尾，没有选项', () => {
    const r = afterTale(camp([0, 3]), tale);
    expect(r.present).toBe(false);
    expect(r.lines).toEqual(tale.absent);
  });

  it('鲁智深在队里：认账；史進不在时略去他那句', () => {
    const a = afterTale(camp([0, 3, 16]), tale);
    expect(a.present).toBe(true);
    expect(a.lines.some((l) => l.who === 3)).toBe(true);
    const b = afterTale(camp([0, 16]), tale);
    expect(b.lines.some((l) => l.who === 3)).toBe(false);
    expect(b.lines.length).toBe(a.lines.length - 1);
  });

  it('只看上一关出场的人', () => {
    expect(afterTale(camp([0, 16], [0]), tale).present).toBe(false);
  });

  it('亲口说：第一次送女儿红给鲁智深，第二次不送', () => {
    const c = camp([0, 16]);
    const r = chooseTale(c, data, tale, 0);
    expect(r.got).toBe(NVERHONG);
    expect(r.c.members.find((m) => m.classId === 16)!.slots[3]).toBe(NVERHONG);
    expect(r.c.tales).toEqual([tale.id]);
    expect(r.c.gold).toBe(100);
    const again = chooseTale(r.c, data, tale, 0);
    expect(again.got).toBe(0);
    expect(again.c).toBe(r.c);
  });

  it('按住不声张：没有礼物', () => {
    const c = camp([0, 16]);
    const r = chooseTale(c, data, tale, 1);
    expect(r.got).toBe(0);
    expect(r.c).toBe(c);
  });

  it('物品栏满了：当场喝掉，也算领过', () => {
    const c: CampaignState = { ...camp([0]), members: [member(0), member(16, Array(13).fill(1))] };
    const r = chooseTale(c, data, tale, 0);
    expect(r.got).toBe(0);
    expect(r.c.tales).toEqual([tale.id]);
    expect(r.c.members[1].slots.every((x) => x === 1)).toBe(true);
  });
});
