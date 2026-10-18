import { prisma } from './prisma.js';
import { calculateDownstreamCurrentAmount } from './downstream-contract-math.js';
import type { AuthUser } from './auth.js';
import { hasCrossProjectReadScope } from './project-data-scope.js';

export const reportCatalog = [
  { key: 'target-cost', label: '目标成本清单', description: '项目清单编号、父级、工程量、单价、目标合价与最近更新时间。', dateField: '更新时间', rowLimit: 10000 },
  { key: 'actual-cost', label: '实际成本台账', description: '成本发生日期、分类、金额、业务对象、合同及清单关联。', dateField: '成本日期', rowLimit: 10000 },
  { key: 'progress-bills', label: '业主进度款申报', description: '申报、核定、到账汇总与主合同关联。', dateField: '申报日期', rowLimit: 10000 },
  { key: 'changes', label: '变更签证台账', description: '送审金额、内部审批、外部确认状态与实际生效金额。', dateField: '发生日期', rowLimit: 10000 },
  { key: 'owner-receivables', label: '业主应收台账', description: '毛额、扣款、净应收、到期日与当前状态；不重算收款分配余额。', dateField: '入账日期', rowLimit: 10000 },
  { key: 'owner-receipts', label: '业主到账与退款流水', description: '到账和退款独立记录，保留类型与原始流水关联。', dateField: '到账日期', rowLimit: 10000 },
  { key: 'downstream-contracts', label: '分供合同台账', description: '原始合同额、有效调整汇总、状态与往来单位。', dateField: '创建日期', rowLimit: 10000 },
  { key: 'downstream-payables', label: '分供应付台账', description: '已过账应付、扣款、净应付、到期日与关联合同。', dateField: '入账日期', rowLimit: 10000 },
] as const;

export type ReportKey = typeof reportCatalog[number]['key'];
export const reportKeys = reportCatalog.map((report) => report.key) as [ReportKey, ...ReportKey[]];
export const REPORT_FIELD_LABELS: Record<ReportKey, string[]> = {
  'target-cost': ['项目名称', '项目编号', '清单编号', '清单名称', '上级编号', '上级名称', '单位', '工程量', '综合单价(元)', '目标合价(元)', '层级', '排序值', '更新时间'],
  'actual-cost': ['项目名称', '项目编号', '成本日期', '成本类型', '描述', '金额(元)', '税额(元)', '数量', '单位', '单价(元)', '清单编号', '清单名称', '分供合同编号', '分供合同名称', '供应商/往来单位', '发票号', '班组', '录入人', '备注'],
  'progress-bills': ['项目名称', '项目编号', '主合同编号', '主合同名称', '期次', '申报日期', '计量截止日期', '申报金额(元)', '核定金额(元)', '累计到账(元)', '状态', '备注'],
  'changes': ['项目名称', '项目编号', '主合同编号', '变更编号', '名称', '类型', '方向', '发生日期', '送审金额(元)', '内部核定金额(元)', '外部确认金额(元)', '内部状态', '外部确认状态', '凭证类别', '外部确认人', '确认日期', '生效日期', '差异复核状态', '备注/说明'],
  'owner-receivables': ['项目名称', '项目编号', '主合同编号', '应收编号', '类型', '标题', '毛额(元)', '预付款扣回(元)', '质保金(元)', '其他扣款(元)', '净应收(元)', '到期日', '状态', '入账时间', '备注'],
  'owner-receipts': ['项目名称', '项目编号', '主合同编号', '流水编号', '类型', '金额(元)', '到账日期', '原始流水编号', '参考号', '备注'],
  'downstream-contracts': ['项目名称', '项目编号', '合同编号', '合同名称', '类型', '相对方', '范围', '原始合同额(元)', '有效调整净额(元)', '当前合同额(元)', '状态', '签订日期', '开始日期', '计划结束日期', '付款条款', '备注'],
  'downstream-payables': ['项目名称', '项目编号', '分供合同编号', '分供合同名称', '相对方', '应付编号', '类型', '结算编号', '结算类型', '结算状态', '毛额(元)', '预付款扣回(元)', '质保金(元)', '其他扣款(元)', '净应付(元)', '到期日', '分期数量', '备注'],
};

