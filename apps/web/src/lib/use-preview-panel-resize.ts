/**
 * 右侧浮层（工作区）拖动宽度。
 *
 * 与左侧 useSidebarResize 对称：
 *   左侧 拖动改 --sidebar-width，主内容从左边收缩
 *   右侧 拖动改 --preview-panel-width，主内容从右边收缩
 *
 * 宽度范围对齐 hana 的卡片 sizing（index-DEPTMosq.js 的常量）：
 *   Cs = 320   → sizing.minPx    （Eit 的 minPx: ZE = h3 = Cs）
 *   Ts = 400   → sizing.defaultPx（Eit 的 defaultPx: XE = h2 = Ts）
 *
 *   return { sizing: { role: "fixed", minPx: ZE, defaultPx: XE }, ... }
 *
 * 注意：hana 的 _previewPanel CSS 里没有 min-width，宽度约束来自卡片
 * sizing 声明，不在样式表。所以不能靠搜 CSS 得到这两个值。
 *
 * hana 的对照：
 *   --preview-panel-width 只有 CSS 定义（580px），JS 里 us() 只读不写。
 *   渲染层有 <div className="resize-handle resize-handle-left" id="previewResizeHandle" />
 *   但全库没有任何 getElementById('previewResizeHandle')，主进程 bundle 也没有。
 *   也就是说 hana 的右侧把手是死代码，宽度固定。
 *
 *   但把手元素本身存在，说明设计意图；而且 moheng 的预览卡固定 320px 时
 *   PDF 只能显示半页，宽度可调有实际价值。所以这里把 hana 的意图做成真的。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'cms:preview-panel-width';
/** hana 的 sizing.minPx（Cs = 320） */
const MIN_WIDTH = 320;
/** 上限：hana 没给 maxPx，取一个不会把主内容挤没的值 */
const MAX_WIDTH = 900;
/** hana 的 sizing.defaultPx（Ts = 400） */
const DEFAULT_WIDTH = 400;
/** 主内容至少保留的宽度（对齐 hana 的 const He = 400） */
export const MIN_CONTENT_WIDTH = 400;

function clampPanelWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(n)) return clampPanelWidth(n);
  } catch { /* localStorage 不可用时用默认值 */ }
  return DEFAULT_WIDTH;
}

/** 把宽度写到 DOM：CSS 变量 + 把手位置变量 */
function applyWidth(width: number) {
  const root = document.documentElement;
  root.style.setProperty('--preview-panel-width', `${width}px`);
  root.style.setProperty('--preview-resize-right', `${width}px`);
}

export function usePreviewPanelResize() {
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

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
    doc.body.classList.add('resizing');

    let latest = startWidth;

    const onMove = (e: PointerEvent) => {
      // 向右拖 → 变窄（把手在面板左侧边缘）
      latest = clampPanelWidth(startWidth - (e.clientX - startX));
      applyWidth(latest);
    };

    const onUp = () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.body.classList.remove('resizing');
      setResizing(false);
      setWidth(latest);
      try { localStorage.setItem(STORAGE_KEY, String(latest)); } catch { /* 忽略 */ }
    };

    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  }, []);

  /** 键盘调整：方向键改宽度（可访问性，与左侧一致） */
  const nudgeWidth = useCallback((delta: number) => {
    const next = clampPanelWidth(widthRef.current + delta);
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
