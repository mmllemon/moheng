import type { FastifyInstance } from 'fastify';
import { moneyToCents } from '../lib/contract-amount-math.js';
import { failure, success } from '../lib/http.js';
import { calculateDownstreamCurrentAmount } from '../lib/downstream-contract-math.js';
import { money, sumCents, amountFromCents } from './downstream-finance.schemas.js';
import { canAccessProject } from '../lib/project-access.js';
import { authRequired, authUser } from '../lib/auth.js';
import { asAmount, serializeSettlement, serializePayable } from './downstream-finance.helpers.js';
import { prisma } from '../lib/prisma.js';
import { calculateRetentionBalance } from '../lib/downstream-settlement-math.js';

import { registerSettlementRoutes } from './downstream-finance-settlements.js';
import { registerInvoiceRoutes } from './downstream-finance-invoices.js';
import { registerRetentionRoutes } from './downstream-finance-retention.js';

export async function downstreamFinanceRoutes(app: FastifyInstance) {
  app.get('/:projectId/downstream-finance', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const contracts = await prisma.downstreamContract.findMany({
      where: { projectId, deletedAt: null },
      include: {
        adjustments: true,
        payments: { orderBy: { paidAt: 'desc' } },
        settlements: {
          include: {
            lines: { orderBy: { sortOrder: 'asc' } }, posting: true,
            payable: { include: { paymentAllocations: true, invoiceAllocations: true, schedules: { include: { allocations: true }, orderBy: { dueAt: 'asc' } } } },
          },
          orderBy: { createdAt: 'desc' },
        },
        payables: {
          include: { paymentAllocations: true, invoiceAllocations: true, schedules: { include: { allocations: true }, orderBy: { dueAt: 'asc' } } },
          orderBy: { postedAt: 'desc' },
        },
        supplierInvoices: { include: { allocations: true }, orderBy: { invoiceDate: 'desc' } },
        retentionMovements: true,
      },
      orderBy: [{ status: 'asc' }, { contractNo: 'asc' }],
    });
    const items = contracts.map((contract) => {
      const currentAmount = money(calculateDownstreamCurrentAmount(contract.originalAmount, contract.adjustments));
      const payments = contract.payments;
      const grossAdvance = payments.filter((payment) => payment.type === 'ADVANCE').reduce((sum, payment) => sum + moneyToCents(payment.amount), 0n);
      const advanceIds = new Set(payments.filter((payment) => payment.type === 'ADVANCE').map((payment) => payment.id));
      const refundsOfAdvance = payments.filter((payment) => payment.type === 'REFUND' && payment.refundOfPaymentId && advanceIds.has(payment.refundOfPaymentId)).reduce((sum, payment) => sum + moneyToCents(payment.amount), 0n);
      const advancedRecovered = sumCents(contract.settlements.filter((settlement) => settlement.status === 'POSTED').map((settlement) => settlement.advanceRecoveryAmount));
      const advanceBalance = grossAdvance - refundsOfAdvance - advancedRecovered;
      const retained = moneyToCents(calculateRetentionBalance(contract.retentionMovements));
      const payables = contract.payables.map(serializePayable);
      const openPayables = payables.reduce((sum, payable) => { const open = moneyToCents(payable.openAmount); return sum + (open > 0n ? open : 0n); }, 0n);
      const supplierCredit = payables.reduce((sum, payable) => { const open = moneyToCents(payable.openAmount); return sum + (open < 0n ? -open : 0n); }, 0n);
      const invoices = contract.supplierInvoices.map((invoice) => {
        const allocated = sumCents(invoice.allocations.map((allocation) => allocation.amount));
        return { ...invoice, amount: asAmount(invoice.amount), taxAmount: asAmount(invoice.taxAmount), allocatedAmount: amountFromCents(allocated), unallocatedAmount: amountFromCents(moneyToCents(invoice.amount) - allocated) };
      });
      return {
        id: contract.id, contractNo: contract.contractNo, name: contract.name, type: contract.type, counterpartyName: contract.counterpartyName,
        status: contract.status, currentAmount, settlements: contract.settlements.map(serializeSettlement), payables, invoices,
        retentionMovements: contract.retentionMovements.map((movement) => ({ ...movement, amount: asAmount(movement.amount) })),
        totalSettledAmount: amountFromCents(sumCents(contract.settlements.filter((settlement) => settlement.status === 'POSTED').map((settlement) => settlement.postedDeltaAmount ?? 0))),
        pendingSettlementCount: contract.settlements.filter((settlement) => !['POSTED', 'REJECTED'].includes(settlement.status)).length,
        advancePaidAmount: amountFromCents(grossAdvance - refundsOfAdvance), advanceRecoveredAmount: amountFromCents(advancedRecovered), advanceBalanceAmount: amountFromCents(advanceBalance > 0n ? advanceBalance : 0n),
        retentionBalanceAmount: amountFromCents(retained > 0n ? retained : 0n), openPayableAmount: amountFromCents(openPayables), supplierCreditAmount: amountFromCents(supplierCredit),
        invoiceAmount: amountFromCents(sumCents(contract.supplierInvoices.map((invoice) => invoice.amount))),
        verifiedInvoiceAmount: amountFromCents(sumCents(contract.supplierInvoices.filter((invoice) => invoice.status === 'VERIFIED').map((invoice) => invoice.amount))),
      };
    });
    const sum = (fn: (row: typeof items[number]) => number) => amountFromCents(sumCents(items.map((item) => fn(item))));
    return success({
      items,
      summary: {
        contractCount: items.length,
        settlementCount: items.reduce((sum, row) => sum + row.settlements.length, 0),
        pendingSettlementCount: items.reduce((sum, row) => sum + row.pendingSettlementCount, 0),
        postedSettlementAmount: sum((row) => row.totalSettledAmount),
        openPayableAmount: sum((row) => row.openPayableAmount),
        supplierCreditAmount: sum((row) => row.supplierCreditAmount),
        advanceBalanceAmount: sum((row) => row.advanceBalanceAmount),
        retentionBalanceAmount: sum((row) => row.retentionBalanceAmount),
        invoiceAmount: sum((row) => row.invoiceAmount),
        verifiedInvoiceAmount: sum((row) => row.verifiedInvoiceAmount),
      },
    });
  });


  await registerSettlementRoutes(app);
  await registerInvoiceRoutes(app);
  await registerRetentionRoutes(app);
}
