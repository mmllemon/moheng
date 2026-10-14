import SelectField from '../components/SelectField';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { ArrowRight, ArrowUpRight, CircleAlert, ClipboardCheck, Coins, FolderKanban, Gauge, HandCoins, ReceiptText, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, formatDate, formatMoney, formatWan, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import type { Project } from '../types';

type PortfolioProject = Project & {
  targetCost: number;
  actualCost: number;
  receivedAmount: number;
  costVarianceAmount: number | null;
  recoveryRatio: number | null;
};
type DashboardData = {
  totals: { projectCount: number; contractAmount: number; targetCost: number; actualCost: number; receivedAmount: number };
  projects: PortfolioProject[];
  pendingChanges: { id: string; projectId: string; projectName: string; code: string; name: string; status: string; submittedAmount: number }[];
  recentActivities: { id: string; action: string; entity: string; entityId: string; actor: string; projectName: string; createdAt: string }[];
};

const activityLabel: Record<string, string> = { CREATE: '新增记录', UPDATE: '更新资料', UPSERT: '更新合同', STATUS_CHANGE: '状态变更', PAYMENT_REGISTERED: '登记到账', IMPORT_CSV: '批量导入', ARCHIVE: '归档记录', PAYMENT_RECORDED: '登记付款', PAYMENT_REFUND_RECORDED: '登记退款' };
const statusOptions = [{ value: 'ALL', label: '全部项目状态' }, { value: 'CONSTRUCTION', label: '施工中' }, { value: 'SETTLEMENT_PENDING', label: '待结算' }, { value: 'SETTLED', label: '已结算' }, { value: 'PAUSED', label: '已暂停' }];

export default function DashboardPage() {
  const navigate = useNavigate();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const uiTheme = useUiStore((state) => state.theme);
  const uiAccent = useUiStore((state) => state.accent);
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const data = dashboard.data;
  const filteredProjects = useMemo(() => (data?.projects ?? []).filter((project) => {
    const q = search.trim().toLowerCase();
    const matchedText = !q || `${project.name} ${project.code} ${project.ownerName} ${project.managerName ?? ''}`.toLowerCase().includes(q);
    return matchedText && (statusFilter === 'ALL' || project.status === statusFilter);
  }), [data?.projects, search, statusFilter]);

  if (dashboard.isLoading) return <div className="page-wrap"><LoadingBlock label="正在汇总全部可访问项目…" /></div>;
  if (dashboard.error) return <div className="page-wrap"><ErrorBlock message={(dashboard.error as Error).message} retry={() => void dashboard.refetch()} /></div>;

  const totals = data!.totals;
  const chartProjects = [...data!.projects].sort((left, right) => right.contractAmount - left.contractAmount).slice(0, 6);
  const recoveryRatio = totals.contractAmount > 0 ? totals.receivedAmount / totals.contractAmount : null;
  const costRatio = totals.targetCost > 0 ? totals.actualCost / totals.targetCost : null;
  const chartColors = uiAccent === 'jade'
    ? ['#2a9d82', '#d2a15f', '#6484bf']
    : uiAccent === 'cinnabar'
      ? ['#bf6354', '#d9aa61', '#638cb1']
      : uiTheme === 'champagne'
        ? ['#b45309', '#d6ad70', '#829478']
        : uiTheme === 'glacier'
          ? ['#0284c7', '#78b8d7', '#4da88e']
          : ['#6366f1', '#e6a25f', '#42a889'];
  const isDarkChart = uiTheme === 'obsidian' || (uiTheme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const axisText = isDarkChart ? '#a1a1aa' : '#8792a4';
  const axisLine = isDarkChart ? 'rgba(255,255,255,.10)' : '#e5eaf2';
  const portfolioOption = {
    color: chartColors,
    animationDuration: 260,
    animationEasing: 'cubicOut',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => formatMoney(value, 0) },
    legend: { top: 0, right: 6, icon: 'circle', itemWidth: 7, itemHeight: 7, textStyle: { color: axisText, fontSize: 10 } },
    grid: { left: 12, right: 14, top: 31, bottom: 37, containLabel: true },
    xAxis: { type: 'category', data: chartProjects.map((project) => project.name), axisLabel: { color: axisText, fontSize: 9, interval: 0, width: 72, overflow: 'truncate' }, axisLine: { lineStyle: { color: axisLine } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: axisText, fontSize: 9, formatter: (value: number) => value >= 10000 ? `${(value / 10000).toFixed(0)}万` : `${value}` }, splitLine: { lineStyle: { color: axisLine, type: 'dashed' } } },
    series: [
      { name: '有效合同额', type: 'bar', barMaxWidth: 13, data: chartProjects.map((project) => project.contractAmount), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '目标成本', type: 'bar', barMaxWidth: 13, data: chartProjects.map((project) => project.targetCost), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '实际成本', type: 'bar', barMaxWidth: 13, data: chartProjects.map((project) => project.actualCost), itemStyle: { borderRadius: [3, 3, 0, 0] } },
    ],
  };
  return <div className="page-wrap dashboard-page">
    <PageHeader eyebrow="PORTFOLIO / OVERVIEW" title="经营总览" subtitle="跨项目查看合同规模、目标成本、实际发生、业主回款与待跟进事项。此页不受当前项目选择影响。" actions={<Button onClick={() => navigate('/projects')}><FolderKanban size={16} />项目管理</Button>} />
    {data!.projects.length === 0 ? <EmptyState title="还没有可访问的项目" description="创建项目或请管理员为你的账号分配项目权限。" action={() => navigate('/projects')} /> : <>
      <section className="portfolio-bento-grid">
        <article className="panel portfolio-hero-panel">
          <div className="portfolio-hero-top">
            <div className="portfolio-hero-main"><span className="portfolio-hero-kicker">CONTRACT PORTFOLIO / 经营资产</span><span className="portfolio-hero-label">当前有效合同额</span><strong>{formatMoney(totals.contractAmount, 0)}</strong><p><span className="portfolio-count-chip"><FolderKanban size={12} />{totals.projectCount} 个项目</span> 按当前账号权限汇总，随台账实时更新</p></div>
            <div className="portfolio-hero-support"><div><span>目标成本</span><strong>{formatWan(totals.targetCost)}</strong></div><div><span>实际已发生成本</span><strong>{formatWan(totals.actualCost)}</strong></div></div>
          </div>
          <div className="portfolio-chart-heading"><div><h3>项目经营对比</h3><p>合同额、目标成本与实际成本 · 当前金额快照</p></div><span className="chart-mini-label">金额：元</span></div>
          {chartProjects.length ? <ReactECharts option={portfolioOption} style={{ height: 242 }} notMerge lazyUpdate /> : <div className="compact-empty">暂无可绘制的项目数据</div>}
          <div className="portfolio-chart-footnote">按有效合同额排序展示前 {chartProjects.length} 个项目；该图用于结构对比，不代表月度趋势或完工成本预测。</div>
        </article>
        <aside className="portfolio-metric-stack">
          <article className="panel portfolio-side-metric portfolio-receipt-metric">
            <div className="portfolio-side-heading"><span className="portfolio-side-icon"><Wallet size={16} /></span><span>累计业主回款</span><span className="portfolio-side-overline">COLLECTED</span></div>
            <strong>{formatWan(totals.receivedAmount)}</strong>
            <div className="portfolio-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, (recoveryRatio ?? 0) * 100))}%` }} /></div>
            <div className="portfolio-side-foot"><span>回款 / 合同额</span><b>{recoveryRatio == null ? '—' : `${(recoveryRatio * 100).toFixed(1)}%`}</b></div>
            <small>{recoveryRatio == null ? '当前尚无有效合同金额' : recoveryRatio >= 1 ? '累计回款已达到合同额' : '按当前有效合同额计算'}</small>
          </article>
          <article className="panel portfolio-side-metric portfolio-cost-metric">
            <div className="portfolio-side-heading"><span className="portfolio-side-icon"><Coins size={16} /></span><span>累计实际成本</span><span className="portfolio-side-overline">ACTUAL COST</span></div>
            <strong>{formatWan(totals.actualCost)}</strong>
            <div className="portfolio-progress-track cost-track"><span style={{ width: `${Math.max(0, Math.min(100, (costRatio ?? 0) * 100))}%` }} /></div>
            <div className="portfolio-side-foot"><span>目标成本 {formatWan(totals.targetCost)}</span><b className={costRatio != null && costRatio > 1 ? 'text-danger' : ''}>{costRatio == null ? '—' : `${(costRatio * 100).toFixed(1)}%`}</b></div>
            <small>{costRatio == null ? '尚未建立目标成本基线' : costRatio > 1 ? '实际成本高于当前目标成本' : '实际成本 / 目标成本'}</small>
          </article>
        </aside>
      </section>

      <section className="panel portfolio-panel">
        <div className="panel-heading"><div><h3>项目经营组合</h3><p>每一行均按单项目分别汇总；点击可进入该项目驾驶舱。</p></div><span className="portfolio-result-count">{filteredProjects.length} / {data!.projects.length} 个项目</span></div>
        <div className="portfolio-filter-bar"><label className="toolbar-search"><ReceiptText size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、编号、业主或项目经理" /></label><SelectField className="toolbar-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{statusOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</SelectField></div>
        {filteredProjects.length ? <div className="table-scroll"><table className="data-table portfolio-table"><thead><tr><th>项目</th><th>状态</th><th className="align-right">有效合同额</th><th className="align-right">目标成本</th><th className="align-right">实际成本</th><th className="align-right">成本偏差</th><th className="align-right">已收款</th><th className="align-right">回款/合同额</th><th>开工日期</th><th>入口</th></tr></thead><tbody>{filteredProjects.map((project) => <tr key={project.id} className="portfolio-project-row" onClick={() => { setSelectedProjectId(project.id); navigate('/workspace'); }}><td><strong className="table-primary-text">{project.name}</strong><small className="table-subtext">{project.code} · {project.ownerName}</small></td><td><StatusBadge status={project.status} /></td><td className="align-right numeric">{formatMoney(project.contractAmount, 0)}</td><td className="align-right numeric">{formatMoney(project.targetCost, 0)}</td><td className="align-right numeric">{formatMoney(project.actualCost, 0)}</td><td className={`align-right numeric ${project.costVarianceAmount != null && project.costVarianceAmount > 0 ? 'text-danger' : project.costVarianceAmount != null && project.costVarianceAmount < 0 ? 'text-success' : ''}`}>{project.costVarianceAmount == null ? '—' : `${project.costVarianceAmount > 0 ? '+' : ''}${formatMoney(project.costVarianceAmount, 0)}`}</td><td className="align-right numeric">{formatMoney(project.receivedAmount, 0)}</td><td className="align-right numeric">{project.recoveryRatio == null ? '—' : `${(project.recoveryRatio * 100).toFixed(1)}%`}</td><td>{formatDate(project.startDate)}</td><td><button className="table-action" onClick={(event) => { event.stopPropagation(); setSelectedProjectId(project.id); navigate('/workspace'); }}>项目驾驶舱 <ArrowUpRight size={13} /></button></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>全部可访问项目合计</td><td className="align-right numeric">{formatMoney(totals.contractAmount, 0)}</td><td className="align-right numeric">{formatMoney(totals.targetCost, 0)}</td><td className="align-right numeric">{formatMoney(totals.actualCost, 0)}</td><td className={`align-right numeric ${totals.targetCost > 0 && totals.actualCost > totals.targetCost ? 'text-danger' : totals.targetCost > 0 && totals.actualCost < totals.targetCost ? 'text-success' : ''}`}>{totals.targetCost > 0 ? `${totals.actualCost > totals.targetCost ? '+' : ''}${formatMoney(totals.actualCost - totals.targetCost, 0)}` : '—'}</td><td className="align-right numeric">{formatMoney(totals.receivedAmount, 0)}</td><td className="align-right numeric">{totals.contractAmount > 0 ? `${(totals.receivedAmount / totals.contractAmount * 100).toFixed(1)}%` : '—'}</td><td colSpan={2} /></tr></tfoot></table></div> : <div className="compact-empty">没有符合筛选条件的项目。</div>}
      </section>

      <section className="dashboard-lower-grid portfolio-lower-grid">
        <article className="panel pending-panel"><div className="panel-heading"><div><h3>跨项目待跟进变更</h3><p>已提交或审核中的业主侧变更</p></div><span className="subtle-count">{data!.pendingChanges.length.toString().padStart(2, '0')}</span></div>
          {data!.pendingChanges.length === 0 ? <div className="compact-empty"><ClipboardCheck size={20} /><span>当前没有待跟进变更</span></div> : <div className="pending-list">{data!.pendingChanges.slice(0, 6).map((item) => <button className="pending-item" key={item.id} onClick={() => { setSelectedProjectId(item.projectId); navigate('/workspace/changes'); }}><span className="pending-icon"><CircleAlert size={16} /></span><span className="pending-copy"><strong>{item.name}</strong><small>{item.projectName} · {item.code}</small></span><span className="pending-amount">{formatMoney(item.submittedAmount, 0)}</span><ArrowRight size={14} /></button>)}</div>}
          <div className="panel-divider" /><button className="panel-footer-link" onClick={() => navigate('/projects')}><HandCoins size={15} />项目和回款总览 <ArrowRight size={14} /></button>
        </article>
        <article className="panel activity-panel portfolio-activity-panel"><div className="panel-heading"><div><h3>最近操作</h3><p>所有可访问项目的操作流水</p></div><Gauge size={18} className="heading-muted-icon" /></div>
          {data!.recentActivities.length === 0 ? <div className="compact-empty">暂无操作记录</div> : <div className="activity-list">{data!.recentActivities.map((activity) => <div className="activity-row" key={activity.id}><span className="activity-dot" /><div className="activity-text"><strong>{activity.actor} <span>{activityLabel[activity.action] ?? activity.action}</span></strong><small>{activity.projectName} · {activity.entity}</small></div><time>{new Date(activity.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>)}</div>}
        </article>
      </section>
    </>}
  </div>;
}
