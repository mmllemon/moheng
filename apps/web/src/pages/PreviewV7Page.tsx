import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, BarChart3, CalendarDays, ChevronDown, ChevronRight,
  CircleAlert, Download, FileText, FolderKanban, Gauge, Plus, RefreshCw, Search,
  ShieldCheck, Users,
} from 'lucide-react';
import { Button, PageHeader, formatMoney } from '../components/Ui';
import '../styles/v7-page-previews.css';

const screens = [
  { id: 'overview', label: '经营总览', no: '01' },
  { id: 'project', label: '项目驾驶舱', no: '02' },
  { id: 'analysis', label: '成本分析', no: '03' },
  { id: 'budget', label: '预算与目标成本', no: '04' },
  { id: 'projects', label: '项目管理', no: '05' },
  { id: 'system', label: '系统管理概览', no: '06' },
] as const;
type ScreenId = typeof screens[number]['id'];

const project = {
  name: '滨江综合服务中心项目',
  code: 'DEMO-001',
  owner: '滨江城市建设发展有限公司',
  manager: '王工',
  contract: 12580000,
  target: 1116800,
  actual: 74800,
  received: 0,
  start: '2026-01-15',
  end: '2027-06-30',
};
const budgetRows = [
  { id: 'civil', code: '01', name: '土建工程', amount: 620000, actual: 74800, parent: true },
  { id: 'steel', code: '0101', name: '钢筋工程', amount: 280000, actual: 58000, parent: false },
  { id: 'concrete', code: '0102', name: '混凝土工程', amount: 220000, actual: 16800, parent: false },
  { id: 'install', code: '02', name: '安装工程', amount: 350000, actual: 0, parent: true },
  { id: 'water', code: '0201', name: '给排水工程', amount: 120000, actual: 0, parent: false },
  { id: 'electric', code: '0202', name: '电气工程', amount: 150000, actual: 0, parent: false },
  { id: 'other', code: '03', name: '其他费用', amount: 146800, actual: 0, parent: false },
];
const costRows = [
  { name: '人工费', target: 180000, actual: 16800, color: 'var(--seal)' },
  { name: '材料费', target: 620000, actual: 58000, color: 'var(--mineral)' },
  { name: '机械费', target: 160000, actual: 0, color: 'var(--ochre)' },
  { name: '分包费', target: 120000, actual: 0, color: 'var(--meta)' },
  { name: '其他', target: 36800, actual: 0, color: 'var(--line-strong)' },
];
const monthly = [
  { month: '07', value: 0 },
  { month: '08', value: 0 },
  { month: '09', value: 0 },
  { month: '10', value: 74800 },
];
const activity = [
  { time: '10/20 15:54', title: '登记预付款到账', detail: 'OwnerReceipt · 系统管理员' },
  { time: '10/20 15:54', title: '创建竣工结算草稿', detail: 'OwnerContractSettlement · 系统管理员' },
  { time: '10/20 14:02', title: '更新目标成本清单', detail: 'BudgetItem · 王工' },
  { time: '10/19 17:20', title: '关联分供合同', detail: 'CostEntry · 李工' },
];
const notes = [
  { no: '01', title: '外部确认待补', text: '地下室变更 380,000 待补外部确认，确认前不并入有效合同额。', author: '王工' },
  { no: '02', title: '材料费核对', text: '10 月材料费 58,000，需与钢筋进场单、发票逐笔核对。', author: '李工' },
  { no: '03', title: '分供合同待关联', text: '结算前补齐分供合同与付款计划，避免成本重复。', author: '周工' },
];

function PreviewBar({ active, onChange }: { active: ScreenId; onChange: (id: ScreenId) => void }) {
  return <div className="vp-bar">
    <div className="vp-bar-label"><span>V7</span><strong>页面预览</strong></div>
    <nav aria-label="V7 页面预览">
      {screens.map((screen) => <button key={screen.id} type="button" className={active === screen.id ? 'is-active' : ''} onClick={() => onChange(screen.id)}>
        <span>{screen.no}</span>{screen.label}
      </button>)}
    </nav>
    <span className="vp-bar-note">只读样张 · 静态快照</span>
  </div>;
}

