import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Banknote, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, FileSignature, HandCoins, ReceiptText } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectSummaryReportButton } from '../components/ReportLaunchButton';
import { Button, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader, StatusBadge, percentage } from '../components/Ui';
import type { Analysis, ChangeRecord, ProgressBill, Project } from '../types';

type ProjectDetail = Project & { mainContract?: { id: string; contractNo: string; name: string; amount: number; signedAt?: string | null } | null };
type DownstreamResponse = { items: { id: string; status: string; currentAmount: number }[]; summary: { contractCount: number; activeContractCount: number; activeAndPendingSettlementContractAmount: number; paidAmount: number; linkedActualCost: number } };

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId);
  const themeName = useUiStore((state) => state.theme);
  const projectQuery = useQuery({ queryKey: ['project-detail', projectId], queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`), enabled: Boolean(projectId) });
  const analysisQuery = useQuery({ queryKey: ['analysis', projectId], queryFn: () => api.get<Analysis>(`/projects/${projectId}/analysis/three-way`), enabled: Boolean(projectId) });
  const billsQuery = useQuery({ queryKey: ['progress-bills', projectId], queryFn: () => api.get<ProgressBill[]>(`/projects/${projectId}/progress-bills`), enabled: Boolean(projectId) });
  const changesQuery = useQuery({ queryKey: ['changes', projectId], queryFn: () => api.get<ChangeRecord[]>(`/projects/${projectId}/changes`), enabled: Boolean(projectId) });
  const downstreamQuery = useQuery({ queryKey: ['downstream-contracts', projectId], queryFn: () => api.get<DownstreamResponse>(`/projects/${projectId}/downstream-contracts`), enabled: Boolean(projectId) });

  const queries = [projectQuery, analysisQuery, billsQuery, changesQuery, downstreamQuery];
  if (queries.some((query) => query.isLoading)) return <div className="page-wrap"><LoadingBlock label="正在汇总项目经营数据…" /></div>;
  const failed = queries.find((query) => query.error);
  if (failed) return <div className="page-wrap"><ErrorBlock message={(failed.error as Error).message} retry={() => { queries.forEach((query) => void query.refetch()); }} /></div>;

  const project = projectQuery.data!;
  const analysis = analysisQuery.data!;
  const bills = billsQuery.data ?? [];
  const changes = changesQuery.data ?? [];
  const downstream = downstreamQuery.data;
  const pendingBills = bills.filter((bill) => !['PAID', 'REJECTED'].includes(bill.status));
  const pendingChanges = changes.filter((change) => ['SUBMITTED', 'UNDER_REVIEW'].includes(change.status));
  const costVariance = analysis.actualCost - analysis.targetCost;
  // ECharts 只认实际颜色值；从当前 Hana 主题 token 读取，切换青夜/素白时同步重绘。
  const chartStyle = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => chartStyle.getPropertyValue(name).trim() || fallback;
  const chartAccentRgb = token('--accent-rgb', '83, 125, 150');
  const monthlyOption = {
    tooltip: {
      trigger: 'axis',
      confine: true,
      className: 'v6-chart-tooltip',
      backgroundColor: token('--bg-card', '#fcfaf5'),
      borderColor: token('--border', 'rgba(122,96,88,.18)'),
      borderWidth: 1,
      padding: 0,
      textStyle: { color: token('--text', '#3b3d3f'), fontFamily: token('--font-ui', 'sans-serif'), fontSize: 11 },
      extraCssText: 'border-radius:8px;padding:8px 10px;box-shadow:0 8px 24px rgba(20,18,14,.14);',
      formatter: (params: unknown) => {
        const point = (Array.isArray(params) ? params[0] : params) as { axisValue?: string; value?: number } | undefined;
        return '<div class="v6-chart-tooltip-inner"><span>' + (point?.axisValue ?? '') + '</span><strong>' + formatMoney(Number(point?.value ?? 0)) + '</strong><small>实际发生成本</small></div>';
      },
      axisPointer: { type: 'shadow', shadowStyle: { color: `rgba(${chartAccentRgb},.07)` } },
    },
    // Reserve room for long currency tick labels; containLabel prevents clipping at the panel edge.
    grid: { left: 68, right: 18, top: 22, bottom: 34, containLabel: true },
    xAxis: { type: 'category', data: analysis.monthlyActualCost.map((row) => row.month), axisLine: { lineStyle: { color: token('--border', '#d8cfbe') } }, axisTick: { show: false }, axisLabel: { color: token('--text-muted', '#6b6f73'), fontSize: 11 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: token('--border', '#e8e3d7'), type: 'dashed' } }, axisLabel: { color: token('--text-muted', '#6b6f73'), margin: 10, hideOverlap: true, formatter: (v: number) => v >= 100000000 ? `${(v / 100000000).toFixed(1)}亿` : v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万` : v.toLocaleString('zh-CN') } },
    series: [{ name: '实际发生成本', type: 'bar', data: analysis.monthlyActualCost.map((row) => row.amount), barMaxWidth: 26, itemStyle: { color: token('--accent', '#537d96'), borderRadius: 2 } }],
  };

  const executionRate = analysis.targetCost > 0 ? analysis.actualCost / analysis.targetCost : null;
  const collectionRate = analysis.contractAmount > 0 ? analysis.billSummary.paidAmount / analysis.contractAmount : null;
  const executionPct = executionRate == null ? 0 : Math.min(100, Math.max(0, executionRate * 100));
  const collectionPct = collectionRate == null ? 0 : Math.min(100, Math.max(0, collectionRate * 100));
  const hasMonthlyCost = analysis.monthlyActualCost.some((row) => row.amount > 0);
  const entryCards = [
    { to: '/cost/contracts', title: '业主主合同', description: '合同基准与当前有效金额', icon: FileSignature, value: formatMoney(analysis.contractAmount, 0), note: project.mainContract?.contractNo ?? '尚未建立主合同' },
    { to: '/cost/budget', title: '预算与目标成本', description: '成本控制基准与清单', icon: ClipboardList, value: formatMoney(analysis.targetCost, 0), note: analysis.byBudget.length ? `${analysis.byBudget.length} 项末级清单` : '尚未维护清单' },
    { to: '/cost/progress-bills', title: '进度款管理', description: '申报、审批与业主回款', icon: HandCoins, value: `${bills.length} 笔申报`, note: `已回款 ${formatMoney(analysis.billSummary.paidAmount, 0)}` },
    { to: '/cost/changes', title: '变更签证', description: '内部审批、外部确认与生效金额', icon: Activity, value: `${changes.length} 项变更`, note: pendingChanges.length ? `${pendingChanges.length} 项待跟进` : '暂无待跟进' },
    { to: '/cost/downstream', title: '分供合同与付款', description: '分包、采购、租赁合同与现金流', icon: Banknote, value: `${downstream?.summary.contractCount ?? 0} 份合同`, note: `执行中 ${downstream?.summary.activeContractCount ?? 0} 份` },
    { to: '/cost/costs', title: '实际成本', description: '录入成本并关联合同来源', icon: ReceiptText, value: formatMoney(analysis.actualCost, 0), note: executionRate == null ? '尚未建立目标成本' : `执行率 ${percentage(executionRate)}` },
  ];

  return <div className="page-wrap project-overview-page project-cockpit-page">
    <PageHeader eyebrow="PROJECT WORKSPACE / PROJECT BRIEF" title="项目驾驶舱" subtitle="围绕当前项目查看收入合同、目标成本、已发生成本、回款与分供合同概况。" actions={<><ProjectSummaryReportButton /><Button variant="secondary" onClick={() => navigate('/cost/analysis')}><Activity size={15} />查看成本分析</Button></>} />
    <section className="panel project-cockpit-hero">
      <div className="project-cockpit-identity">
        <div className="project-cockpit-mark">{project.name.slice(0, 1)}</div>
        <div className="project-cockpit-copy">
          <div className="project-cockpit-meta"><span>{project.code}</span><StatusBadge status={project.status} /></div>
          <h2>{project.name}</h2>
          <p><span className="project-cockpit-owner">{project.ownerPartyId ? <Link to={`/parties/${project.ownerPartyId}`}>{project.ownerName} ↗</Link> : project.ownerName}</span><span className="project-cockpit-manager">项目经理：{project.managerName || '未填写'}</span></p>
          <div className="project-cockpit-dates"><span>开工 {formatDate(project.startDate)}</span><span>计划竣工 {formatDate(project.plannedEndDate)}</span><span>{project.address || '地址未填写'}</span></div>
        </div>
      </div>
      <div className="project-cockpit-finance">
        <span className="project-cockpit-kicker">当前有效合同额</span>
        <strong className="project-cockpit-amount">{formatMoney(analysis.contractAmount, 0)}</strong>
        <small>{project.mainContract ? `主合同 ${project.mainContract.contractNo}` : '尚未建立主合同'}</small>
        <div className="project-cockpit-money">
          <div><span>目标成本</span><strong>{formatMoney(analysis.targetCost, 0)}</strong></div>
          <div><span>实际成本</span><strong>{formatMoney(analysis.actualCost, 0)}</strong></div>
          <div><span>累计回款</span><strong>{formatMoney(analysis.billSummary.paidAmount, 0)}</strong></div>
        </div>
      </div>
      <div className="project-cockpit-health">
        <div className="project-cockpit-health-row">
          <div><span>成本执行率</span><strong>{executionRate == null ? '未建立' : percentage(executionRate)}</strong></div>
          <div className="project-cockpit-meter" aria-hidden="true"><span style={{ width: `${executionPct}%` }} /></div>
          <small>{executionRate == null ? '先维护目标成本' : `已发生 ${formatMoney(analysis.actualCost, 0)} / 目标 ${formatMoney(analysis.targetCost, 0)}`}</small>
        </div>
        <div className="project-cockpit-health-row">
          <div><span>回款率</span><strong>{collectionRate == null ? '—' : percentage(collectionRate)}</strong></div>
          <div className="project-cockpit-meter" aria-hidden="true"><span style={{ width: `${collectionPct}%` }} /></div>
          <small>{collectionRate == null ? '尚未建立主合同' : `已回款 ${formatMoney(analysis.billSummary.paidAmount, 0)}`}</small>
        </div>
        <div className="project-cockpit-health-row is-plain">
          <div><span>成本余量</span><strong className={analysis.targetCost - analysis.actualCost < 0 ? 'text-danger' : ''}>{analysis.targetCost > 0 ? formatMoney(analysis.targetCost - analysis.actualCost, 0) : '未建立'}</strong></div>
          <small>{analysis.targetCost <= 0 ? '目标成本尚未维护' : costVariance > 0 ? `超出目标 ${formatMoney(costVariance, 0)}` : '目标成本内'}</small>
        </div>
      </div>
    </section>

    <section className="project-cockpit-main">
      <article className="panel project-cockpit-chart"><div className="panel-heading"><div><h3>月度实际成本</h3><p>最近六个月 · 仅统计已录入且未归档的成本</p></div><span className="chart-mini-label">金额：元</span></div>{hasMonthlyCost ? <ReactECharts key={themeName} option={monthlyOption} style={{ height: 260 }} notMerge lazyUpdate /> : <div className="project-cockpit-chart-empty"><Activity size={18} /><strong>近六个月还没有实际成本记录</strong><span>录入成本后，这里会显示月度发生额。</span></div>}<div className="project-chart-bottom"><span>基准预计利润率</span><strong className={(analysis.forecastProfitMargin ?? 0) >= 0 ? 'text-success' : 'text-danger'}>{percentage(analysis.forecastProfitMargin)}</strong><small>当前按目标成本简化估算，非完整 EAC 预测</small></div></article>
      <article className="panel project-attention-panel"><div className="panel-heading"><div><h3>待跟进业务</h3><p>本项目尚需推进的业务记录</p></div><CircleAlert size={18} className="heading-muted-icon" /></div>
        <button className="project-attention-row" onClick={() => navigate('/cost/progress-bills')}><span className="attention-icon"><CalendarClock size={16} /></span><span><strong>进度款待跟进</strong><small>未到账或仍处于流转中的申报</small></span><b>{pendingBills.length}</b><ArrowRight size={14} /></button>
        <button className="project-attention-row" onClick={() => navigate('/cost/changes')}><span className="attention-icon"><AlertTriangle size={16} /></span><span><strong>变更签证待跟进</strong><small>已提交或审核中的变更</small></span><b>{pendingChanges.length}</b><ArrowRight size={14} /></button>
        <button className="project-attention-row" onClick={() => navigate('/cost/downstream')}><span className="attention-icon"><Banknote size={16} /></span><span><strong>分供合同台账</strong><small>合同 {downstream?.summary.contractCount ?? 0} 份 · 执行中 {downstream?.summary.activeContractCount ?? 0} 份</small></span><ArrowRight size={14} /></button>
        <div className="project-attention-note"><CheckCircle2 size={15} /><span>单项目视图，不与全局经营总览的跨项目指标混用。</span></div>
      </article>
    </section>

    <section className="section-block project-entry-section"><div className="section-heading"><div><h2>项目业务入口</h2><p>从当前项目进入各业务台账，摘要随台账数据更新。</p></div></div><div className="project-entry-grid">{entryCards.map((item) => { const Icon = item.icon; return <button key={item.to} className="project-entry-card" onClick={() => navigate(item.to)}><span className="project-entry-icon"><Icon size={17} /></span><span className="project-entry-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="project-entry-metric"><strong>{item.value}</strong><small>{item.note}</small></span><ArrowRight size={14} className="project-entry-arrow" /></button>; })}</div></section>

    {downstream?.summary && <section className="panel project-cockpit-downstream"><div className="panel-heading"><div><h3>分供合同与付款概览</h3><p>合同额、关联成本和现金支付采用独立口径。</p></div><Button variant="secondary" onClick={() => navigate('/cost/downstream')}>查看台账 <ArrowRight size={14} /></Button></div><div className="project-cockpit-downstream-facts"><div><span>执行中合同额</span><strong>{formatMoney(downstream.summary.activeAndPendingSettlementContractAmount, 0)}</strong></div><div><span>关联实际成本</span><strong>{formatMoney(downstream.summary.linkedActualCost, 0)}</strong></div><div><span>累计净付款</span><strong>{formatMoney(downstream.summary.paidAmount, 0)}</strong></div></div></section>}
  </div>;
}
