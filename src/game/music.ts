// 背景音乐【新】：原版用光盘 CD 音轨（music.ini，本副本没有），重制版用负责人用 Suno 生成的配乐。
// 曲子放在仓库 gamedata/bgm/，由 index.json 说明：
//   { "tracks": { "town": "town.mp3", ... }, "stages": { "n04": "tense", ... } }
// 曲目（负责人 2026-11-12 提供 13 首，用途见 docs/game-design.md §11）：
//   town 城镇酒店/整备，shop 其他店铺，battle / battle2 常规战斗（前半 / 后半程），tense 首领战，army 官军围剿，
//   night 夜里、埋伏、计谋，story 剧情，sad 悲情，eerie 暗流，liangshan 上梁山 / 通关，victory 过关结算，defeat 失败；
//   之后又加 inn 酒店、rock 民乐摇滚（普通战斗轮放）、boss 首领战第二首、comic 诙谐剧情。
// 关卡没在 stages 里指定时：Act 剧情关 → story，其余 → battle、battle2 轮放。战斗关的 stages 值多是 2–3 首的歌单，
// 一首放完交叉淡化接下一首（负责人 2026-11-12 要求）。缺哪首就用 FALLBACK 里的替身。
// 播放（负责人 2026-11-12 要求）：
// - 循环接缝：Suno 的曲子最后约 5 秒是渐弱，不能直接 loop。两个播放器轮流放：快到结尾时另一个从头淡入，前一个淡出。
// - 换曲时旧曲 1 秒淡出、新曲淡入，不硬切。
// - 过关 / 失败音效播放期间把音乐压低（duck），播完再恢复。
// 只有开关，没有音量档（负责人定）。
import { REPO_GAMEDATA } from '../platform/gamefiles.ts';

const STORE = 'shuihu.music';
const VOLUME = 0.45;
/** 离结尾还剩多少秒时开始接下一遍（曲子尾部的渐弱大约从这里开始） */
const LOOP_TAIL = 5;
/** 循环接缝的交叉淡化时长（秒） */
const LOOP_XFADE = 2.5;
/** 换曲的淡出 / 淡入时长（秒） */
const SWITCH_FADE = 1;
/** 压低时的音量比例 */
const DUCK_LEVEL = 0.2;
const TICK = 50;
/** 某首还没有时的替身；victory / defeat 没有就接着放战斗曲 */
const FALLBACK: Record<string, string> = {
  shop: 'town',
  inn: 'town',
  rock: 'battle',
  boss: 'tense',
  comic: 'story',
  battle2: 'battle',
  army: 'battle',
  night: 'battle',
  sad: 'story',
  eerie: 'story',
  liangshan: 'town',
};
const KEEP = new Set(['victory', 'defeat']);

interface BgmIndex {
  tracks: Record<string, string>;
  /** 关卡 → 一首，或几首轮流放的歌单 */
  stages?: Record<string, string | string[]>;
}
/** play() 的参数：一首、一个歌单（轮流放）或 null（停） */
export type Playlist = string | string[] | null;

/** 一个播放器：音量在 level 和 target 之间按 rate（每秒）线性变化，淡到 0 后暂停 */
class Deck {
  el = new Audio();
  level = 0;
  target = 0;
  rate = 1;
  /** 正在放的歌单（曲目名用逗号连起来） */
  key: string | null = null;
  constructor() {
    this.el.preload = 'auto';
  }
  fadeTo(target: number, secs: number) {
    this.target = target;
    this.rate = Math.abs(target - this.level) / Math.max(secs, 0.01);
  }
  step(dt: number) {
    if (this.level < this.target) this.level = Math.min(this.target, this.level + this.rate * dt);
    else if (this.level > this.target) this.level = Math.max(this.target, this.level - this.rate * dt);
    if (this.level === 0 && this.target === 0 && !this.el.paused) this.el.pause();
  }
}

class MusicPlayer {
  private decks = [new Deck(), new Deck()];
  /** 当前（或即将）主放的播放器 */
  private active = 0;
  private index: Promise<BgmIndex | null> | null = null;
  private current: Playlist = null;
  private currentKey: string | null = null;
  /** 正在轮放的文件和当前是第几首 */
  private files: string[] = [];
  private pos = 0;
  private duck = 1;
  private duckUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  /** 浏览器不让自动播放，在等第一次用户操作 */
  private blocked = false;
  /** 最近一次用户操作补放成功的时间：同一次点击落在音乐按钮上时不再当作「关」 */
  resumedAt = -1e9;
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
    for (const d of this.decks) {
      // 后台标签页里定时器会被放慢，接不上下一遍时至少在结束时马上接
      d.el.addEventListener('ended', () => {
        if (this.decks[this.active] === d) this.loopNow(LOOP_XFADE / 2);
      });
    }
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

