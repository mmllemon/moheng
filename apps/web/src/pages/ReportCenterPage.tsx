import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, CalendarRange, CheckCircle2, FileSpreadsheet, Filter, FolderKanban, Info, RefreshCw, ShieldCheck, Settings2 } from 'lucide-react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import type { Project } from '../types';
import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';

type Report = { key: string; label: string; description: string; dateField: string; rowLimit: number };
const catalogFallback: Report[] = [
  { key: 'target-cost', label: '目标成本清单', description: '项目清单编号、父级、工程量、单价、目标合价与最近更新时间。', dateField: '更新时间', rowLimit: 10000 },
  { key: 'actual-cost', label: '实际成本台账', description: '成本发生日期、分类、金额、业务对象、合同及清单关联。', dateField: '成本日期', rowLimit: 10000 },
  { key: 'progress-bills', label: '业主进度款申报', description: '申报、核定、到账汇总与主合同关联。', dateField: '申报日期', rowLimit: 10000 },
  { key: 'changes', label: '变更签证台账', description: '送审金额、内部审批、外部确认状态与实际生效金额。', dateField: '发生日期', rowLimit: 10000 },
  { key: 'owner-receivables', label: '业主应收台账', description: '毛额、扣款、净应收、到期日与当前状态。', dateField: '入账日期', rowLimit: 10000 },
  { key: 'owner-receipts', label: '业主到账与退款流水', description: '到账和退款独立记录，保留类型与原始流水关联。', dateField: '到账日期', rowLimit: 10000 },
  { key: 'downstream-contracts', label: '分供合同台账', description: '原始合同额、有效调整汇总、状态与往来单位。', dateField: '创建日期', rowLimit: 10000 },
  { key: 'downstream-payables', label: '分供应付台账', description: '已过账应付、扣款、净应付、到期日与关联合同。', dateField: '入账日期', rowLimit: 10000 },
];

