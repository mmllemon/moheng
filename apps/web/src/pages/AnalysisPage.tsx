import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Banknote, ChartNoAxesCombined, Coins, TrendingUp, Wallet } from 'lucide-react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import type { Analysis } from '../types';
import { ErrorBlock, formatMoney, formatWan, LoadingBlock, MetricCard, PageHeader, percentage } from '../components/Ui';

const typeLabels: Record<string, string> = { LABOR: '人工费', MATERIAL: '材料费', MACHINE: '机械费', SUBCONTRACT: '分包费', INDIRECT: '其他间接费' };

export default function AnalysisPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!;
  const query = useQuery({ queryKey: ['analysis', projectId], queryFn: () => api.get<Analysis>(`/projects/${projectId}/analysis/three-way`) });
  if (query.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error) return <div className="page-wrap"><ErrorBlock message={(query.error as Error).message} retry={() => void query.refetch()} /></div>;
  const data = query.data!;
  const typeEntries = Object.entries(data.costByType).map(([type, value]) => ({ name: typeLabels[type] ?? type, value }));
  const colorSet = ['#536bd5', '#4baf88', '#e7a14d', '#8c7ae6', '#8290a8'];
  const typeOption = {
    tooltip: { trigger: 'item', formatter: (params: { name: string; value: number; percent: number }) => `${params.name}<br/>${formatMoney(params.value)} (${params.percent}%)` },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: '#7c8799', fontSize: 11 } },
    series: [{ type: 'pie', radius: ['54%', '76%'], center: ['50%', '44%'], avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: true, fontSize: 14, fontWeight: 600, formatter: '{d}%' } }, itemStyle: { borderColor: '#fff', borderWidth: 3 }, data: typeEntries.map((row, i) => ({ ...row, itemStyle: { color: colorSet[i % colorSet.length] } })) }],
  };
  const monthlyOption = {
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => formatMoney(value) }, grid: { left: 48, right: 20, top: 22, bottom: 35 },
    xAxis: { type: 'category', data: data.monthlyActualCost.map((r) => r.month), boundaryGap: false, axisLine: { lineStyle: { color: '#e8edf4' } }, axisTick: { show: false }, axisLabel: { color: '#8a94a4', fontSize: 11 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef1f6', type: 'dashed' } }, axisLabel: { color: '#8a94a4', formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : `${v}` } },
    series: [{ name: '实际成本', type: 'line', smooth: 0.25, data: data.monthlyActualCost.map((r) => r.amount), symbolSize: 6, lineStyle: { width: 3, color: '#536bd5' }, itemStyle: { color: '#536bd5', borderColor: '#fff', borderWidth: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(83,107,213,0.18)' }, { offset: 1, color: 'rgba(83,107,213,0.01)' }] } } }],
  };
  const categoryRows = [...data.byBudget].sort((a, b) => b.actualCost - a.actualCost).slice(0, 8);
  const budgetOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => formatMoney(value) }, legend: { top: 0, right: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: '#7c8799', fontSize: 11 } },
    grid: { left: 38, right: 20, top: 35, bottom: 70 }, xAxis: { type: 'category', data: categoryRows.map((r) => `${r.code}\n${r.name}`), axisLabel: { color: '#808b9c', fontSize: 10, interval: 0, width: 88, overflow: 'truncate' }, axisLine: { lineStyle: { color: '#e8edf4' } }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef1f6', type: 'dashed' } }, axisLabel: { color: '#8a94a4', formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : `${v}` } },
    series: [{ name: '目标成本', type: 'bar', data: categoryRows.map((r) => r.targetCost), barMaxWidth: 18, itemStyle: { color: '#b8c1f2', borderRadius: [3, 3, 0, 0] } }, { name: '实际成本', type: 'bar', data: categoryRows.map((r) => r.actualCost), barMaxWidth: 18, itemStyle: { color: '#536bd5', borderRadius: [3, 3, 0, 0] } }],
  };
  const variance = data.targetCost > 0 ? (data.actualCost - data.targetCost) / data.targetCost : null;

  return <div className="page-wrap">
    <PageHeader eyebrow="ANALYTICS / THREE-WAY COMPARISON" title="成本分析" subtitle={`${data.project.name} · 合同、目标成本与已发生实际成本的当前快照。`} actions={<span className="analysis-live-tag"><Activity size={14} />基于当前台账</span>} />
    <div className="analysis-kpi-grid"><MetricCard label="合同金额" value={formatWan(data.contractAmount)} detail="主合同金额口径" icon={Banknote} tone="blue" /><MetricCard label="目标成本" value={formatWan(data.targetCost)} detail="仅累计末级清单项" icon={Coins} tone="purple" /><MetricCard label="实际已发生成本" value={formatWan(data.actualCost)} detail="已录入且未归档" icon={Wallet} tone="orange" /><MetricCard label="预计完工成本（基准）" value={formatWan(data.forecastCost)} detail={data.forecastBasis === 'TARGET_COST_BASELINE' ? '暂按目标成本估算' : '没有目标成本，暂按实际值兜底'} icon={ChartNoAxesCombined} tone="green" /></div>
    <div className="profit-strip"><div className="profit-main"><span>基准预计利润率</span><strong className={(data.forecastProfitMargin ?? 0) >= 0 ? 'text-success' : 'text-danger'}>{percentage(data.forecastProfitMargin)}</strong><small>预计利润 {formatMoney(data.forecastProfit)}</small></div><div className="profit-item"><span>目标利润</span><strong>{formatMoney(data.targetProfit)}</strong><small>合同额 − 目标成本</small></div><div className="profit-item"><span>目标利润率</span><strong>{percentage(data.targetProfitMargin)}</strong><small>以主合同金额为分母</small></div><div className="profit-item"><span>实际成本 / 目标成本</span><strong className={variance != null && variance > 0.05 ? 'text-danger' : ''}>{percentage(variance)}</strong><small>{variance == null ? '尚无目标成本' : variance > 0 ? '实际成本超出当前目标' : '实际成本尚低于目标'}</small></div></div>
    {data.downstreamContractSummary && <section className="panel downstream-analysis-panel"><div className="panel-heading"><div><h3>分供合同与支出归集</h3><p>合同承诺、已发生成本和现金付款分开列示；不得将三者直接相加。</p></div></div><div className="downstream-analysis-grid"><div><span>执行中/完工待结算合同额</span><strong>{formatMoney(data.downstreamContractSummary.activeAndPendingSettlementContractAmount)}</strong><small>{data.downstreamContractSummary.activeAndPendingSettlementContractCount ?? 0} 份执行中/完工待结算合同</small></div><div><span>已关联实际成本</span><strong>{formatMoney(data.downstreamContractSummary.linkedActualCost)}</strong><small>只统计关联合同且未归档成本记录</small></div><div><span>累计净付款</span><strong>{formatMoney(data.downstreamContractSummary.paidAmount)}</strong><small>付款 {formatMoney(data.downstreamContractSummary.grossPaidAmount ?? data.downstreamContractSummary.paidAmount)} − 退款 {formatMoney(data.downstreamContractSummary.refundedAmount ?? 0)}；现金流不自动计入成本</small></div><div><span>合同额减已关联实际成本（预警差额）</span><strong>{formatMoney(data.downstreamContractSummary.contractValueMinusLinkedActualCost)}</strong><small>仅为合同额与已关联成本的算术差额，不代表未履约承诺或预计成本</small></div></div>{data.downstreamContractSummary.linkedActualCostOverContractValue > 0 && <div className="inline-notice downstream-overrun-notice"><AlertTriangle size={16} /><span>执行中/完工待结算下游合同的关联实际成本已超过对应合同额 {formatMoney(data.downstreamContractSummary.linkedActualCostOverContractValue)}，请核查超合同履约、补充协议或成本关联。</span></div>}</section>}
    <div className="analysis-charts-grid"><section className="panel analysis-chart-panel"><div className="panel-heading"><div><h3>月度实际成本趋势</h3><p>最近六个月 · 按成本发生日期统计</p></div><span className="chart-mini-label">元</span></div><ReactECharts option={monthlyOption} style={{ height: 290 }} notMerge lazyUpdate /></section><section className="panel analysis-chart-panel"><div className="panel-heading"><div><h3>成本构成</h3><p>按已录入成本类型统计</p></div></div><ReactECharts option={typeOption} style={{ height: 290 }} notMerge lazyUpdate /></section></div>
    <section className="panel analysis-chart-panel budget-comparison-panel"><div className="panel-heading"><div><h3>目标成本与实际成本对比</h3><p>按末级清单项展示 · 仅展示实际成本最高的前 8 项</p></div><span className="chart-mini-label">金额：元</span></div>{categoryRows.length ? <ReactECharts option={budgetOption} style={{ height: 330 }} notMerge lazyUpdate /> : <div className="chart-empty"><AlertTriangle size={18} /><span>当前尚无末级清单数据，请先维护目标成本清单。</span></div>}<div className="table-scroll"><table className="data-table analysis-small-table"><thead><tr><th>清单编号</th><th>名称</th><th className="align-right">目标成本</th><th className="align-right">实际成本</th><th className="align-right">偏差金额</th><th className="align-right">偏差率</th></tr></thead><tbody>{categoryRows.map((row) => { const amount = row.actualCost - row.targetCost; const ratio = row.targetCost > 0 ? amount / row.targetCost : null; return <tr key={row.id}><td><span className="budget-code">{row.code}</span></td><td>{row.name}</td><td className="align-right numeric">{formatMoney(row.targetCost)}</td><td className="align-right numeric">{formatMoney(row.actualCost)}</td><td className={`align-right numeric ${amount > 0 ? 'text-danger' : 'text-success'}`}>{amount > 0 ? '+' : ''}{formatMoney(amount)}</td><td className={`align-right numeric ${ratio != null && ratio > 0 ? 'text-danger' : 'text-success'}`}>{percentage(ratio)}</td></tr>; })}</tbody></table></div></section>
    <div className="data-note"><span className="note-mark">i</span><span>本版“预计完工成本”是基准快照：有目标成本时暂以目标成本作为基准，没有目标成本时退化为实际已发生成本，不是完整的完工成本预测模型。下游合同承诺与付款台账已独立列示，但承诺余额目前是“执行中合同额减去已关联实际成本”的估算口径；它不能替代已验收履约量、未开票应计成本和专业完工预测。未签约剩余工作、风险准备和历史月末快照仍需进一步完善。</span></div>
  </div>;
}
