import type { FastifyInstance } from 'fastify';
import { OwnerReceivableType, OwnerSettlementStatus, OwnerSettlementType, OwnerReceiptType, OwnerRetentionMovementType, OwnerAdvanceMovementType, Prisma, ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nextDocumentNumber } from '../lib/document-number.js';
import { moneyToCents, centsToMoney } from '../lib/contract-amount-math.js';
import { calculateContractNetOpenCents, calculateOwnerReceivableStatus, calculateOwnerSettlementDelta, calculateReceivableOpenCents, capReceiptCents } from '../lib/owner-settlement-math.js';
import { positiveMoney } from '../lib/validation.js';

const signedMoney = z.number().finite().min(-999999999999999).max(999999999999999);
const lineInput = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().finite().nonnegative().optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  unitPrice: z.number().finite().nonnegative().optional().nullable(),
  amount: signedMoney,
});
const createSettlementInput = z.object({
  type: z.nativeEnum(OwnerSettlementType),
  settlementNo: z.string().trim().max(80).optional().nullable(),
  submittedAmount: signedMoney,
  dueAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  lines: z.array(lineInput).max(300).optional().default([]),
}).superRefine((value, ctx) => {
  if (value.type === 'FINAL' && value.submittedAmount < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['submittedAmount'], message: '最终累计结算金额不能为负数' });
  if (value.type === 'ADJUSTMENT' && value.submittedAmount === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['submittedAmount'], message: '调整金额不能为 0' });
  if (value.lines.length > 0) {
    const sum = value.lines.reduce((acc, line) => acc + moneyToCents(line.amount), 0n);
    if (sum !== moneyToCents(value.submittedAmount)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines'], message: '可选明细合计必须等于报审金额；无明细时允许纯金额结算' });
  }
});
const settlementActionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SUBMIT') }),
  z.object({ action: z.literal('APPROVE') }),
  z.object({ action: z.literal('REJECT'), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('CONFIRM'), confirmedAmount: signedMoney, confirmationReference: z.string().trim().min(1).max(240), confirmedAt: z.string().datetime(), dueAt: z.string().datetime().optional().nullable(), advanceDeductionAmount: z.number().finite().nonnegative().default(0), retentionAmount: z.number().finite().nonnegative().default(0), otherDeductionAmount: z.number().finite().nonnegative().default(0), notes: z.string().max(2000).optional().nullable() }),
  z.object({ action: z.literal('POST') }),
]);
const receiptInput = z.object({ amount: positiveMoney, receivedAt: z.string().datetime(), referenceNo: z.string().max(100).optional().nullable(), scheduleId: z.string().optional().nullable(), notes: z.string().max(2000).optional().nullable() });
const refundInput = z.object({ amount: positiveMoney, receivedAt: z.string().datetime(), referenceNo: z.string().max(100).optional().nullable(), notes: z.string().max(2000).optional().nullable() });
const advanceInput = z.object({ amount: positiveMoney, receivedAt: z.string().datetime(), referenceNo: z.string().max(100).optional().nullable(), notes: z.string().max(2000).optional().nullable() });
const retentionInput = z.object({ amount: positiveMoney, effectiveAt: z.string().datetime(), dueAt: z.string().datetime().optional().nullable(), reference: z.string().trim().min(1).max(240), notes: z.string().max(2000).optional().nullable() });
const scheduleInput = z.object({ schedules: z.array(z.object({ scheduleNo: z.string().trim().min(1).max(30), dueAt: z.string().datetime(), amount: positiveMoney, notes: z.string().max(1000).optional().nullable() })).min(1).max(50) });

