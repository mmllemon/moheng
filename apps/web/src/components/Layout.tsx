import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, FileText, FolderKanban,
  Gauge, HandCoins, LayoutDashboard, LogOut, Search, SlidersHorizontal, Wallet, Workflow, Zap, UserCog, Globe2, ReceiptText,
  ArrowUpRight, Command, CornerDownLeft, Keyboard, X,
} from 'lucide-react';
import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import type { Project } from '../types';
import { LoadingBlock, StatusBadge } from './Ui';
import BrandMark from './BrandMark';
import UiPreferencesBar from './UiPreferencesBar';

const navigation = [
  { to: '/', label: '经营总览', icon: LayoutDashboard, group: '工作台', end: true },
  { to: '/projects', label: '项目管理', icon: FolderKanban, group: '工作台', end: true },
  { to: '/parties', label: '往来单位库', icon: Building2, group: '工作台', end: false },
  { to: '/workspace', label: '项目工作台', icon: ClipboardList, group: '项目业务', end: false },
  { to: '/settings/users', label: '账号与项目权限', icon: UserCog, group: '系统设置', end: true },
];
const workspacePages = [
  { to: '/workspace', label: '项目驾驶舱' },
  { to: '/workspace/contracts', label: '业主主合同' },
  { to: '/workspace/budget', label: '预算与目标成本' },
  { to: '/workspace/progress-bills', label: '进度款管理' },
  { to: '/workspace/changes', label: '变更签证' },
  { to: '/workspace/owner-finance', label: '竣工结算与应收' },
  { to: '/workspace/downstream', label: '分供合同与结算' },
  { to: '/workspace/costs', label: '实际成本录入' },
  { to: '/workspace/analysis', label: '成本分析' },
];
type QuickItem = { kind: 'page' | 'project'; id: string; title: string; sub: string; to: string };

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
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const projects = projectsQuery.data ?? [];
  useEffect(() => {
    if (!projects.length) { if (selectedProjectId) setSelectedProjectId(null); return; }
    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId, setSelectedProjectId]);

  const activeProject = projects.find((project) => project.id === selectedProjectId);
  const quickItems = useMemo<QuickItem[]>(() => {
    const text = quickSearch.trim().toLocaleLowerCase();
    const pages = [...navigation, ...workspacePages.filter((page) => page.to !== '/workspace')]
      .filter((item) => (item.to !== '/settings/users' || user?.role === 'ADMIN') && (!text || item.label.toLocaleLowerCase().includes(text)))
      .map((item) => ({ kind: 'page' as const, id: item.to, title: item.label, sub: '页面直达', to: item.to }));
    const projectItems = projects
      .filter((project) => !text || `${project.name} ${project.code}`.toLocaleLowerCase().includes(text))
      .slice(0, 5)
      .map((project) => ({ kind: 'project' as const, id: project.id, title: project.name, sub: project.code, to: '/workspace' }));
    if (!text) return [...pages.slice(0, 5), ...projectItems.slice(0, 3)];
    return [...pages, ...projectItems].slice(0, 10);
  }, [projects, quickSearch, user?.role]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [quickSearch]);
  useEffect(() => {
    if (commandPaletteOpen) commandInputRef.current?.focus();
  }, [commandPaletteOpen]);

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

  const isGlobalOverview = location.pathname === '/';
  const isGlobalContext = isGlobalOverview || location.pathname.startsWith('/parties');
  const isPartyDetail = /^\/parties\/[^/]+/.test(location.pathname);
  const workspacePageLabel = location.pathname === '/workspace/downstream' && new URLSearchParams(location.search).get('view') === 'finance' ? '结算与应付账款' : workspacePages.find((item) => item.to === location.pathname)?.label;
  const currentPageLabel = workspacePageLabel ?? navigation.find((item) => item.to === location.pathname)?.label ?? (isPartyDetail ? '单位经营档案' : location.pathname === '/parties' ? '往来单位库' : '工作台');

  async function logout() {
    try { await api.logout(); } catch { /* The local session is cleared even if the network is unavailable. */ }
    clearSession();
    setSelectedProjectId(null);
    navigate('/login');
  }

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar" aria-label="主导航">
      <div className="brand"><BrandMark />{!collapsed && <div className="brand-word"><strong>墨衡</strong><span>ENGINEERING BUSINESS DESK</span></div>}</div>
      <div className="side-label">{!collapsed && '工作空间'}</div>
      {['工作台', '项目业务', ...(user?.role === 'ADMIN' ? ['系统设置'] : [])].map((group) => <div className="nav-group" key={group}>
        {!collapsed && <div className="nav-group-title">{group}</div>}
        {navigation.filter((item) => item.group === group && (item.to !== '/settings/users' || user?.role === 'ADMIN')).map((item) => {
          const Icon = item.icon;
          return <NavLink key={item.to} to={item.to} end={item.end ?? false} title={collapsed ? item.label : undefined} aria-label={item.label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
          </NavLink>;
        })}
      </div>)}
      <div className="sidebar-grow" />
      {!collapsed && <div className="sidebar-note"><div className="sidebar-note-icon"><Gauge size={16} /></div><div><strong>经营健康度</strong><span>收入与支出持续跟踪</span></div><ChevronDown size={15} /></div>}
      <button type="button" className="collapse-button" onClick={toggleSidebar} title={collapsed ? '展开导航' : '收起导航'} aria-label={collapsed ? '展开导航' : '收起导航'}>{collapsed ? <ChevronsRight size={17} /> : <><ChevronsLeft size={17} /><span>收起导航</span></>}</button>
      <div className="user-panel"><div className="avatar">{user?.name?.slice(0, 1) ?? '管'}</div>{!collapsed && <><div className="user-meta"><strong>{user?.name ?? '用户'}</strong><span>{user?.role === 'ADMIN' ? '系统管理员' : '项目成员'}</span></div><button title="退出登录" aria-label="退出登录" className="icon-button logout-button" onClick={logout}><LogOut size={16} /></button></>}</div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb"><span>工程经营管理</span><span className="crumb-separator">/</span><strong>{currentPageLabel}</strong><span className="environment-pill"><i />工作区</span></div>
        <div className="topbar-tools">
          <button type="button" className="command-trigger" onClick={openCommandPalette} aria-haspopup="dialog" aria-label="打开全局搜索和命令面板">
            <Search size={15} /><span>搜索项目、业务模块…</span><kbd><Command size={10} /> K</kbd>
          </button>
          <span className="topbar-divider" />
          <div className="quick-actions-wrap">
            <button type="button" className={`notification-button ${quickActionsOpen ? 'is-active' : ''}`} title="快捷操作" aria-label="打开快捷操作" aria-expanded={quickActionsOpen} onClick={() => { setCommandPaletteOpen(false); setQuickActionsOpen((open) => !open); }}><Zap size={18} /></button>
            {quickActionsOpen && <>
              <button type="button" className="quick-action-dismiss" aria-label="关闭快捷操作" onClick={() => setQuickActionsOpen(false)} />
              <div className="quick-action-panel" role="menu" aria-label="快捷操作菜单">
                <div className="quick-action-heading"><strong>快捷操作</strong><span>跳转到常用业务模块</span></div>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/costs'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><Wallet size={16} /></span><span><strong>新增成本记录</strong><small>登记人工、材料、机械及其他费用</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/progress-bills'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><HandCoins size={16} /></span><span><strong>进度款管理</strong><small>业主申报、审批与回款登记</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/owner-finance'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><ReceiptText size={16} /></span><span><strong>竣工结算与应收</strong><small>最终结算、应收余额与到账核销</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/downstream'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><FileText size={16} /></span><span><strong>分供合同与付款</strong><small>分包/采购/租赁合同与支付台账</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/downstream?view=finance'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><ReceiptText size={16} /></span><span><strong>结算与应付账款</strong><small>确认结算、应付核销、质保金与发票核对</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
                <button type="button" role="menuitem" onClick={() => { navigate('/workspace/changes'); setQuickActionsOpen(false); }}><span className="quick-action-icon"><Workflow size={16} /></span><span><strong>变更签证</strong><small>查看送审与核定状态</small></span><ChevronRight size={16} className="quick-action-arrow" /></button>
              </div>
            </>}
          </div>
          <div className="topbar-user"><div className="avatar avatar-small">{user?.name?.slice(0, 1) ?? '管'}</div><span>{user?.name ?? '用户'}</span><ChevronDown size={13} className="topbar-user-chevron" /></div>
        </div>
      </header>
      <UiPreferencesBar />
      <div className={`project-context-bar ${isGlobalContext ? 'global-context-bar' : ''}`}>
        {isGlobalContext ? <>
          <div className="context-left"><span className="context-pulse" /><Globe2 size={15} /><strong>{isPartyDetail ? '单位经营档案' : location.pathname === '/parties' ? '公司往来单位视图' : '全局经营视图'}</strong><span className="global-context-divider" />{isPartyDetail || location.pathname === '/parties' ? '单位业务按项目权限聚合' : '全部可访问项目'}</div>
          <div className="context-right">统计范围：{user?.role === 'ADMIN' ? '公司全部项目' : '当前账号有权限访问的所有项目'}</div>
        </> : <>
          <div className="context-left"><span className="context-pulse" /><span>当前项目</span>{projectsQuery.isLoading ? <LoadingBlock label="加载项目" /> : <div className="project-switcher"><select aria-label="切换当前项目" value={activeProject?.id ?? ''} onChange={(event) => setSelectedProjectId(event.target.value || null)}><option value="">请选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</select><ChevronDown size={14} /></div>}{activeProject && <StatusBadge status={activeProject.status} />}</div>
          <div className="context-right">数据范围：{activeProject ? activeProject.code : '请选择项目'} <span className="context-separator">·</span> 项目级视图</div>
        </>}
      </div>
      <main className="content-area"><div className="route-transition" key={location.pathname}><Outlet /></div></main>
      <footer className="app-footer"><span>墨衡 · 施工单位成本管理</span><span>项目经营管理工作台 <i /> v1.7.0-rc.1</span></footer>
    </div>

    {commandPaletteOpen && <div className="command-palette-layer">
      <button type="button" className="command-palette-backdrop" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)} />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <div className="command-palette-search"><Search size={18} /><input ref={commandInputRef} value={quickSearch} onChange={(event) => setQuickSearch(event.target.value)} placeholder="输入项目名称、编号或业务模块…" aria-label="搜索项目或业务页面" /><kbd>ESC</kbd><button type="button" className="command-close" aria-label="关闭命令面板" onClick={() => setCommandPaletteOpen(false)}><X size={16} /></button></div>
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
