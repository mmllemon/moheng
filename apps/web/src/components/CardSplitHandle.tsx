/**
 * 卡片高度调节把手 —— 对齐 hana 的 separator
 * （contributed-keybindings 的 du/cu/Kn + ChatTranscript 的 _separator_704ed）。
 *
 * hana 的命中思路（cu）：不是要求指针精确落在 6px 的把手上，
 * 而是「坐标落在把手矩形 ± 容差内就算命中」，容差 = 热区高度的一半。
 * 这里用同构做法：把手自身 6px，但加一层 `::before` 撑到 ±6px（总 18px）作为命中区，
 * 指针只要在两张卡交界附近就能抓到，不会出现「脱节后再也 hover 不到」。
 *
 * CSS 真值：
 *   ._separator_704ed { position: relative; z-index: 4; flex-shrink: 0;
 *                       background: transparent; touch-action: none }
 *   ._separator_704ed[aria-orientation=horizontal] {
 *     height: var(--separator-grab-box, 6px);
 *     margin-block: calc(var(--separator-grab-box) / -2);
 *     cursor: row-resize }
 *   ._separator_704ed[aria-orientation=horizontal]:after {
 *     top: 50%; left: 50%; height: 3px; width: 44px;
 *     background: var(--accent); border-radius: 2px; corner-shape: round;
 *     opacity: 0; transform: translate(-50%,-50%) scaleX(.12);
 *     transition: opacity .18s, transform .18s }
 *   ._separator_704ed:hover:after, :active:after { opacity: .35 }
 *   ._separator_704ed[aria-orientation=horizontal]:hover:after {
 *     transform: translate(-50%,-50%) scaleX(1) }
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 上下两块的最小高度（px） */
const MIN_PX = 120;

type Props = {
  /** 上块高度占比 0~1 */
  ratio: number;
  /** 拖动中实时回报（0~1） */
  onChange: (ratio: number) => void;
  /** 外部样式（grid 定位用） */
  style?: React.CSSProperties;
};

export function CardSplitHandle({ ratio, onChange, style }: Props) {
  const handleRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  /** 拖动结束后短暂保持可见，避免 grid 重排导致指针脱节、把手瞬间消失 */
  const [hold, setHold] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging) return;
      if (event.pointerType === 'mouse' && event.button > 0) return;

      const el = handleRef.current;
      const container = el?.parentElement;
      if (!el || !container) return;

      const total = container.getBoundingClientRect().height;
      if (!total || total <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const startRatio = ratio;
      setDragging(true);
      setHold(true);
      window.clearTimeout(holdTimer.current);

      /* 用 window 监听 + 引用自身的 pointerId 校验，
         这样即使指针移出把手也照样收到 move/up。 */
      const pointerId = event.pointerId;

      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientY - startY;
        const next = startRatio + delta / total;
        const minRatio = MIN_PX / total;
        const maxRatio = 1 - MIN_PX / total;
        onChange(Math.min(maxRatio, Math.max(minRatio, next)));
      };

      const finish = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        document.body.style.cursor = '';
        /* 松手后 grid 已重排、把手换了位置，指针还在原处：
           保持 600ms 可见，避免「把手突然不见」。 */
        holdTimer.current = window.setTimeout(() => setHold(false), 600);
      };

      document.body.style.cursor = 'row-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [dragging, ratio, onChange],
  );

  /** 键盘可访问 */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      if (event.key === 'ArrowUp') { event.preventDefault(); onChange(Math.max(0.1, ratio - step)); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); onChange(Math.min(0.9, ratio + step)); }
    },
    [ratio, onChange],
  );

  useEffect(() => () => {
    window.clearTimeout(holdTimer.current);
    document.body.style.cursor = '';
  }, []);

  return (
    <div
      ref={handleRef}
      className="card-split-handle"
      style={style}
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={10}
      aria-valuemax={90}
      tabIndex={0}
      data-dragging={dragging ? '' : undefined}
      data-hold={hold ? '' : undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
