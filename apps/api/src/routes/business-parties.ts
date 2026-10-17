import type { FastifyInstance } from 'fastify';
import { BusinessPartyRole, BusinessPartyStatus, Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { lockBusinessPartyName, normalizeBusinessPartyName } from '../lib/business-party.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';

const rolesInput = z.array(z.nativeEnum(BusinessPartyRole)).min(1).default(['OTHER']);
const createInput = z.object({
  name: z.string().trim().min(2).max(200),
  creditCode: z.string().trim().max(64).optional().nullable(),
  roles: rolesInput,
  legalRepresentative: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().max(254).optional().nullable(),
  taxNo: z.string().trim().max(64).optional().nullable(),
  invoiceTitle: z.string().trim().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  identityVerified: z.boolean().optional(),
  identityVerificationNote: z.string().trim().max(2000).optional().nullable(),
});
const createRequestInput = createInput.extend({ confirmDifferentEntity: z.boolean().optional() });
const updateInput = createInput.extend({ status: z.nativeEnum(BusinessPartyStatus).optional() }).partial().extend({
  // The current display name is still mandatory when changing it; callers normally send the full form.
  name: z.string().trim().min(2).max(200).optional(),
});
const roleLabels: Record<BusinessPartyRole, string> = {
  OWNER: '建设单位', MATERIAL_SUPPLIER: '材料供应商', LABOR_SUBCONTRACTOR: '劳务分包',
  PROFESSIONAL_SUBCONTRACTOR: '专业分包', EQUIPMENT_LESSOR: '机械租赁', SERVICE_PROVIDER: '服务商', OTHER: '其他单位',
};
async function canCreateMasterData(userId: string, role: string) {
  if (role === 'ADMIN') return true;
  const membership = await prisma.projectMember.findFirst({ where: { userId, role: { in: ['OWNER', 'MANAGER', 'ESTIMATOR'] } }, select: { id: true } });
  return Boolean(membership);
}
async function projectScope(userId: string, globalRole: string) {
  const allReadable = globalRole === 'ADMIN' || await hasCrossProjectReadScope(userId, globalRole, 'PROJECT_READ');
  return { deletedAt: null, ...(allReadable ? {} : { members: { some: { userId } } }) };
}
function toNumber(v: unknown): number { return Number(v ?? 0); }
function sum(values: unknown[]): number { return values.reduce<number>((total, v) => total + toNumber(v), 0); }
function downstreamCurrentAmount(contract: any) {
  return toNumber(contract.originalAmount) + (contract.adjustments ?? []).reduce((total: number, a: any) => total + (a.direction === 'DECREASE' ? -1 : 1) * toNumber(a.amount), 0);
}
function payableOpenAmount(payable: any) {
  return toNumber(payable.netAmount) - (payable.paymentAllocations ?? []).reduce((total: number, a: any) => total + toNumber(a.amount), 0);
}

export async function businessPartyRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = z.object({ search: z.string().trim().max(200).optional(), role: z.nativeEnum(BusinessPartyRole).optional(), includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true') }).safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '单位档案查询条件不正确', parsed.error.flatten());
    const q = parsed.data.search?.trim();
    const rows = await prisma.businessParty.findMany({
      where: {
        ...(parsed.data.includeInactive && user.role === 'ADMIN' ? {} : { status: 'ACTIVE' }),
        ...(parsed.data.role ? { roles: { has: parsed.data.role } } : {}),
        ...(q ? { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { normalizedName: { contains: normalizeBusinessPartyName(q) } },
          { creditCode: { contains: q, mode: 'insensitive' } },
          { formerNames: { has: q } },
        ] } : {}),
      },
      select: user.role === 'ADMIN'
        ? { id: true, name: true, creditCode: true, roles: true, status: true, identityVerified: true, identityVerificationNote: true, address: true, contactName: true, phone: true, email: true, taxNo: true, invoiceTitle: true, updatedAt: true }
        : { id: true, name: true, creditCode: true, roles: true, status: true, identityVerified: true, address: true, contactName: true, phone: true, email: true, taxNo: true, invoiceTitle: true, updatedAt: true },
      orderBy: [{ name: 'asc' }], take: q ? 100 : 250,
    });
    return success(rows.map((row) => ({ ...row, roleLabels: row.roles.map((r) => roleLabels[r]) })));
  });

  app.post('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    if (!(await canCreateMasterData(user.sub, user.role))) return failure(reply, 403, 'BUSINESS_PARTY_CREATE_FORBIDDEN', '当前账号没有新增往来单位档案的权限');
    const parsed = createRequestInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '往来单位资料有误', parsed.error.flatten());
    const normalizedName = normalizeBusinessPartyName(parsed.data.name);
    if (parsed.data.identityVerified && user.role !== 'ADMIN') return failure(reply, 403, 'BUSINESS_PARTY_VERIFY_FORBIDDEN', '只有系统管理员可以确认单位主体身份');
    if (parsed.data.identityVerified && (parsed.data.identityVerificationNote?.trim().length ?? 0) < 5) return failure(reply, 400, 'BUSINESS_PARTY_VERIFY_NOTE_REQUIRED', '标记主体身份已核验时，请填写至少 5 个字符的核验依据');
    if (parsed.data.confirmDifferentEntity && user.role !== 'ADMIN') return failure(reply, 403, 'BUSINESS_PARTY_DUPLICATE_CREATE_FORBIDDEN', '同名不同主体建档仅限系统管理员操作');
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // Serialize the duplicate check and insert so simultaneous submissions cannot race.
        await lockBusinessPartyName(tx, normalizedName);
        const duplicates = await tx.businessParty.findMany({ where: { normalizedName }, select: { id: true, name: true, creditCode: true, roles: true, identityVerified: true } });
        if (duplicates.length && !(user.role === 'ADMIN' && parsed.data.confirmDifferentEntity && parsed.data.creditCode?.trim())) {
          return { error: { status: 409, code: 'BUSINESS_PARTY_NAME_EXISTS', message: '系统已有相同规范化名称。请先选择已有单位；若确为不同法律主体，由管理员填写其独立统一社会信用代码并明确确认。', details: duplicates } };
        }
        if (duplicates.length && parsed.data.creditCode && duplicates.some((party) => party.creditCode === parsed.data.creditCode)) {
          return { error: { status: 409, code: 'BUSINESS_PARTY_CREDIT_CODE_EXISTS', message: '该统一社会信用代码已归属于其他单位档案，请选择已有档案或核对主体信息', details: duplicates } };
        }
        const { confirmDifferentEntity: _confirmDifferentEntity, identityVerified, identityVerificationNote, ...fields } = parsed.data;
        const created = await tx.businessParty.create({ data: {
          ...fields, normalizedName, creditCode: parsed.data.creditCode || null,
          identityVerified: user.role === 'ADMIN' && Boolean(identityVerified), identityVerificationNote: user.role === 'ADMIN' ? (identityVerificationNote || null) : null,
          legalRepresentative: parsed.data.legalRepresentative || null, address: parsed.data.address || null,
          contactName: parsed.data.contactName || null, phone: parsed.data.phone || null,
          email: parsed.data.email || null, taxNo: parsed.data.taxNo || null,
          invoiceTitle: parsed.data.invoiceTitle || null, notes: parsed.data.notes || null,
        } });
        await tx.auditLog.create({ data: { projectId: null, userId: user.sub, entity: 'BusinessParty', entityId: created.id, action: 'CREATE', changes: { name: created.name, creditCode: created.creditCode, roles: created.roles, identityVerified: created.identityVerified, identityVerificationNote: created.identityVerificationNote } } });
        return { row: created };
      });
      if ('error' in outcome && outcome.error !== undefined) return failure(reply, outcome.error.status, outcome.error.code, outcome.error.message, outcome.error.details);
      return reply.code(201).send(success({ ...outcome.row, roleLabels: outcome.row.roles.map((r) => roleLabels[r]) }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'BUSINESS_PARTY_DUPLICATE', '单位名称或统一社会信用代码已被其他单位使用，请重新查询并选择已有档案');
      throw error;
    }
  });

  app.patch('/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    if (user.role !== 'ADMIN') return failure(reply, 403, 'BUSINESS_PARTY_UPDATE_FORBIDDEN', '统一单位主档为公司级共享资料，编辑、更名、合并和停用仅限系统管理员');
    const { id } = request.params as { id: string };
    const parsed = updateInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '单位档案资料有误', parsed.error.flatten());
    if (!Object.keys(parsed.data).length) return failure(reply, 400, 'EMPTY_UPDATE', '没有需要更新的字段');
    const old = await prisma.businessParty.findUnique({ where: { id } });
    if (!old) return failure(reply, 404, 'BUSINESS_PARTY_NOT_FOUND', '往来单位档案不存在');
    const data: Prisma.BusinessPartyUpdateInput = { ...parsed.data };
    let nextNormalized = old.normalizedName;
    const renaming = Boolean(parsed.data.name && parsed.data.name !== old.name);
    if (renaming) {
      nextNormalized = normalizeBusinessPartyName(parsed.data.name!);
      data.normalizedName = nextNormalized;
      data.formerNames = [...new Set([...old.formerNames, old.name])];
    }
    if (parsed.data.creditCode !== undefined) data.creditCode = parsed.data.creditCode || null;
    if (parsed.data.identityVerified === true && (parsed.data.identityVerificationNote ?? old.identityVerificationNote ?? '').trim().length < 5) return failure(reply, 400, 'BUSINESS_PARTY_VERIFY_NOTE_REQUIRED', '标记主体身份已核验时，请填写至少 5 个字符的核验依据');
    try {
      const saved = await prisma.$transaction(async (tx) => {
        if (renaming) {
          await lockBusinessPartyName(tx, nextNormalized);
          const duplicates = await tx.businessParty.findMany({ where: { normalizedName: nextNormalized, id: { not: id } }, select: { id: true } });
          if (duplicates.length) throw new Error('BUSINESS_PARTY_NAME_EXISTS');
        }
        const row = await tx.businessParty.update({ where: { id }, data });
        await tx.auditLog.create({ data: { projectId: null, userId: user.sub, entity: 'BusinessParty', entityId: id, action: 'UPDATE', changes: { from: { name: old.name, creditCode: old.creditCode, roles: old.roles, status: old.status, identityVerified: old.identityVerified, identityVerificationNote: old.identityVerificationNote }, to: { name: row.name, creditCode: row.creditCode, roles: row.roles, status: row.status, identityVerified: row.identityVerified, identityVerificationNote: row.identityVerificationNote } } } });
        return row;
      });
      return success({ ...saved, roleLabels: saved.roles.map((r) => roleLabels[r]) });
    } catch (error) {
      if (error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_EXISTS') return failure(reply, 409, 'BUSINESS_PARTY_NAME_EXISTS', '新名称与其他单位档案重复；如涉及不同法律主体，请通过新建档案流程明确区分');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'BUSINESS_PARTY_DUPLICATE', '单位名称或统一社会信用代码已被其他单位使用');
      throw error;
    }
  });

  app.get('/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const party = await prisma.businessParty.findUnique({ where: { id } });
    if (!party) return failure(reply, 404, 'BUSINESS_PARTY_NOT_FOUND', '往来单位档案不存在');
    const scope = await projectScope(user.sub, user.role);
    const standaloneCostWhere = { businessPartyId: id, downstreamContractId: null, deletedAt: null, project: scope };
    const [ownedProjects, downstreamContracts, standaloneCosts, standaloneCostTotals] = await Promise.all([
      prisma.project.findMany({
        where: { ...scope, ownerPartyId: id },
        include: { mainContract: true, progressBills: { where: { deletedAt: null }, include: { payments: true } }, changes: { where: { deletedAt: null }, select: { id: true, name: true, code: true, submittedAmount: true, externalConfirmedAmount: true, externalConfirmationStatus: true, status: true, effectiveAt: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.downstreamContract.findMany({
        where: { counterpartyPartyId: id, deletedAt: null, project: scope },
        include: {
          project: { select: { id: true, name: true, code: true, status: true } },
          adjustments: { select: { direction: true, amount: true } },
          settlements: { where: { status: 'POSTED' }, include: { posting: { select: { deltaAmount: true, cumulativeAfter: true, postedAt: true } } } },
          payments: { select: { type: true, amount: true, paidAt: true } },
          payables: { include: { paymentAllocations: { select: { amount: true } } } },
          costEntries: { where: { deletedAt: null }, select: { amount: true } },
          supplierInvoices: { select: { amount: true, taxAmount: true, status: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.costEntry.findMany({
        where: standaloneCostWhere,
        include: { project: { select: { id: true, name: true, code: true, status: true } } }, orderBy: { date: 'desc' }, take: 200,
      }),
      prisma.costEntry.groupBy({ by: ['projectId'], where: standaloneCostWhere, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const projectMap = new Map<string, any>();
    for (const project of ownedProjects) {
      const paid = project.progressBills.reduce((t, bill) => t + bill.payments.reduce((p, payment) => p + toNumber(payment.amount), 0), 0);
      projectMap.set(project.id, {
        id: project.id, name: project.name, code: project.code, status: project.status, role: 'OWNER',
        mainContractNo: project.mainContract?.contractNo ?? null, mainContractName: project.mainContract?.name ?? null,
        incomeContractAmount: toNumber(project.contractAmount), incomeOriginalAmount: toNumber(project.originalContractAmount),
        incomePaidAmount: paid, incomeBillCount: project.progressBills.length,
        changeCount: project.changes.length,
        confirmedChangeAmount: sum(project.changes.filter((c) => c.externalConfirmationStatus === 'EFFECTIVE').map((c) => c.externalConfirmedAmount)),
        downstreamContractCount: 0, downstreamContractAmount: 0, downstreamPaidAmount: 0, downstreamActualCostAmount: 0, downstreamInvoiceAmount: 0,
      });
    }
    const downstreamRows = downstreamContracts.map((contract: any) => {
      const currentAmount = downstreamCurrentAmount(contract);
      const settledAmount = sum(contract.settlements.map((settlement: any) => settlement.posting?.deltaAmount));
      const paidAmount = sum(contract.payments.filter((p: any) => p.type !== 'REFUND').map((p: any) => p.amount)) - sum(contract.payments.filter((p: any) => p.type === 'REFUND').map((p: any) => p.amount));
      const positiveOpenPayables = sum(contract.payables.filter((p: any) => toNumber(p.netAmount) > 0).map((p: any) => Math.max(0, payableOpenAmount(p))));
      const negativeSupplierCredits = sum(contract.payables.filter((p: any) => toNumber(p.netAmount) < 0).map((p: any) => Math.abs(toNumber(p.netAmount))));
      const partyProject = contract.project;
      const existing = projectMap.get(partyProject.id) ?? {
        id: partyProject.id, name: partyProject.name, code: partyProject.code, status: partyProject.status, role: 'COUNTERPARTY',
        mainContractNo: null, mainContractName: null, incomeContractAmount: 0, incomeOriginalAmount: 0, incomePaidAmount: 0, incomeBillCount: 0, changeCount: 0, confirmedChangeAmount: 0,
        downstreamContractCount: 0, downstreamContractAmount: 0, downstreamPaidAmount: 0, downstreamActualCostAmount: 0, downstreamInvoiceAmount: 0,
      };
      existing.downstreamContractCount += 1;
      if (contract.status !== 'TERMINATED') existing.downstreamContractAmount += currentAmount;
      existing.downstreamPaidAmount += paidAmount;
      const actualCostAmount = sum(contract.costEntries.map((c: any) => c.amount));
      const invoiceAmount = sum(contract.supplierInvoices.map((invoice: any) => Number(invoice.amount)));
      const verifiedInvoiceAmount = sum(contract.supplierInvoices.filter((invoice: any) => invoice.status === 'VERIFIED').map((invoice: any) => Number(invoice.amount)));
      existing.downstreamActualCostAmount = (existing.downstreamActualCostAmount ?? 0) + actualCostAmount;
      existing.downstreamInvoiceAmount = (existing.downstreamInvoiceAmount ?? 0) + invoiceAmount;
      projectMap.set(partyProject.id, existing);
      return {
        id: contract.id, projectId: contract.projectId, project: partyProject, contractNo: contract.contractNo, name: contract.name,
        type: contract.type, status: contract.status, counterpartyName: contract.counterpartyName,
        originalAmount: toNumber(contract.originalAmount), currentAmount, settledAmount, paidAmount,
        openPayableAmount: positiveOpenPayables, supplierCreditAmount: negativeSupplierCredits, actualCostAmount, invoiceAmount, verifiedInvoiceAmount, invoiceCount: contract.supplierInvoices.length,
        settlementCount: contract.settlements.length,
      };
    });
    const costProjectIds = standaloneCostTotals.map((item) => item.projectId);
    const costProjects = costProjectIds.length ? await prisma.project.findMany({ where: { ...scope, id: { in: costProjectIds } }, select: { id: true, name: true, code: true, status: true } }) : [];
    const costProjectById = new Map(costProjects.map((project) => [project.id, project]));
    for (const aggregate of standaloneCostTotals) {
      const project = costProjectById.get(aggregate.projectId);
      if (!project) continue;
      const existing = projectMap.get(project.id) ?? {
        id: project.id, name: project.name, code: project.code, status: project.status, role: 'COST_PARTY',
        mainContractNo: null, mainContractName: null, incomeContractAmount: 0, incomeOriginalAmount: 0, incomePaidAmount: 0, incomeBillCount: 0, changeCount: 0, confirmedChangeAmount: 0,
        downstreamContractCount: 0, downstreamContractAmount: 0, downstreamPaidAmount: 0, downstreamActualCostAmount: 0, downstreamInvoiceAmount: 0, standaloneCostAmount: 0, standaloneCostCount: 0,
      };
      existing.standaloneCostAmount = toNumber(aggregate._sum.amount);
      existing.standaloneCostCount = aggregate._count._all;
      projectMap.set(project.id, existing);
    }
    const projects = [...projectMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (user.role !== 'ADMIN' && projects.length === 0 && downstreamContracts.length === 0 && standaloneCosts.length === 0) {
      return failure(reply, 404, 'BUSINESS_PARTY_NOT_FOUND', '单位不存在，或当前账号无权查看其关联项目资料');
    }
    const standaloneCostAmount = sum(standaloneCostTotals.map((c) => c._sum.amount));
    const standaloneCostCount = standaloneCostTotals.reduce((count, item) => count + item._count._all, 0);
    const mainContracts = ownedProjects.filter((p) => p.mainContract).map((p) => ({
      id: p.mainContract!.id, projectId: p.id, project: { id: p.id, name: p.name, code: p.code },
      contractNo: p.mainContract!.contractNo, name: p.mainContract!.name, status: p.status,
      originalAmount: toNumber(p.originalContractAmount), currentAmount: toNumber(p.contractAmount),
      progressBillCount: p.progressBills.length,
      appliedAmount: sum(p.progressBills.map((b) => b.amount)),
      approvedAmount: sum(p.progressBills.map((b) => b.approvedAmount)),
      paidAmount: sum(p.progressBills.map((b) => b.payments.reduce((t, payment) => t + toNumber(payment.amount), 0))),
      changeCount: p.changes.length,
    }));
    const summary = {
      projectCount: projects.length,
      mainContractCount: mainContracts.length,
      downstreamContractCount: downstreamRows.length,
      ownerCurrentContractAmount: sum(mainContracts.map((c) => c.currentAmount)),
      ownerApprovedBillAmount: sum(mainContracts.map((c) => c.approvedAmount)),
      ownerReceivedAmount: sum(mainContracts.map((c) => c.paidAmount)),
      downstreamCurrentContractAmount: sum(downstreamRows.filter((c) => c.status !== 'TERMINATED').map((c) => c.currentAmount)),
      downstreamSettledAmount: sum(downstreamRows.map((c) => c.settledAmount)),
      downstreamPaidAmount: sum(downstreamRows.map((c) => c.paidAmount)),
      downstreamOpenPayableAmount: sum(downstreamRows.map((c) => c.openPayableAmount)),
      downstreamSupplierCreditAmount: sum(downstreamRows.map((c) => c.supplierCreditAmount)),
      downstreamActualCostAmount: sum(downstreamRows.map((c) => c.actualCostAmount)),
      downstreamInvoiceAmount: sum(downstreamRows.map((c) => c.invoiceAmount)),
      downstreamVerifiedInvoiceAmount: sum(downstreamRows.map((c) => c.verifiedInvoiceAmount)),
      downstreamInvoiceCount: sum(downstreamRows.map((c) => c.invoiceCount)),
      standaloneCostAmount, standaloneCostCount,
      downstreamTotalCostAmount: sum(downstreamRows.map((c) => c.actualCostAmount)) + standaloneCostAmount,
      metricScope: user.role === 'ADMIN' ? 'COMPANY' : 'AUTHORIZED_PROJECTS',
    };
    return success({
      party: { ...party, roleLabels: party.roles.map((r) => roleLabels[r]) }, summary,
      projects,
      mainContracts,
      downstreamContracts: downstreamRows,
      standaloneCosts: standaloneCosts.map((c) => ({ id: c.id, project: c.project, date: c.date, description: c.description, amount: toNumber(c.amount), type: c.type, vendorName: c.vendorName })),
    });
  });
}
