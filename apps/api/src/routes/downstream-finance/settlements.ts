import type { FastifyInstance } from 'fastify';
import { centsToMoney, moneyToCents } from '../../lib/contract-amount-math.js';
import { failure, success } from '../../lib/http.js';
import { nextDocumentNumber } from '../../lib/document-number.js';
import { sumCents, settlementInput, rejectInput, confirmInput, payableScheduleInput } from './schemas.js';
import { Prisma, DownstreamPayableType } from '../../generated/prisma/client.js';
import { authRequired, authUser } from '../../lib/auth.js';
import { asAmount, serializeSettlement, serializePayable, hasProjectWriteAccess, lockContract, writeAudit, transitionSettlement } from './helpers.js';
import { prisma } from '../../lib/prisma.js';
import { assertOptionalLineTotal, assertPayableScheduleTotal, calculateAdvanceBalance, calculateNetPayable, calculatePostedSettlementDelta } from '../../lib/downstream-settlement-math.js';

export async function registerSettlementRoutes(app: FastifyInstance) {
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
      const mappedError = error instanceof Error ? map[error.message] : undefined;
      if (mappedError) { const [status, code, message] = mappedError; return failure(reply, status, code, message); }
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

}