function OverviewScreen({ go }: { go: (id: ScreenId) => void }) {
  const navigate = useNavigate();
  const execution = (project.actual / project.target) * 100;
  return <>
    <PageHeader title="经营总览" subtitle="全公司 · 1 个项目 · 数据截至 2026-10-20 17:30" actions={<><Button variant="secondary" onClick={() => navigate('/reports')}><Download size={15} />导出月报</Button><Button onClick={() => navigate('/projects')}><Plus size={15} />新建项目</Button></>} />
    <section className="vp-hero">
      <div>
        <div className="vp-kicker">当前有效合同额 <em>CONTRACT VALUE</em></div>
        <div className="vp-amount"><span>¥</span>12,580,000</div>
        <p className="vp-hero-copy">1 个在施 · 0 个待结算 · 0 个暂停；合同额按有效合同汇总。</p>
        <div className="vp-scale-wrap">
          <span>成本执行 {execution.toFixed(1)}%</span>
          <div className="vp-scale"><i style={{ left: execution + '%' }} /></div>
        </div>
      </div>
      <div className="vp-hero-stats">
        <div><span>目标成本</span><strong>¥1,116,800</strong><small>末级清单合计</small></div>
        <div><span>实际成本</span><strong>¥74,800</strong><small>已归集 · 未归档</small></div>
        <div><span>累计回款</span><strong>¥0</strong><small>回款率 0.0%</small></div>
        <div><span>成本余量</span><strong>¥1,042,000</strong><small>较目标成本</small></div>
      </div>
    </section>
    <section className="vp-section">
      <div className="vp-section-head"><div><h2>项目台账</h2><p>按合同额排序 · 仅显示当前账号有权访问的项目</p></div><Button variant="ghost" onClick={() => go('projects')}>全部项目 <ArrowRight size={14} /></Button></div>
      <div className="table-scroll"><table className="data-table vp-table"><thead><tr><th>项目</th><th>状态</th><th className="align-right">合同额</th><th className="align-right">目标成本</th><th className="align-right">已发生</th><th className="align-right">成本余量</th><th className="align-right">回款率</th></tr></thead><tbody>
        <tr className="vp-clickable" onClick={() => go('project')}><td><strong className="table-primary-text">滨江综合服务中心项目</strong><small className="table-subtext">{project.code} · {project.owner}</small></td><td><span className="vp-status is-live">施工中</span></td><td className="align-right numeric">¥12,580,000</td><td className="align-right numeric">¥1,116,800</td><td className="align-right numeric">¥74,800</td><td className="align-right numeric">¥1,042,000</td><td className="align-right numeric">0.0%</td></tr>
      </tbody></table></div>
    </section>
    <div className="vp-lower">
      <section className="vp-section">
        <div className="vp-section-head"><div><h2>近期变动</h2><p>按操作时间倒序 · 只读审计摘要</p></div><Button variant="ghost" onClick={() => navigate('/audit-logs')}>操作日志 <ArrowRight size={14} /></Button></div>
        <div className="vp-activity">{activity.map((item) => <div className="vp-activity-row" key={item.time + item.title}><span className="vp-time">{item.time}</span><strong>{item.title}</strong><span>{item.detail}</span></div>)}</div>
      </section>
      <aside className="vp-section vp-notes">
        <div className="vp-section-head"><div><h2>待办与批注</h2><p>3 条需要人工判断的事项</p></div></div>
        {notes.map((note) => <button type="button" className="vp-note-row" key={note.no} onClick={() => go('project')}><span className="vp-note-no">{note.no}</span><span><strong>{note.title}</strong><small>{note.text}</small></span></button>)}
      </aside>
    </div>
    <p className="vp-footnote">口径：合同额取有效主合同与已确认变更；实际成本只含已归集且未归档记录。预览数据为静态快照。</p>
  </>;
}

