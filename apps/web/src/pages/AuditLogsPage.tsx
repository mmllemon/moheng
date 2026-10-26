import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Download, Filter, History, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { Project } from '../types';
import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import SettingsSection from '../components/SettingsSection';
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';

type AuditEntry = {
  id: string;
  createdAt: string;
  actor: { id: string; name: string; email: string };
  project: { id: string; name: string; code: string } | null;
  entity: string;
  entityId: string;
  action: string;
  changes: unknown;
};
type AuditResponse = { items: AuditEntry[]; total: number; page: number; pageSize: number; pageCount: number; exportLimit: number };
type AuditFilters = { q: string; projectId: string; entity: string; from: string; to: string };

const entityLabels: Record<string, string> = {
  Project: '项目档案', ProjectMember: '项目成员', MainContract: '业主主合同', BudgetItem: '目标成本', CostEntry: '实际成本',
  ProgressBill: '进度款', ProgressPayment: '到账记录', Change: '变更签证', ChangeEvidenceFile: '变更凭证',
  DownstreamContract: '分供合同', DownstreamContractAdjustment: '分供合同调整', DownstreamPaymentPlan: '付款计划',
  DownstreamContractPayment: '分供付款/退款', DownstreamContractSettlement: '分供结算', DownstreamPayable: '应付账款',
  DownstreamSupplierInvoice: '供应商发票', OwnerContractSettlement: '业主竣工结算', OwnerReceivable: '业主应收',
  OwnerReceipt: '业主到账/退款', OwnerRetentionMovement: '业主质保金', OwnerAdvanceMovement: '业主预付款', BusinessParty: '往来单位', User: '用户账号',
};
const actionLabels: Record<string, string> = {
  CREATE: '新建记录', UPDATE: '更新资料', UPSERT: '保存合同资料', ARCHIVE: '归档记录', IMPORT_CSV: '导入清单',
  STATUS_CHANGE: '状态变更', INTERNAL_STATUS_CHANGE: '内部审批状态变更', EXTERNAL_CONFIRMATION_EFFECTIVE: '外部确认并生效',
  EXTERNAL_CONFIRMATION_NEEDS_SUPPLEMENT: '外部确认待补件', EXTERNAL_CONFIRMATION_DISPUTED: '外部确认存在争议',
  INTERNAL_AMOUNT_DISCREPANCY_REVIEW_COMPLETED: '完成金额差异复核', PAYMENT_REGISTERED: '登记到账', PAYMENT_RECORDED: '登记付款',
  PAYMENT_REFUND_RECORDED: '登记退款', OWNER_RECEIPT_REGISTERED: '登记业主收款', OWNER_SETTLEMENT_POSTED: '业主结算入账',
  DOWNSTREAM_SETTLEMENT_POSTED: '分供结算入账', LINK_DOWNSTREAM_CONTRACT: '关联合同', UPDATE_DRAFT: '修改草稿', CREATE_DRAFT: '新建草稿',
  PROJECT_MEMBER_ADDED: '添加项目成员', PROJECT_MEMBER_ROLE_UPDATED: '调整成员权限', USER_CREATED: '创建用户',
  SUPPLIER_INVOICE_VERIFIED: '核验供应商发票', EVIDENCE_FILE_DOWNLOADED: '下载变更凭证',
};
const fieldLabels: Record<string, string> = {
  name: '名称', code: '编号', amount: '金额', contractAmount: '合同金额', effectiveContractAmount: '有效合同额', originalContractAmount: '原合同额',
  from: '变更前', to: '变更后', status: '状态', counterpartyName: '往来单位', reason: '原因', submittedAmount: '送审金额',
  confirmedAmount: '确认金额', previousContractAmount: '调整前合同额', currentContractAmount: '调整后合同额', paidAmount: '已付款',
  receiptNo: '收款编号', receivableNo: '应收编号', count: '记录数量', type: '类型', role: '角色', mainContractId: '主合同',
};
const entityOptions = Object.entries(entityLabels).map(([value, label]) => ({ value, label }));

function summarizeChanges(changes: unknown) {
  if (changes == null) return '没有附加变更摘要';
  if (typeof changes !== 'object' || Array.isArray(changes)) return String(changes).slice(0, 180);
  const entries = Object.entries(changes as Record<string, unknown>).filter(([key]) => !['password', 'passwordHash', 'token', 'tokenHash'].includes(key));
  if (!entries.length) return '有变更记录';
  return entries.slice(0, 3).map(([key, value]) => {
    let text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : value == null ? '—' : Array.isArray(value) ? `共 ${value.length} 项` : '详情见展开';
    if (text.length > 42) text = `${text.slice(0, 39)}…`;
    return `${fieldLabels[key] ?? key}：${text}`;
  }).join('；');
}

