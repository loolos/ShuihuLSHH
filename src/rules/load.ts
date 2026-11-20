// 从 gamedata/ 的 JSON 组装 GameData 与 StageInput（浏览器与 Node 共用）。
// 原版关卡（gamedata/stages）、地图（gamedata/maps）和数据表（gamedata/tables）都是 2026-11-19 从原版文件导出的 JSON，可直接编辑；
// 原版原件在 gamedata/original，运行时只用到其中的图像。
import { mapFromJson, cropMap, type MapData, type MapJson } from '../formats/map.ts';
import { stageBlocks, stageUnits, type StageJson } from '../formats/stage-json.ts';
import type { ExeTables } from '../formats/exe.ts';
import type { ClassRecord } from '../formats/hum.ts';
import type { Item } from '../formats/goo.ts';
import { Board } from './board.ts';
import { fireInput } from './fire.ts';
import { enemyRank } from './enemy-level.ts';
import type { StageInput } from './battle.ts';
import { buildClasses, withItemOverrides, type ClassDef, type GameData } from './data.ts';
import { statAt, tierGear } from './growth.ts';

export interface FileSource {
  get(path: string): Buffer;
  has(path: string): boolean;
  list(dir: string, ext: string): string[];
  /** 已解析好的 JSON（浏览器里随代码打包）；没有时由 get 读出再解析 */
  json?(path: string): unknown;
}

const parsed = new WeakMap<FileSource, Map<string, unknown>>();
/** 读 gamedata/ 下的 JSON（路径不区分大小写，如 stages/N05.json） */
export function readJson<T>(files: FileSource, path: string): T {
  if (files.json) return files.json(path) as T;
  const cache = parsed.get(files) ?? parsed.set(files, new Map()).get(files)!;
  const k = path.toLowerCase();
  if (!cache.has(k)) cache.set(k, JSON.parse(files.get(path).toString('utf8')));
  return cache.get(k) as T;
}

/** EXE 里的静态表（角色名、绰号、技能名、关卡表、二选一对话、城镇文字、特效触发帧），见 docs/binary-formats.md §4 */
export const exeTables = (files: FileSource) => readJson<ExeTables>(files, 'tables/exe.json');

/** 地形通行表（原版 Ground.att / Upper.att 去掉 8 字节头） */
export function terrain(files: FileSource): { ground: Uint8Array; upper: Uint8Array } {
  const t = readJson<{ ground: number[]; upper: number[] }>(files, 'tables/terrain.json');
  return { ground: Uint8Array.from(t.ground), upper: Uint8Array.from(t.upper) };
}

/** 原版关卡（gamedata/stages/<名字>.json），没有这一关时为 undefined */
export function stageJson(files: FileSource, stage: string): StageJson | undefined {
  const p = `stages/${stage}.json`;
  return files.has(p) ? readJson<StageJson>(files, p) : undefined;
}

/** 全部原版关卡名（文件名，保留大小写） */
export const stageNames = (files: FileSource): string[] =>
  files.list('stages', '.json').map((p) => p.slice(p.lastIndexOf('/') + 1, -5));

/** 繁→简对照（tables/t2s.json：原版每个 .pab 与同结构的 .pas 逐字对齐、按出现次数投票得到）。没出现过的字保持原样。 */
export function buildT2S(files: FileSource): (s: string) => string {
  const map = new Map(Object.entries(readJson<Record<string, string>>(files, 'tables/t2s.json')));
  return (s) => [...s].map((c) => map.get(c) ?? c).join('');
}

export function loadGameData(files: FileSource, tr: (s: string) => string = (s) => s): GameData {
  const exe = exeTables(files);
  const classes = capSkillCosts(buildClasses(structuredClone(readJson<ClassRecord[]>(files, 'tables/human.json')), exe.characterNames, exe.skillNames));
  return { classes, items: loadItems(files), charNames: exe.characterNames, effectTriggers: exe.effectTriggers, heroName: tr(exe.characterNames[0]), heroNickname: tr(exe.nicknames[0] ?? ''), prompts: exe.prompts.map((q) => ({ ...q, question: tr(q.question), options: [tr(q.options[0]), tr(q.options[1])], replies: [{ ...q.replies[0], text: tr(q.replies[0].text) }, { ...q.replies[1], text: tr(q.replies[1].text) }] })) };
}

/** 原版道具表（tables/goods.json）加上重制版的道具改动 */
export const loadItems = (files: FileSource): Item[] => withItemOverrides(structuredClone(readJson<Item[]>(files, 'tables/goods.json')));

