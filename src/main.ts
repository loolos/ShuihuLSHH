import './platform/buffer-shim.ts';
import Phaser from 'phaser';
import {
  GameFiles, checkFiles, collectFromFileList, loadBundled, loadCached, loadFromDevServer, loadFromRepo, saveCache, walkDirectory, type Progress,
} from './platform/gamefiles.ts';
import { idbClear } from './platform/idb.ts';
import { BUILD, applyUpdate, checkForUpdate, versionLabel } from './platform/update.ts';
import { frameToCanvas, loadAssets, preloadStage, type Assets } from './game/assets.ts';
import { BattleScene } from './game/BattleScene.ts';
import { installSound } from './game/sound.ts';
import { installMusic, music } from './game/music.ts';
import { BattleUI } from './game/ui.ts';
import { TownUI } from './game/town.ts';
import { TitleScreen, type TitleStageItem } from './game/title.ts';
import { stageLabel, townName } from './game/stage-names.ts';
import { parsePasHeader } from './formats/pas.ts';
import { findStageFile } from './rules/load.ts';
import { jumpTo, jumpToTown } from './rules/preset.ts';
import type { Battle } from './rules/battle.ts';
import { newCampaign, nextByHeader, nextStages, joinLevel, parseCampaign, partyOf, recordResult, type CampaignState } from './rules/campaign.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setupEl = $('setup');
const msg = $('setup-msg');
const bar = $('setup-bar');
const progress: Progress = (m, r) => {
  msg.textContent = m;
  if (r !== undefined) bar.style.width = `${Math.round(r * 100)}%`;
};

async function obtainFiles(): Promise<GameFiles> {
  const cached = await loadCached();
  if (cached) {
    const { missing, mismatched } = await checkFiles(cached, progress, false);
    if (!missing.length && !mismatched.length) return new GameFiles(cached);
  }
  const dev = await loadFromDevServer(progress);
  if (dev) return new GameFiles(dev);
  const bundled = await loadBundled(progress);
  if (bundled) {
    await saveCache(bundled);
    return new GameFiles(bundled);
  }
  // 网页版：从 GitHub 仓库取原版文件，大文件进关前按需下载；下载失败才让玩家自己选目录
  const repo = await loadFromRepo(progress, cached ?? undefined);
  if (repo) return new GameFiles(repo.files, repo.remote);
  return new GameFiles(await pickFiles());
}

function pickFiles(): Promise<Map<string, ArrayBuffer>> {
  progress('没能从 GitHub 下载原版文件，可以改为选择本机的原版游戏目录。', 0);
  $('setup-actions').hidden = false;
  return new Promise((resolve, reject) => {
    const input = $<HTMLInputElement>('pick-input');
    const finish = async (list: AsyncIterable<{ path: string; file: Blob }> | Iterable<{ path: string; file: Blob }>) => {
      $('setup-actions').hidden = true;
      try {
        const items: { path: string; file: Blob }[] = [];
        for await (const it of list) items.push(it);
        const files = await collectFromFileList(items, progress);
        const { missing, mismatched } = await checkFiles(files, progress, true);
        if (missing.length) throw new Error(`缺少 ${missing.length} 个文件，例如：\n${missing.slice(0, 8).join('\n')}`);
        if (mismatched.length) await confirmMismatch(mismatched);
        progress('写入浏览器缓存…', 1);
        await saveCache(files);
        resolve(files);
      } catch (e) {
        progress(String((e as Error).message ?? e), 0);
        $('setup-actions').hidden = false;
      }
    };
    $('pick').onclick = async () => {
      const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
      // 嵌在 iframe 里（如内部试玩页面）时目录选择器不可用，直接用 <input webkitdirectory>
      const framed = window.self !== window.top;
      if (w.showDirectoryPicker && !framed) {
        try {
          const dir = await w.showDirectoryPicker();
          await finish(walkDirectory(dir));
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          if ((e as Error).name === 'SecurityError') input.click();
          else reject(e);
        }
      } else input.click();
    };
    input.onchange = () =>
      finish([...(input.files ?? [])].map((f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, file: f })));
  });
}

