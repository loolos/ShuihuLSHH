// 扩展包载入（docs/game-design.md §15.2）：把包的职业、技能、道具接到原版数据后面，把关卡 JSON 编译成 StageInput。
// 纯 TypeScript，浏览器与 Node（测试）共用；读 JSON 和图片由调用方负责（浏览器见 src/game/packs.ts）。
import type { ActUnit } from '../formats/act.ts';
import type { PasBlock, PasOp, PasTrigger } from '../formats/pas.ts';
import { parseMap } from '../formats/map.ts';
import type { StageInput } from '../rules/battle.ts';
import { Board } from '../rules/board.ts';
import type { ClassDef, GameData, SkillDef } from '../rules/data.ts';
import { findStageFile, type FileSource } from '../rules/load.ts';
import type { RecolorGroup } from './recolor.ts';
import type { PackBlockJson, PackClassJson, PackJson, PackSkillJson, PackStageJson, PackUnitJson } from './types.ts';

/** 精灵图条的说明文件（tools/render-sprites.py 输出的 sprites.json） */
export interface SpriteSheetJson {
  frame: [number, number];
  anchor: [number, number];
  actions: Record<string, { front: SpriteStrip; back: SpriteStrip }>;
}
export interface SpriteStrip {
  file: string;
  frames: number;
  ms: number;
}

/** 一个扩展包职业在画面上的样子 */
export interface PackClassLook {
  /** 图条目录（相对包目录）；借原版动画的职业为空串 */
  sheet: string;
  /** 借原版哪个职业的动画（Man.lib）；有它时 sheet / actions / idle 不用 */
  from?: number;
  /** 借原版动画时的换色（src/packs/recolor.ts） */
  recolor?: RecolorGroup[];
  /** 动作号 → sprites.json 里的动作名：0 走路、1 受击、2 防御，3 起是各技能组的出手动作（同 Man.lib） */
  actions: string[];
  idle: string;
  head?: number;
  /** 原版 Head.lib 的序号，或包里头像图的路径（相对包目录）；null = 没有头像 */
  face: number | string | null;
}

export interface PackRuntime {
  id: string;
  name: string;
  credits: string[];
  /** 并入了本包职业、技能、道具后的数据 */
  data: GameData;
  classIds: Map<string, number>;
  skillIds: Map<string, number>;
  itemIds: Map<string, number>;
  /** 运行时职业号 → 画面信息 */
  looks: Map<number, PackClassLook>;
  stages: PackStageJson[];
  sheets: Record<string, SpriteSheetJson>;
}

/** 原版出手动画的帧间隔（src/game/sprites.ts ACTION_FRAME_MS）。技能命中帧按它换算 */
const ORIGINAL_FRAME_MS = 45;
/** 扩展包技能号从这里起（原版技能号到 230 左右，重制版新增技能从 1000 起） */
const PACK_SKILL_BASE = 2000;

/**
 * 把包并进原版数据。职业接在原版职业表后面（运行时编号 = 原版职业数 + 序号），道具接在道具表后面，
 * 技能号从 2000 起。字符串 id → 运行时编号记在 classIds / skillIds / itemIds，存档和剧本只认字符串 id。
 */
