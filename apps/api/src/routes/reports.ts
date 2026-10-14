import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authRequired, authUser } from '../lib/auth.js';
import { buildCsv } from '../lib/csv-export.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { calculateDownstreamCurrentAmount } from '../lib/downstream-contract-math.js';

const reportCatalog = [
  { key: 'target-cost', label: '目标成本清单', description: '项目清单编号、父级、工程量、单价、目标合价与最近更新时间。', dateField: '更新时间', rowLimit: 10000 },
  { key: 'actual-cost', label: '实际成本台账', description: '成本发生日期、分类、金额、业务对象、合同及清单关联。', dateField: '成本日期', rowLimit: 10000 },
  { key: 'progress-bills', label: '业主进度款申报', description: '申报、核定、到账汇总与主合同关联。', dateField: '申报日期', rowLimit: 10000 },
  { key: 'changes', label: '变更签证台账', description: '送审金额、内部审批、外部确认状态与实际生效金额。', dateField: '发生日期', rowLimit: 10000 },
  { key: 'owner-receivables', label: '业主应收台账', description: '毛额、扣款、净应收、到期日与当前状态；不重算收款分配余额。', dateField: '入账日期', rowLimit: 10000 },
  { key: 'owner-receipts', label: '业主到账与退款流水', description: '到账和退款独立记录，保留类型与原始流水关联。', dateField: '到账日期', rowLimit: 10000 },
  { key: 'downstream-contracts', label: '分供合同台账', description: '原始合同额、有效调整汇总、状态与往来单位。', dateField: '创建日期', rowLimit: 10000 },
  { key: 'downstream-payables', label: '分供应付台账', description: '已过账应付、扣款、净应付、到期日与关联合同。', dateField: '入账日期', rowLimit: 10000 },
] as const;

