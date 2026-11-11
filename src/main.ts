import './platform/buffer-shim.ts';
import Phaser from 'phaser';
import {
  GameFiles, checkFiles, collectFromFileList, loadBundled, loadCached, loadFromDevServer, saveCache, walkDirectory, type Progress,
} from './platform/gamefiles.ts';
import { idbClear } from './platform/idb.ts';
import { frameToCanvas, loadAssets, type Assets } from './game/assets.ts';
import { BattleScene } from './game/BattleScene.ts';
import { BattleUI } from './game/ui.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setupEl = $('setup');
const msg = $('setup-msg');
const bar = $('setup-bar');
const progress: Progress = (m, r) => {
  msg.textContent = m;
  if (r !== undefined) bar.style.width = `${Math.round(r * 100)}%`;
};

async function obtainFiles(): Promise<Map<string, ArrayBuffer>> {
  const cached = await loadCached();
  if (cached) {
    const { missing, mismatched } = await checkFiles(cached, progress, false);
    if (!missing.length && !mismatched.length) return cached;
  }
  const dev = await loadFromDevServer(progress);
  if (dev) return dev;
  const bundled = await loadBundled(progress);
  if (bundled) {
    await saveCache(bundled);
    return bundled;
  }
  return pickFiles();
}

function pickFiles(): Promise<Map<string, ArrayBuffer>> {
  progress('首次使用需要选择原版游戏目录。', 0);
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

function startGame(assets: Assets) {
  const stages = assets.exe.stages.filter((s) => s.mapName && assets.files.has(`Map/${s.mapName}.act`));
  const sel = $<HTMLSelectElement>('stage');
  for (const s of stages) sel.add(new Option(`${s.index}. ${assets.tr(s.title) || s.mapName}`, s.mapName));
  const params = new URLSearchParams(location.search);
  sel.value = (params.get('stage') ?? 'n01').toLowerCase();
  if (!sel.value) sel.value = stages[0].mapName;
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
  const run = () => {
    ui.hideResult();
    const data = { assets, stage: sel.value, ui, seed };
    if (scene()) scene()!.scene.restart(data);
    else game.scene.add('battle', BattleScene, true, data);
    const u = new URL(location.href);
    u.searchParams.set('stage', sel.value);
    history.replaceState(null, '', u);
  };
  sel.onchange = run;
  $('zoom-in').onclick = () => scene()?.zoomBy(1.25);
  $('zoom-out').onclick = () => scene()?.zoomBy(1 / 1.25);
  $('end-turn').onclick = () => scene()?.endTurn();
  $('objective-btn').onclick = () => {
    const b = scene()?.battle;
    if (b && !ui.inDialog) ui.say('', b.objectives.join('\n') || '（本关没有写明的胜负条件）');
  };
  $('reset').onclick = async () => {
    await idbClear();
    location.reload();
  };
  $('hud').hidden = false;
  ui.show();
  (window as unknown as { __game: Phaser.Game }).__game = game; // 调试与截图脚本用
  run();
}

async function boot() {
  try {
    const raw = await obtainFiles();
    progress('解码中…', 1);
    const assets = loadAssets(new GameFiles(raw));
    setupEl.hidden = true;
    startGame(assets);
  } catch (e) {
    console.error(e);
    progress(`出错了：${(e as Error).message}`);
  }
}
boot();