export function buildPack(base: GameData, pack: PackJson, stages: PackStageJson[], sheets: Record<string, SpriteSheetJson>): PackRuntime {
  const classIds = new Map<string, number>();
  const skillIds = new Map<string, number>();
  const itemIds = new Map<string, number>();
  const items = [...base.items];
  for (const it of pack.items ?? []) {
    const from = base.items[it.from - 1];
    if (!from) throw new Error(`${pack.id}: 道具 ${it.id} 借的原版道具 ${it.from} 不存在`);
    const id = items.length + 1;
    items.push({ ...from, id, name: it.name, description: it.description ?? from.description, attack: it.attack ?? from.attack, defense: it.defense ?? from.defense, agility: it.agility ?? from.agility });
    itemIds.set(it.id, id);
  }
  const itemRef = (v: number | string) => (typeof v === 'number' ? v : (itemIds.get(v) ?? fail(`${pack.id}: 没有道具 ${v}`)));
  const templates = new Map<number, SkillDef>();
  for (const c of base.classes) for (const s of c?.skills ?? []) if (!templates.has(s.skillId)) templates.set(s.skillId, s);
  const classes = [...base.classes];
  const charNames = [...base.charNames];
  const looks = new Map<number, PackClassLook>();
  let nextSkill = PACK_SKILL_BASE;
  for (const c of pack.classes) {
    const id = classes.length;
    classIds.set(c.id, id);
    const face = !c.face ? null : 'file' in c.face ? c.face.file : c.face.fromHead;
    if ('fromClass' in c.sprite) {
      // 借原版职业的动画：出手动作 = 原版第几个出手动作，命中帧沿用 from 技能
      const from = c.sprite.fromClass;
      if (!base.classes[from]) fail(`${pack.id}: 职业 ${c.id} 借的原版职业 ${from} 不存在`);
      // 同一技能号（如 221 普通攻擊）在各职业里命中帧不同：先找被借职业自己的那一份
      const own = new Map(templates);
      for (const t of base.classes[from].skills) own.set(t.skillId, t);
      const skills = c.skills.map((s) => {
        const sid = nextSkill++;
        skillIds.set(s.id, sid);
        return packSkill(s, sid, null, own, null, pack.id);
      });
      classes.push(packClass(c, id, skills, itemRef));
      charNames[id] = c.name;
      looks.set(id, { sheet: '', actions: [], idle: '', from, recolor: c.sprite.recolor, head: c.sprite.head, face });
      continue;
    }
    const sp = c.sprite;
    const sheet = sheets[sp.sheet] ?? fail(`${pack.id}: 职业 ${c.id} 的图条 ${sp.sheet} 没有 sprites.json`);
    const anims: string[] = [];
    const skills = c.skills.map((s) => {
      const sid = nextSkill++;
      skillIds.set(s.id, sid);
      const anim = String(s.anim);
      if (!anims.includes(anim)) anims.push(anim);
      return packSkill(s, sid, anims.indexOf(anim), templates, sheet, pack.id);
    });
    for (const a of [sp.idle, sp.walk, sp.hurt, sp.defend, ...anims])
      if (!sheet.actions[a]) fail(`${pack.id}: 职业 ${c.id} 用到的动作 ${a} 不在 ${sp.sheet}/sprites.json 里`);
    classes.push(packClass(c, id, skills, itemRef));
    charNames[id] = c.name;
    looks.set(id, {
      sheet: sp.sheet,
      actions: [sp.walk, sp.hurt, sp.defend, ...anims],
      idle: sp.idle,
      head: sp.head,
      face,
    });
  }
  return {
    id: pack.id,
    name: pack.name,
    credits: pack.credits ?? [],
    data: { ...base, classes, items, charNames },
    classIds,
    skillIds,
    itemIds,
    looks,
    stages,
    sheets,
  };
}

function fail(msg: string): never {
  throw new Error(msg);
}

function packClass(c: PackClassJson, id: number, skills: SkillDef[], itemRef: (v: number | string) => number): ClassDef {
  const g = (base: number) => ({ base, growth: 100 });
  const items = (c.items ?? []).map(itemRef);
  while (items.length < 7) items.push(0);
  return {
    id,
    name: c.name,
    hp: g(c.base.hp),
    mp: g(c.base.mp),
    attack: g(c.base.attack),
    defense: g(c.base.defense),
    hit: g(c.base.hit),
    agility: g(c.base.agility),
    crit: g(c.base.crit),
    move: c.move,
    weaponType: c.weaponType ?? 0,
    goldCap: 0,
    defaultItems: items,
    skills,
  };
}

/** 命中位置（动画的 0–1）→ 原版帧号：按 45 ms 一帧换算，BattleScene 按这个时间点结算受击 */
function hitFrame(at: number, strip: SpriteStrip) {
  return Math.max(1, Math.round((at * strip.frames * strip.ms) / ORIGINAL_FRAME_MS) + 1);
}

