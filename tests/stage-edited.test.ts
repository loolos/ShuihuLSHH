// 关卡 JSON 的 edited（选关页改动星标，docs/game-design.md §1.3「改动标记」）只能是 1 或 2
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../gamedata/stages');

describe('关卡改动标记', () => {
  it('edited 只能不写、1 或 2', () => {
    const bad: string[] = [];
    let marked = 0;
    for (const f of fs.readdirSync(DIR)) {
      const e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).edited;
      if (e === undefined) continue;
      marked++;
      if (e !== 1 && e !== 2) bad.push(`${f}: ${e}`);
    }
    expect(bad).toEqual([]);
    expect(marked).toBeGreaterThan(0);
  });
});
