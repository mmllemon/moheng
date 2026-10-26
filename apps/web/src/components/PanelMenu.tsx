/**
 * 主内容区右上角的面板菜单。
 *
 * 对齐 hana 的 chalkboard.chat.panel-menu（CardShell 的 Hve 组件）：
 *
 *   触发：一个按钮（Lucide layers 图标，16px）+ 下拉菜单，align: "end"，minWidth: 144
 *   菜单项：preview / terminal / workspace / subProcesses / browser
 *            + 分隔线 + chatViewSerene / chatViewClassic
 *
 *   CSS 真值：
 *     .panelMenu      min-width: 144px; padding: 4px; bg: --bg; border: 1px solid --border;
 *                     radius: calc(--radius-md * scale) = 14.73px; squircle
 *     .panelMenuItem   min-height: 28px; padding: 0 8px; gap: 4px;
 *                     font-size: --fs-ui (13.12px); radius: 9.2px; squircle
 *     .panelMenuIconSlot  16×16; 活动点 5×5 圆点 accent
 *
 * moheng 的菜单项按业务裁剪：
 *   - preview   → 工作区（右侧浮层）开合，保留
 *   - workspace → 工作区文件树展开，与 preview 合并
 *   - terminal / browser / subProcesses → moheng 无对应功能，不做
 *   - chatViewSerene / Classic → moheng 无会话视图模式，不做
 */

import { useEffect, useRef, useState } from 'react';
import { Eye, PanelRight, X } from 'lucide-react';

import { useUiStore } from '../auth-store';
import { PanelMenuIcon } from './PanelIcons';

export function PanelMenu() {
  const workspaceOpen = useUiStore((state) => state.workspaceOpen);
  const setWorkspaceOpen = useUiStore((state) => state.setWorkspaceOpen);
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 点击外部关闭（对齐 hana 的 popover 行为）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const items = [
    {
      id: 'preview',
      label: '预览',
      icon: Eye,
      checked: workspaceOpen,
      disabled: !selectedProjectId,
      onSelect: () => setWorkspaceOpen(!workspaceOpen),
    },
    {
      id: 'workspace',
      label: '工作区',
      icon: PanelRight,
      checked: workspaceOpen,
      disabled: !selectedProjectId,
      onSelect: () => setWorkspaceOpen(!workspaceOpen),
    },
  ];

  return (
    <div className="panel-menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`titlebar-icon ${open ? 'is-active' : ''}`}
        aria-label="面板菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="面板"
        onClick={() => setOpen((prev) => !prev)}
      >
        {/* 对齐 hana 的菜单按钮图标：Lucide layers，size 16（fD → koe） */}
        <PanelMenuIcon size={16} />
        {workspaceOpen && <span className="panel-menu-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="panel-menu" role="menu" aria-label="面板菜单">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.checked}
                disabled={item.disabled}
                className="panel-menu-item"
                onClick={() => { item.onSelect(); setOpen(false); }}
              >
                <span className="panel-menu-icon" data-checked={item.checked || undefined}>
                  <Icon size={15} />
                </span>
                <span className="panel-menu-label">{item.label}</span>
                {item.checked && <span className="panel-menu-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
