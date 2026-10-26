/**
 * 侧栏拖动宽度。
 *
 * 对齐 hana 的 contributed-keybindings 实现（sc 组件的 D / B / P）：
 *
 *   const Ut = "--bridge-panel-left";
 *   function Oa(e) { return `calc(var(--panel-edge-gap, 6px) * 2 + ${e}px)`; }
 *
 *   B = (width) => {
 *     aside.style.width = `${N}px`;
 *     overlayShell.style.width = `${N}px`;
 *     resizeHandle.style.setProperty("--fp-resize-left", `${N}px`);
 *     document.documentElement.style.setProperty(Ut, Oa(N));
 *   };
 *
 *   D = useDrag({
 *     axis: "x",
 *     onStart: () => widthRef.current,
 *     onMove: ({ context, deltaX }) => B(context + deltaX),
 *     onEnd: ({ context, deltaX }) => { const N = clamp(context + deltaX); B(N); onWidthChange(N); },
 *     onCancel: () => B(widthRef.current),
 *   });
 *
 *   clamp: minWidth / maxWidth 上下限
 *
 * 关键：拖动过程中**不写 localStorage**，只在 onEnd 提交。否则每帧都写盘。
 *
 * moheng 的差异：
 *   - 侧栏是 flex 子项（width 由 --sidebar-width 决定），所以改 CSS 变量即可，
 *     不需要直接改 aside.style.width。
 *   - 主内容靠 flex: 1 自动让位，不需要 --bridge-panel-left 变量。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'cms:sidebar-width';
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 240;

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(n)) return clampWidth(n);
  } catch { /* localStorage 不可用时用默认值 */ }
  return DEFAULT_WIDTH;
}

export function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

/** 把宽度写到 DOM：CSS 变量 + 把手位置变量 */
function applyWidth(width: number) {
  const root = document.documentElement;
  root.style.setProperty('--sidebar-width', `${width}px`);
  root.style.setProperty('--fp-resize-left', `${width}px`);
}

export function useSidebarResize() {
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  // 挂载时同步一次（localStorage 里的值可能和 CSS 默认不同）
  useEffect(() => {
    applyWidth(width);
    // 只在首次挂载时应用，后续由拖动/提交负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const doc = event.currentTarget.ownerDocument;

    setResizing(true);
    // 拖动期间禁用过渡，否则宽度会跟手滞后
    document.body.classList.add('resizing');
    doc.body.classList.add('resizing');

    let latest = startWidth;

    const onMove = (e: PointerEvent) => {
      latest = clampWidth(startWidth + (e.clientX - startX));
      applyWidth(latest);
    };

    const onUp = () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.body.classList.remove('resizing');
      document.body.classList.remove('resizing');
      setResizing(false);
      // 只在结束时落盘
      setWidth(latest);
      try { localStorage.setItem(STORAGE_KEY, String(latest)); } catch { /* 忽略 */ }
    };

    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  }, []);

  /** 键盘调整（对齐 hana 的可访问性：方向键改宽度） */
  const nudgeWidth = useCallback((delta: number) => {
    const next = clampWidth(widthRef.current + delta);
    applyWidth(next);
    setWidth(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* 忽略 */ }
  }, []);

  const resetWidth = useCallback(() => {
    applyWidth(DEFAULT_WIDTH);
    setWidth(DEFAULT_WIDTH);
    try { localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH)); } catch { /* 忽略 */ }
  }, []);

  return { width, resizing, startResize, nudgeWidth, resetWidth };
}
