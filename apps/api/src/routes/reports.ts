import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { authRequired, authUser, type AuthUser } from '../lib/auth.js';
import { buildCsv } from '../lib/csv-export.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { enqueueBackgroundJob, hashJobRequest } from '../lib/background-jobs.js';
import { backgroundJobArtifactPath } from '../lib/background-job-storage.js';
import { canAccessProject } from '../lib/project-access.js';
import { loadReportSnapshot, makeReportFields, reportCatalog, reportKeys, type ReportKey, type ReportFilters } from '../lib/report-data.js';
import { buildReportWorkbook, reportKeyToFilename, reportRowToJson } from '../lib/report-xlsx.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';
import { createDefaultDefinition, validateReportTemplateDefinition, type ReportTemplateDefinition, type ReportTemplateScope } from '../lib/report-template.js';

const querySchema = z.object({
  projectId: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const exportQuerySchema = querySchema.extend({ templateId: z.string().trim().min(1).optional(), printAll: z.enum(['true']).optional() });
const reportKeySchema = z.enum(reportKeys);
const templateCreateSchema = z.object({
  reportKey: reportKeySchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).optional().default(''),
  scope: z.enum(['PERSONAL', 'PROJECT', 'SYSTEM']).default('PERSONAL'),
  projectId: z.string().trim().min(1).optional().nullable(),
  definition: z.unknown(),
});
const templateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).optional().default(''),
  expectedVersion: z.number().int().positive(),
  definition: z.unknown(),
});

function queryFilters(value: z.infer<typeof querySchema>): ReportFilters {
  return { projectId: value.projectId || undefined, from: value.from, to: value.to };
}

