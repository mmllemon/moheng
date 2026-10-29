import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import type { Analysis, Project } from '../types';
import { Button, ErrorBlock, formatMoney, LoadingBlock, Metrics, PageHeader, percentage, StatusBadge } from '../components/Ui';

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
  if (query.error) return <div className="page-wrap"><ErrorBlock message={(query.error as Error).message} retry={() => void query.refetch()} /></div>;
  const data = query.data!;
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const asOf = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })();
  const remaining = data.targetCost - data.actualCost;
  const costRatio = data.targetCost > 0 ? data.actualCost / data.targetCost : null;

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
  const monthTicks = Array.from({ length: Math.floor(monthMax / 2) + 1 }, (_, index) => monthMax - index * 2);

  const exportAnalysis = () => {
    const rows: Array<Array<string | number>> = [
      ['成本分析', data.project.name, data.project.code],
      ['数据时间', asOf],
      ['合同金额', data.contractAmount],
      ['目标成本', data.targetCost],
      ['实际已发生成本', data.actualCost],
      ['成本余量', remaining],
      ['成本执行率', costRatio == null ? '—' : percentage(costRatio)],
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
              <div className="an-variance-name"><strong>{row.name}</strong><span>{row.code}</span></div>
              <div className="an-variance-track">
                <span className="an-variance-target" style={{ width: `${Math.min(100, (row.targetCost / scaleMax) * 100)}%` }} />
                <span className="an-variance-actual" style={{ width: `${Math.min(100, (row.actualCost / scaleMax) * 100)}%` }} />
              </div>
              <div className="an-variance-nums"><strong>{formatMoney(row.targetCost, 0)}</strong><span>已发生 {formatMoney(row.actualCost, 0)}</span><b className={variance > 0 ? 'text-danger' : ''}>偏差 {signed(variance)}</b></div>
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
          <div className="an-month-plot">{monthly.map((row) => <div className="an-month-col" key={row.month}><span className="an-month-value">{row.amount > 0 ? (row.amount / 10000).toFixed(1) : '0'}</span><span className="an-month-bar" style={{ height: `${row.amount > 0 ? Math.max(2, (row.amount / (monthMax * 10000)) * 100) : 1}%` }} /><small>{row.month.slice(5)}</small></div>)}</div>
        </div> : <div className="an-empty">最近六个月没有成本发生。</div>}
      </section>

      <section className="an-panel" aria-label="口径与基准">
        <div className="an-panel-head"><div><h2>口径与基准</h2><p>只读 · 数据以当前台账为准</p></div></div>
        <dl className="an-defs">
          <div><dt>目标成本基准</dt><dd>{data.forecastBasis === 'TARGET_COST_BASELINE' ? '按目标成本锁定；调整需走变更' : '尚未建立目标成本基线'}</dd></div>
          <div><dt>实际成本口径</dt><dd>按发生日期计入，不含已归档记录</dd></div>
          <div><dt>合同额口径</dt><dd>有效合同额，含已生效变更</dd></div>
          <div><dt>数据时间</dt><dd>{asOf}</dd></div>
        </dl>
        {data.downstreamContractSummary && <p className="an-basis-note">分供合同：执行中/待结算 {formatMoney(data.downstreamContractSummary.activeAndPendingSettlementContractAmount, 0)}，已关联实际成本 {formatMoney(data.downstreamContractSummary.linkedActualCost, 0)}，累计净付款 {formatMoney(data.downstreamContractSummary.paidAmount, 0)}；承诺、成本、付款不直接相加。</p>}
      </section>
    </div>
  </div>;
}
