// 好汉聚义（吃鸡外传，docs/game-design.md §15.31）【新】：参赛名单和开局摆位。
// 名单 = 出场过的好汉：原版关卡和本包关卡里出现过（哪一方都算）、名字在一百单八将里的职业，另加武龙（主角）、王进、晁盖；
// 同名的几个职业（如原版宋江和包里的宋江）只留一个：在我方出场过的优先，其次招式多的，再其次编号小的。
import type { StageInput } from '../rules/battle.ts';
import type { FileSource } from '../rules/load.ts';
import { buildT2S, stageJson, stageNames } from '../rules/load.ts';
import { STARS_108 } from '../rules/nicknames.ts';
import { firstZone, mainArea, NPC_TEAM, openCells, spreadCells } from '../rules/royale.ts';
import { Rng } from '../rules/rng.ts';
import { facingTowards } from '../rules/unit.ts';
import { stageBoard, type PackRuntime } from './build.ts';
import type { PackStageJson, PackUnitJson } from './types.ts';

/** 一百单八将以外也算好汉的人 */
export const EXTRA_HEROES = ['武龙', '王进', '晁盖'];

export interface RoyaleHero {
  classId: number;
  name: string;
}

/** 出场过的好汉（按职业号排） */
export function royalePool(rt: PackRuntime, files: FileSource, text: (s: string) => string = buildT2S(files)): RoyaleHero[] {
  const seen = new Map<number, boolean>(); // 职业号 → 在我方出场过
  const note = (id: number | undefined, side: string) => {
    if (id === undefined) return;
    seen.set(id, (seen.get(id) ?? false) || side === 'player');
  };
  for (const name of stageNames(files)) for (const u of stageJson(files, name)?.units ?? []) if (u.side !== 'object' && u.side !== 'unknown') note(u.type, u.side);
  for (const s of rt.stages) {
    if (s.royale) continue;
    for (const u of s.units) note(typeof u.class === 'number' ? u.class : rt.classIds.get(u.class), u.side);
  }
  const byName = new Map<string, { classId: number; player: boolean; skills: number }>();
  for (const [id, player] of seen) {
    const cls = rt.data.classes[id];
    if (!cls?.skills.length) continue;
    const name = text(id === 0 ? rt.data.heroName : (rt.data.charNames[id] ?? cls.name));
    if (!STARS_108.has(name) && !EXTRA_HEROES.includes(name)) continue;
    const cur = byName.get(name);
    const me = { classId: id, player, skills: cls.skills.length };
    const better = !cur || Number(me.player) - Number(cur.player) || me.skills - cur.skills || cur.classId - me.classId;
    if (better === true || (typeof better === 'number' && better > 0)) byName.set(name, me);
  }
  return [...byName].map(([name, v]) => ({ classId: v.classId, name })).sort((a, b) => a.classId - b.classId);
}

/**
 * 摆好开局：玩家选的好汉（不填随机）+ 随机 opponents 个对手 + 小头目，在地图最大的一块可走区域里尽量分散地站开；
 * 离地图中心最近的几个位置给小头目（守着最后的圈附近），其余随机分给好汉。都朝地图中心站。
 */
export function royaleStage(rt: PackRuntime, stage: PackStageJson, files: FileSource, opts: { pick?: number; seed?: number; text?: (s: string) => string } = {}): PackStageJson {
  const r = stage.royale!;
  const rng = new Rng(opts.seed ?? Date.now() ^ Math.floor(Math.random() * 0x100000000));
  const pool = royalePool(rt, files, opts.text ?? buildT2S(files));
  if (!pool.length) throw new Error('好汉聚义：没有可选的好汉');
  const me = pool.find((h) => h.classId === opts.pick) ?? pool[rng.int(pool.length)];
  const rest = pool.filter((h) => h !== me);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const heroes = [me, ...rest.slice(0, r.opponents)];
  const board = stageBoard(files, stage);
  const area = mainArea(board);
  const centre = firstZone(area);
  // 只在开阔、离地图边远一点的格子出生（最远点采样会把人推到地图最外面一圈的角落里）
  const open = openCells(board, area);
  const cells = spreadCells(board, open.length >= heroes.length + r.npcs.count ? open : area, heroes.length + r.npcs.count, rng, stage.units.map((u) => ({ x: u.x, y: u.y })));
  const byCentre = [...cells].sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));
  const npcCells = byCentre.slice(0, Math.min(r.npcs.count, Math.max(0, cells.length - heroes.length)));
  const heroCells = cells.filter((c) => !npcCells.includes(c));
  const units: PackUnitJson[] = [...stage.units];
  const face = (c: { x: number; y: number }) => facingTowards(c, centre, 2);
  heroes.forEach((h, i) => {
    const c = heroCells[i];
    if (!c) return;
    units.push({ id: i ? `hero${i}` : 'me', class: h.classId, side: i ? 'enemy' : 'player', x: c.x, y: c.y, facing: face(c), level: r.level, team: units.length });
  });
  npcCells.forEach((c, i) => {
    units.push({ id: `npc${i + 1}`, class: r.npcs.classes[i % r.npcs.classes.length], side: 'enemy', x: c.x, y: c.y, facing: face(c), level: r.npcs.level, team: NPC_TEAM });
  });
  return { ...stage, units };
}

/** 关卡 JSON 的 royale → 战斗用的规则（道具、职业换成运行时编号）和各单位的阵营号 */
export function royaleInput(rt: PackRuntime, stage: PackStageJson): NonNullable<StageInput['royale']> {
  const r = stage.royale!;
  const item = (v: number | string) => (typeof v === 'number' ? v : (rt.itemIds.get(v) ?? fail(`没有道具 ${v}`)));
  const cls = (v: number | string) => (typeof v === 'number' ? v : (rt.classIds.get(v) ?? fail(`没有职业 ${v}`)));
  return {
    rules: { ...r, chestItems: r.chestItems.map(item), npcs: { ...r.npcs, classes: r.npcs.classes.map(cls), drops: r.npcs.drops.map(item) } },
    teams: Object.fromEntries(stage.units.flatMap((u, i) => (u.team === undefined ? [] : [[i, u.team]]))),
  };
}

function fail(msg: string): never {
  throw new Error(`好汉聚义：${msg}`);
}
