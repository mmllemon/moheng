import { useState, useRef, useEffect } from 'react';
import { ArrowUpDown, Check } from 'lucide-react';

/* ============================================================
   排序与显示菜单（对齐 hana sidebar.view.*）
   ============================================================
   hana 的分组标题（wC 组件）接收 actions：

     <SectionTitle actions={
       <>
         <button className={sectionIconButton} onClick={onCreate}>＋</button>
         <button className={sectionIconButton} onClick={(e) => openSort(e.currentTarget)}>排序图标</button>
       </>
     }>
       项目
     </SectionTitle>

   CSS 真值：
     ._sectionTitleActions  display:inline-flex; gap: var(--space-4);
                            opacity: 0; transition: opacity var(--duration-fast)
     ._sessionSectionTitle:hover ._sectionTitleActions { opacity: 1 }
     ._sessionSectionTitle:focus-within ._sectionTitleActions { opacity: 1 }

     ._sectionIconButton    26×26; border-radius: calc(--radius-sm × squircle)

   菜单选项（i18n key）：
     sidebar.view.sorting  → time / project / agent
     sidebar.view.display  → singleLine / twoLine

   moheng 对应：排序方式（名称/编码/最近使用），显示方式（单行/双行）。
   ============================================================ */

/* 对齐 hana 的排序方式（sidebar.view.time / .project / .agent）：
     time    → 按时间分组（今天 / 本周 / 更早）
     project → 按项目名
        agent 在 moheng 无对应概念，不做。 */
export type SortMode = 'time' | 'status';
export type DisplayMode = 'two-line' | 'single-line';

export type SortMenuProps = {
  sort: SortMode;
  display: DisplayMode;
  onSortChange: (mode: SortMode) => void;
  onDisplayChange: (mode: DisplayMode) => void;
  /** 触发按钮的锚点元素，用于定位 */
  anchor: HTMLElement | null;
  onClose: () => void;
};

const SORT_LABELS: Record<SortMode, string> = {
  time: '按时间',
  status: '按状态',
};

const DISPLAY_LABELS: Record<DisplayMode, string> = {
  'two-line': '双行',
  'single-line': '单行',
};

export function SortMenu({ sort, display, onSortChange, onDisplayChange, anchor, onClose }: SortMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, onClose]);

  const rect = anchor?.getBoundingClientRect();
  const style = rect
    ? { position: 'fixed' as const, top: rect.bottom + 6, right: window.innerWidth - rect.right }
    : {};

  return (
    <div ref={ref} className="sidebar-sort-menu" role="menu" style={style}>
      <div className="sidebar-sort-section">排序</div>
      {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          role="menuitemradio"
          aria-checked={sort === mode}
          className="sidebar-sort-item"
          onClick={() => { onSortChange(mode); onClose(); }}
        >
          <span className="sidebar-sort-item-label">{SORT_LABELS[mode]}</span>
          {sort === mode && <Check size={13} className="sidebar-sort-item-check" />}
        </button>
      ))}

      <div className="sidebar-sort-divider" aria-hidden="true" />

      <div className="sidebar-sort-section">显示</div>
      {(Object.keys(DISPLAY_LABELS) as DisplayMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          role="menuitemradio"
          aria-checked={display === mode}
          className="sidebar-sort-item"
          onClick={() => { onDisplayChange(mode); onClose(); }}
        >
          <span className="sidebar-sort-item-label">{DISPLAY_LABELS[mode]}</span>
          {display === mode && <Check size={13} className="sidebar-sort-item-check" />}
        </button>
      ))}
    </div>
  );
}

/** 分组标题：对齐 hana wC 组件（标题 + 悬停显现的操作区） */
export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="sidebar-section-title">
      <div className="sidebar-section-title-main">{children}</div>
      {actions && <div className="sidebar-section-title-actions">{actions}</div>}
    </div>
  );
}

/** 排序触发按钮 */
export function SortTrigger({ onClick, open }: { onClick: (el: HTMLElement) => void; open: boolean }) {
  return (
    <button
      type="button"
      className="sidebar-section-icon-button"
      aria-label="排序与显示"
      title="排序与显示"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={(event) => onClick(event.currentTarget)}
    >
      <ArrowUpDown size={13} />
    </button>
  );
}
