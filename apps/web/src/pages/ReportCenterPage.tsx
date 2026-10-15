import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowRight, Building2, Check, CheckCircle2, Eye, FileSpreadsheet, FolderKanban, Info, RefreshCw, Settings2 } from 'lucide-react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import type { Project } from '../types';
import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';

type Report = { key: string; label: string; description: string; dateField: string; rowLimit: number };
type ReportCategory = 'ALL' | 'COST' | 'OWNER' | 'DOWNSTREAM';
const reportCategoryKeys: Record<ReportCategory, string[]> = {
  ALL: [], COST: ['target-cost', 'actual-cost'], OWNER: ['progress-bills', 'changes', 'owner-receivables', 'owner-receipts'], DOWNSTREAM: ['downstream-contracts', 'downstream-payables'],
};
const reportCategoryLabels: Array<{ key: ReportCategory; label: string }> = [
  { key: 'ALL', label: '全部' }, { key: 'COST', label: '成本' }, { key: 'OWNER', label: '业主侧' }, { key: 'DOWNSTREAM', label: '分供侧' },
];

const catalogFallback: Report[] = [
  { key: 'target-cost', label: '目标成本清单', description: '清单编号、父级、工程量、单价、目标合价与更新时间。', dateField: '更新时间', rowLimit: 10000 },
  { key: 'actual-cost', label: '实际成本台账', description: '成本发生日期、分类、金额、业务对象及合同关联。', dateField: '成本日期', rowLimit: 10000 },
  { key: 'progress-bills', label: '业主进度款申报', description: '申报、核定、到账汇总与主合同关联。', dateField: '申报日期', rowLimit: 10000 },
  { key: 'changes', label: '变更签证台账', description: '送审金额、内部审批、外部确认与生效金额。', dateField: '发生日期', rowLimit: 10000 },
  { key: 'owner-receivables', label: '业主应收台账', description: '毛额、扣款、净应收、到期日与状态。', dateField: '入账日期', rowLimit: 10000 },
  { key: 'owner-receipts', label: '业主到账与退款流水', description: '到账和退款独立记录，保留原始流水关联。', dateField: '到账日期', rowLimit: 10000 },
  { key: 'downstream-contracts', label: '分供合同台账', description: '原始合同额、有效调整汇总、状态与往来单位。', dateField: '创建日期', rowLimit: 10000 },
  { key: 'downstream-payables', label: '分供应付台账', description: '已过账应付、扣款、净应付、到期日与合同关联。', dateField: '入账日期', rowLimit: 10000 },
];

