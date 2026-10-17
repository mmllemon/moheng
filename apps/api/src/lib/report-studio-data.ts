import { prisma } from './prisma.js';
import { calculateEffectiveContractAmount, centsToMoney, moneyToCents } from './contract-amount-math.js';
import { calculateDownstreamCurrentAmount } from './downstream-contract-math.js';
import type { AuthUser } from './auth.js';
import { hasCrossProjectReadScope } from './project-data-scope.js';

export type ReportStudioDomain = 'PROJECT' | 'COMPANY' | 'PARTY';
export type ReportStudioFieldType = 'TEXT' | 'NUMBER' | 'MONEY' | 'DATE' | 'BOOLEAN';
export interface ReportStudioField { id: string; label: string; type: ReportStudioFieldType; description?: string }
export interface ReportStudioSource { id: string; label: string; cardinality: 'ONE' | 'MANY'; domains: ReportStudioDomain[]; description: string; fields: ReportStudioField[] }

const projectDomains: ReportStudioDomain[] = ['PROJECT'];
const bothDomains: ReportStudioDomain[] = ['PROJECT', 'COMPANY'];
const partyDomain: ReportStudioDomain[] = ['PARTY'];
const txt = (id: string, label: string, description?: string): ReportStudioField => ({ id, label, type: 'TEXT', ...(description ? { description } : {}) });
const money = (id: string, label: string, description?: string): ReportStudioField => ({ id, label, type: 'MONEY', ...(description ? { description } : {}) });
const num = (id: string, label: string): ReportStudioField => ({ id, label, type: 'NUMBER' });
const date = (id: string, label: string): ReportStudioField => ({ id, label, type: 'DATE' });

