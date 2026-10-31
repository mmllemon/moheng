import type { FastifyInstance } from 'fastify';
import { ProjectRole, ProjectStatus } from '../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney } from '../lib/validation.js';
import { recalculateEffectiveContractAmount } from '../lib/contract-amount.js';
import { classifyOriginalAmountUpdate } from '../lib/contract-base-policy.js';
import { resolveBusinessParty } from '../lib/business-party.js';
import { nextDocumentNumber } from '../lib/document-number.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';

const projectInput = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]+$/, '编号只能使用字母、数字、下划线和短横线').optional().or(z.literal('')),
  type: z.string().trim().min(1).max(40).default('HOUSING'),
  ownerName: z.string().trim().min(1).max(120),
  ownerPartyId: z.string().trim().min(1).nullable().optional(),
  contractAmount: nonNegativeMoney,
  startDate: z.iso.datetime(),
  plannedEndDate: z.iso.datetime().optional().nullable(),
  address: z.string().max(240).optional().nullable(),
  managerName: z.string().max(100).optional().nullable(),
  status: z.nativeEnum(ProjectStatus).optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const query = z.object({ q: z.string().optional(), status: z.nativeEnum(ProjectStatus).optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '筛选参数不正确', query.error.flatten());
    const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'PROJECT_READ');
    const projects = await prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.q ? { OR: [{ name: { contains: query.data.q, mode: 'insensitive' } }, { code: { contains: query.data.q, mode: 'insensitive' } }] } : {}),
        ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }),
      },
      include: { mainContract: true, changes: { where: { deletedAt: null, externalConfirmedAmount: { not: null } }, select: { id: true }, take: 1 }, _count: { select: { budgetItems: true, costEntries: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return success(projects.map((p) => ({
      id: p.id, name: p.name, code: p.code, type: p.type, ownerName: p.ownerName, ownerPartyId: p.ownerPartyId,
      contractAmount: Number(p.contractAmount), originalContractAmount: Number(p.originalContractAmount), startDate: p.startDate, plannedEndDate: p.plannedEndDate,
      status: p.status, address: p.address, managerName: p.managerName, createdAt: p.createdAt,
      mainContract: p.mainContract ? { contractNo: p.mainContract.contractNo, name: p.mainContract.name, amount: Number(p.mainContract.amount) } : null,
      hasMainContract: Boolean(p.mainContract),
      hasExternalConfirmation: p.changes.length > 0,
      budgetItemCount: p._count.budgetItems, costEntryCount: p._count.costEntries,
    })));
  });

  app.post('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = projectInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目资料有误，请检查带星号字段', parsed.error.flatten());
    try {
      const project = await prisma.$transaction(async (tx) => {
        const ownerParty = await resolveBusinessParty(tx, { partyId: parsed.data.ownerPartyId, name: parsed.data.ownerName, role: 'OWNER', actorUserId: user.sub });
        const code = parsed.data.code?.trim() || await nextDocumentNumber(tx, { type: 'PROJECT', globalPrefix: 'XM', date: new Date(parsed.data.startDate) });
        const created = await tx.project.create({ data: {
          ...parsed.data, code, ownerName: ownerParty.name, ownerPartyId: ownerParty.id,
          contractAmount: String(parsed.data.contractAmount),
          originalContractAmount: String(parsed.data.contractAmount),
          startDate: new Date(parsed.data.startDate),
          plannedEndDate: parsed.data.plannedEndDate ? new Date(parsed.data.plannedEndDate) : null,
          status: parsed.data.status ?? 'CONSTRUCTION',
        } });
        await tx.projectMember.create({ data: { projectId: created.id, userId: user.sub, role: 'OWNER' } });
        await tx.auditLog.create({ data: { projectId: created.id, userId: user.sub, entity: 'Project', entityId: created.id, action: 'CREATE', changes: { name: created.name, code: created.code, contractAmount: String(created.contractAmount) } } });
        return created;
      });
      return reply.code(201).send(success({ ...project, contractAmount: Number(project.contractAmount), originalContractAmount: Number(project.originalContractAmount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选建设单位档案不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选建设单位已停用或归档');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'PROJECT_CODE_EXISTS', '项目编号已存在，或往来单位身份存在重复，请先核对档案');
      throw error;
    }
  });

  app.get('/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    if (!(await canAccessProject(user.sub, user.role, id, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const project = await prisma.project.findFirst({ where: { id, deletedAt: null }, include: { mainContract: true, ownerParty: { select: { id: true, name: true, creditCode: true, contactName: true, phone: true, address: true, taxNo: true, invoiceTitle: true } } } });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
    return success({ ...project, ownerPartyId: project.ownerPartyId, contractAmount: Number(project.contractAmount), originalContractAmount: Number(project.originalContractAmount), mainContract: project.mainContract ? { ...project.mainContract, amount: Number(project.mainContract.amount), retentionRate: Number(project.mainContract.retentionRate), advanceDeductionRate: Number(project.mainContract.advanceDeductionRate) } : null });
  });

  app.patch('/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, id, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'PROJECT_MANAGE')) return;
    const parsed = projectInput.partial().safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目资料有误', parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) return failure(reply, 400, 'EMPTY_UPDATE', '没有需要更新的字段');
    try {
      const data = { ...parsed.data } as Record<string, unknown>;
      delete data.contractAmount;
      if (parsed.data.startDate) data.startDate = new Date(parsed.data.startDate);
      if (parsed.data.plannedEndDate !== undefined) data.plannedEndDate = parsed.data.plannedEndDate ? new Date(parsed.data.plannedEndDate) : null;
      const updated = await prisma.$transaction(async (tx) => {
        // Serialize baseline edits against external-confirmation registration and
        // effective-total recomputations. A contract adjustment must never rewrite
        // the original signed contract amount.
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.project.findFirst({
          where: { id, deletedAt: null },
          select: { originalContractAmount: true },
        });
        if (!current) throw new Error('PROJECT_NOT_FOUND');
        if (parsed.data.ownerName !== undefined || parsed.data.ownerPartyId !== undefined) {
          const partyName = parsed.data.ownerName ?? (await tx.project.findUniqueOrThrow({ where: { id }, select: { ownerName: true } })).ownerName;
          const ownerParty = await resolveBusinessParty(tx, { partyId: parsed.data.ownerPartyId, name: partyName, role: 'OWNER', actorUserId: user.sub, auditProjectId: id });
          data.ownerPartyId = ownerParty.id;
          data.ownerName = ownerParty.name;
        }
        let baselineChanged = false;
        if (parsed.data.contractAmount !== undefined) {
          const [main, externalConfirmation] = await Promise.all([
            tx.mainContract.findUnique({ where: { projectId: id }, select: { id: true } }),
            tx.change.findFirst({ where: { projectId: id, deletedAt: null, externalConfirmedAmount: { not: null } }, select: { id: true } }),
          ]);
          const decision = classifyOriginalAmountUpdate({
            currentAmount: current.originalContractAmount,
            requestedAmount: parsed.data.contractAmount,
            hasMainContract: Boolean(main),
            hasExternalConfirmation: Boolean(externalConfirmation),
          });
          if (decision === 'IMMUTABLE') throw new Error('ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE');
          if (decision === 'INITIAL_BASE_UPDATE') {
            await tx.project.update({ where: { id }, data: { originalContractAmount: String(parsed.data.contractAmount) } });
            baselineChanged = true;
          }
        }
        if (Object.keys(data).length > 0) await tx.project.update({ where: { id }, data: data as never });
        if (baselineChanged) await recalculateEffectiveContractAmount(tx, id);
        const result = await tx.project.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({ data: {
          projectId: id, userId: user.sub, entity: 'Project', entityId: id, action: 'UPDATE',
          changes: { ...parsed.data, originalContractAmount: parsed.data.contractAmount, effectiveContractAmount: result.contractAmount.toString() },
        } });
        return result;
      });
      return success({ ...updated, contractAmount: Number(updated.contractAmount), originalContractAmount: Number(updated.originalContractAmount) });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'PROJECT_CODE_EXISTS', '项目编号已存在');
      if (error instanceof Error && error.message === 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE') return failure(reply, 409, 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE', '原始合同金额已锁定。合同调整请登记变更签证，不得直接改写原始金额');
      if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_AMBIGUOUS', '存在多个同名单位，请在表单中明确选择对应的单位档案');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND') return failure(reply, 400, 'BUSINESS_PARTY_NOT_FOUND', '所选建设单位档案不存在');
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_INACTIVE') return failure(reply, 409, 'BUSINESS_PARTY_INACTIVE', '所选建设单位已停用或归档');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE') return failure(reply, 409, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE', '调整原始合同金额后会导致当前有效合同额为负数，已阻止保存');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_EXCEEDS_MAX') return failure(reply, 409, 'CONTRACT_AMOUNT_EXCEEDS_MAX', '当前有效合同额超过数据库 DECIMAL(18,2) 上限，已阻止保存');
      throw error;
    }
  });

  app.get('/:id/members', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    if (!(await canAccessProject(user.sub, user.role, id, [ProjectRole.OWNER, ProjectRole.MANAGER], 'PROJECT_MANAGE'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '只有项目负责人或项目经理可以查看完整成员与身份信息');
    const members = await prisma.projectMember.findMany({ where: { projectId: id }, include: { user: { select: { id: true, name: true, email: true } } } });
    return success(members.map((m) => ({ ...m.user, id: m.id, userId: m.userId, role: m.role, createdAt: m.createdAt })));
  });

  app.post('/:id/members', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ userId: z.string().trim().min(1).optional(), email: z.string().trim().email().max(254).optional(), role: z.nativeEnum(ProjectRole) }).refine((v) => Boolean(v.userId || v.email), '必须提供 userId 或 email').safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目成员资料有误', parsed.error.flatten());

    const project = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
    const actorMembership = user.role === 'ADMIN' ? null : await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: user.sub } }, select: { role: true },
    });
    if (user.role !== 'ADMIN' && !actorMembership) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const assignable: ProjectRole[] = user.role === 'ADMIN'
      ? ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']
      : actorMembership?.role === 'OWNER' ? ['MANAGER', 'ESTIMATOR', 'VIEWER']
      : actorMembership?.role === 'MANAGER' ? ['ESTIMATOR', 'VIEWER'] : [];
    if (!assignable.includes(parsed.data.role)) return failure(reply, 403, 'MEMBER_ROLE_ASSIGNMENT_FORBIDDEN', '当前权限不允许分配该项目角色');

    const target = await prisma.user.findFirst({ where: { isActive: true, ...(parsed.data.userId ? { id: parsed.data.userId } : { email: parsed.data.email!.trim().toLowerCase() }) }, select: { id: true, name: true, email: true } });
    if (!target) return failure(reply, 404, 'ACTIVE_USER_NOT_FOUND', '目标账号不存在或已停用');
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Serialize membership changes per project so two concurrent demotions
        // cannot both observe the other owner and leave the project ownerless.
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
        const currentActorMembership = user.role === 'ADMIN' ? null : await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: id, userId: user.sub } }, select: { role: true },
        });
        if (user.role !== 'ADMIN' && !currentActorMembership) throw new Error('PROJECT_ACCESS_DENIED');
        const currentAssignable: ProjectRole[] = user.role === 'ADMIN'
          ? ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']
          : currentActorMembership?.role === 'OWNER' ? ['MANAGER', 'ESTIMATOR', 'VIEWER']
          : currentActorMembership?.role === 'MANAGER' ? ['ESTIMATOR', 'VIEWER'] : [];
        if (!currentAssignable.includes(parsed.data.role)) throw new Error('MEMBER_ROLE_ASSIGNMENT_FORBIDDEN');

        const existing = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: target.id } } });
        if (existing?.role === 'OWNER' && parsed.data.role !== 'OWNER') {
          const otherOwners = await tx.projectMember.count({ where: { projectId: id, role: 'OWNER', userId: { not: target.id } } });
          if (otherOwners === 0) throw new Error('PROJECT_OWNER_REQUIRED');
        }
        const member = await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: id, userId: target.id } },
          create: { projectId: id, userId: target.id, role: parsed.data.role },
          update: { role: parsed.data.role },
        });
        await tx.auditLog.create({ data: {
          projectId: id, userId: user.sub, entity: 'ProjectMember', entityId: member.id,
          action: existing ? 'PROJECT_MEMBER_ROLE_UPDATED' : 'PROJECT_MEMBER_ADDED',
          changes: { targetUserId: target.id, targetEmail: target.email, from: existing?.role ?? null, to: parsed.data.role },
        } });
        return { member, existed: Boolean(existing) };
      });
      return reply.code(result.existed ? 200 : 201).send(success({ ...target, id: result.member.id, userId: target.id, role: result.member.role }));
    } catch (error) {
      if (error instanceof Error && error.message === 'PROJECT_OWNER_REQUIRED') return failure(reply, 409, 'PROJECT_OWNER_REQUIRED', '项目至少需要保留一名项目负责人；请先分配另一名负责人再调整此角色');
      if (error instanceof Error && error.message === 'PROJECT_ACCESS_DENIED') return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
      if (error instanceof Error && error.message === 'MEMBER_ROLE_ASSIGNMENT_FORBIDDEN') return failure(reply, 403, 'MEMBER_ROLE_ASSIGNMENT_FORBIDDEN', '当前权限不允许分配该项目角色');
      throw error;
    }
  });
}