/**
 * 技能耗气不超过习得那一级的最大气（不算装备）【新】（负责人 2026-11-13）。
 * 气力改成线性成长（growth.ts）后，有几招刚学会时气力上限不够放：武龍 千軍萬馬LV3 200（15 级气 160）、
 * 史進 天龍出雲LV3 160（18 级 144）、龍騰九天 210（22 级 159），敌方版白勝、吳用的几招也是。只压这几招，别的不动。
 */
export function capSkillCosts(classes: ClassDef[]): ClassDef[] {
  for (const cls of classes) {
    if (!cls) continue;
    for (const s of cls.skills.slice(1)) {
      const mp = statAt(cls, 'mp', s.learnLevel) + (tierGear(cls)?.mp ?? 0);
      if (s.mpCost > mp) s.mpCost = mp;
    }
  }
  return classes;
}

/** 自拼地图（packs/maps/<名字>.json）在地图名里的前缀：custom:<名字> */
export const CUSTOM_MAP_PREFIX = 'custom:';
let customMapLoader: (name: string) => MapJson | undefined = () => undefined;
const customMapCache = new Map<string, MapData>();
/** 设置自拼地图的来源：浏览器里是随代码打包的 JSON（src/game/packs.ts），Node 里读磁盘（src/packs/custom-maps-node.ts） */
export function setCustomMapLoader(fn: (name: string) => MapJson | undefined): void {
  customMapLoader = fn;
  customMapCache.clear();
}

/** 关卡地图名，可带截取范围「名字@x,y,宽,高」（扩展包借原版大地图的一角，见 PackStageJson.map.crop）；自拼地图是「custom:名字」 */
export function stageMapName(map: { base?: string; custom?: string; crop?: readonly number[] }): string {
  const name = map.custom ? CUSTOM_MAP_PREFIX + map.custom : map.base ?? '';
  return map.crop ? `${name}@${map.crop.join(',')}` : name;
}

/** 按地图名（可带 @截取范围）读地图：原版地图在 gamedata/maps，自拼地图在 packs/maps */
export function loadStageMap(files: FileSource, name: string): { map: MapData } | undefined {
  const [base, crop] = name.split('@');
  let map: MapData | undefined;
  if (base.startsWith(CUSTOM_MAP_PREFIX)) {
    const id = base.slice(CUSTOM_MAP_PREFIX.length);
    map = customMapCache.get(id);
    if (!map) {
      const j = customMapLoader(id);
      if (!j) return undefined;
      customMapCache.set(id, (map = mapFromJson(j, `packs/maps/${id}.json`)));
    }
  } else {
    const p = `maps/${base}.json`;
    if (!files.has(p)) return undefined;
    map = mapFromJson(readJson<MapJson>(files, p), p);
  }
  if (!crop) return { map };
  const [x, y, w, h] = crop.split(',').map(Number);
  return { map: cropMap(map, x, y, w, h) };
}

/** 原版关卡用哪张地图（可带截取范围）；不是原版关卡时就是 stage 本身 */
export const stageMap = (files: FileSource, stage: string): string => stageJson(files, stage)?.map ?? stage;

export function loadStage(files: FileSource, data: GameData, stage: string, opts: { seed?: number; text?: (s: string) => string; party?: StageInput['party']; joinLevel?: number } = {}): StageInput {
  const j = stageJson(files, stage);
  if (!j) throw new Error(`找不到关卡 ${stage}`);
  const loaded = loadStageMap(files, j.map);
  if (!loaded) throw new Error(`找不到地图 ${j.map}`);
  const t = terrain(files);
  const board = Board.fromMap(loaded.map, t.ground, t.upper);
  const units = stageUnits(j);
  const battle = !/^(act|train)/i.test(stage);
  return {
    name: stage,
    enemyRanks: j.enemyRanks ?? (battle ? Object.fromEntries(units.filter((u) => u.side === 'enemy').map((u) => [u.index, enemyRank(u.type)])) : undefined),
    names: j.names,
    spectators: j.spectators,
    clearGold: j.clearGold,
    rules: j.rules,
    board,
    fire: j.rules?.fire ? fireInput(j.rules.fire, loaded.map) : undefined,
    units,
    blocks: stageBlocks(j, stage),
    header: { ...j.header },
    data,
    seed: opts.seed,
    text: opts.text,
    party: opts.party,
    joinLevel: opts.joinLevel,
  };
}
