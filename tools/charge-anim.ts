// 集气技（类型 8）施放时长：所有职业（原版 + 每个扩展包）出手动作 + 第 7 组特效各要多久。
// 用法：node --experimental-transform-types tools/charge-anim.ts [--all]
// 默认只列出手动作被加快的；--all 列全部。上限见 src/game/cast-timing.ts。
import fs from 'node:fs';
import path from 'node:path';
import { loadAssets } from '../src/game/assets.ts';
import { chargeTiming, CHARGE_TOTAL_MAX_MS } from '../src/game/cast-timing.ts';
import type { GameFiles } from '../src/platform/gamefiles.ts';
import { loadPackFromDisk } from './sim-pack.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

const disk = new NodeFiles(DATA);
const files = Object.assign(disk, { copy() {}, async ensure() { return 0; } }) as unknown as GameFiles;

/** 旧做法：出手动作按原速播，只有 2500 ms 的保险上限 */
const OLD_CAP = 2500;

export interface ChargeRow { pack: string; cls: number; name: string; skill: string; before: number; after: number }

/** 原版和每个扩展包新增职业的全部集气技（同名同时长的只留一个） */
export function chargeRows(): ChargeRow[] {
  const base = loadAssets(files);
  const packIds = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../packs/index.json'), 'utf8')) as string[];
  const seen = new Set<string>();
  const rows: ChargeRow[] = [];
  for (const pid of ['', ...packIds]) {
    const rt = pid ? loadPackFromDisk(pid, base.data) : null;
    const A = { ...base, data: rt?.data ?? base.data, pack: rt ? { rt, images: new Map() } : undefined };
    A.data.classes.forEach((c, cls) => {
      if (rt && !rt.looks.has(cls)) return; // 包里只看包新增的职业
      for (const s of c.skills.filter((s) => s.type === 8)) {
        const t = chargeTiming(A, cls, s);
        const before = Math.min(t.natural, OLD_CAP) + t.fx;
        const k = `${c.name}/${s.name}/${before}/${t.after}`;
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push({ pack: pid || '原版', cls, name: c.name, skill: s.name, before, after: t.after });
      }
    });
  }
  return rows;
}

if (import.meta.main ?? process.argv[1]?.endsWith('charge-anim.ts')) {
  const all = process.argv.includes('--all');
  const rows = chargeRows();
  console.log('来源       职业号  人物        技能          原时长ms  现时长ms');
  for (const r of rows.filter((r) => all || r.before !== r.after))
    console.log(`${r.pack.padEnd(10)} ${String(r.cls).padStart(5)}  ${r.name.padEnd(5, '　')}  ${r.skill.padEnd(6, '　')}  ${String(r.before).padStart(8)}  ${String(r.after).padStart(8)}`);
  const worst = Math.max(...rows.map((r) => r.after));
  console.log(`共 ${rows.length} 个集气技，最长 ${worst} ms（上限 ${CHARGE_TOTAL_MAX_MS} ms）${worst <= CHARGE_TOTAL_MAX_MS ? '' : '　超出！'}`);
}
