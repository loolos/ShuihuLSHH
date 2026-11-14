/**
 * 手机触摸的两类问题（lolo 2026-11-14：「好像某个地方已经被摁住了，再滑动屏幕就变成缩放」）：
 *
 * 1. 卡住的触点：手指按在地图上时弹出对白，对白的点击拦截（ui.ts 的 guard，捕获阶段 stopPropagation）
 *    会把这根手指的 touchend 拦下，Phaser 收不到抬起，pointer1 一直是「按下」。之后再用一根手指滑动，
 *    它成了 pointer2，BattleScene 看到两个指针都按着，就当成双指缩放。来电、切后台、系统手势导致的
 *    touchcancel 丢失也会这样。这里在 window 上记录当前真正按在屏幕上的触点（TouchEvent.touches），
 *    BattleScene 每次处理指针前把不在其中的 Phaser 指针复位。
 * 2. 浏览器自己的页面缩放：画布有 touch-action: none，但手指落在 HUD、下方面板等 DOM 上时不受限，
 *    双指会缩放整个页面。viewport 已禁止缩放（Android 有效），iOS Safari 无视它，所以再拦 gesture*
 *    事件和多指 touchmove。
 */
import type Phaser from 'phaser';

/** 最近一次触摸事件后仍按在屏幕上的触点（Touch.identifier）；离开页面时清空 */
const live = new Set<number>();
let installed = false;

function sync(e: TouchEvent) {
  live.clear();
  for (const t of Array.from(e.touches)) live.add(t.identifier);
}

export function installTouchGuards() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // 捕获阶段、最先登记：别的监听器 stopPropagation 也挡不住同一节点上的这些监听器
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    window.addEventListener(t, sync, { capture: true, passive: true });
  }
  const clear = () => live.clear();
  window.addEventListener('blur', clear);
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => document.hidden && clear());

  // iOS Safari：页面级双指缩放（gesturestart 等只有 Safari 有）
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }
  // 多指 touchmove 一律不让浏览器缩放。挂在 window 冒泡阶段：画布上的事件已经先交给 Phaser
  // （Phaser 会跳过 defaultPrevented 的事件，所以不能在它之前拦）。
  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}

/**
 * 把已经离开屏幕、但 Phaser 仍以为按着的触摸指针复位。返回是否复位了任何指针。
 * 只在确实装了监听器时生效（桌面鼠标指针 wasTouch 为 false，不受影响）。
 */
export function releaseStalePointers(input: Phaser.Input.InputPlugin): boolean {
  if (!installed) return false;
  let any = false;
  for (const p of input.manager.pointers) {
    if (p.id === 0 || !p.active || !p.wasTouch) continue;
    if (!live.has(p.identifier)) {
      p.reset();
      any = true;
    }
  }
  return any;
}

/** 屏幕上是否真有两根以上手指 */
export function multiTouch(): boolean {
  return live.size >= 2;
}