export type ReportFieldType = 'text' | 'number' | 'money' | 'date';
export interface ReportField { key: string; label: string; type: ReportFieldType; defaultWidth: number }
export interface ReportFilters { projectId?: string; from?: string; to?: string }
export interface ReportSnapshot {
  report: (typeof reportCatalog)[number];
  fields: ReportField[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  generatedAt: Date;
  projectScope: string;
  filters: ReportFilters;
}
export type ReportSnapshotResult = { ok: true; snapshot: ReportSnapshot } | { ok: false; status: number; code: string; message: string };

function toUtcDay(value: string | undefined, nextDay = false): Date | undefined {
  if (!value) return undefined;
  const parts = value.split('-');
  if (parts.length !== 3) return new Date(Number.NaN);
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (![y, m, d].every(Number.isFinite)) return new Date(Number.NaN);
  const date = new Date(Date.UTC(y, m - 1, d + (nextDay ? 1 : 0)));
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return new Date(Number.NaN);
  return date;
}

function valueLooksNumeric(value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  return value !== null && typeof value === 'object' && value.constructor?.name === 'Decimal';
}

function inferType(label: string, example: unknown): ReportFieldType {
  if (example instanceof Date || /日期|时间|截止日|到期日|更新时间|创建日期|签订日期|生效日期|开始日期|结束日期|确认日期|发生日期|入账时间/.test(label)) return 'date';
  if (/(元\)|金额|合价|单价|应收|应付|扣款|毛额|净额|调整净额|税额|质保金|预付款)/.test(label)) return 'money';
  if (valueLooksNumeric(example) || /工程量|数量|期次|层级|排序值|分期数量/.test(label)) return 'number';
  return 'text';
}

export function makeReportFields(reportKey: ReportKey, sampleRow: unknown[] = []): ReportField[] {
  return REPORT_FIELD_LABELS[reportKey].map((label, index) => {
    const type = inferType(label, sampleRow[index]);
    const defaultWidth = type === 'date' ? 18 : type === 'money' ? 18 : type === 'number' ? 14 : Math.min(32, Math.max(12, Math.ceil(label.length * 1.8)));
    return { key: `${reportKey}:field:${index}`, label, type, defaultWidth };
  });
}

