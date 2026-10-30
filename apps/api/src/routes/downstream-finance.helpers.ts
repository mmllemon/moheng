import { failure, success } from '../lib/http.js';
import { denyIfNoProjectAccess } from '../lib/project-access.js';
import { writeRoles, sumCents, amountFromCents, retentionInput } from './downstream-finance.schemas.js';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { authUser } from '../lib/auth.js';
import { calculatePayableOpenAmount, calculatePayableScheduleOpenAmount, calculateRetentionBalance } from '../lib/downstream-settlement-math.js';
import { prisma } from '../lib/prisma.js';
import { centsToMoney, moneyToCents } from '../lib/contract-amount-math.js';

export function asAmount(value: unknown) { return Number(value ?? 0); }
export function serializeSettlement(row: any) {
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
export function serializePayable(row: any) {
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

export async function hasProjectWriteAccess(userId: string, userRole: UserRole, projectId: string, reply: any) {
  return denyIfNoProjectAccess(userId, userRole, projectId, reply, writeRoles, 'DOWNSTREAM_FINANCE_WRITE');
}
export async function lockContract(tx: Prisma.TransactionClient, projectId: string, contractId: string) {
  await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`;
  const contract = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null }, include: { adjustments: true } });
  if (!contract) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
  return contract;
}
export async function writeAudit(tx: Prisma.TransactionClient, projectId: string, userId: string, entity: string, entityId: string, action: string, changes: unknown) {
  await tx.auditLog.create({ data: { projectId, userId, entity, entityId, action, changes: changes as Prisma.InputJsonValue } });
}

export async function transitionSettlement(request: any, reply: any, options: { target: 'SUBMITTED' | 'INTERNAL_APPROVED'; action: string }) {
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

export async function retentionMovement(request: any, reply: any, type: 'RELEASE' | 'FORFEIT') {
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
