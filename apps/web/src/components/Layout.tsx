import SelectField from './SelectField';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import AppIcon from './AppIcon';
import ConfirmHost from './ConfirmDialog';
import ToastHost from './ToastHost';
import FocusTrap from './FocusTrap';
import PaperDialogMorph from './PaperDialogMorph';
import UiPreferencesBar from './UiPreferencesBar';
import { ProjectList } from './ProjectList';
import { PanelMenu } from './PanelMenu';
import { WindowControls } from './WindowControls';
import { useTitlebarClearance } from '../lib/use-titlebar-clearance';
import { WorkspacePanelIcon } from './PanelIcons';
import { WorkspacePanel } from './WorkspacePanel';
import { useSidebarResize } from '../lib/use-sidebar-resize';
import type { SortMode, DisplayMode } from './SortMenu';
const AssistantModal = lazy(() => import('./assistant/AssistantModal'));
import { useAnimatedPresence } from './useAnimatedPresence';
import PaperTextureLayer from './PaperTextureLayer';
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
  // 「系统管理」导航项已移除（2026-10-23）。
  // 入口统一走侧栏页脚的齿轮按钮（data-tooltip="系统设置"），
  // 避免同一个入口在导航列表和页脚各出现一次。
];

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
const settingsSearchAliases: Record<string, string[]> = {
  '/settings/appearance': ['界面', '外观', '主题', '图标', '字体', '纸纹', '纹理', '密度', '动效', 'theme', 'appearance', 'font'],
  '/system': ['系统', '概览', '运行状态', '版本'],
  '/system/accounts': ['账号', '用户', '成员', '角色', '密码', '权限'],
  '/system/security': ['登录', '安全', 'mfa', '双因素', '会话', '密码策略'],
  '/system/authorization': ['授权', '复核', '权限矩阵', '项目权限'],
  '/system/policies': ['权限', '流程', '审批', '策略', '角色'],
  '/system/governance': ['组织', '规则', '部门', '治理'],
  '/system/dictionaries': ['字典', '分类', '选项', '基础数据', '枚举'],
  '/system/parameters': ['参数', '配置', '版本', '全局', '项目覆盖', '草稿'],
  '/system/assistant': ['ai', '助手', '模型', '供应商', 'api', '密钥', 'openai'],
  '/system/operations': ['运维', '备份', '恢复', '演练', '数据库', '磁盘', '任务'],
  '/audit-logs': ['审计', '日志', '操作记录', '追溯'],
};
const costWorkspacePages = [
  { to: '/cost', label: '驾驶舱' },
  { to: '/cost/contracts', label: '主合同' },
  { to: '/cost/budget', label: '预算成本' },
  { to: '/cost/progress-bills', label: '进度款' },
  { to: '/cost/changes', label: '变更签证' },
  { to: '/cost/owner-finance', label: '结算与应收' },
  { to: '/cost/downstream', label: '分供合同' },
  { to: '/cost/costs', label: '实际成本' },
  { to: '/cost/analysis', label: '成本分析' },
];
type QuickItem = { kind: 'page' | 'project'; id: string; title: string; sub: string; to: string };
type CommandScope = 'all' | 'page' | 'project';
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
  const workspaceOpen = useUiStore((state) => state.workspaceOpen);
  const setWorkspaceOpen = useUiStore((state) => state.setWorkspaceOpen);
  const workspaceTab = useUiStore((state) => state.workspaceTab);
  const setWorkspaceTab = useUiStore((state) => state.setWorkspaceTab);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  // 侧栏拖动宽度：对齐 hana 的 _fpResizeHandle —— 拖动时改 CSS 变量，
  // 主内容靠 flex: 1 自动让位，不需要额外的偏移量。
  const sidebarResize = useSidebarResize();
  const appIcon = useUiStore((state) => state.appIcon);
  const [quickSearch, setQuickSearch] = useState('');
  const [commandScope, setCommandScope] = useState<CommandScope>('all');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const commandPalettePresence = useAnimatedPresence(commandPaletteOpen, 210);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [quickActionCategory, setQuickActionCategory] = useState<QuickActionCategory>('all');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /* 浮出侧栏的进出场状态机，对齐 hana .float-sidebar[data-stage]：
     idle = 停留，enter = 滑入中，exit = 滑出中。
     hana 用 hover toggle 触发，这里用 sidebarPinned 控制是否常驻。 */
  const [sidebarStage, setSidebarStage] = useState<'enter' | 'idle' | 'exit'>('enter');
  /* 悬停抽屉（对齐 hana 的 overlay 态，2026-10-23）：
     侧栏收起后，鼠标移到左上角开关按钮附近时滑出一份浮层副本，
     离开按钮和浮层后 300ms 自动关闭。

     hana 源码（contributed-keybindings-BWxnaFR2.js）的关键参数：
       - 关闭延迟 rc = 300ms
       - 保活条件：鼠标在触发区（按钮矩形）内 **或** 在抽屉内
       - 进出场：x 从 -(width + 12) 滑到 0

     moheng 用 CSS transition 实现（不引入 motion 库）。 */
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarDrawerRef = useRef<HTMLDivElement>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsNavOpen, setSettingsNavOpen] = useState(false);
  const quickActionsPresence = useAnimatedPresence(quickActionsOpen, 180);
  useDetachedPanelHeaders();
  const commandInputRef = useRef<HTMLInputElement>(null);
  const settingsWindowRef = useRef<HTMLElement>(null);
  /** 卡片元素（.app-content）：用于测量顶栏让位量 */
  const contentRef = useRef<HTMLElement>(null);
  const titlebarClearance = useTitlebarClearance(contentRef);
  const settingsOriginRef = useRef<HTMLElement | null>(null);
  const settingsBarRef = useRef<HTMLDivElement>(null);
  const settingsContentRef = useRef<HTMLDivElement>(null);

  const settingsScrollbarRef = useRef<HTMLDivElement>(null);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const projects = projectsQuery.data ?? [];

  /* ============================================================
     项目列表交互（对齐 hana 会话列表）
     ============================================================
     hana 的会话列表有一套完整交互：
       - 搜索框：30px 高，内含图标 + 输入 + 清除按钮
       - 行悬停：背景变化 + 右侧操作按钮淡入
       - 置顶按钮：默认 opacity 0，悬停时 0.5，悬停自身时 1
       - 拖拽重排：通过 POST /api/session-projects/projects/reorder 持久化

     moheng 对应到项目列表，交互语义相同：搜索、置顶、拖拽排序。 */
  const [projectSearch, setProjectSearch] = useState('');
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('moheng.pinnedProjects');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  /* 排序与显示模式（对齐 hana sidebar.view.sorting / sidebar.view.display）。
     hana 的排序方式：time / project / agent；显示方式：singleLine / twoLine。
     moheng 对应：名称 / 编码 / 最近；单行 / 双行。 */
  const [projectSort, setProjectSort] = useState<SortMode>(() => {
    try {
      const raw = localStorage.getItem('moheng.projectSort');
      // 只认 time / status。旧版本可能存了 'recent'（已废弃），回落 time。
      return raw === 'time' || raw === 'status' ? raw : 'time';
    } catch { return 'time'; }
  });
  const [projectDisplay, setProjectDisplay] = useState<DisplayMode>(() => {
    try {
      const raw = localStorage.getItem('moheng.projectDisplay');
      return (raw as DisplayMode) || 'two-line';
    } catch { return 'two-line'; }
  });

  /* 贴纸行显隐（对齐 hana chalkboardShowPrimaryAgentHeader）。
     hana 隐藏贴纸后，导航区（flex: 1）自然向上补位。
     moheng 的「贴纸」是侧栏顶部品牌区，同样由 flex 布局自然补位。 */
  const [showSidebarBrand, setShowSidebarBrand] = useState<boolean>(() => {
    try { return localStorage.getItem('moheng.sidebarBrand') !== 'hidden'; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem('moheng.pinnedProjects', JSON.stringify(pinnedProjectIds)); } catch { /* 存储不可用时忽略 */ }
  }, [pinnedProjectIds]);

  useEffect(() => {
    try { localStorage.setItem('moheng.projectSort', projectSort); } catch { /* 存储不可用时忽略 */ }
  }, [projectSort]);

  useEffect(() => {
    try { localStorage.setItem('moheng.projectDisplay', projectDisplay); } catch { /* 存储不可用时忽略 */ }
  }, [projectDisplay]);

  useEffect(() => {
    try { localStorage.setItem('moheng.sidebarBrand', showSidebarBrand ? 'shown' : 'hidden'); } catch { /* 存储不可用时忽略 */ }
  }, [showSidebarBrand]);

  const togglePinnedProject = (projectId: string) => {
    setPinnedProjectIds((prev) => prev.includes(projectId)
      ? prev.filter((id) => id !== projectId)
      : [...prev, projectId]);
  };


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
  useEffect(() => { setMobileNavOpen(false); setSettingsNavOpen(false); }, [location.pathname]);
  /* 写入平台标记：hana 的卡片圆角在 Windows 上是 min(--radius-lg, 7px)，
     需要 data-platform="win32" 才会生效（styles.css:295）。
     浏览器版拿不到 Electron 的 platform API，用 navigator.platform 判断。

     注意：这个标记本身不决定是否封顶。真正的开关是 data-windows-card-radius，
     由用户偏好 windowsCardRadius 控制（见 auth-store 的 applyUiPreferences）。
     moheng 默认 Windows 也走 Web 观感，即写入 off 属性。 */
  useEffect(() => {
    const p = navigator.platform || '';
    const isWin = /Win/i.test(p) || /Windows/i.test(navigator.userAgent);
    document.documentElement.dataset.platform = isWin ? 'win32' : (/Mac/i.test(p) ? 'darwin' : 'linux');
  }, []);
  /* 浮出侧栏 hover 触发，对齐 hana 的 hover toggle 行为：
     鼠标进入左侧感应区 → enter（滑入）；离开侧栏 → exit（滑出）。
     收缩态下常驻收起，不参与 hover。 */
  useEffect(() => {
    if (collapsed) { setSidebarStage('exit'); return; }
    setSidebarStage('enter');
    const toIdle = window.setTimeout(() => setSidebarStage('idle'), 300);
    return () => window.clearTimeout(toIdle);
  }, [collapsed]);
  /* 悬停抽屉探测：对齐 hana 的 mousemove 逻辑。
     只在收起态生效。鼠标在触发区（开关按钮）或抽屉内 → 保持；
     两者都不在 → 300ms 后关闭。

     hana 的 300ms 是为了容错：鼠标从按钮移到抽屉的路径上会短暂
     离开两个区域，300ms 足够跨过缝隙，不会闪断。 */
  useEffect(() => {
    if (!collapsed) { setSidebarDrawerOpen(false); return; }

    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
    };

    const onMouseMove = (event: MouseEvent) => {
      const btn = sidebarToggleRef.current?.getBoundingClientRect();
      const drawer = sidebarDrawerRef.current?.getBoundingClientRect();
      const inBtn = !!btn
        && event.clientX >= btn.left && event.clientX <= btn.right
        && event.clientY >= btn.top && event.clientY <= btn.bottom;
      const inDrawer = !!drawer
        && event.clientX >= drawer.left && event.clientX <= drawer.right
        && event.clientY >= drawer.top && event.clientY <= drawer.bottom;

      if (inBtn || inDrawer) {
        clearTimer();
        setSidebarDrawerOpen(true);
        return;
      }

      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          setSidebarDrawerOpen(false);
        }, 300);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      clearTimer();
    };
  }, [collapsed]);
  useEffect(() => {
    if (location.pathname !== '/assistant' && location.pathname !== '/cost/assistant') return;
    setAssistantOpen(true);
    navigate(location.pathname === '/cost/assistant' ? '/cost' : '/', { replace: true });
  }, [location.pathname, navigate]);
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
      // 关闭按钮的定位：原来优先找 .icon-button，但 34 处已迁成 <Button variant="ghost" size="icon">，
    // 不再输出这个类名。靠 aria-label 和 .dialog-close 两个选择器就够了。
    const closeButton = backdrop.querySelector<HTMLButtonElement>('.dialog-header button[aria-label*="关闭"], .dialog-close');
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

  const commandPages = useMemo(() => [...navigation.filter((item) => !item.adminOnly || user?.role === 'ADMIN'), ...(user?.role === 'ADMIN' ? systemNavigation.filter((item) => item.to !== '/system') : []), ...costWorkspacePages.filter((page) => page.to !== '/cost')], [user?.role]);
  const quickItems = useMemo<QuickItem[]>(() => {
    const text = quickSearch.trim().toLocaleLowerCase();
    const pages = commandPages
      .filter((item) => (!text || item.label.toLocaleLowerCase().includes(text)))
      .map((item) => ({ kind: 'page' as const, id: item.to, title: item.label, sub: '页面直达', to: item.to }));
    const projectItems = projects
      .filter((project) => !text || `${project.name} ${project.code}`.toLocaleLowerCase().includes(text))
      .slice(0, 5)
      .map((project) => ({ kind: 'project' as const, id: project.id, title: project.name, sub: project.code, to: '/cost' }));
    const visiblePages = commandScope === 'project' ? [] : pages;
    const visibleProjects = commandScope === 'page' ? [] : projectItems;
    if (!text) return [...visiblePages.slice(0, 5), ...visibleProjects.slice(0, 3)];
    return [...visiblePages, ...visibleProjects].slice(0, 10);
  }, [commandPages, commandScope, projects, quickSearch]);

  const commandCounts = useMemo(() => {
    const text = quickSearch.trim().toLocaleLowerCase();
    const pageCount = commandPages.filter((item) => !text || item.label.toLocaleLowerCase().includes(text)).length;
    const projectCount = projects.filter((project) => !text || `${project.name} ${project.code}`.toLocaleLowerCase().includes(text)).length;
    return { all: pageCount + projectCount, page: pageCount, project: projectCount };
  }, [commandPages, projects, quickSearch]);

  useEffect(() => { setActiveCommandIndex(0); }, [quickSearch, commandScope]);
  useEffect(() => {
    if (!commandPaletteOpen) return;
    document.getElementById(`command-result-${activeCommandIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, commandPaletteOpen]);
  useEffect(() => { if (commandPaletteOpen) commandInputRef.current?.focus(); }, [commandPaletteOpen]);

  function openCommandPalette() {
    setQuickActionsOpen(false);
    setQuickSearch('');
    setCommandScope('all');
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
  const costPageLabel = location.pathname === '/cost/downstream' && new URLSearchParams(location.search).get('view') === 'finance' ? '结算与应付账款' : costWorkspacePages.find((item) => item.to === location.pathname)?.label;
  const currentPageLabel = costPageLabel ?? systemNavigation.find((item) => item.to === location.pathname)?.label ?? navigation.find((item) => item.to === location.pathname)?.label ?? (location.pathname === '/settings/appearance' ? '界面' : isPartyDetail ? '单位经营档案' : location.pathname === '/parties' ? '往来单位库' : location.pathname === '/projects/members' ? '项目成员与权限' : location.pathname === '/account/security' ? '个人中心与账号安全' : '工作台');
  const availableSettingsGroups = user?.role === 'ADMIN' ? systemGroups : [{ label: '个人', items: [appearanceSettingsItem] }];
  const settingsSearchGroups = user?.role === 'ADMIN' ? [...availableSettingsGroups, { label: '个人', items: [appearanceSettingsItem] }] : availableSettingsGroups;
  const isAppearanceSettings = location.pathname === '/settings/appearance';
  const settingsSearchQuery = settingsSearch.trim();
  const settingsSearchMatches = settingsSearchGroups.flatMap((group) => group.items
    .filter((item) => {
      if (!settingsSearchQuery) return true;
      const query = settingsSearchQuery.toLocaleLowerCase();
      const haystack = [item.label, ...(settingsSearchAliases[item.to] ?? [])].join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    })
    .map((item) => ({ ...item, groupLabel: group.label })));
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
    {/* 侧栏拖动宽度把手：对齐 hana 的 _fpResizeHandle ——
        fixed 定位，left = calc(6px + 宽度 + 3px)，3×44px 的 accent 条。
        收起时（collapsed）不渲染。 */}
    {!collapsed && (
      <div
        className="fp-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整侧栏宽度"
        aria-valuenow={sidebarResize.width}
        aria-valuemin={200}
        aria-valuemax={420}
        tabIndex={0}
        onPointerDown={sidebarResize.startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); sidebarResize.nudgeWidth(-8); }
          if (event.key === 'ArrowRight') { event.preventDefault(); sidebarResize.nudgeWidth(8); }
          if (event.key === 'Home') { event.preventDefault(); sidebarResize.resetWidth(); }
        }}
        data-resizing={sidebarResize.resizing || undefined}
      />
    )}
    {/* 侧栏开关：对齐 hana ._trafficStrip —— fixed 定位、在侧栏之外、z-index 最高。
        放在侧栏里的话，侧栏宽度归零时按钮也跟着消失，只能再放第二个按钮展开，
        这就是“两个按钮”的成因。hana 把它独立出来，一个按钮切换两种状态。 */}
    <div className="shell-traffic-strip" data-collapsed={collapsed || undefined} aria-hidden={false}>
      <button ref={sidebarToggleRef} type="button" className="shell-toggle-btn" onClick={toggleSidebar} data-tooltip={sidebarDrawerOpen ? undefined : (collapsed ? '展开导航' : '收起导航')} aria-label={collapsed ? '展开导航' : '收起导航'} aria-expanded={!collapsed} aria-controls="main-navigation">{collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}</button>
    </div>
    {/* 悬停抽屉：对齐 hana ._fpOverlay —— 收起后鼠标移入开关按钮时滑出的浮层副本。
        用 CSS transition 实现（x 从 -(240+12) 到 0），不引入 motion 库。 */}
    {collapsed && <div ref={sidebarDrawerRef} className={`sidebar-drawer ${sidebarDrawerOpen ? 'is-open' : ''}`} aria-hidden={!sidebarDrawerOpen}>
      <div className="sidebar-drawer-inner">
        {/* titlebar 占位：与主侧栏 .app-sidebar-titlebar 同高（16px），
            保证抽屉的 profile 位置与主侧栏完全对齐。 */}
        <div className="app-sidebar-titlebar">
          <span className="sidebar-toolbar-spacer" />
        </div>
        {/* 贴纸行：对齐 hana chalkboardShowPrimaryAgentHeader。
            隐藏后导航区（flex: 1）自然向上补位，不需要额外布局代码。 */}
        {showSidebarBrand && <div className="app-sidebar-profile">
          <span className="sidebar-brand-mark"><AppIcon id={appIcon} /></span>
          <div className="sidebar-wordmark"><strong>墨衡</strong><span>工程经营管理</span></div>
        </div>}
        <div className="app-sidebar-scroll">
          <nav aria-label="业务导航（抽屉）">
            {/* 对齐 hana ._panelNav：导航项平铺，无分组标题。
                hana 的侧栏功能按钮区没有「经营中心/工作台」这类分组标签，
                所有按钮平铺，用 data-selected 表达选中态。 */}
            <div className="sidebar-panel-nav">
              {navigation.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map((item) => {
                const Icon = item.icon;
                return <NavLink key={`drawer-${item.to}`} to={item.to} end={item.end ?? false} title={item.label} aria-label={item.label} className={({ isActive }) => `sidebar-activity-bar${isActive ? ' is-selected' : ''}`}>
                  <Icon size={16} strokeWidth={1.65} /><span>{item.label}</span>
                </NavLink>;
              })}
            </div>
          </nav>
          {/* 项目列表：与主侧栏同一套组件（含搜索/置顶/拖拽），抽屉里只展示前 5 项。 */}
          <ProjectList
            projects={projects}
            loading={projectsQuery.isLoading}
            selectedProjectId={activeProject?.id ?? null}
            onSelect={(id) => { setSelectedProjectId(id); navigate('/cost'); }}
            onManage={() => navigate('/projects')}
            search={projectSearch}
            onSearchChange={setProjectSearch}
            pinnedIds={pinnedProjectIds}
            onTogglePin={togglePinnedProject}
            limit={5}
            sort={projectSort}
            display={projectDisplay}
            onSortChange={setProjectSort}
            onDisplayChange={setProjectDisplay}
          />
        </div>
        {/* 页脚用户区：与主侧栏一致，抽屉里保留完整的账号操作入口。 */}
        <div className="app-sidebar-footer">
          <div className="sidebar-user-row">
            {/* 左组：身份（头像 + 名字），可收缩 */}
            <div className="sidebar-user-identity">
              <div className="sidebar-user-avatar">{user?.name?.slice(0, 1) ?? '管'}</div>
              <div className="sidebar-user-copy"><strong>{user?.name ?? '用户'}</strong>{user?.name !== (user?.role === 'ADMIN' ? '系统管理员' : '项目成员') && <span>{user?.role === 'ADMIN' ? '系统管理员' : '项目成员'}</span>}</div>
            </div>
            {/* 右组：操作按钮，不收缩 */}
            <div className="sidebar-footer-actions">
              {user?.role === 'ADMIN' && <button type="button" data-tooltip="系统设置" data-tooltip-align="end" aria-label="系统设置" className="sidebar-footer-icon" onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/system'); }}><Settings size={15} /></button>}
              <button data-tooltip="退出登录" data-tooltip-align="end" aria-label="退出登录" className="sidebar-footer-icon" onClick={logout}><LogOut size={15} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>}
    <button type="button" className="mobile-nav-backdrop" aria-label="关闭主导航" onClick={() => setMobileNavOpen(false)} style={{ display: mobileNavOpen ? 'block' : 'none' }} />
    <aside className={'app-sidebar' + (mobileNavOpen ? ' mobile-nav-open' : '')} data-stage={sidebarStage} id="main-navigation" aria-label="主导航" data-focus-trap={mobileNavOpen ? 'modal' : undefined}>
      <div className="app-sidebar-titlebar">
        <span className="sidebar-toolbar-spacer" />
      </div>
      {/* 贴纸行：隐藏后导航区自动补位（flex: 1 吃掉释放的空间）。 */}
      {showSidebarBrand && <div className="app-sidebar-profile">
        <span className="sidebar-brand-mark"><AppIcon id={appIcon} /></span>
        <div className="sidebar-wordmark"><strong>墨衡</strong><span>工程经营管理</span></div>
      </div>}
      <div className="app-sidebar-scroll">
        <nav aria-label="业务导航">
          {/* 对齐 hana ._panelNav：平铺，无分组标题 */}
          <div className="sidebar-panel-nav">
            {navigation.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map((item) => {
              const Icon = item.icon;
              return <NavLink key={item.to} to={item.to} end={item.end ?? false} title={item.label} aria-label={item.label} className={({ isActive }) => `sidebar-activity-bar${isActive ? ' is-selected' : ''}`}>
                <Icon size={16} strokeWidth={1.65} /><span>{item.label}</span>
              </NavLink>;
            })}
          </div>
        </nav>
        <ProjectList
          projects={projects}
          loading={projectsQuery.isLoading}
          selectedProjectId={activeProject?.id ?? null}
          onSelect={(id) => { setSelectedProjectId(id); navigate('/cost'); }}
          onManage={() => navigate('/projects')}
          search={projectSearch}
          onSearchChange={setProjectSearch}
          pinnedIds={pinnedProjectIds}
          onTogglePin={togglePinnedProject}
          limit={4}
          sort={projectSort}
          display={projectDisplay}
          onSortChange={setProjectSort}
          onDisplayChange={setProjectDisplay}
        />
      </div>
      <div className="app-sidebar-footer">
        <div className="sidebar-user-row">
          <div className="sidebar-user-identity">
            <div className="sidebar-user-avatar">{user?.name?.slice(0, 1) ?? '管'}</div>
            <div className="sidebar-user-copy"><strong>{user?.name ?? '用户'}</strong>{user?.name !== (user?.role === 'ADMIN' ? '系统管理员' : '项目成员') && <span>{user?.role === 'ADMIN' ? '系统管理员' : '项目成员'}</span>}</div>
          </div>
          <div className="sidebar-footer-actions">
            {user?.role === 'ADMIN' && <button type="button" data-tooltip="系统设置" data-tooltip-align="end" aria-label="系统设置" className="sidebar-footer-icon" onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/system'); }}><Settings size={15} /></button>}
            <button data-tooltip="退出登录" data-tooltip-align="end" aria-label="退出登录" className="sidebar-footer-icon" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </div>
    </aside>

    <div className="app-main">
      <main className="app-content" ref={contentRef} aria-hidden={isSettingsArea ? true : undefined}>
        {/* 纸纹层：对齐 hana 的 ._layer_0d743 ——
            absolute 铺满卡片壳、z-index: --z-under（-1）在内容下方、pointer-events none。
            默认 display:none，html[data-paper-texture] 打开。
            不放进 route-transition：那里是滚动容器，纸纹会跟着内容滚走。 */}
        <PaperTextureLayer />
        {/* 标题层在卡片内部，对齐 hana ._titlebarFrame —— 它是 ._tileShell 的子元素。

            结构真值（rve 组件）：
              const hasLeft = leftActions.length > 0 || titleSegment != null;
              <div data-islands={hasLeft ? "both" : "right"}>
                {hasLeft && <div data-titlebar-slot="left">{...leftActions, titleSegment}</div>}
                <div data-titlebar-slot="right">{...rightActions}</div>
              </div>

            关键：**titleSegment 存在时 data-islands 就是 "both"**，标题在左岛。
            所以 chat 卡片也有左岛，里面装的是标题段（不是面板按钮）。
            面板按钮 chrome 全在 titlebar-right，order 10/20/30。 */}
        <header
          className="app-titlebar"
          data-titlebar-frame
          data-islands="both"
          style={{
            /* 让位量：对齐 hana 的 titlebarClearancePx / titlebarClearanceRightPx
               —— 卡片与窗口控制区重叠时，顶栏右侧 padding 加上重叠宽度。 */
            ['--titlebar-clearance-right' as string]: `${titlebarClearance.right ?? 0}px`,
            ['--titlebar-clearance-left' as string]: `${titlebarClearance.left ?? 0}px`,
          }}
        >
          {/* 左岛：标题段（对齐 hana 把 titleSegment 放在 left 岛的做法） */}
          <div className="titlebar-island titlebar-island-left" data-titlebar-slot="left" data-titlebar-action-island="left">
            <button type="button" className="titlebar-icon titlebar-mobile-menu" data-tooltip={mobileNavOpen ? '关闭主导航' : '打开主导航'} aria-label={mobileNavOpen ? '关闭主导航' : '打开主导航'} aria-expanded={mobileNavOpen} aria-controls="main-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={17} /> : <Menu size={17} />}</button>
            <div className="titlebar-context" data-titlebar-slot="title">
              {/* 对齐 hana ._chatTitleStack：
                    - 标题 16px/700/accent（--fs-title）
                    - 状态段独立容器，用 3px 实心圆点分隔
                    - 整栈 width: fit-content，不撑满顶栏 */}
              <strong data-page-title>{currentPageLabel}</strong>
              <span className="titlebar-status">
                {!isGlobalContext && activeProject && (
                  <><span className="titlebar-status-part">{activeProject.code}</span><span className="titlebar-status-dot" aria-hidden="true" /></>
                )}
                <span className="titlebar-status-part">{isGlobalContext ? '全公司' : '项目'}</span>
              </span>
            </div>
          </div>

          {/* 右岛：工作区开关 + 菜单（对齐 hana 的 chrome 定义，全在 titlebar-right）
              按需求删除了「预览」开关，只保留「工作区」+ 菜单。 */}
          <div className="titlebar-island titlebar-island-right" data-titlebar-slot="right" data-titlebar-action-island="right">
            {/* 项目选择器：moheng 独有（hana 顶栏没有）。
                放右岛最左端（chrome 之前）—— 阅读顺序是「先看上下文，再用操作」，
                且不挤进左岛的标题栈、也不把两个面板按钮撑开。
                只在项目上下文显示（!isGlobalContext）。 */}
            {!isGlobalContext ? (
              <div className="titlebar-project">
                <SelectField
                  value={selectedProjectId ?? ''}
                  onChange={(event) => setSelectedProjectId(event.target.value || null)}
                  aria-label="切换当前项目"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </SelectField>
              </div>
            ) : null}
            <button
              type="button"
              className="titlebar-icon"
              aria-label={workspaceOpen && workspaceTab === 'studio' ? '关闭工作区' : '打开工作区'}
              aria-pressed={workspaceOpen && workspaceTab === 'studio'}
              data-chrome-button-action-id="chalkboard.chat.panel-workspace"
              data-tooltip="工作区"
              onClick={() => {
                if (workspaceOpen && workspaceTab === 'studio') setWorkspaceOpen(false);
                else { setWorkspaceTab('studio'); setWorkspaceOpen(true); }
              }}
            >
              <WorkspacePanelIcon />
            </button>
            <PanelMenu />
          </div>
        </header>
        {/* 窗口控制区：对齐 hana 的 ._windowControlsIsland_5f7ae ——
            fixed 定位在窗口右上角，装系统按钮 + 窗口按钮。
            卡片右缘与本区左缘重叠时，顶栏右侧要让位（见 wot 算法）。 */}
        <WindowControls
          projects={projects}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={setSelectedProjectId}
          isGlobalContext={isGlobalContext}
          location={location}
          navigate={navigate}
          openCommandPalette={openCommandPalette}
          quickActionsOpen={quickActionsOpen}
          setQuickActionsOpen={setQuickActionsOpen}
          quickActionsPresence={quickActionsPresence}
          quickActionCategory={quickActionCategory}
          setQuickActionCategory={setQuickActionCategory}
          quickActionCategories={quickActionCategories}
          visibleQuickActions={visibleQuickActions}
          accountMenuOpen={accountMenuOpen}
          setAccountMenuOpen={setAccountMenuOpen}
          assistantEnabled={assistantEnabled}
          assistantOpen={assistantOpen}
          setAssistantOpen={setAssistantOpen}
          setCommandPaletteOpen={setCommandPaletteOpen}
          rememberPaperOrigin={rememberPaperOrigin}
          logout={logout}
        />
        {isSettingsArea ? <div className="settings-underlay" aria-hidden="true" /> : <div className="route-transition" key={location.pathname}><Outlet /></div>}
      </main>
      <FocusTrap />
      <PaperDialogMorph />
      <ConfirmHost />
      <ToastHost />
    </div>
    {/* 工作区浮层：对齐 hana 的 _previewPanel ——
        必须与 .app-main 并列（app-shell 的直接子项），
        否则 flex 让位不会发生，主内容也不会收缩。 */}
    <WorkspacePanel />

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
            <div className="settings-search">
              <Search size={14} aria-hidden="true" />
              <input value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSettingsSearch(''); }} placeholder="搜索设置" aria-label="搜索设置" type="search" autoComplete="off" aria-controls={settingsSearchQuery ? 'settings-search-results' : undefined} />
              {settingsSearch && <button type="button" className="settings-search-clear" aria-label="清空设置搜索" onClick={() => setSettingsSearch('')}><X size={12} /></button>}
            </div>
            {settingsSearchQuery ? <div id="settings-search-results" className="settings-search-results" aria-live="polite">
              <div className="settings-search-results-title">搜索结果</div>
              {settingsSearchMatches.length ? settingsSearchMatches.map((item) => {
                const Icon = item.icon;
                const isCurrent = item.to === '/system' ? location.pathname === '/system' : location.pathname === item.to;
                return <NavLink key={item.to} to={item.to} end={item.end ?? false} onClick={() => { setSettingsSearch(''); setSettingsNavOpen(false); }} data-autofocus={isCurrent ? 'true' : undefined} className={({ isActive }) => `settings-search-result ${isActive ? 'active' : ''}`}><span className="settings-search-result-icon"><Icon size={14} strokeWidth={1.6} /></span><span className="settings-search-result-copy"><strong>{item.label}</strong><small>{item.groupLabel}</small></span></NavLink>;
              }) : <div className="settings-search-empty">没有匹配的设置</div>}
            </div> : <div className="settings-groups">
              {availableSettingsGroups.map((group) => <section className="settings-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = item.to === '/system' ? location.pathname === '/system' : location.pathname === item.to;
                  return <NavLink key={item.to} to={item.to} end={item.end ?? false} onClick={() => setSettingsNavOpen(false)} data-autofocus={isCurrent ? 'true' : undefined} className={({ isActive }) => `settings-nav-link ${isActive ? 'active' : ''}`}><Icon size={15} strokeWidth={1.6} /><span>{item.label}</span></NavLink>;
                })}
              </section>)}
              {!availableSettingsGroups.length && <div className="settings-nav-empty">没有匹配的设置</div>}
            </div>}
          </nav>
          {/* 内容列：对齐 hana ._column_41544
                display: flex; flex: 1; flex-direction: column;
               内部再分 titlebar(52px) + main(可滚) */}
          <div className="settings-column">
            {/* 标题栏：对齐 hana ._titlebar_7cee1（min-height 52px） */}
            {/* 标题栏：对齐 hana ._titlebar_7cee1（justify-content: space-between）
                 三段结构：[标题] [页面级操作] [关闭]
                 页面级操作由各页通过 portal 注入到 #settings-titlebar-actions，
                 这样刷新之类的按钮留在标题栏里，不额外占一行。 */}
            <div className="settings-titlebar">
              <h1 className="settings-titlebar-title">{currentPageLabel}</h1>
              <div className="settings-titlebar-actions" id="settings-titlebar-actions" />
              <button type="button" className="settings-titlebar-close" onClick={closeSettings} aria-label="关闭设置">
                <X size={14} />
              </button>
            </div>
            <div ref={settingsContentRef} className="settings-content" aria-hidden={settingsNavOpen ? true : undefined}><div className="route-transition" key={location.pathname}><Outlet /></div></div>
          </div>
        </div>
        <div ref={settingsScrollbarRef} className="settings-scrollbar" aria-hidden="true"><span /></div>
      </section>
    </div>}

    {commandPalettePresence.mounted && <div className={`command-palette-layer ${commandPalettePresence.visible ? 'is-visible' : 'is-closing'}`} aria-hidden={!commandPaletteOpen}>
      <button type="button" className="command-palette-backdrop" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)} />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <div className="command-palette-search">
          <Search size={17} aria-hidden="true" />
          <input ref={commandInputRef} value={quickSearch} onChange={(event) => setQuickSearch(event.target.value)} placeholder="搜索项目名称、编号或业务模块…" aria-label="搜索项目或业务页面" role="combobox" aria-expanded={quickItems.length > 0} aria-controls={quickItems.length ? 'command-results' : undefined} aria-autocomplete="list" aria-activedescendant={quickItems[activeCommandIndex] ? `command-result-${activeCommandIndex}` : undefined} />
          <kbd>ESC</kbd>
          <button type="button" className="command-close" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)}><X size={16} /></button>
        </div>
        <div className="command-palette-context">
          <span id="command-palette-title" className="command-scope-title"><Command size={12} aria-hidden="true" />全局搜索</span>
          <div className="command-scope-tabs" role="group" aria-label="搜索范围">
            {(['all', 'page', 'project'] as const).map((scope) => <button key={scope} type="button" aria-pressed={commandScope === scope} className={commandScope === scope ? 'active' : ''} onClick={() => setCommandScope(scope)}>{scope === 'all' ? '全部' : scope === 'page' ? '页面' : '项目'}<small>{commandCounts[scope]}</small></button>)}
          </div>
          <span className="command-result-count">{quickItems.length} 项</span>
        </div>
        <div className="command-palette-body">
          {quickItems.length ? <div id="command-results" className="command-results" role="listbox" aria-label="搜索结果">
            {quickItems.map((item, index) => {
              const firstOfKind = index === 0 || quickItems[index - 1].kind !== item.kind;
              return <div key={`${item.kind}-${item.id}`}>
                {firstOfKind && <div className="command-section-label">{item.kind === 'project' ? '项目直达' : '业务页面'}</div>}
                <button id={`command-result-${index}`} type="button" role="option" aria-selected={activeCommandIndex === index} className={`command-result ${activeCommandIndex === index ? 'active' : ''}`} onMouseEnter={() => setActiveCommandIndex(index)} onClick={() => executeQuickItem(item)}>
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
    {assistantOpen && <Suspense fallback={<div className="assistant-overlay"><div className="assistant-modal assistant-modal-loading">正在打开成本助手…</div></div>}><AssistantModal open onClose={() => setAssistantOpen(false)} /></Suspense>}
  </div>;
}
