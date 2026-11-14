import { describe, expect, it } from 'vitest';
import { AudioGuard, ClockWatch, KICK_COOLDOWN_MS, needsResume, STALL_WALL_MS, type AudioCtxLike } from '../src/game/audio-guard.ts';

class FakeCtx implements AudioCtxLike {
  state = 'running';
  currentTime = 0;
  calls: string[] = [];
  resume() {
    this.calls.push('resume');
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.calls.push('suspend');
    this.state = 'suspended';
    return Promise.resolve();
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('手机上音频掉线后自动接回', () => {
  it('suspended 和 iOS 的 interrupted 都要 resume', () => {
    expect(needsResume('suspended')).toBe(true);
    expect(needsResume('interrupted')).toBe(true);
    expect(needsResume('running')).toBe(false);
    expect(needsResume('closed')).toBe(false);
  });

  it('被打断（interrupted）时每次检查都发 resume，不被冷却挡住', () => {
    let t = 0;
    const g = new AudioGuard(() => t);
    const c = new FakeCtx();
    c.state = 'interrupted';
    c.resume = () => (c.calls.push('resume'), Promise.reject(new Error('not allowed')));
    expect(g.check(c)).toBe('resume');
    t += 10;
    expect(g.check(c)).toBe('resume');
    expect(c.calls).toEqual(['resume', 'resume']);
  });

  it('时钟正常走：不打扰', () => {
    let t = 0;
    const g = new AudioGuard(() => t);
    const c = new FakeCtx();
    for (let i = 0; i < 10; i++) {
      expect(g.check(c)).toBe('ok');
      t += 700;
      c.currentTime += 0.7;
    }
    expect(c.calls).toEqual([]);
  });

  it('running 但时钟停住（iOS 回前台后不出声）：suspend + resume 踢一下，冷却内不重复', async () => {
    let t = 0;
    const g = new AudioGuard(() => t);
    const c = new FakeCtx();
    expect(g.check(c)).toBe('ok');
    t += STALL_WALL_MS + 100;
    expect(g.check(c)).toBe('kick');
    await flush();
    expect(c.calls).toEqual(['suspend', 'resume']);
    expect(c.state).toBe('running');
    // 时钟还是不走，但冷却没过
    t += STALL_WALL_MS + 100;
    expect(g.check(c)).toBe('ok');
    t += KICK_COOLDOWN_MS;
    expect(g.check(c)).toBe('kick');
  });

  it('回到前台时 force：看着正常也踢一下', async () => {
    let t = 10_000;
    const g = new AudioGuard(() => t);
    const c = new FakeCtx();
    expect(g.check(c, true)).toBe('kick');
    await flush();
    expect(c.calls).toEqual(['suspend', 'resume']);
  });

  it('踢的 promise 一直不结束（iOS 被打断时可能这样）：过一会儿还能再救', () => {
    let t = 10_000;
    const g = new AudioGuard(() => t);
    const c = new FakeCtx();
    c.suspend = () => new Promise(() => {});
    expect(g.check(c, true)).toBe('kick');
    t += 100;
    expect(g.check(c, true)).toBe('busy');
    t += KICK_COOLDOWN_MS;
    expect(g.check(c, true)).toBe('kick');
  });

  it('上下文被关掉了：告诉调用方去重建', () => {
    const c = new FakeCtx();
    c.state = 'closed';
    expect(new AudioGuard(() => 0).check(c)).toBe('closed');
  });

  it('ClockWatch：挂起期间时钟不走不算停；恢复后重新取样', () => {
    const w = new ClockWatch();
    expect(w.sample('running', 0, 0)).toBe(false);
    expect(w.sample('suspended', 0, 5000)).toBe(false);
    expect(w.sample('running', 0, 6000)).toBe(false); // 重新取样起点
    expect(w.sample('running', 0.65, 6650)).toBe(false);
    expect(w.sample('running', 0.65, 7300)).toBe(true);
  });
});