class OwnerFinanceError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); this.name = 'OwnerFinanceError'; }
}
const num = (value: unknown) => Number(value ?? 0);
const amountString = (cents: bigint) => centsToMoney(cents);
function sumCents(values: unknown[]): bigint { return values.reduce<bigint>((acc, value) => acc + moneyToCents(value), 0n); }
function statusForOpen(netAmount: unknown, allocated: bigint) {
  return calculateOwnerReceivableStatus(moneyToCents(netAmount), allocated);
}
async function getContractNetOpenCents(tx: Prisma.TransactionClient, mainContractId: string) {
  const rows = await tx.ownerReceivable.findMany({
    where: { mainContractId },
    select: { netAmount: true, allocations: { select: { amount: true } } },
  });
  return calculateContractNetOpenCents(rows.map((row) => ({
    netCents: moneyToCents(row.netAmount),
    allocationCents: sumCents(row.allocations.map((allocation) => allocation.amount)),
  })));
}
async function audit(tx: Prisma.TransactionClient, projectId: string, userId: string, entity: string, entityId: string, action: string, changes: unknown) {
  // Serialize at the persistence boundary so unknown values cannot violate Prisma's JSON input contract.
  const safeChanges = JSON.parse(JSON.stringify(changes) ?? '{}') as Prisma.InputJsonObject;
  await tx.auditLog.create({ data: { projectId, userId, entity, entityId, action, changes: safeChanges } });
}
async function refreshReceivableStatus(tx: Prisma.TransactionClient, receivableId: string) {
  const row = await tx.ownerReceivable.findUnique({ where: { id: receivableId }, include: { allocations: { select: { amount: true } } } });
  if (!row) return;
  const allocated = sumCents(row.allocations.map((item) => item.amount));
  await tx.ownerReceivable.update({ where: { id: receivableId }, data: { status: statusForOpen(row.netAmount, allocated) } });
}
function serialiseReceivable(row: any) {
  const allocations = row.allocations ?? [];
  const allocatedCents = sumCents(allocations.map((item: any) => item.amount));
  const netCents = moneyToCents(row.netAmount);
  return { ...row, grossAmount: num(row.grossAmount), advanceDeductionAmount: num(row.advanceDeductionAmount), retentionAmount: num(row.retentionAmount), otherDeductionAmount: num(row.otherDeductionAmount), netAmount: num(row.netAmount), allocatedAmount: num(centsToMoney(allocatedCents)), openAmount: num(centsToMoney(netCents - allocatedCents)), schedules: (row.schedules ?? []).map((schedule: any) => { const scheduleAllocated = sumCents((schedule.allocations ?? []).map((a: any) => a.amount)); return { id: schedule.id, receivableId: schedule.receivableId, scheduleNo: schedule.scheduleNo, dueAt: schedule.dueAt, amount: num(schedule.amount), allocatedAmount: num(centsToMoney(scheduleAllocated)), openAmount: num(centsToMoney(moneyToCents(schedule.amount) - scheduleAllocated)), notes: schedule.notes }; }), allocations: allocations.map((a: any) => ({ ...a, amount: num(a.amount), receipt: a.receipt ? { ...a.receipt, amount: num(a.receipt.amount) } : undefined })) };
}
function serialiseSettlement(row: any) {
  return { ...row, submittedAmount: num(row.submittedAmount), confirmedAmount: row.confirmedAmount == null ? null : num(row.confirmedAmount), postedDeltaAmount: row.postedDeltaAmount == null ? null : num(row.postedDeltaAmount), previousCumulativeAmount: row.previousCumulativeAmount == null ? null : num(row.previousCumulativeAmount), cumulativeAfterAmount: row.cumulativeAfterAmount == null ? null : num(row.cumulativeAfterAmount), advanceDeductionAmount: num(row.advanceDeductionAmount), retentionAmount: num(row.retentionAmount), otherDeductionAmount: num(row.otherDeductionAmount), netReceivableAmount: row.netReceivableAmount == null ? null : num(row.netReceivableAmount), lines: (row.lines ?? []).map((line: any) => ({ ...line, quantity: line.quantity == null ? null : num(line.quantity), unitPrice: line.unitPrice == null ? null : num(line.unitPrice), amount: num(line.amount) })) };
}