  /** 这一关该放哪首（战斗关一般是 2–3 首轮流放的歌单，负责人 2026-11-12 要求） */
  async stageTrack(mapName: string): Promise<string | string[]> {
    const idx = await this.loadIndex();
    const named = idx?.stages?.[mapName] ?? idx?.stages?.[mapName.toLowerCase()];
    if (named) return named;
    if (/^act/i.test(mapName)) return 'story';
    return ['battle', 'rock', 'battle2'];
  }
  /** 歌单 → 实际文件（缺的用替身，重复的去掉） */
  private resolve(list: string[], idx: BgmIndex | null): string[] {
    const out: string[] = [];
    for (const t of list) {
      const f = idx?.tracks[t] ?? (FALLBACK[t] ? idx?.tracks[FALLBACK[t]] : undefined);
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  }
  private url(file: string) {
    return new URL(this.base() + file, location.href).href;
  }

  private start(d: Deck, from = 0) {
    try {
      d.el.currentTime = from;
    } catch {
      /* 元数据还没到：从头放 */
    }
    d.el.play().then(
      () => {
        if (this.blocked) {
          this.blocked = false;
          this.onChange();
        }
      },
      () => {
        // 还没有用户操作，浏览器不让播：等第一次点击时再试
        this.blocked = true;
        this.onChange();
      },
    );
    this.ensureTimer();
  }
  private ensureTimer() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), TICK);
  }
  private tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    // 压低：到时间后 0.6 秒回到原音量
    const want = now < this.duckUntil ? DUCK_LEVEL : 1;
    if (this.duck > want) this.duck = Math.max(want, this.duck - dt / 0.25);
    else if (this.duck < want) this.duck = Math.min(want, this.duck + dt / 0.6);
    const a = this.decks[this.active];
    // 循环接缝：快到结尾时另一个播放器从头接上
    if (a.target > 0 && !a.el.paused && a.el.duration > LOOP_TAIL * 3 && a.el.currentTime >= a.el.duration - LOOP_TAIL) this.loopNow(LOOP_XFADE);
    for (const d of this.decks) {
      d.step(dt);
      d.el.volume = Math.max(0, Math.min(1, VOLUME * this.duck * d.level));
    }
    if (this.decks.every((d) => d.el.paused) && this.duck === 1) {
      clearInterval(this.timer!);
      this.timer = null;
    }
  }
  /** 接歌单里的下一首（只有一首就从头再来），和尾部交叉淡化 */
  private loopNow(xfade: number) {
    const old = this.decks[this.active];
    const next = this.decks[1 - this.active];
    if (!old.key || !this.files.length) return;
    this.pos = (this.pos + 1) % this.files.length;
    const url = this.url(this.files[this.pos]);
    if (next.el.src !== url) next.el.src = url;
    next.key = old.key;
    next.level = 0;
    next.fadeTo(1, xfade);
    old.fadeTo(0, xfade);
    this.active = 1 - this.active;
    this.start(next);
  }

  /** 循环播放某首或轮放一个歌单（同一个正在放就不重来）；null = 停 */
  async play(want: Playlist): Promise<void> {
    const list = want == null ? null : Array.isArray(want) ? want : [want];
    const key = list?.join(',') ?? null;
    this.current = want;
    this.currentKey = key;
    const idx = await this.loadIndex();
    if (this.currentKey !== key) return; // 等索引期间又换了曲
    const files = list ? this.resolve(list, idx) : [];
    // 胜利 / 失败曲还没有：接着放战斗曲
    if (list && !files.length && list.every((t) => KEEP.has(t))) return;
    const a = this.decks[this.active];
    if (!files.length || !this.on) {
      for (const d of this.decks) d.fadeTo(0, SWITCH_FADE);
      this.ensureTimer();
      return;
    }
    if (a.key === key && a.target > 0 && (!a.el.paused || this.blocked)) return;
    if (a.key === key && a.el.src) {
      // 同一个刚淡出或正在淡出（比如关了又开）：接着原来的位置放
      a.fadeTo(1, SWITCH_FADE);
      if (a.el.paused) this.start(a, a.el.currentTime);
      return;
    }
    // 换曲：旧的淡出，另一个播放器放新歌单的第一首淡入
    this.files = files;
    this.pos = 0;
    const url = this.url(files[0]);
    a.fadeTo(0, SWITCH_FADE);
    this.active = 1 - this.active;
    const d = this.decks[this.active];
    d.key = key;
    if (d.el.src !== url) d.el.src = url;
    d.level = 0;
    d.fadeTo(1, a.level > 0 ? SWITCH_FADE : 0.5);
    this.start(d);
  }
  toggle() {
    this.on = !this.on;
    try {
      localStorage.setItem(STORE, this.on ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (this.on) void this.play(this.current);
    else for (const d of this.decks) d.fadeTo(0, 0.3), this.ensureTimer();
    this.onChange();
  }
  /** 第一次用户操作时补放（浏览器的自动播放限制） */
  resume() {
    if (!this.on || !this.blocked) return;
    const a = this.decks[this.active];
    if (!a.key || !a.el.src) return;
    this.resumedAt = performance.now();
    this.blocked = false;
    this.start(a, a.el.currentTime);
  }
  /** 压低音乐 secs 秒（过关 / 失败音效） */
  duckFor(secs: number) {
    this.duckUntil = Math.max(this.duckUntil, performance.now() + secs * 1000);
    this.ensureTimer();
  }
}

export const music = new MusicPlayer();
// 开发模式下给 Playwright 测试脚本用
if (import.meta.env.DEV) (window as unknown as { __music: MusicPlayer }).__music = music;

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
    // 浏览器拦着自动播放时，按钮显示「开」但没声音：这一下点击已经让音乐响起来了，不要再把它关掉
    if (performance.now() - music.resumedAt < 1500) return;
    music.toggle();
  });
  const resume = () => music.resume();
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);
}
