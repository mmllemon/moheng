import type { FastifyInstance } from 'fastify';
import { Prisma, ProjectRole, ProgressBillStatus } from '../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney, positiveMoney } from '../lib/validation.js';
import { centsToMoney, moneyToCents } from '../lib/contract-amount-math.js';
import { nextDocumentNumber } from '../lib/document-number.js';
import { calculateContractNetOpenCents, calculateReceivableOpenCents, capReceiptCents } from '../lib/owner-settlement-math.js';

const billInput = z.object({
  periodNo: z.number().int().positive(),
  applyDate: z.string().datetime(),
  measureDate: z.string().datetime().optional().nullable(),
  amount: positiveMoney,
  notes: z.string().max(2000).optional().nullable(),
});
const statusInput = z.object({ status: z.nativeEnum(ProgressBillStatus), approvedAmount: nonNegativeMoney.optional(), notes: z.string().max(2000).optional() });
const paymentInput = z.object({ amount: positiveMoney, paidAt: z.string().datetime(), referenceNo: z.string().max(100).optional(), notes: z.string().max(1000).optional() });

function sumAllocations(values: unknown[]): bigint { return values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n); }

function serialise(row: any) {
  return { ...row, amount: Number(row.amount), approvedAmount: row.approvedAmount == null ? null : Number(row.approvedAmount), paidAmount: Number(row.paidAmount), payments: row.payments?.map((p: any) => ({ ...p, amount: Number(p.amount) })), mainContract: row.mainContract ?? null };
}

const transitions: Record<ProgressBillStatus, ProgressBillStatus[]> = {
  DRAFT: ['SUBMITTED'], SUBMITTED: ['UNDER_REVIEW', 'REJECTED'], UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [], PAID: [], REJECTED: ['DRAFT'],
};

class PaymentValidationError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

