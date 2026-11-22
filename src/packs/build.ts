import entryLevels from '../data/entry-levels.json' with { type: 'json' };
import { enemyRank } from '../rules/enemy-level.ts';
// 扩展包载入（docs/game-design.md §15.2）：把包的职业、技能、道具接到原版数据后面，把关卡 JSON 编译成 StageInput。
// 纯 TypeScript，浏览器与 Node（测试）共用；读 JSON 和图片由调用方负责（浏览器见 src/game/packs.ts）。
import type { ActUnit } from '../formats/act.ts';
import type { DidAction, PasBlock, PasCond, PasOp, PasTrigger } from '../formats/pas.ts';
import type { StageInput } from '../rules/battle.ts';
import { Board } from '../rules/board.ts';
import type { ClassDef, GameData, SkillDef } from '../rules/data.ts';
import { loadStageMap, stageMapName, terrain, type FileSource } from '../rules/load.ts';
import { SLOT_COUNT } from '../rules/data.ts';
import { levelKit } from '../rules/equipment.ts';
import type { Member } from '../rules/campaign.ts';
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
  /** 一次出手内连续播放这套动作的次数，默认 1 */
  cycles?: number;
}

/** 一个扩展包职业在画面上的样子 */
export interface PackClassLook {
  /** 图条目录（相对包目录）；借原版动画的职业为空串 */
  sheet: string;
  /** 借原版哪个职业的动画（Man.lib）；有它时 sheet / actions / idle 不用 */
  from?: number;
  /** 借原版动画时的换色（src/packs/recolor.ts） */
  recolor?: RecolorGroup[];
  /** 混搭：本职业动作号（0 走路、1 受击、2 防御，3 起出手）→ 改借哪个职业的哪个动作 */
  parts?: Map<number, LookPart>;
  /** 待机姿势用走路第 1 帧 */
  idleWalk?: boolean;
  /** 染鞋的目标色阶（parts 里 shoes 为真的动作用） */
  shoes?: { dst: [number, number]; k?: number };
  /** 动作号 → sprites.json 里的动作名：0 走路、1 受击、2 防御，3 起是各技能组的出手动作（同 Man.lib） */
  actions: string[];
  idle: string;
  head?: number;
  /** 原版 Head.lib 的序号，或包里头像图的路径（相对包目录）；null = 没有头像 */
  face: number | string | null;
}

export interface LookPart {
  from: number;
  action: number;
  recolor?: RecolorGroup[];
  shoes: boolean;
}