export default function ReportCenterPage() {
  const navigate = useNavigate();
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const [projectId, setProjectId] = useState(selectedProjectId ?? '');
  const [reportKey, setReportKey] = useState('target-cost');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const catalogQuery = useQuery({ queryKey: ['reports-catalog'], queryFn: () => api.get<Report[]>('/reports/catalog') });
  const catalog = catalogQuery.data ?? catalogFallback;
  const selected = useMemo(() => catalog.find((item) => item.key === reportKey) ?? catalogFallback[0], [catalog, reportKey]);

  async function downloadReport(format: 'csv' | 'xlsx') {
    setBusy(true); setNotice(''); setError('');
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const blob = await api.download(`/reports/${reportKey}.${format}?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const projectLabel = projectId ? projectsQuery.data?.find((p) => p.id === projectId)?.code ?? '项目' : '全公司';
      anchor.download = `墨衡-${projectLabel}-${selected.label}${from || to ? `-${from || '起始不限'}-${to || '结束不限'}` : ''}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      setNotice(`“${selected.label}”导出已开始。单次最多导出 ${selected.rowLimit.toLocaleString('zh-CN')} 条；超出时请缩小日期范围分批导出。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '报表导出失败，请稍后重试。'); }
    finally { setBusy(false); }
  }

  return <div className="page-wrap report-center-page">
    <PageHeader eyebrow="REPORTS / DATA EXCHANGE" title="报表中心" subtitle="按权限范围导出可复核的业务台账。导出只读，不会修改合同、成本、结算或资金数据。" actions={<Button variant="secondary" onClick={() => { void projectsQuery.refetch(); void catalogQuery.refetch(); }} disabled={projectsQuery.isFetching || catalogQuery.isFetching}><RefreshCw size={14} />刷新</Button>} />
    {projectsQuery.isLoading || catalogQuery.isLoading ? <LoadingBlock label="正在加载可用报表…" /> : projectsQuery.error || catalogQuery.error ? <ErrorBlock message={String(projectsQuery.error ?? catalogQuery.error ?? '报表信息加载失败')} retry={() => { void projectsQuery.refetch(); void catalogQuery.refetch(); }} /> : <>
      <section className="report-intro-grid">
        <article className="panel report-intro-card"><span><FileSpreadsheet size={18} /></span><div><strong>{catalog.length} 类标准台账</strong><small>统一导出表头与日期/金额口径</small></div></article>
        <article className="panel report-intro-card"><span><ShieldCheck size={18} /></span><div><strong>服务端权限过滤</strong><small>导出范围与当前账号项目访问权限一致</small></div></article>
        <article className="panel report-intro-card"><span><CheckCircle2 size={18} /></span><div><strong>只读数据快照</strong><small>CSV 使用 UTF-8 BOM 与公式注入防护</small></div></article>
      </section>
      <section className="panel report-export-panel">
        <div className="report-section-heading"><div><h2><ArrowDownToLine size={18} />导出业务台账</h2><p>CSV 适合轻量数据交换；原生 XLSX 包含真实单元格类型、筛选、冻结窗格及导出说明。</p></div><div className="report-format-actions"><span className="report-format-pill">CSV + XLSX</span><Button variant="secondary" onClick={() => { const params = new URLSearchParams({ reportKey, projectId, from, to }); navigate(`/reports/designer?${params.toString()}`); }}><Settings2 size={14} />设计报表模板</Button></div></div>
        <div className="report-export-form">
          <label className="report-field"><span>报表类型</span><SelectField value={reportKey} onChange={(event) => setReportKey(event.target.value)} aria-label="报表类型">{catalog.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</SelectField></label>
          <label className="report-field"><span>项目范围</span><SelectField value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="导出项目范围"><option value="">全部可访问项目</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</SelectField></label>
          <label className="report-field"><span>开始日期（可选）</span><DatePicker value={from} onChange={(event) => setFrom(event.target.value)} aria-label="开始日期" placeholder="不限制开始日期" max={to || undefined} /></label>
          <label className="report-field"><span>结束日期（可选）</span><DatePicker value={to} onChange={(event) => setTo(event.target.value)} aria-label="结束日期" placeholder="不限制结束日期" min={from || undefined} /></label>
        </div>
        <div className="report-description-box"><span className="report-description-icon"><Info size={17} /></span><div><strong>{selected.label}</strong><p>{selected.description}</p><small>日期筛选字段：{selected.dateField}。单次最多导出 {selected.rowLimit.toLocaleString('zh-CN')} 条记录；超出上限时只导出当前排序靠前的记录。</small></div></div>
        {notice && <div className="success-notice"><CheckCircle2 size={16} />{notice}</div>}{error && <div className="form-alert">{error}</div>}
        <div className="report-form-footer"><span><FolderKanban size={14} />{projectId ? `当前项目：${projectsQuery.data?.find((p) => p.id === projectId)?.name ?? '所选项目'}` : '当前范围：全部有权限项目'}</span><div><Button variant="secondary" onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>清除日期</Button><Button variant="secondary" onClick={() => void downloadReport('csv')} disabled={busy || !catalog.some((item) => item.key === reportKey) || Boolean(from && to && from > to)}><ArrowDownToLine size={15} />{busy ? '正在生成…' : '导出 CSV'}</Button><Button onClick={() => void downloadReport('xlsx')} disabled={busy || !catalog.some((item) => item.key === reportKey) || Boolean(from && to && from > to)}><FileSpreadsheet size={15} />{busy ? '正在生成…' : '导出 XLSX'}</Button></div></div>
      </section>
      <section className="report-catalog-grid">{catalog.map((report) => <button type="button" className={`panel report-catalog-card ${report.key === reportKey ? 'is-selected' : ''}`} key={report.key} onClick={() => setReportKey(report.key)} aria-pressed={report.key === reportKey}><span className="report-catalog-icon"><FileSpreadsheet size={18} /></span><span className="report-catalog-copy"><strong>{report.label}</strong><small>{report.description}</small></span><span className="report-catalog-action">{report.key === reportKey ? <CheckCircle2 size={17} /> : <ArrowDownToLine size={16} />}</span></button>)}</section>
      <div className="data-note"><span className="note-mark">i</span><span>所有报表均由服务端重新按项目权限查询并生成只读数据快照。XLSX 模板可以自定义版式，但不能绕过业务字段白名单；导出的工作簿不会回写系统数据。</span></div>
    </>}
  </div>;
}
