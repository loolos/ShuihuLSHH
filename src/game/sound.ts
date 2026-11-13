// 音效。原版所有音效都经 EXE 0x423870 播放：拼出 `sound\<名字>.wav`，交给 0x4237e0 的波形播放器。
// 各调用处对应的事件（静态分析，名字均为 EXE 里的常量字符串，或按编号拼出）：
//   m09  开始移动：移动指令 0x406000 → 0x405fa0 → 虚表 +0x80 = 0x405f20
//   s<技能号> + 类型音  施放技能（含普通攻击）0x406150：技能子项 +0；类型 2 迴旋 → S225、5 普通 → S221、6 遠程 → S222、
//        7 連續 → s224（跳转表 0x4062dc；221–225 正是技能名表里的类型名）。没有对应文件就不出声
//   <组号+1>  特效段开始 0x403880（数字名 1–57.wav 就是特效音）：技能特效、集气（第 7 组 → 8）、回复（第 17 组 → 18）；
//        遠程技第一段在 0x4037f0 直接设组号，不出声
//   49   防御：0x4075c0 → 0x40765f 放第 48 组特效（只限我方、已登场）
//   38   反击：0x4077a0 → 0x40782b 在反击者脚下放第 37 组特效，放完才出手（不分阵营）
//   46   受到伤害 > 0：0x406850 放第 45 组特效；44 必杀：0x406ea9 放第 43 组特效。落空不出声（0x406950 伤害 0）
//   m13  我方人物被击倒（0x404c80，阵营 +0x3b == 0，同时显示「戰敗了！」）
//   m14  敌方被击倒（0x404c80，阵营 == 2：原版只在掉落道具时播；重制版敌方倒下一律播【新】）；友军倒下不出声
//   m04  升级 0x406990；m07 移动中拾到宝物 0x4054e0（「得到了」）；m10 使用道具 0x408dc0
//   m12  过关旁白 PAS 29（0x4117d0）；m05 失败结局 PAS 30（0x411a90）；m08 加入队伍 PAS 21（0x411748，剧本给出名字）
//   m01 / m02  打开 / 关闭窗口（0x416fb0 / 0x417010）；m03 菜单选中（0x413444 等 8 处）
//   未用：m15（某个 1 秒后自动关闭的窗口 0x4171a0）、logo（片头 0x412800）、m06、m11、tt*
// 原版 Sound/ 压成 MP3 放在仓库 gamedata/sound/（负责人 2026-11-12 同意，tools/gen-sound.ts 生成）。
// 原版对某个事件没有声音，重制版也不出声；只有原版音效整体取不到时才用浏览器合成的简单音效兜底【新】。
import { REPO_GAMEDATA } from '../platform/gamefiles.ts';
import { music } from './music.ts';
import { LEVELS, SFX_GAIN as GAIN, wrapLevel } from './volume.ts';

/** 播放时把背景音乐压低的音效：过关 m12、失败 m05【新】 */
const DUCK = new Set(['m12', 'm05']);

export type Sfx = 'click' | 'swing' | 'skill' | 'hit' | 'crit' | 'miss' | 'heal' | 'ko' | 'turn' | 'win' | 'lose' | 'status';

export { LEVELS };
const STORE = 'shuihu.sound';