function confirmMismatch(list: string[]): Promise<void> {
  $('setup-warn').hidden = false;
  $('setup-warn-text').textContent = `${list.length} 个文件与已知的原版不同，可能是其它版本或修改过的文件，游戏可能出错：\n${list.slice(0, 10).join('\n')}`;
  return new Promise((resolve) => {
    $('continue').onclick = () => {
      $('setup-warn').hidden = true;
      resolve();
    };
  });
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
function writeSave(c: CampaignState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(c));
    localStorage.setItem(SAVE_AT_KEY, String(Date.now()));
  } catch {
    /* 隐私模式等：不存档也能玩 */
  }
}

function startGame(assets: Assets) {
  const stages = assets.exe.stages.filter((s) => s.mapName && assets.files.has(`Map/${s.mapName}.act`));
  const sel = $<HTMLSelectElement>('stage');
  sel.add(new Option('⟲ 新游戏（从第1章开始）', 'new'));
  /** 过关后进城的关卡：关卡号 → 城镇号与城镇之后的下一关（剧本头 +9 / +11） */
  const towns = new Map<number, { town: number; next: number }>();
  for (const s of stages) {
    const f = findStageFile(assets.files, s.mapName, '.pab');
    const h = f ? parsePasHeader(assets.files.get(f)) : null;
    if (h?.town && stages.some((x) => x.index === h.next)) towns.set(s.index, { town: h.town, next: h.next });
  }
  const townValue = (i: number) => `town:${i}`;
  // 按章分组：组名"第N章 章名"，组内"战役一 关名""剧情 关名""城镇 地名"（顶栏下拉框和标题画面的选关共用）
  const chapters: { label: string; items: TitleStageItem[] }[] = [];
  for (const s of stages) {
    const l = stageLabel(s.title, s.mapName);
    const label = l.chapterLabel || '其它';
    if (chapters.at(-1)?.label !== label) chapters.push({ label, items: [] });
    const items = chapters.at(-1)!.items;
    items.push({ label: l.short, value: String(s.index), title: l.full });
    // 每个城镇也能直接进（列在它前面那一关后面）
    const t = towns.get(s.index);
    if (t) items.push({ label: `城镇 ${townName(t.town)}`, value: townValue(s.index), title: `${l.chapterLabel} 城镇 ${townName(t.town)}` });
  }
  for (const ch of chapters) {
    const group = document.createElement('optgroup');
    group.label = ch.label;
    for (const it of ch.items) {
      const o = new Option(it.label, it.value);
      if (it.title) o.title = it.title;
      group.append(o);
    }
    sel.append(group);
  }
  const params = new URLSearchParams(location.search);
  let campaign = loadSave() ?? newCampaign(stages[0].index);
  /** 测试用跳关：人物按那一关的难度补上等级和装备（原版没有）；town:<关卡> 表示那一关之后的城镇 */
  const jump = (value: string, c: CampaignState): CampaignState => {
    const t = /^town:/.test(value) ? towns.get(Number(value.slice(5))) : undefined;
    if (t) return jumpToTown(assets.files, assets.data, stages, Number(value.slice(5)), t.town, t.next, c);
    return jumpTo(assets.files, assets.data, stages, Number(value), c);
  };
  const asked = params.get('stage')?.toLowerCase();
  if (asked) {
    const inTown = asked.startsWith('town:');
    const key = inTown ? asked.slice(5) : asked;
    const s = stages.find((x) => x.mapName.toLowerCase() === key || String(x.index) === key);
    if (s && inTown && towns.has(s.index)) {
      if (campaign.stage !== s.index || !campaign.town) campaign = jump(townValue(s.index), campaign);
    } else if (s && (s.index !== campaign.stage || campaign.town)) campaign = jump(String(s.index), campaign);
  }
  if (!stages.some((s) => s.index === campaign.stage)) campaign = newCampaign(stages[0].index);
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const ui = new BattleUI();
  ui.tr = assets.tr;
  const faces = new Map<number, string | null>();
  ui.portrait = (cls) => {
    if (!faces.has(cls)) faces.set(cls, cls < assets.heads.count ? frameToCanvas(assets.heads.frame(cls), assets.palette).toDataURL() : null);
    return faces.get(cls)!;
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#14110d',
    pixelArt: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  const scene = () => game.scene.getScene('battle') as BattleScene | null;
  // 开发模式下给 Playwright 截图脚本用
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game; __ui: BattleUI }).__game = game, ((window as unknown as { __ui: BattleUI }).__ui = ui);
  const stageOf = (i: number) => stages.find((s) => s.index === i)!;
  const label = (s: (typeof stages)[number]) => stageLabel(s.title, s.mapName).full;
  const isAct = (s: (typeof stages)[number]) => /^act/i.test(s.mapName);
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
    const f = findStageFile(assets.files, cur.mapName, '.pab');
    if (!f) return { town: 0, next: nextStages(stages, cur.index).slice(0, 1) };
    const h = parsePasHeader(assets.files.get(f));
    const n = nextByHeader(h);
    return { town: h.town, route: n.route, next: stages.filter((s) => s.index === n.next) };
  };
  const go = async (c: CampaignState) => {
    const { next, route } = nextOf(stageOf(c.stage));
    // 城镇 2、5：离开时问走大道还是小径，小径进写死的另一关
    const k = route ? await ask(route.prompt) : 0;
    goTo({ ...c, town: undefined, stage: k === 1 && route ? route.alt : next[0].index });
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
  const enterTown = (c: CampaignState) => openTown(c, c.town!, (x) => void go(x));
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
    if (!next.length) {
      void music.play('liangshan');
      return ui.result(true, text, [retry], '通关');
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
    if (sc.battle.status === 'lost') void music.stageTrack(stageOf(campaign.stage).mapName).then((t) => music.play(t));
    await sc.rewind();
  };
  let loading = 0;
  const run = async () => {
    ui.hideResult();
    town.hide();
    if (campaign.town) {
      // 存档停在城镇里
      sel.value = towns.has(campaign.stage) ? townValue(campaign.stage) : String(campaign.stage);
      const u = new URL(location.href);
      u.searchParams.set('stage', `town:${stageOf(campaign.stage).mapName}`);
      history.replaceState(null, '', u);
      return enterTown(campaign);
    }
    sel.value = String(campaign.stage);
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
    const data = { assets, stage, ui, seed, party: partyOf(campaign), joinLevel: joinLevel(campaign), onEnd };
    if (scene()) scene()!.scene.restart(data);
    else game.scene.add('battle', BattleScene, true, data);
    const u = new URL(location.href);
    u.searchParams.set('stage', stage);
    history.replaceState(null, '', u);
  };
  sel.onchange = () => {
    // 从下拉框跳关：人物按那一关重新配等级和装备（不沿用之前的状态）；选"新游戏"则清空
    goTo(sel.value === 'new' ? newCampaign(stages[0].index) : jump(sel.value, campaign));
  };
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
  $('reset').onclick = async () => {
    await idbClear();
    location.reload();
  };
  setupUpdateButton();
  // 顶栏在窄屏上会折行，小地图跟着顶栏的实际高度往下放
  const hudH = () => document.documentElement.style.setProperty('--hud-h', `${$('hud').getBoundingClientRect().height}px`);
  new ResizeObserver(hudH).observe($('hud'));
  (window as unknown as { __game: Phaser.Game }).__game = game; // 调试与截图脚本用
  /** 离开标题画面进游戏 */
  const begin = (c: CampaignState) => {
    title.hide();
    $('hud').hidden = false;
    hudH();
    ui.show();
    goTo(c);
  };
  const title = new TitleScreen();
  // 网址带 ?stage=（刷新、测试脚本）时直接进关，不经过标题画面
  if (asked) return begin(campaign);
  const save = loadSave();
  void music.play('liangshan');
  title.show({
    save: save && stages.some((s) => s.index === save.stage) ? saveSummary(save) : null,
    chapters,
    portraits: TITLE_FACES.map((cls) => ui.portrait(cls)).filter((x): x is string => !!x),
    version: versionLabel(BUILD),
    buttons: [$('sound'), $('music')],
    onNew: () => begin(newCampaign(stages[0].index)),
    onLoad: () => begin(save!),
    onJump: (v) => begin(jump(v, save ?? newCampaign(stages[0].index))),
  });

  /** 存档摘要：在哪一关 / 哪个城镇，队伍等级与金钱，存档时间 */
  function saveSummary(c: CampaignState) {
    const s = stageOf(c.stage);
    const l = stageLabel(s.title, s.mapName);
    const where = c.town ? `${l.chapterLabel} · 城镇 ${townName(c.town)}` : l.full;
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

installSound($<HTMLButtonElement>('sound'));
installMusic($<HTMLButtonElement>('music'));

async function boot() {
  try {
    const files = await obtainFiles();
    progress('解码中…', 1);
    const assets = loadAssets(files);
    setupEl.hidden = true;
    startGame(assets);
  } catch (e) {
    console.error(e);
    progress(`出错了：${(e as Error).message}`);
  }
}
boot();
