import SelectField from './SelectField';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, BookOpen, ChevronRight, ClipboardList, FileText, FolderKanban,
  HandCoins, LayoutDashboard, LogOut, Menu, Search, SlidersHorizontal, Wallet, Workflow, Zap, UserCog, History, ReceiptText,
  ArrowUpRight, Command, CornerDownLeft, Keyboard, X, BellRing, FileSpreadsheet, Users,
  ShieldCheck, UserRound, ServerCog, Sparkles, PanelLeft, PanelLeftClose, Plus, Palette, Settings,
} from 'lucide-react';
import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import type { Project } from '../types';

import BrandMark from './BrandMark';
import ConfirmHost from './ConfirmDialog';
import ToastHost from './ToastHost';
import FocusTrap from './FocusTrap';
import PaperDialogMorph from './PaperDialogMorph';
import UiPreferencesBar from './UiPreferencesBar';
import { useAnimatedPresence } from './useAnimatedPresence';
import { animatePaperIn, animatePaperOut, rememberPaperOrigin, takePaperOrigin } from '../lib/paper-morph';
import { useDetachedPanelHeaders } from '../lib/use-detached-panel-headers';

type NavigationItem = { to: string; label: string; icon: typeof LayoutDashboard; group: '经营中心' | '工作台' | '项目管理' | '系统管理'; end?: boolean; adminOnly?: boolean };
const navigation: NavigationItem[] = [
  { to: '/', label: '经营总览', icon: LayoutDashboard, group: '经营中心', end: true },
  { to: '/reports', label: '报表中心', icon: FileSpreadsheet, group: '经营中心', end: true },
  { to: '/notifications', label: '待办与预警', icon: BellRing, group: '经营中心', end: true },
  { to: '/parties', label: '往来单位库', icon: Building2, group: '经营中心', end: false },
  { to: '/cost', label: '成本工作台', icon: ClipboardList, group: '工作台', end: false },
  { to: '/projects', label: '项目档案', icon: FolderKanban, group: '项目管理', end: true },
  { to: '/projects/members', label: '项目成员与权限', icon: Users, group: '项目管理', end: true },
  { to: '/system', label: '系统管理', icon: SlidersHorizontal, group: '系统管理', end: false, adminOnly: true },
];
const assistantNavigationItem: NavigationItem = { to: '/cost/assistant', label: '成本助手', icon: Sparkles, group: '工作台', end: true };
const systemNavigation: NavigationItem[] = [
  { to: '/system', label: '概览', icon: LayoutDashboard, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/accounts', label: '账号管理', icon: UserCog, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/security', label: '登录安全', icon: ShieldCheck, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/authorization', label: '授权复核', icon: Users, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/policies', label: '权限与流程', icon: Workflow, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/governance', label: '组织规则', icon: Workflow, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/dictionaries', label: '基础字典', icon: BookOpen, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/parameters', label: '参数配置', icon: SlidersHorizontal, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/assistant', label: 'AI 助手', icon: Sparkles, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/operations', label: '运维备份', icon: ServerCog, group: '系统管理', end: true, adminOnly: true },
  { to: '/audit-logs', label: '操作追溯', icon: History, group: '系统管理', end: true, adminOnly: true },
];
const appearanceSettingsItem: NavigationItem = { to: '/settings/appearance', label: '界面', icon: Palette, group: '系统管理', end: true };
const systemGroups = [
  { label: '系统', items: systemNavigation.slice(0, 3) },
  { label: '权限与规则', items: systemNavigation.slice(3, 5) },
  { label: '组织与数据', items: systemNavigation.slice(5, 8) },
  { label: '智能与运维', items: systemNavigation.slice(8) },
];
const primaryGroups: NavigationItem['group'][] = ['经营中心', '工作台', '项目管理'];
const costWorkspacePages = [
  { to: '/cost', label: '项目驾驶舱' },
  { to: '/cost/contracts', label: '业主主合同' },
  { to: '/cost/budget', label: '预算与目标成本' },
  { to: '/cost/progress-bills', label: '进度款管理' },
  { to: '/cost/changes', label: '变更签证' },
  { to: '/cost/owner-finance', label: '竣工结算与应收' },
  { to: '/cost/downstream', label: '分供合同与结算' },
  { to: '/cost/costs', label: '实际成本录入' },
  { to: '/cost/analysis', label: '成本分析' },
];
type QuickItem = { kind: 'page' | 'project'; id: string; title: string; sub: string; to: string };
type QuickActionCategory = 'all' | 'cost' | 'funds' | 'contract';
const quickActionCategories: Array<{ key: QuickActionCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'cost', label: '成本' },
  { key: 'funds', label: '资金' },
  { key: 'contract', label: '合同' },
];
const quickActions: Array<{ category: Exclude<QuickActionCategory, 'all'>; title: string; description: string; to: string; icon: typeof Wallet }> = [
  { category: 'cost', title: '新增成本记录', description: '登记人工、材料、机械及其他费用', to: '/cost/costs', icon: Wallet },
  { category: 'funds', title: '进度款管理', description: '业主申报、审批与回款登记', to: '/cost/progress-bills', icon: HandCoins },
  { category: 'funds', title: '竣工结算与应收', description: '最终结算、应收余额与到账核销', to: '/cost/owner-finance', icon: ReceiptText },
  { category: 'contract', title: '分供合同与付款', description: '分包 / 采购 / 租赁合同与支付台账', to: '/cost/downstream', icon: FileText },
  { category: 'funds', title: '结算与应付账款', description: '确认结算、应付核销、质保金与发票核对', to: '/cost/downstream?view=finance', icon: ReceiptText },
  { category: 'contract', title: '变更签证', description: '查看送审与核定状态', to: '/cost/changes', icon: Workflow },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const [quickSearch, setQuickSearch] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const commandPalettePresence = useAnimatedPresence(commandPaletteOpen, 210);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [quickActionCategory, setQuickActionCategory] = useState<QuickActionCategory>('all');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settingsNavOpen, setSettingsNavOpen] = useState(false);
  const quickActionsPresence = useAnimatedPresence(quickActionsOpen, 180);
  useDetachedPanelHeaders();
  const commandInputRef = useRef<HTMLInputElement>(null);
  const settingsWindowRef = useRef<HTMLElement>(null);
  const settingsOriginRef = useRef<HTMLElement | null>(null);
  const settingsBarRef = useRef<HTMLDivElement>(null);
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const settingsScrollbarRef = useRef<HTMLDivElement>(null);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const projects = projectsQuery.data ?? [];
  useEffect(() => {
    if (!projects.length) { if (selectedProjectId) setSelectedProjectId(null); return; }
    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId, setSelectedProjectId]);

  const activeProject = projects.find((project) => project.id === selectedProjectId);
  useEffect(() => {
    let current = true;
    api.get<{ enabled: boolean }>('/assistant-poc/status').then((status) => { if (current) setAssistantEnabled(Boolean(status.enabled)); }).catch(() => { if (current) setAssistantEnabled(false); });
    return () => { current = false; };
  }, [user?.id]);
  const navigationWithAssistant = assistantEnabled ? [...navigation, assistantNavigationItem] : navigation;
  useEffect(() => { setMobileNavOpen(false); setSettingsNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileNavOpen(false);
      if (window.innerWidth > 760) setSettingsNavOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (!settingsNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsNavOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsNavOpen]);
  useEffect(() => {
    for (const element of [settingsBarRef.current, settingsContentRef.current]) {
      if (!element) continue;
      if (settingsNavOpen) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    }
  }, [settingsNavOpen]);
  useEffect(() => {
    const closeTopDialog = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.date-picker-popover, .select-popover, .quick-action-panel, .account-menu')) return;
      const backdrop = document.querySelector<HTMLElement>('.modal-backdrop');
      if (!backdrop) return;
      const closeButton = backdrop.querySelector<HTMLButtonElement>('.dialog-header .icon-button, .dialog-header button[aria-label*="关闭"], .dialog-close');
      if (closeButton) { closeButton.click(); event.preventDefault(); }
    };
    document.addEventListener('keydown', closeTopDialog);
    return () => document.removeEventListener('keydown', closeTopDialog);
  }, []);
  useEffect(() => {
    const closeTransientLayers = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.date-picker-popover, .select-popover')) return;
      if (quickActionsOpen) { setQuickActionsOpen(false); event.preventDefault(); return; }
      if (accountMenuOpen) { setAccountMenuOpen(false); event.preventDefault(); return; }
      if (mobileNavOpen) { setMobileNavOpen(false); event.preventDefault(); }
    };
    document.addEventListener('keydown', closeTransientLayers);
    return () => document.removeEventListener('keydown', closeTransientLayers);
  }, [quickActionsOpen, accountMenuOpen, mobileNavOpen]);

  const quickItems = useMemo<QuickItem[]>(() => {
    const text = quickSearch.trim().toLocaleLowerCase();
    const pages = [...navigationWithAssistant.filter((item) => !item.adminOnly || user?.role === 'ADMIN'), ...(user?.role === 'ADMIN' ? systemNavigation.filter((item) => item.to !== '/system') : []), ...costWorkspacePages.filter((page) => page.to !== '/cost')]
      .filter((item) => (!text || item.label.toLocaleLowerCase().includes(text)))
      .map((item) => ({ kind: 'page' as const, id: item.to, title: item.label, sub: '页面直达', to: item.to }));
    const projectItems = projects
      .filter((project) => !text || `${project.name} ${project.code}`.toLocaleLowerCase().includes(text))
      .slice(0, 5)
      .map((project) => ({ kind: 'project' as const, id: project.id, title: project.name, sub: project.code, to: '/cost' }));
    if (!text) return [...pages.slice(0, 5), ...projectItems.slice(0, 3)];
    return [...pages, ...projectItems].slice(0, 10);
  }, [projects, quickSearch, user?.role]);

  useEffect(() => { setActiveCommandIndex(0); }, [quickSearch]);
  useEffect(() => { if (commandPaletteOpen) commandInputRef.current?.focus(); }, [commandPaletteOpen]);

  function openCommandPalette() {
    setQuickActionsOpen(false);
    setQuickSearch('');
    setActiveCommandIndex(0);
    setCommandPaletteOpen(true);
  }
  function executeQuickItem(item: QuickItem) {
    if (item.kind === 'project') setSelectedProjectId(item.id);
    navigate(item.to);
    setCommandPaletteOpen(false);
    setQuickActionsOpen(false);
    setQuickSearch('');
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else openCommandPalette();
        return;
      }
      if (commandPaletteOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setCommandPaletteOpen(false); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); setActiveCommandIndex((index) => quickItems.length ? (index + 1) % quickItems.length : 0); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveCommandIndex((index) => quickItems.length ? (index - 1 + quickItems.length) % quickItems.length : 0); return; }
        if (event.key === 'Enter' && quickItems[activeCommandIndex]) { event.preventDefault(); executeQuickItem(quickItems[activeCommandIndex]); return; }
        return;
      }
      if (event.key === 'Escape') { setQuickActionsOpen(false); return; }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeRow = active?.tagName === 'TR' ? active : null;
      const pageHasFocus = active === document.body || active === document.documentElement || activeRow !== null;
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.data-table tbody tr, .owner-finance-table tbody tr'));
      if (!rows.length || !pageHasFocus) return;
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'arrowdown' || key === 'k' || key === 'arrowup') {
        event.preventDefault();
        const currentIndex = activeRow ? rows.indexOf(activeRow) : -1;
        const down = key === 'j' || key === 'arrowdown';
        const nextIndex = currentIndex < 0 ? (down ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, currentIndex + (down ? 1 : -1)));
        const next = rows[nextIndex];
        if (next) { next.tabIndex = -1; next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      } else if (event.key === 'Enter' && activeRow) {
        event.preventDefault();
        const actionable = activeRow.querySelector<HTMLElement>('button, a[href], [role="button"]');
        if (actionable) actionable.click(); else activeRow.click();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, quickItems, activeCommandIndex]);

  const isGlobalContext = location.pathname === '/' || location.pathname === '/audit-logs' || location.pathname === '/account/security' || location.pathname.startsWith('/parties') || location.pathname.startsWith('/reports') || ['/notifications', '/projects', '/projects/members'].includes(location.pathname);
  const isPartyDetail = /^\/parties\/[^/]+/.test(location.pathname);
  const isSystemArea = user?.role === 'ADMIN' && (location.pathname.startsWith('/system') || location.pathname === '/audit-logs');
  const isSettingsArea = location.pathname.startsWith('/settings') || isSystemArea;
  useLayoutEffect(() => {
    if (!isSettingsArea) return;
    if (settingsOriginRef.current === null) settingsOriginRef.current = takePaperOrigin();
    return animatePaperIn(settingsWindowRef.current, settingsOriginRef.current);
  }, [isSettingsArea]);
  useEffect(() => { if (!isSettingsArea) settingsOriginRef.current = null; }, [isSettingsArea]);
  useEffect(() => {
    if (!isSettingsArea) return;
    const content = settingsContentRef.current;
    const bar = settingsScrollbarRef.current;
    const thumb = bar?.firstElementChild as HTMLElement | null;
    if (!content || !bar || !thumb) return;
    const update = () => {
      if (content.scrollHeight <= content.clientHeight + 1) {
        bar.style.display = 'none';
        return;
      }
      bar.style.display = 'block';
      const trackHeight = Math.max(1, content.clientHeight - 16);
      const thumbHeight = Math.max(28, Math.round(trackHeight * (content.clientHeight / content.scrollHeight)));
      const maxScroll = Math.max(1, content.scrollHeight - content.clientHeight);
      const maxTop = Math.max(0, trackHeight - thumbHeight);
      const top = Math.round((content.scrollTop / maxScroll) * maxTop);
      thumb.style.height = thumbHeight + 'px';
      thumb.style.transform = 'translateY(' + top + 'px)';
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startScroll = content.scrollTop;
      const maxScroll = Math.max(1, content.scrollHeight - content.clientHeight);
      const trackHeight = Math.max(1, content.clientHeight - 16);
      const thumbHeight = Math.max(28, Math.round(trackHeight * (content.clientHeight / content.scrollHeight)));
      const maxTop = Math.max(1, trackHeight - thumbHeight);
      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientY - startY;
        content.scrollTop = Math.max(0, Math.min(maxScroll, startScroll + (delta / maxTop) * maxScroll));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    bar.addEventListener('pointerdown', onPointerDown);
    content.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(content);
    const mutation = new MutationObserver(update);
    mutation.observe(content, { childList: true, subtree: true, characterData: true });
    const timer = window.setTimeout(update, 260);
    update();
    return () => {
      bar.removeEventListener('pointerdown', onPointerDown);
      content.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer.disconnect();
      mutation.disconnect();
      window.clearTimeout(timer);
    };
  }, [isSettingsArea, location.pathname]);
  const closeSettings = () => {
    if (animatePaperOut(settingsWindowRef.current, settingsOriginRef.current, () => { settingsOriginRef.current = null; navigate('/'); })) return;
    settingsOriginRef.current = null;
    navigate('/');
  };
  useEffect(() => {
    if (!isSettingsArea) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.date-picker-popover, .select-popover')) return;
      if (settingsNavOpen) { event.preventDefault(); setSettingsNavOpen(false); return; }
      event.preventDefault();
      closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSettingsArea, settingsNavOpen]);
  const costPageLabel = location.pathname === '/cost/assistant' ? '成本助手' : location.pathname === '/cost/downstream' && new URLSearchParams(location.search).get('view') === 'finance' ? '结算与应付账款' : costWorkspacePages.find((item) => item.to === location.pathname)?.label;
  const currentPageLabel = costPageLabel ?? systemNavigation.find((item) => item.to === location.pathname)?.label ?? navigation.find((item) => item.to === location.pathname)?.label ?? (location.pathname === '/settings/appearance' ? '界面' : isPartyDetail ? '单位经营档案' : location.pathname === '/parties' ? '往来单位库' : location.pathname === '/projects/members' ? '项目成员与权限' : location.pathname === '/account/security' ? '个人中心与账号安全' : '工作台');
  const availableSettingsGroups = user?.role === 'ADMIN' ? systemGroups : [{ label: '个人', items: [appearanceSettingsItem] }];
  const isAppearanceSettings = location.pathname === '/settings/appearance';
  const visibleSettingsGroups = availableSettingsGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !settingsSearch.trim() || item.label.toLocaleLowerCase().includes(settingsSearch.trim().toLocaleLowerCase())),
  })).filter((group) => group.items.length);
  const visibleQuickActions = quickActionCategory === 'all' ? quickActions : quickActions.filter((action) => action.category === quickActionCategory);


  useEffect(() => {
    if (!isSettingsArea) return;
    setSettingsSearch('');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.date-picker-popover, .select-popover, .modal-backdrop, .command-palette-layer.is-visible')) {
        event.preventDefault();
        navigate('/');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isSettingsArea, navigate]);

  async function logout() {
    try { await api.logout(); } catch { /* The local session is cleared even if the network is unavailable. */ }
    clearSession();
    setSelectedProjectId(null);
    navigate('/login');
  }

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <button type="button" className="mobile-nav-backdrop" aria-label="关闭主导航" onClick={() => setMobileNavOpen(false)} style={{ display: mobileNavOpen ? 'block' : 'none' }} />
    <aside className={'app-sidebar' + (mobileNavOpen ? ' mobile-nav-open' : '')} id="main-navigation" aria-label="主导航" data-focus-trap={mobileNavOpen ? 'modal' : undefined}>
      <div className="app-sidebar-titlebar">
        <button type="button" className="sidebar-toggle" onClick={toggleSidebar} data-tooltip={collapsed ? '展开导航' : '收起导航'} aria-label={collapsed ? '展开导航' : '收起导航'}>{collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}</button>
        <button type="button" className="sidebar-toggle" onClick={openCommandPalette} data-tooltip="搜索与命令" aria-label="侧栏搜索"><Search size={16} /></button>
        <span className="sidebar-toolbar-spacer" />
      </div>
      <div className="app-sidebar-profile">
        <span className="sidebar-brand-mark"><BrandMark /></span>
        <div className="sidebar-wordmark"><strong>墨衡</strong><span>工程经营管理</span></div>
        <button type="button" className="sidebar-profile-action" onClick={() => navigate('/projects')} data-tooltip="项目档案" aria-label="打开项目档案"><FolderKanban size={14} /></button>
      </div>
      <div className="app-sidebar-scroll">
        <nav aria-label="业务导航">
          {primaryGroups.map((group) => <div className="sidebar-nav-group" key={group}>
            <div className="sidebar-group-title"><span>{group}</span></div>
            {navigationWithAssistant.filter((item) => item.group === group && (!item.adminOnly || user?.role === 'ADMIN')).map((item) => {
              const Icon = item.icon;
              return <NavLink key={item.to} to={item.to} end={item.end ?? false} title={item.label} aria-label={item.label} className={({ isActive }) => `sidebar-nav-link ${isActive ? 'active' : ''}`}>
                <Icon size={16} strokeWidth={1.65} /><span>{item.label}</span>
              </NavLink>;
            })}
          </div>)}
        </nav>
        <section className="sidebar-projects" aria-label="快速切换项目">
          <div className="sidebar-group-title"><span>项目</span><button type="button" className="sidebar-project-all" onClick={() => navigate('/projects')} aria-label="管理项目"><Plus size={12} /></button></div>
          <div className="sidebar-project-list">
            {projectsQuery.isLoading ? <div className="sidebar-project-empty">正在加载项目…</div> : projects.length === 0 ? <div className="sidebar-project-empty">暂无可访问项目</div> : projects.slice(0, 4).map((project) => <button type="button" key={project.id} className={`sidebar-project ${project.id === activeProject?.id ? 'is-active' : ''}`} onClick={() => { setSelectedProjectId(project.id); navigate('/cost'); }} title={`${project.name} · ${project.code}`}>
              <span className="sidebar-project-mark">{project.name.slice(0, 1)}</span>
              <span className="sidebar-project-copy"><strong>{project.name}</strong><small>{project.code}</small></span>
            </button>)}
          </div>
          {projects.length > 4 && <button type="button" className="sidebar-project-all" onClick={() => navigate('/projects')}>查看全部 {projects.length} 个项目<ChevronRight size={11} /></button>}
        </section>
      </div>
      <div className="app-sidebar-footer">
        <div className="sidebar-user-row">
          <div className="sidebar-user-avatar">{user?.name?.slice(0, 1) ?? '管'}</div>
          <div className="sidebar-user-copy"><strong>{user?.name ?? '用户'}</strong><span>{user?.role === 'ADMIN' ? '系统管理员' : '项目成员'}</span></div>
          <div className="sidebar-footer-actions">
            {user?.role === 'ADMIN' && <button type="button" data-tooltip="系统设置" data-tooltip-align="end" aria-label="系统设置" className="sidebar-footer-icon" onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/system'); }}><Settings size={15} /></button>}
            <button data-tooltip="退出登录" data-tooltip-align="end" aria-label="退出登录" className="sidebar-footer-icon" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </div>
    </aside>

    <div className="app-main">
      <header className="app-titlebar">
        {collapsed && <button type="button" className="titlebar-icon titlebar-restore" onClick={toggleSidebar} data-tooltip="展开导航" aria-label="展开导航"><PanelLeft size={17} /></button>}
        <button type="button" className="titlebar-icon titlebar-mobile-menu" data-tooltip={mobileNavOpen ? '关闭主导航' : '打开主导航'} aria-label={mobileNavOpen ? '关闭主导航' : '打开主导航'} aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={17} /> : <Menu size={17} />}</button>
        <div className="titlebar-context">
          <span className="titlebar-wordmark">MOHENG</span><span className="titlebar-separator">/</span><strong>{currentPageLabel}</strong>
          {!isGlobalContext && activeProject && <><span className="titlebar-separator">·</span><span className="titlebar-project-code">{activeProject.code}</span></>}
        </div>
        <div className="titlebar-actions">
          {isGlobalContext ? <span className="titlebar-global-scope"><i />全公司</span> : <div className="titlebar-project"><SelectField value={selectedProjectId ?? ''} onChange={(event) => setSelectedProjectId(event.target.value || null)} aria-label="切换当前项目">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</SelectField></div>}
          <div className="titlebar-cluster">
            <button type="button" className="titlebar-icon" onClick={openCommandPalette} data-tooltip="搜索与命令 ⌘K" aria-label="打开全局搜索"><Search size={15} /></button>
            <button type="button" className={`titlebar-icon ${location.pathname === '/notifications' ? 'is-active' : ''}`} onClick={() => navigate('/notifications')} data-tooltip="待办与预警" aria-label="打开待办与预警"><BellRing size={15} /></button>
            <div className="quick-actions-wrap">
              <button type="button" className={`titlebar-icon ${quickActionsOpen ? 'is-active' : ''}`} data-tooltip="快捷操作" aria-label="打开快捷操作" aria-expanded={quickActionsOpen} aria-controls="quick-actions-panel" onClick={() => { setCommandPaletteOpen(false); setAccountMenuOpen(false); setQuickActionCategory('all'); setQuickActionsOpen((open) => !open); }}><Zap size={15} /></button>
              {quickActionsOpen && <button type="button" className="quick-action-dismiss" aria-label="关闭快捷操作" onClick={() => setQuickActionsOpen(false)} />}
              {quickActionsPresence.mounted && <div id="quick-actions-panel" className={`quick-action-panel ${quickActionsPresence.visible ? 'is-visible' : 'is-closing'}`} role="dialog" aria-label="快捷操作" aria-hidden={!quickActionsOpen} data-focus-trap={quickActionsOpen ? 'popover' : undefined}>
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
                  <button type="button" className="quick-action-close" aria-label="关闭快捷操作" onClick={() => setQuickActionsOpen(false)}><X size={15} /></button>
                </div>
                <div className="quick-action-heading"><div><strong>常用业务入口</strong><span>按当前项目进入对应工作台</span></div><span className="quick-action-count">{visibleQuickActions.length} 项</span></div>
                <div className="quick-action-grid" role="tabpanel" aria-label={quickActionCategories.find((category) => category.key === quickActionCategory)?.label ?? '全部'}>
                  {visibleQuickActions.map((action) => { const Icon = action.icon; return <button type="button" className="quick-action-item" key={action.title} onClick={() => { navigate(action.to); setQuickActionsOpen(false); }}><span className="quick-action-icon"><Icon size={16} /></span><span className="quick-action-copy"><strong>{action.title}</strong><small>{action.description}</small></span><ChevronRight size={15} className="quick-action-arrow" /></button>; })}
                </div>
                <div className="quick-action-foot"><span>进入成本工作台后可按项目切换</span><button type="button" onClick={() => { navigate('/cost'); setQuickActionsOpen(false); }}>打开工作台<ArrowUpRight size={13} /></button></div>
              </div>}
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
        </div>
      </header>

      <main className="app-content" aria-hidden={isSettingsArea ? true : undefined}>
        {isSettingsArea ? <div className="settings-underlay" aria-hidden="true" /> : <div className="route-transition" key={location.pathname}><Outlet /></div>}
      </main>
      <FocusTrap />
      <PaperDialogMorph />
      <ConfirmHost />
      <ToastHost />
    </div>

    {isSettingsArea && <div className="settings-overlay" role="presentation">
      <section ref={settingsWindowRef} className={`settings-window ${settingsNavOpen ? 'is-mobile-nav-open' : ''} ${isAppearanceSettings ? 'is-appearance-only' : ''}`} role="dialog" aria-modal="true" aria-label="设置" data-focus-trap="modal">
        <div ref={settingsBarRef} className="settings-mobile-bar">
          <button type="button" className="settings-mobile-nav-trigger" aria-expanded={settingsNavOpen} aria-controls="settings-navigation" onClick={() => setSettingsNavOpen(true)}>
            <PanelLeft size={16} /><span>{currentPageLabel}</span><ChevronRight size={14} />
          </button>
          <button type="button" className="settings-close" onClick={closeSettings} aria-label="关闭设置"><X size={16} /></button>
        </div>
        <button type="button" className="settings-close settings-close-floating" onClick={closeSettings} aria-label="关闭设置"><X size={16} /></button>
        <div className={`settings-body ${isAppearanceSettings ? 'is-appearance-only' : ''}`}>
          {settingsNavOpen && <button type="button" tabIndex={-1} className="settings-mobile-nav-backdrop" aria-label="关闭设置导航" onClick={() => setSettingsNavOpen(false)} />}
          <nav id="settings-navigation" className={`settings-nav ${settingsNavOpen ? 'is-mobile-open' : ''}`} aria-label="设置导航">
            <div className="settings-mobile-drawer-head"><span>设置</span><button type="button" onClick={() => setSettingsNavOpen(false)} aria-label="关闭设置导航"><X size={15} /></button></div>
            <div className="settings-search"><Search size={14} /><input value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)} placeholder="搜索设置" aria-label="搜索设置" type="search" /></div>
            <div className="settings-groups">
              {visibleSettingsGroups.length ? visibleSettingsGroups.map((group) => <section className="settings-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = item.to === '/system' ? location.pathname === '/system' : location.pathname === item.to;
                  return <NavLink key={item.to} to={item.to} end={item.end ?? false} onClick={() => setSettingsNavOpen(false)} data-autofocus={isCurrent ? 'true' : undefined} className={({ isActive }) => `settings-nav-link ${isActive ? 'active' : ''}`}><Icon size={15} strokeWidth={1.6} /><span>{item.label}</span></NavLink>;
                })}
              </section>) : <div className="settings-nav-empty">没有匹配的设置</div>}
            </div>
          </nav>
          <div ref={settingsContentRef} className="settings-content" aria-hidden={settingsNavOpen ? true : undefined}><div className="route-transition" key={location.pathname}><Outlet /></div></div>
        </div>
        <div ref={settingsScrollbarRef} className="settings-scrollbar" aria-hidden="true"><span /></div>
      </section>
    </div>}

    {commandPalettePresence.mounted && <div className={`command-palette-layer ${commandPalettePresence.visible ? 'is-visible' : 'is-closing'}`} aria-hidden={!commandPaletteOpen}>
      <button type="button" className="command-palette-backdrop" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)} />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <div className="command-palette-search"><Search size={18} /><input ref={commandInputRef} value={quickSearch} onChange={(event) => setQuickSearch(event.target.value)} placeholder="搜索项目名称、编号或业务模块…" aria-label="搜索项目或业务页面" /><kbd>ESC</kbd><button type="button" className="command-close" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)}><X size={16} /></button></div>
        <div className="command-palette-body">
          <div className="command-palette-heading"><div><span className="command-kicker"><Command size={12} /> MOHENG COMMAND</span><h2 id="command-palette-title">快速访问</h2></div><span className="command-result-count">{quickItems.length} 项</span></div>
          {quickItems.length ? <div className="command-results" role="listbox" aria-label="搜索结果">
            {quickItems.map((item, index) => {
              const firstOfKind = index === 0 || quickItems[index - 1].kind !== item.kind;
              return <div key={`${item.kind}-${item.id}`}>
                {firstOfKind && <div className="command-section-label">{item.kind === 'project' ? '项目直达' : '业务页面'}</div>}
                <button type="button" role="option" aria-selected={activeCommandIndex === index} className={`command-result ${activeCommandIndex === index ? 'active' : ''}`} onMouseEnter={() => setActiveCommandIndex(index)} onClick={() => executeQuickItem(item)}>
                  <span className="command-result-icon">{item.kind === 'project' ? <FolderKanban size={16} /> : <SlidersHorizontal size={16} />}</span>
                  <span className="command-result-copy"><strong>{item.title}</strong><small>{item.sub}</small></span>
                  <span className="command-result-action">{item.kind === 'project' ? <ArrowUpRight size={15} /> : <CornerDownLeft size={14} />}</span>
                </button>
              </div>;
            })}
          </div> : <div className="command-empty"><Search size={22} /><strong>没有找到匹配项</strong><span>试试项目名称、项目编号或业务模块名称。</span></div>}
        </div>
        <footer className="command-palette-footer"><span><Keyboard size={13} />用键盘操作</span><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
      </section>
    </div>}
  </div>;
}