function ProjectScreen() {
  const navigate = useNavigate();
  const totalActual = costRows.reduce((sum, row) => sum + row.actual, 0);
  return <>
    <PageHeader title="项目驾驶舱" subtitle="围绕当前项目查看收入合同、目标成本、已发生成本、回款与分供合同概况。" actions={<><Button variant="secondary" onClick={() => navigate('/reports')}><Download size={15} />导出项目月报</Button><Button onClick={() => navigate('/cost/analysis')}><BarChart3 size={15} />查看成本分析</Button></>} />
    <section className="vp-identity">
      <div><span className="vp-code">{project.code}</span><h2>{project.name}</h2><p>{project.owner} · 项目经理 {project.manager}</p></div>
      <div className="vp-identity-facts"><span>开工<strong>{project.start}</strong></span><span>计划竣工<strong>{project.end}</strong></span><span>状态<strong>施工中</strong></span></div>
    </section>
    <section className="vp-metric-line">
      <div><span>当前有效合同额</span><strong>¥12,580,000</strong><small>主合同 HT-DEMO-001</small></div>
      <div><span>目标成本</span><strong>¥1,116,800</strong><small>末级清单合计</small></div>
      <div><span>实际成本</span><strong>¥74,800</strong><small>较目标节约 ¥1,042,000</small></div>
      <div><span>累计回款</span><strong>¥0</strong><small>回款率 0.0%</small></div>
    </section>
    <div className="vp-project-grid">
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>成本构成</h2><p>已发生成本按费用类型拆分</p></div><span className="vp-mini">合计 ¥{totalActual.toLocaleString('zh-CN')}</span></div>
        <div className="vp-stack" aria-hidden="true">{costRows.map((row) => <i key={row.name} style={{ width: (row.actual / Math.max(1, totalActual) * 100) + '%', background: row.color }} />)}</div>
        <div className="vp-legend">{costRows.map((row) => <span key={row.name}><i style={{ background: row.color }} />{row.name}<b>{totalActual ? (row.actual / totalActual * 100).toFixed(1) : '0.0'}%</b></span>)}</div>
        <div className="vp-cost-list">{costRows.map((row) => <div key={row.name}><span>{row.name}</span><strong>{formatMoney(row.actual, 0)}</strong><small>目标 {formatMoney(row.target, 0)}</small></div>)}</div>
      </section>
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>关键日期</h2><p>节点与风险提示</p></div></div>
        <div className="vp-timeline">
          <div><span>2026-01-15</span><strong>项目开工</strong><small>主合同已签 · 已进场</small></div>
          <div><span>2026-10-20</span><strong>地下室变更待确认</strong><small>金额 ¥380,000 · 外部确认未登记</small></div>
          <div><span>2027-06-30</span><strong>计划竣工</strong><small>当前进度未触发延期</small></div>
        </div>
        <div className="vp-risk-note"><CircleAlert size={14} /><span>1 项待办：变更签证外部确认；确认前不并入有效合同额。</span></div>
      </section>
    </div>
    <section className="vp-section">
      <div className="vp-section-head"><div><h2>分供合同与应收</h2><p>合同链与资金节点</p></div><Button variant="ghost" onClick={() => navigate('/cost/downstream')}>查看分供台账 <ArrowRight size={14} /></Button></div>
      <table className="data-table vp-table"><thead><tr><th>对象</th><th>类型</th><th className="align-right">金额</th><th>状态</th><th>下一步</th></tr></thead><tbody>
        <tr><td><strong>材料供应商 · 2 家</strong><small className="table-subtext">钢筋、混凝土</small></td><td>分供合同</td><td className="align-right numeric">¥0</td><td><span className="vp-status is-wait">待关联</span></td><td>补合同链后进入应付台账</td></tr>
        <tr><td><strong>业主应收</strong><small className="table-subtext">主合同 HT-DEMO-001</small></td><td>应收</td><td className="align-right numeric">¥0</td><td><span className="vp-status is-live">未申报</span></td><td>按进度款节点申报</td></tr>
        <tr><td><strong>质保金</strong><small className="table-subtext">竣工结算后释放</small></td><td>留存</td><td className="align-right numeric">¥0</td><td><span className="vp-status">未发生</span></td><td>结算时按合同比例计提</td></tr>
      </tbody></table>
    </section>
  </>;
}

