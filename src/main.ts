import './platform/buffer-shim.ts';
import Phaser from 'phaser';
import { GameFiles, REPO_GAMEDATA, pruneOldCache, webLoader, type Progress } from './platform/gamefiles.ts';
import { GAMEDATA_JSON } from './platform/gamedata-json.ts';
import { idbClear } from './platform/idb.ts';
import { BUILD, applyUpdate, checkForUpdate, versionLabel } from './platform/update.ts';
import { frameToCanvas, loadAssets, preloadStage, startupImages, type Assets } from './game/assets.ts';
import { PRISON_CART_TILES } from './game/prison-cart.ts';
import { BattleScene } from './game/BattleScene.ts';
import { installSound } from './game/sound.ts';
import { installTouchGuards } from './game/touch.ts';
import { installMusic, music, type Playlist } from './game/music.ts';
import { BattleUI } from './game/ui.ts';
import { initI18n } from './game/i18n-dom.ts';
import { setHero } from './i18n/index.ts';
import { TownUI } from './game/town.ts';
import { TitleScreen, type TitleOptions, type TitleStageItem } from './game/title.ts';
import { stageLabel, townName } from './game/stage-names.ts';
import { CHAPTERS, chapterLabel, insertPlaces, isInsertKey, validateChapters } from './rules/chapters.ts';
import { stageJson, stageMapName } from './rules/load.ts';
import { jumpTo, jumpToTown, townRoster } from './rules/preset.ts';
import type { Battle } from './rules/battle.ts';
import { packParty, townParty, saveTownParty, recordPackResult } from './packs/campaign.ts';
import { insertTownName, prepareInsertTown, insertTownIntro } from './packs/towns.ts';
import { insertTavern } from './packs/tavern.ts';
import { compileStage, stageClasses } from './packs/build.ts';
import { isPackValue, listPacks, markPackCleared, openPack, packCleared, packFaceUrl, packStageName, parsePackValue, type PackAssets } from './game/packs.ts';
import { inheritAssets, newCampaign, nextByHeader, nextStages, joinLevel, parseCampaign, partyOf, pendingInsert, replayInsertProgress, recordResult, type CampaignState, type InsertEntry } from './rules/campaign.ts';

GameFiles.bundledJson = GAMEDATA_JSON;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setupEl = $('setup');
const msg = $('setup-msg');
const bar = $('setup-bar');
const progress: Progress = (m, r) => {
  msg.textContent = m;
  if (r !== undefined) bar.style.width = `${Math.round(r * 100)}%`;
};

/** 图像来源：开发模式读开发服务器上的 gamedata/（不缓存，改了图马上能看到），网页版从仓库下载并缓存 */
function gameFiles(): GameFiles {
  return new GameFiles(import.meta.env.DEV ? webLoader('/gamedata/', false) : webLoader(REPO_GAMEDATA));
}

