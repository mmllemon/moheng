import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Banknote, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, FileSignature, HandCoins, ReceiptText, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectSummaryReportButton } from '../components/ReportLaunchButton';
import { Button, ErrorBlock, formatDate, formatMoney, formatWan, LoadingBlock, MetricCard, PageHeader, StatusBadge, percentage } from '../components/Ui';
import type { Analysis, ChangeRecord, ProgressBill, Project } from '../types';

type ProjectDetail = Project & { mainContract?: { id: string; contractNo: string; name: string; amount: number; signedAt?: string | null } | null };
type DownstreamResponse = { items: { id: string; status: string; currentAmount: number }[]; summary: { contractCount: number; activeContractCount: number; activeAndPendingSettlementContractAmount: number; paidAmount: number; linkedActualCost: number } };

const shortcuts = [
  { to: '/cost/contracts', title: '业主主合同', description: '原始合同基准、付款条款与有效合同额', icon: FileSignature },
  { to: '/cost/budget', title: '预算与目标成本', description: '维护项目成本控制基准与清单', icon: ClipboardList },
  { to: '/cost/progress-bills', title: '进度款管理', description: '申报、审批与业主回款', icon: HandCoins },
  { to: '/cost/changes', title: '变更签证', description: '内部审批、外部确认与生效金额', icon: Activity },
  { to: '/cost/downstream-contracts', title: '分供合同与付款', description: '分包、采购、租赁合同与现金流', icon: Banknote },
  { to: '/cost/costs', title: '实际成本', description: '录入成本并关联合同来源', icon: ReceiptText },
];

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId);
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
  const monthlyOption = {
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => formatMoney(value) },
    // Reserve room for long currency tick labels; containLabel prevents clipping at the panel edge.
    grid: { left: 68, right: 18, top: 22, bottom: 34, containLabel: true },
    xAxis: { type: 'category', data: analysis.monthlyActualCost.map((row) => row.month), axisLine: { lineStyle: { color: '#e7ebf2' } }, axisTick: { show: false }, axisLabel: { color: '#8792a4', fontSize: 11 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf0f5', type: 'dashed' } }, axisLabel: { color: '#8792a4', margin: 10, hideOverlap: true, formatter: (v: number) => v >= 100000000 ? `${(v / 100000000).toFixed(1)}亿` : v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万` : v.toLocaleString('zh-CN') } },
    series: [{ name: '实际发生成本', type: 'bar', data: analysis.monthlyActualCost.map((row) => row.amount), barMaxWidth: 26, itemStyle: { color: '#536bd5', borderRadius: [4, 4, 0, 0] } }],
  };

  return <div className="page-wrap project-overview-page">
    <PageHeader eyebrow="PROJECT WORKSPACE / PROJECT BRIEF" title="项目驾驶舱" subtitle="围绕当前项目查看收入合同、目标成本、已发生成本、回款与分供合同概况。" actions={<><ProjectSummaryReportButton /><Button variant="secondary" onClick={() => navigate('/cost/analysis')}><Activity size={15} />查看成本分析</Button></>} />
    <section className="project-identity-panel panel">
      <div className="project-identity-main"><div className="project-identity-mark">{project.name.slice(0, 1)}</div><div><div className="project-identity-meta"><span>{project.code}</span><StatusBadge status={project.status} /></div><h2>{project.name}</h2><p>{project.ownerPartyId ? <Link to={`/parties/${project.ownerPartyId}`}>{project.ownerName} ↗</Link> : project.ownerName} · 项目经理：{project.managerName || '未填写'}</p></div></div>
      <div className="project-identity-facts"><div><span>开工日期</span><strong>{formatDate(project.startDate)}</strong></div><div><span>计划竣工</span><strong>{formatDate(project.plannedEndDate)}</strong></div><div><span>地址</span><strong>{project.address || '未填写'}</strong></div></div>
    </section>

    <section className="metric-grid project-metric-grid">
      <MetricCard label="当前有效合同额" value={formatWan(analysis.contractAmount)} detail={project.mainContract ? `主合同 ${project.mainContract.contractNo}` : '尚未建立主合同'} icon={Banknote} tone="blue" />
      <MetricCard label="目标成本" value={formatWan(analysis.targetCost)} detail="末级目标成本清单合计" icon={ClipboardList} tone="purple" />
      <MetricCard label="实际发生成本" value={formatWan(analysis.actualCost)} detail={analysis.targetCost <= 0 ? '尚未建立目标成本' : costVariance > 0 ? `超目标 ${formatMoney(costVariance, 0)}` : `较目标 ${formatMoney(Math.abs(costVariance), 0)} ${costVariance < 0 ? '节余' : '差异为零'}`} icon={Wallet} tone={analysis.targetCost <= 0 ? 'blue' : costVariance > 0 ? 'orange' : 'green'} />
      <MetricCard label="累计已收款" value={formatWan(analysis.billSummary.paidAmount)} detail={`申报 ${formatMoney(analysis.billSummary.totalSubmitted, 0)}`} icon={HandCoins} tone="green" />
    </section>

    <section className="project-brief-grid">
      <article className="panel project-cost-trend-panel"><div className="panel-heading"><div><h3>月度实际成本</h3><p>最近六个月 · 仅统计已录入且未归档的成本</p></div><span className="chart-mini-label">金额：元</span></div><ReactECharts option={monthlyOption} style={{ height: 270 }} notMerge lazyUpdate /><div className="project-chart-bottom"><span>基准预计利润率</span><strong className={(analysis.forecastProfitMargin ?? 0) >= 0 ? 'text-success' : 'text-danger'}>{percentage(analysis.forecastProfitMargin)}</strong><small>当前按目标成本简化估算，非完整 EAC 预测</small></div></article>
      <article className="panel project-attention-panel"><div className="panel-heading"><div><h3>待跟进业务</h3><p>本项目尚需推进的业务记录</p></div><CircleAlert size={18} className="heading-muted-icon" /></div>
        <button className="project-attention-row" onClick={() => navigate('/cost/progress-bills')}><span className="attention-icon"><CalendarClock size={16} /></span><span><strong>进度款待跟进</strong><small>未到账或仍处于流转中的申报</small></span><b>{pendingBills.length}</b><ArrowRight size={14} /></button>
        <button className="project-attention-row" onClick={() => navigate('/cost/changes')}><span className="attention-icon"><AlertTriangle size={16} /></span><span><strong>变更签证待跟进</strong><small>已提交或审核中的变更</small></span><b>{pendingChanges.length}</b><ArrowRight size={14} /></button>
        <button className="project-attention-row" onClick={() => navigate('/cost/downstream-contracts')}><span className="attention-icon"><Banknote size={16} /></span><span><strong>分供合同台账</strong><small>合同 {downstream?.summary.contractCount ?? 0} 份 · 执行中 {downstream?.summary.activeContractCount ?? 0} 份</small></span><ArrowRight size={14} /></button>
        <div className="project-attention-note"><CheckCircle2 size={15} /><span>本页为单项目视图，不与全局经营总览的跨项目指标混用。</span></div>
      </article>
    </section>

    <section className="section-block project-shortcut-section"><div className="section-heading"><div><h2>项目业务入口</h2><p>各模块保留独立页面与专属操作，在成本工作台内统一切换。</p></div></div><div className="project-shortcut-grid">{shortcuts.map((item) => { const Icon = item.icon; return <button key={item.to} className="project-shortcut-card" onClick={() => navigate(item.to)}><span className="project-shortcut-icon"><Icon size={18} /></span><span className="project-shortcut-copy"><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={15} className="project-shortcut-arrow" /></button>; })}</div></section>

    {downstream?.summary && <section className="panel project-downstream-summary"><div className="panel-heading"><div><h3>分供合同与付款概览</h3><p>合同额、实际成本和现金支付采用独立口径。</p></div><Button variant="secondary" onClick={() => navigate('/cost/downstream-contracts')}>查看台账 <ArrowRight size={14} /></Button></div><div className="project-downstream-facts"><div><span>执行中合同额</span><strong>{formatMoney(downstream.summary.activeAndPendingSettlementContractAmount, 0)}</strong></div><div><span>关联实际成本</span><strong>{formatMoney(downstream.summary.linkedActualCost, 0)}</strong></div><div><span>累计净付款</span><strong>{formatMoney(downstream.summary.paidAmount, 0)}</strong></div></div></section>}
  </div>;
}
