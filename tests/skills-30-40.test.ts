// 30–40 级补技能（负责人 2026-11-25，第一优先 8 人）：原版关卡只到 30 级，现在主线练到 40–51 级，
// 给武龍、宋江、李逵、戴宗、花荣、武松、杨雄、石秀各补 2–4 档新技能（沿用原出手动作）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';
import { learnedSkills, skillsLearnedAt } from '../src/rules/skills.ts';
import { attackParts } from '../src/rules/combat.ts';
import { statAt } from '../src/rules/growth.ts';
import type { Unit } from '../src/rules/unit.ts';

const available = fs.existsSync(path.join(DATA, 'Data/Human.hum'));
describe.skipIf(!available)('30–40 级补技能', () => {
  const main = loadPackFromDisk('mainline');
  // 段数 0 = 周身四向技（类型 2、15）或回复 / 集气技，不按段数核对
  const NEW: Record<string, [name: string, level: number, power: number, cost: number, parts: number][]> = {
    wulong: [['千軍萬馬LV5', 32, 75, 190, 2], ['九死一生LV4', 36, 100, 60, 6], ['萬夫莫敵LV5', 40, 75, 250, 2], ['一夫當關LV2', 44, 120, 100, 4]],
    'sj-fugitive': [['四海归心LV2', 32, 25, 40, 0], ['及时雨LV2', 36, 2, 60, 0], ['血染浔阳LV2', 40, 40, 80, 1]],
    likui: [['裂石连斩LV2', 32, 40, 40, 3], ['旋风卷岳LV2', 36, 35, 55, 0], ['狂澜裂岳LV5', 40, 80, 140, 7]],
    daizong: [['旋风腿LV2', 32, 25, 40, 0], ['疾风踏阵LV4', 36, 70, 60, 0], ['神行渡气LV2', 40, 2, 30, 0]],
    huarong: [['雁落平沙LV2', 32, 25, 45, 1], ['连珠飞星LV2', 36, 45, 75, 4], ['穿云贯日LV4', 40, 80, 80, 5]],
    wusong: [['玉环鸳鸯脚LV2', 32, 55, 70, 4], ['擒虎镇岳LV4', 36, 80, 70, 6], ['横江断浪LV5', 40, 20, 110, 2]],
    yangxiong: [['斩首示众LV2', 38, 90, 85, 3], ['行刑刀LV4', 40, 80, 145, 3]],
    shixiu: [['舍命一击LV2', 38, 85, 60, 1], ['连环劈LV4', 40, 75, 165, 3]],
  };
  const cid = (k: string) => (k === 'wulong' ? 0 : main.classIds.get(k)!);
  const find = (k: string, name: string) => main.data.classes[cid(k)].skills.find((s) => s.name === name)!;

  it('每人在 30 级以后学到新档，数值、段数按方案，耗气不超过学会那一级的气上限', () => {
    for (const [k, list] of Object.entries(NEW)) {
      const cls = main.data.classes[cid(k)];
      for (const [name, level, power, cost, parts] of list) {
        const s = find(k, name);
        expect(s, `${k} ${name}`).toBeDefined();
        expect(s).toMatchObject({ learnLevel: level, power, mpCost: cost });
        expect(cost).toBeLessThanOrEqual(statAt(cls, 'mp', level));
        if (parts) {
          expect(attackParts(s)).toHaveLength(parts);
          expect(s.hits.reduce((n, h) => n + h.percent, 0)).toBe(100);
        }
        expect(skillsLearnedAt({ classId: cid(k), level } as Unit, main.data, level)).toContain(s);
      }
    }
  });

  it('新档替换同名旧档，菜单里每招只留最高一档', () => {
    for (const [k, list] of Object.entries(NEW)) {
      const top = learnedSkills({ classId: cid(k), level: 44 } as Unit, main.data).map((s) => s.name);
      for (const [name] of list) expect(top, k).toContain(name);
      expect(new Set(top.map((n) => n.replace(/LV\d+$/, ''))).size).toBe(top.length);
      const before = learnedSkills({ classId: cid(k), level: 30 } as Unit, main.data).map((s) => s.name);
      for (const [name] of list) expect(before).not.toContain(name);
    }
  });

  it('石秀三个形象（常服 / 头陀装 / 卖柴装）同时补新档', () => {
    for (const k of ['shixiu', 'shixiu-tuo', 'shixiu-chai']) {
      const sk = main.data.classes[cid(k)].skills;
      expect(sk.find((s) => s.name === '舍命一击LV2')?.learnLevel).toBe(38);
      expect(sk.find((s) => s.name === '连环劈LV4')).toMatchObject({ learnLevel: 40, area: 6, mpCost: 165 });
    }
  });

  it('武松六连拳、李逵七连斧：图条循环次数等于段数，每段落在一轮出手内，总长不到 2.5 秒', () => {
    for (const [k, name, n] of [['wusong', '擒虎镇岳LV4', 6], ['likui', '狂澜裂岳LV5', 7]] as const) {
      const s = find(k, name), look = main.looks.get(cid(k))!;
      const action = main.sheets[look.sheet].actions[look.actions[s.group + 3]];
      for (const strip of [action.front, action.back]) {
        expect(strip.cycles).toBe(n);
        const total = strip.frames * strip.ms * n, cycle = total / n;
        expect(total).toBeLessThan(2500);
        s.hits.forEach((h, i) => {
          expect((h.frame - 1) * 45).toBeGreaterThanOrEqual(i * cycle - 22.5);
          expect((h.frame - 1) * 45).toBeLessThan((i + 1) * cycle);
        });
      }
    }
  });
});
