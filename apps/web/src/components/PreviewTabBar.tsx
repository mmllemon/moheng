/**
 * 预览标签栏 —— 逐字对齐 hana 的 VDe（CardShell-DVSoA_HL.js）。
 *
 *   <div className={tabBar}>
 *     <div className={tabList} data-testid="preview-tab-list" role="tablist" onWheel={横向滚动}>
 *       {openTabs.map(id => (
 *         <div className={`${tab}${active ? ' ' + tabActive : ''}`}
 *              data-preview-tab-id={id} role="tab" aria-selected tabIndex
 *              onClick={激活} onContextMenu={菜单} onDoubleClick={关闭}>
 *           <KindIcon kind size={14} className={tabIcon} />
 *           <span className={tabTitle}>{title}</span>
 *           <span className={tabClose} onClick={关闭}><X size={14} /></span>
 *         </div>
 *       ))}
 *     </div>
 *     <button className={closePanel} title="Collapse" onClick={收起}><ChevronIcon size={14} /></button>
 *   </div>
 *
 * CSS 真值（CardShell-B3PSoerL.css）：
 *   ._tabBar_2e5d8      display:flex; align-items:center; padding:6px 14px 4px; gap:4px; flex-shrink:0
 *   ._tabList_83fb3     display:flex; gap:4px; overflow-x:auto; flex:1; min-width:0; scrollbar-width:none
 *   ._tab_8db96         inline-flex; gap:.35rem; padding:.3rem .55rem; font-size:--fs-hint;
 *                       border:1px solid transparent; border-radius:radius-md×scale; max-width:160px
 *   ._tabActive_a1938   color:--text; background:--bg-card; border-color:--overlay-light;
 *                       box-shadow:--shadow-xs-strong
 *   ._tabTitle_7a948    overflow:hidden; text-overflow:ellipsis; max-width:110px
 *   ._tabIcon_b60b6     flex:0 0 auto; width:14px; height:14px
 *   ._tabClose_95e62    width:20px; height:20px; margin-right:-4px; opacity:.35
 *   ._closePanel_b19b5  margin-left:auto; width:24px; height:24px; opacity:.5
 */

import { ChevronRight, X } from 'lucide-react';
import { useRef } from 'react';
import { FileKindIcon, kindFromExt, type FileKind } from './FileKindIcon';

export type PreviewTab = {
  id: string;
  title: string;
  /** 文件扩展名，用于图标 */
  ext?: string;
  /** 或直接给 kind */
  kind?: FileKind;
};

type Props = {
  tabs: PreviewTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** 收起整个预览（对齐 _closePanel 的 Collapse） */
  onCollapse?: () => void;
};

export function PreviewTabBar({ tabs, activeId, onActivate, onClose, onCollapse }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  /** 滚轮横向滚动 —— 对齐 hana 的 u 回调：
      只处理横向/纵向增量，DOM_DELTA_LINE 乘 32，PAGE 乘 clientWidth。 */
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    if (max <= 0) return;
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const delta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? raw * 32
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? raw * el.clientWidth
          : raw;
    if (delta === 0) return;
    const next = Math.min(max, Math.max(0, el.scrollLeft + delta));
    if (next !== el.scrollLeft) {
      event.preventDefault();
      el.scrollLeft = next;
    }
  };

  return (
    <div className="preview-tab-bar" data-preview-tab-bar>
      <div
        ref={listRef}
        className="preview-tab-list"
        data-preview-tab-list
        role="tablist"
        aria-label="已打开的预览"
        onWheel={onWheel}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`preview-tab${active ? ' is-active' : ''}`}
              data-preview-tab-id={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onActivate(tab.id)}
              onDoubleClick={() => onClose(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(tab.id);
                }
              }}
            >
              <span className="preview-tab-icon">
                <FileKindIcon kind={tab.kind ?? kindFromExt(tab.ext ?? '')} size={14} />
              </span>
              <span className="preview-tab-title">{tab.title}</span>
              <span
                className="preview-tab-close"
                role="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <X size={14} />
              </span>
            </div>
          );
        })}
      </div>
      {/* 收起按钮只在有标签时显示 —— 对齐 hana：_closePanel 跟在 tagList 后面，
          没有标签时整条标签栏不渲染（而不是只留一个孤立的收起按钮）。 */}
      {onCollapse && tabs.length > 0 && (
        <button
          type="button"
          className="preview-tab-collapse"
          title="收起"
          aria-label="收起预览"
          onClick={onCollapse}
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