const SAVE_KEY = 'shuihu.campaign';
/** 存档时间（标题画面显示用） */
const SAVE_AT_KEY = 'shuihu.campaign.at';
function loadSave(): CampaignState | null {
  try {
    return parseCampaign(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
/** 主菜单「清空存档」：主线存档、存档时间和外传进度（shuihu.pack.*）；音量等设置不动 */
function clearSaves() {
  try {
    for (const k of Object.keys(localStorage)) if (k === SAVE_KEY || k === SAVE_AT_KEY || k.startsWith('shuihu.pack.')) localStorage.removeItem(k);
  } catch {
    /* 隐私模式等：本来就没有存档 */
  }
}
function writeSave(c: CampaignState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(c));
    localStorage.setItem(SAVE_AT_KEY, String(Date.now()));
  } catch {
    /* 隐私模式等：不存档也能玩 */
  }
}

function startGame(assets: Assets) {
  const stages = assets.exe.stages.filter((s) => s.mapName && stageJson(assets.files, s.mapName));
  const stageBtn = $<HTMLButtonElement>('stage');
  /** 过关后进城的关卡：关卡号 → 城镇号与城镇之后的下一关（剧本头 +9 / +11） */
  const towns = new Map<number, { town: number; next: number }>();
  for (const s of stages) {
    const h = stageJson(assets.files, s.mapName)?.header;
    if (h?.town && stages.some((x) => x.index === h.next)) towns.set(s.index, { town: h.town, next: h.next });
  }
  const townValue = (i: number) => `town:${i}`;
  /** 主线插关与续篇（docs/game-design.md §15.8、§15.10）：位置和先后都按章节表（src/rules/chapters.ts） */
  // kind：有真正要打的敌人（不是 ai 8 演员）叫「战役」，纯剧情过场叫「剧情」（元宵看灯、掷盏为号里的敌人只是演员）（和原版关一样；插关不占原版的战役编号）
  const packStages = new Map(
    listPacks()
      .filter((e) => e.pack.entry === 'mainline')
      .flatMap((e) => e.stages.filter((s) => !s.sideStory).map((s) => [`${e.pack.id}/${s.id}`.toLowerCase(), s] as const)),
  );
  const chapterErrors = validateChapters(stages.map((s) => s.mapName), [...packStages.keys()]);
  if (chapterErrors.length) console.warn(`章节表（src/rules/chapters.ts）有问题：\n${chapterErrors.join('\n')}`);
  const inserts: (InsertEntry & { pov: boolean; title: string; kind: string; townAfter?: number })[] = insertPlaces().flatMap((p) => {
    const s = packStages.get(p.ref.toLowerCase());
    return s ? [{ ...p, pov: !!s.pov, title: s.title, townAfter: s.townAfter, kind: s.units.some((u) => u.side === 'enemy' && u.ai !== 8) ? '战役' : '剧情' }] : [];
  });
  const insValue = (ref: string) => `ins:${ref}`;
  /** 续篇城镇（townAfter）之后接哪一段：章节表里紧跟它的插关 */
  const insertAfter = (ref: string) => inserts[inserts.findIndex((x) => x.ref === ref) + 1]?.ref;
  /** 续篇城镇在选关列表里的值：打完就进这个城镇的那一段 */
  const insertTownOf = (next: string) => {
    const i = inserts.findIndex((x) => x.ref === next);
    return i > 0 && inserts[i - 1].townAfter ? `itown:${inserts[i - 1].ref}` : undefined;
  };
  // 按章节表分组：组名"第N章 章名"，组内"战役一 关名""剧情 关名""城镇 地名"（顶栏选关和标题画面的选关共用）
  const chapters: { label: string; items: TitleStageItem[] }[] = [];
  /** 插关所在的章 */
  const insChapter = new Map<string, string>();
  const stageByMap = new Map(stages.map((s) => [s.mapName.toLowerCase(), s]));
  CHAPTERS.forEach((ch, i) => {
    const chLabel = chapterLabel(i + 1);
    const items: TitleStageItem[] = [];
    for (const key of ch.stages) {
      if (isInsertKey(key)) {
        const e = inserts.find((x) => x.ref.toLowerCase() === key.toLowerCase());
        if (!e) continue;
        insChapter.set(e.ref, chLabel);
        items.push({ label: `${e.kind} ${e.title}`, value: insValue(e.ref), title: `${chLabel} ${e.kind} · ${e.title}${e.pov ? '（视角关）' : ''}` });
        if (e.townAfter) {
          const name = insertTownName(insertAfter(e.ref) ?? '');
          items.push({ label: `城镇 ${name}`, value: `itown:${e.ref}`, title: `${chLabel} 城镇 ${name}` });
        }
        continue;
      }
      const s = stageByMap.get(key.toLowerCase());
      if (!s) continue;
      const l = stageLabel(s.title, s.mapName);
      items.push({ label: l.short, value: String(s.index), title: l.full, stars: stageJson(assets.files, s.mapName)?.edited });
      // 每个城镇也能直接进（列在进城前那一关后面）
      const t = towns.get(s.index);
      if (t) items.push({ label: `城镇 ${townName(t.town)}`, value: townValue(s.index), title: `${chLabel} 城镇 ${townName(t.town)}` });
    }
    if (items.length) chapters.push({ label: chLabel, items });
  });
  // 不在章节表里的原版关卡（表写漏了）排在最后，免得进不去
  const listed = new Set(CHAPTERS.flatMap((c) => c.stages.map((k) => k.toLowerCase())));
  const stray = stages.filter((s) => !listed.has(s.mapName.toLowerCase()));
  if (stray.length) chapters.push({ label: '其它', items: stray.map((s) => ({ label: stageLabel(s.title, s.mapName).short, value: String(s.index), title: s.mapName })) });
  // 最后一组：外传（扩展包，已通关的打勾；一个包有几关时写成「包名·关名」）。顶栏下拉框和标题画面的选关共用
  const sideItems = (): TitleStageItem[] =>
    listPacks().flatMap(({ pack: p, stages: ss }) =>
      p.entry !== 'mainline'
        ? ss.map((s) => ({ label: `${ss.length > 1 ? `${p.name}·${s.title}` : p.name}${packCleared(p.id).includes(s.id) ? ' ✓' : ''}`, value: packStageName(p.id, s.id), title: p.description }))
        : // 主线包里的独立外传（sideStory，如蹴鞠）
          ss.filter((s) => s.sideStory).map((s) => ({ label: `${s.title}${packCleared(p.id).includes(s.id) ? ' ✓' : ''}`, value: packStageName(p.id, s.id), title: s.title })),
    );
  const stageGroups = () => {
    const side = sideItems();
    return side.length ? [...chapters, { label: '外传（独立进度，等级固定）', items: side }] : chapters;
  };
  /** 选关列表里的值 → 显示名（顶栏选关按钮上显示正在玩的这一项） */
  const itemLabel = (value: string) => stageGroups().flatMap((g) => g.items).find((x) => x.value === value)?.label;
  /** 正在玩的那一项（选关列表里高亮） */
  let here = '';
  const setHere = (value: string) => {
    here = value;
    stageBtn.hidden = false;
    stageBtn.textContent = `${itemLabel(value)?.replace(/ ✓$/, '') ?? '选关'} ▾`;
  };
  const params = new URLSearchParams(location.search);
  let campaign = loadSave() ?? newCampaign(stages[0].index);
  /** 测试用跳关：人物按那一关的难度补上等级和装备（原版没有）；town:<关卡> 表示那一关之后的城镇 */
  const jump = (value: string, c: CampaignState): CampaignState => {
    // 主线插关 / 续篇：按它关联的原版关卡配主线人物，再把插关排在最前
    if (value.startsWith('itown:')) {
      const ref = value.slice(6), e = inserts.find(x=>x.ref===ref);
      if (e?.townAfter) return { ...c, inserts: replayInsertProgress(c, inserts, insertAfter(ref) ?? ''), finished: undefined, town: undefined, insert: undefined, insertTown: { pack: ref.split('/')[0], next: insertAfter(ref) ?? '', town: e.townAfter, seen: false } };
    }
    if (value.startsWith('ins:')) {
      const e = inserts.find((x) => x.ref === value.slice(4));
      const anchor = e?.before ?? e?.after;
      const s = anchor && stages.find((x) => x.mapName.toLowerCase() === anchor.toLowerCase());
      if (e && s) {
        const done = replayInsertProgress(c, inserts, e.ref);
        return { ...(c.members.length || Object.keys(c.companions ?? {}).length ? { ...c, stage: s.index, town: undefined, insertTown: undefined } : jumpTo(assets.files, assets.data, stages, s.index, c)), insert: e.ref, insertPreset: c.members.length || Object.keys(c.companions ?? {}).length ? undefined : e.ref, inserts: done, finished: undefined };
      }
    }
    const t = /^town:/.test(value) ? towns.get(Number(value.slice(5))) : undefined;
    if (t) return { ...inheritAssets(c, jumpToTown(assets.files, assets.data, stages, Number(value.slice(5)), t.town, t.next, c)), insert: undefined, finished: undefined };
    return { ...inheritAssets(c, jumpTo(assets.files, assets.data, stages, Number(value), c)), insert: undefined, town: undefined, finished: undefined };
  };
  const asked = params.get('stage')?.toLowerCase();
  if (asked?.startsWith('itown:')) {
    if (!campaign.insertTown || insertTownOf(campaign.insertTown.next) !== asked) campaign = jump(asked,campaign);
  } else if (asked?.startsWith('ins:')) {
    if (campaign.insert !== asked.slice(4)) campaign = jump(asked, campaign);
  } else if (asked) {
    const inTown = asked.startsWith('town:');
    const key = inTown ? asked.slice(5) : asked;
    const s = stages.find((x) => x.mapName.toLowerCase() === key || String(x.index) === key);
    if (s && inTown && towns.has(s.index)) {
      if (campaign.stage !== s.index || !campaign.town) campaign = jump(townValue(s.index), campaign);
    } else if (s && (s.index !== campaign.stage || campaign.town)) campaign = jump(String(s.index), campaign);
  }
  if (!stages.some((s) => s.index === campaign.stage)) campaign = newCampaign(stages[0].index);
  // 已通关的旧存档也能接上后来新增、尚未游玩的终章续篇。
  if (!asked && campaign.finished) {
    const continuation = pendingInsert(campaign, inserts, stages.find((s) => s.index === campaign.stage)!.mapName, 'after');
    // 接下来那一段前面是续篇城镇（如狮子楼之后的阳谷整备），且城镇前那一段已经打过：先进城镇
    const prev = continuation ? inserts[inserts.findIndex((x) => x.ref === continuation) - 1] : undefined;
    if (continuation) campaign = prev?.townAfter && campaign.inserts?.includes(prev.ref)
      ? { ...campaign, finished: false, insert: undefined, insertTown: { pack: prev.ref.split('/')[0], next: continuation, town: prev.townAfter, seen: false } }
      : { ...campaign, finished: false, insert: continuation };
  }
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const ui = new BattleUI();
  ui.tr = assets.tr;
  if (assets.data.heroNickname) ui.extraNicknames = { [assets.data.heroName]: assets.data.heroNickname };
  const faces = new Map<number, string | null>();
  const headUrl = (i: number) => {
    if (!faces.has(i)) faces.set(i, i >= 0 && i < assets.heads.count ? frameToCanvas(assets.heads.frame(i), assets.palette).toDataURL() : null);
    return faces.get(i)!;
  };
  /** 正在玩的扩展包（外传）；它的职业接在原版职业后面，头像按包里写的借哪张 */
  let pack: PackAssets | null = null;
  ui.portrait = (cls) => {
    const over = ui.faceOverride.get(cls);
    if (over) return over;
    const look = pack?.rt.looks.get(cls);
    if (look) return look.face === null ? null : typeof look.face === 'string' ? (packFaceUrl(pack!.rt.id, look.face) ?? null) : headUrl(look.face);
    return headUrl(cls);
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#14110d',
    pixelArt: true,
    // 低帧率或刚切回页面时，默认 delta 平滑会把实际帧间隔压回 16.7ms，
    // 防御特效、回合横幅的计时随之变慢，看起来像操作卡住。按实际时间播放。
    fps: { smoothStep: false },
    // 不用 Phaser 的声音系统（音效 / 音乐在 sound.ts / music.ts）：免得它再开一个 AudioContext，失焦时去挂起它
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  const scene = () => game.scene.getScene('battle') as BattleScene | null;
  // 开发模式下给 Playwright 截图脚本用
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game; __ui: BattleUI }).__game = game, ((window as unknown as { __ui: BattleUI }).__ui = ui);
  const stageOf = (i: number) => stages.find((s) => s.index === i)!;
  const label = (s: (typeof stages)[number]) => stageLabel(s.title, s.mapName).full;
  const isAct = (s: (typeof stages)[number]) => /^act/i.test(s.mapName) && s.mapName.toLowerCase() !== 'act5-2';
  // 没有剧本头的关卡才用关卡表顺序推断下一关（campaign.ts nextStages）
  const speakerOf = (cls: number) => assets.data.classes[cls]?.name ?? '';
  /** 原版的二选一对话框：问题 + 两个按钮，选后由主角说对应的台词（EXE 0x443988 / 0x4439b2） */
  const ask = async (idx: number): Promise<number> => {
    const p = assets.data.prompts?.[idx];
    if (!p) return 0;
    const k = await new Promise<number>((r) =>
      ui.result(true, `${speakerOf(p.speaker)}：${p.question}`, p.options.map((label, i) => ({ label, run: () => r(i) })), '分路'),
    );
    ui.hideResult();
    const reply = p.replies[k];
    await ui.say(speakerOf(reply.speaker), reply.text, reply.speaker);
    return k;
  };

  const goTo = (c: CampaignState) => {
    campaign = c;
    writeSave(c);
    run();
  };
  /** 过关后去哪：剧本头 +9 城镇号、+11 下一关（城镇 2、5 离开时还要问分路）；没有剧本头时按关卡表顺序 */
  const nextOf = (cur: (typeof stages)[number]) => {
    const h = stageJson(assets.files, cur.mapName)?.header;
    if (!h) return { town: 0, next: nextStages(stages, cur.index).slice(0, 1) };
    const n = nextByHeader(h);
    return { town: h.town, route: n.route, next: stages.filter((s) => s.index === n.next) };
  };
  const go = async (c: CampaignState) => {
    const { next, route } = nextOf(stageOf(c.stage));
    // 城镇 2、5：离开时问走大道还是小径，小径进写死的另一关
    const k = route ? await ask(route.prompt) : 0;
    const stage = k === 1 && route ? route.alt : next[0].index;
    // 下一关前面有还没打过的主线插关：先打插关
    goTo({ ...c, town: undefined, stage, insert: pendingInsert(c, inserts, stageOf(stage).mapName) });
  };
  // 酒店说书借用战斗的对白框和选项面板（src/rules/storyteller.ts）
  const town = new TownUI(assets, (cls) => ui.portrait(cls), {
    say: (who, text, cls) => ui.say(who, text, cls),
    choose: (title, text, options) =>
      new Promise<number>((r) => ui.result(true, text, options.map((o, i) => ({ ...o, run: () => r(i) })), title)),
    done: () => {
      ui.hideResult();
      ui.endSkip();
    },
  });
  const openTown = (c: CampaignState, t: number, leave: (c: CampaignState) => void) => {
    town.setAssets(assets);
    town.show(c, {
      town: t,
      title: t ? `城镇 · ${townName(t)}` : '整备',
      onChange: (x) => {
        campaign = x;
        if (t) writeSave(x); // 城镇里随时存档（读档回到城镇）；单独整备等进了下一关再存
      },
      onLeave: leave,
    });
  };
  /** 进城镇：整备名单换成城镇之后那一关开局在场的人（docs/game-design.md §7.5.1；旧存档读进城镇时也改过来） */
  const enterTown = (c: CampaignState) => {
    const n = nextOf(stageOf(c.stage)).next[0];
    if (n) c = { ...c, active: townRoster(assets.files, n.mapName) };
    campaign = c;
    openTown(c, c.town!, (x) => void go(x));
  };
  /** 战役结算：继续下一关，或先整备 */
  const proceed = (c: CampaignState, text: string) => {
    const { next } = nextOf(stageOf(c.stage));
    ui.result(true, text, [
      { label: `继续：${label(next[0])}`, run: () => void go(c) },
      { label: '整备（装备、道具）', run: () => openTown(c, 0, (x) => proceed(x, text)) },
      { label: '再打一次本关', run },
    ]);
  };
  const onEnd = async (battle: Battle, won: boolean, text: string) => {
    const before = campaign;
    const cur = stageOf(campaign.stage);
    const retry = { label: '重新开始本关', run };
    if (!won) {
      void music.play('defeat');
      // 失败后也能时光倒流重试【新】
      const t = battle.rewindTarget();
      return ui.result(false, text, t === null ? [retry] : [{ label: `时光倒流（回到第 ${t} 回合）`, run: rewind }, retry]);
    }
    const after = recordResult(campaign, battle);
    const { town: t, next } = nextOf(cur);
    // 新人入伙（这一关打完队里多了人，第一关不算）：插播短曲
    const had = new Set(before.members.map((m) => m.classId));
    if (had.size && after.members.some((m) => !had.has(m.classId))) void music.sting('join');
    if (!next.length) {
      const continuation = pendingInsert(after, inserts, cur.mapName, 'after');
      if (continuation) return goTo({ ...after, town: undefined, insert: continuation });
      // 通关：片尾放一遍，再接聚义曲
      void music.play(['ending', 'liangshan']);
      campaign = { ...after, finished: true };
      writeSave(campaign);
      const replay = () => {
        campaign = before;
        writeSave(before);
        run();
      };
      return ui.result(true, text, [{ label: '回到标题', run: () => (location.href = location.pathname) }, { label: '重新开始本关', run: replay }], '通关');
    }
    // 结算画面放胜利曲；剧情关直接接下一关，不换
    if (!isAct(cur)) void music.play('victory');
    if (t) {
      // 过关进城（存档也记下城镇号，刷新回到城镇）
      const c = { ...after, town: t };
      campaign = c;
      writeSave(c);
      if (isAct(cur)) return enterTown(c);
      const replay = () => {
        campaign = before;
        writeSave(before);
        run();
      };
      return ui.result(true, text, [{ label: '进入城镇', run: () => enterTown(c) }, { label: '再打一次本关', run: replay }]);
    }
    // 过场关卡直接接下一关
    if (isAct(cur)) return go(after);
    proceed(after, text);
  };
  /** 时光倒流；从失败画面倒流时把失败曲换回本关的曲子 */
  const rewind = async () => {
    const sc = scene();
    if (!sc || sc.battle.rewindTarget() === null) return;
    if (sc.battle.status === 'lost') {
      if (packBgm) void music.play(packBgm);
      else void music.stageTrack(stageOf(campaign.stage).mapName).then((t) => music.play(t));
    }
    await sc.rewind();
  };
  let loading = 0;
  /** 外传关卡的背景音乐（倒流回来时换回）；玩主线时为 null */
  let packBgm: Playlist = null;
  /** 上次插播「开章」短曲的章 / 外传（重打同一章不再放） */
  let stungChapter = '';
  const chapterSting = (key: string) => {
    if (key === stungChapter) return;
    stungChapter = key;
    void music.sting('chapter');
  };
  /** 外传（扩展包关卡，docs/game-design.md §15）：等级固定，不读写主线存档 */
  const runPack = async (value: string) => {
    const ref = parsePackValue(value);
    if (!ref) return;
    ui.hideResult();
    town.hide();
    const ticket = ++loading;
    try {
      setupEl.hidden = false;
      progress('载入外传…', 0);
      setHere(value);
      if (pack?.rt.id !== ref.pack) pack = await openPack(assets, ref.pack);
      const rt = pack.rt;
      const stage = rt.stages.find((s) => s.id === ref.stage);
      if (!stage) throw new Error(`外传里没有关卡 ${ref.stage}`);
      const pa: Assets = { ...assets, data: rt.data, pack };
      const classes = stageClasses(rt, stage);
      await preloadStage(pa, stageMapName(stage.map), progress, classes, stage.units.some((u) => u.prisonCart) ? PRISON_CART_TILES : []);
      if (ticket !== loading) return;
      setupEl.hidden = true;
      packBgm = stage.bgm ?? ['battle', 'rock'];
      void music.play(packBgm);
      chapterSting(`pack:${rt.id}`);
      const data = {
        assets: pa, stage: packStageName(rt.id, stage.id), map: stageMapName(stage.map), tint: stage.tint, ui, seed,
        makeInput: () => compileStage(rt, stage, assets.files, { seed, text: assets.tr }),
        onEnd: (b: Battle, won: boolean, text: string) => onPackEnd(value, b, won, text),
      };
      if (scene()) scene()!.scene.restart(data);
      else game.scene.add('battle', BattleScene, true, data);
      const u = new URL(location.href);
      u.searchParams.set('stage', value);
      history.replaceState(null, '', u);
    } catch (e) {
      setupEl.hidden = false;
      progress(`载入外传失败：${(e as Error).message}`, 0);
    }
  };
  const onPackEnd = (value: string, battle: Battle, won: boolean, text: string) => {
    const retry = { label: '重新开始本关', run: () => void runPack(value) };
    if (!won) {
      void music.play('defeat');
      const t = battle.rewindTarget();
      return ui.result(false, text, t === null ? [retry] : [{ label: `时光倒流（回到第 ${t} 回合）`, run: rewind }, retry]);
    }
    const ref = parsePackValue(value)!;
    markPackCleared(ref.pack, ref.stage);
    void music.play('victory');
    const credits = pack?.rt.credits.length ? `\n\n素材：${pack.rt.credits.join('；')}` : '';
    const next = pack?.rt.stages.find((s) => s.id === ref.stage)?.next;
    const buttons = [{ label: '再打一次', run: () => void runPack(value) }, { label: '回到标题', run: () => (location.href = location.pathname) }];
    if (next) buttons.unshift({ label: '下一关', run: () => void runPack(packStageName(ref.pack, next)) });
    ui.result(true, text + credits, buttons, '外传通关');
  };
  /** 主线插关（docs/game-design.md §15.8）：打完回到主线，接着进 campaign.stage 那一关 */
  const runInsert = async (ref: string) => {
    const [packId, stageId] = ref.split('/');
    const e = inserts.find((x) => x.ref === ref);
    ui.hideResult();
    town.hide();
    setHere(insValue(ref));
    // 主线插关也按所在的章放开章短曲（续篇另开的新章，如第十六章）
    chapterSting(insChapter.get(ref) ?? '');
    const ticket = ++loading;
    try {
      setupEl.hidden = false;
      progress('载入关卡…', 0);
      if (pack?.rt.id !== packId) pack = await openPack(assets, packId);
      const rt = pack.rt;
      const stage = rt.stages.find((s) => s.id === stageId);
      if (!stage || !e) throw new Error(`没有插关 ${ref}`);
      const pa: Assets = { ...assets, data: rt.data, pack };
      await preloadStage(pa, stageMapName(stage.map), progress, stageClasses(rt, stage), stage.units.some((u) => u.prisonCart) ? PRISON_CART_TILES : []);
      if (ticket !== loading) return;
      setupEl.hidden = true;
      packBgm = stage.bgm ?? ['battle', 'rock'];
      void music.play(packBgm);
      // 故事视角不隔离资产；所有主线好汉沿用实际存档。
      const party = packParty(campaign, rt);
      const join = joinLevel({ ...campaign, members: [...party.values()] });
      const data = {
        assets: pa, stage: packStageName(rt.id, stage.id), map: stageMapName(stage.map), tint: stage.tint, ui, seed,
        makeInput: () => ({ ...compileStage(rt, stage, assets.files, { seed, text: assets.tr, party, joinLevel: join, preset: campaign.insertPreset === ref }) }),
        onEnd: (b: Battle, won: boolean, text: string) => onInsertEnd(ref, e.pov, b, won, text),
      };
      if (scene()) scene()!.scene.restart(data);
      else game.scene.add('battle', BattleScene, true, data);
      const u = new URL(location.href);
      u.searchParams.set('stage', insValue(ref));
      history.replaceState(null, '', u);
    } catch (err) {
      setupEl.hidden = false;
      progress(`载入关卡失败：${(err as Error).message}`, 0);
    }
  };
  const onInsertEnd = (ref: string, _pov: boolean, battle: Battle, won: boolean, text: string) => {
    const before = campaign;
    if (!won) {
      void music.play('defeat');
      const t = battle.rewindTarget();
      const retry = { label: '重新开始本关', run };
      return ui.result(false, text, t === null ? [retry] : [{ label: `时光倒流（回到第 ${t} 回合）`, run: rewind }, retry]);
    }
    void music.play('victory');
    // 主线所有插关连续读写资产；包角色用稳定身份保存，不混入原版职业号。
    const after = recordPackResult(campaign, battle, pack!.rt);
    const entry = inserts.find((x) => x.ref === ref);
    let c: CampaignState = { ...after, insert: undefined, insertPreset: undefined, inserts: [...new Set([...(after.inserts ?? []), ref])] };
    // 同一位置可能有多段（终章后的续篇、Act10-1 前的赤发鬼 → 三阮）；按登记顺序接完，终章续篇最后一段才标记通关。
    const continuation = entry?.after
      ? pendingInsert(c, inserts, entry.after, 'after', ref)
      : entry?.before
        ? pendingInsert(c, inserts, entry.before, 'before', ref)
        : undefined;
    if (entry?.after) c = { ...c, finished: !continuation, insert: continuation };
    else c = { ...c, insert: continuation };
    if (entry?.townAfter && continuation) c = { ...c, insert: undefined, insertTown: { pack: ref.split('/')[0], next: continuation, town: entry.townAfter, seen: false }, finished: undefined };
    campaign = c;
    writeSave(c);
    const replay = () => {
      campaign = before;
      writeSave(before);
      run();
    };
    if (c.insertTown) return ui.result(true, text, [{ label: '进入城镇', run: () => goTo(c) }, { label: '再打一次本关', run: replay }]);
    if (entry?.after) {
      if (continuation) {
        const title = inserts.find((x) => x.ref === continuation)?.title ?? '下一关';
        return ui.result(true, text, [
          { label: `继续：${title}`, run: () => goTo({ ...c, insert: continuation }) },
          { label: '再看一次本段', run: replay },
        ]);
      }
      void music.play(['ending', 'liangshan']);
      const u = new URL(location.href);
      u.searchParams.delete('stage');
      history.replaceState(null, '', u);
      // 续篇用到的包素材（武松、老虎的模型）要署名
      const credits = pack?.rt.credits.length ? `\n\n素材：${pack.rt.credits.join('；')}` : '';
      return ui.result(true, text + credits, [{ label: '回到标题', run: () => (location.href = location.pathname) }, { label: '再看一次本段', run: replay }], '通关');
    }
    const nextTitle = continuation ? inserts.find((x) => x.ref === continuation)?.title : undefined;
    const cont = { label: `继续：${nextTitle ?? label(stageOf(c.stage))}`, run: () => goTo(c) };
    ui.result(true, text, [cont, { label: '整备（装备、道具）', run: () => openTown(c, 0, (x) => goTo(x)) }, { label: '再打一次本关', run: replay }]);
  };
  const runInsertTown = async () => {
    scene()?.scene.pause();
    const stop = campaign.insertTown!;
    const ticket = ++loading;
    if (pack?.rt.id !== stop.pack) pack = await openPack(assets, stop.pack);
    if (ticket !== loading) return;
    const rt = pack.rt, pa: Assets = { ...assets, data: rt.data, items: rt.data.items, pack };
    const view = prepareInsertTown(campaign, rt, stop.next);
    const ids = view.active!;
    campaign = saveTownParty(view, rt);
    writeSave(campaign);
    const spot = insertTownOf(stop.next) ?? 'itown:mainline/shizilou';
    setHere(spot);
    const u = new URL(location.href); u.searchParams.set('stage', spot); history.replaceState(null,'',u);
    if (!stop.seen) {
      for (const line of insertTownIntro(stop.next)) {
        const actor = rt.classIds.get(line.actor)!;
        await ui.say(rt.data.classes[actor].name, line.text, actor);
        if (ticket !== loading) return;
      }
      ui.endSkip();
      campaign = { ...campaign, insertTown: { ...stop, seen: true } };
      writeSave(campaign);
    }
    town.setAssets(pa);
    town.show({ ...townParty(campaign,rt), active: ids }, {
      town: stop.town, title: `城镇 · ${insertTownName(stop.next)}`, ...insertTavern(rt, stop.next),
      leaveLabel: `出发：${rt.stages.find(s => `${rt.id}/${s.id}` === stop.next)?.title ?? '下一关'} ▸`,
      onChange: x => { campaign = saveTownParty(x, rt); writeSave(campaign); },
      onLeave: x => { const saved = saveTownParty(x, rt); goTo({ ...saved, insertTown: undefined, insert: stop.next, finished: undefined }); },
    });
    setupEl.hidden = true;
  };
  const run = async () => {
    packBgm = null;
    ui.hideResult();
    town.hide();
    if (campaign.insertTown) return runInsertTown();
    if (campaign.finished) {
      void music.play(['ending', 'liangshan']);
      return ui.result(true, '梁山聚义，故事未完待续。', [{ label: '回到标题', run: () => (location.href = location.pathname) }], '通关');
    }
    if (campaign.insert) return runInsert(campaign.insert);
    if (campaign.town) {
      // 存档停在城镇里
      setHere(towns.has(campaign.stage) ? townValue(campaign.stage) : String(campaign.stage));
      const u = new URL(location.href);
      u.searchParams.set('stage', `town:${stageOf(campaign.stage).mapName}`);
      history.replaceState(null, '', u);
      return enterTown(campaign);
    }
    setHere(String(campaign.stage));
    const stage = stageOf(campaign.stage).mapName;
    // 网页版：先下载本关要用的人物、特效和图块（已缓存的不再下载）
    const ticket = ++loading;
    try {
      await preloadStage(assets, stage, (m, r) => {
        setupEl.hidden = false;
        progress(m, r);
      });
    } catch (e) {
      setupEl.hidden = false;
      progress(`下载本关素材失败：${(e as Error).message}。请检查网络后刷新页面。`, 0);
      return;
    }
    if (ticket !== loading) return; // 下载期间又换了关
    setupEl.hidden = true;
    void music.stageTrack(stage).then((t) => music.play(t));
    chapterSting(stageLabel(stageOf(campaign.stage).title, stage).chapterLabel);
    const data = { assets, stage, ui, seed, party: partyOf(campaign), joinLevel: joinLevel(campaign), onEnd };
    if (scene()) scene()!.scene.restart(data);
    else game.scene.add('battle', BattleScene, true, data);
    const u = new URL(location.href);
    u.searchParams.set('stage', stage);
    history.replaceState(null, '', u);
  };
  // 顶栏的选关按钮打开的就是标题画面的选关页（同一份列表、同一种进入方式），返回则回到游戏
  stageBtn.onclick = () => title.show(titleOptions(here), 'stages');
  $('zoom-in').onclick = () => scene()?.zoomBy(1.25);
  $('zoom-out').onclick = () => scene()?.zoomBy(1 / 1.25);
  $('end-turn').onclick = () => scene()?.endTurn();
  $('rewind').onclick = () => void rewind();
  $('objective-btn').onclick = () => {
    const b = scene()?.battle;
    if (b && !ui.inDialog) ui.say('', b.objectives.join('\n') || '（本关没有写明的胜负条件）');
  };
  $('menu').onclick = () =>
    toast('回到标题画面？本关的进度会丢失（存档记在关卡开头，读取存档会从本关开头重来）。', [
      { label: '回到标题', primary: true, run: () => (location.href = location.pathname) },
      { label: '取消', run: hideToast },
    ]);
  $('reset').onclick = () =>
    toast('清除浏览器里缓存的图像？下次进关时会重新下载。', [
      { label: '清除', primary: true, run: async () => { await idbClear(); location.reload(); } },
      { label: '取消', run: hideToast },
    ]);
  setupUpdateButton();
  // 顶栏在窄屏上会折行，小地图跟着顶栏的实际高度往下放
  const hudH = () => document.documentElement.style.setProperty('--hud-h', `${$('hud').getBoundingClientRect().height}px`);
  new ResizeObserver(hudH).observe($('hud'));
  (window as unknown as { __game: Phaser.Game }).__game = game; // 调试与截图脚本用
  /** 离开标题画面（或顶栏打开的选关页）进游戏 */
  const leaveTitle = () => {
    title.hide();
    $('hud').hidden = false;
    hudH();
    ui.show();
  };
  const begin = (c: CampaignState) => {
    leaveTitle();
    goTo(c);
  };
  /**
   * 选关列表里选了一项：标题画面和游戏里顶栏的选关都走这里。
   * 主线关 / 插关 / 城镇：按那一关的难度重新配等级和装备，覆盖主线存档；外传：等级固定，不碰主线存档。
   */
  const enter = (value: string) => {
    if (isPackValue(value)) {
      leaveTitle();
      return void runPack(value);
    }
    begin(jump(value, campaign));
  };
  const title = new TitleScreen();
  // 网址带 ?stage=（刷新、测试脚本）时直接进关，不经过标题画面
  if (asked && isPackValue(asked)) return enter(asked);
  // asked 以 ins: 开头时 campaign 已经排好了插关
  if (asked) return begin(campaign);
  void music.play(['title', 'liangshan']);
  title.show(titleOptions(null));

  /** 标题画面的选项；current = 选关列表里要高亮的那一项（游戏里 = 正在玩的，标题画面 = 存档所在的） */
  function titleOptions(current: string | null): TitleOptions {
    const save = loadSave() ? campaign : null;
    const ok = save && stages.some((s) => s.index === save.stage) ? save : null;
    return {
      save: ok ? saveSummary(ok) : null,
      chapters: stageGroups(),
      current: current ?? (ok ? placeOf(ok) : undefined),
      portraits: TITLE_FACES.map((cls) => ui.portrait(cls)).filter((x): x is string => !!x),
      version: versionLabel(BUILD),
      buttons: [$('lang'), $('sound'), $('music'), $('update')],
      onNew: () => begin(newCampaign(stages[0].index)),
      onLoad: () => begin(ok!),
      onClear: () => {
        clearSaves();
        location.href = location.pathname;
      },
      onJump: enter,
      onBack: current === null ? undefined : leaveTitleOnly,
    };
  }
  /** 从游戏里打开的选关页按「返回」：直接回到游戏，什么都不变 */
  function leaveTitleOnly() {
    title.hide();
  }
  /** 存档停在哪一项（选关列表里的值） */
  function placeOf(c: CampaignState) {
    if (c.insertTown) return insertTownOf(c.insertTown.next) ?? 'itown:mainline/shizilou';
    if (c.insert) return insValue(c.insert);
    if (c.town && towns.has(c.stage)) return townValue(c.stage);
    return String(c.stage);
  }

  /** 存档摘要：在哪一关 / 哪个城镇，队伍等级与金钱，存档时间 */
  function saveSummary(c: CampaignState) {
    const s = stageOf(c.stage);
    const l = stageLabel(s.title, s.mapName);
    const ins = c.insert ? inserts.find((x) => x.ref === c.insert) : undefined;
    const where = c.insertTown ? `城镇 · ${insertTownName(c.insertTown.next)}` : c.town ? `${l.chapterLabel} · 城镇 ${townName(c.town)}` : ins ? `${insChapter.get(ins.ref) ?? l.chapterLabel} ${ins.kind} · ${ins.title}` : l.full;
    const active = new Set(c.active ?? c.members.map((m) => m.classId));
    const team = c.members
      .filter((m) => active.has(m.classId))
      .slice(0, 6)
      .map((m) => `${assets.tr(assets.data.classes[m.classId]?.name ?? '?')} ${m.level}级`);
    let at = '';
    try {
      const t = Number(localStorage.getItem(SAVE_AT_KEY));
      if (t) at = new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      /* 读不到就不显示 */
    }
    const detail = [team.join('、'), c.members.length ? `金钱 ${c.gold}` : '', at && `存于 ${at}`].filter(Boolean).join('\n');
    return { where, detail };
  }
}

