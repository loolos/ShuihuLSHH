// 共享资源：调色板、图块、人物动画、特效、头像、图标（gamedata/ 下拆出来的原版图像），EXE 表、道具表。
import type { ExeTables } from '../formats/exe.ts';
import type { Frame } from '../formats/image.ts';
import type { Item } from '../formats/goo.ts';
import { effectLib, manLib, picLib, tileLib, type SpriteLib, type TileLib } from '../formats/sheets.ts';
import { stageUnits } from '../formats/stage-json.ts';
import type { GameFiles, Progress } from '../platform/gamefiles.ts';
import { buildT2S, exeTables, loadGameData, loadItems, loadStageMap, readJson, stageJson, stageMap } from '../rules/load.ts';
import type { GameData, SkillDef } from '../rules/data.ts';
import { FIXED_FX, FX_BLAZE, fxGroups } from './effects.ts';
import type { PackAssets } from './packs.ts';

export interface Assets {
  files: GameFiles;
  palette: Uint8Array;
  ground: TileLib;
  upper: TileLib;
  /** 格子光标（原版 Grid.grp）：0–3 格子光标，4 = 宝箱（地图上的宝物都画这张，EXE 0x4010d0 / 0x40c24f） */
  grid: TileLib;
  /** 人物动画（原版 Man.lib） */
  man: SpriteLib;
  /** 技能特效（原版 Effect.lib）：60 组，技能子项 +6 = 组号 + 1（0 = 无特效） */
  effects: SpriteLib;
  /** 道具图标（原版 Object.lib） */
  objects: TileLib;
  /** 半身头像（原版 Head.lib），第 i 张对应 HUM 第 i 个职业（按图比对，见 binary-formats §3） */
  heads: TileLib;
  exe: ExeTables;
  items: Item[];
  /** 规则引擎用的数据 */
  data: GameData;
  /** 繁→简（由 .pab/.pas 对齐得到） */
  tr: (s: string) => string;
  /** 正在玩的扩展包（src/game/packs.ts）：职业画面、头像从这里取；data 已并入包的内容 */
  pack?: PackAssets;
}

export function loadAssets(files: GameFiles): Assets {
  const tr = buildT2S(files);
  const image = (p: string) => files.image(p);
  const tiles = readJson<Record<string, number[][]>>(files, 'tiles/tiles.json');
  return {
    tr,
    data: loadGameData(files, tr),
    files,
    palette: Uint8Array.from(readJson<number[][]>(files, 'tables/palette.json').flat()),
    ground: tileLib('ground', tiles.ground, image),
    upper: tileLib('upper', tiles.upper, image),
    grid: tileLib('grid', tiles.grid, image),
    man: manLib(readJson(files, 'sprites/man.json'), image),
    effects: effectLib(readJson(files, 'sprites/effects.json'), image),
    objects: picLib('icons', readJson(files, 'icons/icons.json'), image),
    heads: picLib('portraits', readJson(files, 'portraits/portraits.json'), image),
    exe: exeTables(files),
    items: loadItems(files),
  };
}

/** 开始游戏前要先载入的图：全部头像、道具图标（对白、整备随时会用）和格子光标 */
export function startupImages(a: Assets): string[] {
  return [
    ...Array.from({ length: a.heads.count }, (_, i) => a.heads.sheetOf(i)),
    ...Array.from({ length: a.objects.count }, (_, i) => a.objects.sheetOf(i)),
    ...new Set(Array.from({ length: a.grid.count }, (_, i) => a.grid.sheetOf(i))),
  ];
}

/** 一批要载入的图 */
class Fetch {
  readonly want = new Set<string>();
  add(path: string) {
    this.want.add(path);
  }
  /** 职业 cls 第 action 个动作的 4 个朝向（同一张图；混搭的职业按 manSource 找出处） */
  manAction(assets: Assets, cls: number, action: number) {
    const src = manSource(assets, cls, action);
    const c = assets.man.classes[src.cls];
    if (c) {
      const g = c.first + src.action * 4;
      if (g <= c.last) this.add(assets.man.sheetOf(g));
    }
  }
  /** 一个技能：职业的出手动作（4 个朝向）和它的特效 */
  skill(assets: Assets, cls: number, sk: SkillDef) {
    this.manAction(assets, cls, ACTION_FIRST_SKILL + sk.group);
    for (const g of fxGroups(sk)) this.effectGroup(assets, g);
  }
  /** 特效第 group 组 */
  effectGroup(assets: Assets, group: number) {
    if (assets.effects.actions[group]) this.add(assets.effects.sheetOf(group));
  }
  run(files: GameFiles, progress?: Progress): Promise<number> {
    return files.ensure(this.want, progress);
  }
}

/** 职业 cls 用 Man.lib 里哪个职业的动画：扩展包借原版动画的职业（sprite.fromClass）换成被借的职业 */
export function manClassOf(assets: Assets, cls: number): number {
  return assets.pack?.rt.looks.get(cls)?.from ?? cls;
}

/**
 * 职业 cls 的第 action 个动作实际用 Man.lib 哪个职业的哪个动作：一般是 manClassOf 的同一个动作；
 * 扩展包混搭的职业（sprite.parts，如宋江借王伦的出手）换成那个职业的那个动作。
 */