function packSkill(s: PackSkillJson, skillId: number, group: number | null, templates: Map<number, SkillDef>, sheet: SpriteSheetJson | null, pack: string): SkillDef {
  const t = templates.get(s.from) ?? fail(`${pack}: 技能 ${s.id} 借的原版技能 ${s.from} 不存在`);
  let hits = t.hits;
  if (sheet) {
    const strip = sheet.actions[String(s.anim)]?.front ?? fail(`${pack}: 技能 ${s.id} 的动作 ${s.anim} 不存在`);
    // 原版分方向的命中段（迴旋技 0–3 四个方向）保留方向结构，每个方向都按 hitAt 分段
    const dirs = [...new Set(t.hits.map((h) => h.dir))];
    const at = s.hitAt ?? [0.5];
    hits = t.hits.length
      ? dirs.flatMap((dir) => at.map((f, i) => ({ frame: hitFrame(f, strip), percent: i < at.length - 1 ? Math.floor(100 / at.length) : 100 - Math.floor(100 / at.length) * (at.length - 1), dir })))
      : [];
  } else group = typeof s.anim === 'number' ? s.anim : t.group; // 借原版动画：原版第几个出手动作
  return {
    ...t,
    skillId,
    soundId: t.soundId ?? t.skillId,
    name: s.name,
    group: group ?? 0,
    hidden: false,
    power: s.power ?? t.power,
    mpCost: s.mpCost ?? t.mpCost,
    learnLevel: s.learnLevel ?? 1,
    rangeMin: s.rangeMin ?? t.rangeMin,
    rangeMax: s.rangeMax ?? t.rangeMax,
    area: s.area ?? t.area,
    stun: s.stun ?? t.stun,
    poison: s.poison ?? t.poison,
    hitMod: s.hitMod ?? t.hitMod,
    critMod: s.critMod ?? t.critMod,
    hits,
  };
}

/** 关卡在剧本里的名字（Battle.name、网址 ?stage=） */
export const packStageName = (pack: string, stage: string) => `pack:${pack}/${stage}`;

/** 关卡里会出现的全部职业（开场的单位，加上剧本 transform 换成的职业），预载动画用 */
export function stageClasses(rt: PackRuntime, stage: PackStageJson): number[] {
  const ref = (v: unknown) => (typeof v === 'number' ? v : rt.classIds.get(String(v)));
  const list = stage.units.map((u) => ref(u.class));
  for (const b of stage.script) for (const [name, , cls] of b.do) if (name === 'transform') list.push(ref(cls));
  return [...new Set(list.filter((c): c is number => c !== undefined))];
}

/** 把关卡 JSON 编译成 StageInput：单位 → ACT 记录，剧本 → PasBlock（新指令 100 起，见 battle.ts） */
export function compileStage(rt: PackRuntime, stage: PackStageJson, files: FileSource, opts: { seed?: number; text?: (s: string) => string } = {}): StageInput {
  const mapFile = findStageFile(files, stage.map.base, '.map') ?? fail(`找不到地图 ${stage.map.base}`);
  const map = parseMap(files.get(mapFile), mapFile);
  const att = (f: string) => new Uint8Array(files.get(f).subarray(8));
  const board = Board.fromMap(map, att('Data/Ground.att'), att('Data/Upper.att'));
  const units = stage.units.map((u, i) => actUnit(rt, u, i));
  const byId = new Map(stage.units.map((u, i) => [u.id, { json: u, act: units[i] }]));
  const unitRef = (id: unknown) => byId.get(String(id)) ?? fail(`${stage.id}: 没有单位 ${String(id)}`);
  /** 触发条件按角色号找人，所以同一职业只能有一个人当触发对象 */
  const charOf = (id: string) => {
    const u = unitRef(id).act;
    if (units.filter((x) => x.type === u.type).length > 1) fail(`${stage.id}: 单位 ${id} 的职业不唯一，不能用作触发条件`);
    return u.type;
  };
  const skillRef = (id: unknown) => rt.skillIds.get(String(id)) ?? fail(`${stage.id}: 没有技能 ${String(id)}`);
  const classRef = (v: unknown) => (typeof v === 'number' ? v : (rt.classIds.get(String(v)) ?? fail(`${stage.id}: 没有职业 ${String(v)}`)));
  const blocks = stage.script.map((b, i) => compileBlock(b, i, { charOf, classRef, unitRef, skillRef, itemRef: (v) => (typeof v === 'number' ? v : (rt.itemIds.get(String(v)) ?? fail(`${stage.id}: 没有道具 ${String(v)}`))) }));
  const aiPrefer: Record<number, number[]> = {};
  for (const [uid, list] of Object.entries(stage.aiPrefer ?? {})) aiPrefer[charOf(uid)] = list.map(skillRef);
  const names: Record<number, string> = {};
  stage.units.forEach((u, i) => u.name && (names[i] = u.name));
  return { name: packStageName(rt.id, stage.id), board, units, blocks, data: rt.data, seed: opts.seed, text: opts.text, aiPrefer, names };
}