export default function ReportCenterPage() {
  const navigate = useNavigate();
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const [projectId, setProjectId] = useState(selectedProjectId ?? '');
  const [reportKey, setReportKey] = useState('target-cost');
  const [reportCategory, setReportCategory] = useState<ReportCategory>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const catalogQuery = useQuery({ queryKey: ['reports-catalog'], queryFn: () => api.get<Report[]>('/reports/catalog') });
  const catalog = catalogQuery.data ?? catalogFallback;
  const selected = useMemo(() => catalog.find((item) => item.key === reportKey) ?? catalogFallback[0]!, [catalog, reportKey]);
  const visibleCatalog = useMemo(() => reportCategory === 'ALL' ? catalog : catalog.filter((report) => reportCategoryKeys[reportCategory].includes(report.key)), [catalog, reportCategory]);

  function previewStandardReport() {
    const params = new URLSearchParams({ reportKey });
    if (projectId) params.set('projectId', projectId); else params.set('allProjects', '1');
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    navigate(`/reports/preview?${params.toString()}`);
  }

  function openStudio(domain: 'PROJECT' | 'COMPANY') {
    const params = new URLSearchParams({ domain });
    if (domain === 'PROJECT') {
      const project = projectId || selectedProjectId || projectsQuery.data?.[0]?.id || '';
      if (!project) { setError('请先创建或选择一个可访问的项目，再设计项目级报表。'); return; }
      params.set('projectId', project);
    }
    navigate(`/reports/studio?${params.toString()}`);
  }

  async function downloadCsv() {
    setBusy(true); setNotice(''); setError('');
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const blob = await api.download(`/reports/${reportKey}.csv?${params.toString()}`);
      if (!blob) return;
      const projectLabel = projectId ? projectsQuery.data?.find((p) => p.id === projectId)?.code ?? '项目' : '全部可访问项目';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `墨衡-${projectLabel}-${selected.label}${from || to ? `-${from || '起始不限'}-${to || '结束不限'}` : ''}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      setNotice(`“${selected.label}”CSV 导出已开始。最多导出 ${selected.rowLimit.toLocaleString('zh-CN')} 条记录；超限情况以文件标记为准。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV 导出失败，请稍后重试。'); }
    finally { setBusy(false); }
  }

  function chooseCategory(category: ReportCategory) {
    setReportCategory(category);
    const keys = reportCategoryKeys[category];
    if (keys.length && !keys.includes(reportKey)) setReportKey(keys[0]!);
  }

  return <div className="page-wrap report-center-page">
    <PageHeader eyebrow="REPORTS / BUSINESS OUTPUTS" title="报表中心" subtitle="标准台账快速核对，综合经营报告统一编排；先预览，再导出。" actions={<Button variant="secondary" onClick={() => { void projectsQuery.refetch(); void catalogQuery.refetch(); }} disabled={projectsQuery.isFetching || catalogQuery.isFetching}><RefreshCw size={14} />刷新</Button>} />
    {projectsQuery.isLoading || catalogQuery.isLoading ? <LoadingBlock label="正在加载可用报表…" /> : projectsQuery.error || catalogQuery.error ? <ErrorBlock message={String(projectsQuery.error ?? catalogQuery.error ?? '报表信息加载失败')} retry={() => { void projectsQuery.refetch(); void catalogQuery.refetch(); }} /> : <>
      <section className="report-workspace-section" aria-labelledby="report-studio-heading">
        <div className="report-workspace-heading"><div><h2 id="report-studio-heading">综合经营报告</h2><p>跨业务组合数据、自由排版并保存为可复用模板。</p></div></div>
        <div className="report-studio-entry-grid" aria-label="综合报表设计入口">
          <button type="button" className="panel report-studio-entry-card" onClick={() => openStudio('PROJECT')}>
            <span className="report-studio-entry-icon"><FolderKanban size={19}/></span>
            <span className="report-studio-entry-copy"><strong>项目综合经营报告</strong><small>项目摘要、主合同、分供合同、收款、应收与成本整合到一份报告。</small><em>打开项目级工作室 <ArrowRight size={14}/></em></span>
          </button>
          <button type="button" className="panel report-studio-entry-card" onClick={() => openStudio('COMPANY')}>
            <span className="report-studio-entry-icon"><Building2 size={19}/></span>
            <span className="report-studio-entry-copy"><strong>公司级经营报表</strong><small>按权限汇总项目经营指标，支持跨项目对比与明细追溯。</small><em>打开公司级工作室 <ArrowRight size={14}/></em></span>
          </button>
        </div>
      </section>

      <section className="panel report-standard-workspace" aria-labelledby="standard-report-heading">
        <div className="report-standard-heading"><div><h2 id="standard-report-heading"><FileSpreadsheet size={17}/>标准台账</h2><p>选中左侧台账后，在右侧设置范围并预览或导出。</p></div><span className="report-format-pill">{catalog.length} 类 · CSV / XLSX</span></div>
        <div className="report-standard-layout">
          <section className="report-picker-panel" aria-label="标准台账目录">
            <div className="report-category-tabs" role="group" aria-label="报表类别">
              {reportCategoryLabels.map((category) => {
                const count = category.key === 'ALL' ? catalog.length : catalog.filter((report) => reportCategoryKeys[category.key].includes(report.key)).length;
                return <button type="button" aria-pressed={reportCategory === category.key} className={`report-category-tab ${reportCategory === category.key ? 'is-active' : ''}`} key={category.key} onClick={() => chooseCategory(category.key)}><span>{category.label}</span><small>{count}</small></button>;
              })}
            </div>
            <div className="report-report-list" role="group" aria-label="选择标准台账">
              {visibleCatalog.map((report) => <button type="button" className={`report-report-option ${report.key === reportKey ? 'is-selected' : ''}`} key={report.key} onClick={() => { setReportKey(report.key); setNotice(''); setError(''); }} aria-pressed={report.key === reportKey}>
                <span className="report-report-option-icon"><FileSpreadsheet size={15}/></span>
                <span className="report-report-option-copy"><strong>{report.label}</strong><small>{report.description}</small></span>
                <span className="report-report-option-state" aria-hidden="true">{report.key === reportKey ? <Check size={15}/> : <ArrowRight size={14}/>}</span>
              </button>)}
            </div>
          </section>

          <section className="report-export-config" aria-label="台账预览和导出设置">
            <div className="report-selected-heading"><span className="report-selected-icon"><FileSpreadsheet size={18}/></span><div><span className="report-selected-eyebrow">当前选中台账</span><h3>{selected.label}</h3><p>{selected.description}</p></div></div>
            <div className="report-export-form">
              <label className="report-field"><span>项目范围</span><SelectField value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="导出项目范围"><option value="">全部可访问项目</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</SelectField></label>
              <label className="report-field"><span>开始日期（可选）</span><DatePicker value={from} onChange={(event) => setFrom(event.target.value)} aria-label="开始日期" placeholder="不限制开始日期" max={to || undefined} /></label>
              <label className="report-field"><span>结束日期（可选）</span><DatePicker value={to} onChange={(event) => setTo(event.target.value)} aria-label="结束日期" placeholder="不限制结束日期" min={from || undefined} /></label>
            </div>
            <div className="report-description-box"><span className="report-description-icon"><Info size={16}/></span><div><strong>导出范围与数据口径</strong><p>日期筛选字段：{selected.dateField} · 单次最多 {selected.rowLimit.toLocaleString('zh-CN')} 条。超出上限时会提示截断，不能将部分明细当作完整汇总。</p></div></div>
            {notice && <div className="success-notice"><CheckCircle2 size={16}/>{notice}</div>}{error && <div className="form-alert">{error}</div>}
            <div className="report-config-footer"><span><FolderKanban size={14}/>{projectId ? `当前项目：${projectsQuery.data?.find((p) => p.id === projectId)?.name ?? '所选项目'}` : '范围：全部有权限项目'}</span><div className="report-config-actions"><Button variant="ghost" onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>清除日期</Button><Button variant="secondary" onClick={() => void downloadCsv()} disabled={busy || !catalog.some((item) => item.key === reportKey) || Boolean(from && to && from > to)}><ArrowDownToLine size={14}/>{busy ? '正在生成…' : '导出 CSV'}</Button><Button variant="secondary" onClick={() => { const params = new URLSearchParams({ reportKey, projectId, from, to }); navigate(`/reports/designer?${params.toString()}`); }}><Settings2 size={14}/>设计报表模板</Button><Button onClick={previewStandardReport} disabled={busy || !catalog.some((item) => item.key === reportKey) || Boolean(from && to && from > to)}><Eye size={14}/>预览并导出 XLSX</Button></div></div>
          </section>
        </div>
      </section>
      <div className="data-note"><span className="note-mark">i</span><span>所有报表由服务端按项目权限读取只读数据；模板不能访问白名单以外的字段，也不会回写业务台账。</span></div>
    </>}
  </div>;
}
