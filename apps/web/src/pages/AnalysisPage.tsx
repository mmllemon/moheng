import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import type { Analysis, Project, ProjectCashflow } from '../types';
import { Button, ErrorBlock, formatMoney, LoadingBlock, Metrics, PageHeader, percentage, StatusBadge } from '../components/Ui';
import { eacCaption } from '../lib/eac-caption';

const typeLabels: Record<string, string> = { LABOR: '人工费', MATERIAL: '材料费', MACHINE: '机械费', SUBCONTRACT: '分包费', INDIRECT: '其他间接费' };
const typeColors: Record<string, string> = { MATERIAL: '#2c5a51', LABOR: '#8b6a3e', MACHINE: '#6f7f6a', SUBCONTRACT: '#b08a52', INDIRECT: '#9aa39a' };

function signed(value: number) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatMoney(Math.abs(value), 0)}`;
}
function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function downloadCsv(rows: Array<Array<string | number>>, filename: string) {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AnalysisPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!;
  const query = useQuery({ queryKey: ['analysis', projectId], queryFn: () => api.get<Analysis>(`/projects/${projectId}/analysis/three-way`) });
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  if (query.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error) return <div className="page-wrap"><ErrorBlock error={query.error} retry={() => void query.refetch()} /></div>;
  const data = query.data!;
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const asOf = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })();
  const remaining = data.targetCost - data.actualCost;
  const costRatio = data.targetCost > 0 ? data.actualCost / data.targetCost : null;
  const eac = data.eac;

  const topRows = [...data.byBudget].sort((a, b) => b.actualCost - a.actualCost || b.targetCost - a.targetCost).slice(0, 3);
  const scaleMax = Math.max(100000, Math.ceil(Math.max(1, ...topRows.flatMap((row) => [row.targetCost, row.actualCost])) / 100000) * 100000);
  const ticks = Array.from({ length: 8 }, (_, index) => Math.round((scaleMax / 7) * index));

  const costEntries = Object.entries(data.costByType)
    .map(([type, value]) => ({ type, label: typeLabels[type] ?? type, value, color: typeColors[type] ?? '#9aa39a' }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  const costTotal = costEntries.reduce((sum, entry) => sum + entry.value, 0);

  const monthly = data.monthlyActualCost.slice(-6);
  const monthMax = Math.max(2, Math.ceil(Math.max(1, ...monthly.map((row) => row.amount)) / 10000));
  // 刻度取整到 1/2/2.5/5 × 10ⁿ，避免出现 178、356 这类不好读的数。
  const monthRawStep = monthMax / 5;
  const monthMagnitude = 10 ** Math.floor(Math.log10(Math.max(1, monthRawStep)));
  const monthNormalized = monthRawStep / monthMagnitude;
  const monthStep = (monthNormalized <= 1 ? 1 : monthNormalized <= 2 ? 2 : monthNormalized <= 2.5 ? 2.5 : monthNormalized <= 5 ? 5 : 10) * monthMagnitude;
  const monthTop = Math.ceil(monthMax / monthStep) * monthStep;
  const monthTicks = Array.from({ length: Math.round(monthTop / monthStep) + 1 }, (_, index) => monthTop - index * monthStep);

  const exportAnalysis = () => {
    const rows: Array<Array<string | number>> = [
      ['成本分析', data.project.name, data.project.code],
      ['数据时间', asOf],
      ['合同金额', data.contractAmount],
      ['目标成本', data.targetCost],
      ['实际已发生成本', data.actualCost],
      ['成本余量', remaining],
      ['成本执行率', costRatio == null ? '—' : percentage(costRatio)],
      ['完工估算（EAC）', eac.method === 'CERTIFIED_REVENUE_RATIO' ? '按业主核定产值折算成本效率' : eacCaption(eac)],
      ['业主核定产值', data.billSummary.certifiedAmount],
      ['产值完成比', eac.completionRatio == null ? '—' : percentage(eac.completionRatio)],
      ['EAC 乐观', eac.valuation?.low ?? '—'],
      ['EAC 中性', eac.valuation?.likely ?? '—'],
      ['EAC 悲观', eac.valuation?.high ?? '—'],
      ['目标利润率', data.targetProfitMargin == null ? '—' : percentage(data.targetProfitMargin)],
      ['预计利润率', eac.margin == null ? '—' : percentage(eac.margin.likely)],
      [],
      ['清单编号', '清单名称', '目标成本', '实际成本', '偏差'],
      ...data.byBudget.map((row) => [row.code, row.name, row.targetCost, row.actualCost, row.actualCost - row.targetCost]),
    ];
    downloadCsv(rows, `成本分析-${data.project.code}.csv`);
  };

  return <div className="page-wrap analysis-page">
    <PageHeader
      title="成本分析"
      context={<><span className="page-context-dot" /><span>{data.project.name}</span><span>· {data.project.code}</span>{project && <><span>·</span><StatusBadge status={project.status} /></>}<span>· 项目级视图</span><span>· 数据截至 {asOf}</span></>}
      actions={<Button variant="secondary" onClick={exportAnalysis}><Download size={15} />导出分析</Button>}
    />

    <Metrics items={[
      { label: '合同额', value: formatMoney(data.contractAmount, 0), detail: '有效合同 · 含已生效变更' },
      { label: '目标成本', value: formatMoney(data.targetCost, 0), detail: `末级清单 ${data.byBudget.length} 条` },
      { label: '已发生成本', value: formatMoney(data.actualCost, 0), detail: `占目标 ${costRatio == null ? '—' : percentage(costRatio)}` },
      { label: '成本余量', value: formatMoney(remaining, 0), detail: '目标 − 已发生', tone: remaining < 0 ? 'danger' : 'default' },
    ]} />

    <div className="an-grid">
      <section className="an-panel" aria-label="清单偏差">
        <div className="an-panel-head"><div><h2>清单偏差</h2><p>目标成本为细框，实际为实条；按实际发生额取前 {topRows.length} 项</p></div><span className="an-legend"><i className="is-target" />目标<i className="is-actual" />已发生</span></div>
        {topRows.length ? <div className="an-variance-list">
          {topRows.map((row) => {
            const variance = row.actualCost - row.targetCost;
            return <div className="an-variance-row" key={row.id}>
              <div className="an-variance-head">
                <div className="an-variance-name"><strong>{row.name}</strong><span>{row.code}</span></div>
                <div className="an-variance-nums"><strong>{formatMoney(row.targetCost, 0)}</strong><span>已发生 {formatMoney(row.actualCost, 0)}</span><b className={variance > 0 ? 'text-danger' : ''}>偏差 {signed(variance)}</b></div>
              </div>
              <div className="an-variance-track">
                <span className="an-variance-target" style={{ width: `${Math.min(100, (row.targetCost / scaleMax) * 100)}%` }} />
                <span className="an-variance-actual" style={{ width: `${Math.min(100, (row.actualCost / scaleMax) * 100)}%` }} />
              </div>
            </div>;
          })}
        </div> : <div className="an-empty">还没有末级清单数据。</div>}
        <div className="an-scale"><span>0</span>{ticks.slice(1).map((tick) => <span key={tick}>{tick >= 10000 ? `${(tick / 10000).toFixed(0)}万` : tick}</span>)}</div>
      </section>

      <section className="an-panel" aria-label="成本构成">
        <div className="an-panel-head"><div><h2>成本构成</h2><p>按已录入成本类型统计</p></div><span className="an-mini">按费用类型</span></div>
        {costTotal > 0 ? <>
          <div className="an-comp-bar">{costEntries.map((entry) => <span key={entry.type} style={{ width: `${(entry.value / costTotal) * 100}%`, background: entry.color }} title={`${entry.label} ${formatMoney(entry.value, 0)}`} />)}</div>
          <div className="an-comp-list">{costEntries.map((entry) => <div key={entry.type}><i style={{ background: entry.color }} /><span>{entry.label}</span><strong>{formatMoney(entry.value, 0)}</strong><small>{((entry.value / costTotal) * 100).toFixed(1)}%</small></div>)}</div>
          <div className="an-comp-total"><span>已发生合计</span><strong>{formatMoney(costTotal, 0)}</strong></div>
        </> : <div className="an-empty">还没有已录入成本。</div>}
        <div className="an-comp-foot">颜色只区分费用类型，不表达风险高低。</div>
      </section>

      <section className="an-panel" aria-label="月度成本">
        <div className="an-panel-head"><div><h2>月度成本</h2><p>最近六个月 · 按成本发生日期统计</p></div><span className="an-mini">万元</span></div>
        {monthly.length ? <div className="an-month-chart">
          <div className="an-month-axis">{monthTicks.map((tick) => <span key={tick}>{tick}</span>)}</div>
          <div className="an-month-plot">{monthly.map((row) => <div className="an-month-col" key={row.month}><span className="an-month-value">{row.amount > 0 ? (row.amount / 10000).toFixed(1) : ''}</span><span className="an-month-bar" style={{ height: `${row.amount > 0 ? Math.max(2, (row.amount / (monthTop * 10000)) * 100) : 1}%` }} /><small>{row.month.slice(5)}</small></div>)}</div>
        </div> : <div className="an-empty">最近六个月没有成本发生。</div>}
      </section>

      <section className="an-panel" aria-label="完工估算与口径">
        <div className="an-panel-head"><div><h2>完工估算</h2><p>EAC · 已发生成本按核定产值折算</p></div><span className="an-mini">{eac.method === 'CERTIFIED_REVENUE_RATIO' ? '产值折算' : '待建立'}</span></div>
        {eac.status === 'READY' && eac.valuation && eac.margin ? <>
          <div className="an-eac-range">
            <div><span>剩余按目标成本</span><strong>{formatMoney(eac.budgetEfficiencyCost ?? 0, 0)}</strong><small>剩余工作回到预算效率</small></div>
            <div><span>剩余按当前效率</span><strong>{formatMoney(eac.valuation.likely, 0)}</strong><small>已发生成本 ÷ 完成比</small></div>
          </div>
          <div className="an-eac-facts">
            <div><span>产值完成比</span><strong>{percentage(eac.completionRatio)}</strong></div>
            <div><span>预计利润率</span><strong className={eac.margin.likely >= 0 ? 'text-success' : 'text-danger'}>{percentage(eac.margin.likely)}</strong></div>
            <div><span>目标利润率</span><strong>{percentage(data.targetProfitMargin)}</strong></div>
            <div><span>未确认变更敞口</span><strong>{formatMoney(eac.pendingChangeExposure, 0)}</strong></div>
          </div>
          <p className="an-basis-note">完工成本区间 {formatMoney(eac.valuation.low, 0)} – {formatMoney(eac.valuation.high, 0)}；区间跨度就是成本效率与预算的差距，上限已含未确认变更敞口。</p>
          {eac.caution && <p className="an-basis-note">产值完成比仍低，产值月报滞后会把估算抬高，请同时参考区间上限。</p>}
        </> : <div className="an-empty">{eacCaption(eac)}</div>}
        <dl className="an-defs">
          <div><dt>完工预算基准</dt><dd>{eac.status === 'NO_BASELINE' ? '尚未建立目标成本基线' : '目标成本末级清单合计，调整需走变更'}</dd></div>
          <div><dt>产值口径</dt><dd>只计已审批或已付款的进度款核定金额</dd></div>
          <div><dt>实际成本口径</dt><dd>按发生日期计入，含税金额，不含已归档记录</dd></div>
          <div><dt>合同额口径</dt><dd>有效合同额，含已生效变更</dd></div>
          <div><dt>数据时间</dt><dd>{asOf}</dd></div>
        </dl>
        {data.downstreamContractSummary && <p className="an-basis-note">分供合同：执行中/待结算 {formatMoney(data.downstreamContractSummary.activeAndPendingSettlementContractAmount, 0)}，已关联实际成本 {formatMoney(data.downstreamContractSummary.linkedActualCost, 0)}，累计净付款 {formatMoney(data.downstreamContractSummary.paidAmount, 0)}；承诺、成本、付款不直接相加。</p>}
      </section>
      <CashflowPanel projectId={projectId} />
    </div>
  </div>;
}

function CashflowPanel({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: ['cashflow', projectId], queryFn: () => api.get<ProjectCashflow>(`/projects/${projectId}/analysis/cashflow`) });
  if (query.isLoading) return <div className="an-panel is-full"><div className="an-panel-head"><div><h2>资金计划</h2><p>按到期日统计未来现金进出</p></div></div><LoadingBlock /></div>;
  if (query.error) return <div className="an-panel is-full"><div className="an-panel-head"><div><h2>资金计划</h2></div></div><ErrorBlock error={query.error} retry={() => void query.refetch()} /></div>;
  const plan = query.data!;
  const peak = Math.max(1, ...plan.buckets.flatMap((bucket) => [bucket.inflow, bucket.outflow]));
  const hasCurve = plan.buckets.some((bucket) => bucket.inflow > 0 || bucket.outflow > 0);
  const uncoveredTotal = plan.uncovered.unplannedContractAmount;
  const wan = (value: number) => (value / 10000).toFixed(1);

  return <section className="an-panel is-full" aria-label="资金计划">
    <div className="an-panel-head">
      <div><h2>资金计划</h2><p>未来 {plan.months} 个月 · 只算已经确定到期日的金额</p></div>
      <span className="an-legend"><i className="is-inflow" />应收<i className="is-outflow" />应付</span>
    </div>
    <div className="cf-summary">
      <div><span>未来 {plan.months} 个月应收</span><strong>{formatMoney(plan.window.inflow, 0)}</strong><small>已到期与未到期的应收单，按分期到期日</small></div>
      <div><span>未来 {plan.months} 个月应付</span><strong>{formatMoney(plan.window.outflow, 0)}</strong><small>已过账应付，按分期到期日；无分期时用应付到期日</small></div>
      <div><span>净额</span><strong className={plan.window.net < 0 ? 'text-danger' : plan.window.net > 0 ? 'text-success' : undefined}>{signed(plan.window.net)}</strong><small>负数表示这个区间要垫钱</small></div>
    </div>
    {hasCurve ? <div className="cf-chart">
      {plan.buckets.map((bucket) => <div className="cf-month" key={bucket.key}>
        <div className="cf-bars">
          <span className="cf-bar is-inflow" title={`${bucket.label} 应收 ${formatMoney(bucket.inflow, 0)}`} style={{ height: bucket.inflow > 0 ? `${Math.max(3, (bucket.inflow / peak) * 100)}%` : 0 }} />
          <span className="cf-bar is-outflow" title={`${bucket.label} 应付 ${formatMoney(bucket.outflow, 0)}`} style={{ height: bucket.outflow > 0 ? `${Math.max(3, (bucket.outflow / peak) * 100)}%` : 0 }} />
        </div>
        <div className="cf-values">{bucket.inflow > 0 || bucket.outflow > 0 ? <span>{wan(bucket.inflow)} / {wan(bucket.outflow)}</span> : <span className="is-blank">—</span>}</div>
        <small>{bucket.label}</small>
        <em className={bucket.net < 0 ? 'text-danger' : bucket.net > 0 ? 'text-success' : ''}>{bucket.net === 0 ? '持平' : `${bucket.net > 0 ? '+' : '−'}${wan(Math.abs(bucket.net))}万`}</em>
      </div>)}
    </div> : <div className="an-empty">未来 {plan.months} 个月没有带到期日的应收应付；先给应收单补录到期安排，或给分供合同维护付款计划。</div>}
    {(plan.overdue.inflow > 0 || plan.overdue.outflow > 0) && <p className="an-basis-note">
      已经逾期：应收 {formatMoney(plan.overdue.inflow, 0)}，应付 {formatMoney(plan.overdue.outflow, 0)}。逾期金额不计入上面任何一个月，因为它早就该发生了。
    </p>}
    <dl className="an-defs">
      <div><dt>收入口径</dt><dd>应收单净额减已核销；有分期按分期到期日拆开，未指定期次的到账按比例摊回各期</dd></div>
      <div><dt>支出口径</dt><dd>已过账应付净额减付款核销；付款计划只用于尚未结算出应付的合同，避免同一笔支出算两次</dd></div>
      <div><dt>不进曲线的金额</dt><dd>没有到期日的应收 {formatMoney(plan.unscheduled.inflow, 0)}，没有到期日的应付 {formatMoney(plan.unscheduled.outflow, 0)}；窗口之外另有应收 {formatMoney(plan.beyondWindow.inflow, 0)}、应付 {formatMoney(plan.beyondWindow.outflow, 0)}</dd></div>
      {uncoveredTotal > 0 && <div><dt>尚未纳入计划</dt><dd>{plan.uncovered.unplannedContractCount} 份分供合同既无应付也无付款计划，剩余合同额 {formatMoney(uncoveredTotal, 0)}，这部分支出还没排进任何月份</dd></div>}
    </dl>
    {plan.uncovered.receivableWithoutDueDate > 0 && <p className="an-basis-note">有 {plan.uncovered.receivableWithoutDueDate} 张应收单没有到期日（多数是进度款应收），它们的金额只能统计在“没有到期日”里，不会被安排到某个月。给应收单补录到期安排后就会进入曲线。</p>}
  </section>;
}
