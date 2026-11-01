import type { FastifyInstance } from 'fastify';
import { CostType, ProjectRole } from '../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney, positiveMoney } from '../lib/validation.js';
import { ImportXlsxError, buildImportTemplate, decodeXlsxUpload, inspectImportWorkbook } from '../lib/tabular-import.js';
import { COST_IMPORT_SHEET, COST_IMPORT_TEMPLATE, assertImportable, parseCostImportRows, type ParsedCostRow, type ParsedCostRowData } from '../lib/cost-import.js';
import { resolveCostTax } from '../lib/cost-tax.js';

const costInput = z.object({
  type: z.nativeEnum(CostType),
  date: z.iso.datetime(),
  amount: positiveMoney,
  taxAmount: nonNegativeMoney.optional().nullable(),
  taxRate: z.number().min(0).max(100).optional().nullable(),
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
  return { ...entry, amount: Number(entry.amount), taxAmount: entry.taxAmount == null ? null : Number(entry.taxAmount), taxRate: entry.taxRate == null ? null : Number(entry.taxRate), quantity: entry.quantity == null ? null : Number(entry.quantity), unitPrice: entry.unitPrice == null ? null : Number(entry.unitPrice) };
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
    const tax = resolveCostTax({ amount: parsed.data.amount, taxAmount: parsed.data.taxAmount ?? null, taxRate: parsed.data.taxRate ?? null });
    if (!tax.ok) return failure(reply, 400, 'COST_TAX_INCONSISTENT', tax.message);
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
        taxAmount: tax.value.taxAmount == null ? null : String(tax.value.taxAmount), taxRate: tax.value.taxRate == null ? null : String(tax.value.taxRate), budgetItemId: parsed.data.budgetItemId ?? null,
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

  /* ── 实际成本批量导入 ──────────────────────────────────────────────
     链路与目标成本清单一致：下载模板 → 上传检视 → 预览（含关联项解析）→ 整批提交。
     设计取舍：预览与提交都由服务端重新解析同一份 headers/rows，不信任前端归一化后的数据；
     只要有一行不过校验，整批不写。 */

  app.get('/:projectId/costs/import-template.xlsx', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const buffer = await buildImportTemplate(COST_IMPORT_TEMPLATE);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="moheng-cost-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent('墨衡-实际成本导入模板.xlsx')}`)
      .send(buffer);
  });

  app.post('/:projectId/costs/import-xlsx/inspect', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const body = z.object({ filename: z.string(), base64: z.string() }).safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '请上传 .xlsx 文件', body.error.flatten());
    try {
      const buffer = decodeXlsxUpload(body.data.filename, body.data.base64);
      return success(await inspectImportWorkbook(buffer, { sheetNames: [COST_IMPORT_SHEET] }));
    } catch (error) {
      if (error instanceof ImportXlsxError) return failure(reply, 400, error.code, error.message);
      throw error;
    }
  });

  /** 把行里的清单编号 / 合同编号 / 单位名称解析成 ID，并把业务规则错误逐行附上。 */
  const resolveCostRows = async (projectId: string, parsed: ParsedCostRow[]): Promise<ParsedCostRow[]> => {
    const codes = [...new Set(parsed.map((row) => row.data?.budgetItemCode).filter((code): code is string => Boolean(code)))];
    const contractNos = [...new Set(parsed.map((row) => row.data?.contractNo).filter((no): no is string => Boolean(no)))];
    const partyNames = [...new Set(parsed.map((row) => row.data?.partyName).filter((name): name is string => Boolean(name)))];

    const [items, contracts, parties] = await Promise.all([
      codes.length ? prisma.budgetItem.findMany({ where: { projectId, deletedAt: null, code: { in: codes } }, select: { id: true, code: true } }) : [],
      contractNos.length ? prisma.downstreamContract.findMany({ where: { projectId, deletedAt: null, contractNo: { in: contractNos } }, select: { id: true, contractNo: true, status: true, counterpartyPartyId: true } }) : [],
      partyNames.length ? prisma.businessParty.findMany({ where: { status: 'ACTIVE', name: { in: partyNames } }, select: { id: true, name: true } }) : [],
    ]);
    const itemByCode = new Map(items.map((item) => [item.code, item.id]));
    const contractByNo = new Map(contracts.map((contract) => [contract.contractNo, contract]));
    const partyByName = new Map(parties.map((party) => [party.name, party.id]));

    return parsed.map((row) => {
      if (!row.valid || !row.data) return row;
      const errors: string[] = [];
      const tax = resolveCostTax({ amount: row.data.amount, taxAmount: row.data.taxAmount, taxRate: row.data.taxRate });
      if (!tax.ok) errors.push(tax.message);
      if (row.data.budgetItemCode && !itemByCode.has(row.data.budgetItemCode)) errors.push(`关联清单编号“${row.data.budgetItemCode}”不存在或不属于当前项目`);
      const contract = row.data.contractNo ? contractByNo.get(row.data.contractNo) : undefined;
      if (row.data.contractNo && !contract) errors.push(`分供合同编号“${row.data.contractNo}”不存在或不属于当前项目`);
      if (contract && (contract.status === 'DRAFT' || contract.status === 'TERMINATED')) errors.push(`分供合同“${row.data.contractNo}”处于${contract.status === 'DRAFT' ? '草稿' : '已终止'}状态，不接受导入`);
      const partyId = row.data.partyName ? partyByName.get(row.data.partyName) : undefined;
      if (row.data.partyName && !partyId) errors.push(`往来单位“${row.data.partyName}”不存在、已停用或已归档`);
      if (contract && partyId && contract.counterpartyPartyId && partyId !== contract.counterpartyPartyId) {
        errors.push(`往来单位与分供合同“${row.data.contractNo}”的相对方不一致；关联合同时应使用合同相对方档案`);
      }
      if (errors.length) return { ...row, valid: false, errors: [...row.errors, ...errors] };
      return {
        ...row,
        data: {
          ...row.data,
          taxAmount: tax.ok ? tax.value.taxAmount : row.data.taxAmount,
          taxRate: tax.ok ? tax.value.taxRate : row.data.taxRate,
          budgetItemId: row.data.budgetItemCode ? itemByCode.get(row.data.budgetItemCode) ?? null : null,
          downstreamContractId: contract?.id ?? null,
          businessPartyId: partyId ?? null,
          vendorName: contract ? null : row.data.partyName,
        } as ParsedCostRowData & { budgetItemId: string | null; downstreamContractId: string | null; businessPartyId: string | null; vendorName: string | null },
      };
    });
  };

  const costImportBody = z.object({ headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1).max(5000) });

  app.post('/:projectId/costs/import/preview', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const body = costImportBody.safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '导入数据格式不正确', body.error.flatten());
    const { rows, missingColumns, unknownColumns } = parseCostImportRows(body.data.headers, body.data.rows);
    if (missingColumns.length) return failure(reply, 400, 'IMPORT_COLUMN_MISSING', `缺少必需列：${missingColumns.join('、')}`, { missingColumns, unknownColumns });
    const resolved = await resolveCostRows(projectId, rows);
    return success({
      rows: resolved,
      total: resolved.length,
      validCount: resolved.filter((row) => row.valid).length,
      invalidCount: resolved.filter((row) => !row.valid).length,
      unknownColumns,
      canImport: resolved.every((row) => row.valid),
    });
  });

  app.post('/:projectId/costs/import', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'ACTUAL_COST_WRITE')) return;
    const body = costImportBody.safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '导入数据格式不正确', body.error.flatten());
    const { rows, missingColumns } = parseCostImportRows(body.data.headers, body.data.rows);
    if (missingColumns.length) return failure(reply, 400, 'IMPORT_COLUMN_MISSING', `缺少必需列：${missingColumns.join('、')}`);
    const resolved = await resolveCostRows(projectId, rows);
    try {
      assertImportable(resolved);
    } catch (error) {
      if (error instanceof ImportXlsxError) return failure(reply, 400, error.code, error.message, { rows: resolved.filter((row) => !row.valid) });
      throw error;
    }

    const imported = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const row of resolved) {
        const data = row.data as (ParsedCostRowData & { budgetItemId: string | null; downstreamContractId: string | null; businessPartyId: string | null; vendorName: string | null });
        await tx.costEntry.create({ data: {
          projectId,
          type: data.type as CostType,
          date: new Date(`${data.date}T00:00:00.000Z`),
          amount: String(data.amount),
          taxRate: data.taxRate == null ? null : String(data.taxRate),
          taxAmount: data.taxAmount == null ? null : String(data.taxAmount),
          budgetItemId: data.budgetItemId,
          downstreamContractId: data.downstreamContractId,
          businessPartyId: data.businessPartyId,
          description: data.description,
          quantity: data.quantity == null ? null : String(data.quantity),
          unit: data.unit,
          unitPrice: data.unitPrice == null ? null : String(data.unitPrice),
          invoiceNo: data.invoiceNo,
          vendorName: data.vendorName ?? null,
          teamName: data.teamName,
          notes: data.notes,
          createdById: user.sub,
        } });
        count += 1;
      }
      await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'CostEntry', entityId: projectId, action: 'IMPORT_XLSX', changes: { imported: count } } });
      return count;
    });

    return reply.code(201).send(success({ imported, sourceFormat: 'XLSX' as const }));
  });
}
