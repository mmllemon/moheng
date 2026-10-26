/**
 * 顶栏让位测量。
 *
 * 逐字对齐 hana 的 CardShell-DVSoA_HL.js：
 *
 *   // 右让位：卡片右缘到窗口控制区左缘的距离
 *   function wot(cardRect, wcRect) {
 *     const overlapY = cardRect.top < wcRect.bottom && cardRect.top + 44 > wcRect.top;
 *     const overlapX = cardRect.left < wcRect.right && cardRect.right > wcRect.left;
 *     if (!overlapY || !overlapX) return null;   // 没重叠就不用让
 *     return Math.max(0, Math.round(cardRect.right - (wcRect.left - 4)));   // 4px 间隙
 *   }
 *
 *   // 左让位：侧栏开关区（trafficStrip）
 *   function vot(cardRect, stripRect, contentRight) {
 *     const overlapY = cardRect.top < stripRect.bottom && cardRect.top + 44 > stripRect.top;
 *     const overlapX = cardRect.left < stripRect.right && cardRect.right > stripRect.left;
 *     if (!overlapY || !overlapX) return null;
 *     return Math.max(0, Math.round(contentRight + 4 - cardRect.left));
 *   }
 *
 *   // 测量：ResizeObserver + 帧循环（settleFrames: 2）
 *   function measure(cardEl) {
 *     const strip = stripRegistry.get(document);
 *     const wc = windowControlsRegistry.get(document);
 *     const cardRect = cardEl.getBoundingClientRect();
 *     if (cardRect.width === 0) return "pending";
 *     let left = null, right = null;
 *     if (strip) { … left = vot(…) }
 *     if (wc) { right = wot(cardRect, wc.getBoundingClientRect()) }
 *     return { clearance: { left, right }, signature: … };
 *   }
 *
 * 关键：**运行时测量，不是写死 padding**。
 * 窗口变宽变窄、侧栏拖动、面板开合都会触发重新测量。
 */

import { useEffect, useState } from 'react';
import { getWindowControlsIsland } from '../components/WindowControls';

/** 顶栏高度（对齐 --titlebar-h） */
const TITLEBAR_H = 44;
/** 让位间隙（对齐 hana 的 +4 / -4） */
const GAP = 4;

/** 右让位：卡片右缘到窗口控制区左缘 */
export function rightClearance(cardRect: DOMRect, wcRect: DOMRect): number | null {
  const overlapY = cardRect.top < wcRect.bottom && cardRect.top + TITLEBAR_H > wcRect.top;
  const overlapX = cardRect.left < wcRect.right && cardRect.right > wcRect.left;
  if (!overlapY || !overlapX) return null;
  return Math.max(0, Math.round(cardRect.right - (wcRect.left - GAP)));
}

/** 左让位：卡片左缘到侧栏开关区右缘 */
export function leftClearance(cardRect: DOMRect, stripRect: DOMRect, contentRight: number): number | null {
  const overlapY = cardRect.top < stripRect.bottom && cardRect.top + TITLEBAR_H > stripRect.top;
  const overlapX = cardRect.left < stripRect.right && cardRect.right > stripRect.left;
  if (!overlapY || !overlapX) return null;
  return Math.max(0, Math.round(contentRight + GAP - cardRect.left));
}

type Clearance = { left: number | null; right: number | null };

/**
 * 测量卡片与其上方浮层（侧栏开关区 / 窗口控制区）的重叠，得出顶栏左右让位量。
 *
 * 对齐 hana 的 Sot：任何卡片都可以调它，不限于主内容区。
 * 工作区的卡头也需要让位 —— 否则自己的按钮会被窗口控制区盖住。
 *
 * @param cardRef 卡片元素
 * @param enabled 是否启用（如面板未打开时不测）
 */
export function useTitlebarClearance(
  cardRef: React.RefObject<HTMLElement | null>,
  enabled = true,
) {
  const [clearance, setClearance] = useState<Clearance>({ left: null, right: null });

  useEffect(() => {
    if (!enabled) return;
    const card = cardRef.current;
    if (!card) return;

    let raf = 0;
    let settle = 0;

    const measure = () => {
      const rect = card.getBoundingClientRect();
      if (rect.width === 0) return;

      let left: number | null = null;
      let right: number | null = null;

      const wc = getWindowControlsIsland(card.ownerDocument);
      if (wc) right = rightClearance(rect, wc.getBoundingClientRect());

      // 侧栏开关区：moheng 是 .shell-traffic-strip
      const strip = card.ownerDocument.querySelector<HTMLElement>('.shell-traffic-strip');
      if (strip) {
        const stripRect = strip.getBoundingClientRect();
        let contentRight = stripRect.left;
        for (const child of Array.from(strip.children)) {
          contentRight = Math.max(contentRight, child.getBoundingClientRect().right);
        }
        left = leftClearance(rect, stripRect, contentRight);
      }

      setClearance((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };

    // 帧循环：连续 2 帧稳定后再写状态（对齐 hana 的 settleFrames: 2）
    const tick = () => {
      measure();
      settle = Math.max(0, settle - 1);
      if (settle > 0) raf = requestAnimationFrame(tick);
    };

    const schedule = () => {
      settle = 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };

    schedule();

    const win = card.ownerDocument.defaultView ?? window;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(card);
    win.addEventListener('resize', schedule);
    card.addEventListener('transitionend', schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      win.removeEventListener('resize', schedule);
      card.removeEventListener('transitionend', schedule);
    };
  }, [cardRef, enabled]);

  return clearance;
}