function toQuery(filters: AuditFilters, page: number, format: 'json' | 'csv') {
  const params = new URLSearchParams({ page: String(page), pageSize: '20', format });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

export default function AuditLogsPage() {
  const [draft, setDraft] = useState<AuditFilters>({ q: '', projectId: '', entity: '', from: '', to: '' });
  const [filters, setFilters] = useState<AuditFilters>({ q: '', projectId: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const queryString = useMemo(() => toQuery(filters, page, 'json'), [filters, page]);
  const logsQuery = useQuery({ queryKey: ['audit-logs', queryString], queryFn: () => api.get<AuditResponse>(`/audit-logs?${queryString}`) });
  const result = logsQuery.data;

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft });
    setPage(1);
    setExpandedId(null);
  }
  function resetFilters() {
    const empty = { q: '', projectId: '', entity: '', from: '', to: '' };
    setDraft(empty); setFilters(empty); setPage(1); setExpandedId(null);
  }
  async function exportCsv() {
    setExportPending(true); setExportMessage('');
    try {
      const csv = await api.download(`/audit-logs?${toQuery(filters, 1, 'csv')}`);
      const url = URL.createObjectURL(csv);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = '墨衡-操作追溯.csv';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(`导出完成；最多包含当前筛选下最新 ${result?.exportLimit ?? 5000} 条记录。`);
    } catch (error) {
      setExportMessage(error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。');
    } finally { setExportPending(false); }
  }

  return <div className="page-wrap audit-log-page">
    <PageHeader eyebrow="AUDIT / TRACEABILITY" title="操作追溯" subtitle="集中查看当前账号可访问范围内的业务操作记录。此页面只读，不改变合同、成本、结算或审批状态。" actions={<Button variant="secondary" onClick={() => void exportCsv()} disabled={exportPending || !result || result.total === 0}><Download size={15} />{exportPending ? '正在导出…' : '导出 CSV'}</Button>} />

    <section className="audit-summary-grid">
      <article className="panel audit-summary-card"><span className="audit-summary-icon"><History size={17} /></span><div><small>匹配操作记录</small><strong>{(result?.total ?? 0).toLocaleString('zh-CN')}</strong><span>按当前筛选条件统计</span></div></article>
      <article className="panel audit-summary-card"><span className="audit-summary-icon"><ShieldCheck size={17} /></span><div><small>数据访问范围</small><strong>权限内</strong><span>仅查询有权访问的项目记录</span></div></article>
      <article className="panel audit-summary-card"><span className="audit-summary-icon"><CalendarClock size={17} /></span><div><small>当前页</small><strong>{result ? `${result.page} / ${Math.max(1, result.pageCount)}` : '—'}</strong><span>每页 20 条，按时间倒序</span></div></article>
    </section>

    <form className="panel audit-filter-panel" onSubmit={submitFilters}>
      <div className="audit-filter-heading"><div><h3><Filter size={16} />筛选操作记录</h3><p>可按项目、业务对象、操作者/动作/记录编号和日期范围筛选。</p></div><span>只读审计视图</span></div>
      <div className="audit-filter-rows">
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">项目范围</div><div className="settings-row-hint">在全部可访问项目或单一项目内检索。</div></div>
          <div className="settings-row-control"><SelectField value={draft.projectId} onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))} aria-label="项目范围"><option value="">全部可访问项目</option>{(projectsQuery.data ?? []).map((project) => <option value={project.id} key={project.id}>{project.name} · {project.code}</option>)}</SelectField></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">业务对象</div><div className="settings-row-hint">按合同、成本、变更、结算等对象筛选。</div></div>
          <div className="settings-row-control"><SelectField value={draft.entity} onChange={(event) => setDraft((current) => ({ ...current, entity: event.target.value }))} aria-label="业务对象"><option value="">全部业务对象</option>{entityOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</SelectField></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">关键字</div><div className="settings-row-hint">操作者、动作、对象编号或项目名称。</div></div>
          <div className="settings-row-control"><div className="audit-search-input"><Search size={15} /><input value={draft.q} onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))} placeholder="操作者、动作、对象编号、项目名称" aria-label="关键字" /></div></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">开始日期</div><div className="settings-row-hint">留空表示不限起始时间。</div></div>
          <div className="settings-row-control"><DatePicker value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} aria-label="开始日期" placeholder="不限" max={draft.to || undefined} /></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">结束日期</div><div className="settings-row-hint">留空表示不限截止时间。</div></div>
          <div className="settings-row-control"><DatePicker value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} aria-label="结束日期" placeholder="不限" min={draft.from || undefined} /></div>
        </div>
      </div>
      <div className="settings-row-actions"><span className="settings-row-actions-note">导出采用 UTF-8 BOM，支持用 Excel 打开；单次最多导出最新 5,000 条。</span><div className="settings-row-actions-buttons"><Button type="button" variant="ghost" onClick={resetFilters}>重置</Button><Button type="submit"><Search size={14} />应用筛选</Button></div></div>
      {exportMessage && <div className={`audit-inline-message ${exportMessage.startsWith('导出失败') ? 'is-error' : ''}`} role="status">{exportMessage}</div>}
    </form>

    <SettingsSection
      title={<><Activity size={17} />操作流水</>}
      description="展开任意记录可查看该操作保存的变更快照。"
      context={<Button variant="ghost" onClick={() => void logsQuery.refetch()} disabled={logsQuery.isFetching}><RefreshCw size={14} className={logsQuery.isFetching ? 'audit-refreshing' : ''} />刷新</Button>}
    >
      <SettingsSection.Card density="padded" className="audit-table-panel">
      {logsQuery.isLoading ? <LoadingBlock label="正在加载操作记录…" /> : logsQuery.error ? <ErrorBlock message={(logsQuery.error as Error).message} retry={() => void logsQuery.refetch()} /> : !result?.items.length ? <EmptyState title="没有匹配的操作记录" description="可以调整项目、业务对象或日期范围，或者重置筛选条件。" action={resetFilters} /> : <>
        <div className="table-scroll"><table className="data-table audit-log-table"><thead><tr><th>操作时间</th><th>操作人</th><th>项目</th><th>业务对象</th><th>操作类型</th><th>变更摘要</th><th>详情</th></tr></thead><tbody>{result.items.map((item) => <Fragment key={item.id}>
          <tr key={item.id} className={`audit-log-row ${expandedId === item.id ? 'is-expanded' : ''}`}>
            <td className="audit-time-cell"><strong>{new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</strong><small>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</small></td>
            <td><strong>{item.actor.name}</strong><small className="table-subtext">{item.actor.email}</small></td>
            <td>{item.project ? <><strong className="table-primary-text">{item.project.name}</strong><small className="table-subtext">{item.project.code}</small></> : <span className="muted-note">全局 / 单位档案</span>}</td>
            <td><span className="audit-entity-label">{entityLabels[item.entity] ?? item.entity}</span><small className="table-subtext audit-entity-id">{item.entityId}</small></td>
            <td><span className="audit-action-pill">{actionLabels[item.action] ?? item.action}</span></td>
            <td className="audit-summary-cell">{summarizeChanges(item.changes)}</td>
            <td><button className="audit-expand-button" type="button" aria-expanded={expandedId === item.id} onClick={() => setExpandedId((current) => current === item.id ? null : item.id)}>{expandedId === item.id ? '收起' : '详情'}<ChevronDown size={14} /></button></td>
          </tr>
          {expandedId === item.id && <tr key={`${item.id}-detail`} className="audit-detail-row"><td colSpan={7}><div className="audit-detail-card"><div><span>记录 ID</span><code>{item.id}</code></div><div><span>业务对象 ID</span><code>{item.entityId}</code></div><div className="audit-json-heading"><span>变更快照</span><span>原始审计数据只读展示</span></div><pre>{item.changes == null ? '此操作未附带变更快照。' : JSON.stringify(item.changes, null, 2)}</pre></div></td></tr>}
        </Fragment>)}</tbody></table></div>
        <div className="audit-pagination"><span>共 {result.total.toLocaleString('zh-CN')} 条记录</span><div><Button variant="secondary" disabled={page <= 1 || logsQuery.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} />上一页</Button><span>第 <strong>{result.page}</strong> / {Math.max(1, result.pageCount)} 页</span><Button variant="secondary" disabled={page >= result.pageCount || logsQuery.isFetching} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight size={14} /></Button></div></div>
      </>}
      </SettingsSection.Card>
    </SettingsSection>
  </div>;
}
