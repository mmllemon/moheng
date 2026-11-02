/**
 * 项目资金计划的取数与口径。
 *
 * 这里只负责"把项目的应收、应付、付款计划、销项发票摊成按到期日的现金流条目"，
 * 真正的分桶在 cashflow.ts 的 buildCashflow 里做。拆开的原因有两个：
 *   1. 项目级接口和公司级聚合必须用同一套去重规则，否则两个数字对不上；
 *   2. 取数逻辑可以被单测以外的场景复用（聚合、报表、导出）。
 *
 * 去重规则（写在 cashflow.ts 头部，这里再强调一次，因为最容易在这里写错）：
 *   - 收入只认应收单未收额，不认合同额、不认产值；
 *   - 支出优先认已过账应付未付额；
 *   - 付款计划只用于"还没有结算出应付"的分供合同，否则同一笔支出会算两次；
 *   - 销项发票只计税额，票面金额已经包含在应收里。
 */
import { DownstreamPaymentType } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';
import { centsToMoney, moneyToCents } from './contract-amount-math.js';
import { calculateDownstreamCurrentAmount } from './downstream-contract-math.js';
import { allocateScheduleOpen, type CashflowEntry } from './cashflow.js';

const money = (value: unknown) => Number(value ?? 0);
const sumMoney = (values: unknown[]) => Number(centsToMoney(values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n)));

/** 分供付款净额：退款（REFUND）抵减。 */
export function netPaymentCents(payments: { type: DownstreamPaymentType; amount: unknown }[]): bigint {
  return payments.reduce<bigint>((sum, payment) => sum + (payment.type === 'REFUND' ? -moneyToCents(payment.amount) : moneyToCents(payment.amount)), 0n);
}

export type ProjectCashflowSources = {
  entries: CashflowEntry[];
  sourceCounts: { receivable: number; payable: number; plan: number; invoiceTax: number };
  invoiceTax: { count: number; amount: number };
  uncovered: {
    receivableWithoutDueDate: number;
    payableWithoutDueDate: number;
    unplannedContractCount: number;
    unplannedContractAmount: number;
  };
};

export async function loadProjectCashflowSources(projectId: string): Promise<ProjectCashflowSources> {
  const [receivables, payables, plans, contracts, invoices] = await Promise.all([
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
    prisma.ownerInvoice.findMany({
      where: { projectId, status: 'ISSUED' },
      select: { id: true, invoiceNo: true, invoiceDate: true, taxAmount: true },
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

  // 销项发票：只计税额，按开票月入支出。票面金额已包含在应收里。
  let invoiceTaxCount = 0;
  let invoiceTaxAmount = 0;
  for (const invoice of invoices) {
    const tax = money(invoice.taxAmount);
    if (tax <= 0.005) continue;
    invoiceTaxCount += 1;
    invoiceTaxAmount += tax;
    entries.push({ direction: 'OUTFLOW', dueAt: invoice.invoiceDate, amount: tax, source: 'INVOICE_TAX' });
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

  return {
    entries,
    sourceCounts: { receivable: receivables.length, payable: payables.length, plan: planCount, invoiceTax: invoiceTaxCount },
    invoiceTax: { count: invoiceTaxCount, amount: Math.round(invoiceTaxAmount * 100) / 100 },
    uncovered: {
      receivableWithoutDueDate: receivableUnscheduled,
      payableWithoutDueDate: payableUnscheduled,
      unplannedContractCount: unplannedContracts.length,
      unplannedContractAmount: Math.round(unplannedContracts.reduce((sum, amount) => sum + amount, 0) * 100) / 100,
    },
  };
}
