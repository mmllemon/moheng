import type { FastifyInstance } from 'fastify';
import { DownstreamContractStatus, DownstreamInvoiceStatus, DownstreamPayableType, DownstreamPaymentType, DownstreamRetentionMovementType, DownstreamSettlementStatus, DownstreamSettlementType, Prisma, ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { centsToMoney, moneyToCents } from '../lib/contract-amount-math.js';
import { calculateDownstreamCurrentAmount } from '../lib/downstream-contract-math.js';
import { assertOptionalLineTotal, assertPayableScheduleTotal, calculateAdvanceBalance, calculateNetPayable, calculatePayableOpenAmount, calculatePayableScheduleOpenAmount, calculatePostedSettlementDelta, calculateRetentionBalance } from '../lib/downstream-settlement-math.js';
import { positiveMoney } from '../lib/validation.js';
import { nextDocumentNumber } from '../lib/document-number.js';

const writeRoles = [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR];
const money = (value: unknown) => Number(value ?? 0);
const hasAtMostTwoDecimals = (value: number) => Number.isFinite(value) && Math.abs(value - Math.round(value * 100) / 100) < 1e-8;
const nonNegativeMoneyInput = z.coerce.number().refine((value) => value >= 0 && hasAtMostTwoDecimals(value), '金额必须为非负数且最多保留两位小数');
const signedMoneyInput = z.coerce.number().refine((value) => value !== 0 && hasAtMostTwoDecimals(value), '金额必须非零且最多保留两位小数');
const sumCents = (values: unknown[]) => values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n);
const amountFromCents = (value: bigint) => Number(centsToMoney(value));
const hasAtMostDecimals = (value: number, places: number) => Number.isFinite(value) && Math.abs(value - Math.round(value * (10 ** places)) / (10 ** places)) < 1e-8;
const settlementLineInput = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().positive().refine((value) => hasAtMostDecimals(value, 3), '数量最多保留三位小数').optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  unitPrice: z.coerce.number().nonnegative().refine((value) => hasAtMostDecimals(value, 4), '单价最多保留四位小数').optional().nullable(),
  amount: positiveMoney,
});
const settlementInput = z.object({
  settlementNo: z.string().trim().max(80).optional().or(z.literal('')),
  type: z.nativeEnum(DownstreamSettlementType),
  submittedAmount: positiveMoney,
  advanceRecoveryAmount: nonNegativeMoneyInput.default(0),
  retentionAmount: nonNegativeMoneyInput.default(0),
  otherDeductionAmount: nonNegativeMoneyInput.default(0),
  dueAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(3000).optional().nullable(),
  lines: z.array(settlementLineInput).max(300).optional().default([]),
});
const rejectInput = z.object({ reason: z.string().trim().min(3).max(2000) });
const confirmInput = z.object({
  confirmedAmount: signedMoneyInput,
  confirmationReference: z.string().trim().min(1).max(240),
  confirmationDate: z.string().datetime(),
  notes: z.string().max(3000).optional().nullable(),
});
const invoiceInput = z.object({
  invoiceNo: z.string().trim().min(1).max(120),
  invoiceDate: z.string().datetime(),
  amount: positiveMoney,
  taxAmount: nonNegativeMoneyInput.default(0),
  taxIncluded: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.taxAmount > value.amount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxAmount'], message: '税额不能大于发票价税合计金额' });
});
const invoiceVerifyInput = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), verificationNote: z.string().trim().max(2000).optional().nullable() });
const allocationInput = z.object({ payableId: z.string().min(1), amount: positiveMoney, notes: z.string().max(1000).optional().nullable() });
const retentionInput = z.object({ amount: positiveMoney, effectiveAt: z.string().datetime(), reference: z.string().trim().min(1).max(160), notes: z.string().max(2000).optional().nullable() });
const payableScheduleInput = z.object({ schedules: z.array(z.object({ scheduleNo: z.string().trim().min(1).max(30), dueAt: z.string().datetime(), amount: positiveMoney, notes: z.string().max(1000).optional().nullable() })).min(1).max(50) }).superRefine((value, ctx) => { if (new Set(value.schedules.map((item) => item.scheduleNo)).size !== value.schedules.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedules'], message: '应付分期编号不能重复' }); });

function asAmount(value: unknown) { return Number(value ?? 0); }
function serializeSettlement(row: any) {
  return {
    ...row,
    submittedAmount: asAmount(row.submittedAmount), confirmedAmount: row.confirmedAmount == null ? null : asAmount(row.confirmedAmount),
    postedDeltaAmount: row.postedDeltaAmount == null ? null : asAmount(row.postedDeltaAmount),
    advanceRecoveryAmount: asAmount(row.advanceRecoveryAmount), retentionAmount: asAmount(row.retentionAmount),
    otherDeductionAmount: asAmount(row.otherDeductionAmount), netPayableAmount: row.netPayableAmount == null ? null : asAmount(row.netPayableAmount),
    lines: (row.lines ?? []).map((line: any) => ({ ...line, quantity: line.quantity == null ? null : asAmount(line.quantity), unitPrice: line.unitPrice == null ? null : asAmount(line.unitPrice), amount: asAmount(line.amount) })),
    posting: row.posting ? { ...row.posting, cumulativeBefore: asAmount(row.posting.cumulativeBefore), deltaAmount: asAmount(row.posting.deltaAmount), cumulativeAfter: asAmount(row.posting.cumulativeAfter) } : null,
    payable: row.payable ? serializePayable(row.payable) : null,
  };
}
function serializePayable(row: any) {
  const allocated = sumCents((row.paymentAllocations ?? []).map((allocation: any) => allocation.amount));
  const invoiceAllocated = sumCents((row.invoiceAllocations ?? []).map((allocation: any) => allocation.amount));
  const gross = moneyToCents(row.grossAmount);
  const net = moneyToCents(row.netAmount);
  const open = moneyToCents(calculatePayableOpenAmount(row.netAmount, (row.paymentAllocations ?? []).map((allocation: any) => allocation.amount)));
  return {
    ...row,
    grossAmount: asAmount(row.grossAmount), advanceRecoveryAmount: asAmount(row.advanceRecoveryAmount),
    retentionAmount: asAmount(row.retentionAmount), otherDeductionAmount: asAmount(row.otherDeductionAmount), netAmount: asAmount(row.netAmount),
    allocatedPaymentAmount: amountFromCents(allocated), openAmount: amountFromCents(open), hasPaymentHistory: (row.paymentAllocations ?? []).length > 0,
    invoicedAmount: amountFromCents(invoiceAllocated), grossOpenInvoiceAmount: amountFromCents(gross - invoiceAllocated),
    schedules: (row.schedules ?? []).map((schedule: any) => { const scheduleAllocated = sumCents((schedule.allocations ?? []).map((allocation: any) => allocation.amount)); const scheduleOpen = moneyToCents(calculatePayableScheduleOpenAmount(schedule.amount, (schedule.allocations ?? []).map((allocation: any) => allocation.amount))); return { ...schedule, amount: asAmount(schedule.amount), allocatedAmount: amountFromCents(scheduleAllocated), openAmount: amountFromCents(scheduleOpen), allocations: undefined }; }),
    paymentAllocations: undefined,
    invoiceAllocations: undefined,
  };
}

async function hasProjectWriteAccess(userId: string, userRole: string, projectId: string, reply: any) {
  return denyIfNoProjectAccess(userId, userRole, projectId, reply, writeRoles);
}
async function lockContract(tx: Prisma.TransactionClient, projectId: string, contractId: string) {
  await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`;
  const contract = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null }, include: { adjustments: true } });
  if (!contract) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
  return contract;
}
async function writeAudit(tx: Prisma.TransactionClient, projectId: string, userId: string, entity: string, entityId: string, action: string, changes: unknown) {
  await tx.auditLog.create({ data: { projectId, userId, entity, entityId, action, changes: changes as Prisma.InputJsonValue } });
}

export async function downstreamFinanceRoutes(app: FastifyInstance) {
  app.get('/:projectId/downstream-finance', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
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
      const openPayables = payables.reduce((sum, payable) => sum + Math.max(0, moneyToCents(payable.openAmount)), 0n);
      const supplierCredit = payables.reduce((sum, payable) => sum + Math.max(0, -moneyToCents(payable.openAmount)), 0n);
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

  app.post('/:projectId/downstream-contracts/:contractId/settlements', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = settlementInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '结算单资料有误', parsed.error.flatten());
    try { assertOptionalLineTotal({ submittedAmount: parsed.data.submittedAmount, lineAmounts: parsed.data.lines.map((line) => line.amount) }); } catch { return failure(reply, 400, 'SETTLEMENT_LINES_TOTAL_MISMATCH', '已填写的结算明细合计必须等于报审金额；没有清单时可不填写任何明细行'); }
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        if (contract.status === 'DRAFT' || contract.status === 'TERMINATED') throw new Error('CONTRACT_NOT_SETTLEMENT_ELIGIBLE');
        if (parsed.data.type === 'PROGRESS' && !['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('PROGRESS_SETTLEMENT_STATUS_INVALID');
        if (parsed.data.type === 'FINAL' && contract.status !== 'COMPLETED') throw new Error('FINAL_SETTLEMENT_REQUIRES_COMPLETED');
        if (parsed.data.type === 'FINAL') {
          const otherFinal = await tx.downstreamContractSettlement.findFirst({ where: { downstreamContractId: contractId, type: 'FINAL', status: { not: 'REJECTED' } }, select: { id: true } });
          if (otherFinal) throw new Error('FINAL_SETTLEMENT_ALREADY_EXISTS');
        }
        if (parsed.data.type === 'ADJUSTMENT' && !['COMPLETED', 'SETTLED'].includes(contract.status)) throw new Error('ADJUSTMENT_STATUS_INVALID');
        if (parsed.data.type === 'ADJUSTMENT' && (parsed.data.advanceRecoveryAmount > 0 || parsed.data.retentionAmount > 0 || parsed.data.otherDeductionAmount > 0)) throw new Error('ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED');
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } });
        const settlementNo = parsed.data.settlementNo?.trim() || await nextDocumentNumber(tx, { projectId, projectCode: project.code, type: 'FGJS', date: new Date() });
        const created = await tx.downstreamContractSettlement.create({ data: {
          downstreamContractId: contractId, settlementNo, type: parsed.data.type,
          submittedAmount: String(parsed.data.submittedAmount), advanceRecoveryAmount: String(parsed.data.advanceRecoveryAmount),
          retentionAmount: String(parsed.data.retentionAmount), otherDeductionAmount: String(parsed.data.otherDeductionAmount),
          dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, notes: parsed.data.notes ?? null, createdById: user.sub,
          lines: { create: parsed.data.lines.map((line, index) => ({ description: line.description, quantity: line.quantity == null ? null : String(line.quantity), unit: line.unit ?? null, unitPrice: line.unitPrice == null ? null : String(line.unitPrice), amount: String(line.amount), sortOrder: index })) },
        }, include: { lines: true } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', created.id, 'SETTLEMENT_DRAFT_CREATED', { settlementNo: created.settlementNo, type: created.type, submittedAmount: String(created.submittedAmount), linesOptional: true, lineCount: parsed.data.lines.length });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success(serializeSettlement(saved)));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'CONTRACT_NOT_SETTLEMENT_ELIGIBLE') return failure(reply, 409, 'CONTRACT_NOT_SETTLEMENT_ELIGIBLE', '草稿或已终止合同不能创建结算单');
      if (error instanceof Error && error.message === 'PROGRESS_SETTLEMENT_STATUS_INVALID') return failure(reply, 409, 'PROGRESS_SETTLEMENT_STATUS_INVALID', '阶段结算仅适用于执行中或完工待结算合同');
      if (error instanceof Error && error.message === 'FINAL_SETTLEMENT_REQUIRES_COMPLETED') return failure(reply, 409, 'FINAL_SETTLEMENT_REQUIRES_COMPLETED', '最终结算必须先将合同标记为完工待结算');
      if (error instanceof Error && error.message === 'FINAL_SETTLEMENT_ALREADY_EXISTS') return failure(reply, 409, 'FINAL_SETTLEMENT_ALREADY_EXISTS', '该合同已有一笔未驳回或已过账的最终结算单；请处理现有单据或按调整流程更正');
      if (error instanceof Error && error.message === 'ADJUSTMENT_STATUS_INVALID') return failure(reply, 409, 'ADJUSTMENT_STATUS_INVALID', '结算调整仅适用于完工待结算或结算已确认合同');
      if (error instanceof Error && error.message === 'ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED') return failure(reply, 400, 'ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED', '结算调整单不直接录入预付款扣回、质保金或其他扣款，请使用有依据的调整金额');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'SETTLEMENT_NO_EXISTS', '该合同下结算单编号已存在');
      throw error;
    }
  });

  app.patch('/:projectId/downstream-contracts/:contractId/settlements/:settlementId', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, settlementId } = request.params as { projectId: string; contractId: string; settlementId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = settlementInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '结算单资料有误', parsed.error.flatten());
    try { assertOptionalLineTotal({ submittedAmount: parsed.data.submittedAmount, lineAmounts: parsed.data.lines.map((line) => line.amount) }); } catch { return failure(reply, 400, 'SETTLEMENT_LINES_TOTAL_MISMATCH', '已填写的结算明细合计必须等于报审金额；没有清单时可不填写任何明细行'); }
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        const existing = await tx.downstreamContractSettlement.findFirst({ where: { id: settlementId, downstreamContractId: contractId } });
        if (!existing) throw new Error('SETTLEMENT_NOT_FOUND');
        if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw new Error('SETTLEMENT_NOT_EDITABLE');
        if (contract.status === 'DRAFT' || contract.status === 'TERMINATED') throw new Error('CONTRACT_NOT_SETTLEMENT_ELIGIBLE');
        if (parsed.data.type === 'PROGRESS' && !['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('PROGRESS_SETTLEMENT_STATUS_INVALID');
        if (parsed.data.type === 'FINAL' && contract.status !== 'COMPLETED') throw new Error('FINAL_SETTLEMENT_REQUIRES_COMPLETED');
        if (parsed.data.type === 'FINAL') {
          const otherFinal = await tx.downstreamContractSettlement.findFirst({ where: { downstreamContractId: contractId, type: 'FINAL', status: { not: 'REJECTED' }, id: { not: settlementId } }, select: { id: true } });
          if (otherFinal) throw new Error('FINAL_SETTLEMENT_ALREADY_EXISTS');
        }
        if (parsed.data.type === 'ADJUSTMENT' && !['COMPLETED', 'SETTLED'].includes(contract.status)) throw new Error('ADJUSTMENT_STATUS_INVALID');
        if (parsed.data.type === 'ADJUSTMENT' && (parsed.data.advanceRecoveryAmount > 0 || parsed.data.retentionAmount > 0 || parsed.data.otherDeductionAmount > 0)) throw new Error('ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED');
        await tx.downstreamSettlementLine.deleteMany({ where: { settlementId } });
        const updated = await tx.downstreamContractSettlement.update({ where: { id: settlementId }, data: {
          settlementNo: parsed.data.settlementNo?.trim() || existing.settlementNo, type: parsed.data.type, status: 'DRAFT', submittedAmount: String(parsed.data.submittedAmount),
          confirmedAmount: null, postedDeltaAmount: null, advanceRecoveryAmount: String(parsed.data.advanceRecoveryAmount),
          retentionAmount: String(parsed.data.retentionAmount), otherDeductionAmount: String(parsed.data.otherDeductionAmount),
          netPayableAmount: null, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, confirmationReference: null,
          confirmationDate: null, submittedById: null, internalApprovedById: null, counterpartyRecordedById: null,
          submittedAt: null, internalApprovedAt: null, counterpartyConfirmedAt: null, postedAt: null, rejectedById: null, rejectedAt: null, rejectionReason: null, notes: parsed.data.notes ?? null,
          lines: { create: parsed.data.lines.map((line, index) => ({ description: line.description, quantity: line.quantity == null ? null : String(line.quantity), unit: line.unit ?? null, unitPrice: line.unitPrice == null ? null : String(line.unitPrice), amount: String(line.amount), sortOrder: index })) },
        }, include: { lines: true } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', settlementId, 'SETTLEMENT_DRAFT_UPDATED', { fromStatus: existing.status, settlementNo: updated.settlementNo, type: updated.type, submittedAmount: String(updated.submittedAmount), linesOptional: true, lineCount: parsed.data.lines.length, priorRejectionReason: existing.rejectionReason });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success(serializeSettlement(saved));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_NOT_FOUND') return failure(reply, 404, 'SETTLEMENT_NOT_FOUND', '结算单不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_NOT_EDITABLE') return failure(reply, 409, 'SETTLEMENT_NOT_EDITABLE', '只有草稿或已驳回的结算单可以修改；已审核或过账金额必须按流程处理');
      if (error instanceof Error && error.message === 'CONTRACT_NOT_SETTLEMENT_ELIGIBLE') return failure(reply, 409, 'CONTRACT_NOT_SETTLEMENT_ELIGIBLE', '草稿或已终止合同不能创建/修改结算单');
      if (error instanceof Error && error.message === 'PROGRESS_SETTLEMENT_STATUS_INVALID') return failure(reply, 409, 'PROGRESS_SETTLEMENT_STATUS_INVALID', '阶段结算仅适用于执行中或完工待结算合同');
      if (error instanceof Error && error.message === 'FINAL_SETTLEMENT_REQUIRES_COMPLETED') return failure(reply, 409, 'FINAL_SETTLEMENT_REQUIRES_COMPLETED', '最终结算必须先将合同标记为完工待结算');
      if (error instanceof Error && error.message === 'FINAL_SETTLEMENT_ALREADY_EXISTS') return failure(reply, 409, 'FINAL_SETTLEMENT_ALREADY_EXISTS', '该合同已有一笔未驳回或已过账的最终结算单；请处理现有单据或按调整流程更正');
      if (error instanceof Error && error.message === 'ADJUSTMENT_STATUS_INVALID') return failure(reply, 409, 'ADJUSTMENT_STATUS_INVALID', '结算调整仅适用于完工待结算或结算已确认合同');
      if (error instanceof Error && error.message === 'ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED') return failure(reply, 400, 'ADJUSTMENT_DEDUCTIONS_NOT_ALLOWED', '结算调整单不直接录入预付款扣回、质保金或其他扣款，请使用有依据的调整金额');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'SETTLEMENT_NO_EXISTS', '该合同下结算单编号已存在');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/settlements/:settlementId/reject', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, settlementId } = request.params as { projectId: string; contractId: string; settlementId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = rejectInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '请填写明确的退回原因', parsed.error.flatten());
    try {
      const saved = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const settlement = await tx.downstreamContractSettlement.findFirst({ where: { id: settlementId, downstreamContractId: contractId } });
        if (!settlement) throw new Error('SETTLEMENT_NOT_FOUND');
        if (!['SUBMITTED', 'INTERNAL_APPROVED'].includes(settlement.status)) throw new Error('SETTLEMENT_STATUS_INVALID');
        const updated = await tx.downstreamContractSettlement.update({ where: { id: settlementId }, data: { status: 'REJECTED', rejectedById: user.sub, rejectedAt: new Date(), rejectionReason: parsed.data.reason } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', settlementId, 'SETTLEMENT_REJECTED', { fromStatus: settlement.status, reason: parsed.data.reason });
        return updated;
      });
      return success(serializeSettlement(saved));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_NOT_FOUND') return failure(reply, 404, 'SETTLEMENT_NOT_FOUND', '结算单不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_STATUS_INVALID') return failure(reply, 409, 'SETTLEMENT_STATUS_INVALID', '只有待内部审核或待外部确认的结算单可以退回');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/settlements/:settlementId/submit', { preHandler: authRequired }, async (request, reply) => {
    return transitionSettlement(request, reply, { target: 'SUBMITTED', action: 'SETTLEMENT_SUBMITTED' });
  });
  app.post('/:projectId/downstream-contracts/:contractId/settlements/:settlementId/approve', { preHandler: authRequired }, async (request, reply) => {
    return transitionSettlement(request, reply, { target: 'INTERNAL_APPROVED', action: 'SETTLEMENT_INTERNAL_APPROVED' });
  });
  app.post('/:projectId/downstream-contracts/:contractId/settlements/:settlementId/confirm', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, settlementId } = request.params as { projectId: string; contractId: string; settlementId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = confirmInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '外部确认信息填写有误', parsed.error.flatten());
    try {
      const saved = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const row = await tx.downstreamContractSettlement.findFirst({ where: { id: settlementId, downstreamContractId: contractId } });
        if (!row) throw new Error('SETTLEMENT_NOT_FOUND');
        if (row.status !== 'INTERNAL_APPROVED') throw new Error('SETTLEMENT_STATUS_INVALID');
        if (row.type !== 'ADJUSTMENT' && parsed.data.confirmedAmount <= 0) throw new Error('CONFIRMED_AMOUNT_INVALID');
        if (row.type === 'FINAL') {
          const existingFinal = await tx.downstreamContractSettlement.findFirst({ where: { downstreamContractId: contractId, type: 'FINAL', status: 'POSTED', id: { not: row.id } }, select: { id: true } });
          if (existingFinal) throw new Error('FINAL_SETTLEMENT_ALREADY_POSTED');
        }
        const updated = await tx.downstreamContractSettlement.update({ where: { id: row.id }, data: {
          status: 'COUNTERPARTY_CONFIRMED', confirmedAmount: String(parsed.data.confirmedAmount), confirmationReference: parsed.data.confirmationReference,
          confirmationDate: new Date(parsed.data.confirmationDate), counterpartyConfirmedAt: new Date(), counterpartyRecordedById: user.sub, notes: parsed.data.notes ?? row.notes,
        }, include: { lines: true } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', row.id, 'SETTLEMENT_COUNTERPARTY_CONFIRMED', { confirmedAmount: String(parsed.data.confirmedAmount), confirmationReference: parsed.data.confirmationReference, confirmationDate: parsed.data.confirmationDate });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success(serializeSettlement(saved));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_NOT_FOUND') return failure(reply, 404, 'SETTLEMENT_NOT_FOUND', '结算单不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_STATUS_INVALID') return failure(reply, 409, 'SETTLEMENT_STATUS_INVALID', '只有公司内部审核通过的结算单可以登记外部确认');
      if (error instanceof Error && error.message === 'CONFIRMED_AMOUNT_INVALID') return failure(reply, 400, 'CONFIRMED_AMOUNT_INVALID', '阶段或最终结算确认金额必须大于 0');
      if (error instanceof Error && error.message === 'FINAL_SETTLEMENT_ALREADY_POSTED') return failure(reply, 409, 'FINAL_SETTLEMENT_ALREADY_POSTED', '该合同已经过账最终结算；需要更正时请使用结算调整单');
      throw error;
    }
  });
  app.post('/:projectId/downstream-contracts/:contractId/settlements/:settlementId/post', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, settlementId } = request.params as { projectId: string; contractId: string; settlementId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        const settlement = await tx.downstreamContractSettlement.findFirst({ where: { id: settlementId, downstreamContractId: contractId }, include: { lines: true } });
        if (!settlement) throw new Error('SETTLEMENT_NOT_FOUND');
        if (settlement.status !== 'COUNTERPARTY_CONFIRMED' || settlement.confirmedAmount == null) throw new Error('SETTLEMENT_NOT_CONFIRMED');
        if (settlement.type === 'PROGRESS' && !['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('PROGRESS_SETTLEMENT_STATUS_INVALID');
        if (settlement.type === 'FINAL' && contract.status !== 'COMPLETED') throw new Error('FINAL_SETTLEMENT_REQUIRES_COMPLETED');
        if (settlement.type === 'ADJUSTMENT' && !['COMPLETED', 'SETTLED'].includes(contract.status)) throw new Error('ADJUSTMENT_STATUS_INVALID');
        if (settlement.type === 'FINAL') {
          const existingFinal = await tx.downstreamContractSettlement.findFirst({ where: { downstreamContractId: contractId, type: 'FINAL', status: 'POSTED', id: { not: settlement.id } }, select: { id: true } });
          if (existingFinal) throw new Error('FINAL_SETTLEMENT_ALREADY_POSTED');
        }
        const priorPosted = await tx.downstreamContractSettlement.findMany({ where: { downstreamContractId: contractId, status: 'POSTED', id: { not: settlement.id } }, select: { postedDeltaAmount: true, advanceRecoveryAmount: true } });
        const priorTotal = sumCents(priorPosted.map((row) => row.postedDeltaAmount ?? 0));
        const deltaAmountString = calculatePostedSettlementDelta({ type: settlement.type, confirmedAmount: settlement.confirmedAmount, previousCumulativeAmount: centsToMoney(priorTotal) });
        const deltaCents = moneyToCents(deltaAmountString);
        if (priorTotal + deltaCents < 0n) throw new Error('SETTLEMENT_TOTAL_BELOW_ZERO');
        const advanceRecovery = moneyToCents(settlement.advanceRecoveryAmount);
        const retention = moneyToCents(settlement.retentionAmount);
        const otherDeduction = moneyToCents(settlement.otherDeductionAmount);
        if (deltaCents <= 0n && (advanceRecovery > 0n || retention > 0n || otherDeduction > 0n)) throw new Error('NEGATIVE_SETTLEMENT_CANNOT_HAVE_DEDUCTIONS');
        if (deltaCents > 0n && advanceRecovery + retention + otherDeduction > deltaCents) throw new Error('SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT');
        const alreadyRecovered = sumCents(priorPosted.map((row) => row.advanceRecoveryAmount));
        const allPayments = advanceRecovery > 0n ? await tx.downstreamContractPayment.findMany({ where: { downstreamContractId: contractId }, select: { id: true, type: true, amount: true, refundOfPaymentId: true } }) : [];
        const availableAdvance = calculateAdvanceBalance({ payments: allPayments as any, recoveredAmount: centsToMoney(alreadyRecovered) });
        const netString = calculateNetPayable({ postedDeltaAmount: centsToMoney(deltaCents), advanceRecoveryAmount: centsToMoney(advanceRecovery), retentionAmount: centsToMoney(retention), otherDeductionAmount: centsToMoney(otherDeduction), availableAdvanceAmount: availableAdvance });
        const net = moneyToCents(netString);
        const postedAt = new Date();
        let payable: any = null;
        if (deltaCents !== 0n) {
          const payableType: DownstreamPayableType = settlement.type === 'ADJUSTMENT' || deltaCents < 0n ? 'ADJUSTMENT' : 'SETTLEMENT';
          payable = await tx.downstreamPayable.create({ data: {
            downstreamContractId: contractId, payableNo: `${settlement.settlementNo}-AP`, type: payableType, settlementId: settlement.id,
            grossAmount: String(centsToMoney(deltaCents)), advanceRecoveryAmount: String(centsToMoney(advanceRecovery)),
            retentionAmount: String(centsToMoney(retention)), otherDeductionAmount: String(centsToMoney(otherDeduction)),
            netAmount: String(centsToMoney(net)), dueAt: settlement.dueAt, notes: settlement.notes, createdById: user.sub, postedAt,
            ...(settlement.dueAt && net > 0n ? { schedules: { create: [{ scheduleNo: '01', dueAt: settlement.dueAt, amount: String(centsToMoney(net)), notes: '结算过账自动建立的单期到期安排；可在未发生付款前调整为多期' }] } } : {}),
          } });
        }
        if (retention > 0n) {
          await tx.downstreamRetentionMovement.create({ data: {
            downstreamContractId: contractId, settlementId: settlement.id, type: 'RETAIN', amount: String(centsToMoney(retention)),
            effectiveAt: postedAt, reference: settlement.settlementNo, notes: '由结算过账自动生成质保金留置记录', createdById: user.sub,
          } });
        }
        await tx.downstreamSettlementPosting.create({ data: {
          settlementId: settlement.id, downstreamContractId: contractId,
          cumulativeBefore: String(centsToMoney(priorTotal)), deltaAmount: String(centsToMoney(deltaCents)),
          cumulativeAfter: String(centsToMoney(priorTotal + deltaCents)), postedAt, postedById: user.sub,
        } });
        const updated = await tx.downstreamContractSettlement.update({ where: { id: settlement.id }, data: {
          status: 'POSTED', postedDeltaAmount: String(centsToMoney(deltaCents)), netPayableAmount: String(centsToMoney(net)), postedAt,
        }, include: { lines: true, posting: true, payable: { include: { paymentAllocations: true, invoiceAllocations: true, schedules: { include: { allocations: true }, orderBy: { dueAt: 'asc' } } } } } });
        if (settlement.type === 'FINAL') await tx.downstreamContract.update({ where: { id: contractId }, data: { status: 'SETTLED' } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', settlement.id, 'SETTLEMENT_POSTED', {
          type: settlement.type, confirmedAmount: String(settlement.confirmedAmount), previousCumulativeAmount: String(centsToMoney(priorTotal)),
          postedDeltaAmount: String(centsToMoney(deltaCents)), advanceRecoveryAmount: String(centsToMoney(advanceRecovery)),
          retentionAmount: String(centsToMoney(retention)), otherDeductionAmount: String(centsToMoney(otherDeduction)), netPayableAmount: String(centsToMoney(net)), payableId: payable?.id ?? null,
          linesOptional: true, lineCount: settlement.lines.length,
        });
        const payableWithSchedules = payable ? await tx.downstreamPayable.findUnique({ where: { id: payable.id }, include: { paymentAllocations: true, invoiceAllocations: true, schedules: { include: { allocations: true }, orderBy: { dueAt: 'asc' } } } }) : null;
        return { settlement: updated, payable: payableWithSchedules ? serializePayable(payableWithSchedules) : null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success({ settlement: serializeSettlement(result.settlement), payable: result.payable });
    } catch (error) {
      const map: Record<string, [number, string, string]> = {
        DOWNSTREAM_CONTRACT_NOT_FOUND: [404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在'],
        SETTLEMENT_NOT_FOUND: [404, 'SETTLEMENT_NOT_FOUND', '结算单不存在'],
        SETTLEMENT_NOT_CONFIRMED: [409, 'SETTLEMENT_NOT_CONFIRMED', '必须先完成公司内部审核和外部对方确认，才能过账'],
        PROGRESS_SETTLEMENT_STATUS_INVALID: [409, 'PROGRESS_SETTLEMENT_STATUS_INVALID', '阶段结算仅适用于执行中或完工待结算合同'],
        PROGRESS_AMOUNT_MUST_BE_POSITIVE: [400, 'PROGRESS_AMOUNT_MUST_BE_POSITIVE', '阶段结算确认金额必须大于 0'],
        FINAL_AMOUNT_MUST_BE_POSITIVE: [400, 'FINAL_AMOUNT_MUST_BE_POSITIVE', '最终累计结算确认金额必须大于 0'],
        ADJUSTMENT_AMOUNT_MUST_BE_NONZERO: [400, 'ADJUSTMENT_AMOUNT_MUST_BE_NONZERO', '结算调整金额必须为非零值'],
        FINAL_SETTLEMENT_REQUIRES_COMPLETED: [409, 'FINAL_SETTLEMENT_REQUIRES_COMPLETED', '最终结算必须先将合同标记为完工待结算'],
        ADJUSTMENT_STATUS_INVALID: [409, 'ADJUSTMENT_STATUS_INVALID', '结算调整仅适用于完工待结算或结算已确认合同'],
        FINAL_SETTLEMENT_ALREADY_POSTED: [409, 'FINAL_SETTLEMENT_ALREADY_POSTED', '该合同已经过账最终结算；更正请使用结算调整单'],
        CONFIRMED_AMOUNT_INVALID: [400, 'CONFIRMED_AMOUNT_INVALID', '阶段或最终结算确认金额必须大于 0'],
        SETTLEMENT_TOTAL_BELOW_ZERO: [409, 'SETTLEMENT_TOTAL_BELOW_ZERO', '该笔结算会使累计结算金额低于 0，请核对调整金额'],
        NEGATIVE_SETTLEMENT_CANNOT_HAVE_DEDUCTIONS: [400, 'NEGATIVE_SETTLEMENT_CANNOT_HAVE_DEDUCTIONS', '负向结算调整不能同时扣回预付款、计提质保金或重复登记其他扣款'],
        SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT: [409, 'SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT', '预付款扣回、质保金及其他扣款的合计不能超过本次正向结算金额'],
        ADVANCE_RECOVERY_EXCEEDS_BALANCE: [409, 'ADVANCE_RECOVERY_EXCEEDS_BALANCE', '预付款扣回金额超过当前可扣回预付款余额'],
      };
      if (error instanceof Error && map[error.message]) { const [status, code, message] = map[error.message]; return failure(reply, status, code, message); }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'PAYABLE_ALREADY_CREATED', '该结算单或应付来源已过账，请刷新检查是否已经成功');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'SETTLEMENT_CONFLICT', '结算过账发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.put('/:projectId/downstream-contracts/:contractId/payables/:payableId/schedules', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, payableId } = request.params as { projectId: string; contractId: string; payableId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = payableScheduleInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '应付分期信息有误', parsed.error.flatten());
    try {
      const saved = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const payable = await tx.downstreamPayable.findFirst({ where: { id: payableId, downstreamContractId: contractId }, include: { paymentAllocations: true, schedules: { include: { allocations: true } } } });
        if (!payable) throw new Error('PAYABLE_INVALID');
        if (payable.paymentAllocations.length > 0 || payable.schedules.some((schedule) => schedule.allocations.length > 0)) throw new Error('PAYABLE_SCHEDULE_LOCKED_AFTER_PAYMENT');
        try { assertPayableScheduleTotal({ payableAmount: payable.netAmount, scheduleAmounts: parsed.data.schedules.map((item) => item.amount) }); }
        catch (error) { if (error instanceof Error) throw error; throw new Error('PAYABLE_SCHEDULE_TOTAL_MISMATCH'); }
        await tx.downstreamPayableSchedule.deleteMany({ where: { payableId } });
        for (const item of parsed.data.schedules) { await tx.downstreamPayableSchedule.create({ data: { payableId, scheduleNo: item.scheduleNo, dueAt: new Date(item.dueAt), amount: String(item.amount), notes: item.notes ?? null } }); }
        await writeAudit(tx, projectId, user.sub, 'DownstreamPayable', payableId, 'PAYABLE_SCHEDULES_REPLACED', { payableNo: payable.payableNo, totalAmount: String(payable.netAmount), schedules: parsed.data.schedules.map((item) => ({ ...item, amount: String(item.amount) })) });
        const schedules = await tx.downstreamPayableSchedule.findMany({ where: { payableId }, include: { allocations: true }, orderBy: { dueAt: 'asc' } });
        return { payable, schedules };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success({ payableId, payableNo: saved.payable.payableNo, schedules: saved.schedules.map((schedule) => ({ ...schedule, amount: asAmount(schedule.amount), allocatedAmount: 0, openAmount: asAmount(schedule.amount) })) });
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'PAYABLE_INVALID') return failure(reply, 404, 'PAYABLE_INVALID', '应付单不存在或不属于当前分供合同');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_LOCKED_AFTER_PAYMENT') return failure(reply, 409, 'PAYABLE_SCHEDULE_LOCKED_AFTER_PAYMENT', '应付单一旦发生付款或退款核销，不能再重设分期，以免破坏历史核销关系');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_REQUIRES_POSITIVE_PAYABLE') return failure(reply, 409, 'PAYABLE_SCHEDULE_REQUIRES_POSITIVE_PAYABLE', '只有正向应付单可以设置分期');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_REQUIRED') return failure(reply, 400, 'PAYABLE_SCHEDULE_REQUIRED', '请至少填写一期');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_AMOUNT_MUST_BE_POSITIVE') return failure(reply, 400, 'PAYABLE_SCHEDULE_AMOUNT_MUST_BE_POSITIVE', '每期金额必须大于 0');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_TOTAL_MISMATCH') return failure(reply, 400, 'PAYABLE_SCHEDULE_TOTAL_MISMATCH', '各期金额合计必须等于应付净额');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'PAYABLE_SCHEDULE_CONFLICT', '应付分期保存发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/invoices', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = invoiceInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票信息填写有误', parsed.error.flatten());
    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        if (contract.status === 'DRAFT' || contract.status === 'TERMINATED') throw new Error('CONTRACT_NOT_INVOICE_ELIGIBLE');
        const row = await tx.downstreamSupplierInvoice.create({ data: {
          downstreamContractId: contractId, invoiceNo: parsed.data.invoiceNo, invoiceDate: new Date(parsed.data.invoiceDate), amount: String(parsed.data.amount),
          taxAmount: String(parsed.data.taxAmount), taxIncluded: parsed.data.taxIncluded, notes: parsed.data.notes ?? null, createdById: user.sub,
        } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamSupplierInvoice', row.id, 'SUPPLIER_INVOICE_RECORDED', { invoiceNo: row.invoiceNo, amount: String(row.amount), taxAmount: String(row.taxAmount), status: row.status });
        return row;
      });
      return reply.code(201).send(success({ ...invoice, amount: asAmount(invoice.amount), taxAmount: asAmount(invoice.taxAmount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'CONTRACT_NOT_INVOICE_ELIGIBLE') return failure(reply, 409, 'CONTRACT_NOT_INVOICE_ELIGIBLE', '草稿或已终止合同不能登记新的供应商发票');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'INVOICE_NO_EXISTS', '该合同下发票号码已登记');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/invoices/:invoiceId/verify', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, invoiceId } = request.params as { projectId: string; contractId: string; invoiceId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = invoiceVerifyInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票核验信息有误', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const existing = await tx.downstreamSupplierInvoice.findFirst({ where: { id: invoiceId, downstreamContractId: contractId } });
        if (!existing) throw new Error('INVOICE_NOT_FOUND');
        if (existing.status !== 'RECEIVED') throw new Error('INVOICE_ALREADY_PROCESSED');
        const updated = await tx.downstreamSupplierInvoice.update({ where: { id: invoiceId }, data: { status: parsed.data.status, verificationNote: parsed.data.verificationNote ?? null, verifiedAt: parsed.data.status === 'VERIFIED' ? new Date() : null } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamSupplierInvoice', invoiceId, parsed.data.status === 'VERIFIED' ? 'SUPPLIER_INVOICE_VERIFIED' : 'SUPPLIER_INVOICE_REJECTED', { status: parsed.data.status, verificationNote: parsed.data.verificationNote ?? null });
        return updated;
      });
      return success({ ...row, amount: asAmount(row.amount), taxAmount: asAmount(row.taxAmount) });
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'INVOICE_NOT_FOUND') return failure(reply, 404, 'INVOICE_NOT_FOUND', '发票不存在');
      if (error instanceof Error && error.message === 'INVOICE_ALREADY_PROCESSED') return failure(reply, 409, 'INVOICE_ALREADY_PROCESSED', '发票已经核验；如需更正应保留核验记录并建立更正流程');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/invoices/:invoiceId/allocations', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, invoiceId } = request.params as { projectId: string; contractId: string; invoiceId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = allocationInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票核对分配金额填写有误', parsed.error.flatten());
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const invoice = await tx.downstreamSupplierInvoice.findFirst({ where: { id: invoiceId, downstreamContractId: contractId } });
        if (!invoice) throw new Error('INVOICE_NOT_FOUND');
        if (invoice.status !== 'VERIFIED') throw new Error('INVOICE_MUST_BE_VERIFIED');
        const payable = await tx.downstreamPayable.findFirst({ where: { id: parsed.data.payableId, downstreamContractId: contractId } });
        if (!payable) throw new Error('PAYABLE_NOT_FOUND');
        if (moneyToCents(payable.grossAmount) <= 0n) throw new Error('PAYABLE_CANNOT_RECEIVE_INVOICE');
        const invoiceAllocations = await tx.downstreamInvoiceAllocation.findMany({ where: { invoiceId } });
        const payableAllocations = await tx.downstreamInvoiceAllocation.findMany({ where: { payableId: payable.id } });
        const requested = moneyToCents(parsed.data.amount);
        const invoiceAlreadyAllocated = sumCents(invoiceAllocations.map((item) => item.amount));
        const payableAlreadyAllocated = sumCents(payableAllocations.map((item) => item.amount));
        if (invoiceAlreadyAllocated + requested > moneyToCents(invoice.amount)) throw new Error('INVOICE_ALLOCATION_EXCEEDS_INVOICE');
        if (payableAlreadyAllocated + requested > moneyToCents(payable.grossAmount)) throw new Error('INVOICE_ALLOCATION_EXCEEDS_PAYABLE');
        const allocation = await tx.downstreamInvoiceAllocation.upsert({
          where: { invoiceId_payableId: { invoiceId, payableId: payable.id } },
          create: { invoiceId, payableId: payable.id, amount: String(centsToMoney(requested)), notes: parsed.data.notes ?? null },
          update: { amount: { increment: String(centsToMoney(requested)) }, notes: parsed.data.notes ?? null },
        });
        await writeAudit(tx, projectId, user.sub, 'DownstreamInvoiceAllocation', allocation.id, 'SUPPLIER_INVOICE_ALLOCATED', { invoiceId, payableId: payable.id, amount: String(parsed.data.amount), cumulativeInvoiceAllocation: String(centsToMoney(invoiceAlreadyAllocated + requested)) });
        return allocation;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ ...result, amount: asAmount(result.amount) }));
    } catch (error) {
      const map: Record<string, [number, string, string]> = {
        DOWNSTREAM_CONTRACT_NOT_FOUND: [404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在'],
        INVOICE_NOT_FOUND: [404, 'INVOICE_NOT_FOUND', '发票不存在'],
        INVOICE_MUST_BE_VERIFIED: [409, 'INVOICE_MUST_BE_VERIFIED', '发票完成核验后才能分配到应付单'],
        PAYABLE_NOT_FOUND: [404, 'PAYABLE_NOT_FOUND', '应付单不存在或不属于当前合同'],
        PAYABLE_CANNOT_RECEIVE_INVOICE: [409, 'PAYABLE_CANNOT_RECEIVE_INVOICE', '负向应付调整不能分配正向发票金额'],
        INVOICE_ALLOCATION_EXCEEDS_INVOICE: [409, 'INVOICE_ALLOCATION_EXCEEDS_INVOICE', '累计分配金额不能超过该发票价税合计金额'],
        INVOICE_ALLOCATION_EXCEEDS_PAYABLE: [409, 'INVOICE_ALLOCATION_EXCEEDS_PAYABLE', '累计分配金额不能超过该应付来源的正向结算金额'],
      };
      if (error instanceof Error && map[error.message]) { const [status, code, message] = map[error.message]; return failure(reply, status, code, message); }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'INVOICE_ALLOCATION_CONFLICT', '发票分配发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/retention/release', { preHandler: authRequired }, async (request, reply) => {
    return retentionMovement(request, reply, 'RELEASE');
  });
  app.post('/:projectId/downstream-contracts/:contractId/retention/forfeit', { preHandler: authRequired }, async (request, reply) => {
    return retentionMovement(request, reply, 'FORFEIT');
  });

  async function transitionSettlement(request: any, reply: any, options: { target: 'SUBMITTED' | 'INTERNAL_APPROVED'; action: string }) {
    const user = authUser(request); const { projectId, contractId, settlementId } = request.params as { projectId: string; contractId: string; settlementId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    try {
      const row = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const settlement = await tx.downstreamContractSettlement.findFirst({ where: { id: settlementId, downstreamContractId: contractId } });
        if (!settlement) throw new Error('SETTLEMENT_NOT_FOUND');
        const required = options.target === 'SUBMITTED' ? 'DRAFT' : 'SUBMITTED';
        if (settlement.status !== required) throw new Error('SETTLEMENT_STATUS_INVALID');
        if (options.target === 'INTERNAL_APPROVED' && settlement.submittedById === user.sub) throw new Error('SUBMITTER_CANNOT_APPROVE');
        const updated = await tx.downstreamContractSettlement.update({ where: { id: settlement.id }, data: { status: options.target, submittedAt: options.target === 'SUBMITTED' ? new Date() : settlement.submittedAt, submittedById: options.target === 'SUBMITTED' ? user.sub : settlement.submittedById, internalApprovedAt: options.target === 'INTERNAL_APPROVED' ? new Date() : settlement.internalApprovedAt, internalApprovedById: options.target === 'INTERNAL_APPROVED' ? user.sub : settlement.internalApprovedById } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamContractSettlement', settlement.id, options.action, { from: required, to: options.target });
        return updated;
      });
      return success(serializeSettlement(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_NOT_FOUND') return failure(reply, 404, 'SETTLEMENT_NOT_FOUND', '结算单不存在');
      if (error instanceof Error && error.message === 'SETTLEMENT_STATUS_INVALID') return failure(reply, 409, 'SETTLEMENT_STATUS_INVALID', options.target === 'SUBMITTED' ? '只有草稿结算单可以提交' : '只有已提交结算单可以进行内部审核');
      if (error instanceof Error && error.message === 'SUBMITTER_CANNOT_APPROVE') return failure(reply, 403, 'SUBMITTER_CANNOT_APPROVE', '结算单提交人不得审批本人提交的业务，请由其他有权限人员审核');
      throw error;
    }
  }

  async function retentionMovement(request: any, reply: any, type: 'RELEASE' | 'FORFEIT') {
    const user = authUser(request); const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = retentionInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '质保金处置资料填写有误', parsed.error.flatten());
    try {
      const result = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        if (contract.status !== 'SETTLED') throw new Error('RETENTION_REQUIRES_FINAL_SETTLEMENT');
        const movements = await tx.downstreamRetentionMovement.findMany({ where: { downstreamContractId: contractId }, select: { type: true, amount: true } });
        const balance = moneyToCents(calculateRetentionBalance(movements as any));
        const amount = moneyToCents(parsed.data.amount);
        if (amount > balance) throw new Error('RETENTION_AMOUNT_EXCEEDS_BALANCE');
        const movement = await tx.downstreamRetentionMovement.create({ data: {
          downstreamContractId: contractId, type, amount: String(parsed.data.amount), effectiveAt: new Date(parsed.data.effectiveAt),
          reference: parsed.data.reference, notes: parsed.data.notes ?? null, createdById: user.sub,
        } });
        let payable: any = null;
        if (type === 'RELEASE') {
          payable = await tx.downstreamPayable.create({ data: {
            downstreamContractId: contractId, payableNo: `RET-${movement.id}`, type: 'RETENTION_RELEASE', retentionMovementId: movement.id,
            grossAmount: String(parsed.data.amount), netAmount: String(parsed.data.amount), dueAt: new Date(parsed.data.effectiveAt),
            notes: parsed.data.notes ?? parsed.data.reference, createdById: user.sub,
            schedules: { create: [{ scheduleNo: '01', dueAt: new Date(parsed.data.effectiveAt), amount: String(parsed.data.amount), notes: '质保金释放时自动建立的单期到期安排' }] },
          } });
        }
        await writeAudit(tx, projectId, user.sub, 'DownstreamRetentionMovement', movement.id, type === 'RELEASE' ? 'RETENTION_RELEASED_TO_PAYABLE' : 'RETENTION_FORFEITED', { amount: String(parsed.data.amount), reference: parsed.data.reference, payableId: payable?.id ?? null, remainingBalance: String(centsToMoney(balance - amount)) });
        const payableWithSchedules = payable ? await tx.downstreamPayable.findUnique({ where: { id: payable.id }, include: { paymentAllocations: true, invoiceAllocations: true, schedules: { include: { allocations: true }, orderBy: { dueAt: 'asc' } } } }) : null;
        return { movement, payable: payableWithSchedules };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ movement: { ...result.movement, amount: asAmount(result.movement.amount) }, payable: result.payable ? serializePayable(result.payable) : null }));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'RETENTION_REQUIRES_FINAL_SETTLEMENT') return failure(reply, 409, 'RETENTION_REQUIRES_FINAL_SETTLEMENT', '只有完成最终结算的合同才能释放或核销质保金');
      if (error instanceof Error && error.message === 'RETENTION_AMOUNT_EXCEEDS_BALANCE') return failure(reply, 409, 'RETENTION_AMOUNT_EXCEEDS_BALANCE', '本次质保金释放/核销金额超过当前可用留置余额');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'RETENTION_CONFLICT', '质保金操作发生并发冲突，请刷新后重试');
      throw error;
    }
  }
}