async function accessibleProjectIds(user: AuthUser): Promise<string[]> {
  const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

async function canReadTemplate(template: { scope: string; status: string; ownerUserId: string | null; projectId: string | null }, user: AuthUser): Promise<boolean> {
  if (template.scope === 'SYSTEM') return template.status === 'PUBLISHED' || user.role === 'ADMIN';
  if (template.scope === 'PERSONAL') return template.ownerUserId === user.sub;
  if (template.scope === 'PROJECT' && template.projectId) {
    if (!(await canAccessProject(user.sub, user.role, template.projectId, undefined, 'REPORT_EXPORT'))) return false;
    if (template.status === 'PUBLISHED') return true;
    return template.ownerUserId === user.sub || user.role === 'ADMIN' || canAccessProject(user.sub, user.role, template.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE');
  }
  return false;
}

async function canEditTemplate(template: { scope: string; ownerUserId: string | null; projectId: string | null }, user: AuthUser): Promise<boolean> {
  if (template.scope === 'SYSTEM') return user.role === 'ADMIN';
  if (template.scope === 'PERSONAL') return template.ownerUserId === user.sub;
  if (template.scope === 'PROJECT' && template.projectId) return canAccessProject(user.sub, user.role, template.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE');
  return false;
}

function templateResponse(template: {
  id: string; reportKey: string; name: string; description: string | null; scope: string; projectId: string | null;
  ownerUserId: string | null; version: number; publishedVersion: number | null; status: string; definition: unknown;
  publishedDefinition: unknown; createdById: string; updatedById: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: template.id, reportKey: template.reportKey, name: template.name, description: template.description ?? '',
    scope: template.scope, projectId: template.projectId, ownerUserId: template.ownerUserId,
    version: template.version, publishedVersion: template.publishedVersion, status: template.status,
    definition: template.definition, publishedDefinition: template.publishedDefinition,
    createdById: template.createdById, updatedById: template.updatedById,
    createdAt: template.createdAt, updatedAt: template.updatedAt,
  };
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/catalog', { preHandler: authRequired }, async () => success(reportCatalog.map((report) => ({ ...report, fields: makeReportFields(report.key) }))));

  app.get('/templates', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = z.object({ reportKey: reportKeySchema.optional(), projectId: z.string().optional() }).safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '模板筛选条件不正确', parsed.error.flatten());
    const projectIds = await accessibleProjectIds(user);
    if (parsed.data.projectId && !projectIds.includes(parsed.data.projectId)) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目报表模板的权限');
    const candidateTemplates = await prisma.reportTemplate.findMany({
      where: {
        ...(parsed.data.reportKey ? { reportKey: parsed.data.reportKey } : {}),
        status: { not: 'ARCHIVED' },
        OR: [
          { scope: 'SYSTEM', status: 'PUBLISHED' },
          ...(user.role === 'ADMIN' ? [{ scope: 'SYSTEM' as const, status: 'DRAFT' as const }] : []),
          { scope: 'PERSONAL', ownerUserId: user.sub },
          { scope: 'PROJECT', projectId: { in: parsed.data.projectId ? [parsed.data.projectId] : projectIds }, status: 'PUBLISHED' },
          { scope: 'PROJECT', projectId: { in: parsed.data.projectId ? [parsed.data.projectId] : projectIds }, status: 'DRAFT' },
        ],
      },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
    });
    const templates = await Promise.all(candidateTemplates
      .filter((template) => template.scope !== 'PROJECT' || template.projectId === null || projectIds.includes(template.projectId))
      .map(async (template) => ({ template, readable: await canReadTemplate(template, user) })));
    return success(await Promise.all(templates.filter((item) => item.readable).map(async ({ template }) => ({
      id: template.id, reportKey: template.reportKey, name: template.name, description: template.description ?? '', scope: template.scope,
      projectId: template.projectId, version: template.version, publishedVersion: template.publishedVersion, status: template.status,
      updatedAt: template.updatedAt, createdById: template.createdById, ownerUserId: template.ownerUserId, editable: await canEditTemplate(template, user),
    }))));
  });

  app.post('/templates', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = templateCreateSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '模板信息不完整或格式不正确', parsed.error.flatten());
    const input = parsed.data;
    if (input.scope === 'SYSTEM' && user.role !== 'ADMIN') return failure(reply, 403, 'REPORT_TEMPLATE_ADMIN_REQUIRED', '只有系统管理员可以创建系统模板');
    if (input.scope === 'PROJECT') {
      if (!input.projectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目模板必须指定项目');
      if (!(await canAccessProject(user.sub, user.role, input.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '只有项目负责人或项目经理可以创建项目共享模板');
      const project = await prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } });
      if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
    }
    const validated = validateReportTemplateDefinition(input.definition, input.reportKey);
    if (!validated.success) return failure(reply, 400, 'REPORT_TEMPLATE_INVALID', validated.message, validated.details);
    if (!validated.data.columns.some((column) => column.visible)) return failure(reply, 400, 'REPORT_TEMPLATE_NO_VISIBLE_COLUMNS', '至少需要保留一列可见字段');
    const scope = input.scope as ReportTemplateScope;
    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.reportTemplate.create({
        data: {
          reportKey: input.reportKey, name: input.name, description: input.description, scope,
          projectId: scope === 'PROJECT' ? input.projectId! : null,
          ownerUserId: scope === 'PERSONAL' ? user.sub : scope === 'PROJECT' ? user.sub : null,
          version: 1, status: 'DRAFT', definition: validated.data, createdById: user.sub, updatedById: user.sub,
        },
      });
      await tx.reportTemplateRevision.create({ data: { templateId: template.id, version: 1, action: 'CREATED', definition: validated.data, createdById: user.sub } });
      await tx.auditLog.create({ data: { projectId: scope === 'PROJECT' ? input.projectId! : null, userId: user.sub, entity: 'ReportTemplate', entityId: template.id, action: 'REPORT_TEMPLATE_CREATED', changes: { reportKey: input.reportKey, name: input.name, scope, version: 1 } } });
      return template;
    });
    return reply.code(201).send(success(templateResponse(created)));
  });

  app.get('/templates/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canReadTemplate(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该报表模板的权限');
    const editable = await canEditTemplate(template, user);
    const definition = template.status === 'PUBLISHED' && template.publishedDefinition && !editable ? template.publishedDefinition : template.definition;
    return success({ ...templateResponse(template), definition, editable });
  });

  app.patch('/templates/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const parsed = templateUpdateSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '模板信息不完整或格式不正确', parsed.error.flatten());
    const current = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!current) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canEditTemplate(current, user))) return failure(reply, 403, 'REPORT_TEMPLATE_EDIT_DENIED', '你没有编辑该模板的权限');
    if (current.version !== parsed.data.expectedVersion) return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后重新编辑');
    if (current.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '归档模板不能继续修改');
    const validated = validateReportTemplateDefinition(parsed.data.definition, current.reportKey as ReportKey);
    if (!validated.success) return failure(reply, 400, 'REPORT_TEMPLATE_INVALID', validated.message, validated.details);
    if (!validated.data.columns.some((column) => column.visible)) return failure(reply, 400, 'REPORT_TEMPLATE_NO_VISIBLE_COLUMNS', '至少需要保留一列可见字段');
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.reportTemplate.updateMany({
          where: { id, version: parsed.data.expectedVersion, status: { not: 'ARCHIVED' } },
          data: {
            name: parsed.data.name, description: parsed.data.description, definition: validated.data,
            version: { increment: 1 }, status: current.publishedDefinition ? 'PUBLISHED' : 'DRAFT', updatedById: user.sub,
          },
        });
        if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
        const next = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
        await tx.reportTemplateRevision.create({ data: { templateId: id, version: next.version, action: 'UPDATED', definition: validated.data, createdById: user.sub } });
        await tx.auditLog.create({ data: { projectId: current.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_TEMPLATE_UPDATED', changes: { name: next.name, version: next.version, status: next.status } } });
        return next;
      });
      return success(templateResponse(updated));
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_VERSION_CONFLICT') return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后重新编辑');
      throw error;
    }
  });

  app.post('/templates/:id/publish', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canEditTemplate(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_PUBLISH_DENIED', '你没有发布该模板的权限');
    if (template.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '归档模板不能发布');
    const definition = validateReportTemplateDefinition(template.definition, template.reportKey as ReportKey);
    if (!definition.success) return failure(reply, 400, 'REPORT_TEMPLATE_INVALID', definition.message, definition.details);
    let updated: NonNullable<typeof template>;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.reportTemplate.updateMany({
          where: { id, version: template.version, status: { not: 'ARCHIVED' } },
          data: { publishedDefinition: definition.data, publishedVersion: template.version, status: 'PUBLISHED', updatedById: user.sub },
        });
        if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
        const result = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
        await tx.reportTemplateRevision.create({ data: { templateId: id, version: result.version, action: 'PUBLISHED', definition: definition.data, createdById: user.sub } });
        await tx.auditLog.create({ data: { projectId: template.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_TEMPLATE_PUBLISHED', changes: { reportKey: result.reportKey, name: result.name, version: result.version, scope: result.scope } } });
        return result;
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_VERSION_CONFLICT') return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后重新发布');
      throw error;
    }
    return success(templateResponse(updated));
  });

  app.post('/templates/:id/duplicate', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const source = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!source) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canReadTemplate(source, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该报表模板的权限');
    const inputName = z.object({ name: z.string().trim().min(1).max(100).optional() }).safeParse(request.body ?? {});
    if (!inputName.success) return failure(reply, 400, 'VALIDATION_ERROR', '模板名称不正确');
    const definition = source.status === 'PUBLISHED' && source.publishedDefinition ? source.publishedDefinition : source.definition;
    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.reportTemplate.create({ data: {
        reportKey: source.reportKey, name: inputName.data.name ?? `${source.name} - 副本`, description: source.description,
        scope: 'PERSONAL', projectId: null, ownerUserId: user.sub, version: 1, status: 'DRAFT',
        definition: definition as object, createdById: user.sub, updatedById: user.sub,
      } });
      await tx.reportTemplateRevision.create({ data: { templateId: template.id, version: 1, action: 'DUPLICATED', definition: definition as object, createdById: user.sub } });
      await tx.auditLog.create({ data: { userId: user.sub, entity: 'ReportTemplate', entityId: template.id, action: 'REPORT_TEMPLATE_DUPLICATED', changes: { sourceTemplateId: source.id, sourceName: source.name } } });
      return template;
    });
    return reply.code(201).send(success(templateResponse(created)));
  });

  app.post('/templates/:id/archive', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ expectedVersion: z.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '归档请求缺少有效的模板版本号');
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canEditTemplate(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_EDIT_DENIED', '你没有归档该模板的权限');
    if (template.version !== parsed.data.expectedVersion) return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后再归档');
    if (template.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '模板已经归档');
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.reportTemplate.updateMany({
          where: { id, version: parsed.data.expectedVersion, status: { not: 'ARCHIVED' } },
          data: { status: 'ARCHIVED', updatedById: user.sub },
        });
        if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
        const result = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
        await tx.reportTemplateRevision.create({ data: { templateId: id, version: result.version, action: 'ARCHIVED', definition: template.definition as object, createdById: user.sub } });
        await tx.auditLog.create({ data: { projectId: template.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_TEMPLATE_ARCHIVED', changes: { name: template.name, version: template.version } } });
        return result;
      });
      return success(templateResponse(updated));
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_VERSION_CONFLICT') return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后再归档');
      throw error;
    }
  });

  app.get('/templates/:id/revisions', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id } = request.params as { id: string };
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canReadTemplate(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该模板历史版本的权限');
    const revisions = await prisma.reportTemplateRevision.findMany({
      where: { templateId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, version: true, action: true, createdById: true, createdAt: true },
    });
    return success(revisions);
  });

  app.post('/templates/:id/revisions/:revisionId/restore', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { id, revisionId } = request.params as { id: string; revisionId: string };
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
    if (!(await canEditTemplate(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_EDIT_DENIED', '你没有恢复该模板历史版本的权限');
    if (template.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '归档模板不能恢复历史版本');
    const parsed = z.object({ expectedVersion: z.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '恢复请求缺少有效的模板版本号');
    if (template.version !== parsed.data.expectedVersion) return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后再恢复历史版本');
    const revision = await prisma.reportTemplateRevision.findFirst({ where: { id: revisionId, templateId: id } });
    if (!revision) return failure(reply, 404, 'REPORT_TEMPLATE_REVISION_NOT_FOUND', '历史版本不存在');
    const validated = validateReportTemplateDefinition(revision.definition, template.reportKey as ReportKey);
    if (!validated.success) return failure(reply, 409, 'REPORT_TEMPLATE_REVISION_INVALID', '该历史版本不符合当前模板结构，无法恢复');
    try {
      const restored = await prisma.$transaction(async (tx) => {
        const changed = await tx.reportTemplate.updateMany({
          where: { id, version: parsed.data.expectedVersion, status: { not: 'ARCHIVED' } },
          data: { definition: validated.data, version: { increment: 1 }, status: template.publishedDefinition ? 'PUBLISHED' : 'DRAFT', updatedById: user.sub },
        });
        if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
        const result = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
        await tx.reportTemplateRevision.create({ data: { templateId: id, version: result.version, action: `RESTORED_FROM_${revision.version}`, definition: validated.data, createdById: user.sub } });
        await tx.auditLog.create({ data: { projectId: template.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_TEMPLATE_REVISION_RESTORED', changes: { restoredFromVersion: revision.version, version: result.version } } });
        return result;
      });
      return success(templateResponse(restored));
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_VERSION_CONFLICT') return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后再恢复历史版本');
      throw error;
    }
  });

  app.get('/:reportKey/preview', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { reportKey: rawKey } = request.params as { reportKey: string };
    const reportKeyParsed = reportKeySchema.safeParse(rawKey);
    if (!reportKeyParsed.success) return failure(reply, 404, 'REPORT_NOT_FOUND', '报表类型不存在');
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表筛选参数不正确', parsed.error.flatten());
    const loaded = await loadReportSnapshot(reportKeyParsed.data, user, queryFilters(parsed.data));
    if (!loaded.ok) return failure(reply, loaded.status, loaded.code, loaded.message);
    const snapshot = loaded.snapshot;
    let template: { id: string | null; name: string; version: number; scope: string; status: string; definition: ReportTemplateDefinition } = {
      id: null, name: '系统默认模板', version: 1, scope: 'SYSTEM', status: 'PUBLISHED', definition: createDefaultDefinition(snapshot.report.key),
    };
    if (parsed.data.templateId) {
      const stored = await prisma.reportTemplate.findUnique({ where: { id: parsed.data.templateId } });
      if (!stored) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
      if (stored.reportKey !== reportKeyParsed.data) return failure(reply, 400, 'REPORT_TEMPLATE_REPORT_MISMATCH', '模板不属于当前报表类型');
      if (!(await canReadTemplate(stored, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该模板的权限');
      const canEdit = await canEditTemplate(stored, user);
      const sourceDefinition = stored.status === 'PUBLISHED' && stored.publishedDefinition && !canEdit ? stored.publishedDefinition : stored.definition;
      const validated = validateReportTemplateDefinition(sourceDefinition, reportKeyParsed.data);
      if (!validated.success) return failure(reply, 409, 'REPORT_TEMPLATE_INVALID', '模板定义无效，请在模板设计器中修复');
      template = { id: stored.id, name: stored.name, version: stored.publishedVersion ?? stored.version, scope: stored.scope, status: stored.status, definition: validated.data };
    }
    return success({
      report: snapshot.report,
      fields: snapshot.fields,
      rows: (parsed.data.printAll === 'true' ? snapshot.rows : snapshot.rows.slice(0, 80)).map(reportRowToJson),
      rowCount: snapshot.rowCount,
      previewRowCount: parsed.data.printAll === 'true' ? snapshot.rows.length : Math.min(80, snapshot.rowCount),
      truncated: snapshot.truncated,
      generatedAt: snapshot.generatedAt.toISOString(),
      projectScope: snapshot.projectScope,
      filters: snapshot.filters,
      template,
    });
  });

  app.get('/:reportKey.csv', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { reportKey: rawKey } = request.params as { reportKey: string };
    const key = reportKeySchema.safeParse(rawKey);
    if (!key.success) return failure(reply, 404, 'REPORT_NOT_FOUND', '报表类型不存在');
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表筛选参数不正确', parsed.error.flatten());
    const loaded = await loadReportSnapshot(key.data, user, parsed.data);
    if (!loaded.ok) return failure(reply, loaded.status, loaded.code, loaded.message);
    const snapshot = loaded.snapshot;
    const csv = buildCsv(snapshot.fields.map((field) => field.label), snapshot.rows);
    return reply.header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="moheng-${key.data}.csv"`)
      .header('cache-control', 'no-store')
      .header('x-report-row-count', String(snapshot.rowCount))
      .header('x-report-truncated', snapshot.truncated ? 'true' : 'false')
      .send(csv);
  });

  app.post('/:reportKey.xlsx/jobs', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { reportKey: rawKey } = request.params as { reportKey: string };
    const key = reportKeySchema.safeParse(rawKey);
    if (!key.success) return failure(reply, 404, 'REPORT_NOT_FOUND', '报表类型不存在');
    const parsed = querySchema.extend({ templateId: z.string().trim().min(1).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '异步报表参数不正确', parsed.error.flatten());
    const filters = queryFilters(parsed.data);
    const validDay = (value: string | undefined) => {
      if (!value) return true;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!validDay(filters.from) || !validDay(filters.to)) return failure(reply, 400, 'INVALID_DATE', '日期无效，请检查筛选条件');
    if (filters.from && filters.to && filters.from > filters.to) return failure(reply, 400, 'INVALID_DATE_RANGE', '开始日期不能晚于结束日期');
    if (filters.projectId && !(await canAccessProject(user.sub, user.role, filters.projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问所选项目报表的权限');

    let definition = createDefaultDefinition(key.data);
    let templateName = '系统默认模板';
    let templateVersion = 1;
    let templateId: string | null = null;
    if (parsed.data.templateId) {
      const stored = await prisma.reportTemplate.findUnique({ where: { id: parsed.data.templateId } });
      if (!stored) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
      if (stored.reportKey !== key.data) return failure(reply, 400, 'REPORT_TEMPLATE_REPORT_MISMATCH', '模板不属于当前报表类型');
      if (!(await canReadTemplate(stored, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有使用该报表模板的权限');
      const canEdit = await canEditTemplate(stored, user);
      const sourceDefinition = stored.status === 'PUBLISHED' && stored.publishedDefinition && !canEdit ? stored.publishedDefinition : stored.definition;
      const validated = validateReportTemplateDefinition(sourceDefinition, key.data);
      if (!validated.success) return failure(reply, 409, 'REPORT_TEMPLATE_INVALID', '模板定义无效，请在模板设计器中修复');
      definition = validated.data;
      templateName = stored.name;
      templateVersion = stored.publishedVersion ?? stored.version;
      templateId = stored.id;
    }
    if (!definition.columns.some((column) => column.visible)) return failure(reply, 400, 'REPORT_TEMPLATE_NO_VISIBLE_COLUMNS', '模板至少需要保留一列可见列');

    const rawIdempotencyKey = request.headers['idempotency-key'];
    if (Array.isArray(rawIdempotencyKey)) return failure(reply, 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 请求头只能有一个值');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    if (idempotencyKey && (idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) return failure(reply, 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 最多 200 个字符，且不能包含换行');

    const payload = JSON.parse(JSON.stringify({ reportKey: key.data, filters, templateDefinition: definition, templateName, templateVersion, templateId })) as Prisma.InputJsonObject;
    const requestHash = hashJobRequest(payload);
    try {
      const job = await prisma.$transaction(async (tx) => {
        const created = await enqueueBackgroundJob(tx, {
          type: 'report.xlsx.export', payloadVersion: 1, payload, ownerUserId: user.sub,
          projectId: filters.projectId ?? null, idempotencyKey, requestHash, maxAttempts: 3,
        });
        await tx.auditLog.create({ data: {
          projectId: filters.projectId ?? null, userId: user.sub, entity: 'BackgroundJob', entityId: created.id,
          action: 'REPORT_XLSX_EXPORT_QUEUED', changes: { reportKey: key.data, projectId: filters.projectId ?? null, templateName, templateVersion, idempotencyKeyPresent: Boolean(idempotencyKey) },
        } });
        return created;
      });
      return reply.code(202).send(success({ id: job.id, type: job.type, status: job.status, createdAt: job.createdAt, statusUrl: `/api/reports/jobs/${job.id}`, downloadUrl: null }));
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.backgroundJob.findFirst({ where: { ownerUserId: user.sub, idempotencyKey } });
        if (existing) {
          if (existing.requestHash !== requestHash) return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '相同 Idempotency-Key 已用于不同的请求，请更换请求键');
          return reply.code(202).send(success({ id: existing.id, type: existing.type, status: existing.status, createdAt: existing.createdAt, statusUrl: `/api/reports/jobs/${existing.id}`, downloadUrl: existing.resultFileName ? `/api/reports/jobs/${existing.id}/download` : null, idempotentReplay: true }));
        }
      }
      throw error;
    }
  });

  app.get('/jobs/:jobId', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { jobId } = request.params as { jobId: string };
    const job = await prisma.backgroundJob.findFirst({ where: { id: jobId, ...(user.role === 'ADMIN' ? {} : { ownerUserId: user.sub }) } });
    if (!job) return failure(reply, 404, 'BACKGROUND_JOB_NOT_FOUND', '任务不存在或当前账号无权查看');
    if (job.projectId && !(await canAccessProject(user.sub, user.role, job.projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你已无权访问该任务关联的项目');
    const fileAvailable = job.status === 'SUCCEEDED' && Boolean(job.resultFileName) && (!job.resultExpiresAt || job.resultExpiresAt.getTime() > Date.now());
    return success({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, result: job.resultMetadata,
      resultAvailable: fileAvailable, downloadExpiresAt: job.resultExpiresAt,
      downloadUrl: fileAvailable ? `/api/reports/jobs/${job.id}/download` : null,
      error: job.status === 'FAILED' ? '任务处理失败，请联系管理员并提供任务编号。' : null });
  });

  app.get('/jobs/:jobId/download', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { jobId } = request.params as { jobId: string };
    const job = await prisma.backgroundJob.findFirst({ where: { id: jobId, ...(user.role === 'ADMIN' ? {} : { ownerUserId: user.sub }) } });
    if (!job) return failure(reply, 404, 'BACKGROUND_JOB_NOT_FOUND', '任务不存在或当前账号无权下载');
    if (job.projectId && !(await canAccessProject(user.sub, user.role, job.projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你已无权访问该任务关联的项目');
    if (job.status !== 'SUCCEEDED') return failure(reply, 409, 'BACKGROUND_JOB_RESULT_NOT_READY', '任务尚未完成，请等待后台处理');
    if (job.resultExpiresAt && job.resultExpiresAt.getTime() <= Date.now()) return failure(reply, 410, 'BACKGROUND_JOB_RESULT_EXPIRED', '导出文件已过期，请重新提交导出任务');
    if (!job.resultFileName) return failure(reply, 410, 'BACKGROUND_JOB_RESULT_MISSING', '导出文件已不存在，请重新提交导出任务');
    if (job.resultFileName !== `${job.id}-${job.attempts}.xlsx`) return failure(reply, 409, 'BACKGROUND_JOB_RESULT_INVALID', '任务结果文件名不符合预期');
    try {
      const buffer = await readFile(backgroundJobArtifactPath(job.resultFileName));
      const metadata = job.resultMetadata && typeof job.resultMetadata === 'object' && !Array.isArray(job.resultMetadata) ? job.resultMetadata as Record<string, Prisma.JsonValue> : {};
      const candidateName = metadata.suggestedFileName;
      const filename = typeof candidateName === 'string' ? candidateName.replace(/[\r\n"]/g, '') : `墨衡-${job.id}.xlsx`;
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="moheng-${job.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .header('cache-control', 'no-store').send(buffer);
    } catch (error) {
      request.log.warn({ err: error, jobId: job.id }, 'Background job artifact is missing');
      return failure(reply, 410, 'BACKGROUND_JOB_RESULT_MISSING', '导出文件已不存在，请重新提交导出任务');
    }
  });

  app.get('/:reportKey.xlsx', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { reportKey: rawKey } = request.params as { reportKey: string };
    const key = reportKeySchema.safeParse(rawKey);
    if (!key.success) return failure(reply, 404, 'REPORT_NOT_FOUND', '报表类型不存在');
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表筛选参数不正确', parsed.error.flatten());
    const loaded = await loadReportSnapshot(key.data, user, queryFilters(parsed.data));
    if (!loaded.ok) return failure(reply, loaded.status, loaded.code, loaded.message);
    let definition = createDefaultDefinition(key.data);
    let templateName = '系统默认模板';
    let templateVersion = 1;
    if (parsed.data.templateId) {
      const stored = await prisma.reportTemplate.findUnique({ where: { id: parsed.data.templateId } });
      if (!stored) return failure(reply, 404, 'REPORT_TEMPLATE_NOT_FOUND', '报表模板不存在');
      if (stored.reportKey !== key.data) return failure(reply, 400, 'REPORT_TEMPLATE_REPORT_MISMATCH', '模板不属于当前报表类型');
      if (!(await canReadTemplate(stored, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有使用该报表模板的权限');
      const canEdit = await canEditTemplate(stored, user);
      const sourceDefinition = stored.status === 'PUBLISHED' && stored.publishedDefinition && !canEdit ? stored.publishedDefinition : stored.definition;
      const validated = validateReportTemplateDefinition(sourceDefinition, key.data);
      if (!validated.success) return failure(reply, 409, 'REPORT_TEMPLATE_INVALID', '模板定义无效，请在模板设计器中修复');
      definition = validated.data;
      templateName = stored.name;
      templateVersion = stored.publishedVersion ?? stored.version;
    }
    try {
      const buffer = await buildReportWorkbook({ snapshot: loaded.snapshot, definition, templateName, templateVersion });
      const filename = `墨衡-${reportKeyToFilename(key.data)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="moheng-${reportKeyToFilename(key.data)}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .header('cache-control', 'no-store')
        .header('x-report-row-count', String(loaded.snapshot.rowCount))
        .header('x-report-truncated', loaded.snapshot.truncated ? 'true' : 'false')
        .send(buffer);
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_NO_VISIBLE_COLUMNS') return failure(reply, 400, 'REPORT_TEMPLATE_NO_VISIBLE_COLUMNS', '模板至少需要保留一列可见列');
      throw error;
    }
  });
}
