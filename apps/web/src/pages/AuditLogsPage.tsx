import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronLeft, ChevronRight, Download, Filter, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { Project } from '../types';
import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { Button, EmptyState, ErrorBlock, LoadingBlock, Metrics, PageHeader } from '../components/Ui';

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
  DownstreamRetentionMovement: '分供质保金',
  SystemAuthorizationReview: '授权复核',
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
  RETENTION_RELEASED_TO_PAYABLE: '质保金释放并生成应付', RETENTION_FORFEITED: '质保金没收/扣罚',
  RETENTION_DEDUCTED: '质保金专项扣回', RETENTION_DEDUCTION_REVERSED: '质保金扣回冲回',
  OWNER_RETENTION_RELEASED: '业主质保金释放',
  AUTHORIZATION_REVIEW_CREATED: '保存复核快照', AUTHORIZATION_REVIEW_COMPLETED: '完成授权复核',
  // 分供结算与发票
  SETTLEMENT_DRAFT_CREATED: '新建分供结算草稿', SETTLEMENT_DRAFT_UPDATED: '修改分供结算草稿',
  SETTLEMENT_SUBMITTED: '提交分供结算', SETTLEMENT_INTERNAL_APPROVED: '分供结算内部审核通过',
  SETTLEMENT_COUNTERPARTY_CONFIRMED: '分供结算对方确认', SETTLEMENT_POSTED: '分供结算过账',
  SETTLEMENT_REJECTED: '退回分供结算', PAYABLE_SCHEDULES_REPLACED: '重排应付分期',
  SUPPLIER_INVOICE_RECORDED: '登记供应商发票', SUPPLIER_INVOICE_ALLOCATED: '发票核对应付来源',
  SUPPLIER_INVOICE_REJECTED: '退回供应商发票',
  // 业主侧结算与应收
  OWNER_SETTLEMENT_DRAFT_CREATED: '新建业主结算草稿', OWNER_SETTLEMENT_SUBMITTED: '提交业主结算',
  OWNER_SETTLEMENT_INTERNAL_APPROVED: '业主结算内部审核通过', OWNER_SETTLEMENT_COUNTERPARTY_CONFIRMED: '业主结算对方确认',
  OWNER_SETTLEMENT_REJECTED: '退回业主结算', OWNER_RECEIVABLE_SCHEDULES_REPLACED: '重排应收收款计划',
  OWNER_ADVANCE_RECEIVED: '业主预付款到账', OWNER_RECEIPT_REFUNDED: '业主到账退款',
  OWNER_INVOICE_ISSUED: '开具业主发票', OWNER_INVOICE_VOIDED: '作废业主发票',
  EFFECTIVE_SIGNED_AMENDMENT_RECORDED: '登记已生效补充协议', LEGACY_REVENUE_RECORDS_LINKED: '历史收入记录回填主合同',
  PROGRESS_BILL_RECEIVABLE_CREATED: '进度款生成应收', IMPORT_XLSX: '导入清单',
  // 登录与账号安全
  LOGIN_SUCCEEDED: '登录成功', LOGIN_FAILED: '登录失败', LOGIN_MFA_FAILED: '二次验证失败',
  LOGIN_RATE_LIMITED: '登录触发限流', LOGOUT: '退出登录', SESSION_REVOKED: '撤销登录会话',
  SESSION_IDLE_TIMEOUT: '会话超时失效', MFA_ENABLED: '启用二次验证', MFA_ENROLLMENT_STARTED: '开始绑定二次验证',
  USER_MFA_RESET: '管理员重置用户二次验证', USER_PASSWORD_RESET: '管理员重置用户密码',
  USER_PASSWORD_CHANGED_SELF: '本人修改登录密码', USER_PASSWORD_CHANGED: '首次登录修改初始密码',
  USER_ORGANIZATION_UPDATED: '更新用户组织归属', USER_PROJECT_DATA_SCOPE_CHANGED: '变更用户项目数据范围',
  AUTO_CREATE_FROM_BUSINESS_RECORD: '按业务记录自动建档', ROLE_ADDED_FROM_BUSINESS_RECORD: '按业务记录追加角色',
  // 报表与模板
  REPORT_TEMPLATE_CREATED: '新建报表模板', REPORT_TEMPLATE_UPDATED: '修改报表模板',
  REPORT_TEMPLATE_PUBLISHED: '发布报表模板', REPORT_TEMPLATE_ARCHIVED: '归档报表模板',
  REPORT_TEMPLATE_DUPLICATED: '复制报表模板', REPORT_TEMPLATE_REVISION_RESTORED: '恢复模板版本',
  REPORT_STUDIO_TEMPLATE_CREATED: '新建综合报表模板', REPORT_STUDIO_TEMPLATE_UPDATED: '修改综合报表模板',
  REPORT_STUDIO_TEMPLATE_PUBLISHED: '发布综合报表模板', REPORT_XLSX_EXPORT_QUEUED: '排队导出报表',
  REPORT_STUDIO_XLSX_EXPORT_QUEUED: '排队导出综合报表',
  // 助手
  ASSISTANT_CONVERSATION_CREATED: '新建助手会话', ASSISTANT_CONVERSATION_ARCHIVED: '归档助手会话',
  ASSISTANT_MESSAGE_SUBMITTED: '提交助手提问', ASSISTANT_RUN_COMPLETED: '助手回答完成',
  ASSISTANT_RUN_FAILED: '助手运行失败', ASSISTANT_RUN_CANCEL_REQUESTED: '取消助手任务',
  ASSISTANT_RUN_CANCEL_ATTEMPTED: '尝试取消已结束的助手任务',
  ASSISTANT_READ_ONLY_TOOL_SUCCEEDED: '助手只读工具成功', ASSISTANT_READ_ONLY_TOOL_FAILED: '助手只读工具失败',
  ASSISTANT_PROVIDER_CONFIG_UPDATED: '更新助手供应商配置', ASSISTANT_PROVIDER_MODELS_FETCHED: '拉取助手模型列表',
  ASSISTANT_PROVIDER_TEST_SUCCEEDED: '助手供应商连接测试通过', ASSISTANT_PROVIDER_TEST_FAILED: '助手供应商连接测试失败',
  // 系统治理与运维
  GOVERNANCE_RULE_DRAFT_CREATED: '保存治理规则草稿', GOVERNANCE_RULE_PUBLISHED: '发布治理规则',
  WORKFLOW_DRAFT_CREATED: '保存审批流程草稿', WORKFLOW_ROLLBACK_DRAFT_CREATED: '保存审批流程回滚草稿',
  PROJECT_ACCESS_POLICY_DRAFT_CREATED: '保存项目权限策略草稿', PROJECT_ACCESS_POLICY_ROLLBACK_DRAFT_CREATED: '保存项目权限策略回滚草稿',
  SYSTEM_PARAMETER_DRAFT_CREATED: '保存系统参数草稿', SYSTEM_PARAMETER_PUBLISHED: '发布系统参数',
  SYSTEM_PARAMETER_ROLLBACK_DRAFT_CREATED: '保存系统参数回滚草稿',
  DEPARTMENT_CREATED: '新建部门', DEPARTMENT_UPDATED: '更新部门',
  SYSTEM_DICTIONARY_CREATED: '新建数据字典', SYSTEM_DICTIONARY_UPDATED: '修改数据字典',
  SYSTEM_DICTIONARY_ITEM_CREATED: '新增字典项', SYSTEM_DICTIONARY_ITEM_UPDATED: '修改字典项',
  DATABASE_BACKUP_CREATED: '创建数据库备份', DATABASE_BACKUP_DOWNLOADED: '下载数据库备份',
  DATABASE_BACKUP_GLOBALS_DOWNLOADED: '下载备份全局对象', DATABASE_BACKUP_FAILED: '数据库备份失败',
  DATABASE_BACKUP_EXPIRED: '数据库备份过期', DATABASE_RESTORE_DRILL_SUCCEEDED: '恢复演练通过',
  DATABASE_RESTORE_DRILL_FAILED: '恢复演练失败', DATA_QUALITY_SCAN: '数据质量扫描',
  INTEGRATION_CREDENTIAL_CREATED: '创建集成凭据', INTEGRATION_SECRET_ROTATED: '轮换集成密钥',
  INTEGRATION_METADATA_UPDATED: '更新集成元数据', INTEGRATION_DISPATCH_QUEUED: '集成推送已排队',
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

  return <div className="page-wrap system-expansion-page audit-log-page">
    <PageHeader eyebrow="AUDIT / TRACEABILITY" title="操作追溯" subtitle="集中查看当前账号可访问范围内的业务操作记录。此页面只读，不改变合同、成本、结算或审批状态。" actions={<Button variant="secondary" onClick={() => void exportCsv()} disabled={exportPending || !result || result.total === 0}><Download size={15} />{exportPending ? '正在导出…' : '导出 CSV'}</Button>} />

    <Metrics columns={3} ariaLabel="操作追溯概览" items={[
      { label: '匹配操作记录', value: (result?.total ?? 0).toLocaleString('zh-CN'), detail: '按当前筛选条件统计' },
      { label: '数据访问范围', value: '权限内', detail: '仅查询有权访问的项目记录', emphasis: true },
      { label: '当前页', value: result ? `${result.page} / ${Math.max(1, result.pageCount)}` : '—', detail: '每页 20 条，按时间倒序' },
    ]} />

    <section className="ldg-section">
      <div className="ldg-section-head"><div><h2><Filter size={16} />筛选操作记录</h2><p>可按项目、业务对象、操作者/动作/记录编号和日期范围筛选。</p></div><span className="ldg-section-count">只读审计视图</span></div>
      <form className="ldg-section-card audit-filter-panel" onSubmit={submitFilters}>
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
    </section>

    <section className="ldg-section">
      <div className="ldg-section-head"><div><h2><Activity size={16} />操作流水</h2><p>展开任意记录可查看该操作保存的变更快照。</p></div><Button variant="ghost" onClick={() => void logsQuery.refetch()} disabled={logsQuery.isFetching}><RefreshCw size={14} className={logsQuery.isFetching ? 'audit-refreshing' : ''} />刷新</Button></div>
      <div className="ldg-section-card audit-table-panel">
      {logsQuery.isLoading ? <LoadingBlock label="正在加载操作记录…" /> : logsQuery.error ? <ErrorBlock error={logsQuery.error} retry={() => void logsQuery.refetch()} /> : !result?.items.length ? <EmptyState title="没有匹配的操作记录" description="可以调整项目、业务对象或日期范围，或者重置筛选条件。" action={resetFilters} /> : <>
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
      </div>
    </section>
  </div>;
}