/** 标题画面上的头像：武龙、史进、林冲、鲁智深、吴用、宋江（HUM 职业号） */
const TITLE_FACES = [0, 3, 11, 16, 10, 6];

/** 提示条：文字 + 可选按钮；不带按钮的几秒后自动消失 */
let toastTimer = 0;
function toast(text: string, actions: { label: string; primary?: boolean; run: () => void }[] = [], sticky = actions.length > 0) {
  clearTimeout(toastTimer);
  $('toast-text').textContent = text;
  $('toast-actions').replaceChildren(
    ...actions.map((a) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.onclick = a.run;
      return b;
    }),
  );
  // 手机上顶栏会折成两行，提示条放在顶栏下面
  $('toast').style.top = `${Math.round($('hud').getBoundingClientRect().bottom) + 8}px`;
  $('toast').hidden = false;
  if (!sticky) toastTimer = window.setTimeout(() => ($('toast').hidden = true), 3000);
}
const hideToast = () => ($('toast').hidden = true);

function setupUpdateButton() {
  const btn = $<HTMLButtonElement>('update');
  btn.title = `检查有没有新版本（当前 ${versionLabel(BUILD)}）`;
  btn.onclick = async () => {
    btn.disabled = true;
    toast('正在检查更新…', [], true);
    const r = await checkForUpdate();
    btn.disabled = false;
    if (r.kind === 'latest') return toast(`已是最新版本 ${versionLabel(BUILD)}`);
    if (r.kind === 'unavailable') return toast(r.reason);
    // 刷新会丢掉本关进行中的战斗（存档记在关卡开头），所以先问一下
    toast(`发现新版本 ${versionLabel(r)}。更新会刷新页面，本关从头开始，存档保留。`, [
      {
        label: '立即更新',
        primary: true,
        run: () => {
          toast('正在更新…', [], true);
          void applyUpdate();
        },
      },
      { label: '稍后', run: hideToast },
    ]);
  };
}

installTouchGuards();
installSound($<HTMLButtonElement>('sound'));
installMusic($<HTMLButtonElement>('music'));

async function boot() {
  try {
    pruneOldCache();
    await initI18n().catch((e) => console.error('多语言载入失败', e));
    const assets = loadAssets(gameFiles());
    setHero(assets.data.heroName, assets.data.heroNickname ?? '');
    await assets.files.ensure(startupImages(assets), progress, '下载头像和图标');
    setupEl.hidden = true;
    startGame(assets);
  } catch (e) {
    console.error(e);
    progress(`出错了：${(e as Error).message}。请检查网络后刷新页面重试。`);
  }
}
boot();
