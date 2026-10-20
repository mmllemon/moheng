import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Bell, Building2, CalendarDays, ChevronDown, ChevronRight, CircleAlert,
  FileBarChart2, FileText, FolderKanban, HandCoins, LayoutDashboard, PanelLeft,
  Minus, MoreHorizontal, Plus, ReceiptText, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, UserCog, Users, Wallet, X,
} from 'lucide-react';
import '../styles/theme-preview.css';

type ThemeId = 'warm-paper' | 'plain-white' | 'midnight-contrast';
type PreviewView = 'overview' | 'settings';

const THEMES: Array<{ id: ThemeId; name: string; mode: string; bg: string; text: string; muted: string; accent: string }> = [
  { id: 'warm-paper', name: '暖纸', mode: '白天 · 纸本', bg: '#F5EFE4', text: '#2A2622', muted: '#6B6158', accent: '#537D96' },
  { id: 'plain-white', name: '素白', mode: '明亮 · 清晰', bg: '#FAFAF7', text: '#1B1C18', muted: '#686A62', accent: '#2C5A51' },
  { id: 'midnight-contrast', name: '青夜 · 高对比', mode: '夜间 · 高对比', bg: '#1B272D', text: '#F5F1E7', muted: '#C2CDD0', accent: '#9CCFE0' },
];

function isTheme(value: string | undefined): value is ThemeId {
  return value === 'warm-paper' || value === 'plain-white' || value === 'midnight-contrast';
}

