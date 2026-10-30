import type { AuthUser } from './auth.js';
import { hasCrossProjectReadScope } from './project-data-scope.js';
import { ReportStudioDomain, ReportStudioDataset, dateText, moneyValue, numberValue, sumMoney, plusMoney, subtractMoney, MAX_ROWS_PER_SOURCE } from './report-studio-sources.js';
import { prisma } from './prisma.js';
import { loadBusinessPartyReportDataset } from './report-studio-party-dataset.js';
import { calculateDownstreamCurrentAmount } from './downstream-contract-math.js';
import { calculateEffectiveContractAmount } from './contract-amount-math.js';
import { summarizeDownstreamPaymentTotals } from './report-studio-payment-summary.js';

export { reportStudioSources, ReportStudioDomain, ReportStudioFieldType, ReportStudioField, ReportStudioSource, ReportStudioDataset } from './report-studio-sources.js';

export async function loadReportStudioDataset(user: AuthUser, domain: ReportStudioDomain, projectId?: string, businessPartyId?: string): Promise<ReportStudioDataset> {
  if (domain === 'PARTY') return loadBusinessPartyReportDataset(user, businessPartyId);
  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const projectScope = { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) };
  if (domain === 'PROJECT' && !projectId) throw Object.assign(new Error('项目级报表必须指定项目'), { statusCode: 400, code: 'PROJECT_ID_REQUIRED' });
  const [accessibleProjectCount, accessibleProjects, selectedProject] = await Promise.all([
    prisma.project.count({ where: projectScope }),
    domain === 'COMPANY'
      ? prisma.project.findMany({
          where: projectScope,
          select: {
            id: true, name: true, code: true, type: true, ownerName: true, managerName: true,
            status: true, address: true, startDate: true, plannedEndDate: true,
            originalContractAmount: true, contractAmount: true,
          },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }).then((projects) => projects.map((project) => ({ ...project, mainContract: null })))
      : Promise.resolve([]),
    projectId
      ? prisma.project.findFirst({
          where: { ...projectScope, id: projectId },
          select: {
            id: true, name: true, code: true, type: true, ownerName: true, managerName: true,
            status: true, address: true, startDate: true, plannedEndDate: true,
            originalContractAmount: true, contractAmount: true,
            mainContract: {
              select: {
                contractNo: true, name: true, signedAt: true, amount: true, taxIncluded: true,
                retentionRate: true, advanceDeductionRate: true, paymentTerms: true, guaranteeEndAt: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);
  if (projectId && !selectedProject) throw Object.assign(new Error('你没有访问该项目报表的权限'), { statusCode: 403, code: 'PROJECT_ACCESS_DENIED' });
  const scopedProjects = domain === 'PROJECT' ? (selectedProject ? [selectedProject] : []) : accessibleProjects;
  // Apply project authorization and report scope through relational filters instead of
  // expanding every accessible project ID into each query's bind parameters.
  const selectedProjectScope = { ...projectScope, ...(domain === 'PROJECT' && projectId ? { id: projectId } : {}) };
  const projectFilter = { project: selectedProjectScope };
  const warnings: string[] = [];
  const truncationNotices: NonNullable<ReportStudioDataset['truncationNotices']> = [];
  const truncatedSources = new Set<string>();
  const truncatedFieldsBySource = new Map<string, Set<string>>();
  if (domain === 'COMPANY' && scopedProjects.length > MAX_ROWS_PER_SOURCE) {
    const message = `当前账号可访问项目超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 个，公司项目明细列表会截断；公司汇总范围仍依据权限内项目计算。`;
    warnings.push(message);
    truncatedSources.add('companyProjects');
    truncationNotices.push({ sourceIds: ['companyProjects'], message });
  }
  if (scopedProjects.length === 0) warnings.push('当前账号没有可访问项目，因此仅能生成空数据模板。');

  const [changes, downstreamContracts, ownerReceivables, ownerReceipts, actualCosts, progressBills, downstreamPayables, downstreamPayments, budgetItems] = await Promise.all([
    prisma.change.findMany({ where: { ...projectFilter, deletedAt: null, externalConfirmationStatus: 'EFFECTIVE' }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ occurredAt: 'asc' }, { code: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.downstreamContract.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } }, adjustments: { orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }] } }, orderBy: [{ project: { code: 'asc' } }, { contractNo: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.ownerReceivable.findMany({ where: { ...projectFilter, status: { not: 'VOID' } }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { postedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.ownerReceipt.findMany({ where: projectFilter, include: { project: { select: { code: true, name: true } }, originalReceipt: { select: { receiptNo: true } } }, orderBy: [{ project: { code: 'asc' } }, { receivedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.costEntry.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } }, budgetItem: { select: { code: true } }, downstreamContract: { select: { contractNo: true } } }, orderBy: [{ project: { code: 'asc' } }, { date: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.progressBill.findMany({ where: { ...projectFilter, deletedAt: null }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ project: { code: 'asc' } }, { periodNo: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.downstreamPayable.findMany({ where: { downstreamContract: { project: selectedProjectScope, deletedAt: null } }, include: { downstreamContract: { select: { projectId: true, contractNo: true, name: true, counterpartyName: true, project: { select: { code: true, name: true } } } } }, orderBy: [{ downstreamContract: { project: { code: 'asc' } } }, { downstreamContract: { contractNo: 'asc' } }, { postedAt: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.downstreamContractPayment.findMany({
      where: { downstreamContract: { project: selectedProjectScope, deletedAt: null } },
      include: {
        downstreamContract: { select: { projectId: true, contractNo: true, project: { select: { code: true, name: true } } } },
        refundOfPayment: { select: { referenceNo: true, paidAt: true, type: true } },
      },
      orderBy: [{ downstreamContract: { project: { code: 'asc' } } }, { downstreamContract: { contractNo: 'asc' } }, { paidAt: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS_PER_SOURCE + 1,
    }),
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
    downstreamPayments: downstreamPayments.length > MAX_ROWS_PER_SOURCE,
    budgetItems: budgetItems.length > MAX_ROWS_PER_SOURCE * 10,
  };
  const directSourceIds: Record<keyof typeof truncation, string | null> = domain === 'PROJECT'
    ? {
        changes: 'changes',
        downstreamContracts: 'downstreamContracts',
        ownerReceivables: 'ownerReceivables',
        ownerReceipts: 'ownerReceipts',
        actualCosts: 'actualCosts',
        progressBills: 'progressBills',
        downstreamPayables: 'downstreamPayables',
        downstreamPayments: 'downstreamPayments',
        budgetItems: null,
      }
    : {
        changes: 'companyChanges',
        downstreamContracts: 'companyDownstreamContracts',
        ownerReceivables: 'companyOwnerReceivables',
        ownerReceipts: 'companyOwnerReceipts',
        actualCosts: 'companyActualCosts',
        progressBills: 'companyProgressBills',
        downstreamPayables: 'companyDownstreamPayables',
        downstreamPayments: 'companyDownstreamPayments',
        budgetItems: null,
      };
  const affectedFieldsByKey: Record<keyof typeof truncation, Array<{ sourceId: string; fieldIds: string[] }>> = domain === 'PROJECT'
    ? {
        changes: [
          { sourceId: 'project', fieldIds: ['effectiveContractAmount'] },
          { sourceId: 'financialSummary', fieldIds: ['effectiveContractAmount', 'activeChangeCount'] },
        ],
        downstreamContracts: [{ sourceId: 'financialSummary', fieldIds: ['downstreamContractTotal', 'downstreamContractCount'] }],
        ownerReceivables: [{ sourceId: 'financialSummary', fieldIds: ['issuedReceivableNetAmount'] }],
        ownerReceipts: [{ sourceId: 'financialSummary', fieldIds: ['receiptTotal', 'refundTotal', 'netReceipts', 'ownerReceiptCount'] }],
        actualCosts: [{ sourceId: 'financialSummary', fieldIds: ['actualCostTotal'] }],
        progressBills: [],
        downstreamPayables: [{ sourceId: 'financialSummary', fieldIds: ['postedPayableTotal'] }],
        downstreamPayments: [{ sourceId: 'financialSummary', fieldIds: ['downstreamPaymentTotal', 'downstreamRefundTotal', 'downstreamNetPaymentTotal'] }],
        budgetItems: [{ sourceId: 'financialSummary', fieldIds: ['targetCostTotal'] }],
      }
    : {
        changes: [
          { sourceId: 'companySummary', fieldIds: ['effectiveContractAmount'] },
          { sourceId: 'companyProjects', fieldIds: ['effectiveContractAmount'] },
        ],
        downstreamContracts: [
          { sourceId: 'companySummary', fieldIds: ['downstreamContractTotal'] },
          { sourceId: 'companyProjects', fieldIds: ['downstreamContractTotal'] },
        ],
        ownerReceivables: [
          { sourceId: 'companySummary', fieldIds: ['issuedReceivableNetAmount'] },
          { sourceId: 'companyProjects', fieldIds: ['issuedReceivableNetAmount'] },
        ],
        ownerReceipts: [
          { sourceId: 'companySummary', fieldIds: ['receiptTotal', 'refundTotal', 'netReceipts'] },
          { sourceId: 'companyProjects', fieldIds: ['netReceipts'] },
        ],
        actualCosts: [
          { sourceId: 'companySummary', fieldIds: ['actualCostTotal'] },
          { sourceId: 'companyProjects', fieldIds: ['actualCostTotal'] },
        ],
        progressBills: [],
        downstreamPayables: [
          { sourceId: 'companySummary', fieldIds: ['postedPayableTotal'] },
          { sourceId: 'companyProjects', fieldIds: ['postedPayableTotal'] },
        ],
        downstreamPayments: [
          { sourceId: 'companySummary', fieldIds: ['downstreamPaymentTotal', 'downstreamRefundTotal', 'downstreamNetPaymentTotal'] },
          { sourceId: 'companyProjects', fieldIds: ['downstreamPaymentTotal', 'downstreamRefundTotal', 'downstreamNetPaymentTotal'] },
        ],
        budgetItems: [
          { sourceId: 'companySummary', fieldIds: ['targetCostTotal'] },
          { sourceId: 'companyProjects', fieldIds: ['targetCostTotal'] },
        ],
      };
  const safeChanges = changes.slice(0, MAX_ROWS_PER_SOURCE);
  const safeDownstreamContracts = downstreamContracts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeOwnerReceivables = ownerReceivables.slice(0, MAX_ROWS_PER_SOURCE);
  const safeOwnerReceipts = ownerReceipts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeActualCosts = actualCosts.slice(0, MAX_ROWS_PER_SOURCE);
  const safeProgressBills = progressBills.slice(0, MAX_ROWS_PER_SOURCE);
  const safeDownstreamPayables = downstreamPayables.slice(0, MAX_ROWS_PER_SOURCE);
  const safeDownstreamPayments = downstreamPayments.slice(0, MAX_ROWS_PER_SOURCE);
  const safeBudgetItems = budgetItems.slice(0, MAX_ROWS_PER_SOURCE * 10);
  const labels: Array<[keyof typeof truncation, string, number]> = [
    ['changes', '变更签证', MAX_ROWS_PER_SOURCE], ['downstreamContracts', '分供合同', MAX_ROWS_PER_SOURCE],
    ['ownerReceivables', '业主应收', MAX_ROWS_PER_SOURCE], ['ownerReceipts', '收退款流水', MAX_ROWS_PER_SOURCE],
    ['actualCosts', '实际成本', MAX_ROWS_PER_SOURCE], ['progressBills', '进度款', MAX_ROWS_PER_SOURCE],
    ['downstreamPayables', '分供应付', MAX_ROWS_PER_SOURCE], ['downstreamPayments', '分供付款/退款流水', MAX_ROWS_PER_SOURCE],
    ['budgetItems', '目标成本清单', MAX_ROWS_PER_SOURCE * 10],
  ];
  for (const [key, label, limit] of labels) {
    if (!truncation[key]) continue;
    const affectedFields = affectedFieldsByKey[key];
    const impactText = affectedFields.length > 0
      ? '依赖该数据源的相关汇总字段将显示为空，不会把部分数据伪装为完整财务总额。'
      : '对应明细仅显示已读取的前置记录。';
    const message = `${label}超过 ${limit.toLocaleString('zh-CN')} 条，明细已截断；${impactText}请缩小项目范围或查询条件后重新生成。`;
    warnings.push(message);
    const directSourceId = directSourceIds[key];
    if (directSourceId) truncatedSources.add(directSourceId);
    for (const { sourceId, fieldIds } of affectedFields) {
      const fields = truncatedFieldsBySource.get(sourceId) ?? new Set<string>();
      fieldIds.forEach((fieldId) => fields.add(fieldId));
      truncatedFieldsBySource.set(sourceId, fields);
    }
    truncationNotices.push({
      sourceIds: directSourceId ? [directSourceId] : [],
      fields: affectedFields,
      message,
    });
  }
  const parentIds = new Set(safeBudgetItems.map((item) => item.parentId).filter((id): id is string => Boolean(id)));
  const leafBudgetByProject = new Map<string, string>();
  for (const item of safeBudgetItems) if (!parentIds.has(item.id)) leafBudgetByProject.set(item.projectId, plusMoney(leafBudgetByProject.get(item.projectId) ?? '0.00', item.totalPrice));

  const groupByProject = <T,>(rows: T[], projectIdOf: (row: T) => string): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const projectId = projectIdOf(row);
      const bucket = grouped.get(projectId) ?? [];
      bucket.push(row);
      grouped.set(projectId, bucket);
    }
    return grouped;
  };
  const changesByProject = groupByProject(safeChanges, (item) => item.projectId);
  const downstreamContractsByProject = groupByProject(safeDownstreamContracts, (item) => item.projectId);
  const ownerReceivablesByProject = groupByProject(safeOwnerReceivables, (item) => item.projectId);
  const ownerReceiptsByProject = groupByProject(safeOwnerReceipts, (item) => item.projectId);
  const actualCostsByProject = groupByProject(safeActualCosts, (item) => item.projectId);
  const downstreamPayablesByProject = groupByProject(safeDownstreamPayables, (item) => item.downstreamContract.projectId);
  const downstreamPaymentsByProject = groupByProject(safeDownstreamPayments, (item) => item.downstreamContract.projectId);
  const summaryByProject = new Map<string, Record<string, unknown>>();
  const downstreamEffectiveByProject = new Map<string, string | null>();
  for (const project of scopedProjects) {
    const projectChanges = changesByProject.get(project.id) ?? [];
    const missingEffectiveAmounts = projectChanges.some((item) => item.externalConfirmedAmount === null);
    let effectiveAmount: string | null = truncation.changes || missingEffectiveAmounts ? null : moneyValue(project.originalContractAmount);
    if (missingEffectiveAmounts) warnings.push(`项目 ${project.code} 存在外部状态已生效但未记录确认金额的变更，当前有效合同额未计算。`);
    if (!truncation.changes && !missingEffectiveAmounts) { try { effectiveAmount = calculateEffectiveContractAmount(project.originalContractAmount, projectChanges.map((item) => ({ direction: item.direction, amount: item.externalConfirmedAmount! }))); } catch { effectiveAmount = null; warnings.push(`项目 ${project.code} 的有效合同额计算失败，请核对已生效外部确认调整。`); } }
    const projectDownstream = downstreamContractsByProject.get(project.id) ?? [];
    for (const item of projectDownstream) {
      try { downstreamEffectiveByProject.set(item.id, calculateDownstreamCurrentAmount(item.originalAmount, item.adjustments)); }
      catch { downstreamEffectiveByProject.set(item.id, null); warnings.push(`分供合同 ${item.contractNo} 的当前合同额计算失败。`); }
    }
    const downstreamValues = projectDownstream.map((item) => downstreamEffectiveByProject.get(item.id) ?? null);
    const downstreamAmount = truncation.downstreamContracts || downstreamValues.some((value) => value === null) ? null : sumMoney(downstreamValues);
    const receipts = ownerReceiptsByProject.get(project.id) ?? [];
    const receiptTotal = truncation.ownerReceipts ? null : sumMoney(receipts.filter((item) => item.type === 'RECEIPT').map((item) => item.amount));
    const refundTotal = truncation.ownerReceipts ? null : sumMoney(receipts.filter((item) => item.type === 'REFUND').map((item) => item.amount));
    const projectCosts = actualCostsByProject.get(project.id) ?? [];
    const actualCostTotal = truncation.actualCosts ? null : sumMoney(projectCosts.map((item) => item.amount));
    const projectReceivables = ownerReceivablesByProject.get(project.id) ?? [];
    const issuedReceivableNetAmount = truncation.ownerReceivables ? null : sumMoney(projectReceivables.map((item) => item.netAmount));
    const projectPayables = downstreamPayablesByProject.get(project.id) ?? [];
    const postedPayableTotal = truncation.downstreamPayables ? null : sumMoney(projectPayables.map((item) => item.netAmount));
    const projectPayments = downstreamPaymentsByProject.get(project.id) ?? [];
    const paymentTotals = summarizeDownstreamPaymentTotals(projectPayments, truncation.downstreamPayments);
    const { downstreamPaymentTotal, downstreamRefundTotal, downstreamNetPaymentTotal } = paymentTotals;
    summaryByProject.set(project.id, {
      id: project.id, code: project.code, name: project.name, type: project.type, ownerName: project.ownerName, managerName: project.managerName ?? '', status: project.status, address: project.address ?? '', startDate: dateText(project.startDate), plannedEndDate: dateText(project.plannedEndDate),
      originalContractAmount: moneyValue(project.originalContractAmount), effectiveContractAmount: effectiveAmount,
      receiptTotal, refundTotal, netReceipts: receiptTotal === null || refundTotal === null ? null : subtractMoney(receiptTotal, refundTotal), issuedReceivableNetAmount,
      targetCostTotal: truncation.budgetItems ? null : leafBudgetByProject.get(project.id) ?? '0.00', actualCostTotal, downstreamContractTotal: downstreamAmount, postedPayableTotal,
      downstreamPaymentTotal, downstreamRefundTotal, downstreamNetPaymentTotal,
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
    singleSourceData.downstreamPayments = safeDownstreamPayments.filter((item) => item.downstreamContract.projectId === projectId).map((item) => ({
      contractNo: item.downstreamContract.contractNo, type: item.type, amount: moneyValue(item.amount), paidAt: dateText(item.paidAt),
      referenceNo: item.referenceNo ?? '', originalReferenceNo: item.refundOfPayment?.referenceNo ?? '',
    }));
  } else {
    const summaries = scopedProjects.map((project) => summaryByProject.get(project.id)!).filter(Boolean);
    const sumOf = (key: string) => summaries.some((item) => item[key] === null || item[key] === undefined) ? null : sumMoney(summaries.map((item) => item[key]));
    singleSourceData.companySummary = {
      projectCount: scopedProjects.length, originalContractAmount: sumOf('originalContractAmount'), effectiveContractAmount: sumOf('effectiveContractAmount'), receiptTotal: sumOf('receiptTotal'), refundTotal: sumOf('refundTotal'), netReceipts: sumOf('netReceipts'), issuedReceivableNetAmount: sumOf('issuedReceivableNetAmount'), targetCostTotal: sumOf('targetCostTotal'), actualCostTotal: sumOf('actualCostTotal'), downstreamContractTotal: sumOf('downstreamContractTotal'), postedPayableTotal: sumOf('postedPayableTotal'), downstreamPaymentTotal: sumOf('downstreamPaymentTotal'), downstreamRefundTotal: sumOf('downstreamRefundTotal'), downstreamNetPaymentTotal: sumOf('downstreamNetPaymentTotal'),
    };
    singleSourceData.companyProjects = summaries.slice(0, MAX_ROWS_PER_SOURCE).map((s) => ({ code: s.code, name: s.name, status: s.status, managerName: s.managerName, ownerName: s.ownerName, startDate: s.startDate, plannedEndDate: s.plannedEndDate, originalContractAmount: s.originalContractAmount, effectiveContractAmount: s.effectiveContractAmount, netReceipts: s.netReceipts, issuedReceivableNetAmount: s.issuedReceivableNetAmount, targetCostTotal: s.targetCostTotal, actualCostTotal: s.actualCostTotal, downstreamContractTotal: s.downstreamContractTotal, postedPayableTotal: s.postedPayableTotal, downstreamPaymentTotal: s.downstreamPaymentTotal, downstreamRefundTotal: s.downstreamRefundTotal, downstreamNetPaymentTotal: s.downstreamNetPaymentTotal }));
    singleSourceData.companyDownstreamContracts = safeDownstreamContracts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, contractNo: item.contractNo, name: item.name, type: item.type, counterpartyName: item.counterpartyName, status: item.status, signedAt: dateText(item.signedAt), originalAmount: moneyValue(item.originalAmount), effectiveAmount: downstreamEffectiveByProject.get(item.id) ?? null }));
    singleSourceData.companyOwnerReceivables = safeOwnerReceivables.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, receivableNo: item.receivableNo, type: item.type, title: item.title, status: item.status, grossAmount: moneyValue(item.grossAmount), netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
    singleSourceData.companyOwnerReceipts = safeOwnerReceipts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, receiptNo: item.receiptNo, type: item.type, amount: moneyValue(item.amount), receivedAt: dateText(item.receivedAt), referenceNo: item.referenceNo ?? '', notes: item.notes ?? '', originalReceiptNo: item.originalReceipt?.receiptNo ?? '' }));
    singleSourceData.companyActualCosts = safeActualCosts.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, date: dateText(item.date), type: item.type, description: item.description, amount: moneyValue(item.amount), taxAmount: item.taxAmount === null ? null : moneyValue(item.taxAmount), quantity: numberValue(item.quantity), unit: item.unit ?? '', vendorName: item.vendorName ?? '', budgetItemCode: item.budgetItem?.code ?? '', downstreamContractNo: item.downstreamContract?.contractNo ?? '' }));
    singleSourceData.companyChanges = safeChanges.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, code: item.code, name: item.name, type: item.type, direction: item.direction, internalStatus: item.status, externalStatus: item.externalConfirmationStatus, submittedAmount: moneyValue(item.submittedAmount), confirmedAmount: item.externalConfirmedAmount === null ? null : moneyValue(item.externalConfirmedAmount), occurredAt: dateText(item.occurredAt), effectiveAt: dateText(item.effectiveAt) }));
    singleSourceData.companyProgressBills = safeProgressBills.map((item) => ({ projectCode: item.project.code, projectName: item.project.name, periodNo: item.periodNo, applyDate: dateText(item.applyDate), measureDate: dateText(item.measureDate), amount: moneyValue(item.amount), approvedAmount: item.approvedAmount === null ? null : moneyValue(item.approvedAmount), paidAmount: moneyValue(item.paidAmount), status: item.status, notes: item.notes ?? '' }));
    singleSourceData.companyDownstreamPayables = safeDownstreamPayables.map((item) => ({ projectCode: item.downstreamContract.project.code, projectName: item.downstreamContract.project.name, payableNo: item.payableNo, contractNo: item.downstreamContract.contractNo, contractName: item.downstreamContract.name, counterpartyName: item.downstreamContract.counterpartyName, type: item.type, netAmount: moneyValue(item.netAmount), dueAt: dateText(item.dueAt), postedAt: dateText(item.postedAt) }));
    singleSourceData.companyDownstreamPayments = safeDownstreamPayments.map((item) => ({
      projectCode: item.downstreamContract.project.code, projectName: item.downstreamContract.project.name,
      contractNo: item.downstreamContract.contractNo, type: item.type, amount: moneyValue(item.amount),
      paidAt: dateText(item.paidAt), referenceNo: item.referenceNo ?? '', originalReferenceNo: item.refundOfPayment?.referenceNo ?? '',
    }));
  }

  const truncatedFields = [...truncatedFieldsBySource.entries()].map(([sourceId, fieldIds]) => ({ sourceId, fieldIds: [...fieldIds] }));

  return {
    domain, generatedAt: new Date().toISOString(), projectId: projectId ?? null, accessibleProjectCount,
    sources: singleSourceData, warnings,
    truncated: truncatedSources.size > 0 || truncatedFields.length > 0,
    truncatedSources: [...truncatedSources], truncatedFields, truncationNotices,
  };
}
