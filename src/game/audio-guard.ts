// 让 Web Audio 在手机上「掉线」后自己接回来【新】。负责人 2026-11-14 反映：手机上玩着玩着音效突然全没了，音乐还在。
// 原因（静态推断，没有真机复现）：
// - iPhone / iPad：切到后台、锁屏、来电、Siri、别的 App 放声音之后，AudioContext 会变成 'interrupted'（WebKit 特有）
//   或 'suspended'；iOS 17/18 还有一种情况是回来后 state 仍是 'running' 但不出声，要 suspend() 再 resume() 才好
//   （Phaser 的处理与 issue phaserjs/phaser#6829 同理）。旧代码只在 'suspended' 时 resume，'interrupted' 永远不恢复，
//   「running 但不出声」也不管，于是音效一直哑着。音乐用的是 <audio> 元素，系统打断结束后会自己接着放，所以「只有音乐」。
// - 安卓：音乐直接用 <audio>，音效走 AudioContext，被系统收回音频焦点后同样只剩音乐。
// 对策：每次用户操作、页面回到前台、播音效前都检查一遍；时钟停了（running 却不走）就 suspend + resume 踢一下；
// 上下文被关掉了就重建。
export interface AudioCtxLike {
  readonly state: string;
  readonly currentTime: number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** 需要 resume 的状态（'interrupted' 是 iOS Safari 特有的） */
export function needsResume(state: string): boolean {
  return state === 'suspended' || state === 'interrupted';
}

/** 墙钟过了这么久（毫秒）才判断时钟停没停 */
export const STALL_WALL_MS = 600;
/** 踢一下发出后最多等这么久（毫秒）就允许再试 */
export const BUSY_MS = 1500;
/** 两次踢之间至少隔这么久（毫秒） */
export const KICK_COOLDOWN_MS = 2000;

/**
 * 看 AudioContext 的时钟是不是「running 却停着」：比较两次取样之间墙钟和 currentTime 各走了多少。
 * 不是 running 的时候时钟本来就不走，这时只清掉上一次取样，不算停。
 */
export class ClockWatch {
  private wall = -1;
  private time = 0;
  /** 取样；返回 true 表示时钟停了（running，墙钟走了 ≥ STALL_WALL_MS，currentTime 走了不到四分之一） */
  sample(state: string, currentTime: number, nowMs: number): boolean {
    if (state !== 'running') {
      this.wall = -1;
      return false;
    }
    if (this.wall < 0) {
      this.wall = nowMs;
      this.time = currentTime;
      return false;
    }
    const dWall = nowMs - this.wall;
    if (dWall < STALL_WALL_MS) return false;
    const dTime = (currentTime - this.time) * 1000;
    this.wall = nowMs;
    this.time = currentTime;
    return dTime < dWall * 0.25;
  }
  reset() {
    this.wall = -1;
  }
}

/** 一个 AudioContext 的看护：resume / 踢一下（suspend + resume），带冷却 */
export class AudioGuard {
  private watch = new ClockWatch();
  private lastKick = -1e9;
  /** 正在踢，到这个时刻前别重复踢（iOS 被打断时 promise 可能一直不结束，所以只等一会儿） */
  private busyUntil = -1e9;
  constructor(private now: () => number = () => performance.now()) {}

  /**
   * 检查一遍并尽量救回来。返回做了什么：'ok' 正常、'resume' 发了 resume、'kick' 时钟停了踢了一下、'closed' 已关闭要重建。
   * force：页面刚回到前台，即使看着正常也踢一下（iOS 回前台后 running 却不出声的情况，取样还来不及发现）。
   */
  check(ctx: AudioCtxLike, force = false): 'ok' | 'resume' | 'kick' | 'closed' | 'busy' {
    if (ctx.state === 'closed') return 'closed';
    // resume 可以重复发（用户操作里再发一次才算数），不看 busy
    if (needsResume(ctx.state)) {
      this.watch.reset();
      void ctx.resume().catch(() => {});
      return 'resume';
    }
    const t = this.now();
    if (t < this.busyUntil) return 'busy';
    const stalled = this.watch.sample(ctx.state, ctx.currentTime, t);
    if ((stalled || force) && t - this.lastKick >= KICK_COOLDOWN_MS) {
      this.lastKick = t;
      this.watch.reset();
      this.run(ctx.suspend().then(() => ctx.resume()));
      return 'kick';
    }
    return 'ok';
  }
  private run(p: Promise<unknown>) {
    this.busyUntil = this.now() + BUSY_MS;
    // 不在用户操作里 resume 可能被浏览器拒绝：留在 suspended，下一次点击时上面的 resume 再试
    void p.catch(() => {}).finally(() => (this.busyUntil = -1e9));
  }
}