function AnalysisScreen({ go }: { go: (id: ScreenId) => void }) {
  const maxMonth = Math.max(...monthly.map((item) => item.value), 1);
  return <>
    <PageHeader title="成本分析" subtitle="当前项目 · 成本执行、清单偏差、构成与月度趋势；数据口径为已归集、未归档成本。" actions={<Button variant="secondary" onClick={() => go('budget')}><FileText size={15} />查看目标成本</Button>} />
    <section className="vp-analysis-stats">
      <div><span>成本执行率</span><strong>6.7%</strong><small>实际 / 目标成本</small></div>
      <div><span>目标成本</span><strong>¥1,116,800</strong><small>末级清单合计</small></div>
      <div><span>已发生成本</span><strong>¥74,800</strong><small>人工 16,800 / 材料 58,000</small></div>
      <div><span>成本余量</span><strong>¥1,042,000</strong><small>未发生 · 不作为利润</small></div>
    </section>
    <div className="vp-analysis-grid">
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>清单偏差</h2><p>目标成本 vs 已发生</p></div><span className="vp-mini">单位：元</span></div>
        {costRows.map((row) => <div className="vp-var-row" key={row.name}>
          <div><strong>{row.name}</strong><small>{formatMoney(row.actual, 0)} / {formatMoney(row.target, 0)}</small></div>
          <div className="vp-var-bars"><i className="is-target" style={{ width: '100%' }} /><i className="is-actual" style={{ width: (row.actual / row.target * 100) + '%', background: row.color }} /></div>
          <b>{row.target ? (row.actual / row.target * 100).toFixed(1) : '0.0'}%</b>
        </div>)}
      </section>
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>成本构成</h2><p>已发生 74,800</p></div></div>
        <div className="vp-donut" aria-hidden="true" />
        <div className="vp-donut-legend">{costRows.filter((row) => row.actual > 0).map((row) => <span key={row.name}><i style={{ background: row.color }} />{row.name}<b>{formatMoney(row.actual, 0)}</b></span>)}</div>
        <p className="vp-muted">材料费占已发生成本 77.5%，是本月核对重点。</p>
      </section>
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>月度成本</h2><p>近 4 个月</p></div></div>
        <div className="vp-bars">{monthly.map((item) => <div key={item.month}><span className="vp-bar-value">{item.value ? (item.value / 1000).toFixed(1) + 'k' : ''}</span><i style={{ height: Math.max(2, item.value / maxMonth * 100) + '%' }} /><small>{item.month} 月</small></div>)}</div>
        <div className="vp-muted">10 月归集 74,800；7–9 月无已归集成本记录。</div>
      </section>
    </div>
    <section className="vp-section vp-basis">
      <div className="vp-section-head"><div><h2>口径与基准</h2><p>分析结果不替代合同、结算和审计结论</p></div></div>
      <div className="vp-definition"><div><span>目标成本</span><p>末级目标成本清单合计；父级只汇总，不重复计入。</p></div><div><span>已发生成本</span><p>已归集且未归档的实际成本记录；不含未发生承诺。</p></div><div><span>成本余量</span><p>目标减已发生，仅表示剩余预算空间，不是利润。</p></div></div>
    </section>
  </>;
}