/** 技能类型 → 原版的类型音效（EXE 0x4062dc 跳转表） */
const TYPE_SOUND: Record<number, string> = { 2: 'S225', 5: 'S221', 6: 'S222', 7: 's224' };

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private wavs = new Map<string, Promise<AudioBuffer | null>>();
  private index: Promise<Record<string, string> | null> | null = null;
  level: number;
  onChange: (level: number) => void = () => {};

  constructor() {
    let v = 2;
    try {
      const s = localStorage.getItem(STORE);
      if (s !== null && /^[0-3]$/.test(s)) v = Number(s);
    } catch {
      /* 隐私模式等：用默认值 */
    }
    this.level = v;
    music.setLevel(v);
  }

  /** 浏览器要求在用户操作里启动音频；第一次点击 / 按键时调用 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = GAIN[this.level];
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.pending.length) this.preload(this.pending.splice(0));
  }

  setLevel(level: number) {
    this.level = wrapLevel(level);
    try {
      localStorage.setItem(STORE, String(this.level));
    } catch {
      /* 忽略 */
    }
    if (this.master) this.master.gain.value = GAIN[this.level];
    // 背景音乐跟着同一个档位走（负责人 2026-11-13）
    music.setLevel(this.level);
    this.onChange(this.level);
  }
  cycle() {
    this.setLevel(this.level + 1);
    this.unlock();
    if (this.level) void this.sfx('m03', 'click');
  }

  private ready(): AudioContext | null {
    if (!this.level || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  // ---- 原版音效（压缩后的 MP3，见 tools/gen-sound.ts） ----
  /** gamedata/sound/：仓库里由原版 Sound/*.wav 转出的 MP3 和 名字 → 文件 的索引 */
  private base() {
    return import.meta.env.DEV ? '/gamedata/sound/' : REPO_GAMEDATA.replace(/shuihu\/$/, 'sound/');
  }
  private loadIndex(): Promise<Record<string, string> | null> {
    this.index ??= fetch(this.base() + 'index.json')
      // raw.githubusercontent.com 把 JSON 标成 text/plain，所以不看类型，直接解析；开发服务器对不存在的路径回 index.html，解析失败即视为没有
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, string>) : null))
      .catch(() => null);
    return this.index;
  }
  private wav(name: string): Promise<AudioBuffer | null> {
    return this.loadIndex().then((idx) => {
      const file = idx?.[name.toLowerCase()];
      if (!file || !this.ctx) return null;
      let p = this.wavs.get(file);
      if (!p) {
        const ctx = this.ctx;
        p = fetch(this.base() + file)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
          .catch(() => null);
        this.wavs.set(file, p);
      }
      return p;
    });
  }
  /** 预先下载并解码（进关时调用，免得第一次出招时声音迟到） */
  private pending: string[] = [];
  preload(names: string[]) {
    if (!this.ctx) return void this.pending.push(...names);
    for (const n of new Set(names)) void this.wav(n);
  }
  /** 本关用到的技能音效名 */
  skillSounds(skills: { skillId: number; type: number }[]): string[] {
    return skills.flatMap((s) => [`s${s.skillId}`, TYPE_SOUND[s.type]].filter(Boolean) as string[]);
  }
  /** 同一个声音 80 ms 内只播一次（范围技能每格都会触发同一段特效音） */
  private recent = new Map<string, number>();
  /**
   * 播原版音效 name。原版对这个事件没有声音（索引里没有）就不出声；
   * 只有原版音效整体取不到（离线、下载失败）时才播合成音 fallback。
   */
  async sfx(name: string, fallback?: Sfx) {
    const ctx = this.ready();
    if (!ctx) return;
    const k = name.toLowerCase();
    const now = performance.now();
    if (now - (this.recent.get(k) ?? -1e9) < 80) return;
    this.recent.set(k, now);
    const idx = await this.loadIndex();
    if (!idx) return void (fallback && this.play(fallback));
    const buf = await this.wav(name);
    if (buf && this.ready()) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master!);
      src.start();
      if (DUCK.has(k)) music.duckFor(buf.duration + 0.3);
    }
  }

  /** 施放技能 / 普通攻击（EXE 0x406150）：s<技能号> + 类型音 */
  cast(skillId: number, type: number, basic: boolean) {
    void this.sfx(`s${skillId}`, basic ? 'swing' : 'skill');
    const t = TYPE_SOUND[type];
    if (t) void this.sfx(t);
  }
  /** 特效段开始（EXE 0x403880）：播 <组号 + 1>.wav，组号从 0 数。遠程技的第一段不经过 0x403880，不出声 */
  effect(group: number) {
    void this.sfx(String(group + 1));
  }
  /** 受到伤害（EXE 0x406850：伤害 > 0 时放第 45 组特效 → 46.wav）；必杀另放第 43 组（0x406ea9 → 44.wav） */
  hurt(crit: boolean) {
    if (crit) void this.sfx('44', 'crit');
    void this.sfx('46', crit ? undefined : 'hit');
  }

  // ---- 合成音效 ----
  private noise(ctx: AudioContext) {
    if (!this.noiseBuf) {
      const n = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    return s;
  }
  /** 包络：t 时刻起 attack 秒升到 peak，再用 decay 秒衰减 */
  private env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }
  private tone(ctx: AudioContext, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(this.env(ctx, t, peak, attack, decay));
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }
  private hiss(ctx: AudioContext, t: number, filter: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number) {
    const s = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    s.connect(f).connect(this.env(ctx, t, peak, attack, decay));
    s.start(t);
    s.stop(t + attack + decay + 0.02);
  }

  play(sfx: Sfx) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    switch (sfx) {
      case 'click':
        this.tone(ctx, t, 'triangle', 1100, 900, 0.25, 0.003, 0.05);
        break;
      case 'swing': // 挥砍：带通噪声由低到高扫过
        this.hiss(ctx, t, 'bandpass', 500, 2600, 1.2, 0.6, 0.04, 0.14);
        break;
      case 'miss':
        this.hiss(ctx, t, 'bandpass', 1800, 900, 2, 0.3, 0.02, 0.12);
        break;
      case 'skill': // 技能：上扬的铃音 + 一点气声
        this.tone(ctx, t, 'triangle', 520, 1040, 0.22, 0.02, 0.35);
        this.tone(ctx, t + 0.06, 'sine', 780, 1560, 0.15, 0.02, 0.35);
        this.hiss(ctx, t, 'highpass', 3000, 6000, 0.7, 0.08, 0.05, 0.3);
        break;
      case 'hit': // 命中：低频闷响 + 短噪声
        this.tone(ctx, t, 'sine', 160, 50, 0.7, 0.004, 0.14);
        this.hiss(ctx, t, 'lowpass', 2500, 600, 0.8, 0.45, 0.002, 0.08);
        break;
      case 'crit': // 必杀：更重的闷响 + 金属声
        this.tone(ctx, t, 'sine', 200, 40, 0.9, 0.004, 0.25);
        this.hiss(ctx, t, 'lowpass', 4000, 500, 0.8, 0.6, 0.002, 0.15);
        this.tone(ctx, t, 'square', 1320, 1250, 0.12, 0.002, 0.25);
        this.tone(ctx, t + 0.01, 'square', 1870, 1800, 0.08, 0.002, 0.3);
        break;
      case 'heal': // 回复：上行琶音
        [523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, t + i * 0.07, 'sine', f, f, 0.2, 0.01, 0.25));
        break;
      case 'status':
        [880, 660].forEach((f, i) => this.tone(ctx, t + i * 0.08, 'triangle', f, f * 0.98, 0.15, 0.01, 0.18));
        break;
      case 'ko': // 倒下：下坠的低音
        this.tone(ctx, t, 'sawtooth', 260, 55, 0.25, 0.01, 0.6);
        this.hiss(ctx, t + 0.05, 'lowpass', 800, 150, 0.5, 0.3, 0.02, 0.4);
        break;
      case 'turn': // 回合开始：锣
        this.tone(ctx, t, 'sine', 196, 190, 0.35, 0.005, 1.1);
        this.tone(ctx, t, 'sine', 293, 288, 0.18, 0.005, 0.9);
        this.tone(ctx, t, 'triangle', 588, 580, 0.06, 0.005, 0.5);
        break;
      case 'win': // 五声音阶上行
        [392, 440, 523, 587, 784].forEach((f, i) => this.tone(ctx, t + i * 0.12, 'triangle', f, f, 0.25, 0.01, i === 4 ? 0.9 : 0.3));
        break;
      case 'lose':
        [392, 349, 294, 196].forEach((f, i) => this.tone(ctx, t + i * 0.22, 'triangle', f, f * 0.99, 0.22, 0.02, i === 3 ? 1 : 0.35));
        break;
    }
  }
}

export const sound = new SoundSystem();

/** 页面上：第一次操作时启动音频；点任何按钮都有按键音（原版菜单选中 m03） */
export function installSound(button: HTMLButtonElement) {
  const label = () => {
    button.textContent = sound.level ? `♪${LEVELS[sound.level]}` : '♪关';
    button.title = `音量（音效和音乐）：${LEVELS[sound.level]}（点击切换）`;
    button.setAttribute('aria-label', button.title);
  };
  label();
  sound.onChange = label;
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.cycle();
  });
  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (b && b !== button && !(b as HTMLButtonElement).disabled) void sound.sfx('m03', 'click');
    },
    true,
  );
}