/** BorrowSprite.parts 的键 → 本职业动作号 */
function partAction(key: string, pack: string, cls: string): number {
  if (key === 'walk') return 0;
  if (key === 'hurt') return 1;
  if (key === 'defend') return 2;
  if (/^\d+$/.test(key)) return 3 + Number(key);
  return fail(`${pack}: 职业 ${cls} 的 parts 键 ${key} 不认识（walk / hurt / defend / 数字）`);
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
  /** 包里在城镇有卖的道具（运行时道具号）：和原版装备一样按等级表换，不当剧情道具保留 */
  shopItems: Set<number>;
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
  const shopItems = new Set<number>();
  for (const it of pack.items ?? []) {
    const from = base.items[it.from - 1];
    if (!from) throw new Error(`${pack.id}: 道具 ${it.id} 借的原版道具 ${it.from} 不存在`);
    const id = items.length + 1;
    const sale = it.shop ? { category: 2, seqA: [...it.shop, ...Array(13).fill(0)].slice(0, 13) } : {};
    const price = it.buyPrice !== undefined ? { buyPrice: it.buyPrice, sellPrice: Math.floor(it.buyPrice / 2) } : {};
    items.push({
      ...from, ...sale, ...price, id, name: it.name, type: it.type ?? from.type, description: it.description ?? from.description,
      attack: it.attack ?? from.attack, defense: it.defense ?? from.defense, agility: it.agility ?? from.agility, hit: it.hit ?? from.hit,
    });
    itemIds.set(it.id, id);
    if (it.shop) shopItems.add(id);
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
      const sp = c.sprite;
      const from = sp.fromClass;
      if (!base.classes[from]) fail(`${pack.id}: 职业 ${c.id} 借的原版职业 ${from} 不存在`);
      const parts = new Map<number, LookPart>();
      for (const [key, p] of Object.entries(sp.parts ?? {})) {
        if (!base.classes[p.fromClass]) fail(`${pack.id}: 职业 ${c.id} 的 ${key} 借的原版职业 ${p.fromClass} 不存在`);
        const recolor = typeof p.recolor === 'string' ? (sp.recolors?.[p.recolor] ?? fail(`${pack.id}: 职业 ${c.id} 没有换色方案 ${p.recolor}`)) : p.recolor;
        if (p.shoes && !sp.shoes) fail(`${pack.id}: 职业 ${c.id} 的 ${key} 要染鞋，但没写 sprite.shoes`);
        parts.set(partAction(key, pack.id, c.id), { from: p.fromClass, action: p.action, recolor, shoes: !!p.shoes });
      }
      // 同一技能号（如 221 普通攻擊）在各职业里命中帧不同：先找被借职业自己的那一份（混搭的动作找那个动作的出处）
      const ownOf = (cls: number) => {
        const own = new Map(templates);
        for (const t of base.classes[cls].skills) own.set(t.skillId, t);
        return own;
      };
      const skills = c.skills.map((s) => {
        const sid = nextSkill++;
        skillIds.set(s.id, sid);
        const donor = typeof s.anim === 'number' ? (parts.get(3 + s.anim)?.from ?? from) : from;
        return packSkill(s, sid, null, ownOf(donor), null, pack.id);
      });
      classes.push(packClass(c, id, skills, itemRef));
      charNames[id] = c.name;
      looks.set(id, {
        sheet: '',
        actions: [],
        idle: '',
        from,
        recolor: sp.recolor,
        head: sp.head,
        face,
        ...(parts.size ? { parts } : {}),
        ...(sp.idle === 'walk' ? { idleWalk: true } : {}),
        ...(sp.shoes ? { shoes: sp.shoes } : {}),
      });
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
    shopItems,
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
  return Math.max(1, Math.round((at * strip.frames * strip.ms * (strip.cycles ?? 1)) / ORIGINAL_FRAME_MS) + 1);
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
    targetShape: s.targetShape,
    chargeTarget: s.chargeTarget,
    rangedDamage: s.rangedDamage,
    castCycles: s.castCycles,
    areaOrigin: s.areaOrigin,
    areaPattern: s.areaPattern,
    castSpeed: s.castSpeed,
    hitFx: s.hitFx,
    arrowFx: s.arrowFx,
    pierce: s.pierce,
    power: s.power ?? t.power,
    mpCost: s.mpCost ?? t.mpCost,
    learnLevel: s.learnLevel ?? 1,
    rangeMin: s.rangeMin ?? t.rangeMin,
    rangeMax: s.rangeMax ?? t.rangeMax,
    area: s.area ?? t.area,
    stun: s.stun ?? t.stun,
    ...(s.drug ? { drug: s.drug } : {}),
    poison: s.poison ?? t.poison,
    hitMod: s.hitMod ?? t.hitMod,
    critMod: s.critMod ?? t.critMod,
    type: s.type ?? t.type,
    effect: s.effect ?? t.effect,
    effect2: s.effect2 ?? t.effect2,
    effect3: s.effect3 ?? t.effect3,
    hits: s.hits ?? hits,
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
export function compileStage(rt: PackRuntime, stage: PackStageJson, files: FileSource, opts: { seed?: number; text?: (s: string) => string; party?: Map<number, Member>; joinLevel?: number; preset?: boolean } = {}): StageInput {
  const { map } = loadStageMap(files, stageMapName(stage.map)) ?? fail(`找不到地图 ${stageMapName(stage.map)}`);
  const att = terrain(files);
  const board = Board.fromMap(map, att.ground, att.upper);
  for (const [x, y] of stage.map.open ?? []) {
    if (!board.onGround(x, y)) fail(`${stage.id}: map.open (${x},${y}) 不在地面上`);
    board.blocked[y * board.width + x] = 0;
  }
  for (const [x, y] of stage.map.seal ?? []) {
    if (!board.inBounds(x, y)) fail(`${stage.id}: map.seal (${x},${y}) 出界`);
    board.blocked[y * board.width + x] = 1;
  }
  // 选关预设只用于新建试玩，不覆盖正常主线存档；表里的包职业使用稳定key。
  const preset: Record<string,number> = opts.preset ? (entryLevels.levels as Record<string,Record<string,number>>)[`${rt.id}/${stage.id}`] ?? {} : {};
  if (opts.preset) {
    const party = new Map(opts.party);
    for(const unit of stage.units.filter(u=>u.side==='player')) {
      const id=typeof unit.class==='number'?unit.class:rt.classIds.get(unit.class)!;
      const level=preset[String(unit.class)];
      if(level===undefined)continue;
      const old=party.get(id);
      const slots=[...rt.data.classes[id].defaultItems];levelKit(rt.data,rt.data.classes[id],level,slots);party.set(id,{...old,classId:id,level,exp:0,slots,forge:[]});
    }
    opts={...opts,party};
  }
  const units = stage.units.map((u, i) => actUnit(rt, u, i));
  // AI 目标 / 目标点（模式 1、5、10 追人跟人，模式 4 先走到某格）【新】
  stage.units.forEach((u, i) => {
    if (u.target !== undefined) {
      const t = stage.units.findIndex((x) => x.id === u.target);
      if (t < 0) fail(`${stage.id}: 单位 ${u.id} 的 target ${u.target} 不存在`);
      if (units.filter((x) => x.type === units[t].type).length > 1) fail(`${stage.id}: ${u.id} 的 target ${u.target} 职业不唯一`);
      units[i].extra[0] = units[t].type;
    }
    if (u.point) { units[i].extra[1] = u.point[0]; units[i].extra[2] = u.point[1]; }
    if (u.patrol?.length && !u.point) { units[i].extra[1] = u.patrol[0][0]; units[i].extra[2] = u.patrol[0][1]; }
  });
  if(opts.preset)units.forEach((u,i)=>{if(u.side==='player'&&preset[String(stage.units[i].class)]!==undefined)u.level=preset[String(stage.units[i].class)];});
  if (stage.dynamicLevels) {
    const levels = units.filter(u => u.side === 'player').map(u => opts.party?.get(u.type)?.level).filter((n): n is number => n !== undefined);
    const level = levels.length ? Math.round(levels.reduce((a,b) => a+b,0)/levels.length) : opts.joinLevel || Math.round(units.filter(u=>u.side==='player').reduce((a,u)=>a+u.level,0)/Math.max(1, units.filter(u=>u.side==='player').length));
    units.forEach((u,i) => {
      if (u.side === 'player') u.level = opts.party?.get(u.type)?.level ?? level;
      else if (u.level > 1) u.level = Math.max(1, level + (stage.units[i].levelOffset ?? (u.side === 'enemy' ? -1 : 0)));
    });
  } else if (opts.party) {
    // A story's authored level must not silently promote an existing member or erase experience.
    for (const u of units) if (u.side === 'player' && opts.party.has(u.type)) u.level = opts.party.get(u.type)!.level;
  }
  // 新入队只按本场已有战斗好汉的均级确定一次，不能再被全局joinLevel二次抬高。
  const existing = units.filter(u=>u.side==='player' && !stage.units[u.index].spectator && !stage.units[u.index].prisonCart && rt.data.classes[u.type].skills.length && opts.party?.has(u.type)).map(u=>opts.party!.get(u.type)!.level);
  const localJoin = existing.length ? Math.round(existing.reduce((a,b)=>a+b,0)/existing.length) : opts.joinLevel;
  if (opts.party?.size && localJoin) for (const u of units) if(u.side==='player'&&!opts.party.has(u.type)) u.level=localJoin;
  // 先确定动态等级，再生成默认配装；已有队员装备仍由 party 继承。
  kitPlayers(rt, stage, units, files);
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
  const flagIds = new Map<string, number>();
  const flagRef = (v: unknown) => flagIds.get(String(v)) ?? flagIds.set(String(v), flagIds.size + 1).get(String(v))!;
  const blocks = stage.script.map((b, i) => compileBlock(b, i, { flagRef, charOf, classRef, unitRef, skillRef, tidBase: `${rt.id}/${stage.id}`, itemRef: (v) => (typeof v === 'number' ? v : (rt.itemIds.get(String(v)) ?? fail(`${stage.id}: 没有道具 ${String(v)}`))) }));
  const aiPrefer: Record<number, number[]> = {};
  for (const [uid, list] of Object.entries(stage.aiPrefer ?? {})) aiPrefer[charOf(uid)] = list.map(skillRef);
  const names: Record<number, string> = {};
  stage.units.forEach((u, i) => u.name && (names[i] = u.name));
  const clearGold = stage.pov ? 0 : stage.rewards?.gold;
  return { name: packStageName(rt.id, stage.id), board, units, blocks, data: rt.data, seed: opts.seed, text: opts.text, aiPrefer, names, hpMultipliers: Object.fromEntries(stage.units.flatMap((u, i) => u.hpMultiplier === undefined ? [] : [[i, u.hpMultiplier]])), spectators: stage.units.flatMap((u, i) => u.spectator ? [i] : []), prisonCarts: stage.units.flatMap((u, i) => u.prisonCart ? [i] : []), clearGold, watchers: Object.fromEntries(stage.units.flatMap((u, i) => u.watch === undefined ? [] : [[i, u.watch]])), watchTrust: Object.fromEntries(stage.units.flatMap((u, i) => u.trusts?.length ? [[i, u.trusts.map(classRef)]] : [])), patrols: Object.fromEntries(stage.units.flatMap((u, i) => u.patrol?.length ? [[i, u.patrol.map(([x, y]) => ({ x, y }))]] : [])), ...(stage.stealth ? { stealth: { lose: stage.stealth.lose, ...(stage.stealth.flag ? { flag: flagRef(stage.stealth.flag) } : {}) } } : {}), enemyRanks: stage.cuju ? {} : Object.fromEntries(units.filter(u=>u.side==='enemy' && stage.units[u.index].ai!==8 && !stage.units[u.index].spectator).map(u=>[u.index,stage.units[u.index].enemyRank ?? enemyRank(u.type)])), party: opts.party, ...(stage.map.seal?.length ? { sealed: stage.map.seal.map(([x, y]) => ({ x, y })) } : {}), ...(stage.cuju ? { cuju: stage.cuju } : {}), ...(stage.banquet ? { banquet: { flag: flagRef(stage.banquet.flag), sight: stage.banquet.sight ?? 2 } } : {}), toasts: Object.fromEntries(stage.units.flatMap((u, i) => u.toasts?.length ? [[i, u.toasts]] : [])), extraSkills: Object.fromEntries(stage.units.flatMap((u, i) => u.skills?.length ? [[i, u.skills.map(skillRef)]] : [])), drinks: Object.fromEntries(stage.units.flatMap((u, i) => u.drink ? [[i, { refuse: u.drink.refuse ?? 0, turns: u.drink.turns, by: u.drink.by?.map(classRef), ...(u.drink.light ? { light: true } : {}) }]] : [])) };
}

/** 外传默认配装按每个人自己的等级；包自带装备和 gearAt:none 剧情例外保留。 */
function kitPlayers(rt: PackRuntime, stage: PackStageJson, units: ActUnit[], files: FileSource): void {
  if (stage.gearAt === 'none') return;
  const custom = new Set([...rt.itemIds.values()].filter((id) => !rt.shopItems.has(id)));
  for (const u of units) {
    if (u.side !== 'player') continue;
    const cls = rt.data.classes[u.type];
    if (!cls) continue;
    const slots = cls.defaultItems.slice();
    while (slots.length < SLOT_COUNT) slots.push(0);
    u.items.forEach((id, k) => id && (slots[k] = id));
    levelKit(rt.data, cls, u.level, slots, (id) => custom.has(id));
    u.items = slots;
  }
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
    flags: (ai << 8) | (u.hidden || u.offstage ? 1 : 0),
    // AI 12 守屋：屋子范围借 ACT 的目标 / 目标点字段存（目标 = x2 << 8 | y2，目标点 = x1, y1）
    extra: u.guardArea ? [(u.guardArea[2] << 8) | u.guardArea[3], u.guardArea[0], u.guardArea[1]] : [0, 0, 0],
    items,
    raw: [],
  };
}

interface Refs {
  flagRef: (name: unknown) => number;
  charOf: (id: string) => number;
  classRef: (v: unknown) => number;
  unitRef: (id: unknown) => { json: PackUnitJson; act: ActUnit };
  skillRef: (id: unknown) => number;
  itemRef: (v: unknown) => number;
  /** 多语言编号前缀「包/关卡」（§10.3）：剧本步骤末尾的 "#n" 编成「包/关卡#n」 */
  tidBase?: string;
}

/** 步骤（或剧情选项）末尾的多语言编号 "#n"（§10.3）：拿掉并返回编号 */
export const LINE_ID = /^#\d+$/;
function takeLineId(step: unknown[]): string | undefined {
  const last = step[step.length - 1];
  if (step.length > 1 && typeof last === 'string' && LINE_ID.test(last)) return (step.pop() as string).slice(1);
  return undefined;
}

const NARRATOR = 0xffffffff;
const DID_ACTIONS: DidAction[] = ['move', 'attack', 'skill', 'flank', 'defend', 'guard', 'counter', 'rest', 'item', 'give', 'drunk', 'refuse', 'wake'];

/** if / unless 写成数组时：每个标志都要设上 / 都没设（AND）【新】 */
function flagConds(b: PackBlockJson, r: Refs): PasCond[] {
  const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  return [...list(b.if).map((f) => ({ type: 100, arg: r.flagRef(f) })), ...list(b.unless).map((f) => ({ type: 101, arg: r.flagRef(f) }))];
}
const andAll = (cs: PasCond[]): PasCond => cs.reduce((a, c) => ({ op: 'and', a, b: c }));

function compileBlock(b: PackBlockJson, index: number, r: Refs): PasBlock {
  const on = b.on;
  let trigger: PasTrigger;
  let cond: PasBlock['cond'] = { type: 0, arg: 0 };
  if (on === 'start') trigger = { kind: 'turn', turn: 0 };
  else if (on === 'enemiesDefeated' || on === 'allEnemiesDefeated') {
    trigger = { kind: 'cond' };
    cond = on === 'allEnemiesDefeated' ? { type: 102, arg: 0 } : { type: 1, arg: 0xff }; // 102 含隐藏增援；原版 1/0xFF 只数在场敌人
    // if / unless：再要求剧本标志设上（条件 100）/ 没设（条件 101）【新】
    cond = andAll([cond, ...flagConds(b, r)]);
  }
  else if ('flag' in on) {
    // 剧本标志设上时（剧情选项的分支）【新】
    trigger = { kind: 'cond' };
    cond = andAll([{ type: 100, arg: r.flagRef(on.flag) }, ...flagConds(b, r)]);
  }
  else if ((b.if !== undefined || b.unless !== undefined) && !('near' in on) && !('hp' in on) && !('turn' in on) && !('did' in on) && !('enter' in on)) fail(`第 ${index} 个区块：if / unless 只能配 enemiesDefeated / allEnemiesDefeated / near / hp / turn / flag / did / enter`);
  else if ('turn' in on) trigger = { kind: 'turn', turn: on.turn - 1, ...(b.if !== undefined || b.unless !== undefined ? { flagged: true } : {}) };
  else if ('dead' in on) trigger = { kind: 'death', char: r.charOf(on.dead) };
  else if ('enter' in on) {
    const [x1, y1, x2, y2] = on.area;
    // enter: "player"：我方任何一个在场的人走进去都算（智取无为军的探查点、放火点）【新】
    const anyone = on.enter === 'player';
    const who = anyone ? [0] : Array.isArray(on.enter) ? on.enter.map(r.charOf) : [r.charOf(on.enter)];
    trigger = { kind: 'area', char: who[0], x1, y1, x2, y2, ...(anyone ? { side: 'player' as const } : {}), ...(who.length > 1 ? { chars: who } : {}), ...(b.if !== undefined || b.unless !== undefined ? { flagged: true } : {}), ...(on.label ? { label: on.label } : {}), ...(on.atTurnEnd ? { atTurnEnd: true } : {}) };
  } else if ('near' in on) {
    const target = r.unitRef(on.near).act;
    trigger = { kind: 'near', char: target.type, uid: target.index, ...(on.by ? { by: r.charOf(on.by) } : {}), ...(on.playerPhase ? { playerPhase: true } : {}), ...(on.atTurnEnd ? { atTurnEnd: true } : {}) };
  } else if ('hp' in on) {
    const target = r.unitRef(on.hp).act;
    trigger = { kind: 'hp', char: target.type, uid: target.index, below: on.below };
  } else if ('did' in on) {
    if (!DID_ACTIONS.includes(on.action)) fail(`第 ${index} 个区块：did 的操作只能是 ${DID_ACTIONS.join(' / ')}`);
    const who = r.unitRef(on.did).act;
    trigger = { kind: 'did', char: who.type, uid: who.index, action: on.action };
  }
  else trigger = { kind: 'used', char: r.charOf(on.used), skills: on.skills?.map(r.skillRef), count: on.count };
  if (trigger.kind === 'near' || trigger.kind === 'hp' || trigger.kind === 'did' || (trigger.kind === 'area' && trigger.flagged) || (trigger.kind === 'turn' && trigger.flagged)) {
    // near / hp 的 if / unless【新】：触发时还要求标志设上 / 没设（攻破清风寨：秦明第一次劝不动，黄信伤重后再劝才降）
    const conds = flagConds(b, r);
    if (conds.length) cond = andAll(conds);
  }
  const ops: PasOp[] = [];
  const op = (code: number, value = 0, extra: Partial<PasOp> = {}) => ops.push({ op: code, flag: code < 24 ? 0 : null, value, ...extra });
  const select = (id: unknown) => op(12, 1000 + r.unitRef(id).act.group);
  for (const raw of b.do) {
    const step = [...raw];
    const lid = takeLineId(step);
    const before = ops.length;
    const [name, ...a] = step;
    switch (name) {
      case 'narrate':
        op(12, NARRATOR);
        op(13, 0, { text: String(a[0]) });
        break;
      case 'say':
        if (r.unitRef(a[0]).json.offstage) op(12, 1000 + r.unitRef(a[0]).act.group, { quiet: true });
        else select(a[0]);
        op(13, 0, { text: String(a[1]) });
        break;
      case 'appear':
        select(a[0]);
        break;
      case 'show':
        // ['show', 谁, 站在谁身边（可省）] 剧情临时出镜：已倒下或退场的人回到地图上说话，只放画面，不复活、不改胜负（战后对话用）
        ops.push({ op: 12, flag: 1, value: 1000 + r.unitRef(a[0]).act.group, quiet: true, actor: { action: 'show', ...(a[1] !== undefined ? { near: r.charOf(String(a[1])) } : {}) } });
        break;
      case 'hide':
        // ['hide', 谁] 收起 show 叫出来的人（只放画面）
        ops.push({ op: 12, flag: 1, value: 1000 + r.unitRef(a[0]).act.group, quiet: true, actor: { action: 'hide' } });
        break;
      case 'leave':
        // 退场（原版指令 17 动作位 2）：之后再 appear / say 点名时重新登场
        select(a[0]);
        op(17, 2);
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
      case 'flag':
        op(103, r.flagRef(a[0]));
        break;
      case 'borrowEquip':
      case 'setEquip':
        select(a[0]);
        ops.push({ op: name === 'borrowEquip' ? 107 : 100, flag: Number(a[1]), value: a[2] === 0 ? 0 : r.itemRef(a[2]) });
        break;
      case 'bind':
        select(a[0]);
        op(105);
        break;
      case 'cleanse':
        select(a[0]);
        op(106);
        break;
      case 'approach':
        // ['approach', 谁, 走到谁身边] 自动挑一格相邻的空格走过去（目标位置事先不知道时用）【新】
        select(a[0]);
        ops.push({ op: 116, flag: null, value: 0, args: { toward: r.unitRef(a[1]).act.group } });
        break;
      case 'capture':
        // 擒获：从敌军中移除、绑住并退场；不是归顺，也不复活或额外结算经验。
        select(a[0]);
        op(115, 1, { text: 'ally' });
        op(105);
        op(17, 2);
        break;
      case 'defect': {
        // ['defect', 谁, 'player' | 'ally' | 'enemy'] 换阵营（黄信归降）【新】
        const side = String(a[1] ?? 'ally');
        if (!['player', 'ally', 'enemy'].includes(side)) fail(`第 ${index} 个区块：defect 的阵营只能是 player / ally / enemy`);
        select(a[0]);
        op(115, 0, { text: side });
        break;
      }
      case 'buff': {
        select(a[0]);
        const o = (a[2] ?? {}) as { pct?: number; add?: number; turns?: number };
        ops.push({ op: 101, flag: null, value: 0, args: { stat: String(a[1]), pct: o.pct, add: o.add, turns: o.turns } });
        break;
      }
      // 剧情演出【新】（battle.ts 指令 108–113）
      case 'face': {
        // ['face', 谁, 朝向 0–3 或 另一个人的 id]
        select(a[0]);
        if (typeof a[1] === 'string') ops.push({ op: 108, flag: null, value: 0, args: { toward: r.unitRef(a[1]).act.group } });
        else ops.push({ op: 108, flag: null, value: Number(a[1]) & 3 });
        break;
      }
      case 'shoot': {
        // 剧情射箭，不结算伤害；目标可以是装饰物所在格或人物。
        select(a[0]);
        const target = typeof a[1] === 'string';
        if (!target && (!Number.isInteger(a[1]) || !Number.isInteger(a[2]) || Number(a[1]) < 0 || Number(a[2]) < 0)) fail(`第 ${index} 个区块：shoot 目标坐标必须是非负整数`);
        ops.push({ op: 117, flag: null, value: 0, text: String(a[target ? 2 : 3] ?? ''), args: target ? { toward: r.unitRef(a[1]).act.group } : { x: Number(a[1]), y: Number(a[2]) } });
        break;
      }
      case 'act': {
        // ['act', 谁, 'attack' | 'hurt' | 'defend', 朝向谁（可省）]
        const action = String(a[1] ?? 'attack');
        if (!['attack', 'hurt', 'defend'].includes(action)) fail(`第 ${index} 个区块：act 的动作只能是 attack / hurt / defend`);
        select(a[0]);
        ops.push({ op: 109, flag: null, value: 0, args: { action, ...(a[2] !== undefined ? { toward: r.unitRef(a[2]).act.group } : {}) } });
        break;
      }
      case 'tint':
        // ['tint', 'night' | 'dusk' | 'snow' | ''] 换天色，'' 恢复
        if (a[0] && !['night', 'dusk', 'snow'].includes(String(a[0]))) fail(`第 ${index} 个区块：tint 只能是 night / dusk / snow 或空`);
        op(110, 0, { text: String(a[0] ?? '') });
        break;
      case 'title':
        op(111, 0, { text: String(a[0]) });
        break;
      case 'focus': {
        // ['focus', x, y] 或 ['focus', 谁]
        if (typeof a[0] === 'string') {
          ops.push({ op: 112, flag: null, value: 0, args: { toward: r.unitRef(a[0]).act.group } });
        } else ops.push({ op: 112, flag: null, value: 0, args: { x: Number(a[0]), y: Number(a[1]) } });
        break;
      }
      case 'wait':
        op(113, Math.max(0, Math.min(5000, Number(a[0]) || 0)));
        break;
      case 'portrait':
        // ['portrait', 职业, 头像文件（包内路径，空 = 恢复职业自己的头像）] 本关之后的对白、面板换这张头像（如武松改扮行者）
        op(114, r.classRef(a[0]), { text: typeof a[1] === 'number' ? `@class:${a[1]}` : String(a[1] ?? '') });
        break;
      case 'choice': {
        // ['choice', 提示, [选项, 标志], ...] 剧情选项【新】：必须是区块最后一条，选完设标志，接着跑 { flag } 区块
        const options = a.slice(1).map((o) => {
          const oid = Array.isArray(o) ? takeLineId([...o]) : undefined;
          const opt = Array.isArray(o) && oid !== undefined ? o.slice(0, -1) : o;
          if (!Array.isArray(opt) || opt.length !== 2) fail(`第 ${index} 个区块：choice 的选项要写成 [文字, 标志]`);
          return { label: String(opt[0]), flag: r.flagRef(opt[1]), ...(oid !== undefined && r.tidBase ? { tid: `${r.tidBase}#${oid}` } : {}) };
        });
        if (options.length < 2 || options.length > 4) fail(`第 ${index} 个区块：choice 要有 2–4 个选项`);
        ops.push({ op: 120, flag: null, value: 0, text: String(a[0] ?? ''), args: { options } });
        break;
      }
      case 'standDown': {
        // ["standDown", 单位, {leave, reward, quiet, goldPct}]（参数可省，同原版关卡 121 的 args）【新】
        const o = (a[1] ?? {}) as { leave?: boolean; reward?: boolean; quiet?: boolean; goldPct?: number };
        if (typeof o !== 'object' || Array.isArray(o)) fail(`第 ${index} 个区块：standDown 的第二项要写成 {leave, reward, quiet, goldPct}`);
        const args = Object.fromEntries(Object.entries({ reward: o.reward, goldPct: o.goldPct, leave: o.leave, quiet: o.quiet }).filter(([, v]) => v));
        // 一起收手不飘字的：点名也别让已经离场的人回来
        op(12, 1000 + r.unitRef(a[0]).act.group, o.quiet ? { quiet: true } : {});
        op(121, 0, Object.keys(args).length ? { args } : {});
        break;
      }
      case 'fire': {
        // ['fire', [[x, y], ...], {panic, turns, spare, focus}] 放火（指令 124，同大破何涛）：这些格子冒火，离火最近的 panic 个敌人逃窜 turns 回合【新】
        const cells = Array.isArray(a[0]) ? (a[0] as unknown[]).map((c) => (Array.isArray(c) && c.length === 2 ? { x: Number(c[0]), y: Number(c[1]) } : fail(`第 ${index} 个区块：fire 的格子要写成 [x, y]`))) : fail(`第 ${index} 个区块：fire 要写格子列表`);
        const o = (a[1] ?? {}) as { panic?: number; turns?: number; spare?: unknown[]; focus?: boolean };
        ops.push({ op: 124, flag: null, value: 0, args: { cells, ...(o.panic ? { panic: o.panic } : {}), ...(o.turns ? { turns: o.turns } : {}), ...(o.spare ? { spare: o.spare.map(r.classRef) } : {}), ...(o.focus ? { focus: true } : {}) } });
        break;
      }
      case 'gust': {
        // ['gust', {style: dust|wind, radius, turns, panic, spare, x, y, focus}] 黑尘迷眼 / 怪风（指令 126）：中心（区域触发的区域中心，或 x, y）
        // radius 格内的敌人逃窜 turns 回合（同放火），画面冒黑尘或卷起怪风【新】（还道村受天书）
        const o = (a[0] ?? {}) as { style?: string; radius?: number; turns?: number; panic?: number; spare?: unknown[]; x?: number; y?: number; focus?: boolean };
        if (typeof o !== 'object' || Array.isArray(o)) fail(`第 ${index} 个区块：gust 要写成 ["gust", {style, radius, turns}]`);
        if (o.style && o.style !== 'dust' && o.style !== 'wind') fail(`第 ${index} 个区块：gust 的 style 只能是 dust / wind`);
        const args = Object.fromEntries(Object.entries({ style: o.style, radius: o.radius, turns: o.turns, panic: o.panic, spare: o.spare?.map(r.classRef), x: o.x, y: o.y, focus: o.focus || undefined }).filter(([, v]) => v !== undefined));
        ops.push({ op: 126, flag: null, value: 0, args });
        break;
      }
      case 'unseal': {
        // ['unseal', [[x, y], …]] 打开 map.seal 封死的格子（侯健骗开黄文炳家大门）（指令 127）【新】
        const cells = (a[0] as [number, number][] | undefined) ?? [];
        if (!Array.isArray(cells) || !cells.length) fail(`第 ${index} 个区块：unseal 要写成 ["unseal", [[x, y], …]]`);
        ops.push({ op: 127, flag: null, value: 0, args: { cells: cells.map(([x, y]) => ({ x, y })) } });
        break;
      }
      case 'stealthEnd':
        // ['stealthEnd'] 潜行结束：哨兵不再警戒，已经发现的也不再判负（智取无为军骗开大门以后）【新】
        op(125);
        break;
      case 'setAi':
        // ['setAi', 谁, 模式] 改 AI 模式（揭阳岭放哨的火家看见人才跑回店里）【新】
        select(a[0]);
        op(122, Number(a[1]));
        break;
      default:
        fail(`第 ${index} 个区块：不认识的指令 ${name}`);
    }
    // 多语言编号挂在这一步生成的文字指令上
    if (lid !== undefined && r.tidBase) {
      const t = ops.slice(before).find((o) => o.text !== undefined && o.op !== 21 && o.op !== 110 && o.op !== 114);
      if (t) t.tid = `${r.tidBase}#${lid}`;
    }
  }
  const ci = ops.findIndex((o) => o.op === 120);
  if (ci >= 0 && ci !== ops.length - 1) fail(`第 ${index} 个区块：choice 必须是区块最后一条指令`);
  return { index, head: [], trigger, cond, ops };
}
