import type { FastifyInstance } from 'fastify';
import { CostType, DownstreamPaymentType } from '../generated/prisma/client.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';
import { canAccessProject } from '../lib/project-access.js';
import { calculateDownstreamCurrentAmount, calculateContractCostGap } from '../lib/downstream-contract-math.js';
import { centsToMoney, moneyToCents } from '../lib/contract-amount-math.js';
import { computeProjectEac } from '../lib/project-eac.js';
import { allocateScheduleOpen, buildCashflow, CASHFLOW_DEFAULT_MONTHS, type CashflowEntry } from '../lib/cashflow.js';

const money = (value: unknown) => Number(value ?? 0);
const sumMoney = (values: unknown[]) => Number(centsToMoney(values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n)));
function netPaymentCents(payments: { type: DownstreamPaymentType; amount: unknown }[]): bigint {
  return payments.reduce<bigint>((sum, payment) => sum + (payment.type === 'REFUND' ? -moneyToCents(payment.amount) : moneyToCents(payment.amount)), 0n);
}
function grossPaymentCents(payments: { type: DownstreamPaymentType; amount: unknown }[]): bigint {
  return payments.filter((payment) => payment.type !== 'REFUND').reduce<bigint>((sum, payment) => sum + moneyToCents(payment.amount), 0n);
}
function refundPaymentCents(payments: { type: DownstreamPaymentType; amount: unknown }[]): bigint {
  return payments.filter((payment) => payment.type === 'REFUND').reduce<bigint>((sum, payment) => sum + moneyToCents(payment.amount), 0n);
}