function NavButton({ children, active = false, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return <button type="button" className={'pv-nav-item' + (active ? ' is-active' : '')} onClick={onClick}>{children}</button>;
}

function OverviewPreview() {
  return <>
    <div className="pv-page-head">
      <div>
        <span className="pv-eyebrow">WORKSPACE / OVERVIEW</span>
        <h1>经营总览</h1>
        <p>全公司 · 2 个项目 · 数据截至 2026-10-20 20:00</p>
      </div>
      <div className="pv-page-actions"><button type="button" className="pv-button secondary"><FileText size={14} />导出月报</button><button type="button" className="pv-button primary">+ 新建项目</button></div>
    </div>

    <section className="pv-hero">
      <div className="pv-hero-main">
        <span className="pv-label">当前有效合同额</span>
        <div className="pv-hero-amount"><span>¥</span>32,580,000</div>
        <p>2 个在施 · 0 个待结算 · 0 个暂停；合同额按有效台账汇总</p>
        <div className="pv-progress-head"><span>成本执行</span><strong>6.7%</strong><span>已发生 ¥74,800 / 目标 ¥1,116,800</span></div>
        <div className="pv-progress-track"><i style={{ width: '6.7%' }} /></div>
        <div className="pv-progress-scale"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      </div>
      <div className="pv-hero-stats">
        <div><span>目标成本</span><strong>¥1,116,800</strong></div>
        <div><span>累计回款</span><strong>¥0 <small>0.0%</small></strong></div>
        <div><span>成本余量</span><strong>¥1,042,000</strong></div>
        <div><span>在施项目</span><strong>2 <small>待结算 0</small></strong></div>
      </div>
    </section>

    <section className="pv-block pv-project-block">
      <div className="pv-block-head">
        <div><h2>项目台账</h2><p>按合同额排序</p></div>
        <div className="pv-block-tools"><span>排序</span><button type="button" className="pv-mini-select">合同额 <ChevronDown size={12} /></button><button type="button" className="pv-link">全部项目 <ArrowRight size={13} /></button></div>
      </div>
      <table className="pv-table">
        <thead><tr><th>项目</th><th>状态</th><th className="right">合同额</th><th className="right">目标成本</th><th className="right">已发生</th><th className="right">成本余量</th><th className="right">回款率</th><th /></tr></thead>
        <tbody>
          <tr><td><strong>金融城5号配电项目</strong><small>XM-2026-000001 · 江北嘴置业有限公司</small></td><td><span className="pv-status">在施</span></td><td className="right pv-number">¥20,000,000</td><td className="right pv-number">¥0</td><td className="right pv-number">¥0</td><td className="right pv-number">¥0</td><td className="right pv-number">0.0%</td><td><ChevronRight size={14} /></td></tr>
          <tr><td><strong>滨江综合服务中心项目</strong><small>DEMO-001 · 滨江城市建设发展有限公司</small></td><td><span className="pv-status">在施</span></td><td className="right pv-number">¥12,580,000</td><td className="right pv-number">¥1,116,800</td><td className="right pv-number">¥74,800</td><td className="right pv-number">¥1,042,000</td><td className="right pv-number">0.0%</td><td><ChevronRight size={14} /></td></tr>
        </tbody>
        <tfoot><tr><td colSpan={2}>合计</td><td className="right pv-number">¥32,580,000</td><td className="right pv-number">¥1,116,800</td><td className="right pv-number">¥74,800</td><td className="right pv-number">¥1,042,000</td><td className="right pv-number">0.0%</td><td /></tr></tfoot>
      </table>
    </section>

    <div className="pv-lower">
      <section className="pv-block pv-activity-block">
        <div className="pv-block-head"><div><h2>近期变动</h2><p>2026-10-20</p></div><div className="pv-block-tools"><button type="button" className="pv-mini-select"><CalendarDays size={12} />2026-10-20</button><button type="button" className="pv-link">操作日志 <ArrowRight size={13} /></button></div></div>
        <div className="pv-activity-list">
          {[
            ['17:06', '更新合同', '金融城5号配电项目 · MainContract · 系统管理员'],
            ['16:58', '状态变更', '金融城5号配电项目 · DownstreamContract · 系统管理员'],
            ['16:58', '创建草稿', '金融城5号配电项目 · DownstreamContract · 系统管理员'],
            ['16:53', '新增记录', '金融城5号配电项目 · Project · 系统管理员'],
            ['16:41', '内部状态变更', '滨江综合服务中心项目 · Change · 系统管理员'],
          ].map(([time, title, meta]) => <div className="pv-activity-row" key={time + title}><time>{time}</time><div><strong>{title}</strong><span>{meta}</span></div><span className="pv-activity-end">—</span></div>)}
        </div>
      </section>
      <aside className="pv-block pv-todo-block">
        <div className="pv-block-head"><div><h2>待办</h2><p>需跟进的变更</p></div><span className="pv-count">1 项</span></div>
        <button type="button" className="pv-todo-item"><span className="pv-todo-title"><CircleAlert size={14} />地下室局部优化</span><span className="pv-number">¥38,000</span><small>滨江综合服务中心项目 · BG-001</small></button>
        <div className="pv-todo-foot"><span>待跟进变更</span><span>进入工作台 <ArrowRight size={12} /></span></div>
      </aside>
    </div>
  </>;
}

function ThemeCard({ theme, active, onClick }: { theme: typeof THEMES[number]; active: boolean; onClick: () => void }) {
  return <button type="button" className={'pv-theme-card' + (active ? ' is-active' : '')} style={{ background: theme.bg, color: theme.text }} onClick={onClick}>
    <span className="pv-theme-card-top"><span className="pv-theme-dot" style={{ background: theme.accent }} />{active ? '当前主题' : '主题'}</span>
    <strong>{theme.name}</strong>
    <small style={{ color: theme.muted }}>{theme.mode}</small>
  </button>;
}

function SettingsSidebar() {
  return <aside className="pv-settings-sidebar">
    <div className="pv-settings-search"><Search size={14} /><span>搜索设置</span></div>
    <div className="pv-settings-group"><span>个人偏好</span><button type="button" className="is-active"><SlidersHorizontal size={15} />界面</button><button type="button"><Bell size={15} />通知</button><button type="button"><ShieldCheck size={15} />安全</button></div>
    <div className="pv-settings-group"><span>组织与权限</span><button type="button"><UserCog size={15} />账号管理</button><button type="button"><Users size={15} />成员与权限</button><button type="button"><ShieldCheck size={15} />授权复核</button><button type="button"><SlidersHorizontal size={15} />权限与流程</button></div>
    <div className="pv-settings-group"><span>平台</span><button type="button"><Settings2 size={15} />基础配置</button><button type="button"><FileText size={15} />操作追溯</button><button type="button"><FileBarChart2 size={15} />运维备份</button><button type="button"><Sparkles size={15} />AI 助手 <i className="pv-beta">BETA</i></button></div>
  </aside>;
}

function SettingsPreview({ theme, onThemeChange }: { theme: ThemeId; onThemeChange: (theme: ThemeId) => void }) {
  const texture = theme === 'midnight-contrast' ? '关闭' : '宣纸';
  return <div className="pv-settings-main">
    <div className="pv-page-head settings-head"><div><span className="pv-eyebrow">SETTINGS / APPEARANCE</span><h1>界面</h1><p>选择主题、字体与阅读密度；所有偏好会立即预览。</p></div></div>
    <section className="pv-setting-section">
      <div className="pv-setting-head"><h2>主题</h2><p>用纸色、墨色和一处强调色决定整个工作区的气质。</p></div>
      <div className="pv-theme-grid">{THEMES.map((item) => <ThemeCard key={item.id} theme={item} active={theme === item.id} onClick={() => onThemeChange(item.id)} />)}</div>
    </section>
    <section className="pv-setting-section">
      <div className="pv-setting-head"><h2>字体与排版</h2><p>正文使用衬线体，金额和编号使用等宽数字。</p></div>
      <div className="pv-font-preview"><span>永和九年，岁在癸丑。</span><small>墨衡 · 工程经营管理 · 数字 0123456789</small></div>
      <div className="pv-setting-rows">
        <div className="pv-setting-row"><div><strong>正文字号</strong><small>影响表格、表单和说明文字</small></div><div className="pv-segment"><button type="button">小</button><button type="button" className="is-active">标准</button><button type="button">大</button></div></div>
        <div className="pv-setting-row"><div><strong>表格密度</strong><small>控制项目台账和明细表的行高</small></div><div className="pv-segment"><button type="button" className="is-active">舒适</button><button type="button">紧凑</button></div></div>
        <div className="pv-setting-row"><div><strong>内容宽度</strong><small>控制设置页和阅读内容的最大宽度</small></div><div className="pv-segment"><button type="button">窄</button><button type="button" className="is-active">标准</button><button type="button">宽</button></div></div>
      </div>
    </section>
    <section className="pv-setting-section">
      <div className="pv-setting-head"><h2>外观</h2><p>纸张纹理只影响表面，不改变业务信息的对比度。</p></div>
      <div className="pv-setting-rows">
        <div className="pv-setting-row"><div><strong>纸张纹理</strong><small>为画布、侧栏和卡片叠加轻微纸纹</small></div><div className="pv-segment">{['关闭', '宣纸', '棉纸', '细颗粒'].map((item) => <button type="button" className={texture === item ? 'is-active' : ''} key={item}>{item}</button>)}</div></div>
        <div className="pv-setting-row"><div><strong>纹理强度</strong><small>1 最轻，5 最明显</small></div><div className="pv-range"><div className="pv-range-track"><i /></div><span>1</span><span>3</span><span>5</span></div></div>
      </div>
    </section>
    <div className="pv-settings-footer"><span>设置仅影响当前账号，不改变公司级权限与业务数据。</span><button type="button" className="pv-button primary">保存偏好</button></div>
  </div>;
}

export default function ThemePreviewPage() {
  const { theme: routeTheme } = useParams();
  const navigate = useNavigate();
  const theme: ThemeId = isTheme(routeTheme) ? routeTheme : 'warm-paper';
  const [view, setView] = useState<PreviewView>('overview');
  const meta = THEMES.find((item) => item.id === theme)!;
  const switchTheme = (next: ThemeId) => navigate('/preview/themes/' + next);
  return <div className="theme-preview" data-theme={theme}>
    <div className={'pv-window' + (view === 'settings' ? ' has-modal' : '')}>
      <header className="pv-titlebar">
        <div className="pv-titlebar-left"><button type="button" className="pv-tb-toggle" aria-label="切换侧栏"><PanelLeft size={15} /></button></div>
        <div className="pv-titlebar-center">金融城5号配电项目 <span>·</span> 经营总览</div>
        <div className="pv-titlebar-controls"><button type="button" className="pv-tb-icon" aria-label="项目文件"><FolderKanban size={15} /></button><button type="button" className="pv-tb-icon" aria-label="文档"><FileText size={15} /></button><span className="pv-tb-divider" /><button type="button" className="pv-wc" aria-label="最小化"><Minus size={12} /></button><button type="button" className="pv-wc" aria-label="最大化"><Square size={10} /></button><button type="button" className="pv-wc is-close" aria-label="关闭"><X size={12} /></button></div>
      </header>
      <div className="pv-body">
      <aside className="pv-sidebar">
        <div className="pv-brand"><span className="pv-brand-avatar">墨</span><div><strong>墨衡</strong><small>工程经营管理</small></div><button type="button" className="pv-brand-more" aria-label="更多"><MoreHorizontal size={16} /></button></div>
        <div className="pv-sidebar-primary"><button type="button" className="pv-sidebar-new"><Plus size={15} />新建项目</button><button type="button" className="pv-ghost-icon" aria-label="更多"><MoreHorizontal size={16} /></button></div>
        <nav className="pv-nav">
          <div className="pv-nav-group">
            <NavButton active={view === 'overview'} onClick={() => setView('overview')}><LayoutDashboard size={16} />经营总览</NavButton>
            <NavButton><FileBarChart2 size={16} />报表中心</NavButton>
            <NavButton><Bell size={16} />待办与预警<i className="pv-nav-count">3</i></NavButton>
            <NavButton><Building2 size={16} />往来单位库</NavButton>
          </div>
          <div className="pv-nav-separator" />
          <div className="pv-nav-group">
            <NavButton><FolderKanban size={16} />成本工作台</NavButton>
            <NavButton><ReceiptText size={16} />成本分析</NavButton>
            <NavButton><Sparkles size={16} />成本助手<i className="pv-beta">BETA</i></NavButton>
          </div>
          <div className="pv-nav-separator" />
          <div className="pv-nav-group">
            <NavButton><FolderKanban size={16} />项目档案</NavButton>
            <NavButton><Users size={16} />项目成员与权限</NavButton>
          </div>
          <div className="pv-nav-separator" />
          <div className="pv-nav-group"><NavButton active={view === 'settings'} onClick={() => setView('settings')}><Settings2 size={16} />系统设置</NavButton></div>
        </nav>
        <div className="pv-sidebar-search"><Search size={14} /><span>搜索项目、成本记录</span><kbd>⌘ K</kbd></div>
        <div className="pv-sidebar-recent"><span>最近项目</span><button type="button"><i /><span><strong>金融城5号配电项目</strong><small>XM-2026-000001</small></span></button><button type="button"><i /><span><strong>滨江综合服务中心项目</strong><small>DEMO-001</small></span></button></div>
        <div className="pv-sidebar-footer"><button type="button" className="pv-user"><span className="pv-avatar">系</span><span><strong>系统管理员</strong><small>系统管理员</small></span><ChevronRight size={14} /></button><button type="button" className="pv-collapse"><PanelLeft size={16} /></button></div>
      </aside>
      <div className="pv-main">
        <header className="pv-topbar">
          <div className="pv-breadcrumb">工程经营管理 <span>/</span> <strong>{view === 'settings' ? '系统设置' : '经营总览'}</strong></div>
          <div className="pv-top-actions"><span className="pv-company">全公司 <ChevronDown size={12} /></span><div className="pv-top-search"><Search size={14} /><span>搜索清单、项目、单位…</span><kbd>⌘ K</kbd></div><button type="button" className="pv-icon-button" aria-label="通知"><Bell size={16} /></button><button type="button" className="pv-icon-button" aria-label="侧栏"><PanelLeft size={16} /></button><span className="pv-top-avatar">系</span></div>
        </header>
        <div className="pv-content"><OverviewPreview /></div>
        <footer className="pv-footer"><span>墨衡 · 施工单位成本管理</span><span>v2.19.0-rc.2</span></footer>
      </div>
      </div>
      {view === 'settings' && <div className="pv-settings-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setView('overview'); }}>
        <div className="pv-settings-modal" role="dialog" aria-modal="true" aria-label="系统设置">
          <SettingsSidebar />
          <SettingsPreview theme={theme} onThemeChange={switchTheme} />
          <button type="button" className="pv-modal-close" aria-label="关闭系统设置" onClick={() => setView('overview')}><X size={16} /></button>
        </div>
      </div>}
    </div>

    <div className="pv-preview-bar" role="toolbar" aria-label="主题预览">
      <span className="pv-preview-title">主题预览 <small>{meta.mode}</small></span>
      <div className="pv-preview-themes">{THEMES.map((item) => <button type="button" key={item.id} className={item.id === theme ? 'is-active' : ''} onClick={() => switchTheme(item.id)}><i style={{ background: item.bg, borderColor: item.accent }} />{item.name}</button>)}</div>
      <span className="pv-preview-divider" />
      <div className="pv-preview-views"><button type="button" className={view === 'overview' ? 'is-active' : ''} onClick={() => setView('overview')}>经营总览</button><button type="button" className={view === 'settings' ? 'is-active' : ''} onClick={() => setView('settings')}>系统设置</button></div>
    </div>
  </div>;

}
