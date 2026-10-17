import type { FastifyInstance } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { authRequired, authUser } from '../lib/auth.js';
import { buildAuditLogCsv, sanitizeAuditChanges } from '../lib/audit-log-csv.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须为 YYYY-MM-DD').optional();
const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  projectId: z.string().trim().min(1).optional(),
  entity: z.string().trim().max(80).optional(),
  from: daySchema,
  to: daySchema,
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(20),
  format: z.enum(['json', 'csv']).default('json'),
});

function parseDay(value: string | undefined, endExclusive = false): Date | undefined {
  if (!value) return undefined;
  const parts = value.split('-');
  if (parts.length !== 3) return new Date(Number.NaN);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (![year, month, day].every(Number.isFinite)) return new Date(Number.NaN);
  const date = new Date(Date.UTC(year, month - 1, day + (endExclusive ? 1 : 0)));
  if (!endExclusive && (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)) return new Date(Number.NaN);
  if (endExclusive) {
    const original = new Date(Date.UTC(year, month - 1, day));
    if (original.getUTCFullYear() !== year || original.getUTCMonth() !== month - 1 || original.getUTCDate() !== day) return new Date(Number.NaN);
  }
  return date;
}

export async function auditLogRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '操作追溯筛选条件不正确', parsed.error.flatten());
    const filter = parsed.data;
    const from = parseDay(filter.from);
    const toExclusive = parseDay(filter.to, true);
    if ((from && Number.isNaN(from.getTime())) || (toExclusive && Number.isNaN(toExclusive.getTime()))) {
      return failure(reply, 400, 'INVALID_DATE', '日期无效，请检查筛选条件');
    }
    if (from && toExclusive && from >= toExclusive) return failure(reply, 400, 'INVALID_DATE_RANGE', '开始日期不能晚于结束日期');

    const projects = await prisma.project.findMany({
      where: user.role === 'ADMIN' ? {} : { members: { some: { userId: user.sub } } },
      select: { id: true, name: true, code: true },
      orderBy: { updatedAt: 'desc' },
    });
    const projectIds = projects.map((project) => project.id);
    if (filter.projectId && !projectIds.includes(filter.projectId)) {
      return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有查看所选项目操作记录的权限');
    }

    const scope: Prisma.AuditLogWhereInput = filter.projectId
      ? { projectId: filter.projectId }
      : user.role === 'ADMIN'
        ? { OR: [{ projectId: { in: projectIds } }, { projectId: null }] }
        : { projectId: { in: projectIds } };
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        scope,
        ...(filter.entity ? [{ entity: filter.entity } satisfies Prisma.AuditLogWhereInput] : []),
        ...(filter.q ? [{ OR: [
          { entity: { contains: filter.q, mode: 'insensitive' } },
          { entityId: { contains: filter.q, mode: 'insensitive' } },
          { action: { contains: filter.q, mode: 'insensitive' } },
          { user: { is: { name: { contains: filter.q, mode: 'insensitive' } } } },
          { project: { is: { name: { contains: filter.q, mode: 'insensitive' } } } },
          { project: { is: { code: { contains: filter.q, mode: 'insensitive' } } } },
        ] } satisfies Prisma.AuditLogWhereInput] : []),
        ...(from || toExclusive ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } satisfies Prisma.AuditLogWhereInput] : []),
      ],
    };
    const exportMode = filter.format === 'csv';
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } }, project: { select: { id: true, name: true, code: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: exportMode ? 5000 : filter.pageSize,
        ...(!exportMode ? { skip: (filter.page - 1) * filter.pageSize } : {}),
      }),
    ]);

    if (exportMode) {
      const csv = buildAuditLogCsv(rows.map((row) => ({
        createdAt: row.createdAt,
        actor: row.user.name,
        projectName: row.project?.name ?? '全局/单位档案',
        projectCode: row.project?.code ?? '',
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        changes: sanitizeAuditChanges(row.changes),
      })));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', "attachment; filename=\"moheng-audit-logs.csv\"; filename*=UTF-8''%E5%A2%A8%E8%A1%A1-%E6%93%8D%E4%BD%9C%E8%BF%BD%E6%BA%AF.csv")
        .header('cache-control', 'no-store')
        .send(csv);
    }

    return success({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actor: { id: row.user.id, name: row.user.name, email: row.user.email },
        project: row.project ? { id: row.project.id, name: row.project.name, code: row.project.code } : null,
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        changes: sanitizeAuditChanges(row.changes),
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      pageCount: Math.ceil(total / filter.pageSize),
      exportLimit: 5000,
    });
  });
}