export function manSource(assets: Assets, cls: number, action: number): { cls: number; action: number } {
  const p = assets.pack?.rt.looks.get(cls)?.parts?.get(action);
  return p ? { cls: p.from, action: p.action } : { cls: manClassOf(assets, cls), action };
}

/** Man.lib 每个职业的动作：0 走路、1 受击、2 防御，3 起每个技能一组（同 src/game/sprites.ts 的 ACTION） */
const ACTION_FIRST_SKILL = 3;

/**
 * 进关前载入本关一定会用到的图（下载过的从缓存读）：
 * 地图用到的图块，本关出场职业的走路、受击、防御动作、动作 3（待机架势取它的第 1 帧，见 sprites.ts idleAction）和普通攻击（含特效），以及防御、反击的固定特效。
 * 其它技能的动作和特效开打后在后台下载（prefetchSkills），出招前还没下完就等它下完（ensureSkill）。返回新下载的字节数。
 */
export async function preloadStage(assets: Assets, stage: string, progress?: Progress, classesOverride?: number[], extraUpper: readonly number[] = []): Promise<number> {
  const { files } = assets;
  const job = new Fetch();
  const loaded = loadStageMap(files, classesOverride ? stage : stageMap(files, stage));
  if (!loaded) return 0;
  const { map } = loaded;
  for (const cell of map.cells)
    cell.forEach((l, k) => {
      const lib = k === 0 ? assets.ground : assets.upper;
      if (l.tile < lib.count && (k > 0 || l.tile > 0)) job.add(lib.sheetOf(l.tile));
    });
  for (const t of extraUpper) if (t < assets.upper.count) job.add(assets.upper.sheetOf(t)); // 地图上没有、但要另外画的物件（囚车）
  const classes = new Set(classesOverride ?? [0]);
  const j = classesOverride ? undefined : stageJson(files, stage);
  if (j) for (const a of stageUnits(j)) if (a.side !== 'object' && a.side !== 'unknown' && a.type < assets.data.classes.length) classes.add(a.type);
  for (const cls of classes) {
    for (let a = 0; a <= ACTION_FIRST_SKILL; a++) job.manAction(assets, cls, a);
    const basic = assets.data.classes[cls]?.skills[0];
    if (basic) job.skill(assets, cls, basic);
  }
  for (const g of FIXED_FX) job.effectGroup(assets, g); // 防御、反击的固定特效
  // 火势蔓延、剧本放火（指令 124）的火焰
  if (j?.rules?.fire || j?.blocks?.some((b) => b.ops.some((o) => o.op === 124))) job.effectGroup(assets, FX_BLAZE);
  return job.run(files, progress);
}

const skillJobs = new WeakMap<Assets, Map<string, Promise<unknown>>>();
const skillKey = (cls: number, sk: SkillDef) => `${cls}:${sk.group}:${sk.type}:${sk.effect}:${sk.effect2}:${sk.effect3}`;

/** 一次下载若干技能的帧（合并成尽量少的请求）；每个技能只下载一次，失败的下次再试，不卡住战斗 */
function fetchSkills(assets: Assets, list: { cls: number; sk: SkillDef }[]): Promise<unknown> {
  const jobs = skillJobs.get(assets) ?? skillJobs.set(assets, new Map()).get(assets)!;
  const job = new Fetch();
  const keys: string[] = [];
  const waits: Promise<unknown>[] = [];
  for (const { cls, sk } of list) {
    const k = skillKey(cls, sk);
    const p = jobs.get(k);
    if (p) waits.push(p);
    else if (!keys.includes(k)) {
      keys.push(k);
      job.skill(assets, cls, sk);
    }
  }
  if (keys.length) {
    const p = job.run(assets.files).catch((e) => {
      for (const k of keys) jobs.delete(k);
      console.warn('下载技能动画失败', e);
    });
    for (const k of keys) jobs.set(k, p);
    waits.push(p);
  }
  return Promise.all(waits);
}

/** 确保职业 cls 施放 sk 要用的帧已经下载 */
export const ensureSkill = (assets: Assets, cls: number, sk: SkillDef) => fetchSkills(assets, [{ cls, sk }]);

/** 开打后在后台下载各单位已经学会的技能（升级后新学的技能出招时再下载） */
export const prefetchSkills = (assets: Assets, units: { classId: number; skills: SkillDef[] }[]) =>
  fetchSkills(assets, units.flatMap((u) => u.skills.map((sk) => ({ cls: u.classId, sk }))));

/** 把 8 位索引帧转成 RGBA 画布；索引 0 透明。 */
/** Object.lib（道具图标）用调色板 13 号纯蓝 (0,0,255) 当底色 */
export const ICON_KEY = 13;

export function frameToCanvas(fr: Frame, palette: Uint8Array, key = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, fr.width);
  c.height = Math.max(1, fr.height);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let i = 0; i < fr.pixels.length; i++) {
    const p = fr.pixels[i];
    if (!p || p === key) continue;
    d[i * 4] = palette[p * 3];
    d[i * 4 + 1] = palette[p * 3 + 1];
    d[i * 4 + 2] = palette[p * 3 + 2];
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
