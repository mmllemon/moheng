/**
 * 窗口控制区。
 *
 * 对齐 hana 的 ._windowControlsIsland_5f7ae：
 *
 *   position: fixed;
 *   top: calc(var(--panel-edge-gap) + var(--card-border-width, 1px)
 *             + var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px));
 *   right: calc(同上);
 *   display: flex;
 *   gap: 0;
 *   box-shadow: var(--titlebar-action-shadow);
 *
 * 里面有：
 *   窗口按钮（最小化 / 最大化 / 关闭）—— data-window-control
 *   moheng 的系统按钮（搜索 / 待办 / 助手 / 快捷 / 设置 / 头像）
 *
 * 与卡片的关系：
 *   `wot` 测量卡片右缘到本区左缘的距离，作为顶栏右侧让位量：
 *     function wot(cardRect, wcRect) {
 *       const overlapY = cardRect.top < wcRect.bottom && cardRect.top + 44 > wcRect.top;
 *       const overlapX = cardRect.left < wcRect.right && cardRect.right > wcRect.left;
 *       if (!overlapY || !overlapX) return null;
 *       return Math.max(0, Math.round(cardRect.right - (wcRect.left - 4)));
 *     }
 *
 * Web 环境没有原生窗口按钮，但按用户要求「A 方案」仍然渲染容器，
 * 只放系统按钮，保持视觉一致。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, LogOut, Minus, Search, ShieldCheck, SlidersHorizontal, Square, Sparkles, UserRound, X, Zap, ArrowUpRight, BellRing } from 'lucide-react';

import { useAuthStore, useUiStore } from '../auth-store';
import type { Project } from '../types';
import SelectField from './SelectField';
import UiPreferencesBar from './UiPreferencesBar';
import { Button } from './Ui';

/** 把本元素注册到 windowControlsRegistry，供 wot 测量 */
const REGISTRY = new WeakMap<Document, HTMLElement>();
export function getWindowControlsIsland(doc: Document = document): HTMLElement | null {
  return REGISTRY.get(doc) ?? null;
}

type Props = {
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  isGlobalContext: boolean;
  location: { pathname: string };
  navigate: (to: string) => void;
  openCommandPalette: () => void;
  quickActionsOpen: boolean;
  setQuickActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  quickActionsPresence: { mounted: boolean; visible: boolean };
  quickActionCategory: string;
  setQuickActionCategory: (key: string) => void;
  quickActionCategories: Array<{ key: string; label: string }>;
  visibleQuickActions: Array<{ title: string; description: string; to: string; icon: React.ComponentType<{ size?: number }> }>;
  accountMenuOpen: boolean;
  setAccountMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  assistantEnabled: boolean;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  rememberPaperOrigin: (el: HTMLElement) => void;
  logout: () => Promise<void> | void;
};