export async function progressBillRoutes(app: FastifyInstance) {
  app.get('/:projectId/progress-bills', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const rows = await prisma.progressBill.findMany({ where: { projectId, deletedAt: null }, include: { payments: { orderBy: { paidAt: 'desc' } }, mainContract: { select: { id: true, contractNo: true, name: true } } }, orderBy: { periodNo: 'desc' } });
    return success(rows.map(serialise));
  });

  app.post('/:projectId/progress-bills', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'PROGRESS_BILL_WRITE')) return;
    const parsed = billInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '进度款申报资料有误', parsed.error.flatten());
    const mainContract = await prisma.mainContract.findUnique({ where: { projectId }, select: { id: true } });
    if (!mainContract) return failure(reply, 409, 'MAIN_CONTRACT_REQUIRED', '请先建立项目主合同，再登记对业主的进度款申报');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.progressBill.create({ data: { projectId, mainContractId: mainContract.id, periodNo: parsed.data.periodNo, applyDate: new Date(parsed.data.applyDate), measureDate: parsed.data.measureDate ? new Date(parsed.data.measureDate) : null, amount: String(parsed.data.amount), notes: parsed.data.notes ?? null } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'ProgressBill', entityId: created.id, action: 'CREATE', changes: { ...parsed.data, mainContractId: mainContract.id, amount: String(parsed.data.amount) } } });
        return created;
      });
      return reply.code(201).send(success(serialise(row)));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'BILL_PERIOD_EXISTS', '该项目的申报期次已存在');
      throw error;
    }
  });

  app.patch('/:projectId/progress-bills/:billId/status', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, billId } = request.params as { projectId: string; billId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'PROGRESS_BILL_WRITE')) return;
    const parsed = statusInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '状态参数不正确', parsed.error.flatten());
    const old = await prisma.progressBill.findFirst({ where: { id: billId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'BILL_NOT_FOUND', '进度款申报不存在');
    if (!transitions[old.status].includes(parsed.data.status)) return failure(reply, 409, 'INVALID_STATUS_TRANSITION', `不能从“${old.status}”流转到“${parsed.data.status}”`);
    if (parsed.data.status === 'APPROVED' && parsed.data.approvedAmount === undefined) {
      parsed.data.approvedAmount = Number(old.amount);
    }
    if (parsed.data.status === 'APPROVED' && parsed.data.approvedAmount === undefined) return failure(reply, 400, 'APPROVED_AMOUNT_REQUIRED', '审批通过时必须填写核定金额');
    if (parsed.data.status === 'APPROVED' && !old.mainContractId) return failure(reply, 409, 'MAIN_CONTRACT_REQUIRED', '审批通过前必须先关联业主主合同');
    if (parsed.data.status === 'APPROVED' && old.mainContractId) {
      const mainContract = await prisma.mainContract.findFirst({ where: { id: old.mainContractId, projectId }, select: { id: true } });
      if (!mainContract) return failure(reply, 409, 'MAIN_CONTRACT_REQUIRED', '关联的业主主合同不存在或不属于当前项目');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.progressBill.update({ where: { id: billId }, data: {
        status: parsed.data.status,
        ...(parsed.data.approvedAmount !== undefined ? { approvedAmount: String(parsed.data.approvedAmount) } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      } });
      if (parsed.data.status === 'APPROVED') {
        const amount = parsed.data.approvedAmount ?? Number(old.approvedAmount ?? old.amount);
        if (!old.mainContractId) throw new Error('MAIN_CONTRACT_REQUIRED');
        const existingReceivable = await tx.ownerReceivable.findUnique({ where: { sourceProgressBillId: billId }, select: { id: true } });
        if (!existingReceivable) {
          const main = await tx.mainContract.findUnique({ where: { id: old.mainContractId }, include: { project: { select: { code: true } } } });
          if (!main) throw new Error('MAIN_CONTRACT_REQUIRED');
          const receivableNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YS', date: new Date() });
          await tx.ownerReceivable.create({ data: {
            projectId, mainContractId: main.id, receivableNo, type: 'PROGRESS_BILL', title: `进度款第${old.periodNo}期应收`, sourceProgressBillId: billId,
            grossAmount: String(amount), advanceDeductionAmount: '0', retentionAmount: '0', otherDeductionAmount: '0', netAmount: String(amount), status: 'OPEN', notes: old.notes ?? null, createdById: user.sub,
          } });
          await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'OwnerReceivable', entityId: billId, action: 'PROGRESS_BILL_RECEIVABLE_CREATED', changes: { periodNo: old.periodNo, receivableNo, amount: String(amount) } } });
        }
      }
      await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'ProgressBill', entityId: billId, action: 'STATUS_CHANGE', changes: { from: old.status, to: result.status, approvedAmount: parsed.data.approvedAmount } } });
      return result;
    });
    return success(serialise(updated));
  });

  app.post('/:projectId/progress-bills/:billId/payments', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, billId } = request.params as { projectId: string; billId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'PROGRESS_BILL_WRITE')) return;
    const parsed = paymentInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '到账记录填写有误', parsed.error.flatten());
    // Re-read and validate inside a serializable transaction so two concurrent
    // payments cannot both pass the balance check using the same old value.
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const bill = await tx.progressBill.findFirst({ where: { id: billId, projectId, deletedAt: null } });
        if (!bill) throw new PaymentValidationError(404, 'BILL_NOT_FOUND', '进度款申报不存在');
        if (!['APPROVED', 'PAID'].includes(bill.status)) {
          throw new PaymentValidationError(409, 'BILL_NOT_APPROVED', '只有审批通过的进度款才可以登记到账');
        }
        if (!bill.mainContractId) throw new PaymentValidationError(409, 'MAIN_CONTRACT_REQUIRED', '请先建立主合同关联后再登记到账');
        const main = await tx.mainContract.findUnique({ where: { id: bill.mainContractId }, include: { project: { select: { code: true } } } });
        if (!main) throw new PaymentValidationError(409, 'MAIN_CONTRACT_REQUIRED', '关联的业主主合同不存在');
        const finalSettlement = await tx.ownerContractSettlement.findFirst({ where: { mainContractId: main.id, type: 'FINAL', status: 'POSTED' }, select: { id: true } });
        if (finalSettlement) throw new PaymentValidationError(409, 'OWNER_SETTLEMENT_COLLECTION_REQUIRED', '最终结算已过账，请进入“竣工结算与应收”按应收单登记到账，避免绕过最终结算净额校验');
        const paidCents = moneyToCents(bill.paidAmount) + moneyToCents(parsed.data.amount);
        const limitCents = moneyToCents(bill.approvedAmount ?? bill.amount);
        if (paidCents > limitCents) {
          throw new PaymentValidationError(400, 'PAYMENT_EXCEEDS_APPROVED', '累计到账金额不能超过核定金额');
        }
        const paid = centsToMoney(paidCents);
        let receivable = await tx.ownerReceivable.findUnique({ where: { sourceProgressBillId: billId }, include: { allocations: { select: { amount: true } } } });
        if (!receivable) {
          const receivableNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YS', date: new Date() });
          receivable = await tx.ownerReceivable.create({ data: { projectId, mainContractId: main.id, receivableNo, type: 'PROGRESS_BILL', title: `进度款第${bill.periodNo}期应收`, sourceProgressBillId: billId, grossAmount: centsToMoney(limitCents), advanceDeductionAmount: '0', retentionAmount: '0', otherDeductionAmount: '0', netAmount: centsToMoney(limitCents), status: 'OPEN', notes: bill.notes, createdById: user.sub }, include: { allocations: { select: { amount: true } } } });
        }
        const receivableAllocated = sumAllocations(receivable.allocations.map((allocation) => allocation.amount));
        const receivableOpen = calculateReceivableOpenCents(moneyToCents(receivable.netAmount), receivableAllocated);
        const contractReceivables = await tx.ownerReceivable.findMany({ where: { mainContractId: main.id }, select: { netAmount: true, allocations: { select: { amount: true } } } });
        const contractNetOpen = calculateContractNetOpenCents(contractReceivables.map((row) => ({ netCents: moneyToCents(row.netAmount), allocationCents: sumAllocations(row.allocations.map((allocation) => allocation.amount)) })));
        const requestedCents = moneyToCents(parsed.data.amount);
        if (requestedCents > capReceiptCents(requestedCents, receivableOpen, contractNetOpen)) throw new PaymentValidationError(400, 'RECEIPT_EXCEEDS_CONTRACT_OPEN', '本次到账超过该应收单或主合同扣除调整后的净应收余额');
        const receiptNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'SK', date: new Date(parsed.data.paidAt) });
        const receipt = await tx.ownerReceipt.create({ data: { projectId, mainContractId: main.id, receiptNo, type: 'RECEIPT', amount: String(parsed.data.amount), receivedAt: new Date(parsed.data.paidAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null, createdById: user.sub } });
        await tx.ownerReceiptAllocation.create({ data: { receiptId: receipt.id, receivableId: receivable.id, amount: String(parsed.data.amount), notes: '与原进度款到账台账同步' } });
        await tx.progressPayment.create({ data: { progressBillId: billId, amount: String(parsed.data.amount), paidAt: new Date(parsed.data.paidAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null } });
        const result = await tx.progressBill.update({ where: { id: billId }, data: { paidAmount: paid, status: paidCents >= limitCents ? 'PAID' : 'APPROVED' }, include: { payments: { orderBy: { paidAt: 'desc' } } } });
        await tx.ownerReceivable.update({ where: { id: receivable.id }, data: { status: paidCents >= limitCents ? 'RECEIVED' : (receivableAllocated + requestedCents > 0n ? 'PARTIALLY_RECEIVED' : 'OPEN') } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'OwnerReceipt', entityId: receipt.id, action: 'OWNER_RECEIPT_REGISTERED', changes: { receiptNo, receivableNo: receivable.receivableNo, amount: centsToMoney(requestedCents), paidAmount: paid, source: 'ProgressBill' } } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'ProgressBill', entityId: billId, action: 'PAYMENT_REGISTERED', changes: { amount: centsToMoney(requestedCents), paidAmount: paid } } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success(serialise(updated)));
    } catch (error) {
      if (error instanceof PaymentValidationError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return failure(reply, 409, 'PAYMENT_CONFLICT', '到账记录发生并发冲突，请刷新后重试');
      }
      throw error;
    }
  });
}
