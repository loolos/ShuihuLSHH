// 音效。原版所有音效都经 EXE 0x423870 播放：拼出 `sound\<名字>.wav`，交给 0x4237e0 的波形播放器。
// 调用处（静态分析，名字均为 EXE 里的常量字符串）：
//   - 0x406150 施放技能（含普通攻击）：先播 `s<技能号>`（技能子项 +0），再按技能类型（+2）加一声：
//     类型 2 迴旋 → S225、5 普通 → S221、6 遠程 → S222、7 連續 → s224（跳转表 0x4062dc）；
//     221–225 正好是 EXE 技能名表里的类型名（普通攻擊、遠程攻擊、防禦技、連續技、迴旋技）。
//   - 界面：菜单选中 m03（0x413444 等 8 处）；m01 / m02 / m15 为窗口控件（0x416fba / 0x41701a / 0x4171aa，具体时机待核）；
//     对话框 m05 / m12（0x411ab4 / 0x411821，待核）；m04 / m07 / m09 / m10 / m13 / m14 / m011 时机待核。
//   - PAS 指令 20/21：剧本指定的音效（0x411748）。数字名 1–57.wav 推测为人物语音（0x4038f3，待核）。
// 原版 Sound/ 压成 MP3 放在仓库 gamedata/sound/（负责人 2026-11-12 同意，tools/gen-sound.ts 生成）：
// 有原版声音的事件（技能、菜单）播原版；原版没有对应声音的事件（命中、倒下、胜负等）用浏览器合成的简单音效【新】。
import { REPO_GAMEDATA } from '../platform/gamefiles.ts';

export type Sfx = 'click' | 'swing' | 'skill' | 'hit' | 'crit' | 'miss' | 'heal' | 'ko' | 'turn' | 'win' | 'lose' | 'status';

/** 音量档位：关 / 小 / 中 / 大 */
export const LEVELS = ['关', '小', '中', '大'] as const;
const GAIN = [0, 0.25, 0.5, 0.9];
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
    this.level = ((level % LEVELS.length) + LEVELS.length) % LEVELS.length;
    try {
      localStorage.setItem(STORE, String(this.level));
    } catch {
      /* 忽略 */
    }
    if (this.master) this.master.gain.value = GAIN[this.level];
    this.onChange(this.level);
  }
  cycle() {
    this.setLevel(this.level + 1);
    this.unlock();
    if (this.level) this.play('click');
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
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
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
  /** 播原版音效 name；没有这个文件时播合成音 fallback（不给就不出声） */
  async playWav(name: string, fallback?: Sfx) {
    const ctx = this.ready();
    if (!ctx) return;
    const buf = await this.wav(name);
    if (buf && this.ready()) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master!);
      src.start();
    } else if (fallback) this.play(fallback);
  }

  /** 施放技能 / 普通攻击：原版是 s<技能号> + 类型音；合成音按普通攻击 / 技能区分 */
  cast(skillId: number, type: number, basic: boolean) {
    if (!this.ready()) return;
    void this.playWav(`s${skillId}`, basic ? 'swing' : 'skill');
    const t = TYPE_SOUND[type];
    if (t) void this.wav(t).then((b) => b && this.playWav(t));
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
    button.title = `音效音量：${LEVELS[sound.level]}（点击切换）`;
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
      if (b && b !== button && !(b as HTMLButtonElement).disabled) void sound.playWav('m03', 'click');
    },
    true,
  );
}
