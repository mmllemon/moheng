import type { FastifyInstance } from 'fastify';
import { CostType, ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney, positiveMoney } from '../lib/validation.js';

const costInput = z.object({
  type: z.nativeEnum(CostType),
  date: z.string().datetime(),
  amount: positiveMoney,
  taxAmount: nonNegativeMoney.optional().nullable(),
  budgetItemId: z.string().optional().nullable(),
  downstreamContractId: z.string().optional().nullable(),
  businessPartyId: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(240),
  quantity: z.number().nonnegative().optional().nullable(),
  unit: z.string().max(32).optional().nullable(),
  unitPrice: z.number().nonnegative().optional().nullable(),
  invoiceNo: z.string().max(100).optional().nullable(),
  vendorName: z.string().max(160).optional().nullable(),
  teamName: z.string().max(160).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function serialise(entry: any) {
  return { ...entry, amount: Number(entry.amount), taxAmount: entry.taxAmount == null ? null : Number(entry.taxAmount), quantity: entry.quantity == null ? null : Number(entry.quantity), unitPrice: entry.unitPrice == null ? null : Number(entry.unitPrice) };
}

export async function costRoutes(app: FastifyInstance) {
  app.get('/:projectId/costs', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const query = z.object({ type: z.nativeEnum(CostType).optional(), from: z.string().optional(), to: z.string().optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '筛选参数不正确', query.error.flatten());
    const rows = await prisma.costEntry.findMany({
      where: { projectId, deletedAt: null, ...(query.data.type ? { type: query.data.type } : {}),
        ...(query.data.from || query.data.to ? { date: { ...(query.data.from ? { gte: new Date(query.data.from) } : {}), ...(query.data.to ? { lte: new Date(query.data.to) } : {}) } } : {}) },
      include: { budgetItem: { select: { id: true, code: true, name: true } }, downstreamContract: { select: { id: true, contractNo: true, name: true, counterpartyName: true, counterpartyPartyId: true } }, businessParty: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500,
    });
    return success(rows.map(serialise));
  });

  app.post('/:projectId/costs', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const parsed = costInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '成本记录填写有误', parsed.error.flatten());
    if (parsed.data.budgetItemId) {
      const item = await prisma.budgetItem.findFirst({ where: { id: parsed.data.budgetItemId, projectId, deletedAt: null }, select: { id: true } });
      if (!item) return failure(reply, 400, 'BUDGET_ITEM_INVALID', '关联清单项不存在或不属于当前项目');
    }
    let contractPartyId: string | null = null;
    if (parsed.data.downstreamContractId) {
      const downstreamContract = await prisma.downstreamContract.findFirst({ where: { id: parsed.data.downstreamContractId, projectId, deletedAt: null }, select: { id: true, status: true, counterpartyPartyId: true } });
      if (!downstreamContract) return failure(reply, 400, 'DOWNSTREAM_CONTRACT_INVALID', '关联下游合同不存在或不属于当前项目');
      if (downstreamContract.status === 'DRAFT' || downstreamContract.status === 'TERMINATED') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NOT_ACTIVE', '草稿或已终止合同不能新增关联实际成本；历史成本如需追溯关联，请使用成本台账的关联修正操作');
      contractPartyId = downstreamContract.counterpartyPartyId;
      if (parsed.data.businessPartyId && parsed.data.businessPartyId !== contractPartyId) return failure(reply, 409, 'COST_PARTY_CONTRACT_MISMATCH', '成本关联合同与所选往来单位不一致；关联合同时应使用合同相对方档案');
    }
    if (parsed.data.businessPartyId) {
      const party = await prisma.businessParty.findFirst({ where: { id: parsed.data.businessPartyId, status: 'ACTIVE' }, select: { id: true } });
      if (!party) return failure(reply, 400, 'BUSINESS_PARTY_INVALID', '所选往来单位不存在、已停用或已归档');
    }
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.costEntry.create({ data: {
        projectId, type: parsed.data.type, date: new Date(parsed.data.date), amount: String(parsed.data.amount),
        taxAmount: parsed.data.taxAmount == null ? null : String(parsed.data.taxAmount), budgetItemId: parsed.data.budgetItemId ?? null,
        description: parsed.data.description, downstreamContractId: parsed.data.downstreamContractId ?? null, businessPartyId: contractPartyId ?? parsed.data.businessPartyId ?? null, quantity: parsed.data.quantity == null ? null : String(parsed.data.quantity),
        unit: parsed.data.unit ?? null, unitPrice: parsed.data.unitPrice == null ? null : String(parsed.data.unitPrice),
        invoiceNo: parsed.data.invoiceNo ?? null, vendorName: contractPartyId ? (await tx.businessParty.findUnique({ where: { id: contractPartyId }, select: { name: true } }))?.name ?? parsed.data.vendorName ?? null : parsed.data.businessPartyId ? (await tx.businessParty.findUnique({ where: { id: parsed.data.businessPartyId }, select: { name: true } }))?.name ?? parsed.data.vendorName ?? null : parsed.data.vendorName ?? null, teamName: parsed.data.teamName ?? null,
        notes: parsed.data.notes ?? null, createdById: user.sub,
      } });
      await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'CostEntry', entityId: created.id, action: 'CREATE', changes: { ...parsed.data, amount: String(parsed.data.amount), downstreamContractId: parsed.data.downstreamContractId ?? null } } });
      return created;
    });
    return reply.code(201).send(success(serialise(entry)));
  });

  app.patch('/:projectId/costs/:entryId/link-contract', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, entryId } = request.params as { projectId: string; entryId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const parsed = z.object({ downstreamContractId: z.string().trim().min(1).nullable() }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '合同关联参数不正确', parsed.error.flatten());
    const old = await prisma.costEntry.findFirst({ where: { id: entryId, projectId, deletedAt: null }, include: { downstreamContract: { select: { id: true, contractNo: true, name: true, status: true, counterpartyPartyId: true, counterpartyName: true } } } });
    if (!old) return failure(reply, 404, 'COST_NOT_FOUND', '成本记录不存在或已归档');
    let nextContract: { id: string; contractNo: string; name: string; status: string; counterpartyPartyId: string | null; counterpartyName: string } | null = null;
    if (parsed.data.downstreamContractId) {
      nextContract = await prisma.downstreamContract.findFirst({
        where: { id: parsed.data.downstreamContractId, projectId, deletedAt: null },
        select: { id: true, contractNo: true, name: true, status: true, counterpartyPartyId: true, counterpartyName: true },
      });
      if (!nextContract) return failure(reply, 400, 'DOWNSTREAM_CONTRACT_INVALID', '所选合同不存在或不属于当前项目');
      // For reconciliation of historic records, permit a terminated contract link;
      // a new cost entry cannot be created against a terminated contract.
      if (nextContract.status === 'DRAFT') return failure(reply, 409, 'DOWNSTREAM_CONTRACT_NOT_ACTIVE', '草稿合同尚未生效，不能关联实际成本');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.costEntry.update({ where: { id: entryId }, data: { downstreamContractId: parsed.data.downstreamContractId, ...(nextContract ? { businessPartyId: nextContract.counterpartyPartyId, vendorName: nextContract.counterpartyName } : {}) }, include: { budgetItem: { select: { id: true, code: true, name: true } }, downstreamContract: { select: { id: true, contractNo: true, name: true, counterpartyName: true, counterpartyPartyId: true } }, businessParty: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } });
      await tx.auditLog.create({ data: {
        projectId, userId: user.sub, entity: 'CostEntry', entityId: entryId, action: 'LINK_DOWNSTREAM_CONTRACT',
        changes: {
          fromDownstreamContractId: old.downstreamContractId,
          fromDownstreamContractNo: old.downstreamContract?.contractNo ?? null,
          fromBusinessPartyId: old.businessPartyId,
          toBusinessPartyId: nextContract?.counterpartyPartyId ?? null,
          toDownstreamContractId: nextContract?.id ?? null,
          toDownstreamContractNo: nextContract?.contractNo ?? null,
          amountUnchanged: true,
          amount: old.amount.toString(),
        },
      } });
      return saved;
    });
    return success(serialise(updated));
  });

  app.post('/:projectId/costs/:entryId/archive', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, entryId } = request.params as { projectId: string; entryId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'ACTUAL_COST_ADMIN')) return;
    const entry = await prisma.costEntry.findFirst({ where: { id: entryId, projectId, deletedAt: null } });
    if (!entry) return failure(reply, 404, 'COST_NOT_FOUND', '成本记录不存在');
    await prisma.$transaction(async (tx) => {
      await tx.costEntry.update({ where: { id: entryId }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'CostEntry', entityId: entryId, action: 'ARCHIVE', changes: { amount: String(entry.amount) } } });
    });
    return success({ archived: true });
  });
}
