// 从原版文件解码出的共享资源：调色板、图块库、人物动画库、EXE 表、道具表。
import { openGrp, openLib, openPic, parsePalette, type Frame } from '../formats/image.ts';
import { readExeTables, type ExeTables } from '../formats/exe.ts';
import { parseGoods, type Item } from '../formats/goo.ts';
import { parseAct } from '../formats/act.ts';
import { parseMap } from '../formats/map.ts';
import type { GameFiles, Progress } from '../platform/gamefiles.ts';
import { buildT2S, findStageFile, loadGameData } from '../rules/load.ts';
import type { GameData, SkillDef } from '../rules/data.ts';
import { fxGroups } from './effects.ts';
import frameAlias from '../data/frame-alias.json' with { type: 'json' };

export interface Assets {
  files: GameFiles;
  palette: Uint8Array;
  ground: ReturnType<typeof openGrp>;
  upper: ReturnType<typeof openGrp>;
  /** Grid.grp：0–3 格子光标，4 = 宝箱（地图上的宝物都画这张，EXE 0x4010d0 / 0x40c24f） */
  grid: ReturnType<typeof openGrp>;
  man: ReturnType<typeof openLib>;
  /** 技能特效：60 组，技能子项 +6 = 组号 + 1（0 = 无特效） */
  effects: ReturnType<typeof openLib>;
  objects: ReturnType<typeof openPic>;
  /** 半身头像，第 i 张对应 HUM 第 i 个职业（按图比对，见 binary-formats §3） */
  heads: ReturnType<typeof openPic>;
  exe: ExeTables;
  items: Item[];
  /** 规则引擎用的数据 */
  data: GameData;
  /** 繁→简（由 .pab/.pas 对齐得到） */
  tr: (s: string) => string;
}

export function loadAssets(files: GameFiles): Assets {
  const tr = buildT2S(files);
  return {
    tr,
    data: loadGameData(files, tr),
    files,
    palette: parsePalette(files.get('Data/Default.pal')),
    ground: openGrp(files.get('Data/Ground.grp'), 'Ground.grp'),
    upper: openGrp(files.get('Data/Upper.grp'), 'Upper.grp'),
    grid: openGrp(files.get('Data/Grid.grp'), 'Grid.grp'),
    man: openLib(files.get('Data/Man.lib'), 'Man.lib'),
    effects: openLib(files.get('Data/Effect.lib'), 'Effect.lib'),
    objects: openPic(files.get('Data/Object.lib'), 'Object.lib'),
    heads: openPic(files.get('Data/Head.lib'), 'Head.lib'),
    exe: readExeTables(files.get('ShuiHu.exe')),
    items: parseGoods(files.get('Data/Goods.dab')),
  };
}

type Lib = { span(i: number): [number, number] };

/** frame-alias.json：字节完全相同的帧 → 第一份的帧号（gen:manifest 生成） */
const ALIAS = new Map(
  Object.entries(frameAlias as Record<string, { dup: number[]; src: number[] }>).map(([p, { dup, src }]) => {
    const m = new Map<number, number>();
    let i = 0;
    dup.forEach((d, k) => m.set((i += d), src[k]));
    return [p, m];
  }),
);

/** 一批要下载的字节范围。相同内容的帧只下载第一份，下载完再复制到各自的位置。 */
class Fetch {
  readonly want = new Map<string, [number, number][]>();
  private copies: [string, number, number, number][] = [];
  span(path: string, span: [number, number]) {
    if (span[1] > span[0]) (this.want.get(path) ?? this.want.set(path, []).get(path)!).push(span);
  }
  frame(path: string, lib: Lib, i: number) {
    const own = lib.span(i);
    const j = ALIAS.get(path)?.get(i);
    if (j === undefined) return this.span(path, own);
    const src = lib.span(j);
    this.span(path, src);
    this.copies.push([path, src[0], own[0], own[1] - own[0]]);
  }
  /** Man.lib 第 group 个动作组的全部帧 */
  manGroup(assets: Assets, group: number) {
    const r = assets.man.actions[group];
    if (r) for (let i = r.first; i <= r.last; i++) this.frame('Data/Man.lib', assets.man, i);
  }
  /** 一个技能：职业的出手动作（4 个朝向）和它的特效 */
  skill(assets: Assets, cls: number, sk: SkillDef) {
    const c = assets.man.classes[cls];
    if (c) for (let d = 0; d < 4; d++) {
      const g = c.first + (ACTION_FIRST_SKILL + sk.group) * 4 + d;
      if (g <= c.last) this.manGroup(assets, g);
    }
    for (const g of fxGroups(sk)) {
      const r = assets.effects.actions[g];
      if (r) for (let i = r.first; i <= r.last; i++) this.frame('Data/Effect.lib', assets.effects, i);
    }
  }
  async run(files: GameFiles, progress?: Progress): Promise<number> {
    const n = await files.ensure(this.want, progress);
    for (const [p, from, to, len] of this.copies) files.copy(p, from, to, len);
    return n;
  }
}

/** Man.lib 每个职业的动作：0 走路、1 受击、2 防御，3 起每个技能一组（同 src/game/sprites.ts 的 ACTION） */
const ACTION_FIRST_SKILL = 3;

/**
 * 进关前下载本关一定会用到的帧（网页版大文件按需下载；整份在本地时什么也不做）：
 * 地图用到的图块，本关出场职业的走路、受击、防御动作、动作 3（待机架势取它的第 1 帧，见 sprites.ts idleAction）和普通攻击（含特效）。
 * 其它技能的动作和特效开打后在后台下载（prefetchSkills），出招前还没下完就等它下完（ensureSkill）。返回新下载的字节数。
 */
export async function preloadStage(assets: Assets, stage: string, progress?: Progress): Promise<number> {
  const { files } = assets;
  const job = new Fetch();
  const mapFile = findStageFile(files, stage, '.map');
  if (!mapFile) return 0;
  const map = parseMap(files.get(mapFile), mapFile);
  for (const cell of map.cells)
    cell.forEach((l, k) => {
      const lib = k === 0 ? assets.ground : assets.upper;
      if (l.tile < lib.count && (k > 0 || l.tile > 0)) job.span(k === 0 ? 'Data/Ground.grp' : 'Data/Upper.grp', lib.span(l.tile));
    });
  const actFile = mapFile.replace(/\.map$/i, '.act');
  const classes = new Set([0]);
  if (files.has(actFile))
    for (const a of parseAct(files.get(actFile), actFile)) if (a.side !== 'object' && a.side !== 'unknown' && a.type < assets.data.classes.length) classes.add(a.type);
  for (const cls of classes) {
    const c = assets.man.classes[cls];
    if (c) for (let g = c.first; g < Math.min(c.last + 1, c.first + (ACTION_FIRST_SKILL + 1) * 4); g++) job.manGroup(assets, g);
    const basic = assets.data.classes[cls]?.skills[0];
    if (basic) job.skill(assets, cls, basic);
  }
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
