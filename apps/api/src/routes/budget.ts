import type { FastifyInstance } from 'fastify';
import { ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney, roundMoney } from '../lib/validation.js';

const budgetInput = z.object({
  parentId: z.string().optional().nullable(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  unit: z.string().max(32).optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  unitPrice: z.number().nonnegative().optional().nullable(),
  totalPrice: nonNegativeMoney.optional(),
  sortOrder: z.number().int().default(0),
});

function serialise(item: any) {
  return { ...item, quantity: item.quantity == null ? null : Number(item.quantity), unitPrice: item.unitPrice == null ? null : Number(item.unitPrice), totalPrice: Number(item.totalPrice) };
}

export async function budgetRoutes(app: FastifyInstance) {
  app.get('/:projectId/budget', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const items = await prisma.budgetItem.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return success(items.map(serialise));
  });

  app.post('/:projectId/budget/items', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR])) return;
    const parsed = budgetInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '清单条目填写有误', parsed.error.flatten());
    const parent = parsed.data.parentId ? await prisma.budgetItem.findFirst({ where: { id: parsed.data.parentId, projectId, deletedAt: null } }) : null;
    if (parsed.data.parentId && !parent) return failure(reply, 400, 'INVALID_PARENT', '上级清单项不存在或不属于当前项目');
    const totalPrice = parsed.data.totalPrice ?? roundMoney((parsed.data.quantity ?? 0) * (parsed.data.unitPrice ?? 0));
    try {
      const item = await prisma.$transaction(async (tx) => {
        const saved = await tx.budgetItem.create({ data: {
          projectId, parentId: parsed.data.parentId ?? null, code: parsed.data.code, name: parsed.data.name,
          unit: parsed.data.unit ?? null, quantity: parsed.data.quantity == null ? null : String(parsed.data.quantity),
          unitPrice: parsed.data.unitPrice == null ? null : String(parsed.data.unitPrice), totalPrice: String(totalPrice),
          level: parent ? parent.level + 1 : 1, sortOrder: parsed.data.sortOrder,
        } });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'BudgetItem', entityId: saved.id, action: 'CREATE', changes: parsed.data } });
        return saved;
      });
      return reply.code(201).send(success(serialise(item)));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'BUDGET_CODE_EXISTS', '该项目下清单编号已存在');
      throw error;
    }
  });

  app.patch('/:projectId/budget/items/:itemId', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR])) return;
    const parsed = budgetInput.partial().safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '清单条目填写有误', parsed.error.flatten());
    const old = await prisma.budgetItem.findFirst({ where: { id: itemId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'BUDGET_ITEM_NOT_FOUND', '清单条目不存在');
    if (parsed.data.parentId !== undefined && (parsed.data.parentId ?? null) !== (old.parentId ?? null)) {
      return failure(reply, 400, 'PARENT_CHANGE_NOT_SUPPORTED', '本版暂不支持修改既有清单项的层级关系；如需调整，请在导入前整理清单结构。');
    }
    if (parsed.data.parentId === itemId) return failure(reply, 400, 'INVALID_PARENT', '清单项不能将自己设为上级');
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.quantity !== undefined) data.quantity = parsed.data.quantity === null ? null : String(parsed.data.quantity);
    if (parsed.data.unitPrice !== undefined) data.unitPrice = parsed.data.unitPrice === null ? null : String(parsed.data.unitPrice);
    if (parsed.data.totalPrice !== undefined) data.totalPrice = String(parsed.data.totalPrice);
    else if (parsed.data.quantity !== undefined || parsed.data.unitPrice !== undefined) {
      data.totalPrice = String(roundMoney((parsed.data.quantity ?? Number(old.quantity ?? 0))! * (parsed.data.unitPrice ?? Number(old.unitPrice ?? 0))!));
    }
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const result = await tx.budgetItem.update({ where: { id: itemId }, data: data as never });
        await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'BudgetItem', entityId: itemId, action: 'UPDATE', changes: parsed.data } });
        return result;
      });
      return success(serialise(saved));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'BUDGET_CODE_EXISTS', '该项目下清单编号已存在');
      throw error;
    }
  });

  app.post('/:projectId/budget/import-csv/preview', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR])) return;
    const rawSchema = z.object({ rows: z.array(z.unknown()).min(1).max(5000) });
    const parsedBody = rawSchema.safeParse(request.body);
    if (!parsedBody.success) return failure(reply, 400, 'VALIDATION_ERROR', '预检数据格式不正确，单次最多 5,000 行', parsedBody.error.flatten());

    const parsedRows = parsedBody.data.rows.map((row, index) => ({ index, result: budgetInput.omit({ sortOrder: true }).extend({ sortOrder: z.number().int().optional() }).safeParse(row) }));
    const rowIssues = parsedRows.map(({ index, result }) => ({ rowNumber: index + 2, code: result.success ? result.data.code : '', errors: result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.') || '行'}：${issue.message}`), data: result.success ? result.data : null }));
    const validRows = rowIssues.filter((row) => row.data !== null) as Array<{ rowNumber: number; code: string; errors: string[]; data: z.infer<typeof budgetInput> }>;
    const codeRows = new Map<string, number[]>();
    for (const row of validRows) codeRows.set(row.code, [...(codeRows.get(row.code) ?? []), row.rowNumber]);
    for (const [code, lineNumbers] of codeRows) if (lineNumbers.length > 1) for (const lineNumber of lineNumbers) { const issue = rowIssues[lineNumber - 2]; if (issue) issue.errors.push(`编号“${code}”在导入文件中重复`); }

    const codes = validRows.map((row) => row.code);
    const existing = codes.length ? await prisma.budgetItem.findMany({ where: { projectId, code: { in: codes }, deletedAt: null }, select: { code: true } }) : [];
    const existingCodes = new Set(existing.map((row) => row.code));
    for (const row of validRows) if (existingCodes.has(row.code)) { const issue = rowIssues[row.rowNumber - 2]; if (issue) issue.errors.push(`编号“${row.code}”已存在于当前项目`); }

    const importedCodesBefore = new Set<string>();
    const existingParents = new Set((await prisma.budgetItem.findMany({ where: { projectId, deletedAt: null }, select: { id: true, code: true } })).flatMap((row) => [row.id, row.code]));
    for (const row of validRows.sort((a, b) => a.rowNumber - b.rowNumber)) {
      const parentRef = (row.data as { parentId?: string | null }).parentId;
      if (parentRef && !importedCodesBefore.has(parentRef) && !existingParents.has(parentRef)) { const issue = rowIssues[row.rowNumber - 2]; if (issue) issue.errors.push(`上级“${parentRef}”不存在或位于子级之后`); }
      if (row.code) importedCodesBefore.add(row.code);
    }
    const normalized = rowIssues.map((row) => ({ rowNumber: row.rowNumber, code: row.code, valid: row.errors.length === 0, errors: row.errors }));
    return success({ rows: normalized, total: normalized.length, validCount: normalized.filter((row) => row.valid).length, invalidCount: normalized.filter((row) => !row.valid).length, canImport: normalized.length > 0 && normalized.every((row) => row.valid) });
  });

  app.post('/:projectId/budget/import-csv', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR])) return;
    const schema = z.object({ rows: z.array(budgetInput.omit({ sortOrder: true }).extend({ sortOrder: z.number().int().optional() })).min(1).max(5000) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '导入数据格式不正确，请检查预览中的错误行', parsed.error.flatten());
    const codes = parsed.data.rows.map((r) => r.code);
    if (new Set(codes).size !== codes.length) return failure(reply, 400, 'DUPLICATE_CODES', '导入文件中存在重复清单编号');
    const existing = await prisma.budgetItem.findMany({ where: { projectId, code: { in: codes }, deletedAt: null }, select: { code: true } });
    if (existing.length) return failure(reply, 409, 'BUDGET_CODE_EXISTS', `以下编号已存在：${existing.map((r) => r.code).join('、')}`);
    const codeToId = new Map<string, string>();
    const created = await prisma.$transaction(async (tx) => {
      // Import rows are intentionally accepted in parent-before-child order.
      const out = [];
      for (const row of parsed.data.rows) {
        let parent = null;
        if (row.parentId) {
          const importedParentId = codeToId.get(row.parentId);
          parent = importedParentId
            ? await tx.budgetItem.findFirst({ where: { id: importedParentId, projectId, deletedAt: null } })
            : await tx.budgetItem.findFirst({
              where: { projectId, deletedAt: null, OR: [{ id: row.parentId }, { code: row.parentId }] },
            });
          if (!parent) throw new Error(`IMPORT_PARENT_MISSING:${row.code}:${row.parentId}`);
        }
        const parentId = parent?.id ?? null;
        const totalPrice = row.totalPrice ?? roundMoney((row.quantity ?? 0) * (row.unitPrice ?? 0));
        const saved = await tx.budgetItem.create({ data: {
          projectId, parentId, code: row.code, name: row.name, unit: row.unit ?? null,
          quantity: row.quantity == null ? null : String(row.quantity), unitPrice: row.unitPrice == null ? null : String(row.unitPrice),
          totalPrice: String(totalPrice), level: parent ? parent.level + 1 : 1, sortOrder: row.sortOrder ?? 0,
        } });
        codeToId.set(row.code, saved.id);
        out.push(saved);
      }
      await tx.auditLog.create({ data: { projectId, userId: user.sub, entity: 'BudgetItem', entityId: projectId, action: 'IMPORT_CSV', changes: { count: out.length } } });
      return out;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('IMPORT_PARENT_MISSING:')) return null;
      throw error;
    });
    if (!created) return failure(reply, 400, 'IMPORT_PARENT_MISSING', '上级编号无法匹配，请确认父级清单在文件中且位于子级之前');
    return reply.code(201).send(success({ imported: created.length }));
  });
}