export async function analysisRoutes(app: FastifyInstance) {
  app.get('/projects/:projectId/analysis/three-way', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, include: { mainContract: true } });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');

    const [budgetItems, allCosts, costByType, monthlyCosts, changes, pendingChanges, bills, certifiedBills, receiptTypes, downstreamContracts] = await Promise.all([
      prisma.budgetItem.findMany({ where: { projectId, deletedAt: null }, include: { _count: { select: { children: true } } }, orderBy: { sortOrder: 'asc' } }),
      prisma.costEntry.aggregate({ where: { projectId, deletedAt: null }, _sum: { amount: true } }),
      prisma.costEntry.groupBy({ by: ['type'], where: { projectId, deletedAt: null }, _sum: { amount: true } }),
      prisma.costEntry.findMany({ where: { projectId, deletedAt: null, date: { gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1) } }, select: { amount: true, date: true }, orderBy: { date: 'asc' } }),
      prisma.change.findMany({ where: { projectId, deletedAt: null, externalConfirmationStatus: 'EFFECTIVE', externalConfirmedAmount: { not: null } }, select: { direction: true, externalConfirmedAmount: true } }),
      prisma.change.findMany({ where: { projectId, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { direction: true, submittedAmount: true } }),
      prisma.progressBill.aggregate({ where: { projectId, deletedAt: null }, _sum: { amount: true, approvedAmount: true, paidAmount: true } }),
      // 只有核定过的产值才算进度信号；未审批的申报额会虚增完成比。
      prisma.progressBill.aggregate({ where: { projectId, deletedAt: null, status: { in: ['APPROVED', 'PAID'] } }, _sum: { approvedAmount: true } }),
      // 回款口径要含结算款到账；只取普通到账与退款，预付款单独核算，不算作回款。
      prisma.ownerReceipt.groupBy({ by: ['type'], where: { projectId, type: { in: ['RECEIPT', 'REFUND'] } }, _sum: { amount: true } }),
      prisma.downstreamContract.findMany({ where: { projectId, deletedAt: null }, include: { adjustments: { select: { direction: true, amount: true } }, payments: { select: { type: true, amount: true } }, costEntries: { where: { deletedAt: null }, select: { amount: true } } } }),
    ]);

    const leaves = budgetItems.filter((item) => item._count.children === 0);
    const targetCost = leaves.reduce((sum, item) => sum + money(item.totalPrice), 0);
    const actualCost = money(allCosts._sum.amount);
    // Use the current effective total; the base amount is preserved separately.
    const contractAmount = money(project.contractAmount);
    const confirmedChangeAmount = changes.reduce((sum, change) => {
      const amount = money(change.externalConfirmedAmount);
      return sum + (change.direction === 'DECREASE' ? -amount : amount);
    }, 0);
    const certifiedRevenue = money(certifiedBills._sum.approvedAmount);
    const netReceiptAmount = receiptTypes.reduce((sum, row) => sum + (row.type === 'REFUND' ? -money(row._sum.amount) : money(row._sum.amount)), 0);
    const pendingChangeExposure = pendingChanges.reduce((sum, change) => {
      const amount = money(change.submittedAmount);
      return sum + (change.direction === 'DECREASE' ? -amount : amount);
    }, 0);
    // 完工估算按业主核定产值折算成本效率；缺基线或缺样本时 computeProjectEac 会明确拒绝给数。
    const eac = computeProjectEac({ contractAmount, budgetAtCompletion: targetCost, actualCost, certifiedRevenue, pendingChangeExposure });
    const groupMap = new Map(budgetItems.map((item) => [item.id, { id: item.id, code: item.code, name: item.name, targetCost: money(item.totalPrice), actualCost: 0, childCount: item._count.children }]));
    const byBudget = await prisma.costEntry.groupBy({ by: ['budgetItemId'], where: { projectId, deletedAt: null, budgetItemId: { not: null } }, _sum: { amount: true } });
    for (const row of byBudget) {
      const item = row.budgetItemId ? groupMap.get(row.budgetItemId) : undefined;
      if (item) item.actualCost = money(row._sum.amount);
    }

    const monthMap = new Map<string, number>();
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      monthMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    }
    for (const row of monthlyCosts) {
      const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
      if (monthMap.has(key)) monthMap.set(key, (monthMap.get(key) ?? 0) + money(row.amount));
    }
    const monthly = [...monthMap.entries()].map(([month, amount]) => ({ month, amount }));
    const totalPaid = money(bills._sum.paidAmount);
    const approvedRevenue = money(bills._sum.approvedAmount);
    const totalSubmitted = money(bills._sum.amount);
    const downstreamRows = downstreamContracts.map((contract) => {
      const currentAmount = calculateDownstreamCurrentAmount(contract.originalAmount, contract.adjustments);
      const paymentRows = contract.payments as { type: DownstreamPaymentType; amount: unknown }[];
      const linkedActualCost = centsToMoney(contract.costEntries.reduce<bigint>((sum, entry) => sum + moneyToCents(entry.amount), 0n));
      return {
        status: contract.status,
        currentAmount,
        currentAmountNumber: money(currentAmount),
        paidAmount: centsToMoney(netPaymentCents(paymentRows)),
        grossPaidAmount: centsToMoney(grossPaymentCents(paymentRows)),
        refundedAmount: centsToMoney(refundPaymentCents(paymentRows)),
        linkedActualCost,
      };
    });
    const activeDownstreamRows = downstreamRows.filter((contract) => contract.status === 'ACTIVE');
    const openCommitmentRows = downstreamRows.filter((contract) => contract.status === 'ACTIVE' || contract.status === 'COMPLETED');
    const downstreamContractSummary = {
      contractCount: downstreamRows.length,
      activeContractCount: activeDownstreamRows.length,
      currentContractAmount: sumMoney(downstreamRows.filter((contract) => contract.status !== 'TERMINATED').map((contract) => contract.currentAmount)),
      activeAndPendingSettlementContractAmount: sumMoney(openCommitmentRows.map((contract) => contract.currentAmount)),
      activeAndPendingSettlementContractCount: openCommitmentRows.length,
      paidAmount: sumMoney(downstreamRows.map((contract) => contract.paidAmount)),
      grossPaidAmount: sumMoney(downstreamRows.map((contract) => contract.grossPaidAmount)),
      refundedAmount: sumMoney(downstreamRows.map((contract) => contract.refundedAmount)),
      linkedActualCost: sumMoney(downstreamRows.map((contract) => contract.linkedActualCost)),
      contractValueMinusLinkedActualCost: sumMoney(openCommitmentRows.map((contract) => calculateContractCostGap({ status: contract.status as 'ACTIVE' | 'COMPLETED', currentAmount: contract.currentAmount, linkedActualCost: contract.linkedActualCost }).contractValueMinusLinkedActualCost)),
      linkedActualCostOverContractValue: sumMoney(openCommitmentRows.map((contract) => calculateContractCostGap({ status: contract.status as 'ACTIVE' | 'COMPLETED', currentAmount: contract.currentAmount, linkedActualCost: contract.linkedActualCost }).linkedActualCostOverContractValue)),
    };
    const costTypes = Object.fromEntries(Object.values(CostType).map((type) => [type, 0])) as Record<CostType, number>;
    for (const row of costByType) costTypes[row.type] = money(row._sum.amount);

    return success({
      project: { id: project.id, name: project.name, code: project.code },
      contractAmount,
      targetCost,
      actualCost,
      eac,
      // 目标口径只在维护了目标成本时成立，否则不是 100% 利润，而是没有基准。
      targetProfit: targetCost > 0 ? contractAmount - targetCost : null,
      targetProfitMargin: targetCost > 0 && contractAmount > 0 ? (contractAmount - targetCost) / contractAmount : null,
      confirmedChangeAmount,
      downstreamContractSummary,
      billSummary: { totalSubmitted, approvedAmount: approvedRevenue, certifiedAmount: certifiedRevenue, paidAmount: totalPaid, netReceiptAmount },
      costByType: costTypes,
      byBudget: [...groupMap.values()].filter((item) => item.childCount === 0).map(({ childCount: _childCount, ...item }) => item),
      monthlyActualCost: monthly,
    });
  });

  app.get('/projects/:projectId/analysis/cashflow', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const requestedMonths = Number((request.query as { months?: string })?.months);
    const months = Number.isFinite(requestedMonths) && requestedMonths > 0 ? Math.min(24, Math.trunc(requestedMonths)) : CASHFLOW_DEFAULT_MONTHS;

    const [receivables, payables, plans, contracts] = await Promise.all([
      prisma.ownerReceivable.findMany({
        where: { projectId, status: { not: 'VOID' } },
        select: { id: true, netAmount: true, dueAt: true, allocations: { select: { amount: true } }, schedules: { select: { id: true, amount: true, dueAt: true, allocations: { select: { amount: true } } } } },
      }),
      prisma.downstreamPayable.findMany({
        where: { downstreamContract: { projectId, deletedAt: null } },
        select: { id: true, downstreamContractId: true, netAmount: true, dueAt: true, paymentAllocations: { select: { amount: true } }, schedules: { select: { id: true, amount: true, dueAt: true, allocations: { select: { amount: true } } } } },
      }),
      prisma.downstreamPaymentPlan.findMany({
        where: { downstreamContract: { projectId, deletedAt: null } },
        select: { id: true, downstreamContractId: true, dueAt: true, plannedAmount: true, payments: { select: { type: true, amount: true } } },
      }),
      prisma.downstreamContract.findMany({
        where: { projectId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } },
        select: { id: true, originalAmount: true, adjustments: { select: { direction: true, amount: true } }, payments: { select: { type: true, amount: true } } },
      }),
    ]);

    const entries: CashflowEntry[] = [];
    let receivableUnscheduled = 0;
    let payableUnscheduled = 0;

    for (const receivable of receivables) {
      const open = money(receivable.netAmount) - sumMoney(receivable.allocations.map((row) => row.amount));
      if (open <= 0.005) continue;
      const allocated = allocateScheduleOpen({
        totalOpen: open,
        schedules: receivable.schedules.map((schedule) => ({ id: schedule.id, amount: money(schedule.amount), allocated: sumMoney(schedule.allocations.map((row) => row.amount)) })),
      });
      if (!allocated.length) {
        if (!receivable.dueAt) receivableUnscheduled += 1;
        entries.push({ direction: 'INFLOW', dueAt: receivable.dueAt, amount: open, source: 'RECEIVABLE' });
        continue;
      }
      for (const row of allocated) {
        const schedule = receivable.schedules.find((item) => item.id === row.id);
        entries.push({ direction: 'INFLOW', dueAt: schedule?.dueAt ?? receivable.dueAt, amount: row.open, source: 'RECEIVABLE' });
      }
    }

    for (const payable of payables) {
      const open = money(payable.netAmount) - sumMoney(payable.paymentAllocations.map((row) => row.amount));
      if (open <= 0.005) continue;
      const allocated = allocateScheduleOpen({
        totalOpen: open,
        schedules: payable.schedules.map((schedule) => ({ id: schedule.id, amount: money(schedule.amount), allocated: sumMoney(schedule.allocations.map((row) => row.amount)) })),
      });
      if (!allocated.length) {
        if (!payable.dueAt) payableUnscheduled += 1;
        entries.push({ direction: 'OUTFLOW', dueAt: payable.dueAt, amount: open, source: 'PAYABLE' });
        continue;
      }
      for (const row of allocated) {
        const schedule = payable.schedules.find((item) => item.id === row.id);
        entries.push({ direction: 'OUTFLOW', dueAt: schedule?.dueAt ?? payable.dueAt, amount: row.open, source: 'PAYABLE' });
      }
    }

    // 付款计划只覆盖还没有结算出应付的合同；已结算的合同一律以应付为准，避免重复计支出。
    const contractsWithPayables = new Set(payables.map((row) => row.downstreamContractId));
    const contractsWithPlans = new Set(plans.map((row) => row.downstreamContractId));
    let planCount = 0;
    for (const plan of plans) {
      if (contractsWithPayables.has(plan.downstreamContractId)) continue;
      const paid = plan.payments.reduce((sum, row) => sum + (row.type === 'REFUND' ? -money(row.amount) : money(row.amount)), 0);
      const open = money(plan.plannedAmount) - paid;
      if (open <= 0.005) continue;
      planCount += 1;
      entries.push({ direction: 'OUTFLOW', dueAt: plan.dueAt, amount: open, source: 'PLAN' });
    }

    // 既没有应付也没有付款计划的合同，其剩余合同额完全不在资金计划里，必须单独提示。
    const unplannedContracts = contracts
      .filter((contract) => !contractsWithPayables.has(contract.id) && !contractsWithPlans.has(contract.id))
      .map((contract) => {
        const current = calculateDownstreamCurrentAmount(contract.originalAmount, contract.adjustments);
        const paid = netPaymentCents(contract.payments);
        return money(current) - Number(centsToMoney(paid));
      })
      .filter((amount) => amount > 0.005);

    const plan = buildCashflow(entries, { asOf: new Date(), months });
    return success({
      ...plan,
      sourceCounts: { receivable: receivables.length, payable: payables.length, plan: planCount },
      uncovered: {
        // 没有到期日、无法落到任何月份的记录数，比金额更能说明台账缺什么。
        receivableWithoutDueDate: receivableUnscheduled,
        payableWithoutDueDate: payableUnscheduled,
        unplannedContractCount: unplannedContracts.length,
        unplannedContractAmount: Math.round(unplannedContracts.reduce((sum, amount) => sum + amount, 0) * 100) / 100,
      },
    });
  });

  app.get('/dashboard', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'PROJECT_READ');
    const projectWhere = { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) } as const;
    const projects = await prisma.project.findMany({ where: projectWhere, include: { _count: { select: { costEntries: true, budgetItems: true } } }, orderBy: { updatedAt: 'desc' } });
    const ids = projects.map((p) => p.id);
    if (!ids.length) return success({ totals: { projectCount: 0, contractAmount: 0, targetCost: 0, actualCost: 0, receivedAmount: 0 }, projects: [], pendingChanges: [], recentActivities: [] });
    const [cost, bills, budgetItems, costByProject, billsByProject, changes, recentActivities] = await Promise.all([
      prisma.costEntry.aggregate({ where: { projectId: { in: ids }, deletedAt: null }, _sum: { amount: true } }),
      prisma.progressBill.aggregate({ where: { projectId: { in: ids }, deletedAt: null }, _sum: { paidAmount: true } }),
      prisma.budgetItem.findMany({ where: { projectId: { in: ids }, deletedAt: null }, include: { _count: { select: { children: true } } } }),
      prisma.costEntry.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, deletedAt: null }, _sum: { amount: true } }),
      prisma.progressBill.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, deletedAt: null }, _sum: { paidAmount: true } }),
      prisma.change.findMany({ where: { projectId: { in: ids }, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, include: { project: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 6 }),
      prisma.auditLog.findMany({ where: { projectId: { in: ids } }, include: { user: { select: { name: true } }, project: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
    ]);
    const targetCostByProject = new Map<string, number>();
    for (const item of budgetItems.filter((row) => row._count.children === 0)) {
      targetCostByProject.set(item.projectId, (targetCostByProject.get(item.projectId) ?? 0) + money(item.totalPrice));
    }
    const actualCostByProject = new Map(costByProject.map((row) => [row.projectId, money(row._sum.amount)]));
    const receivedByProject = new Map(billsByProject.map((row) => [row.projectId, money(row._sum.paidAmount)]));
    const targetCost = [...targetCostByProject.values()].reduce((sum, amount) => sum + amount, 0);
    const projectRows = projects.map((p) => {
      const actualCost = actualCostByProject.get(p.id) ?? 0;
      const projectTargetCost = targetCostByProject.get(p.id) ?? 0;
      const receivedAmount = receivedByProject.get(p.id) ?? 0;
      return {
        id: p.id, name: p.name, code: p.code, status: p.status, ownerName: p.ownerName,
        contractAmount: money(p.contractAmount), originalContractAmount: money(p.originalContractAmount),
        targetCost: projectTargetCost, actualCost, receivedAmount,
        costVarianceAmount: projectTargetCost > 0 ? actualCost - projectTargetCost : null,
        recoveryRatio: money(p.contractAmount) > 0 ? receivedAmount / money(p.contractAmount) : null,
        startDate: p.startDate, plannedEndDate: p.plannedEndDate, managerName: p.managerName,
        address: p.address, budgetItemCount: p._count.budgetItems, costEntryCount: p._count.costEntries,
      };
    });
    return success({
      totals: { projectCount: projects.length, contractAmount: projects.reduce((sum, p) => sum + money(p.contractAmount), 0), targetCost, actualCost: money(cost._sum.amount), receivedAmount: money(bills._sum.paidAmount) },
      projects: projectRows,
      pendingChanges: changes.map((c) => ({ id: c.id, projectId: c.projectId, projectName: c.project.name, code: c.code, name: c.name, status: c.status, submittedAmount: money(c.submittedAmount) })),
      recentActivities: recentActivities.map((a) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, actor: a.user.name, projectName: a.project?.name ?? '已归档项目', createdAt: a.createdAt })),
    });
  });
}