/** Stable source/field IDs are a compatibility contract; labels may change without changing IDs. */
export const reportStudioSources: Readonly<ReportStudioSource[]> = [
  { id: 'project', label: '项目档案', cardinality: 'ONE', domains: projectDomains, description: '当前项目基础信息，不直接计算财务指标。', fields: [
    txt('name', '项目名称'), txt('code', '项目编号'), txt('type', '项目类型'), txt('ownerName', '业主名称'), txt('managerName', '项目负责人'), txt('status', '项目状态'), txt('address', '项目地址'), date('startDate', '开工日期'), date('plannedEndDate', '计划竣工日期'),
    money('originalContractAmount', '原始合同基线金额', '项目档案存储的原始合同基线金额。'), money('effectiveContractAmount', '当前有效合同额', '按已生效外部确认的变更金额及增减方向重算。'),
  ] },
  { id: 'mainContract', label: '业主主合同', cardinality: 'ONE', domains: projectDomains, description: '单个项目的主合同档案。', fields: [
    txt('contractNo', '主合同编号'), txt('name', '主合同名称'), date('signedAt', '签订日期'), money('amount', '主合同原始金额'), num('retentionRate', '质保金比例'), num('advanceDeductionRate', '预付款扣回比例'), txt('taxIncluded', '是否含税'), txt('paymentTerms', '付款条款'), date('guaranteeEndAt', '质保期结束日'),
  ] },
  { id: 'financialSummary', label: '项目经营指标', cardinality: 'ONE', domains: projectDomains, description: '明确口径的项目汇总数据；登记净收款不包含预付款及预付款退款。', fields: [
    money('effectiveContractAmount', '当前有效合同额'), money('receiptTotal', '累计登记收款'), money('refundTotal', '累计登记退款'), money('netReceipts', '累计登记净收款', '收款减退款，不含预付款相关流水。'), money('issuedReceivableNetAmount', '登记净应收合计', '未作废应收单的净应收额之和，不等于未收余额。'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'), num('downstreamContractCount', '分供合同数量'), num('ownerReceiptCount', '业主收退款流水数量'), num('activeChangeCount', '已生效外部确认变更数量'),
  ] },
  { id: 'downstreamContracts', label: '分供合同清单', cardinality: 'MANY', domains: projectDomains, description: '分包、采购、租赁及服务合同；当前合同额由原始金额与已生效补充调整计算。', fields: [
    txt('contractNo', '合同编号'), txt('name', '合同名称'), txt('type', '合同类别'), txt('counterpartyName', '往来单位'), txt('scope', '合同范围'), txt('status', '合同状态'), date('signedAt', '签订日期'), date('plannedEndDate', '计划结束日期'), money('originalAmount', '原始合同额'), money('effectiveAmount', '当前合同额'),
  ] },
  { id: 'ownerReceivables', label: '业主应收清单', cardinality: 'MANY', domains: projectDomains, description: '应收单净额清单；不在报表引擎中重算分配后的实际未收余额。', fields: [
    txt('receivableNo', '应收编号'), txt('type', '应收类型'), txt('title', '应收标题'), txt('status', '应收状态'), money('grossAmount', '毛额'), money('netAmount', '净应收'), date('dueAt', '到期日'), date('postedAt', '入账日期'),
  ] },
  { id: 'ownerReceipts', label: '业主收款与退款流水', cardinality: 'MANY', domains: projectDomains, description: '保存收款、退款及其他类型原始流水；汇总净收款时只计 RECEIPT/REFUND。', fields: [
    txt('receiptNo', '流水编号'), txt('type', '流水类型'), money('amount', '流水金额'), date('receivedAt', '到账日期'), txt('referenceNo', '参考号'), txt('notes', '备注'), txt('originalReceiptNo', '原始收款编号'),
  ] },
  { id: 'actualCosts', label: '实际成本明细', cardinality: 'MANY', domains: projectDomains, description: '已录入的实际成本，不代表未开票应计成本或预计完工成本。', fields: [
    date('date', '成本日期'), txt('type', '成本类型'), txt('description', '成本说明'), money('amount', '成本金额'), money('taxAmount', '税额'), num('quantity', '数量'), txt('unit', '单位'), txt('vendorName', '供应商'), txt('budgetItemCode', '目标成本编号'), txt('downstreamContractNo', '关联分供合同编号'),
  ] },
  { id: 'changes', label: '变更签证清单', cardinality: 'MANY', domains: projectDomains, description: '同时保留内部状态及外部确认状态，仅 EFFECTIVE 记录进入当前有效合同额计算。', fields: [
    txt('code', '变更编号'), txt('name', '变更名称'), txt('type', '变更类型'), txt('direction', '调整方向'), txt('internalStatus', '内部审批状态'), txt('externalStatus', '外部确认状态'), money('submittedAmount', '送审金额'), money('confirmedAmount', '外部确认金额'), date('occurredAt', '发生日期'), date('effectiveAt', '生效日期'),
  ] },
  { id: 'progressBills', label: '业主进度款申报', cardinality: 'MANY', domains: projectDomains, description: '进度款申报及核定/到账字段。', fields: [
    num('periodNo', '期次'), date('applyDate', '申报日期'), date('measureDate', '计量截止日'), money('amount', '申报金额'), money('approvedAmount', '核定金额'), money('paidAmount', '登记到账金额'), txt('status', '申报状态'), txt('notes', '备注'),
  ] },
  { id: 'downstreamPayables', label: '分供应付清单', cardinality: 'MANY', domains: projectDomains, description: '已经建立的应付台账，尚未扣减已付款，避免混用应付与资金支付口径。', fields: [
    txt('payableNo', '应付编号'), txt('contractNo', '分供合同编号'), txt('contractName', '分供合同名称'), txt('counterpartyName', '往来单位'), txt('type', '应付类型'), money('netAmount', '净应付金额'), date('dueAt', '到期日'), date('postedAt', '过账日期'),
  ] },
  { id: 'companySummary', label: '公司经营指标', cardinality: 'ONE', domains: ['COMPANY'], description: '仅汇总当前账号有权访问的项目；管理员可查看全部项目。', fields: [
    num('projectCount', '可访问项目数'), money('originalContractAmount', '原始合同基线金额合计'), money('effectiveContractAmount', '当前有效合同额合计'), money('receiptTotal', '累计登记收款'), money('refundTotal', '累计登记退款'), money('netReceipts', '累计登记净收款'), money('issuedReceivableNetAmount', '登记净应收合计'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'),
  ] },
  { id: 'companyProjects', label: '公司项目清单', cardinality: 'MANY', domains: ['COMPANY'], description: '每个可访问项目一行，可用于公司级横向比较。', fields: [
    txt('code', '项目编号'), txt('name', '项目名称'), txt('status', '项目状态'), txt('managerName', '项目负责人'), txt('ownerName', '业主名称'), date('startDate', '开工日期'), date('plannedEndDate', '计划竣工日期'), money('originalContractAmount', '原始合同基线金额'), money('effectiveContractAmount', '当前有效合同额'), money('netReceipts', '累计登记净收款'), money('issuedReceivableNetAmount', '登记净应收合计'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'),
  ] },
  { id: 'companyDownstreamContracts', label: '公司分供合同清单', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的分供合同明细；显示项目归属，不把付款等同于成本。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('contractNo', '分供合同编号'), txt('name', '合同名称'), txt('type', '合同类别'), txt('counterpartyName', '往来单位'), txt('status', '合同状态'), date('signedAt', '签订日期'), money('originalAmount', '原始合同额'), money('effectiveAmount', '当前有效合同额'),
  ] },
  { id: 'companyOwnerReceivables', label: '公司业主应收清单', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的业主应收单净额清单，不将净应收单额误称为未收余额。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('receivableNo', '应收编号'), txt('type', '应收类型'), txt('title', '应收标题'), txt('status', '应收状态'), money('grossAmount', '毛额'), money('netAmount', '净应收'), date('dueAt', '到期日'), date('postedAt', '入账日期'),
  ] },
  { id: 'companyOwnerReceipts', label: '公司业主收退款流水', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的业主收退款原始流水；汇总指标只按明确类型计算。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('receiptNo', '流水编号'), txt('type', '流水类型'), money('amount', '流水金额'), date('receivedAt', '到账日期'), txt('referenceNo', '参考号'), txt('notes', '备注'), txt('originalReceiptNo', '原始收款编号'),
  ] },
  { id: 'companyActualCosts', label: '公司实际成本明细', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目已录入的实际成本，不代表预计完工成本。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), date('date', '成本日期'), txt('type', '成本类型'), txt('description', '成本说明'), money('amount', '成本金额'), money('taxAmount', '税额'), num('quantity', '数量'), txt('unit', '单位'), txt('vendorName', '供应商'), txt('budgetItemCode', '目标成本编号'), txt('downstreamContractNo', '关联分供合同编号'),
  ] },
  { id: 'companyChanges', label: '公司已生效变更清单', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目已达到外部生效状态的变更明细。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('code', '变更编号'), txt('name', '变更名称'), txt('type', '变更类型'), txt('direction', '调整方向'), txt('internalStatus', '内部审批状态'), txt('externalStatus', '外部确认状态'), money('submittedAmount', '送审金额'), money('confirmedAmount', '外部确认金额'), date('occurredAt', '发生日期'), date('effectiveAt', '生效日期'),
  ] },
  { id: 'companyProgressBills', label: '公司业主进度款', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的进度款申报/核定/登记到账数据。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), num('periodNo', '期次'), date('applyDate', '申报日期'), date('measureDate', '计量截止日'), money('amount', '申报金额'), money('approvedAmount', '核定金额'), money('paidAmount', '登记到账金额'), txt('status', '申报状态'), txt('notes', '备注'),
  ] },
  { id: 'companyDownstreamPayables', label: '公司分供应付清单', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的已建立分供应付台账，不等同于已付款现金流。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('payableNo', '应付编号'), txt('contractNo', '分供合同编号'), txt('contractName', '分供合同名称'), txt('counterpartyName', '往来单位'), txt('type', '应付类型'), money('netAmount', '净应付金额'), date('dueAt', '到期日'), date('postedAt', '过账日期'),
  ] },
  { id: 'businessParty', label: '往来单位档案', cardinality: 'ONE', domains: partyDomain, description: '当前单位的公司级主数据；跨项目金额只计算当前用户有权访问的项目。', fields: [
    txt('name', '单位名称'), txt('creditCode', '统一社会信用代码'), txt('roles', '业务角色'), txt('status', '档案状态'), txt('identityVerified', '主体核验状态'), txt('formerNames', '历史名称'), txt('legalRepresentative', '法定代表人'), txt('address', '地址'), txt('contactName', '联系人'), txt('phone', '联系电话'), txt('email', '电子邮箱'), txt('taxNo', '纳税人识别号'), txt('invoiceTitle', '发票抬头'), txt('notes', '备注'), date('updatedAt', '最近更新日期'),
  ] },
  { id: 'partySummary', label: '单位经营指标', cardinality: 'ONE', domains: partyDomain, description: '基于当前账号可访问项目的单位经营指标，沿用单位经营档案口径。', fields: [
    num('projectCount', '关联项目数'), num('mainContractCount', '业主主合同数'), num('downstreamContractCount', '分供合同数'), money('ownerCurrentContractAmount', '主合同当前有效金额'), money('ownerApprovedBillAmount', '已核定进度款'), money('ownerReceivedAmount', '业主已回款'), money('downstreamCurrentContractAmount', '分供合同当前金额'), money('downstreamSettledAmount', '分供累计结算'), money('downstreamPaidAmount', '分供累计净付款'), money('downstreamOpenPayableAmount', '分供应付未付'), money('downstreamSupplierCreditAmount', '待返还/抵扣'), money('downstreamActualCostAmount', '合同关联实际成本'), money('downstreamInvoiceAmount', '供应商发票价税合计'), money('downstreamVerifiedInvoiceAmount', '已核验发票价税合计'), money('standaloneCostAmount', '独立关联实际成本'), num('standaloneCostCount', '独立成本记录数'), money('downstreamTotalCostAmount', '实际成本合计'),
  ] },
  { id: 'partyProjects', label: '单位关联项目', cardinality: 'MANY', domains: partyDomain, description: '一个可访问关联项目一行，按项目 ID 去重。', fields: [
    txt('code', '项目编号'), txt('name', '项目名称'), txt('status', '项目状态'), txt('role', '关联角色'), money('incomeContractAmount', '主合同当前金额'), money('downstreamContractAmount', '分供合同当前金额'), money('incomePaidAmount', '业主已回款'), money('downstreamPaidAmount', '分供净付款'), money('downstreamActualCostAmount', '合同关联成本'), money('standaloneCostAmount', '独立成本'), num('downstreamContractCount', '分供合同数量'), num('incomeBillCount', '进度款期数'),
  ] },
  { id: 'partyMainContracts', label: '单位关联业主主合同', cardinality: 'MANY', domains: partyDomain, description: '单位作为建设单位关联的主合同及进度款摘要。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('contractNo', '主合同编号'), txt('name', '主合同名称'), txt('status', '项目状态'), money('originalAmount', '原始合同金额'), money('currentAmount', '当前有效合同额'), money('approvedAmount', '已核定进度款'), money('paidAmount', '已回款'), num('progressBillCount', '进度款期数'), num('changeCount', '变更数量'),
  ] },
  { id: 'partyDownstreamContracts', label: '单位关联分供合同', cardinality: 'MANY', domains: partyDomain, description: '单位作为分供相对方的合同、已过账结算、净付款、应付及成本/发票摘要。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('contractNo', '合同编号'), txt('name', '合同名称'), txt('type', '合同类别'), txt('status', '合同状态'), money('originalAmount', '原始金额'), money('currentAmount', '当前合同额'), money('settledAmount', '累计结算'), money('paidAmount', '累计净付款'), money('openPayableAmount', '应付未付'), money('supplierCreditAmount', '待返还/抵扣'), money('actualCostAmount', '关联实际成本'), money('invoiceAmount', '发票价税合计'), money('verifiedInvoiceAmount', '已核验发票金额'), num('invoiceCount', '发票数量'),
  ] },
  { id: 'partyStandaloneCosts', label: '单位独立成本记录', cardinality: 'MANY', domains: partyDomain, description: '未关联分供合同、但通过统一单位 ID 关联的成本明细；明细最多展示最近 200 条。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), date('date', '成本日期'), txt('description', '费用说明'), txt('type', '成本类型'), money('amount', '成本金额'), txt('vendorName', '业务对象'),
  ] },
];