export async function ownerFinanceRoutes(app: FastifyInstance) {
  app.get('/:projectId/owner-finance', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const main = await prisma.mainContract.findUnique({ where: { projectId }, include: { project: { select: { id: true, code: true, name: true, ownerName: true } } } });
    if (!main) return success({ hasMainContract: false, mainContract: null, summary: null, settlements: [], receivables: [], receipts: [], retentionMovements: [], advanceMovements: [] });
    const [settlementRows, receivableRows, receiptRows, retentionRows, advanceRows] = await Promise.all([
      prisma.ownerContractSettlement.findMany({ where: { projectId, mainContractId: main.id }, include: { lines: { orderBy: { sortOrder: 'asc' } }, posting: true }, orderBy: [{ createdAt: 'desc' }] }),
      prisma.ownerReceivable.findMany({
        where: { projectId, mainContractId: main.id },
        include: {
          schedules: { include: { allocations: { select: { amount: true } } }, orderBy: { dueAt: 'asc' } },
          allocations: {
            include: {
              receipt: { select: { id: true, receiptNo: true, type: true, amount: true, receivedAt: true, referenceNo: true } },
              schedule: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { postedAt: 'desc' },
      }),
      prisma.ownerReceipt.findMany({
        where: { projectId, mainContractId: main.id },
        include: {
          allocations: { include: { receivable: { select: { id: true, receivableNo: true, title: true } } } },
          refunds: { select: { id: true, amount: true } },
          advanceMovements: true,
        },
        orderBy: { receivedAt: 'desc' },
      }),
      prisma.ownerRetentionMovement.findMany({ where: { projectId, mainContractId: main.id }, orderBy: { effectiveAt: 'desc' } }),
      prisma.ownerAdvanceMovement.findMany({ where: { projectId, mainContractId: main.id }, orderBy: { occurredAt: 'desc' } }),
    ]);
    const receivableBase = receivableRows.map(serialiseReceivable);
    const contractNetOpenCents = sumCents(receivableBase.map((r: any) => Math.round(r.openAmount * 100)));
    const contractNetOpenAmount = Number(centsToMoney(contractNetOpenCents));
    const receivables = receivableBase.map((r: any) => ({
      ...r,
      collectionLimitAmount: Math.max(0, Math.min(Math.max(0, r.openAmount), Math.max(0, contractNetOpenAmount))),
    }));
    const receipts = receiptRows.map((row: any) => ({ ...row, amount: num(row.amount), refundAmount: num(row.refunds.reduce((sum: number, item: any) => sum + num(item.amount), 0)), refundableAmount: Math.max(0, num(row.amount) - row.refunds.reduce((sum: number, item: any) => sum + num(item.amount), 0)), allocations: row.allocations.map((a: any) => ({ ...a, amount: num(a.amount) })) }));
    const totalGrossCents = sumCents(receivables.filter((r: any) => ['PROGRESS_BILL', 'FINAL_SETTLEMENT', 'ADJUSTMENT'].includes(r.type)).map((r: any) => r.grossAmount));
    const postedNetCents = sumCents(receivables.map((r: any) => r.netAmount).filter((value: number) => value > 0));
    const openCents = sumCents(receivables.map((r: any) => Math.max(0, Math.round(r.openAmount * 100))));
    const creditCents = sumCents(receivables.map((r: any) => Math.max(0, Math.round(-r.openAmount * 100))));
    const overdueCents = sumCents(receivables.filter((r: any) => r.dueAt && new Date(r.dueAt).getTime() < Date.now()).map((r: any) => Math.max(0, Math.round(r.openAmount * 100))));
    const appliedCents = sumCents(receivables.map((r: any) => r.allocatedAmount));
    const retentionCents = retentionRows.reduce((sum, row) => sum + (row.type === 'WITHHOLD' ? moneyToCents(row.amount) : -moneyToCents(row.amount)), 0n);
    const advanceCents = advanceRows.reduce((sum, row) => sum + (row.type === 'RECEIPT' ? moneyToCents(row.amount) : -moneyToCents(row.amount)), 0n);
    const receiptNetCents = receipts.reduce((sum: bigint, row: any) => sum + ((row.type === 'RECEIPT' ? 1n : row.type === 'REFUND' ? -1n : 0n) * moneyToCents(row.amount)), 0n);
    return success({
      hasMainContract: true,
      mainContract: { id: main.id, contractNo: main.contractNo, name: main.name, amount: num(main.amount), taxIncluded: main.taxIncluded, retentionRate: num(main.retentionRate), advanceDeductionRate: num(main.advanceDeductionRate), guaranteeEndAt: main.guaranteeEndAt, project: main.project },
      summary: { approvedAndPostedGrossAmount: num(centsToMoney(totalGrossCents)), positiveReceivablePostedAmount: num(centsToMoney(postedNetCents)), receivedNetAmount: num(centsToMoney(appliedCents)), cashReceiptNetAmount: num(centsToMoney(receiptNetCents)), openReceivableAmount: num(centsToMoney(openCents)), contractNetOpenAmount, overdueReceivableAmount: num(centsToMoney(overdueCents)), customerCreditAmount: num(centsToMoney(creditCents)), retentionBalanceAmount: num(centsToMoney(retentionCents)), advanceBalanceAmount: num(centsToMoney(advanceCents)), settlementCount: settlementRows.length, receivableCount: receivables.length, receiptCount: receipts.length },
      settlements: settlementRows.map(serialiseSettlement), receivables, receipts,
      retentionMovements: retentionRows.map((r) => ({ ...r, amount: num(r.amount) })),
      advanceMovements: advanceRows.map((r) => ({ ...r, amount: num(r.amount) })),
    });
  });

  app.post('/:projectId/owner-finance/settlements', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = createSettlementInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '业主结算资料有误', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        const main = await tx.mainContract.findUnique({ where: { projectId }, include: { project: { select: { code: true } } } });
        if (!main) throw new OwnerFinanceError(409, 'MAIN_CONTRACT_REQUIRED', '请先登记业主主合同');
        const no = parsed.data.settlementNo?.trim() || await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YJJS', date: new Date() });
        const created = await tx.ownerContractSettlement.create({ data: { projectId, mainContractId: main.id, settlementNo: no, type: parsed.data.type, submittedAmount: String(parsed.data.submittedAmount), dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, notes: parsed.data.notes ?? null, createdById: user.sub, lines: { create: parsed.data.lines.map((line, index) => ({ ...line, quantity: line.quantity == null ? null : String(line.quantity), unitPrice: line.unitPrice == null ? null : String(line.unitPrice), amount: String(line.amount), sortOrder: index })) } }, include: { lines: true } });
        await audit(tx, projectId, user.sub, 'OwnerContractSettlement', created.id, 'OWNER_SETTLEMENT_DRAFT_CREATED', { settlementNo: no, type: parsed.data.type, submittedAmount: String(parsed.data.submittedAmount), optionalLines: true, lineCount: parsed.data.lines.length });
        return created;
      });
      return reply.code(201).send(success(serialiseSettlement(row)));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Error && error.message === 'PROJECT_CODE_REQUIRED_FOR_DOCUMENT_NUMBER') return failure(reply, 409, 'PROJECT_CODE_REQUIRED', '项目编号缺失，无法生成业务编号');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'SETTLEMENT_NO_EXISTS', '结算编号已存在，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/owner-finance/settlements/:settlementId/action', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, settlementId } = request.params as { projectId: string; settlementId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = settlementActionInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '结算操作参数有误', parsed.error.flatten());
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const settlement = await tx.ownerContractSettlement.findFirst({ where: { id: settlementId, projectId }, include: { lines: true } });
        if (!settlement) throw new OwnerFinanceError(404, 'SETTLEMENT_NOT_FOUND', '业主结算单不存在');
        const main = await tx.mainContract.findUnique({ where: { id: settlement.mainContractId }, include: { project: { select: { code: true } } } });
        if (!main) throw new OwnerFinanceError(409, 'MAIN_CONTRACT_REQUIRED', '关联主合同不存在');
        const a = parsed.data;
        if (a.action === 'SUBMIT') {
          if (!['DRAFT', 'REJECTED'].includes(settlement.status)) throw new OwnerFinanceError(409, 'INVALID_STATUS_TRANSITION', '只有草稿或退回结算单可以提交');
          const result = await tx.ownerContractSettlement.update({ where: { id: settlementId }, data: { status: 'SUBMITTED', submittedById: user.sub, rejectedById: null, rejectionReason: null } });
          await audit(tx, projectId, user.sub, 'OwnerContractSettlement', settlementId, 'OWNER_SETTLEMENT_SUBMITTED', { from: settlement.status, to: result.status }); return result;
        }
        if (a.action === 'APPROVE') {
          if (settlement.status !== 'SUBMITTED') throw new OwnerFinanceError(409, 'INVALID_STATUS_TRANSITION', '只有已提交的结算单可以内部审核');
          if (settlement.submittedById === user.sub || settlement.createdById === user.sub) throw new OwnerFinanceError(403, 'SELF_APPROVAL_BLOCKED', '提交人/创建人不得审批本人提交的结算业务');
          const result = await tx.ownerContractSettlement.update({ where: { id: settlementId }, data: { status: 'INTERNAL_APPROVED', approvedById: user.sub } });
          await audit(tx, projectId, user.sub, 'OwnerContractSettlement', settlementId, 'OWNER_SETTLEMENT_INTERNAL_APPROVED', { from: settlement.status, to: result.status }); return result;
        }
        if (a.action === 'REJECT') {
          if (!['SUBMITTED', 'INTERNAL_APPROVED'].includes(settlement.status)) throw new OwnerFinanceError(409, 'INVALID_STATUS_TRANSITION', '当前状态不允许退回');
          const result = await tx.ownerContractSettlement.update({ where: { id: settlementId }, data: { status: 'REJECTED', rejectedById: user.sub, rejectionReason: a.reason } });
          await audit(tx, projectId, user.sub, 'OwnerContractSettlement', settlementId, 'OWNER_SETTLEMENT_REJECTED', { from: settlement.status, reason: a.reason }); return result;
        }
        if (a.action === 'CONFIRM') {
          if (settlement.status !== 'INTERNAL_APPROVED') throw new OwnerFinanceError(409, 'INVALID_STATUS_TRANSITION', '只有内部审核通过的结算单可以登记外部确认');
          if (settlement.type === 'FINAL' && a.confirmedAmount < 0) throw new OwnerFinanceError(400, 'FINAL_AMOUNT_NEGATIVE', '最终累计结算金额不能为负数');
          if (settlement.type === 'ADJUSTMENT' && a.confirmedAmount === 0) throw new OwnerFinanceError(400, 'ADJUSTMENT_AMOUNT_ZERO', '调整金额不能为 0');
          const result = await tx.ownerContractSettlement.update({ where: { id: settlementId }, data: { status: 'COUNTERPARTY_CONFIRMED', confirmedAmount: String(a.confirmedAmount), confirmationReference: a.confirmationReference, confirmedAt: new Date(a.confirmedAt), confirmedById: user.sub, dueAt: a.dueAt ? new Date(a.dueAt) : null, advanceDeductionAmount: String(a.advanceDeductionAmount), retentionAmount: String(a.retentionAmount), otherDeductionAmount: String(a.otherDeductionAmount), ...(a.notes !== undefined ? { notes: a.notes } : {}) } });
          await audit(tx, projectId, user.sub, 'OwnerContractSettlement', settlementId, 'OWNER_SETTLEMENT_COUNTERPARTY_CONFIRMED', { confirmedAmount: String(a.confirmedAmount), confirmationReference: a.confirmationReference, confirmedAt: a.confirmedAt, dueAt: a.dueAt, advanceDeductionAmount: String(a.advanceDeductionAmount), retentionAmount: String(a.retentionAmount), otherDeductionAmount: String(a.otherDeductionAmount) }); return result;
        }
        if (settlement.status !== 'COUNTERPARTY_CONFIRMED' || settlement.confirmedAmount == null) throw new OwnerFinanceError(409, 'INVALID_STATUS_TRANSITION', '只有登记外部确认的结算单可以过账');
        if (await tx.ownerSettlementPosting.findUnique({ where: { settlementId }, select: { id: true } })) throw new OwnerFinanceError(409, 'ALREADY_POSTED', '该结算单已经过账，禁止重复生成应收');
        await tx.$queryRaw`SELECT "id" FROM "MainContract" WHERE "id" = ${main.id} FOR UPDATE`;
        if (settlement.type === 'FINAL') {
          const existingFinal = await tx.ownerContractSettlement.findFirst({ where: { mainContractId: main.id, type: 'FINAL', status: 'POSTED', id: { not: settlementId } }, select: { id: true } });
          if (existingFinal) throw new OwnerFinanceError(409, 'FINAL_SETTLEMENT_ALREADY_POSTED', '最终结算已经过账，如需修正请建立调整单');
        }
        const priorRows = await tx.ownerReceivable.findMany({ where: { mainContractId: main.id, type: { in: ['PROGRESS_BILL', 'FINAL_SETTLEMENT', 'ADJUSTMENT'] } }, select: { grossAmount: true } });
        const previous = sumCents(priorRows.map((r) => r.grossAmount));
        const confirmed = moneyToCents(settlement.confirmedAmount);
        const delta = calculateOwnerSettlementDelta(settlement.type, confirmed, previous);
        const advanceDeduction = moneyToCents(settlement.advanceDeductionAmount);
        const retention = moneyToCents(settlement.retentionAmount);
        const otherDeduction = moneyToCents(settlement.otherDeductionAmount);
        if (delta <= 0n && (advanceDeduction !== 0n || retention !== 0n || otherDeduction !== 0n)) throw new OwnerFinanceError(400, 'NEGATIVE_DELTA_DEDUCTIONS', '负向调整不允许重复录入预付款扣回、质保金留置或其他扣款');
        if (advanceDeduction + retention + otherDeduction > delta) throw new OwnerFinanceError(400, 'DEDUCTIONS_EXCEED_DELTA', '预付款扣回、质保金及其他扣款合计不能超过本次正向结算增量');
        const advanceRows = await tx.ownerAdvanceMovement.findMany({ where: { mainContractId: main.id }, select: { type: true, amount: true } });
        const advanceBalance = advanceRows.reduce((sum, r) => sum + (r.type === 'RECEIPT' ? moneyToCents(r.amount) : -moneyToCents(r.amount)), 0n);
        if (advanceDeduction > advanceBalance) throw new OwnerFinanceError(400, 'ADVANCE_DEDUCTION_EXCEEDS_BALANCE', '预付款扣回不能超过业主已支付且尚未扣回/退回的预付款余额');
        const net = delta - advanceDeduction - retention - otherDeduction;
        const effectiveDate = new Date();
        const receivableNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YS', date: effectiveDate });
        const receivable = await tx.ownerReceivable.create({ data: { projectId, mainContractId: main.id, receivableNo, type: settlement.type === 'FINAL' ? 'FINAL_SETTLEMENT' : 'ADJUSTMENT', title: settlement.type === 'FINAL' ? '竣工结算增量应收' : '合同结算调整应收', sourceSettlementId: settlementId, grossAmount: amountString(delta), advanceDeductionAmount: amountString(advanceDeduction), retentionAmount: amountString(retention), otherDeductionAmount: amountString(otherDeduction), netAmount: amountString(net), dueAt: settlement.dueAt, status: net === 0n ? 'RECEIVED' : 'OPEN', notes: settlement.notes, createdById: user.sub, postedAt: effectiveDate } });
        await tx.ownerSettlementPosting.create({ data: { projectId, mainContractId: main.id, settlementId, previousCumulativeAmount: amountString(previous), deltaAmount: amountString(delta), cumulativeAfterAmount: amountString(previous + delta), postedById: user.sub } });
        if (advanceDeduction > 0n) await tx.ownerAdvanceMovement.create({ data: { projectId, mainContractId: main.id, settlementId, type: 'DEDUCTION', amount: amountString(advanceDeduction), occurredAt: effectiveDate, reference: settlement.settlementNo, notes: '结算过账扣回业主预付款', createdById: user.sub } });
        if (retention > 0n) await tx.ownerRetentionMovement.create({ data: { projectId, mainContractId: main.id, settlementId, type: 'WITHHOLD', amount: amountString(retention), effectiveAt: effectiveDate, reference: settlement.settlementNo, notes: '结算过账留置质保金', createdById: user.sub } });
        if (net > 0n && settlement.dueAt) await tx.ownerReceivableSchedule.create({ data: { receivableId: receivable.id, scheduleNo: '01', dueAt: settlement.dueAt, amount: amountString(net), notes: '由结算过账自动生成首期应收安排' } });
        const result = await tx.ownerContractSettlement.update({ where: { id: settlementId }, data: { status: 'POSTED', previousCumulativeAmount: amountString(previous), postedDeltaAmount: amountString(delta), cumulativeAfterAmount: amountString(previous + delta), netReceivableAmount: amountString(net), postedAt: effectiveDate } });
        await audit(tx, projectId, user.sub, 'OwnerContractSettlement', settlementId, 'OWNER_SETTLEMENT_POSTED', { settlementNo: settlement.settlementNo, previousCumulativeAmount: amountString(previous), deltaAmount: amountString(delta), cumulativeAfterAmount: amountString(previous + delta), netReceivableAmount: amountString(net), receivableNo });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success(serialiseSettlement(saved));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'OWNER_FINANCE_CONFLICT', '业主结算发生并发冲突，请刷新后重试');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'OWNER_FINANCE_DUPLICATE', '编号或业务关联已存在，请刷新后核对');
      throw error;
    }
  });

  app.post('/:projectId/owner-finance/receivables/:receivableId/receipts', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, receivableId } = request.params as { projectId: string; receivableId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = receiptInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '到账记录填写有误', parsed.error.flatten());
    try {
      const receipt = await prisma.$transaction(async (tx) => {
        const ar = await tx.ownerReceivable.findFirst({ where: { id: receivableId, projectId }, include: { mainContract: true, allocations: { select: { amount: true } }, schedules: true } });
        if (!ar) throw new OwnerFinanceError(404, 'RECEIVABLE_NOT_FOUND', '应收账款不存在');
        if (moneyToCents(ar.netAmount) <= 0n) throw new OwnerFinanceError(409, 'RECEIVABLE_NOT_PAYABLE', '负向调整或零金额应收不能登记普通到账');
        const allocated = sumCents(ar.allocations.map((a) => a.amount));
        const open = calculateReceivableOpenCents(moneyToCents(ar.netAmount), allocated);
        const amount = moneyToCents(parsed.data.amount);
        const contractNetOpen = await getContractNetOpenCents(tx, ar.mainContractId);
        if (amount > capReceiptCents(amount, open, contractNetOpen)) {
          throw new OwnerFinanceError(400, 'RECEIPT_EXCEEDS_CONTRACT_OPEN', '本次到账不能超过所选应收单未收余额及该主合同扣除负向调整后的净应收余额');
        }
        if (parsed.data.scheduleId) {
          const schedule = ar.schedules.find((s) => s.id === parsed.data.scheduleId);
          if (!schedule) throw new OwnerFinanceError(400, 'SCHEDULE_NOT_FOUND', '所选应收期次不属于该应收单');
          const scheduleAllocated = await tx.ownerReceiptAllocation.aggregate({ where: { scheduleId: schedule.id }, _sum: { amount: true } });
          if (amount > moneyToCents(schedule.amount) - moneyToCents(scheduleAllocated._sum.amount ?? 0)) throw new OwnerFinanceError(400, 'RECEIPT_EXCEEDS_SCHEDULE', '本次到账超过该期应收余额');
        }
        const receiptNo = await nextDocumentNumber(tx, { projectId, projectCode: (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } })).code, type: 'SK', date: new Date(parsed.data.receivedAt) });
        const created = await tx.ownerReceipt.create({ data: { projectId, mainContractId: ar.mainContractId, receiptNo, type: 'RECEIPT', amount: String(parsed.data.amount), receivedAt: new Date(parsed.data.receivedAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null, createdById: user.sub } });
        await tx.ownerReceiptAllocation.create({ data: { receiptId: created.id, receivableId, scheduleId: parsed.data.scheduleId ?? null, amount: String(parsed.data.amount), notes: parsed.data.notes ?? null } });
        if (ar.sourceProgressBillId) {
          const bill = await tx.progressBill.findUnique({ where: { id: ar.sourceProgressBillId } });
          if (bill) {
            await tx.progressPayment.create({ data: { progressBillId: bill.id, amount: String(parsed.data.amount), paidAt: new Date(parsed.data.receivedAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null } });
            const currentPaid = sumCents((await tx.ownerReceiptAllocation.findMany({ where: { receivableId }, select: { amount: true } })).map((x) => x.amount));
            await tx.progressBill.update({ where: { id: bill.id }, data: { paidAmount: amountString(currentPaid), status: currentPaid >= moneyToCents(bill.approvedAmount ?? bill.amount) ? 'PAID' : 'APPROVED' } });
          }
        }
        const newAllocated = allocated + amount;
        await tx.ownerReceivable.update({ where: { id: receivableId }, data: { status: statusForOpen(ar.netAmount, newAllocated) } });
        await audit(tx, projectId, user.sub, 'OwnerReceipt', created.id, 'OWNER_RECEIPT_REGISTERED', { receiptNo, receivableNo: ar.receivableNo, amount: String(parsed.data.amount), receivedAt: parsed.data.receivedAt, referenceNo: parsed.data.referenceNo });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ ...receipt, amount: num(receipt.amount) }));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'OWNER_RECEIPT_CONFLICT', '到账记录发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/owner-finance/receipts/:receiptId/refund', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, receiptId } = request.params as { projectId: string; receiptId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = refundInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '退款记录填写有误', parsed.error.flatten());
    try {
      const refund = await prisma.$transaction(async (tx) => {
        const original = await tx.ownerReceipt.findFirst({ where: { id: receiptId, projectId }, include: { allocations: { orderBy: { createdAt: 'asc' }, include: { receivable: true } }, refunds: { select: { amount: true } } } });
        if (!original || original.type !== 'RECEIPT') throw new OwnerFinanceError(404, 'RECEIPT_NOT_REFUNDABLE', '找不到可退款的业主到账记录');
        const refundedCents = sumCents(original.refunds.map((x) => x.amount));
        const requested = moneyToCents(parsed.data.amount);
        if (requested > moneyToCents(original.amount) - refundedCents) throw new OwnerFinanceError(400, 'REFUND_EXCEEDS_RECEIPT', '累计退款不能超过原到账金额的剩余可退金额');
        const originals = original.allocations.filter((a) => moneyToCents(a.amount) > 0n);
        const reversals = await tx.ownerReceiptAllocation.findMany({ where: { reversesId: { in: originals.map((a) => a.id) } }, select: { reversesId: true, amount: true } });
        const reversedBy = new Map<string, bigint>();
        for (const r of reversals) if (r.reversesId) reversedBy.set(r.reversesId, (reversedBy.get(r.reversesId) ?? 0n) + moneyToCents(r.amount));
        let left = requested;
        const allocations: { original: typeof originals[number]; amount: bigint }[] = [];
        for (const allocation of originals) {
          const remaining = moneyToCents(allocation.amount) + (reversedBy.get(allocation.id) ?? 0n);
          if (remaining <= 0n) continue;
          const take = remaining < left ? remaining : left;
          if (take > 0n) allocations.push({ original: allocation, amount: take });
          left -= take;
          if (left === 0n) break;
        }
        if (left !== 0n) throw new OwnerFinanceError(400, 'REFUND_EXCEEDS_ALLOCATED_RECEIPT', '原到账记录可反向核销金额不足，请核对原始分配');
        const receiptNo = await nextDocumentNumber(tx, { projectId, projectCode: (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } })).code, type: 'TK', date: new Date(parsed.data.receivedAt) });
        const created = await tx.ownerReceipt.create({ data: { projectId, mainContractId: original.mainContractId, receiptNo, type: 'REFUND', amount: String(parsed.data.amount), receivedAt: new Date(parsed.data.receivedAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null, originalReceiptId: original.id, createdById: user.sub } });
        const touchedReceivables = new Set<string>();
        for (const allocation of allocations) {
          await tx.ownerReceiptAllocation.create({ data: { receiptId: created.id, receivableId: allocation.original.receivableId, scheduleId: allocation.original.scheduleId, amount: amountString(-allocation.amount), reversesId: allocation.original.id, notes: '退款反向恢复原到账核销' } });
          touchedReceivables.add(allocation.original.receivableId);
          // Keep the legacy progress-bill payment ledger aligned with the canonical owner receipt ledger.
          const sourceBillId = allocation.original.receivable.sourceProgressBillId;
          if (sourceBillId) {
            await tx.progressPayment.create({ data: {
              progressBillId: sourceBillId,
              amount: amountString(-allocation.amount),
              paidAt: new Date(parsed.data.receivedAt),
              referenceNo: parsed.data.referenceNo ?? null,
              type: 'REFUND',
              originalReceiptNo: original.receiptNo,
              notes: `退款冲回到账 ${original.receiptNo}${parsed.data.notes ? `；${parsed.data.notes}` : ''}`,
            } });
          }
        }
        for (const id of touchedReceivables) {
          const ar = await tx.ownerReceivable.findUnique({ where: { id }, include: { allocations: { select: { amount: true } } } });
          if (!ar) continue;
          const netAllocated = sumCents(ar.allocations.map((x) => x.amount));
          await tx.ownerReceivable.update({ where: { id }, data: { status: statusForOpen(ar.netAmount, netAllocated) } });
          if (ar.sourceProgressBillId) {
            const bill = await tx.progressBill.findUnique({ where: { id: ar.sourceProgressBillId } });
            if (bill) await tx.progressBill.update({ where: { id: bill.id }, data: { paidAmount: amountString(netAllocated), status: netAllocated >= moneyToCents(bill.approvedAmount ?? bill.amount) ? 'PAID' : 'APPROVED' } });
          }
        }
        await audit(tx, projectId, user.sub, 'OwnerReceipt', created.id, 'OWNER_RECEIPT_REFUNDED', { receiptNo, originalReceiptNo: original.receiptNo, originalReceiptId: original.id, amount: String(parsed.data.amount), reversedAllocations: allocations.map((a) => ({ allocationId: a.original.id, amount: amountString(-a.amount) })) });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ ...refund, amount: num(refund.amount) }));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'OWNER_REFUND_CONFLICT', '退款发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/owner-finance/advances', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = advanceInput.safeParse(request.body); if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '业主预付款资料有误', parsed.error.flatten());
    try {
      const created = await prisma.$transaction(async (tx) => {
        const main = await tx.mainContract.findUnique({ where: { projectId }, include: { project: { select: { code: true } } } });
        if (!main) throw new OwnerFinanceError(409, 'MAIN_CONTRACT_REQUIRED', '请先登记业主主合同');
        const receiptNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YF', date: new Date(parsed.data.receivedAt) });
        const receipt = await tx.ownerReceipt.create({ data: { projectId, mainContractId: main.id, receiptNo, type: 'ADVANCE', amount: String(parsed.data.amount), receivedAt: new Date(parsed.data.receivedAt), referenceNo: parsed.data.referenceNo ?? null, notes: parsed.data.notes ?? null, createdById: user.sub } });
        await tx.ownerAdvanceMovement.create({ data: { projectId, mainContractId: main.id, receiptId: receipt.id, type: 'RECEIPT', amount: String(parsed.data.amount), occurredAt: new Date(parsed.data.receivedAt), reference: parsed.data.referenceNo ?? receiptNo, notes: parsed.data.notes ?? null, createdById: user.sub } });
        await audit(tx, projectId, user.sub, 'OwnerReceipt', receipt.id, 'OWNER_ADVANCE_RECEIVED', { receiptNo, amount: String(parsed.data.amount), receivedAt: parsed.data.receivedAt, referenceNo: parsed.data.referenceNo });
        return receipt;
      });
      return reply.code(201).send(success({ ...created, amount: num(created.amount) }));
    } catch (error) { if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message); throw error; }
  });

  app.post('/:projectId/owner-finance/retention/release', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = retentionInput.safeParse(request.body); if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '质保金释放资料有误', parsed.error.flatten());
    try {
      const created = await prisma.$transaction(async (tx) => {
        const main = await tx.mainContract.findUnique({ where: { projectId }, include: { project: { select: { code: true } } } });
        if (!main) throw new OwnerFinanceError(409, 'MAIN_CONTRACT_REQUIRED', '请先登记业主主合同');
        const final = await tx.ownerContractSettlement.findFirst({ where: { mainContractId: main.id, type: 'FINAL', status: 'POSTED' }, select: { id: true } });
        if (!final) throw new OwnerFinanceError(409, 'FINAL_SETTLEMENT_REQUIRED', '业主侧最终结算过账前不能释放质保金');
        const movements = await tx.ownerRetentionMovement.findMany({ where: { mainContractId: main.id }, select: { type: true, amount: true } });
        const balance = movements.reduce((sum, r) => sum + (r.type === 'WITHHOLD' ? moneyToCents(r.amount) : -moneyToCents(r.amount)), 0n);
        const amount = moneyToCents(parsed.data.amount); if (amount > balance) throw new OwnerFinanceError(400, 'RETENTION_EXCEEDS_BALANCE', '释放金额超过当前质保金余额');
        const movement = await tx.ownerRetentionMovement.create({ data: { projectId, mainContractId: main.id, type: 'RELEASE', amount: String(parsed.data.amount), effectiveAt: new Date(parsed.data.effectiveAt), reference: parsed.data.reference, notes: parsed.data.notes ?? null, createdById: user.sub } });
        const receivableNo = await nextDocumentNumber(tx, { projectId, projectCode: main.project.code, type: 'YS', date: new Date(parsed.data.effectiveAt) });
        const ar = await tx.ownerReceivable.create({ data: { projectId, mainContractId: main.id, receivableNo, type: 'RETENTION_RELEASE', title: '业主质保金释放应收', sourceRetentionMovementId: movement.id, grossAmount: String(parsed.data.amount), advanceDeductionAmount: '0', retentionAmount: '0', otherDeductionAmount: '0', netAmount: String(parsed.data.amount), dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, status: 'OPEN', notes: parsed.data.notes ?? null, createdById: user.sub }, include: { schedules: true, allocations: true } });
        if (parsed.data.dueAt) await tx.ownerReceivableSchedule.create({ data: { receivableId: ar.id, scheduleNo: '01', dueAt: new Date(parsed.data.dueAt), amount: String(parsed.data.amount), notes: '由质保金释放生成' } });
        await audit(tx, projectId, user.sub, 'OwnerRetentionMovement', movement.id, 'OWNER_RETENTION_RELEASED', { reference: parsed.data.reference, amount: String(parsed.data.amount), receivableNo });
        return { movement, receivable: ar };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ movement: { ...created.movement, amount: num(created.movement.amount) }, receivable: serialiseReceivable(created.receivable) }));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'OWNER_RETENTION_CONFLICT', '质保金余额发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.put('/:projectId/owner-finance/receivables/:receivableId/schedules', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, receivableId } = request.params as { projectId: string; receivableId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'OWNER_FINANCE_WRITE')) return;
    const parsed = scheduleInput.safeParse(request.body); if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '应收分期资料有误', parsed.error.flatten());
    const sum = sumCents(parsed.data.schedules.map((s) => s.amount));
    try {
      const result = await prisma.$transaction(async (tx) => {
        const ar = await tx.ownerReceivable.findFirst({ where: { id: receivableId, projectId }, include: { allocations: true, schedules: true } });
        if (!ar) throw new OwnerFinanceError(404, 'RECEIVABLE_NOT_FOUND', '应收账款不存在');
        if (moneyToCents(ar.netAmount) <= 0n) throw new OwnerFinanceError(400, 'RECEIVABLE_NOT_POSITIVE', '负向调整不能设置正向分期');
        if (ar.allocations.length > 0) throw new OwnerFinanceError(409, 'SCHEDULE_LOCKED_AFTER_RECEIPT', '已有到账或退款核销，不能重写分期历史');
        if (sum !== moneyToCents(ar.netAmount)) throw new OwnerFinanceError(400, 'SCHEDULE_TOTAL_MISMATCH', '各期金额之和必须严格等于应收净额');
        await tx.ownerReceivableSchedule.deleteMany({ where: { receivableId } });
        await tx.ownerReceivableSchedule.createMany({ data: parsed.data.schedules.map((s) => ({ receivableId, scheduleNo: s.scheduleNo, dueAt: new Date(s.dueAt), amount: String(s.amount), notes: s.notes ?? null })) });
        await audit(tx, projectId, user.sub, 'OwnerReceivable', receivableId, 'OWNER_RECEIVABLE_SCHEDULES_REPLACED', { receivableNo: ar.receivableNo, schedules: parsed.data.schedules });
        return tx.ownerReceivableSchedule.findMany({ where: { receivableId }, orderBy: { dueAt: 'asc' } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return success(result.map((s) => ({ ...s, amount: num(s.amount) })));
    } catch (error) {
      if (error instanceof OwnerFinanceError) return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'OWNER_SCHEDULE_CONFLICT', '分期修改发生并发冲突，请刷新后重试');
      throw error;
    }
  });
}