function BudgetScreen({ go }: { go: (id: ScreenId) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ civil: true, install: true });
  const parentOf: Record<string, string> = { steel: 'civil', concrete: 'civil', water: 'install', electric: 'install' };
  const visibleRows = budgetRows.filter((row) => !parentOf[row.id] || expanded[parentOf[row.id]!]);
  function toggle(id: string) { setExpanded((current) => ({ ...current, [id]: !current[id] })); }
  return <>
    <PageHeader title="预算与目标成本" subtitle="目标成本清单、已录成本与执行率；父级只汇总，末级参与计算。" actions={<><Button variant="secondary" onClick={() => go('analysis')}><BarChart3 size={15} />成本分析</Button><Button onClick={() => go('projects')}><Plus size={15} />新增清单</Button></>} />
    <section className="vp-analysis-stats">
      <div><span>目标成本总额</span><strong>¥1,116,800</strong><small>7 条末级清单</small></div>
      <div><span>已录成本</span><strong>¥74,800</strong><small>2 条实际成本</small></div>
      <div><span>成本余量</span><strong>¥1,042,000</strong><small>未发生预算</small></div>
      <div><span>成本执行率</span><strong>6.7%</strong><div className="vp-scale vp-scale-small"><i style={{ left: '6.7%' }} /></div></div>
    </section>
    <div className="vp-budget-layout">
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>目标成本清单</h2><p>点击父级展开/收起 · 末级可继续录入实际成本</p></div><Button variant="ghost" onClick={() => go('analysis')}>分析 <ArrowRight size={14} /></Button></div>
        <table className="data-table vp-table vp-budget-table"><thead><tr><th>编号 / 名称</th><th className="align-right">目标成本</th><th className="align-right">已录</th><th className="align-right">执行</th></tr></thead><tbody>
          {visibleRows.map((row) => <tr key={row.id} className={row.parent ? 'vp-parent-row' : 'vp-child-row'}>
            <td>{row.parent ? <button type="button" className="vp-tree-toggle" onClick={() => toggle(row.id)} aria-expanded={expanded[row.id]}>{expanded[row.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span><strong>{row.name}</strong><small>{row.code}</small></span></button> : <span className="vp-tree-leaf"><span>{row.name}</span><small>{row.code}</small></span>}</td>
            <td className="align-right numeric">{formatMoney(row.amount, 0)}</td>
            <td className="align-right numeric">{formatMoney(row.actual, 0)}</td>
            <td className="align-right numeric">{row.amount ? (row.actual / row.amount * 100).toFixed(1) : '—'}%</td>
          </tr>)}
        </tbody></table>
        <div className="vp-table-foot"><span>合计 7 条末级清单</span><strong>¥1,116,800</strong></div>
      </section>
      <aside className="vp-panel vp-budget-aside">
        <div className="vp-section-head"><div><h2>清单结构</h2><p>按一级科目汇总</p></div></div>
        <div className="vp-structure">{budgetRows.filter((row) => row.parent).map((row) => <div key={row.id}><span>{row.name}</span><strong>{formatMoney(row.amount, 0)}</strong><i><b style={{ width: (row.amount / 1116800 * 100) + '%' }} /></i></div>)}</div>
        <div className="vp-aside-note"><CircleAlert size={14} /><p>材料费已录 58,000，占目标材料费 9.4%；10 月钢筋进场单待核对。</p></div>
        <Button variant="secondary" onClick={() => go('analysis')}>查看成本分析 <ArrowRight size={14} /></Button>
      </aside>
    </div>
  </>;
}

function ProjectsScreen({ go }: { go: (id: ScreenId) => void }) {
  const navigate = useNavigate();
  return <>
    <PageHeader title="项目管理" subtitle="维护项目档案、主合同与项目状态；项目成员授权在项目成员页单独办理。" actions={<Button onClick={() => navigate('/projects')}><Plus size={15} />新建项目</Button>} />
    <section className="vp-project-kpis">
      <div><span>在施项目</span><strong>1</strong><small>全部项目 1 个</small></div>
      <div><span>合同额合计</span><strong>¥12,580,000</strong><small>按有效合同汇总</small></div>
      <div><span>待结算</span><strong>0</strong><small>暂无待结算项目</small></div>
    </section>
    <div className="vp-projects-layout">
      <section className="vp-panel">
        <div className="vp-toolbar"><div className="vp-search"><Search size={14} /><input placeholder="搜索项目名称、编号或业主单位" aria-label="搜索项目" /></div><select aria-label="项目状态"><option>全部状态</option><option>施工中</option><option>待结算</option></select></div>
        <table className="data-table vp-table vp-project-table"><thead><tr><th>项目</th><th>业主</th><th>状态</th><th className="align-right">合同额</th><th>项目经理</th></tr></thead><tbody>
          <tr className="is-selected" onClick={() => go('project')}><td><strong>滨江综合服务中心项目</strong><small className="table-subtext">DEMO-001</small></td><td>滨江城市建设发展有限公司</td><td><span className="vp-status is-live">施工中</span></td><td className="align-right numeric">¥12,580,000</td><td>王工</td></tr>
        </tbody></table>
        <div className="vp-table-foot"><span>1 个项目</span><span>数据截至 2026-10-20</span></div>
      </section>
      <aside className="vp-dossier">
        <span className="vp-kicker">项目档案 / DOSSIER</span>
        <h2>滨江综合服务中心项目</h2>
        <p>滨江城市建设发展有限公司 · 项目经理 王工</p>
        <div className="vp-dossier-facts">
          <div><span>项目编号</span><strong>DEMO-001</strong></div>
          <div><span>工程类型</span><strong>房屋建筑</strong></div>
          <div><span>开工日期</span><strong>2026-01-15</strong></div>
          <div><span>计划竣工</span><strong>2027-06-30</strong></div>
          <div><span>合同额</span><strong>¥12,580,000</strong></div>
          <div><span>项目状态</span><strong>施工中</strong></div>
        </div>
        <div className="vp-dossier-actions"><Button variant="secondary" onClick={() => go('project')}>进入驾驶舱</Button><Button variant="ghost" onClick={() => navigate('/projects/members')}>项目成员 <ArrowRight size={14} /></Button></div>
      </aside>
    </div>
  </>;
}

function SystemScreen() {
  const navigate = useNavigate();
  return <>
    <PageHeader title="系统管理概览" subtitle="系统状态、需要关注的安全事项和治理建设进度；详细管理进入专门工作台。" actions={<Button variant="secondary" onClick={() => navigate('/system')}><RefreshCw size={15} />刷新状态</Button>} />
    <section className="vp-system-stats">
      <div><span>启用账号</span><strong>1 / 1</strong><small>停用账号不能建立会话</small></div>
      <div><span>有效会话</span><strong>162</strong><small>最长 7 天 · 闲置 12 小时失效</small></div>
      <div><span>近 7 天安全事件</span><strong>176</strong><small>按最近 200 条统计</small></div>
      <div><span>账号待处理</span><strong>1</strong><small>强制改密 / 管理员 MFA</small></div>
    </section>
    <div className="vp-system-grid">
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>需要关注</h2><p>失败、阻断、撤销和高风险认证</p></div><Button variant="ghost" onClick={() => navigate('/system/security')}>安全中心 <ArrowRight size={14} /></Button></div>
        <div className="vp-risk-list">
          <div><span className="vp-risk-dot is-warn">!</span><span><strong>管理员 MFA 未启用</strong><small>公网部署前必须启用验证器多因素认证。</small></span><span className="vp-status is-wait">待处理</span></div>
          <div><span className="vp-risk-dot is-ok">✓</span><span><strong>最近 7 天无高风险阻断</strong><small>最近 200 条事件中未发现匹配项。</small></span><span className="vp-status is-ok">正常</span></div>
        </div>
      </section>
      <section className="vp-panel">
        <div className="vp-section-head"><div><h2>治理能力</h2><p>源码已落地，执行状态取决于部署配置</p></div></div>
        <div className="vp-capability">
          <div><span>账号、会话与安全事件</span><span className="vp-status is-ok">正常</span></div>
          <div><span>组织与版本化审批规则</span><span className="vp-status is-ok">正常</span></div>
          <div><span>统一基础字典</span><span className="vp-status is-ok">正常</span></div>
          <div><span>统一参数配置</span><span className="vp-status is-ok">正常</span></div>
          <div><span>备份恢复验证工作台</span><span className="vp-status is-ok">正常</span></div>
          <div><span>真实公网 TLS 与端到端验收</span><span className="vp-status is-wait">待验收</span></div>
        </div>
      </section>
    </div>
    <section className="vp-section">
      <div className="vp-section-head"><div><h2>管理入口</h2><p>按职责进入专门工作台</p></div></div>
      <div className="vp-entry-grid">
        <button type="button" onClick={() => navigate('/system/accounts')}><Users size={16} /><span><strong>账号管理</strong><small>公司级登录身份</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => navigate('/system/security')}><ShieldCheck size={16} /><span><strong>登录安全</strong><small>会话、事件与撤销</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => navigate('/system/authorization')}><Gauge size={16} /><span><strong>授权复核</strong><small>权限基线与快照</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => navigate('/system/policies')}><FileText size={16} /><span><strong>权限与流程</strong><small>策略版本与审批</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => navigate('/system/dictionaries')}><FolderKanban size={16} /><span><strong>基础字典</strong><small>分类与选项</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => navigate('/system/operations')}><CalendarDays size={16} /><span><strong>运维备份</strong><small>状态、备份与演练</small></span><ArrowRight size={14} /></button>
      </div>
    </section>
  </>;
}

export default function PreviewV7Page() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('screen') as ScreenId | null;
  const active: ScreenId = requested && screens.some((screen) => screen.id === requested) ? requested : 'overview';
  const go = (id: ScreenId) => {
    setParams({ screen: id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return <div className="page-wrap vp-page">
    <PreviewBar active={active} onChange={go} />
    {active === 'overview' && <OverviewScreen go={go} />}
    {active === 'project' && <ProjectScreen />}
    {active === 'analysis' && <AnalysisScreen go={go} />}
    {active === 'budget' && <BudgetScreen go={go} />}
    {active === 'projects' && <ProjectsScreen go={go} />}
    {active === 'system' && <SystemScreen />}
  </div>;
}
