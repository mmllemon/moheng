import type { FastifyInstance } from 'fastify';
import { ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney } from '../lib/validation.js';
import { recalculateEffectiveContractAmount } from '../lib/contract-amount.js';
import { classifyOriginalAmountUpdate } from '../lib/contract-base-policy.js';
import { moneyToCents } from '../lib/contract-amount-math.js';
import { resolveBusinessParty } from '../lib/business-party.js';
import { nextDocumentNumber } from '../lib/document-number.js';

const contractInput = z.object({
  counterpartyPartyId: z.string().trim().min(1).nullable().optional(),
  counterpartyName: z.string().trim().min(2).max(200).optional(),
  contractNo: z.string().trim().max(80).optional().or(z.literal('')),
  name: z.string().trim().min(1).max(160),
  signedAt: z.string().datetime().optional().nullable(),
  amount: nonNegativeMoney,
  taxIncluded: z.boolean().default(true),
  retentionRate: z.number().min(0).max(1).default(0.03),
  advanceDeductionRate: z.number().min(0).max(1).default(0),
  paymentTerms: z.string().max(2000).optional().nullable(),
  guaranteeEndAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

function serialise(contract: any) {
  if (!contract) return null;
  return { ...contract, amount: Number(contract.amount), retentionRate: Number(contract.retentionRate), advanceDeductionRate: Number(contract.advanceDeductionRate) };
}

export async function contractRoutes(app: FastifyInstance) {
  app.get('/:projectId/contracts/main', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const contract = await prisma.mainContract.findUnique({ where: { projectId } });
    if (!contract) return success(null);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { contractAmount: true, originalContractAmount: true, ownerPartyId: true, ownerName: true, ownerParty: { select: { id: true, name: true, creditCode: true, contactName: true, phone: true, address: true, taxNo: true, invoiceTitle: true } } } });
    return success({ ...serialise(contract), counterpartyPartyId: project?.ownerPartyId ?? null, counterpartyParty: project?.ownerParty ?? null, effectiveAmount: Number(project?.contractAmount ?? contract.amount), originalContractAmount: Number(project?.originalContractAmount ?? contract.amount) });
  });

  app.put('/:projectId/contracts/main', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR])) return;
    const parsed = contractInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '主合同资料有误', parsed.error.flatten());
    const exists = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
    if (!exists) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
    const values = {
      name: parsed.data.name,
      signedAt: parsed.data.signedAt ? new Date(parsed.data.signedAt) : null,
      amount: String(parsed.data.amount),
      taxIncluded: parsed.data.taxIncluded,
      retentionRate: String(parsed.data.retentionRate),
      advanceDeductionRate: String(parsed.data.advanceDeductionRate),
      paymentTerms: parsed.data.paymentTerms ?? null,
      guaranteeEndAt: parsed.data.guaranteeEndAt ? new Date(parsed.data.guaranteeEndAt) : null,
      notes: parsed.data.notes ?? null,
    };
    try {
      const contract = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const project = await tx.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, code: true, originalContractAmount: true, ownerPartyId: true, ownerName: true },
      });
      if (!project) throw new Error('PROJECT_NOT_FOUND');
      const before = await tx.mainContract.findUnique({ where: { projectId } });
      const party = await resolveBusinessParty(tx, {
        partyId: parsed.data.counterpartyPartyId === undefined ? project.ownerPartyId : parsed.data.counterpartyPartyId,
        name: parsed.data.counterpartyName ?? project.ownerName, role: 'OWNER', actorUserId: user.sub, auditProjectId: projectId,
      });
      const priorExternalConfirmation = await tx.change.findFirst({
        where: { projectId, deletedAt: null, externalConfirmedAmount: { not: null } },
        select: { id: true },
      });
      if (before && moneyToCents(before.amount) !== moneyToCents(project.originalContractAmount)) {
        throw new Error('BASE_CONTRACT_DATA_MISMATCH');
      }
      if (before && moneyToCents(before.amount) !== moneyToCents(parsed.data.amount)) {
        throw new Error('ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE');
      }
      const decision = classifyOriginalAmountUpdate({
        currentAmount: project.originalContractAmount,
        requestedAmount: parsed.data.amount,
        hasMainContract: Boolean(before),
        hasExternalConfirmation: Boolean(priorExternalConfirmation),
      });
      if (decision === 'IMMUTABLE') throw new Error('ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE');
      const contractNo = parsed.data.contractNo?.trim() || before?.contractNo || await nextDocumentNumber(tx, { projectId, projectCode: project.code, type: 'HT', date: parsed.data.signedAt ? new Date(parsed.data.signedAt) : new Date() });
      const saved = await tx.mainContract.upsert({ where: { projectId }, create: { projectId, ...values, contractNo }, update: { ...values, contractNo } });
      await tx.project.update({ where: { id: projectId }, data: { ownerPartyId: party.id, ownerName: party.name } });
      // Older records may predate mainContractId. Once the project's main contract
      // exists, link only those unlinked historical revenue-side records; never
      // move rows already linked to a specific contract.
      const [linkedBills, linkedChanges] = await Promise.all([
        tx.progressBill.updateMany({ where: { projectId, mainContractId: null }, data: { mainContractId: saved.id } }),
        tx.change.updateMany({ where: { projectId, mainContractId: null }, data: { mainContractId: saved.id } }),
      ]);
      if (linkedBills.count > 0 || linkedChanges.count > 0) {
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'MainContract', entityId: saved.id,
          action: 'LEGACY_REVENUE_RECORDS_LINKED',
          changes: { progressBillsLinked: linkedBills.count, changesLinked: linkedChanges.count, mainContractId: saved.id },
        } });
      }
      if (decision === 'INITIAL_BASE_UPDATE') {
        await tx.project.update({ where: { id: projectId }, data: { originalContractAmount: String(parsed.data.amount) } });
      }
      const effectiveAmount = await recalculateEffectiveContractAmount(tx, projectId);
      await tx.auditLog.create({ data: {
        projectId, userId: user.sub, entity: 'MainContract', entityId: saved.id, action: 'UPSERT',
        changes: {
          ...parsed.data, amount: String(parsed.data.amount),
          previousBaseAmount: project.originalContractAmount.toString(),
          originalContractAmount: decision === 'INITIAL_BASE_UPDATE' ? String(parsed.data.amount) : project.originalContractAmount.toString(),
          effectiveContractAmount: effectiveAmount,
        },
      } });
      return saved;
    });
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { contractAmount: true, originalContractAmount: true } });
      return success({ ...serialise(contract), counterpartyPartyId: (await prisma.project.findUnique({ where: { id: projectId }, select: { ownerPartyId: true } }))?.ownerPartyId ?? null, effectiveAmount: Number(project?.contractAmount ?? contract.amount), originalContractAmount: Number(project?.originalContractAmount ?? contract.amount) });
    } catch (error) {
      if (error instanceof Error && error.message === 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE') return failure(reply, 409, 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE', '原始合同金额已锁定。合同调整请登记变更签证，不得直接改写原始金额');
      if (error instanceof Error && error.message === 'BASE_CONTRACT_DATA_MISMATCH') return failure(reply, 409, 'BASE_CONTRACT_DATA_MISMATCH', '主合同台账金额与项目原始合同金额不一致，请先核对历史数据，不可直接覆盖');
      if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE') return failure(reply, 409, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE', '该原始合同金额会导致当前有效合同额为负数，已阻止保存');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_EXCEEDS_MAX') return failure(reply, 409, 'CONTRACT_AMOUNT_EXCEEDS_MAX', '当前有效合同额超过数据库 DECIMAL(18,2) 上限，已阻止保存');
      throw error;
    }
  });
}
