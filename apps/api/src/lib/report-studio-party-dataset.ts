import type { AuthUser } from './auth.js';
import { hasCrossProjectReadScope } from './project-data-scope.js';
import { ReportStudioDataset, dateText, moneyValue, MAX_ROWS_PER_SOURCE } from './report-studio-sources.js';
import { prisma } from './prisma.js';
import { centsToMoney, moneyToCents } from './contract-amount-math.js';
import { Prisma } from '../generated/prisma/client.js';

export function plainNumber(value: unknown): number { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
/** Money aggregation stays in integer cents; never sum PostgreSQL Decimal values through JS floating point. */
export function sumPartyMoney(values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
export function plusPartyMoney(...values: unknown[]): string { return centsToMoney(values.reduce<bigint>((total, value) => total + moneyToCents(value ?? '0'), 0n)); }
export function subtractPartyMoney(left: unknown, right: unknown): string { return centsToMoney(moneyToCents(left ?? '0') - moneyToCents(right ?? '0')); }
export function sumNumbers(values: unknown[]): number { return values.reduce<number>((total, value) => total + plainNumber(value), 0); }

/** Loads a party report from the same underlying relationships as the operating-profile page. */
export async function loadBusinessPartyReportDataset(user: AuthUser, businessPartyId?: string): Promise<ReportStudioDataset> {
  if (!businessPartyId) throw Object.assign(new Error('往来单位经营档案报表必须指定单位'), { statusCode: 400, code: 'BUSINESS_PARTY_ID_REQUIRED' });
  const party = await prisma.businessParty.findUnique({ where: { id: businessPartyId } });
  if (!party) throw Object.assign(new Error('往来单位档案不存在'), { statusCode: 404, code: 'BUSINESS_PARTY_NOT_FOUND' });
  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const projectScope = { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) };
  const ownedProjectScope = { ...projectScope, ownerPartyId: businessPartyId };
  const standaloneCostScope = { businessPartyId, downstreamContractId: null, deletedAt: null, project: projectScope };
  const [visibleProjectCount, ownedProjectsFetched, downstreamContractsFetched, standaloneCosts, standaloneCostTotalsFetched, standaloneCostAggregate] = await Promise.all([
    prisma.project.count({ where: projectScope }),
    prisma.project.findMany({
      where: ownedProjectScope,
      select: {
        id: true, code: true, name: true, status: true, contractAmount: true, originalContractAmount: true,
        mainContract: { select: { contractNo: true, name: true } },
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS_PER_SOURCE + 1,
    }),
    prisma.downstreamContract.findMany({ where: { counterpartyPartyId: businessPartyId, deletedAt: null, project: projectScope }, include: { project: { select: { id: true, name: true, code: true, status: true, ownerPartyId: true, contractAmount: true, originalContractAmount: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.costEntry.findMany({ where: standaloneCostScope, include: { project: { select: { id: true, name: true, code: true, status: true } } }, orderBy: [{ date: 'desc' }, { id: 'asc' }], take: 201 }),
    prisma.costEntry.groupBy({ by: ['projectId'], where: standaloneCostScope, _sum: { amount: true }, _count: { _all: true }, orderBy: { projectId: 'asc' }, take: MAX_ROWS_PER_SOURCE + 1 }),
    prisma.costEntry.aggregate({ where: standaloneCostScope, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const ownedProjectsTruncated = ownedProjectsFetched.length > MAX_ROWS_PER_SOURCE;
  const ownedProjects = ownedProjectsFetched.slice(0, MAX_ROWS_PER_SOURCE);
  const standaloneCostProjectGroupsTruncated = standaloneCostTotalsFetched.length > MAX_ROWS_PER_SOURCE;
  const standaloneCostTotals = standaloneCostTotalsFetched.slice(0, MAX_ROWS_PER_SOURCE);
  const [progressBillMetrics, changeMetrics, progressPaymentMetrics] = await Promise.all([
    prisma.progressBill.groupBy({
      by: ['projectId'],
      where: { deletedAt: null, project: ownedProjectScope },
      _count: { _all: true },
      _sum: { approvedAmount: true },
    }),
    prisma.change.groupBy({
      by: ['projectId'],
      where: { deletedAt: null, project: ownedProjectScope },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ projectId: string; paidAmount: string }>>(Prisma.sql`
      SELECT pb."projectId" AS "projectId",
             COALESCE(SUM(pp."amount"), 0)::text AS "paidAmount"
      FROM "ProgressPayment" AS pp
      INNER JOIN "ProgressBill" AS pb ON pb."id" = pp."progressBillId"
      INNER JOIN "Project" AS p ON p."id" = pb."projectId"
      WHERE pb."deletedAt" IS NULL
        AND p."deletedAt" IS NULL
        AND p."ownerPartyId" = ${businessPartyId}
        AND ${canReadAllProjects
          ? Prisma.sql`TRUE`
          : Prisma.sql`EXISTS (
              SELECT 1 FROM "ProjectMember" AS pm
              WHERE pm."projectId" = p."id" AND pm."userId" = ${user.sub}
            )`}
      GROUP BY pb."projectId"
    `),
  ]);
  const progressBillMetricsByProject = new Map(progressBillMetrics.map((row) => [row.projectId, {
    count: row._count._all,
    approvedAmount: moneyValue(row._sum.approvedAmount),
  }] as const));
  const changeCountByProject = new Map(changeMetrics.map((row) => [row.projectId, row._count._all] as const));
  const progressPaidByProject = new Map(progressPaymentMetrics.map((row) => [row.projectId, moneyValue(row.paidAmount)] as const));
  const downstreamContractsTruncated = downstreamContractsFetched.length > MAX_ROWS_PER_SOURCE;
  const downstreamContracts = downstreamContractsFetched.slice(0, MAX_ROWS_PER_SOURCE);
  const downstreamContractIds = downstreamContracts.map((contract) => contract.id);
  const [
    adjustmentMetrics,
    settlementMetrics,
    paymentMetrics,
    downstreamCostMetrics,
    invoiceMetrics,
    payableMetrics,
  ] = await Promise.all([
    prisma.downstreamContractAdjustment.groupBy({
      by: ['downstreamContractId', 'direction'],
      where: { downstreamContractId: { in: downstreamContractIds } },
      _sum: { amount: true },
    }),
    prisma.downstreamSettlementPosting.groupBy({
      by: ['downstreamContractId'],
      where: { downstreamContractId: { in: downstreamContractIds }, settlement: { status: 'POSTED' } },
      _sum: { deltaAmount: true },
    }),
    prisma.downstreamContractPayment.groupBy({
      by: ['downstreamContractId', 'type'],
      where: { downstreamContractId: { in: downstreamContractIds } },
      _sum: { amount: true },
    }),
    prisma.costEntry.groupBy({
      by: ['downstreamContractId'],
      where: { downstreamContractId: { in: downstreamContractIds }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.downstreamSupplierInvoice.groupBy({
      by: ['downstreamContractId', 'status'],
      where: { downstreamContractId: { in: downstreamContractIds } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    downstreamContractIds.length
      ? prisma.$queryRaw<Array<{ contractId: string; openPayableAmount: string; supplierCreditAmount: string }>>(Prisma.sql`
          SELECT payable."downstreamContractId" AS "contractId",
                 COALESCE(SUM(
                   CASE WHEN payable."netAmount" > 0
                     THEN GREATEST(payable."netAmount" - COALESCE(allocation_totals."allocatedAmount", 0), 0)
                     ELSE 0
                   END
                 ), 0)::text AS "openPayableAmount",
                 COALESCE(SUM(
                   CASE WHEN payable."netAmount" < 0 THEN ABS(payable."netAmount") ELSE 0 END
                 ), 0)::text AS "supplierCreditAmount"
          FROM "DownstreamPayable" AS payable
          LEFT JOIN (
            SELECT allocation."payableId", SUM(allocation."amount") AS "allocatedAmount"
            FROM "DownstreamPaymentAllocation" AS allocation
            INNER JOIN "DownstreamPayable" AS scoped_payable ON scoped_payable."id" = allocation."payableId"
            WHERE scoped_payable."downstreamContractId" IN (${Prisma.join(downstreamContractIds)})
            GROUP BY allocation."payableId"
          ) AS allocation_totals ON allocation_totals."payableId" = payable."id"
          WHERE payable."downstreamContractId" IN (${Prisma.join(downstreamContractIds)})
          GROUP BY payable."downstreamContractId"
        `)
      : Promise.resolve([] as Array<{ contractId: string; openPayableAmount: string; supplierCreditAmount: string }>),
  ]);
  const adjustmentsByContract = new Map<string, { increases: string; decreases: string }>();
  for (const row of adjustmentMetrics) {
    const amounts = adjustmentsByContract.get(row.downstreamContractId) ?? { increases: '0.00', decreases: '0.00' };
    if (row.direction === 'DECREASE') amounts.decreases = plusPartyMoney(amounts.decreases, row._sum.amount);
    else amounts.increases = plusPartyMoney(amounts.increases, row._sum.amount);
    adjustmentsByContract.set(row.downstreamContractId, amounts);
  }
  const settlementAmountByContract = new Map(settlementMetrics.map((row) => [row.downstreamContractId, moneyValue(row._sum.deltaAmount)] as const));
  const paymentAmountsByContract = new Map<string, { grossPaidAmount: string; refundedAmount: string }>();
  for (const row of paymentMetrics) {
    const amounts = paymentAmountsByContract.get(row.downstreamContractId) ?? { grossPaidAmount: '0.00', refundedAmount: '0.00' };
    if (row.type === 'REFUND') amounts.refundedAmount = plusPartyMoney(amounts.refundedAmount, row._sum.amount);
    else amounts.grossPaidAmount = plusPartyMoney(amounts.grossPaidAmount, row._sum.amount);
    paymentAmountsByContract.set(row.downstreamContractId, amounts);
  }
  const downstreamCostByContract = new Map(downstreamCostMetrics.map((row) => [row.downstreamContractId, moneyValue(row._sum.amount)] as const));
  const invoiceMetricsByContract = new Map<string, { amount: string; verifiedAmount: string; count: number }>();
  for (const row of invoiceMetrics) {
    const amounts = invoiceMetricsByContract.get(row.downstreamContractId) ?? { amount: '0.00', verifiedAmount: '0.00', count: 0 };
    amounts.amount = plusPartyMoney(amounts.amount, row._sum.amount);
    if (row.status === 'VERIFIED') amounts.verifiedAmount = plusPartyMoney(amounts.verifiedAmount, row._sum.amount);
    amounts.count += row._count._all;
    invoiceMetricsByContract.set(row.downstreamContractId, amounts);
  }
  const payableMetricsByContract = new Map(payableMetrics.map((row) => [row.contractId, {
    openPayableAmount: moneyValue(row.openPayableAmount),
    supplierCreditAmount: moneyValue(row.supplierCreditAmount),
  }] as const));
  if (user.role !== 'ADMIN' && !ownedProjects.length && !downstreamContracts.length && !standaloneCostTotals.length) {
    throw Object.assign(new Error('单位不存在，或当前账号无权查看其关联项目资料'), { statusCode: 404, code: 'BUSINESS_PARTY_NOT_FOUND' });
  }
  const projectMap = new Map<string, Record<string, unknown>>();
  const emptyProjectSummary = (project: {
    id: string; code: string; name: string; status: string;
    ownerPartyId?: string | null; contractAmount?: unknown; originalContractAmount?: unknown;
  }, fallbackRole: string): Record<string, unknown> => {
    const isOwner = project.ownerPartyId === businessPartyId;
    const billMetrics = progressBillMetricsByProject.get(project.id);
    return {
      id: project.id, code: project.code, name: project.name, status: project.status,
      role: isOwner ? 'OWNER' : fallbackRole,
      incomeContractAmount: isOwner ? moneyValue(project.contractAmount) : '0.00',
      incomePaidAmount: isOwner ? (progressPaidByProject.get(project.id) ?? '0.00') : '0.00',
      downstreamContractAmount: '0.00', downstreamPaidAmount: '0.00',
      downstreamActualCostAmount: '0.00', standaloneCostAmount: '0.00',
      downstreamContractCount: 0, incomeBillCount: isOwner ? (billMetrics?.count ?? 0) : 0,
    };
  };
  for (const project of ownedProjects) {
    const billMetrics = progressBillMetricsByProject.get(project.id);
    projectMap.set(project.id, {
      id: project.id, code: project.code, name: project.name, status: project.status, role: 'OWNER',
      incomeContractAmount: moneyValue(project.contractAmount),
      downstreamContractAmount: '0.00',
      incomePaidAmount: progressPaidByProject.get(project.id) ?? '0.00',
      downstreamPaidAmount: '0.00', downstreamActualCostAmount: '0.00', standaloneCostAmount: '0.00',
      downstreamContractCount: 0, incomeBillCount: billMetrics?.count ?? 0,
    });
  }
  const downstreamRows = downstreamContracts.map((contract) => {
    const adjustments = adjustmentsByContract.get(contract.id) ?? { increases: '0.00', decreases: '0.00' };
    const currentAmount = centsToMoney(moneyToCents(contract.originalAmount) + moneyToCents(adjustments.increases) - moneyToCents(adjustments.decreases));
    const settledAmount = settlementAmountByContract.get(contract.id) ?? '0.00';
    const paymentAmounts = paymentAmountsByContract.get(contract.id) ?? { grossPaidAmount: '0.00', refundedAmount: '0.00' };
    const paidAmount = subtractPartyMoney(paymentAmounts.grossPaidAmount, paymentAmounts.refundedAmount);
    const payable = payableMetricsByContract.get(contract.id) ?? { openPayableAmount: '0.00', supplierCreditAmount: '0.00' };
    const openPayableAmount = payable.openPayableAmount;
    const supplierCreditAmount = payable.supplierCreditAmount;
    const actualCostAmount = downstreamCostByContract.get(contract.id) ?? '0.00';
    const invoices = invoiceMetricsByContract.get(contract.id) ?? { amount: '0.00', verifiedAmount: '0.00', count: 0 };
    const invoiceAmount = invoices.amount;
    const verifiedInvoiceAmount = invoices.verifiedAmount;
    const existing = projectMap.get(contract.project.id) ?? emptyProjectSummary(contract.project, 'COUNTERPARTY');
    existing.downstreamContractCount = plainNumber(existing.downstreamContractCount) + 1;
    if (contract.status !== 'TERMINATED') existing.downstreamContractAmount = plusPartyMoney(existing.downstreamContractAmount, currentAmount);
    existing.downstreamPaidAmount = plusPartyMoney(existing.downstreamPaidAmount, paidAmount);
    existing.downstreamActualCostAmount = plusPartyMoney(existing.downstreamActualCostAmount, actualCostAmount);
    projectMap.set(contract.project.id, existing);
    return { id: contract.id, projectId: contract.projectId, projectCode: contract.project.code, projectName: contract.project.name, contractNo: contract.contractNo, name: contract.name, type: contract.type, status: contract.status, originalAmount: moneyValue(contract.originalAmount), currentAmount, settledAmount, paidAmount, openPayableAmount, supplierCreditAmount, actualCostAmount, invoiceAmount, verifiedInvoiceAmount, invoiceCount: invoices.count };
  });
  const projectIdsForCosts = standaloneCostTotals.map((row) => row.projectId);
  const costProjects = projectIdsForCosts.length ? await prisma.project.findMany({ where: { ...projectScope, id: { in: projectIdsForCosts } }, select: { id: true, code: true, name: true, status: true, ownerPartyId: true, contractAmount: true, originalContractAmount: true } }) : [];
  const costProjectById = new Map(costProjects.map((project) => [project.id, project] as const));
  for (const aggregate of standaloneCostTotals) {
    const project = costProjectById.get(aggregate.projectId);
    if (!project) continue;
    const existing = projectMap.get(project.id) ?? emptyProjectSummary(project, 'COST_PARTY');
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
  const mainContractRows = ownedProjects.filter((project) => project.mainContract).map((project) => {
    const billMetrics = progressBillMetricsByProject.get(project.id);
    return {
      projectCode: project.code, projectName: project.name, contractNo: project.mainContract!.contractNo,
      name: project.mainContract!.name, status: project.status,
      originalAmount: moneyValue(project.originalContractAmount), currentAmount: moneyValue(project.contractAmount),
      approvedAmount: billMetrics?.approvedAmount ?? '0.00',
      paidAmount: progressPaidByProject.get(project.id) ?? '0.00',
      progressBillCount: billMetrics?.count ?? 0,
      changeCount: changeCountByProject.get(project.id) ?? 0,
    };
  });
  const partyProjectsListTruncated = ownedProjectsTruncated || standaloneCostProjectGroupsTruncated || projectRows.length > MAX_ROWS_PER_SOURCE;
  const partyMainContractsTruncated = ownedProjectsTruncated || mainContractRows.length > MAX_ROWS_PER_SOURCE;
  const standaloneCostAmount = moneyValue(standaloneCostAggregate._sum.amount);
  const standaloneCostCount = standaloneCostAggregate._count._all;
  const sum = (key: string, source = downstreamRows) => sumPartyMoney(source.map((row) => (row as Record<string, unknown>)[key]));
  const projectListIncomplete = downstreamContractsTruncated || ownedProjectsTruncated || standaloneCostProjectGroupsTruncated;
  const summary = {
    projectCount: projectListIncomplete ? null : projectRows.length,
    mainContractCount: ownedProjectsTruncated ? null : mainContractRows.length,
    downstreamContractCount: downstreamContractsTruncated ? null : downstreamRows.length,
    ownerCurrentContractAmount: ownedProjectsTruncated ? null : sumPartyMoney(mainContractRows.map((row) => row.currentAmount)),
    ownerApprovedBillAmount: ownedProjectsTruncated ? null : sumPartyMoney(mainContractRows.map((row) => row.approvedAmount)),
    ownerReceivedAmount: ownedProjectsTruncated ? null : sumPartyMoney(mainContractRows.map((row) => row.paidAmount)),
    downstreamCurrentContractAmount: downstreamContractsTruncated ? null : sumPartyMoney(downstreamRows.filter((row) => row.status !== 'TERMINATED').map((row) => row.currentAmount)), downstreamSettledAmount: downstreamContractsTruncated ? null : sum('settledAmount'), downstreamPaidAmount: downstreamContractsTruncated ? null : sum('paidAmount'), downstreamOpenPayableAmount: downstreamContractsTruncated ? null : sum('openPayableAmount'), downstreamSupplierCreditAmount: downstreamContractsTruncated ? null : sum('supplierCreditAmount'), downstreamActualCostAmount: downstreamContractsTruncated ? null : sum('actualCostAmount'), downstreamInvoiceAmount: downstreamContractsTruncated ? null : sum('invoiceAmount'), downstreamVerifiedInvoiceAmount: downstreamContractsTruncated ? null : sum('verifiedInvoiceAmount'), downstreamInvoiceCount: downstreamContractsTruncated ? null : sumNumbers(downstreamRows.map((row) => row.invoiceCount)), standaloneCostAmount, standaloneCostCount, downstreamTotalCostAmount: downstreamContractsTruncated ? null : plusPartyMoney(sum('actualCostAmount'), standaloneCostAmount),
  };
  const warnings: string[] = [];
  const truncationNotices: NonNullable<ReportStudioDataset['truncationNotices']> = [];
  if (!party.identityVerified) warnings.push('单位主体尚未核验；跨项目经营汇总仅供参考，不应直接作为最终对账依据。');
  const partyTruncatedFields: NonNullable<ReportStudioDataset['truncatedFields']> = [];
  if (ownedProjectsTruncated) {
    const affectedFields = [{
      sourceId: 'partySummary',
      fieldIds: ['projectCount', 'mainContractCount', 'ownerCurrentContractAmount', 'ownerApprovedBillAmount', 'ownerReceivedAmount'],
    }];
    partyTruncatedFields.push(...affectedFields);
    const message = `该往来单位关联建设单位项目超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条；业主项目/主合同明细仅显示前 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条，关联项目数及业主侧合同、核定进度款、回款汇总已置空，避免将部分项目算作全量结果。`;
    warnings.push(message);
    truncationNotices.push({ sourceIds: ['partyProjects', 'partyMainContracts'], fields: affectedFields, message });
  }
  if (standaloneCostProjectGroupsTruncated) {
    const affectedFields = [{ sourceId: 'partySummary', fieldIds: ['projectCount'] }];
    partyTruncatedFields.push(...affectedFields);
    const message = `该往来单位的独立成本分布超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 个项目；项目关联清单仅反映有界范围，关联项目总数已置空。独立成本金额和记录数仍基于完整数据库聚合。`;
    warnings.push(message);
    truncationNotices.push({ sourceIds: ['partyProjects'], fields: affectedFields, message });
  }
  if (partyProjectsListTruncated && !ownedProjectsTruncated && !standaloneCostProjectGroupsTruncated) {
    const message = `该往来单位关联项目超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条，项目明细仅显示前 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条；请结合其他来源截断提示判断关联范围是否完整。`;
    warnings.push(message);
    truncationNotices.push({ sourceIds: ['partyProjects'], message });
  }
  if (partyMainContractsTruncated && !ownedProjectsTruncated) {
    const message = `该往来单位关联业主主合同超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条，主合同明细仅显示前 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条。`;
    warnings.push(message);
    truncationNotices.push({ sourceIds: ['partyMainContracts'], message });
  }
  if (downstreamContractsTruncated) {
    const message = `该往来单位关联分供合同超过 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条，明细仅显示前 ${MAX_ROWS_PER_SOURCE.toLocaleString('zh-CN')} 条；依赖分供合同集合的合同、应付、成本和发票金额汇总已停用，避免将部分数据冒充完整总额。`;
    const affectedFields = [
      { sourceId: 'partyProjects', fieldIds: ['downstreamContractAmount', 'downstreamPaidAmount', 'downstreamActualCostAmount', 'downstreamContractCount'] },
      { sourceId: 'partySummary', fieldIds: ['projectCount', 'downstreamContractCount', 'downstreamCurrentContractAmount', 'downstreamSettledAmount', 'downstreamPaidAmount', 'downstreamOpenPayableAmount', 'downstreamSupplierCreditAmount', 'downstreamActualCostAmount', 'downstreamInvoiceAmount', 'downstreamVerifiedInvoiceAmount', 'downstreamInvoiceCount', 'downstreamTotalCostAmount'] },
    ];
    warnings.push(message);
    partyTruncatedFields.push(...affectedFields);
    truncationNotices.push({ sourceIds: ['partyDownstreamContracts', 'partyProjects'], fields: affectedFields, message });
  }
  if (standaloneCosts.length > 200) {
    const message = '独立关联成本明细仅显示最近 200 条；汇总金额使用完整分组统计。';
    warnings.push(message);
    truncationNotices.push({ sourceIds: ['partyStandaloneCosts'], message });
  }
  const partyRows = {
    businessParty: { id: party.id, name: party.name, creditCode: party.creditCode ?? '', roles: party.roles.join('、'), status: party.status, identityVerified: party.identityVerified ? '已核验' : '待核验', formerNames: party.formerNames.join('、'), legalRepresentative: party.legalRepresentative ?? '', address: party.address ?? '', contactName: party.contactName ?? '', phone: party.phone ?? '', email: party.email ?? '', taxNo: party.taxNo ?? '', invoiceTitle: party.invoiceTitle ?? '', notes: party.notes ?? '', updatedAt: dateText(party.updatedAt) },
    partySummary: summary,
    partyProjects: projectRows.slice(0, MAX_ROWS_PER_SOURCE),
    partyMainContracts: mainContractRows.slice(0, MAX_ROWS_PER_SOURCE),
    partyDownstreamContracts: downstreamRows,
    partyStandaloneCosts: standaloneCosts.slice(0, 200).map((cost) => ({ projectCode: cost.project.code, projectName: cost.project.name, date: dateText(cost.date), description: cost.description, type: cost.type, amount: moneyValue(cost.amount), vendorName: cost.vendorName ?? '' })),
  };
  const truncatedSources = [
    ...(partyProjectsListTruncated || downstreamContractsTruncated ? ['partyProjects'] : []),
    ...(partyMainContractsTruncated ? ['partyMainContracts'] : []),
    ...(downstreamContractsTruncated ? ['partyDownstreamContracts'] : []),
    ...(standaloneCosts.length > 200 ? ['partyStandaloneCosts'] : []),
  ];
  return {
    domain: 'PARTY', generatedAt: new Date().toISOString(), projectId: null, businessPartyId,
    accessibleProjectCount: visibleProjectCount, sources: partyRows, warnings,
    truncated: truncatedSources.length > 0 || partyTruncatedFields.length > 0,
    truncatedSources, truncatedFields: partyTruncatedFields, truncationNotices,
  };
}