export function WindowControls(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    REGISTRY.set(el.ownerDocument, el);
    // Electron 环境才有原生窗口按钮
    setIsDesktop(typeof window !== 'undefined' && Boolean((window as unknown as { platform?: unknown }).platform));
    return () => { REGISTRY.delete(el.ownerDocument); };
  }, []);

  const {
    projects, selectedProjectId, setSelectedProjectId, isGlobalContext, location, navigate,
    openCommandPalette, quickActionsOpen, setQuickActionsOpen, quickActionsPresence,
    quickActionCategory, setQuickActionCategory, quickActionCategories, visibleQuickActions,
    accountMenuOpen, setAccountMenuOpen, assistantEnabled, assistantOpen, setAssistantOpen,
    setCommandPaletteOpen, rememberPaperOrigin, logout,
  } = props;

  const user = useAuthStore((state) => state.user);

  return createPortal(
    <div
      ref={ref}
      className="window-controls-island"
      data-window-controls
      data-window-titlebar-controls={isDesktop || undefined}
    >
      <div className="titlebar-cluster">
        <button type="button" className="titlebar-icon" onClick={openCommandPalette} data-tooltip="搜索与命令 ⌘K" aria-label="打开全局搜索"><Search size={15} /></button>
        <button type="button" className={`titlebar-icon ${location.pathname === '/notifications' ? 'is-active' : ''}`} onClick={() => navigate('/notifications')} data-tooltip="待办与预警" aria-label="打开待办与预警"><BellRing size={15} /></button>
        {assistantEnabled && <button type="button" className={`titlebar-icon ${assistantOpen ? 'is-active' : ''}`} data-tooltip="成本助手" aria-label="打开成本助手" aria-expanded={assistantOpen} onClick={() => { setCommandPaletteOpen(false); setQuickActionsOpen(false); setAccountMenuOpen(false); setAssistantOpen(true); }}><Sparkles size={15} /></button>}
        <div className="quick-actions-wrap">
          <button type="button" className={`titlebar-icon ${quickActionsOpen ? 'is-active' : ''}`} data-tooltip="快捷操作" aria-label="打开快捷操作" aria-expanded={quickActionsOpen} aria-controls="quick-actions-panel" onClick={() => { setCommandPaletteOpen(false); setAccountMenuOpen(false); setQuickActionCategory('all'); setQuickActionsOpen((open) => !open); }}><Zap size={15} /></button>
          {quickActionsOpen && <button type="button" className="quick-action-dismiss" aria-label="关闭快捷操作" onClick={() => setQuickActionsOpen(false)} />}
          {quickActionsPresence.mounted && (
            <div id="quick-actions-panel" className={`quick-action-panel ${quickActionsPresence.visible ? 'is-visible' : 'is-closing'}`} role="dialog" aria-label="快捷操作" aria-hidden={!quickActionsOpen} data-focus-trap={quickActionsOpen ? 'popover' : undefined}>
              <div className="quick-action-tabs" role="tablist" aria-label="快捷操作分类" onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
                if (currentIndex < 0) return;
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
                event.preventDefault();
                tabs[nextIndex]?.focus();
                tabs[nextIndex]?.click();
              }}>
                {quickActionCategories.map((category) => <button key={category.key} type="button" role="tab" tabIndex={quickActionCategory === category.key ? 0 : -1} aria-selected={quickActionCategory === category.key} className={quickActionCategory === category.key ? 'is-active' : ''} onClick={() => setQuickActionCategory(category.key)}>{category.label}</button>)}
                <Button
              variant="ghost"
              size="icon"
              className="quick-action-close"
              aria-label="关闭快捷操作"
              onClick={() => setQuickActionsOpen(false)}
            >
              <X size={15} />
            </Button>
              </div>
              <div className="quick-action-heading"><div><strong>常用业务入口</strong><span>按当前项目进入对应工作台</span></div><span className="quick-action-count">{visibleQuickActions.length} 项</span></div>
              <div className="quick-action-grid" role="tabpanel" aria-label={quickActionCategories.find((category) => category.key === quickActionCategory)?.label ?? '全部'}>
                {visibleQuickActions.map((action) => { const Icon = action.icon; return <button type="button" className="quick-action-item" key={action.title} onClick={() => { navigate(action.to); setQuickActionsOpen(false); }}><span className="quick-action-icon"><Icon size={16} /></span><span className="quick-action-copy"><strong>{action.title}</strong><small>{action.description}</small></span><ChevronRight size={15} className="quick-action-arrow" /></button>; })}
              </div>
              <div className="quick-action-foot"><span>进入成本工作台后可按项目切换</span><button type="button" onClick={() => { navigate('/cost'); setQuickActionsOpen(false); }}>打开工作台<ArrowUpRight size={13} /></button></div>
            </div>
          )}
        </div>
        <UiPreferencesBar compact />
        <div className="account-menu-wrap">
          <button type="button" className={`titlebar-avatar ${accountMenuOpen ? 'is-active' : ''}`} aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-label={`账号菜单：${user?.name ?? '用户'}`} data-tooltip={user?.name ?? '账号'} data-tooltip-align="end" onClick={() => { setQuickActionsOpen(false); setAccountMenuOpen((open) => !open); }}><UserRound size={15} strokeWidth={1.7} /></button>
          {accountMenuOpen && <>
            <button type="button" className="account-menu-dismiss" aria-label="关闭账号菜单" onClick={() => setAccountMenuOpen(false)} />
            <div className="account-menu" role="menu" aria-label="个人账号菜单" data-focus-trap={accountMenuOpen ? 'popover' : undefined}>
              <div className="account-menu-identity"><strong>{user?.name ?? '用户'}</strong><span>{user?.email ?? ''}</span><small>{user?.role === 'ADMIN' ? '系统管理员' : '普通成员'}</small></div>
              <button type="button" role="menuitem" onClick={() => { navigate('/account/security'); setAccountMenuOpen(false); }}><UserRound size={15} /><span>个人中心与账号安全</span></button>
              {user?.role === 'ADMIN' && <button type="button" role="menuitem" onClick={() => { navigate('/system/security'); setAccountMenuOpen(false); }}><ShieldCheck size={15} /><span>登录安全中心</span></button>}
              {user?.role === 'ADMIN' && <button type="button" role="menuitem" onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/system'); setAccountMenuOpen(false); }}><SlidersHorizontal size={15} /><span>系统设置</span></button>}
              <button type="button" role="menuitem" className="account-menu-logout" onClick={() => { setAccountMenuOpen(false); void logout(); }}><LogOut size={15} /><span>退出登录</span></button>
            </div>
          </>}
        </div>
      </div>

      {/* 窗口按钮：对齐 hana 的 data-window-control ——
          最小化 / 最大化 / 关闭。Web 环境下不渲染（没有原生窗口）。 */}
      {isDesktop && (
        <div className="window-controls-buttons">
          <button type="button" className="window-control-btn" data-window-control="minimize" aria-label="最小化" tabIndex={-1} onClick={() => (window as unknown as { platform?: { windowMinimize?: () => void } }).platform?.windowMinimize?.()}><Minus size={14} /></button>
          <button type="button" className="window-control-btn" data-window-control="maximize" aria-label="最大化" tabIndex={-1} onClick={() => (window as unknown as { platform?: { windowMaximize?: () => void } }).platform?.windowMaximize?.()}><Square size={12} /></button>
          <button type="button" className="window-control-btn" data-window-control="close" aria-label="关闭" tabIndex={-1} onClick={() => (window as unknown as { platform?: { windowClose?: () => void } }).platform?.windowClose?.()}><X size={14} /></button>
        </div>
      )}
    </div>,
    document.body,
  );
}
