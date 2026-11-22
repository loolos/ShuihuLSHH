import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../src/rules/data.ts';
import { skillTags } from '../src/rules/skills.ts';

const sk = (p: Partial<SkillDef>): SkillDef => ({ name: 't', skillId: 1, type: 7, group: 0, hidden: false, learnLevel: 1, mpCost: 10, power: 10, rangeMin: 1, rangeMax: 1, area: 1, hitMod: 0, critMod: 0, poison: 0, stun: 0, effect: 0, hits: [], ...p }) as SkillDef;

describe('skillTags', () => {
  it('derives tags from skill data', () => {
    expect(skillTags(sk({ type: 7 }))).toEqual(['单体']);
    expect(skillTags(sk({ type: 0, area: 3 }))).toEqual(['范围']);
    expect(skillTags(sk({ type: 2 }))).toEqual(['回旋']);
    expect(skillTags(sk({ type: 12, rangeMin: 0, rangeMax: 0, area: 2 }))).toEqual(['回旋']);
    expect(skillTags(sk({ type: 10, rangeMax: 8 }))).toEqual(['远程', '单体']);
    expect(skillTags(sk({ type: 4, rangeMax: 5, area: 3 }))).toEqual(['远程', '范围']);
    expect(skillTags(sk({ type: 8, rangeMin: 0, rangeMax: 0, area: 0 }))).toEqual(['回气']);
    expect(skillTags(sk({ type: 9, rangeMin: 0, rangeMax: 0, area: 3 }))).toEqual(['回复', '范围']);
  });
});
