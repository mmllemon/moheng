import type { FastifyInstance } from 'fastify';
import { DownstreamContractStatus, DownstreamContractType, DownstreamPaymentType, Prisma, ProjectRole } from '../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { calculateEffectiveContractAmount, moneyToCents, centsToMoney } from '../lib/contract-amount-math.js';
import { calculateContractCostGap, calculateDownstreamCurrentAmount, canRegisterPaymentForContractStatus } from '../lib/downstream-contract-math.js';
import { assertPaymentWithinBounds, assertRefundTargetsPayment, grossPaymentCents, netPaymentCents, refundPaymentCents } from '../lib/downstream-payment-math.js';
import { positiveMoney } from '../lib/validation.js';
import { resolveBusinessParty, downstreamPartyRole } from '../lib/business-party.js';
import { nextDocumentNumber } from '../lib/document-number.js';

const contractInput = z.object({
  contractNo: z.string().trim().max(80).optional().or(z.literal('')),
  name: z.string().trim().min(1).max(160),
  type: z.nativeEnum(DownstreamContractType),
  counterpartyName: z.string().trim().min(1).max(160),
  counterpartyPartyId: z.string().trim().min(1).nullable().optional(),
  scope: z.string().max(4000).optional().nullable(),
  signedAt: z.iso.datetime().optional().nullable(),
  startDate: z.iso.datetime().optional().nullable(),
  plannedEndDate: z.iso.datetime().optional().nullable(),
  originalAmount: positiveMoney,
  taxIncluded: z.boolean().default(true),
  paymentTerms: z.string().max(2000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
const contractStatusInput = z.object({ status: z.nativeEnum(DownstreamContractStatus) });
const adjustmentInput = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  direction: z.enum(['INCREASE', 'DECREASE']),
  amount: positiveMoney,
  effectiveAt: z.iso.datetime(),
  documentReference: z.string().trim().min(1).max(240),
  notes: z.string().max(2000).optional().nullable(),
});
const planInput = z.object({
  stageName: z.string().trim().min(1).max(120),
  dueAt: z.iso.datetime(),
  plannedAmount: positiveMoney,
  notes: z.string().max(1000).optional().nullable(),
});
const paymentInput = z.object({
  paymentPlanId: z.string().optional().nullable(),
  payableId: z.string().optional().nullable(),
  allocations: z.array(z.object({ payableId: z.string().min(1), payableScheduleId: z.string().min(1).optional().nullable(), amount: positiveMoney })).max(50).optional(),
  refundOfPaymentId: z.string().optional().nullable(),
  type: z.nativeEnum(DownstreamPaymentType).default('PROGRESS'),
  amount: positiveMoney,
  paidAt: z.iso.datetime(),
  referenceNo: z.string().trim().max(100).optional().nullable().transform((value) => value || null),
  notes: z.string().max(1000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.payableId && value.allocations?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allocations'], message: 'payableId 与 allocations 只能选一种核销方式' });
  if (value.allocations?.length && new Set(value.allocations.map((item) => `${item.payableId}::${item.payableScheduleId ?? 'NO_SCHEDULE'}`)).size !== value.allocations.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allocations'], message: '同一付款不得重复分配到同一应付单/期次' });
});

const money = (value: unknown) => Number(value ?? 0);
function signedAdjustment(direction: 'INCREASE' | 'DECREASE', amount: unknown): bigint {
  const cents = moneyToCents(amount);
  return direction === 'DECREASE' ? -cents : cents;
}
function sumCents(values: unknown[]): bigint {
  return values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n);
}
function currentAmountString(row: { originalAmount: unknown; adjustments?: { direction: 'INCREASE' | 'DECREASE'; amount: unknown }[] }) {
  return calculateDownstreamCurrentAmount(row.originalAmount, row.adjustments ?? []);
}
function serialiseContract(row: any) {
  const currentAmount = currentAmountString(row);
  const paymentRows = (row.payments ?? []) as { type: DownstreamPaymentType; amount: unknown }[];
  const paidCents = netPaymentCents(paymentRows);
  const grossPaidCents = grossPaymentCents(paymentRows);
  const refundedCents = refundPaymentCents(paymentRows);
  const costCents = sumCents((row.costEntries ?? []).map((entry: any) => entry.amount));
  const position = calculateContractCostGap({ status: row.status, currentAmount, linkedActualCost: centsToMoney(costCents) });
  const plans = (row.paymentPlans ?? []).map((plan: any) => {
    const planPaidCents = netPaymentCents((plan.payments ?? []) as { type: DownstreamPaymentType; amount: unknown }[]);
    return { ...plan, plannedAmount: money(plan.plannedAmount), paidAmount: Number(centsToMoney(planPaidCents)), remainingAmount: Number(centsToMoney(planPaidCents < moneyToCents(plan.plannedAmount) ? moneyToCents(plan.plannedAmount) - planPaidCents : 0n)), payments: (plan.payments ?? []).map((payment: any) => ({ ...payment, amount: money(payment.amount) })) };
  });
  return {
    ...row,
    originalAmount: money(row.originalAmount),
    currentAmount: money(currentAmount),
    adjustmentNetAmount: money(currentAmount) - money(row.originalAmount),
    paidAmount: Number(centsToMoney(paidCents)),
    grossPaidAmount: Number(centsToMoney(grossPaidCents)),
    refundAmount: Number(centsToMoney(refundedCents)),
    linkedActualCost: Number(centsToMoney(costCents)),
    contractValueMinusLinkedActualCost: money(position.contractValueMinusLinkedActualCost),
    linkedActualCostOverContractValue: money(position.linkedActualCostOverContractValue),
    adjustments: (row.adjustments ?? []).map((adjustment: any) => ({ ...adjustment, amount: money(adjustment.amount) })),
    paymentPlans: plans,
    payments: (row.payments ?? []).map((payment: any) => ({ ...payment, amount: money(payment.amount) })),
    payables: (row.payables ?? []).map((payable: any) => {
      const allocatedCents = (payable.paymentAllocations ?? []).reduce((sum: bigint, allocation: any) => sum + moneyToCents(allocation.amount), 0n);
      return { ...payable, grossAmount: money(payable.grossAmount), netAmount: money(payable.netAmount), allocatedPaymentAmount: Number(centsToMoney(allocatedCents)), openAmount: Number(centsToMoney(moneyToCents(payable.netAmount) - allocatedCents)), paymentAllocations: undefined };
    }),
    costEntries: undefined,
  };
}
const contractInclude = {
  adjustments: { orderBy: { effectiveAt: 'asc' as const } },
  paymentPlans: { include: { payments: { orderBy: { paidAt: 'desc' as const } } }, orderBy: { dueAt: 'asc' as const } },
  payments: { orderBy: { paidAt: 'desc' as const } },
  payables: { include: { paymentAllocations: true }, orderBy: { postedAt: 'desc' as const } },
  costEntries: { where: { deletedAt: null }, select: { amount: true } },
};

const allowedTransitions: Record<DownstreamContractStatus, DownstreamContractStatus[]> = {
  DRAFT: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['COMPLETED', 'TERMINATED'],
  COMPLETED: ['SETTLED', 'TERMINATED'],
  SETTLED: [],
  TERMINATED: [],
};

export async function downstreamContractRoutes(app: FastifyInstance) {
  app.get('/:projectId/downstream-contracts', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const rows = await prisma.downstreamContract.findMany({
      where: { projectId, deletedAt: null }, include: contractInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const serialised = rows.map(serialiseContract);
    const activeRows = serialised.filter((row) => row.status === 'ACTIVE');
    const commitmentRows = serialised.filter((row) => row.status === 'ACTIVE' || row.status === 'COMPLETED');
    const sumMoney = (values: unknown[]) => Number(centsToMoney(sumCents(values)));
    return success({
      items: serialised,
      summary: {
        contractCount: serialised.length,
        activeContractCount: activeRows.length,
        currentContractAmount: sumMoney(serialised.filter((row) => row.status !== 'TERMINATED').map((row) => row.currentAmount)),
        activeAndPendingSettlementContractAmount: sumMoney(commitmentRows.map((row) => row.currentAmount)),
        activeAndPendingSettlementContractCount: commitmentRows.length,
        paidAmount: sumMoney(serialised.map((row) => row.paidAmount)),
        grossPaidAmount: sumMoney(serialised.map((row) => row.grossPaidAmount)),
        refundedAmount: sumMoney(serialised.map((row) => row.refundAmount)),
        linkedActualCost: sumMoney(serialised.map((row) => row.linkedActualCost)),
        contractValueMinusLinkedActualCost: sumMoney(commitmentRows.map((row) => row.contractValueMinusLinkedActualCost)),
        linkedActualCostOverContractValue: sumMoney(commitmentRows.map((row) => row.linkedActualCostOverContractValue)),
      },
    });
  });

  app.post('/:projectId/downstream-contracts', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'DOWNSTREAM_CONTRACT_WRITE')) return;
    const parsed = contractInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '下游合同资料有误', parsed.error.flatten());
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, code: true } });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const party = await resolveBusinessParty(tx, { partyId: parsed.data.counterpartyPartyId, name: parsed.data.counterpartyName, role: downstreamPartyRole(parsed.data.type), actorUserId: user.sub, auditProjectId: projectId });
        const contractNo = parsed.data.contractNo?.trim() || await nextDocumentNumber(tx, { projectId, projectCode: project.code, type: 'FGHT', date: parsed.data.signedAt ? new Date(parsed.data.signedAt) : new Date() });
        const created = await tx.downstreamContract.create({ data: {
          projectId, contractNo, name: parsed.data.name, type: parsed.data.type,
          counterpartyName: party.name, counterpartyPartyId: party.id, scope: parsed.data.scope ?? null,
          signedAt: parsed.data.signedAt ? new Date(parsed.data.signedAt) : null,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          plannedEndDate: parsed.data.plannedEndDate ? new Date(parsed.data.plannedEndDate) : null,
          originalAmount: String(parsed.data.originalAmount), taxIncluded: parsed.data.taxIncluded,
          paymentTerms: parsed.data.paymentTerms ?? null, notes: parsed.data.notes ?? null,
          status: 'DRAFT', createdById: user.sub,
        }, include: contractInclude });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'DownstreamContract', entityId: created.id, action: 'CREATE_DRAFT', changes: { ...parsed.data, contractNo, originalAmount: String(parsed.data.originalAmount), status: 'DRAFT' } } });
        return created;
      });
      return reply.code(201).send(success(serialiseContract(row)));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_IDENTITY_UNVERIFIED') return failure(reply, 409, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', '该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NO_EXISTS', '该项目下合同编号已存在，或单位档案发生并发重复创建，请刷新后重试');
      throw error;
    }
  });

  app.patch('/:projectId/downstream-contracts/:contractId', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'DOWNSTREAM_CONTRACT_WRITE')) return;
    const parsed = contractInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '下游合同资料有误', parsed.error.flatten());
    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} FOR UPDATE`;
        const old = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null } });
        if (!old) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
        if (old.status !== 'DRAFT') throw new Error('DOWNSTREAM_CONTRACT_BASE_IMMUTABLE');
        const hasActivity = await tx.downstreamContractAdjustment.findFirst({ where: { downstreamContractId: contractId }, select: { id: true } })
          || await tx.downstreamContractPayment.findFirst({ where: { downstreamContractId: contractId }, select: { id: true } })
          || await tx.costEntry.findFirst({ where: { downstreamContractId: contractId, deletedAt: null }, select: { id: true } });
        if (hasActivity) throw new Error('DOWNSTREAM_CONTRACT_BASE_IMMUTABLE');
        const party = await resolveBusinessParty(tx, {
          partyId: parsed.data.counterpartyPartyId === undefined ? old.counterpartyPartyId : parsed.data.counterpartyPartyId,
          name: parsed.data.counterpartyName, role: downstreamPartyRole(parsed.data.type), actorUserId: user.sub, auditProjectId: projectId,
        });
        const claimed = await tx.downstreamContract.updateMany({
          where: { id: contractId, projectId, deletedAt: null, status: 'DRAFT' },
          data: {
            contractNo: parsed.data.contractNo?.trim() || old.contractNo, name: parsed.data.name, type: parsed.data.type,
            counterpartyName: party.name, counterpartyPartyId: party.id, scope: parsed.data.scope ?? null,
            signedAt: parsed.data.signedAt ? new Date(parsed.data.signedAt) : null,
            startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
            plannedEndDate: parsed.data.plannedEndDate ? new Date(parsed.data.plannedEndDate) : null,
            originalAmount: String(parsed.data.originalAmount), taxIncluded: parsed.data.taxIncluded,
            paymentTerms: parsed.data.paymentTerms ?? null, notes: parsed.data.notes ?? null,
          },
        });
        if (claimed.count !== 1) throw new Error('DOWNSTREAM_CONTRACT_STATE_CHANGED');
        const row = await tx.downstreamContract.findFirstOrThrow({ where: { id: contractId, projectId }, include: contractInclude });
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'DownstreamContract', entityId: contractId, action: 'UPDATE_DRAFT',
          changes: { from: { contractNo: old.contractNo, name: old.name, type: old.type, counterpartyName: old.counterpartyName, counterpartyPartyId: old.counterpartyPartyId, originalAmount: old.originalAmount.toString() }, to: { ...parsed.data, counterpartyName: party.name, counterpartyPartyId: party.id, originalAmount: String(parsed.data.originalAmount) } },
        } });
        return row;
      });
      return success(serialiseContract(updated));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_IDENTITY_UNVERIFIED') return failure(reply, 409, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', '该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '下游合同不存在');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_BASE_IMMUTABLE') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_BASE_IMMUTABLE', '合同激活后原始合同金额及基础资料锁定；若草稿已有业务记录，请先核对关联记录');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_STATE_CHANGED') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_STATE_CHANGED', '合同状态已变化，请刷新后重试');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NO_EXISTS', '该项目下游合同编号已存在');
      throw error;
    }
  });

  app.patch('/:projectId/downstream-contracts/:contractId/status', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'DOWNSTREAM_CONTRACT_ADMIN')) return;
    const parsed = contractStatusInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '合同状态参数不正确', parsed.error.flatten());
    const old = await prisma.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '下游合同不存在');
    if (!allowedTransitions[old.status].includes(parsed.data.status)) return failure(reply, 409, 'INVALID_STATUS_TRANSITION', `不能从“${old.status}”变更为“${parsed.data.status}”`);
    if (parsed.data.status === 'SETTLED') return failure(reply, 409, 'FINAL_SETTLEMENT_REQUIRED', '合同只能在最终结算单完成外部确认并正式过账后进入“结算已确认”状态；请到“结算与应付”完成结算流程');
    if (parsed.data.status === 'ACTIVE' && !old.signedAt) return failure(reply, 409, 'SIGNED_DATE_REQUIRED', '正式合同生效前必须填写合同签订日期；请在创建草稿时填写或联系维护人员更新合同资料');
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const claimed = await tx.downstreamContract.updateMany({ where: { id: contractId, projectId, deletedAt: null, status: old.status }, data: { status: parsed.data.status } });
        if (claimed.count !== 1) throw new Error('DOWNSTREAM_CONTRACT_STATE_CHANGED');
        const result = await tx.downstreamContract.findFirstOrThrow({ where: { id: contractId, projectId }, include: contractInclude });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'DownstreamContract', entityId: contractId, action: 'STATUS_CHANGE', changes: { from: old.status, to: result.status } } });
        return result;
      });
      return success(serialiseContract(updated));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_STATE_CHANGED') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_STATE_CHANGED', '合同状态已被其他人员更新，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/adjustments', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'DOWNSTREAM_CONTRACT_ADMIN')) return;
    const parsed = adjustmentInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '下游合同补充协议资料有误', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} FOR UPDATE`;
        const contract = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null } });
        if (!contract) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
        if (!['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('DOWNSTREAM_CONTRACT_NOT_ADJUSTABLE');
        if (new Date(parsed.data.effectiveAt).getTime() > Date.now()) throw new Error('AMENDMENT_EFFECTIVE_DATE_IN_FUTURE');
        const existing = await tx.downstreamContractAdjustment.findMany({ where: { downstreamContractId: contractId }, select: { direction: true, amount: true } });
        const currentAmount = calculateEffectiveContractAmount(contract.originalAmount, existing.map((item) => ({ direction: item.direction, amount: item.amount })));
        const nextAmount = calculateDownstreamCurrentAmount(currentAmount, [{ direction: parsed.data.direction, amount: parsed.data.amount }]);
        const nextCents = moneyToCents(nextAmount);
        const [paymentsBefore, plansBefore] = await Promise.all([
          tx.downstreamContractPayment.findMany({ where: { downstreamContractId: contractId }, select: { type: true, amount: true } }),
          tx.downstreamPaymentPlan.findMany({ where: { downstreamContractId: contractId }, select: { plannedAmount: true } }),
        ]);
        if (netPaymentCents(paymentsBefore) > nextCents) throw new Error('AMENDMENT_BELOW_PAID');
        if (sumCents(plansBefore.map((item) => item.plannedAmount)) > nextCents) throw new Error('AMENDMENT_BELOW_PLAN');
        const adjustment = await tx.downstreamContractAdjustment.create({ data: {
          downstreamContractId: contractId, code: parsed.data.code, name: parsed.data.name, direction: parsed.data.direction,
          amount: String(parsed.data.amount), effectiveAt: new Date(parsed.data.effectiveAt), documentReference: parsed.data.documentReference,
          notes: parsed.data.notes ?? null, createdById: user.sub,
        } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'DownstreamContractAdjustment', entityId: adjustment.id, action: 'EFFECTIVE_SIGNED_AMENDMENT_RECORDED', changes: { ...parsed.data, amount: String(parsed.data.amount), previousContractAmount: currentAmount, currentContractAmount: nextAmount, documentReference: parsed.data.documentReference } } });
        return adjustment;
      });
      return reply.code(201).send(success({ ...row, amount: money(row.amount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_IDENTITY_UNVERIFIED') return failure(reply, 409, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', '该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '下游合同不存在');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_ADJUSTABLE') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NOT_ADJUSTABLE', '只有执行中或完工待结算的合同可以登记已生效补充协议');
      if (error instanceof Error && error.message === 'AMENDMENT_EFFECTIVE_DATE_IN_FUTURE') return failure(reply, 400, 'AMENDMENT_EFFECTIVE_DATE_IN_FUTURE', '本入口只登记已经生效的补充协议；生效日期不能晚于当前时间');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE') return failure(reply, 409, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE', '该补充协议会使下游合同金额变为负数，已阻止登记');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_EXCEEDS_MAX') return failure(reply, 409, 'CONTRACT_AMOUNT_EXCEEDS_MAX', '补充后的合同金额超出数据库金额上限');
      if (error instanceof Error && error.message === 'AMENDMENT_BELOW_PAID') return failure(reply, 409, 'AMENDMENT_BELOW_PAID', '补充协议会使当前合同额低于累计净付款，请先核对超付、退款或抵扣安排');
      if (error instanceof Error && error.message === 'AMENDMENT_BELOW_PLAN') return failure(reply, 409, 'AMENDMENT_BELOW_PLAN', '补充协议会使当前合同额低于累计付款计划，请先调整付款计划再登记');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'DOWNSTREAM_ADJUSTMENT_CODE_EXISTS', '该合同的补充协议编号已存在');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/payment-plans', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'DOWNSTREAM_CONTRACT_WRITE')) return;
    const parsed = planInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '付款计划资料有误', parsed.error.flatten());
    try {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} FOR UPDATE`;
        const contract = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null } });
        if (!contract) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
        if (!['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('DOWNSTREAM_CONTRACT_NOT_PAYABLE');
        const adjustments = await tx.downstreamContractAdjustment.findMany({ where: { downstreamContractId: contractId }, select: { direction: true, amount: true } });
        const currentCents = moneyToCents(calculateDownstreamCurrentAmount(contract.originalAmount, adjustments));
        const existingPlans = await tx.downstreamPaymentPlan.findMany({ where: { downstreamContractId: contractId }, select: { plannedAmount: true } });
        const plannedCents = sumCents(existingPlans.map((item) => item.plannedAmount)) + moneyToCents(parsed.data.plannedAmount);
        if (plannedCents > currentCents) throw new Error('PAYMENT_PLAN_EXCEEDS_CONTRACT');
        const row = await tx.downstreamPaymentPlan.create({ data: { downstreamContractId: contractId, stageName: parsed.data.stageName, dueAt: new Date(parsed.data.dueAt), plannedAmount: String(parsed.data.plannedAmount), notes: parsed.data.notes ?? null } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'DownstreamPaymentPlan', entityId: row.id, action: 'CREATE', changes: { ...parsed.data, plannedAmount: String(parsed.data.plannedAmount) } } });
        return row;
      });
      return reply.code(201).send(success({ ...plan, plannedAmount: money(plan.plannedAmount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_IDENTITY_UNVERIFIED') return failure(reply, 409, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', '该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '下游合同不存在');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_PAYABLE') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NOT_PAYABLE', '只有执行中或完工待结算的合同可以设置付款计划');
      if (error instanceof Error && error.message === 'PAYMENT_PLAN_EXCEEDS_CONTRACT') return failure(reply, 409, 'PAYMENT_PLAN_EXCEEDS_CONTRACT', '付款计划累计金额不能超过当前有效合同额');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/payments', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'DOWNSTREAM_CONTRACT_WRITE')) return;
    const parsed = paymentInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '对下付款记录填写有误', parsed.error.flatten());
    try {
      const saved = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "DownstreamContract" WHERE "id" = ${contractId} AND "projectId" = ${projectId} FOR UPDATE`;
        const contract = await tx.downstreamContract.findFirst({ where: { id: contractId, projectId, deletedAt: null } });
        if (!contract) throw new Error('DOWNSTREAM_CONTRACT_NOT_FOUND');
        if (!canRegisterPaymentForContractStatus(contract.status)) throw new Error('DOWNSTREAM_CONTRACT_NOT_PAYABLE');
        const adjustments = await tx.downstreamContractAdjustment.findMany({ where: { downstreamContractId: contractId }, select: { direction: true, amount: true } });
        const currentCents = moneyToCents(calculateDownstreamCurrentAmount(contract.originalAmount, adjustments));
        const allPayments = await tx.downstreamContractPayment.findMany({ where: { downstreamContractId: contractId }, select: { id: true, type: true, amount: true, paymentPlanId: true, refundOfPaymentId: true } });
        const requestedCents = moneyToCents(parsed.data.amount);
        let effectivePlanId = parsed.data.paymentPlanId ?? null;
        let effectivePayableId = parsed.data.payableId ?? null;
        const requestedAllocations: { payableId: string; amount: number; payableScheduleId?: string | null }[] = parsed.data.allocations ?? (effectivePayableId ? [{ payableId: effectivePayableId, payableScheduleId: null, amount: parsed.data.amount }] : []);
        let planBalance: { plannedAmount: unknown; payments: { type: DownstreamPaymentType; amount: unknown }[] } | null = null;
        if (parsed.data.type === 'REFUND') {
          if (effectivePayableId || requestedAllocations.length) throw new Error('REFUND_PAYABLE_MUST_BE_INFERRED');
          const originalPayment = assertRefundTargetsPayment({ existingPayments: allPayments, refundOfPaymentId: parsed.data.refundOfPaymentId, requestedAmount: parsed.data.amount, requestedPlanId: parsed.data.paymentPlanId });
          effectivePlanId = originalPayment.paymentPlanId ?? null;
        } else if (parsed.data.refundOfPaymentId) {
          throw new Error('REFUND_TARGET_ONLY_FOR_REFUNDS');
        }
        const contractPayables = await tx.downstreamPayable.findMany({ where: { downstreamContractId: contractId }, select: { id: true } });
        if (contractPayables.length > 0 && !['ADVANCE', 'REFUND'].includes(parsed.data.type) && !requestedAllocations.length) throw new Error('PAYABLE_ALLOCATION_REQUIRED');
        if (parsed.data.type === 'ADVANCE' && requestedAllocations.length) throw new Error('ADVANCE_CANNOT_ALLOCATE_PAYABLE');
        if (requestedAllocations.length) {
          if (sumCents(requestedAllocations.map((item) => item.amount)) !== requestedCents) throw new Error('PAYMENT_ALLOCATIONS_TOTAL_MISMATCH');
          const groupedRequested = new Map<string, bigint>();
          for (const allocation of requestedAllocations) groupedRequested.set(allocation.payableId, (groupedRequested.get(allocation.payableId) ?? 0n) + moneyToCents(allocation.amount));
          for (const [payableId, totalForPayable] of groupedRequested) {
            const target = await tx.downstreamPayable.findFirst({ where: { id: payableId, downstreamContractId: contractId }, select: { id: true, netAmount: true } });
            if (!target) throw new Error('PAYABLE_INVALID');
            const existing = await tx.downstreamPaymentAllocation.findMany({ where: { payableId: target.id }, select: { amount: true } });
            const existingOpen = moneyToCents(target.netAmount) - sumCents(existing.map((item) => item.amount));
            if (existingOpen <= 0n) throw new Error('PAYABLE_ALREADY_CLEARED');
            if (totalForPayable > existingOpen) throw new Error('PAYMENT_EXCEEDS_OPEN_PAYABLE');
          }
          for (const allocation of requestedAllocations) {
            const targetPayable = await tx.downstreamPayable.findFirst({ where: { id: allocation.payableId, downstreamContractId: contractId }, select: { id: true, type: true, netAmount: true } });
            if (!targetPayable) throw new Error('PAYABLE_INVALID');
            if (parsed.data.type === 'RETENTION' && targetPayable.type !== 'RETENTION_RELEASE') throw new Error('RETENTION_PAYMENT_REQUIRES_RELEASE_PAYABLE');
            if (parsed.data.type !== 'RETENTION' && targetPayable.type === 'RETENTION_RELEASE') throw new Error('RETENTION_RELEASE_REQUIRES_RETENTION_PAYMENT');
            const schedules = await tx.downstreamPayableSchedule.findMany({ where: { payableId: targetPayable.id }, select: { id: true } });
            let checkedScheduleId: string | null = null;
            if (schedules.length > 0) {
              if (!allocation.payableScheduleId) throw new Error('PAYABLE_SCHEDULE_REQUIRED');
              const schedule = await tx.downstreamPayableSchedule.findFirst({ where: { id: allocation.payableScheduleId, payableId: targetPayable.id }, include: { allocations: { select: { amount: true } } } });
              if (!schedule) throw new Error('PAYABLE_SCHEDULE_INVALID');
              const scheduleOpen = moneyToCents(schedule.amount) - sumCents(schedule.allocations.map((item) => item.amount));
              if (scheduleOpen <= 0n) throw new Error('PAYABLE_SCHEDULE_ALREADY_CLEARED');
              if (moneyToCents(allocation.amount) > scheduleOpen) throw new Error('PAYMENT_EXCEEDS_OPEN_PAYABLE_SCHEDULE');
              checkedScheduleId = schedule.id;
            } else if (allocation.payableScheduleId) {
              throw new Error('PAYABLE_SCHEDULE_INVALID');
            }
            const allocations = await tx.downstreamPaymentAllocation.findMany({ where: { payableId: targetPayable.id }, select: { amount: true } });
            const openCents = moneyToCents(targetPayable.netAmount) - sumCents(allocations.map((item) => item.amount));
            if (openCents <= 0n) throw new Error('PAYABLE_ALREADY_CLEARED');
            if (moneyToCents(allocation.amount) > openCents) throw new Error('PAYMENT_EXCEEDS_OPEN_PAYABLE');
            (allocation as any).payableScheduleId = checkedScheduleId;
          }
        }
        if (effectivePlanId) {
          const plan = await tx.downstreamPaymentPlan.findFirst({ where: { id: effectivePlanId, downstreamContractId: contractId } });
          if (!plan) throw new Error('PAYMENT_PLAN_INVALID');
          const planPayments = await tx.downstreamContractPayment.findMany({ where: { paymentPlanId: plan.id }, select: { type: true, amount: true } });
          planBalance = { plannedAmount: plan.plannedAmount, payments: planPayments };
        }
        assertPaymentWithinBounds({
          existingPayments: allPayments,
          requestedType: parsed.data.type,
          requestedAmount: parsed.data.amount,
          currentContractAmount: centsToMoney(currentCents),
          paymentIsAllocatedToPayable: requestedAllocations.length > 0,
          plan: planBalance,
        });
        const paidCents = netPaymentCents(allPayments);
        const payment = await tx.downstreamContractPayment.create({ data: {
          downstreamContractId: contractId, paymentPlanId: effectivePlanId, refundOfPaymentId: parsed.data.type === 'REFUND' ? (parsed.data.refundOfPaymentId ?? null) : null, type: parsed.data.type,
          amount: String(parsed.data.amount), paidAt: new Date(parsed.data.paidAt), referenceNo: parsed.data.referenceNo ?? null,
          notes: parsed.data.notes ?? null, createdById: user.sub,
        } });
        if (requestedAllocations.length) {
          for (const allocation of requestedAllocations) await tx.downstreamPaymentAllocation.create({ data: { paymentId: payment.id, payableId: allocation.payableId, payableScheduleId: allocation.payableScheduleId ?? null, amount: String(allocation.amount), notes: '登记付款时自动核销应付余额' } });
        }
        if (parsed.data.type === 'REFUND' && parsed.data.refundOfPaymentId) {
          const originalAllocations = await tx.downstreamPaymentAllocation.findMany({ where: { paymentId: parsed.data.refundOfPaymentId }, select: { payableId: true, payableScheduleId: true, amount: true } });
          const priorRefundIds = allPayments.filter((item) => item.type === 'REFUND' && item.refundOfPaymentId === parsed.data.refundOfPaymentId).map((item) => item.id);
          const priorRefundAllocations = priorRefundIds.length ? await tx.downstreamPaymentAllocation.findMany({ where: { paymentId: { in: priorRefundIds } }, select: { payableId: true, payableScheduleId: true, amount: true } }) : [];
          let amountToReverse = requestedCents;
          for (const originalAllocation of originalAllocations) {
            if (amountToReverse <= 0n) break;
            const alreadyReversed = sumCents(priorRefundAllocations.filter((item) => item.payableId === originalAllocation.payableId && item.payableScheduleId === originalAllocation.payableScheduleId).map((item) => item.amount));
            const remainingAllocated = moneyToCents(originalAllocation.amount) + alreadyReversed;
            if (remainingAllocated <= 0n) continue;
            const reverseCents = remainingAllocated < amountToReverse ? remainingAllocated : amountToReverse;
            await tx.downstreamPaymentAllocation.create({ data: { paymentId: payment.id, payableId: originalAllocation.payableId, payableScheduleId: originalAllocation.payableScheduleId ?? null, amount: String(centsToMoney(-reverseCents)), notes: '退款自动冲回原付款的应付核销' } });
            amountToReverse -= reverseCents;
          }
        }
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'DownstreamContractPayment', entityId: payment.id, action: parsed.data.type === 'REFUND' ? 'PAYMENT_REFUND_RECORDED' : 'PAYMENT_RECORDED', changes: { ...parsed.data, paymentPlanId: effectivePlanId, payableId: requestedAllocations.length === 1 ? (requestedAllocations[0]?.payableId ?? null) : null, allocationCount: requestedAllocations.length, refundOfPaymentId: parsed.data.type === 'REFUND' ? (parsed.data.refundOfPaymentId ?? null) : null, amount: String(parsed.data.amount), grossCumulativePaid: centsToMoney(grossPaymentCents(allPayments) + (parsed.data.type === 'REFUND' ? 0n : requestedCents)), cumulativeRefunds: centsToMoney(refundPaymentCents(allPayments) + (parsed.data.type === 'REFUND' ? requestedCents : 0n)), cumulativeNetPaid: centsToMoney(paidCents + (parsed.data.type === 'REFUND' ? -requestedCents : requestedCents)), currentContractAmount: centsToMoney(currentCents), payableAllocationCreated: requestedAllocations.length > 0, actualCostUnaffected: true } } });
        return payment;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ ...saved, amount: money(saved.amount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_IDENTITY_UNVERIFIED') return failure(reply, 409, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', '该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选往来单位不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选往来单位已停用或归档，不能用于新合同');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '下游合同不存在');
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_PAYABLE') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NOT_PAYABLE', '只有执行中、完工待结算或结算已确认的合同可以登记付款/退款');
      if (error instanceof Error && error.message === 'PAYMENT_EXCEEDS_CONTRACT') return failure(reply, 409, 'PAYMENT_EXCEEDS_CONTRACT', '累计净付款金额不能超过当前有效合同额');
      if (error instanceof Error && error.message === 'REFUND_ORIGINAL_PAYMENT_REQUIRED') return failure(reply, 400, 'REFUND_ORIGINAL_PAYMENT_REQUIRED', '退款必须关联一笔原始付款记录');
      if (error instanceof Error && error.message === 'REFUND_ORIGINAL_PAYMENT_INVALID') return failure(reply, 400, 'REFUND_ORIGINAL_PAYMENT_INVALID', '所选原始付款不存在、不是本合同付款或本身就是退款记录');
      if (error instanceof Error && error.message === 'REFUND_PAYMENT_PLAN_MISMATCH') return failure(reply, 400, 'REFUND_PAYMENT_PLAN_MISMATCH', '退款关联的付款计划必须与原始付款一致');
      if (error instanceof Error && error.message === 'REFUND_EXCEEDS_ORIGINAL_PAYMENT') return failure(reply, 409, 'REFUND_EXCEEDS_ORIGINAL_PAYMENT', '该笔累计退款不能超过原始付款金额');
      if (error instanceof Error && error.message === 'REFUND_TARGET_ONLY_FOR_REFUNDS') return failure(reply, 400, 'REFUND_TARGET_ONLY_FOR_REFUNDS', '只有退款记录可以关联原始付款');
      if (error instanceof Error && error.message === 'REFUND_EXCEEDS_NET_PAID') return failure(reply, 409, 'REFUND_EXCEEDS_NET_PAID', '退款金额不能超过该合同当前净已付款金额');
      if (error instanceof Error && error.message === 'REFUND_EXCEEDS_PLAN_PAID') return failure(reply, 409, 'REFUND_EXCEEDS_PLAN_PAID', '退款金额不能超过该付款计划的净已付款金额');
      if (error instanceof Error && error.message === 'PAYMENT_PLAN_INVALID') return failure(reply, 400, 'PAYMENT_PLAN_INVALID', '所选付款计划不存在或不属于此合同');
      if (error instanceof Error && error.message === 'PAYMENT_EXCEEDS_PLAN') return failure(reply, 400, 'PAYMENT_EXCEEDS_PLAN', '该付款计划累计付款不能超过计划金额');
      if (error instanceof Error && error.message === 'PAYABLE_ALLOCATION_REQUIRED') return failure(reply, 409, 'PAYABLE_ALLOCATION_REQUIRED', '该合同已启用结算应付台账；普通付款必须选择已确认应付单进行核销，请从“结算与应付”登记付款');
      if (error instanceof Error && error.message === 'ADVANCE_CANNOT_ALLOCATE_PAYABLE') return failure(reply, 400, 'ADVANCE_CANNOT_ALLOCATE_PAYABLE', '预付款作为预付款余额管理，不应直接核销结算应付单');
      if (error instanceof Error && error.message === 'REFUND_PAYABLE_MUST_BE_INFERRED') return failure(reply, 400, 'REFUND_PAYABLE_MUST_BE_INFERRED', '退款自动反向冲回原付款已核销的应付余额，无需手工选择应付单');
      if (error instanceof Error && error.message === 'PAYABLE_INVALID') return failure(reply, 400, 'PAYABLE_INVALID', '所选应付单不存在或不属于当前分供合同');
      if (error instanceof Error && error.message === 'PAYABLE_ALREADY_CLEARED') return failure(reply, 409, 'PAYABLE_ALREADY_CLEARED', '该应付单已无可支付余额');
      if (error instanceof Error && error.message === 'PAYMENT_EXCEEDS_OPEN_PAYABLE') return failure(reply, 409, 'PAYMENT_EXCEEDS_OPEN_PAYABLE', '本次付款分配金额超过所选应付单的未付余额');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_REQUIRED') return failure(reply, 409, 'PAYABLE_SCHEDULE_REQUIRED', '该应付单已设置付款分期，请选择本次付款对应的到期分期');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_INVALID') return failure(reply, 400, 'PAYABLE_SCHEDULE_INVALID', '所选分期不存在或不属于该应付单');
      if (error instanceof Error && error.message === 'PAYABLE_SCHEDULE_ALREADY_CLEARED') return failure(reply, 409, 'PAYABLE_SCHEDULE_ALREADY_CLEARED', '该应付分期已无可支付余额');
      if (error instanceof Error && error.message === 'PAYMENT_EXCEEDS_OPEN_PAYABLE_SCHEDULE') return failure(reply, 409, 'PAYMENT_EXCEEDS_OPEN_PAYABLE_SCHEDULE', '本次付款超过所选分期的未付余额');
      if (error instanceof Error && error.message === 'PAYMENT_ALLOCATIONS_TOTAL_MISMATCH') return failure(reply, 400, 'PAYMENT_ALLOCATIONS_TOTAL_MISMATCH', '多个应付单的核销分配合计必须等于本次付款金额');
      if (error instanceof Error && error.message === 'RETENTION_PAYMENT_REQUIRES_RELEASE_PAYABLE') return failure(reply, 409, 'RETENTION_PAYMENT_REQUIRES_RELEASE_PAYABLE', '质保金付款必须对应已经确认释放的质保金应付单');
      if (error instanceof Error && error.message === 'RETENTION_RELEASE_REQUIRES_RETENTION_PAYMENT') return failure(reply, 409, 'RETENTION_RELEASE_REQUIRES_RETENTION_PAYMENT', '该应付单来源为质保金释放，请将付款类型选择为质保金');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'PAYMENT_REFERENCE_DUPLICATE', '该合同的银行流水/付款参考号已登记，系统已阻止重复记账');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'PAYMENT_CONFLICT', '付款登记发生并发冲突，请刷新后重试');
      throw error;
    }
  });
}
