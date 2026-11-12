// 背景音乐【新】：原版用光盘 CD 音轨（music.ini，本副本没有），重制版用负责人用 Suno 生成的配乐。
// 曲子放在仓库 gamedata/bgm/，由 index.json 说明：
//   { "tracks": { "town": "town.mp3", "battle": "battle.mp3", "tense": "tense.mp3", "story": "story.mp3" },
//     "stages": { "N-add03": "tense", ... } }
// 共 4 首（负责人 2026-11-12 定）：town 城镇/整备，battle 常规战斗，tense 紧张/首领战，story 剧情。
// 关卡没在 stages 里指定时：Act 剧情关 → story，其余 → battle。缺哪首就不放。过关 / 失败用原版音效 m12 / m05。
import { REPO_GAMEDATA } from '../platform/gamefiles.ts';

const STORE = 'shuihu.music';
const VOLUME = 0.45;

interface BgmIndex {
  tracks: Record<string, string>;
  stages?: Record<string, string>;
}

class MusicPlayer {
  private el = new Audio();
  private index: Promise<BgmIndex | null> | null = null;
  private current: string | null = null;
  on: boolean;
  onChange: () => void = () => {};
  /** 仓库里有没有配乐（index.json 读到之前为 null） */
  available: boolean | null = null;

  constructor() {
    let v = true;
    try {
      v = localStorage.getItem(STORE) !== '0';
    } catch {
      /* 隐私模式：默认开 */
    }
    this.on = v;
    this.el.loop = true;
    this.el.volume = VOLUME;
  }

  private base() {
    return import.meta.env.DEV ? '/gamedata/bgm/' : REPO_GAMEDATA.replace(/shuihu\/$/, 'bgm/');
  }
  loadIndex(): Promise<BgmIndex | null> {
    this.index ??= fetch(this.base() + 'index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j === 'object' && j.tracks ? (j as BgmIndex) : null))
      .catch(() => null)
      .then((j) => {
        this.available = !!j && Object.keys(j.tracks).length > 0;
        this.onChange();
        return j;
      });
    return this.index;
  }

  /** 这一关该放哪首 */
  async stageTrack(mapName: string): Promise<string> {
    const idx = await this.loadIndex();
    const named = idx?.stages?.[mapName] ?? idx?.stages?.[mapName.toLowerCase()];
    if (named) return named;
    if (/^act/i.test(mapName)) return 'story';
    return 'battle';
  }

  /** 循环播放某首（同一首正在放就不重来）；null = 停 */
  async play(track: string | null) {
    this.current = track;
    const idx = await this.loadIndex();
    if (this.current !== track) return; // 等索引期间又换了曲
    const file = track ? idx?.tracks[track] : undefined;
    if (!file || !this.on) {
      this.el.pause();
      return;
    }
    const url = this.base() + file;
    if (this.el.src !== new URL(url, location.href).href) this.el.src = url;
    this.el.play().catch(() => {
      /* 还没有用户操作，浏览器不让播：等第一次点击时再试 */
    });
  }
  toggle() {
    this.on = !this.on;
    try {
      localStorage.setItem(STORE, this.on ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (this.on) void this.play(this.current);
    else {
      this.el.pause();
    }
    this.onChange();
  }
  /** 第一次用户操作时补放（浏览器的自动播放限制） */
  resume() {
    if (this.on && this.current && this.el.paused && this.el.src) this.el.play().catch(() => {});
  }
}

export const music = new MusicPlayer();

export function installMusic(button: HTMLButtonElement) {
  const label = () => {
    const none = music.available === false;
    button.textContent = music.on && !none ? '音乐开' : '音乐关';
    button.disabled = none;
    button.title = none ? '还没有配乐' : `背景音乐：${music.on ? '开' : '关'}（点击切换）`;
    button.setAttribute('aria-label', button.title);
  };
  music.onChange = label;
  label();
  void music.loadIndex();
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    music.toggle();
  });
  const resume = () => music.resume();
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);
}
