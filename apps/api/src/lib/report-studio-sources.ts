import { centsToMoney, moneyToCents } from './contract-amount-math.js';

export type ReportStudioDomain = 'PROJECT' | 'COMPANY' | 'PARTY';
export type ReportStudioFieldType = 'TEXT' | 'NUMBER' | 'MONEY' | 'DATE' | 'BOOLEAN';
export interface ReportStudioField { id: string; label: string; type: ReportStudioFieldType; description?: string }
export interface ReportStudioSource { id: string; label: string; cardinality: 'ONE' | 'MANY'; domains: ReportStudioDomain[]; description: string; fields: ReportStudioField[] }

export const projectDomains: ReportStudioDomain[] = ['PROJECT'];
export const bothDomains: ReportStudioDomain[] = ['PROJECT', 'COMPANY'];
export const partyDomain: ReportStudioDomain[] = ['PARTY'];
export const txt = (id: string, label: string, description?: string): ReportStudioField => ({ id, label, type: 'TEXT', ...(description ? { description } : {}) });
export const money = (id: string, label: string, description?: string): ReportStudioField => ({ id, label, type: 'MONEY', ...(description ? { description } : {}) });
export const num = (id: string, label: string): ReportStudioField => ({ id, label, type: 'NUMBER' });
export const date = (id: string, label: string): ReportStudioField => ({ id, label, type: 'DATE' });

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
    money('effectiveContractAmount', '当前有效合同额'), money('receiptTotal', '累计登记收款'), money('refundTotal', '累计登记退款'), money('netReceipts', '累计登记净收款', '收款减退款，不含预付款相关流水。'), money('issuedReceivableNetAmount', '登记净应收合计', '未作废应收单的净应收额之和，不等于未收余额。'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'), money('downstreamPaymentTotal', '累计分供付款'), money('downstreamRefundTotal', '累计分供退款'), money('downstreamNetPaymentTotal', '累计分供净支付', '累计分供付款减退款；不等同于已过账应付或实际成本。'), num('downstreamContractCount', '分供合同数量'), num('ownerReceiptCount', '业主收退款流水数量'), num('activeChangeCount', '已生效外部确认变更数量'),
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
  { id: 'downstreamPayments', label: '分供实际付款与退款流水', cardinality: 'MANY', domains: projectDomains, description: '合同现金支付/退款流水；不等同于应付过账或实际成本。退款保留与原付款的关联。', fields: [
    txt('contractNo', '分供合同编号'), txt('type', '流水类型'), money('amount', '支付/退款金额'), date('paidAt', '支付日期'), txt('referenceNo', '支付参考号'), txt('originalReferenceNo', '原付款参考号'),
  ] },
  { id: 'companySummary', label: '公司经营指标', cardinality: 'ONE', domains: ['COMPANY'], description: '仅汇总当前账号有权访问的项目；管理员可查看全部项目。', fields: [
    num('projectCount', '可访问项目数'), money('originalContractAmount', '原始合同基线金额合计'), money('effectiveContractAmount', '当前有效合同额合计'), money('receiptTotal', '累计登记收款'), money('refundTotal', '累计登记退款'), money('netReceipts', '累计登记净收款'), money('issuedReceivableNetAmount', '登记净应收合计'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'), money('downstreamPaymentTotal', '累计分供付款'), money('downstreamRefundTotal', '累计分供退款'), money('downstreamNetPaymentTotal', '累计分供净支付'),
  ] },
  { id: 'companyProjects', label: '公司项目清单', cardinality: 'MANY', domains: ['COMPANY'], description: '每个可访问项目一行，可用于公司级横向比较。', fields: [
    txt('code', '项目编号'), txt('name', '项目名称'), txt('status', '项目状态'), txt('managerName', '项目负责人'), txt('ownerName', '业主名称'), date('startDate', '开工日期'), date('plannedEndDate', '计划竣工日期'), money('originalContractAmount', '原始合同基线金额'), money('effectiveContractAmount', '当前有效合同额'), money('netReceipts', '累计登记净收款'), money('issuedReceivableNetAmount', '登记净应收合计'), money('targetCostTotal', '末级目标成本合计'), money('actualCostTotal', '已录入实际成本合计'), money('downstreamContractTotal', '分供合同当前金额合计'), money('postedPayableTotal', '已登记净应付合计'), money('downstreamPaymentTotal', '累计分供付款'), money('downstreamRefundTotal', '累计分供退款'), money('downstreamNetPaymentTotal', '累计分供净支付'),
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
  { id: 'companyDownstreamPayments', label: '公司分供付款与退款流水', cardinality: 'MANY', domains: ['COMPANY'], description: '跨可访问项目的分供现金支付/退款流水；不得与应付台账或实际成本混算。', fields: [
    txt('projectCode', '项目编号'), txt('projectName', '项目名称'), txt('contractNo', '分供合同编号'), txt('type', '流水类型'), money('amount', '支付/退款金额'), date('paidAt', '支付日期'), txt('referenceNo', '支付参考号'), txt('originalReferenceNo', '原付款参考号'),
  ] },
  { id: 'businessParty', label: '往来单位档案', cardinality: 'ONE', domains: partyDomain, description: '当前单位的公司级主数据；跨项目金额只计算当前用户有权访问的项目。', fields: [
    txt('id', '系统档案 ID', '用于追溯单位档案，不是统一社会信用代码。'), txt('name', '单位名称'), txt('creditCode', '统一社会信用代码'), txt('roles', '业务角色'), txt('status', '档案状态'), txt('identityVerified', '主体核验状态'), txt('formerNames', '历史名称'), txt('legalRepresentative', '法定代表人'), txt('address', '地址'), txt('contactName', '联系人'), txt('phone', '联系电话'), txt('email', '电子邮箱'), txt('taxNo', '纳税人识别号'), txt('invoiceTitle', '发票抬头'), txt('notes', '备注'), date('updatedAt', '最近更新日期'),
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
  /** Stable source IDs whose detail rows are incomplete as collections. */
  truncatedSources?: string[];
  /** Specific scalar fields whose values may be incomplete because a source query was capped. */
  truncatedFields?: Array<{ sourceId: string; fieldIds: string[] }>;
  /** Human-readable truncation warnings tied to affected collections or scalar fields. */
  truncationNotices?: Array<{
    sourceIds: string[];
    fields?: Array<{ sourceId: string; fieldIds: string[] }>;
    message: string;
  }>;
}

export function dateText(value: Date | null | undefined): string | null { return value ? value.toISOString().slice(0, 10) : null; }
export function moneyValue(value: unknown): string { return centsToMoney(moneyToCents(value ?? '0')); }
export function numberValue(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
export function sumMoney(values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
export function plusMoney(...values: unknown[]): string { return sumMoney(values); }
export function subtractMoney(left: unknown, right: unknown): string { return centsToMoney(moneyToCents(left ?? '0') - moneyToCents(right ?? '0')); }
export const MAX_ROWS_PER_SOURCE = 10000;