export async function loadReportSnapshot(reportKey: ReportKey, user: AuthUser, filters: ReportFilters): Promise<ReportSnapshotResult> {
  const from = toUtcDay(filters.from);
  const toExclusive = toUtcDay(filters.to, true);
  if ((from && Number.isNaN(from.getTime())) || (toExclusive && Number.isNaN(toExclusive.getTime()))) return { ok: false, status: 400, code: 'INVALID_DATE', message: '日期无效' };
  if (from && toExclusive && from >= toExclusive) return { ok: false, status: 400, code: 'INVALID_DATE_RANGE', message: '开始日期不能晚于结束日期' };

  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const projectScope = { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) };
  const selectedProject = filters.projectId
    ? await prisma.project.findFirst({ where: { ...projectScope, id: filters.projectId }, select: { id: true, name: true } })
    : null;
  if (filters.projectId && !selectedProject) return { ok: false, status: 403, code: 'PROJECT_ACCESS_DENIED', message: '你没有导出所选项目数据的权限' };
  // Use relational project scope instead of expanding every accessible project into an IN-list.
  // This preserves row-level authorization and avoids PostgreSQL bind-parameter growth for large companies.
  const selectedProjectScope = { ...projectScope, ...(filters.projectId ? { id: filters.projectId } : {}) };
  const projectFilter = { project: selectedProjectScope };
  const dateRange = (field: 'date' | 'applyDate' | 'occurredAt' | 'postedAt' | 'receivedAt' | 'createdAt' | 'updatedAt' | 'dueAt') => from || toExclusive ? { [field]: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {};
  let rows: unknown[][] = [];
  let truncated = false;

  if (reportKey === 'target-cost') {
    const data = await prisma.budgetItem.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('updatedAt') }, include: { project: { select: { name: true, code: true } }, parent: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.code, r.name, r.parent?.code, r.parent?.name, r.unit, r.quantity, r.unitPrice, r.totalPrice, r.level, r.sortOrder, r.updatedAt]);
  } else if (reportKey === 'actual-cost') {
    const data = await prisma.costEntry.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('date') }, include: { project: { select: { name: true, code: true } }, budgetItem: { select: { code: true, name: true } }, downstreamContract: { select: { contractNo: true, name: true, counterpartyName: true } }, businessParty: { select: { name: true } }, createdBy: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.date, r.type, r.description, r.amount, r.taxAmount, r.quantity, r.unit, r.unitPrice, r.budgetItem?.code, r.budgetItem?.name, r.downstreamContract?.contractNo, r.downstreamContract?.name, r.businessParty?.name ?? r.downstreamContract?.counterpartyName ?? r.vendorName, r.invoiceNo, r.teamName, r.createdBy.name, r.notes]);
  } else if (reportKey === 'progress-bills') {
    const data = await prisma.progressBill.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('applyDate') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true, name: true } } }, orderBy: [{ applyDate: 'desc' }, { periodNo: 'desc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract?.contractNo, r.mainContract?.name, r.periodNo, r.applyDate, r.measureDate, r.amount, r.approvedAmount, r.paidAmount, r.status, r.notes]);
  } else if (reportKey === 'changes') {
    const data = await prisma.change.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('occurredAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true, name: true } } }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract?.contractNo, r.code, r.name, r.type, r.direction, r.occurredAt, r.submittedAmount, r.approvedAmount, r.externalConfirmedAmount, r.status, r.externalConfirmationStatus, r.evidenceClass, r.externalConfirmerName, r.externalConfirmedAt, r.effectiveAt, r.internalAmountReviewStatus, r.description]);
  } else if (reportKey === 'owner-receivables') {
    const data = await prisma.ownerReceivable.findMany({ where: { ...projectFilter, ...dateRange('postedAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true } } }, orderBy: [{ postedAt: 'desc' }, { receivableNo: 'asc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract.contractNo, r.receivableNo, r.type, r.title, r.grossAmount, r.advanceDeductionAmount, r.retentionAmount, r.otherDeductionAmount, r.netAmount, r.dueAt, r.status, r.postedAt, r.notes]);
  } else if (reportKey === 'owner-receipts') {
    const data = await prisma.ownerReceipt.findMany({ where: { ...projectFilter, ...dateRange('receivedAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true } }, originalReceipt: { select: { receiptNo: true } } }, orderBy: [{ receivedAt: 'desc' }, { receiptNo: 'asc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract.contractNo, r.receiptNo, r.type, r.amount, r.receivedAt, r.originalReceipt?.receiptNo, r.referenceNo, r.notes]);
  } else if (reportKey === 'downstream-contracts') {
    const data = await prisma.downstreamContract.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('createdAt') }, include: { project: { select: { name: true, code: true } }, adjustments: { select: { direction: true, amount: true, effectiveAt: true } } }, orderBy: [{ createdAt: 'desc' }, { contractNo: 'asc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => {
      const currentAmount = calculateDownstreamCurrentAmount(r.originalAmount, r.adjustments);
      const netAdjustCents = Math.round((Number(currentAmount) - Number(r.originalAmount)) * 100);
      return [r.project.name, r.project.code, r.contractNo, r.name, r.type, r.counterpartyName, r.scope, r.originalAmount, (netAdjustCents / 100).toFixed(2), currentAmount, r.status, r.signedAt, r.startDate, r.plannedEndDate, r.paymentTerms, r.notes];
    });
  } else {
    const data = await prisma.downstreamPayable.findMany({ where: { downstreamContract: { project: selectedProjectScope, deletedAt: null }, ...dateRange('postedAt') }, include: { downstreamContract: { include: { project: { select: { name: true, code: true } }, counterpartyParty: { select: { name: true } } } }, settlement: { select: { settlementNo: true, type: true, status: true } }, schedules: { select: { dueAt: true, amount: true } } }, orderBy: [{ postedAt: 'desc' }, { payableNo: 'asc' }], take: 10001 });
    truncated = data.length > 10000;
    rows = data.slice(0, 10000).map(r => [r.downstreamContract.project.name, r.downstreamContract.project.code, r.downstreamContract.contractNo, r.downstreamContract.name, r.downstreamContract.counterpartyParty?.name ?? r.downstreamContract.counterpartyName, r.payableNo, r.type, r.settlement?.settlementNo, r.settlement?.type, r.settlement?.status, r.grossAmount, r.advanceRecoveryAmount, r.retentionAmount, r.otherDeductionAmount, r.netAmount, r.dueAt, r.schedules.length, r.notes]);
  }

  const projectNames = accessibleProjects.filter((p) => projectIds.includes(p.id)).map((p) => p.name);
  const labels = REPORT_FIELD_LABELS[reportKey];
  if (rows.some((row) => row.length !== labels.length)) throw new Error(`REPORT_SCHEMA_MISMATCH:${reportKey}`);
  return {
    ok: true,
    snapshot: {
      report: reportCatalog.find((r) => r.key === reportKey)!,
      fields: makeReportFields(reportKey, rows[0] ?? []), rows, rowCount: rows.length, truncated,
      generatedAt: new Date(), projectScope: filters.projectId ? selectedProject!.name : '全部可访问项目',
      filters,
    },
  };
}

export function valueForJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && value.constructor?.name === 'Decimal') return Number(value);
  if (value === undefined) return null;
  return value;
}