type ReportKey = typeof reportCatalog[number]['key'];
const querySchema = z.object({
  projectId: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
function toUtcDay(value: string | undefined, nextDay = false): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + (nextDay ? 1 : 0)));
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return new Date(Number.NaN);
  return date;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/catalog', { preHandler: authRequired }, async () => success(reportCatalog));

  app.get('/:reportKey.csv', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { reportKey } = request.params as { reportKey: string };
    const report = reportCatalog.find((item) => item.key === reportKey) as (typeof reportCatalog)[number] | undefined;
    if (!report) return failure(reply, 404, 'REPORT_NOT_FOUND', '报表类型不存在');
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表筛选参数不正确', parsed.error.flatten());
    const from = toUtcDay(parsed.data.from);
    const toExclusive = toUtcDay(parsed.data.to, true);
    if ((from && Number.isNaN(from.getTime())) || (toExclusive && Number.isNaN(toExclusive.getTime()))) return failure(reply, 400, 'INVALID_DATE', '日期无效');
    if (from && toExclusive && from >= toExclusive) return failure(reply, 400, 'INVALID_DATE_RANGE', '开始日期不能晚于结束日期');

    const accessibleProjects = await prisma.project.findMany({
      where: { deletedAt: null, ...(user.role === 'ADMIN' ? {} : { members: { some: { userId: user.sub } } }) },
      select: { id: true, name: true, code: true }, orderBy: { code: 'asc' },
    });
    const availableIds = accessibleProjects.map((p) => p.id);
    if (parsed.data.projectId && !availableIds.includes(parsed.data.projectId)) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有导出所选项目数据的权限');
    const projectIds = parsed.data.projectId ? [parsed.data.projectId] : availableIds;
    const projectFilter = { projectId: { in: projectIds } };
    const dateRange = (field: 'date' | 'applyDate' | 'occurredAt' | 'postedAt' | 'receivedAt' | 'createdAt' | 'updatedAt' | 'dueAt') => from || toExclusive ? { [field]: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {};
    let headers: string[] = [];
    let rows: unknown[][] = [];
    let truncated = false;

    if (report.key === 'target-cost') {
      const data = await prisma.budgetItem.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('updatedAt') }, include: { project: { select: { name: true, code: true } }, parent: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '清单编号', '清单名称', '上级编号', '上级名称', '单位', '工程量', '综合单价(元)', '目标合价(元)', '层级', '排序值', '更新时间'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.code, r.name, r.parent?.code, r.parent?.name, r.unit, r.quantity, r.unitPrice, r.totalPrice, r.level, r.sortOrder, r.updatedAt]);
    } else if (report.key === 'actual-cost') {
      const data = await prisma.costEntry.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('date') }, include: { project: { select: { name: true, code: true } }, budgetItem: { select: { code: true, name: true } }, downstreamContract: { select: { contractNo: true, name: true, counterpartyName: true } }, businessParty: { select: { name: true } }, createdBy: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '成本日期', '成本类型', '描述', '金额(元)', '税额(元)', '数量', '单位', '单价(元)', '清单编号', '清单名称', '分供合同编号', '分供合同名称', '供应商/往来单位', '发票号', '班组', '录入人', '备注'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.date, r.type, r.description, r.amount, r.taxAmount, r.quantity, r.unit, r.unitPrice, r.budgetItem?.code, r.budgetItem?.name, r.downstreamContract?.contractNo, r.downstreamContract?.name, r.businessParty?.name ?? r.downstreamContract?.counterpartyName ?? r.vendorName, r.invoiceNo, r.teamName, r.createdBy.name, r.notes]);
    } else if (report.key === 'progress-bills') {
      const data = await prisma.progressBill.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('applyDate') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true, name: true } } }, orderBy: [{ applyDate: 'desc' }, { periodNo: 'desc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '主合同编号', '主合同名称', '期次', '申报日期', '计量截止日期', '申报金额(元)', '核定金额(元)', '累计到账(元)', '状态', '备注'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract?.contractNo, r.mainContract?.name, r.periodNo, r.applyDate, r.measureDate, r.amount, r.approvedAmount, r.paidAmount, r.status, r.notes]);
    } else if (report.key === 'changes') {
      const data = await prisma.change.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('occurredAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true, name: true } } }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '主合同编号', '变更编号', '名称', '类型', '方向', '发生日期', '送审金额(元)', '内部核定金额(元)', '外部确认金额(元)', '内部状态', '外部确认状态', '凭证类别', '外部确认人', '确认日期', '生效日期', '差异复核状态', '备注/说明'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract?.contractNo, r.code, r.name, r.type, r.direction, r.occurredAt, r.submittedAmount, r.approvedAmount, r.externalConfirmedAmount, r.status, r.externalConfirmationStatus, r.evidenceClass, r.externalConfirmerName, r.externalConfirmedAt, r.effectiveAt, r.internalAmountReviewStatus, r.description]);
    } else if (report.key === 'owner-receivables') {
      const data = await prisma.ownerReceivable.findMany({ where: { ...projectFilter, ...dateRange('postedAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true } } }, orderBy: [{ postedAt: 'desc' }, { receivableNo: 'asc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '主合同编号', '应收编号', '类型', '标题', '毛额(元)', '预付款扣回(元)', '质保金(元)', '其他扣款(元)', '净应收(元)', '到期日', '状态', '入账时间', '备注'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract.contractNo, r.receivableNo, r.type, r.title, r.grossAmount, r.advanceDeductionAmount, r.retentionAmount, r.otherDeductionAmount, r.netAmount, r.dueAt, r.status, r.postedAt, r.notes]);
    } else if (report.key === 'owner-receipts') {
      const data = await prisma.ownerReceipt.findMany({ where: { ...projectFilter, ...dateRange('receivedAt') }, include: { project: { select: { name: true, code: true } }, mainContract: { select: { contractNo: true } }, originalReceipt: { select: { receiptNo: true } } }, orderBy: [{ receivedAt: 'desc' }, { receiptNo: 'asc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '主合同编号', '流水编号', '类型', '金额(元)', '到账日期', '原始流水编号', '参考号', '备注'];
      rows = data.slice(0, 10000).map(r => [r.project.name, r.project.code, r.mainContract.contractNo, r.receiptNo, r.type, r.amount, r.receivedAt, r.originalReceipt?.receiptNo, r.referenceNo, r.notes]);
    } else if (report.key === 'downstream-contracts') {
      const data = await prisma.downstreamContract.findMany({ where: { ...projectFilter, deletedAt: null, ...dateRange('createdAt') }, include: { project: { select: { name: true, code: true } }, adjustments: { select: { direction: true, amount: true, effectiveAt: true } } }, orderBy: [{ createdAt: 'desc' }, { contractNo: 'asc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '合同编号', '合同名称', '类型', '相对方', '范围', '原始合同额(元)', '有效调整净额(元)', '当前合同额(元)', '状态', '签订日期', '开始日期', '计划结束日期', '付款条款', '备注'];
      rows = data.slice(0, 10000).map(r => {
        const currentAmount = calculateDownstreamCurrentAmount(r.originalAmount, r.adjustments);
        const netAdjustCents = Math.round((Number(currentAmount) - Number(r.originalAmount)) * 100);
        return [r.project.name, r.project.code, r.contractNo, r.name, r.type, r.counterpartyName, r.scope, r.originalAmount, (netAdjustCents / 100).toFixed(2), currentAmount, r.status, r.signedAt, r.startDate, r.plannedEndDate, r.paymentTerms, r.notes];
      });
    } else {
      const data = await prisma.downstreamPayable.findMany({ where: { downstreamContract: { projectId: { in: projectIds }, deletedAt: null }, ...dateRange('postedAt') }, include: { downstreamContract: { include: { project: { select: { name: true, code: true } }, counterpartyParty: { select: { name: true } } } }, settlement: { select: { settlementNo: true, type: true, status: true } }, schedules: { select: { dueAt: true, amount: true } } }, orderBy: [{ postedAt: 'desc' }, { payableNo: 'asc' }], take: 10001 });
      truncated = data.length > 10000;
      headers = ['项目名称', '项目编号', '分供合同编号', '分供合同名称', '相对方', '应付编号', '类型', '结算编号', '结算类型', '结算状态', '毛额(元)', '预付款扣回(元)', '质保金(元)', '其他扣款(元)', '净应付(元)', '到期日', '分期数量', '备注'];
      rows = data.slice(0, 10000).map(r => [r.downstreamContract.project.name, r.downstreamContract.project.code, r.downstreamContract.contractNo, r.downstreamContract.name, r.downstreamContract.counterpartyParty?.name ?? r.downstreamContract.counterpartyName, r.payableNo, r.type, r.settlement?.settlementNo, r.settlement?.type, r.settlement?.status, r.grossAmount, r.advanceRecoveryAmount, r.retentionAmount, r.otherDeductionAmount, r.netAmount, r.dueAt, r.schedules.length, r.notes]);
    }
    const csv = buildCsv(headers, rows);
    return reply.header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="moheng-${report.key}.csv"`)
      .header('cache-control', 'no-store')
      .header('x-report-row-count', String(rows.length))
      .header('x-report-truncated', truncated ? 'true' : 'false')
      .send(csv);
  });
}
