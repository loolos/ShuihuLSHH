import { describe, expect, it } from 'vitest';
import { NICKNAMES, splitNickname } from '../src/rules/nicknames.ts';

describe('人物绰号', () => {
  it('名字前加原著绰号', () => {
    expect(splitNickname('武松')).toEqual(['行者', '武松']);
    expect(splitNickname('杨春')).toEqual(['白花蛇', '杨春']);
    expect(splitNickname('王道人')).toEqual(['飞天蜈蚣', '王道人']);
  });
  it('已带绰号的名字拆开，不重复', () => {
    expect(splitNickname('小李广花荣')).toEqual(['小李广', '花荣']);
    expect(splitNickname('飞天蜈蚣王道人')).toEqual(['飞天蜈蚣', '王道人']);
  });
  it('没有绰号的照原样', () => {
    expect(splitNickname('庄客')).toEqual(['', '庄客']);
    expect(splitNickname('花荣之妹')).toEqual(['', '花荣之妹']);
    expect(splitNickname('蒋门神')).toEqual(['', '蒋门神']);
  });
  it('主角用运行时补充的绰号', () => {
    expect(splitNickname('武龙', { 武龙: '关西之虎' })).toEqual(['关西之虎', '武龙']);
  });
  it('一百单八将以外另有十人，表里没有空项', () => {
    expect(Object.keys(NICKNAMES).length).toBe(108 + 10);
    expect(Object.values(NICKNAMES).every(Boolean)).toBe(true);
  });
});