function actUnit(rt: PackRuntime, u: PackUnitJson, index: number): ActUnit {
  const type = typeof u.class === 'number' ? u.class : (rt.classIds.get(u.class) ?? fail(`没有职业 ${u.class}`));
  const items = (u.items ?? []).map((v) => (typeof v === 'number' ? v : (rt.itemIds.get(v) ?? fail(`没有道具 ${v}`))));
  while (items.length < 7) items.push(0);
  const ai = u.ai ?? 0;
  return {
    index,
    type,
    group: index + 1, // 剧本用 1000 + 编组号点名（同职业的几个人也分得开）
    side: u.side,
    facing: u.facing ?? 2,
    x: u.x,
    y: u.y,
    level: u.level,
    flags: (ai << 8) | (u.hidden ? 1 : 0),
    extra: [0, 0, 0],
    items,
    raw: [],
  };
}

interface Refs {
  charOf: (id: string) => number;
  classRef: (v: unknown) => number;
  unitRef: (id: unknown) => { json: PackUnitJson; act: ActUnit };
  skillRef: (id: unknown) => number;
  itemRef: (v: unknown) => number;
}

const NARRATOR = 0xffffffff;

function compileBlock(b: PackBlockJson, index: number, r: Refs): PasBlock {
  const on = b.on;
  let trigger: PasTrigger;
  let cond: PasBlock['cond'] = { type: 0, arg: 0 };
  if (on === 'start') trigger = { kind: 'turn', turn: 0 };
  else if (on === 'enemiesDefeated') {
    trigger = { kind: 'cond' };
    cond = { type: 1, arg: 0xff }; // 原版条件 1、参数 0xFF：敌方全灭
  }
  else if ('turn' in on) trigger = { kind: 'turn', turn: on.turn - 1 };
  else if ('dead' in on) trigger = { kind: 'death', char: r.charOf(on.dead) };
  else if ('enter' in on) {
    const [x1, y1, x2, y2] = on.area;
    trigger = { kind: 'area', char: r.charOf(on.enter), x1, y1, x2, y2 };
  } else trigger = { kind: 'used', char: r.charOf(on.used), skills: on.skills?.map(r.skillRef), count: on.count };
  const ops: PasOp[] = [];
  const op = (code: number, value = 0, extra: Partial<PasOp> = {}) => ops.push({ op: code, flag: code < 24 ? 0 : null, value, ...extra });
  const select = (id: unknown) => op(12, 1000 + r.unitRef(id).act.group);
  for (const [name, ...a] of b.do) {
    switch (name) {
      case 'narrate':
        op(12, NARRATOR);
        op(13, 0, { text: String(a[0]) });
        break;
      case 'say':
        select(a[0]);
        op(13, 0, { text: String(a[1]) });
        break;
      case 'appear':
        select(a[0]);
        break;
      case 'move':
        select(a[0]);
        op(14, Number(a[1]));
        op(15, Number(a[2]));
        op(17, 1);
        break;
      case 'objective':
        op(31, 0, { text: String(a[0]) });
        break;
      case 'turnLimit':
        op(35, Number(a[0]));
        break;
      case 'victory':
        op(29, 0, { text: String(a[0] ?? '') });
        break;
      case 'transform':
        select(a[0]);
        op(102, r.classRef(a[1]), a[2] === undefined ? {} : { text: String(a[2]) });
        break;
      case 'defeat':
        op(30, 0, { text: String(a[0] ?? '') });
        break;
      case 'sound':
        op(21, 0, { text: String(a[0]) });
        break;
      case 'setEquip':
        select(a[0]);
        ops.push({ op: 100, flag: Number(a[1]), value: Number(a[2]) ? r.itemRef(a[2]) : 0 });
        break;
      case 'buff': {
        select(a[0]);
        const o = (a[2] ?? {}) as { pct?: number; add?: number; turns?: number };
        ops.push({ op: 101, flag: null, value: 0, args: { stat: String(a[1]), pct: o.pct, add: o.add, turns: o.turns } });
        break;
      }
      default:
        fail(`第 ${index} 个区块：不认识的指令 ${name}`);
    }
  }
  return { index, head: [], trigger, cond, ops };
}