export interface ReportStudioDataset {
  domain: ReportStudioDomain;
  generatedAt: string;
  projectId: string | null;
  businessPartyId?: string | null;
  accessibleProjectCount: number;
  sources: Record<string, unknown>;
  warnings: string[];
  truncated?: boolean;
}

function dateText(value: Date | null | undefined): string | null { return value ? value.toISOString().slice(0, 10) : null; }
function moneyValue(value: unknown): string { return centsToMoney(moneyToCents(value ?? '0')); }
function numberValue(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function sumMoney(values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
function plusMoney(...values: unknown[]): string { return sumMoney(values); }
function subtractMoney(left: unknown, right: unknown): string { return centsToMoney(moneyToCents(left ?? '0') - moneyToCents(right ?? '0')); }
const MAX_ROWS_PER_SOURCE = 10000;


function plainNumber(value: unknown): number { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
/** Money aggregation stays in integer cents; never sum PostgreSQL Decimal values through JS floating point. */
function sumPartyMoney(values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
function plusPartyMoney(...values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
function subtractPartyMoney(left: unknown, right: unknown): string { return centsToMoney(moneyToCents(left ?? '0') - moneyToCents(right ?? '0')); }
function sumNumbers(values: unknown[]): number { return values.reduce<number>((total, value) => total + plainNumber(value), 0); }

/** Loads a party report from the same underlying relationships as the operating-profile page. */
async function loadBusinessPartyReportDataset(user: AuthUser, businessPartyId?: string): Promise<ReportStudioDataset> {
  if (!businessPartyId) throw Object.assign(new Error('往来单位经营档案报表必须指定单位'), { statusCode: 400, code: 'BUSINESS_PARTY_ID_REQUIRED' });
  const party = await prisma.businessParty.findUnique({ where: { id: businessPartyId } });
  if (!party) throw Object.assign(new Error('往来单位档案不存在'), { statusCode: 404, code: 'BUSINESS_PARTY_NOT_FOUND' });
  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const projectScope = { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) };
  const visibleProjects = await prisma.project.findMany({ where: projectScope, select: { id: true, code: true, name: true, status: true }, orderBy: [{ code: 'asc' }, { id: 'asc' }] });
  const visibleIds = visibleProjects.map((project) => project.id);
  const projectFilter = { projectId: { in: visibleIds } };
  const [ownedProjects, downstreamContractsFetched, standaloneCosts, standaloneCostTotals] = await Promise.all([
    prisma.project.findMany({ where: { ...projectScope, ownerPartyId: businessPartyId }, include: { mainContract: true, progressBills: { where: { deletedAt: null }, include: { payments: true }, orderBy: [{ periodNo: 'asc' }, { id: 'asc' }] }, changes: { where: { deletedAt: null }, select: { externalConfirmationStatus: true, externalConfirmedAmount: true } } }, orderBy: [{ code: 'asc' }, { id: 'asc' }] }),
    prisma.downstreamContract.findMany({ where: { counterpartyPartyId: businessPartyId, ...projectFilter, deletedAt: null }, include: { project: { select: { id: true, name: true, code: true, status: true } }, adjustments: { select: { direction: true, amount: true } }, settlements: { where: { status: 'POSTED' }, include: { posting: { select: { deltaAmount: true, cumulativeAfter: true, postedAt: true } } } }, payments: { select: { type: true, amount: true, paidAt: true } }, payables: { include: { paymentAllocations: { select: { amount: true } } } }, costEntries: { where: { deletedAt: null }, select: { amount: true } }, supplierInvoices: { select: { amount: true, taxAmount: true, status: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.costEntry.findMany({ where: { businessPartyId, downstreamContractId: null, deletedAt: null, project: projectScope }, include: { project: { select: { id: true, name: true, code: true, status: true } } }, orderBy: [{ date: 'desc' }, { id: 'asc' }], take: 201 }),
    prisma.costEntry.groupBy({ by: ['projectId'], where: { businessPartyId, downstreamContractId: null, deletedAt: null, project: projectScope }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const downstreamContractsTruncated = downstreamContractsFetched.length > MAX_ROWS_PER_SOURCE;
  const downstreamContracts = downstreamContractsFetched.slice(0, MAX_ROWS_PER_SOURCE);
  if (user.role !== 'ADMIN' && !ownedProjects.length && !downstreamContracts.length && !standaloneCostTotals.length) {
    throw Object.assign(new Error('单位不存在，或当前账号无权查看其关联项目资料'), { statusCode: 404, code: 'BUSINESS_PARTY_NOT_FOUND' });
  }
  const projectMap = new Map<string, Record<string, unknown>>();
  for (const project of ownedProjects) {
    const paid = sumPartyMoney(project.progressBills.flatMap((bill) => bill.payments.map((payment) => payment.amount)));
    projectMap.set(project.id, { id: project.id, code: project.code, name: project.name, status: project.status, role: 'OWNER', incomeContractAmount: moneyValue(project.contractAmount), downstreamContractAmount: '0.00', incomePaidAmount: paid, downstreamPaidAmount: '0.00', downstreamActualCostAmount: '0.00', standaloneCostAmount: '0.00', downstreamContractCount: 0, incomeBillCount: project.progressBills.length });
  }
  const downstreamRows = downstreamContracts.map((contract) => {
    const currentAmount = centsToMoney(contract.adjustments.reduce<bigint>((total, adjustment) => total + (adjustment.direction === 'DECREASE' ? -1n : 1n) * moneyToCents(adjustment.amount), moneyToCents(contract.originalAmount)));
    const settledAmount = sumPartyMoney(contract.settlements.map((settlement) => settlement.posting?.deltaAmount));
    const paidAmount = subtractPartyMoney(sumPartyMoney(contract.payments.filter((payment) => payment.type !== 'REFUND').map((payment) => payment.amount)), sumPartyMoney(contract.payments.filter((payment) => payment.type === 'REFUND').map((payment) => payment.amount)));
    const openPayableCents = contract.payables.reduce<bigint>((total, payable) => { const net = moneyToCents(payable.netAmount); if (net <= 0n) return total; const paid = payable.paymentAllocations.reduce<bigint>((sum, allocation) => sum + moneyToCents(allocation.amount), 0n); return total + (net > paid ? net - paid : 0n); }, 0n);
    const openPayableAmount = centsToMoney(openPayableCents);
    const supplierCreditAmount = centsToMoney(contract.payables.reduce<bigint>((total, payable) => { const net = moneyToCents(payable.netAmount); return total + (net < 0n ? -net : 0n); }, 0n));
    const actualCostAmount = sumPartyMoney(contract.costEntries.map((cost) => cost.amount));
    const invoiceAmount = sumPartyMoney(contract.supplierInvoices.map((invoice) => invoice.amount));
    const verifiedInvoiceAmount = sumPartyMoney(contract.supplierInvoices.filter((invoice) => invoice.status === 'VERIFIED').map((invoice) => invoice.amount));
    const existing = projectMap.get(contract.project.id) ?? { id: contract.project.id, code: contract.project.code, name: contract.project.name, status: contract.project.status, role: 'COUNTERPARTY', incomeContractAmount: '0.00', downstreamContractAmount: '0.00', incomePaidAmount: '0.00', downstreamPaidAmount: '0.00', downstreamActualCostAmount: '0.00', standaloneCostAmount: '0.00', downstreamContractCount: 0, incomeBillCount: 0 };
    existing.downstreamContractCount = plainNumber(existing.downstreamContractCount) + 1;
    if (contract.status !== 'TERMINATED') existing.downstreamContractAmount = plusPartyMoney(existing.downstreamContractAmount, currentAmount);
    existing.downstreamPaidAmount = plusPartyMoney(existing.downstreamPaidAmount, paidAmount);
    existing.downstreamActualCostAmount = plusPartyMoney(existing.downstreamActualCostAmount, actualCostAmount);
    projectMap.set(contract.project.id, existing);
    return { id: contract.id, projectId: contract.project.id, projectCode: contract.project.code, projectName: contract.project.name, contractNo: contract.contractNo, name: contract.name, type: contract.type, status: contract.status, originalAmount: moneyValue(contract.originalAmount), currentAmount, settledAmount, paidAmount, openPayableAmount, supplierCreditAmount, actualCostAmount, invoiceAmount, verifiedInvoiceAmount, invoiceCount: contract.supplierInvoices.length };
  });
  const projectIdsForCosts = standaloneCostTotals.map((row) => row.projectId);
  const costProjects = projectIdsForCosts.length ? await prisma.project.findMany({ where: { ...projectScope, id: { in: projectIdsForCosts } }, select: { id: true, code: true, name: true, status: true } }) : [];
  const costProjectById = new Map(costProjects.map((project) => [project.id, project] as const));
  for (const aggregate of standaloneCostTotals) {
    const project = costProjectById.get(aggregate.projectId);
    if (!project) continue;
    const existing = projectMap.get(project.id) ?? { id: project.id, code: project.code, name: project.name, status: project.status, role: 'COST_PARTY', incomeContractAmount: '0.00', downstreamContractAmount: '0.00', incomePaidAmount: '0.00', downstreamPaidAmount: '0.00', downstreamActualCostAmount: '0.00', standaloneCostAmount: '0.00', downstreamContractCount: 0, incomeBillCount: 0 };
    existing.standaloneCostAmount = moneyValue(aggregate._sum.amount);
    existing.standaloneCostCount = aggregate._count._all;
    projectMap.set(project.id, existing);
  }
  const projectRows = [...projectMap.values()].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN') || String(a.code ?? '').localeCompare(String(b.code ?? ''), 'zh-CN') || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  if (downstreamContractsTruncated) {
    // Rows can still show the first bounded slice, but all derived downstream totals must be null rather than look complete.
    for (const project of projectRows) {
      project.downstreamContractAmount = null;
      project.downstreamPaidAmount = null;
      project.downstreamActualCostAmount = null;
      project.downstreamContractCount = null;
    }
  }
  const mainContractRows = ownedProjects.filter((project) => project.mainContract).map((project) => ({ projectCode: project.code, projectName: project.name, contractNo: project.mainContract!.contractNo, name: project.mainContract!.name, status: project.status, originalAmount: moneyValue(project.originalContractAmount), currentAmount: moneyValue(project.contractAmount), approvedAmount: sumPartyMoney(project.progressBills.map((bill) => bill.approvedAmount)), paidAmount: sumPartyMoney(project.progressBills.flatMap((bill) => bill.payments.map((payment) => payment.amount))), progressBillCount: project.progressBills.length, changeCount: project.changes.length }));
  const standaloneCostAmount = sumPartyMoney(standaloneCostTotals.map((row) => row._sum.amount));
  const sum = (key: string, source = downstreamRows) => sumPartyMoney(source.map((row) => (row as Record<string, unknown>)[key]));
  const summary = {
    projectCount: projectRows.length, mainContractCount: mainContractRows.length, downstreamContractCount: downstreamContractsTruncated ? null : downstreamRows.length,
    ownerCurrentContractAmount: sumPartyMoney(mainContractRows.map((row) => row.currentAmount)), ownerApprovedBillAmount: sumPartyMoney(mainContractRows.map((row) => row.approvedAmount)), ownerReceivedAmount: sumPartyMoney(mainContractRows.map((row) => row.paidAmount)),
    downstreamCurrentContractAmount: downstreamContractsTruncated ? null : sumPartyMoney(downstreamRows.filter((row) => row.status !== 'TERMINATED').map((row) => row.currentAmount)), downstreamSettledAmount: downstreamContractsTruncated ? null : sum('settledAmount'), downstreamPaidAmount: downstreamContractsTruncated ? null : sum('paidAmount'), downstreamOpenPayableAmount: downstreamContractsTruncated ? null : sum('openPayableAmount'), downstreamSupplierCreditAmount: downstreamContractsTruncated ? null : sum('supplierCreditAmount'), downstreamActualCostAmount: downstreamContractsTruncated ? null : sum('actualCostAmount'), downstreamInvoiceAmount: downstreamContractsTruncated ? null : sum('invoiceAmount'), downstreamVerifiedInvoiceAmount: downstreamContractsTruncated ? null : sum('verifiedInvoiceAmount'), downstreamInvoiceCount: downstreamContractsTruncated ? null : sumNumbers(downstreamRows.map((row) => row.invoiceCount)), standaloneCostAmount, standaloneCostCount: standaloneCostTotals.reduce((total, row) => total + row._count._all, 0), downstreamTotalCostAmount: downstreamContractsTruncated ? null : plusPartyMoney(sum('actualCostAmount'), standaloneCostAmount),
  };
  const warnings: string[] = [];
  if (!party.identityVerified) warnings.push('单位主体尚未核验；跨项目经营汇总仅供参考，不应直接作为最终对账依据。');
  if (downstreamContractsTruncated) warnings.push(`该往来单位关联分供合同超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条，明细仅显示前 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条；依赖分供合同集合的合同、应付、成本和发票金额汇总已停用，避免将部分数据冒充完整总额。`);
  if (standaloneCosts.length > 200) warnings.push('独立关联成本明细仅显示最近 200 条；汇总金额使用完整分组统计。');
  const partyRows = {
    businessParty: { id: party.id, name: party.name, creditCode: party.creditCode ?? '', roles: party.roles.join('、'), status: party.status, identityVerified: party.identityVerified ? '已核验' : '待核验', formerNames: party.formerNames.join('、'), legalRepresentative: party.legalRepresentative ?? '', address: party.address ?? '', contactName: party.contactName ?? '', phone: party.phone ?? '', email: party.email ?? '', taxNo: party.taxNo ?? '', invoiceTitle: party.invoiceTitle ?? '', notes: party.notes ?? '', updatedAt: dateText(party.updatedAt) },
    partySummary: summary,
    partyProjects: projectRows,
    partyMainContracts: mainContractRows,
    partyDownstreamContracts: downstreamRows,
    partyStandaloneCosts: standaloneCosts.slice(0, 200).map((cost) => ({ projectCode: cost.project.code, projectName: cost.project.name, date: dateText(cost.date), description: cost.description, type: cost.type, amount: moneyValue(cost.amount), vendorName: cost.vendorName ?? '' })),
  };
  return { domain: 'PARTY', generatedAt: new Date().toISOString(), projectId: null, businessPartyId, accessibleProjectCount: visibleProjects.length, sources: partyRows, warnings, truncated: downstreamContractsTruncated || standaloneCosts.length > 200 };
}

export async function loadReportStudioDataset(user: AuthUser, domain: ReportStudioDomain, projectId?: string, businessPartyId?: string): Promise<ReportStudioDataset> {
  if (domain === 'PARTY') return loadBusinessPartyReportDataset(user, businessPartyId);
  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const accessibleProjects = await prisma.project.findMany({
    where: { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) },
    include: { mainContract: true }, orderBy: [{ code: 'asc' }, { id: 'asc' }],
  });
  const accessibleIds = accessibleProjects.map((project) => project.id);
  if (domain === 'PROJECT' && !projectId) throw Object.assign(new Error('项目级报表必须指定项目'), { statusCode: 400, code: 'PROJECT_ID_REQUIRED' });
  if (projectId && !accessibleIds.includes(projectId)) throw Object.assign(new Error('你没有访问该项目报表的权限'), { statusCode: 403, code: 'PROJECT_ACCESS_DENIED' });
  const scopedProjects = domain === 'PROJECT' ? accessibleProjects.filter((project) => project.id === projectId) : accessibleProjects;
  const projectIds = scopedProjects.map((project) => project.id);
  const projectFilter = { projectId: { in: projectIds } };
  const warnings: string[] = [];
  if (domain === 'COMPANY' && scopedProjects.length > MAX_ROWS_PER_SOURCE) warnings.push(`当前账号可访问项目超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 个，公司项目明细列表会截断；公司汇总范围仍依据权限内项目计算。`);
  if (projectIds.length === 0) warnings.push('当前账号没有可访问项目，因此仅能生成空数据模板。');

  const [changes, downstreamContracts, ownerReceivables, ownerReceipts, actualCosts, progressBills, downstreamPayables, budgetItems] = await Promise.all([
    prisma.change.findMany({ where: { ...projectFilter, deletedAt: null, externalConfirmationStatus: 'EFFECTIVE' }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ occurredAt: 'asc' }, { code: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.downstreamContract.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } }, adjustments: { orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }] } }, orderBy: [{ project: { code: 'asc' } }, { contractNo: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.ownerReceivable.findMany({ where: { ...projectFilter, status: { not: 'VOID' } }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { postedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.ownerReceipt.findMany({ where: projectFilter, include: { project: { select: { code: true, name: true } }, originalReceipt: { select: { receiptNo: true } } }, orderBy: [{ project: { code: 'asc' } }, { receivedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.costEntry.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } }, budgetItem: { select: { code: true } }, downstreamContract: { select: { contractNo: true } } }, orderBy: [{ project: { code: 'asc' } }, { date: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.progressBill.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { periodNo: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.downstreamPayable.findMany({ where: { downstreamContract: { projectId: { in: projectIds }, deletedAt: null } }, include: { downstreamContract: { select: { projectId: true, contractNo: true, name: true, counterpartyName: true, project: { select: { code: true, name: true } } } } }, orderBy: [{ downstreamContract: { project: { code: 'asc' } } }, { downstreamContract: { contractNo: 'asc' } }, { postedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.budgetItem.findMany({ where: { ...projectFilter, deletedAt: null }, select: { id: true, parentId: true, projectId: true, totalPrice: true }, orderBy: [{ project: { code: 'asc' } }, { code: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE * 10 + 1 }),
  ]);
  const truncation = {
    changes: changes.length > MAX_ROWS_PER_SOURCE,
    downstreamContracts: downstreamContracts.length > MAX_ROWS_PER_SOURCE,
    ownerReceivables: ownerReceivables.length > MAX_ROWS_PER_SOURCE,
    ownerReceipts: ownerReceipts.length > MAX_ROWS_PER_SOURCE,
    actualCosts: actualCosts.length > MAX_ROWS_PER_SOURCE,
    progressBills: progressBills.length > MAX_ROWS_PER_SOURCE,
    downstreamPayables: downstreamPayables.length > MAX_ROWS_PER_SOURCE,
    budgetItems: budgetItems.length > MAX_ROWS_PER_SOURCE * 10,
  };
  const safeChanges = changes.slice(0, MAX_ROWS_PER_SOURCE);
  const safeDownstreamContracts = downstreamContracts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeOwnerReceivables = ownerReceivables.slice(0, MAX_ROWS_PER_SOURCE);
  const safeOwnerReceipts = ownerReceipts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeActualCosts = actualCosts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeProgressBills = progressBills.slice(0, MAX_ROWS_PER_SOURCE);
  const safeDownstreamPayables = downstreamPayables.slice(0, MAX_ROWS_PER_SOURCE);
  const safeBudgetItems = budgetItems.slice(0, MAX_ROWS_PER_SOURCE * 10);
  const labels: Array<[keyof typeof truncation, string, number]> = [
    ['changes', '变更签证', MAX_ROWS_PER_SOURCE], ['downstreamContracts', '分供合同', MAX_ROWS_PER_SOURCE],
    ['ownerReceivables', '业主应收', MAX_ROWS_PER_SOURCE], ['ownerReceipts', '收退款流水', MAX_ROWS_PER_SOURCE],
    ['actualCosts', '实际成本', MAX_ROWS_PER_SOURCE], ['progressBills', '进度款', MAX_ROWS_PER_SOURCE],
    ['downstreamPayables', '分供应付', MAX_ROWS_PER_SOURCE], ['budgetItems', '目标成本清单', MAX_ROWS_PER_SOURCE * 10],
  ];
  for (const [key, label, limit] of labels) if (truncation[key]) warnings.push(`${label}超过 ${limit.toLocaleString('zh-CN')} 条，明细已截断；依赖该数据源的金额汇总将显示为空，不会把部分数据伪装为完整财务总额。请缩小项目范围或查询条件后重新生成。`);
  const parentIds = new Set(safeBudgetItems.map((item) => item.parentId).filter((id): id is string => Boolean(id)));
  const leafBudgetByProject = new Map<string, string>();
  for (const item of safeBudgetItems) if (!parentIds.has(item.id)) leafBudgetByProject.set(item.projectId, plusMoney(leafBudgetByProject.get(item.projectId) ?? '0.00', item.totalPrice));

  const summaryByProject = new Map<string, Record<string, unknown>>();
  const downstreamEffectiveByProject = new Map<string, string | null>();
  for (const project of scopedProjects) {
    const projectChanges = safeChanges.filter((item) => item.projectId === project.id);
    const missingEffectiveAmounts = projectChanges.some((item) => item.externalConfirmedAmount === null);
    let effectiveAmount: string | null = truncation.changes || missingEffectiveAmounts ? null : moneyValue(project.originalContractAmount);
    if (missingEffectiveAmounts) warnings.push(`项目 ${project.code} 存在外部状态已生效但未记录确认金额的变更，当前有效合同额未计算。`);
    if (!truncation.changes && !missingEffectiveAmounts) { try { effectiveAmount = calculateEffectiveContractAmount(project.originalContractAmount, projectChanges.map((item) => ({ direction: item.direction, amount: item.externalConfirmedAmount! }))); } catch { effectiveAmount = null; warnings.push(`项目 ${project.code} 的有效合同额计算失败，请核对已生效外部确认调整。`); } }
    const projectDownstream = safeDownstreamContracts.filter((item) => item.projectId === project.id);
    for (const item of projectDownstream) {
      try { downstreamEffectiveByProject.set(item.id, calculateDownstreamCurrentAmount(item.originalAmount, item.adjustments)); }
      catch { downstreamEffectiveByProject.set(item.id, null); warnings.push(`分供合同 ${item.contractNo} 的当前合同额计算失败。`); }
    }
    const downstreamValues = projectDownstream.map((item) => downstreamEffectiveByProject.get(item.id) ?? null);
    const downstreamAmount = truncation.downstreamContracts || downstreamValues.some((value) => value === null) ? null : sumMoney(downstreamValues);
    const receipts = safeOwnerReceipts.filter((item) => item.projectId === project.id);
    const receiptTotal = truncation.ownerReceipts ? null : sumMoney(receipts.filter((item) => item.type === 'RECEIPT').map((item) => item.amount));
    const refundTotal = truncation.ownerReceipts ? null : sumMoney(receipts.filter((item) => item.type === 'REFUND').map((item) => item.amount));
    const actualCostTotal = truncation.actualCosts ? null : sumMoney(safeActualCosts.filter((item) => item.projectId === project.id).map((item) => item.amount));
    const issuedReceivableNetAmount = truncation.ownerReceivables ? null : sumMoney(safeOwnerReceivables.filter((item) => item.projectId === project.id).map((item) => item.netAmount));
    const postedPayableTotal = truncation.downstreamPayables ? null : sumMoney(safeDownstreamPayables.filter((item) => item.downstreamContract.projectId === project.id).map((item) => item.netAmount));
    summaryByProject.set(project.id, {
      id: project.id, code: project.code, name: project.name, type: project.type, ownerName: project.ownerName, managerName: project.managerName ?? '', status: project.status, address: project.address ?? '', startDate: dateText(project.startDate), plannedEndDate: dateText(project.plannedEndDate),
      originalContractAmount: moneyValue(project.originalContractAmount), effectiveContractAmount: effectiveAmount,
      receiptTotal, refundTotal, netReceipts: receiptTotal === null || refundTotal === null ? null : subtractMoney(receiptTotal, refundTotal), issuedReceivableNetAmount,
      targetCostTotal: truncation.budgetItems ? null : leafBudgetByProject.get(project.id) ?? '0.00', actualCostTotal, downstreamContractTotal: downstreamAmount, postedPayableTotal,
      downstreamContractCount: truncation.downstreamContracts ? null : projectDownstream.length, ownerReceiptCount: truncation.ownerReceipts ? null : receipts.length, activeChangeCount: truncation.changes ? null : projectChanges.length,
    });
  }

  const selected = scopedProjects[0];
  const selectedSummary = selected ? summaryByProject.get(selected.id) : undefined;
  const singleSourceData: Record<string, unknown> = {};
  if (domain === 'PROJECT') {
    if (selected) {
      const s = selectedSummary ?? {};
      singleSourceData.project = { id: selected.id, name: selected.name, code: selected.code, type: selected.type, ownerName: selected.ownerName, managerName: selected.managerName ?? '', status: selected.status, address: selected.address ?? '', startDate: dateText(selected.startDate), plannedEndDate: dateText(selected.plannedEndDate), originalContractAmount: s.originalContractAmount, effectiveContractAmount: s.effectiveContractAmount };
      singleSourceData.mainContract = selected.mainContract ? {
        contractNo: selected.mainContract.contractNo, name: selected.mainContract.name, signedAt: dateText(selected.mainContract.signedAt), amount: moneyValue(selected.mainContract.amount), taxIncluded: selected.mainContract.taxIncluded ? '是' : '否', retentionRate: Number(selected.mainContract.retentionRate), advanceDeductionRate: Number(selected.mainContract.advanceDeductionRate), paymentTerms: selected.mainContract.paymentTerms ?? '', guaranteeEndAt: dateText(selected.mainContract.guaranteeEndAt),
      } : null;
      singleSourceData.financialSummary = { ...s };
    } else { singleSourceData.project = null; singleSourceData.mainContract = null; singleSourceData.financialSummary = null; }
    singleSourceData.downstreamContracts = safeDownstreamContracts.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ contractNo: item.contractNo, name: item.name, type: item.type, counterpartyName: item.counterpartyName, scope: item.scope ?? '', status: item.status, signedAt: dateText(item.signedAt), plannedEndDate: dateText(item.plannedEndDate), originalAmount: moneyValue(item.originalAmount), effectiveAmount: downstreamEffectiveByProject.get(item.id) ?? null }));
    singleSourceData.ownerReceivables = safeOwnerReceivables.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ receivableNo: item.receivableNo, type: item.type, title: item.title, status: item.status, grossAmount: moneyValue(item.grossAmount), netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
    singleSourceData.ownerReceipts = safeOwnerReceipts.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ receiptNo: item.receiptNo, type: item.type, amount: moneyValue(item.amount), receivedAt: dateText(item.receivedAt), referenceNo: item.referenceNo ?? '', notes: item.notes ?? '', originalReceiptNo: item.originalReceipt?.receiptNo ?? '' }));
    singleSourceData.actualCosts = safeActualCosts.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ date: dateText(item.date), type: item.type, description: item.description, amount: moneyValue(item.amount), taxAmount: item.taxAmount === null ? null : moneyValue(item.taxAmount), quantity: numberValue(item.quantity), unit: item.unit ?? '', vendorName: item.vendorName ?? '', budgetItemCode: item.budgetItem?.code ?? '', downstreamContractNo: item.downstreamContract?.contractNo ?? '' }));
    singleSourceData.changes = safeChanges.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ code: item.code, name: item.name, type: item.type, direction: item.direction, internalStatus: item.status, externalStatus: item.externalConfirmationStatus, submittedAmount: moneyValue(item.submittedAmount), confirmedAmount: item.externalConfirmedAmount === null ? null : moneyValue(item.externalConfirmedAmount), occurredAt: dateText(item.occurredAt), effectiveAt: dateText(item.effectiveAt) }));
    singleSourceData.progressBills = safeProgressBills.filter((item) => item.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ periodNo: item.periodNo, applyDate: dateText(item.applyDate), measureDate: dateText(item.measureDate), amount: moneyValue(item.amount), approvedAmount: item.approvedAmount === null ? null : moneyValue(item.approvedAmount), paidAmount: moneyValue(item.paidAmount), status: item.status, notes: item.notes ?? '' }));
    singleSourceData.downstreamPayables = safeDownstreamPayables.filter((item) => item.downstreamContract.projectId === projectId).slice(0, MAX_ROWS_PER_SOURCE).map((item) => ({ payableNo: item.payableNo, contractNo: item.downstreamContract.contractNo, contractName: item.downstreamContract.name, counterpartyName: item.downstreamContract.counterpartyName, type: item.type, netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
  } else {
    const summaries = scopedProjects.map((project) => summaryByProject.get(project.id)!).filter(Boolean);
    const sumOf = (key: string) => summaries.some((item) => item[key] === null || item[key] === undefined) ? null : sumMoney(summaries.map((item) => item[key]));
    singleSourceData.companySummary = {
      projectCount: scopedProjects.length, originalContractAmount: sumOf('originalContractAmount'), effectiveContractAmount: sumOf('effectiveContractAmount'), receiptTotal: sumOf('receiptTotal'), refundTotal: sumOf('refundTotal'), netReceipts: sumOf('netReceipts'), issuedReceivableNetAmount: sumOf('issuedReceivableNetAmount'), targetCostTotal: sumOf('targetCostTotal'), actualCostTotal: sumOf('actualCostTotal'), downstreamContractTotal: sumOf('downstreamContractTotal'), postedPayableTotal: sumOf('postedPayableTotal'),
    };
    singleSourceData.companyProjects = summaries.slice(0, MAX_ROWS_PER_SOURCE).map((s) => ({ code: s.code, name: s.name, status: s.status, managerName: s.managerName, ownerName: s.ownerName, startDate: s.startDate, plannedEndDate: s.plannedEndDate, originalContractAmount: s.originalContractAmount, effectiveContractAmount: s.effectiveContractAmount, netReceipts: s.netReceipts, issuedReceivableNetAmount: s.issuedReceivableNetAmount, targetCostTotal: s.targetCostTotal, actualCostTotal: s.actualCostTotal, downstreamContractTotal: s.downstreamContractTotal, postedPayableTotal: s.postedPayableTotal }));
    singleSourceData.companyDownstreamContracts = safeDownstreamContracts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, contractNo: item.contractNo, name: item.name, type: item.type, counterpartyName: item.counterpartyName, status: item.status, signedAt: dateText(item.signedAt), originalAmount: moneyValue(item.originalAmount), effectiveAmount: downstreamEffectiveByProject.get(item.id) ?? null }));
    singleSourceData.companyOwnerReceivables = safeOwnerReceivables.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, receivableNo: item.receivableNo, type: item.type, title: item.title, status: item.status, grossAmount: moneyValue(item.grossAmount), netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
    singleSourceData.companyOwnerReceipts = safeOwnerReceipts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, receiptNo: item.receiptNo, type: item.type, amount: moneyValue(item.amount), receivedAt: dateText(item.receivedAt), referenceNo: item.referenceNo ?? '', notes: item.notes ?? '', originalReceiptNo: item.originalReceipt?.receiptNo ?? '' }));
    singleSourceData.companyActualCosts = safeActualCosts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, date: dateText(item.date), type: item.type, description: item.description, amount: moneyValue(item.amount), taxAmount: item.taxAmount === null ? null : moneyValue(item.taxAmount), quantity: numberValue(item.quantity), unit: item.unit ?? '', vendorName: item.vendorName ?? '', budgetItemCode: item.budgetItem?.code ?? '', downstreamContractNo: item.downstreamContract?.contractNo ?? '' }));
    singleSourceData.companyChanges = safeChanges.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, code: item.code, name: item.name, type: item.type, direction: item.direction, internalStatus: item.status, externalStatus: item.externalConfirmationStatus, submittedAmount: moneyValue(item.submittedAmount), confirmedAmount: item.externalConfirmedAmount === null ? null : moneyValue(item.externalConfirmedAmount), occurredAt: dateText(item.occurredAt), effectiveAt: dateText(item.effectiveAt) }));
    singleSourceData.companyProgressBills = safeProgressBills.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, periodNo: item.periodNo, applyDate: dateText(item.applyDate), measureDate: dateText(item.measureDate), amount: moneyValue(item.amount), approvedAmount: item.approvedAmount === null ? null : moneyValue(item.approvedAmount), paidAmount: moneyValue(item.paidAmount), status: item.status, notes: item.notes ?? '' }));
    singleSourceData.companyDownstreamPayables = safeDownstreamPayables.map((item) => ({ projectCode: item.downstreamContract.project.code, projectName: item.downstreamContract.project.name, payableNo: item.payableNo, contractNo: item.downstreamContract.contractNo, contractName: item.downstreamContract.name, counterpartyName: item.downstreamContract.counterpartyName, type: item.type, netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
  }

  return {
    domain, generatedAt: new Date().toISOString(), projectId: projectId ?? null, accessibleProjectCount: accessibleProjects.length,
    sources: singleSourceData, warnings, truncated: Object.values(truncation).some(Boolean) || (domain === 'COMPANY' && scopedProjects.length > MAX_ROWS_PER_SOURCE),
  };
}
