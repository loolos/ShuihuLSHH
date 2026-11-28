// 扩展包里上过我方阵营的人物都要标 hero，好汉技能不扣命中的规则才生效（heroSkillNoHitMod，负责人 2026-11-22）
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../packs/mainline');
const pack = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));

/** 关卡里所有带 class 和 side 的对象（开场单位和剧本里增援、入队的） */
function sides(node: unknown, out: Map<string, Set<string>>) {
  if (Array.isArray(node)) for (const x of node) sides(x, out);
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.class === 'string' && typeof o.side === 'string') {
      if (!out.has(o.class)) out.set(o.class, new Set());
      out.get(o.class)!.add(o.side);
    }
    for (const v of Object.values(o)) sides(v, out);
  }
}

describe('扩展包好汉标记', () => {
  it('上过我方的扩展包人物都标了 hero', () => {
    const seen = new Map<string, Set<string>>();
    for (const s of pack.stages) sides(JSON.parse(fs.readFileSync(path.join(dir, s), 'utf8')), seen);
    const missing = pack.classes.filter((c: { id: string; hero?: boolean }) => !c.hero && seen.get(c.id)?.has('player')).map((c: { id: string }) => c.id);
    expect(missing).toEqual([]);
  });
});
