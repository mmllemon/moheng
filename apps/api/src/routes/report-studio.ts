import type { FastifyInstance } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { authRequired, authUser, type AuthUser } from '../lib/auth.js';
import { canAccessProject } from '../lib/project-access.js';
import { prisma } from '../lib/prisma.js';
import { failure, success } from '../lib/http.js';
import { enqueueBackgroundJob, hashJobRequest } from '../lib/background-jobs.js';
import { loadReportStudioDataset, reportStudioSources, type ReportStudioDomain } from '../lib/report-studio-data.js';
import { domainFromStudioReportKey, STUDIO_REPORT_KEYS, studioReportKey, validateReportStudioDefinition } from '../lib/report-studio-definition.js';
import { previewReportStudio, renderReportStudio } from '../lib/report-studio-render.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';

const domainSchema = z.enum(['PROJECT', 'COMPANY', 'PARTY']);
const createSchema = z.object({
  domain: domainSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
  scope: z.enum(['PERSONAL', 'PROJECT', 'SYSTEM']).default('PERSONAL'),
  projectId: z.string().trim().min(1).nullable().optional(),
  businessPartyId: z.string().trim().min(1).nullable().optional(),
  definition: z.unknown(),
}).strict();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
  expectedVersion: z.number().int().positive(),
  definition: z.unknown(),
}).strict();

async function hasProject(user: AuthUser, projectId: string): Promise<boolean> {
  return canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ');
}
async function hasBusinessParty(user: AuthUser, businessPartyId: string): Promise<boolean> {
  const party = await prisma.businessParty.findUnique({ where: { id: businessPartyId }, select: { id: true } });
  if (!party) return false;
  if (user.role === 'ADMIN') return true;
  const canReadAllProjects = await hasCrossProjectReadScope(user.sub, user.role, 'REPORT_EXPORT');
  const visibleLinkedProject = await prisma.project.findFirst({
    where: { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }), OR: [
      { ownerPartyId: businessPartyId },
      { downstreamContracts: { some: { counterpartyPartyId: businessPartyId, deletedAt: null } } },
      { costEntries: { some: { businessPartyId, downstreamContractId: null, deletedAt: null } } },
    ] }, select: { id: true },
  });
  return Boolean(visibleLinkedProject);
}
async function canRead(template: { scope: string; status: string; ownerUserId: string | null; projectId: string | null }, user: AuthUser): Promise<boolean> {
  if (template.scope === 'SYSTEM') return template.status === 'PUBLISHED' || user.role === 'ADMIN';
  if (template.scope === 'PERSONAL') return template.ownerUserId === user.sub;
  if (template.scope === 'PROJECT' && template.projectId) {
    if (!(await hasProject(user, template.projectId))) return false;
    if (template.status === 'PUBLISHED') return true;
    return template.ownerUserId === user.sub || user.role === 'ADMIN' || canAccessProject(user.sub, user.role, template.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE');
  }
  return false;
}
async function canEdit(template: { scope: string; ownerUserId: string | null; projectId: string | null }, user: AuthUser): Promise<boolean> {
  if (template.scope === 'SYSTEM') return user.role === 'ADMIN';
  if (template.scope === 'PERSONAL') return template.ownerUserId === user.sub;
  if (template.scope === 'PROJECT' && template.projectId) return canAccessProject(user.sub, user.role, template.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE');
  return false;
}
function payloadTemplate(template: {
  id: string; reportKey: string; name: string; description: string | null; scope: string; projectId: string | null; businessPartyId: string | null; ownerUserId: string | null;
  version: number; publishedVersion: number | null; status: string; definition: unknown; publishedDefinition: unknown; createdById: string;
  updatedById: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: template.id, domain: domainFromStudioReportKey(template.reportKey), reportKey: template.reportKey, name: template.name,
    description: template.description ?? '', scope: template.scope, projectId: template.projectId, businessPartyId: template.businessPartyId, ownerUserId: template.ownerUserId,
    version: template.version, publishedVersion: template.publishedVersion, status: template.status,
    definition: template.definition,
    createdById: template.createdById, updatedById: template.updatedById,
    createdAt: template.createdAt, updatedAt: template.updatedAt,
  };
}
function parsedDomain(value: unknown): ReportStudioDomain | null {
  const parsed = domainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export async function reportStudioRoutes(app: FastifyInstance) {
  app.get('/catalog', { preHandler: authRequired }, async (request, reply) => {
    const parsed = domainSchema.safeParse((request.query as { domain?: unknown }).domain);
    if (!parsed.success) return failure(reply, 400, 'REPORT_STUDIO_DOMAIN_REQUIRED', '请选择项目级、公司级或往来单位档案报表');
    return success({ domain: parsed.data, sources: reportStudioSources.filter((source) => source.domains.includes(parsed.data)) });
  });

  app.get('/templates', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = z.object({ domain: domainSchema, projectId: z.string().trim().optional(), businessPartyId: z.string().trim().optional() }).safeParse(request.query);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表模板筛选条件无效', parsed.error.flatten());
    if (parsed.data.domain === 'PROJECT' && !parsed.data.projectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目级模板列表需要项目编号');
    if (parsed.data.projectId && !(await hasProject(user, parsed.data.projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目报表的权限');
    if (parsed.data.domain === 'PARTY' && !parsed.data.businessPartyId) return failure(reply, 400, 'BUSINESS_PARTY_ID_REQUIRED', '往来单位档案报表需要指定单位');
    if (parsed.data.businessPartyId && !(await hasBusinessParty(user, parsed.data.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    const key = studioReportKey(parsed.data.domain);
    const where = {
      reportKey: key,
      status: { not: 'ARCHIVED' as const },
      ...(parsed.data.domain === 'PROJECT' ? {
        OR: [
          { scope: 'PERSONAL' as const, ownerUserId: user.sub },
          { scope: 'PROJECT' as const, projectId: parsed.data.projectId, status: 'PUBLISHED' as const },
          { scope: 'PROJECT' as const, projectId: parsed.data.projectId, status: 'DRAFT' as const },
          ...(user.role === 'ADMIN' ? [{ scope: 'SYSTEM' as const, status: 'DRAFT' as const }] : []),
          { scope: 'SYSTEM' as const, status: 'PUBLISHED' as const },
        ],
      } : parsed.data.domain === 'PARTY' ? {
        OR: [
          { scope: 'PERSONAL' as const, ownerUserId: user.sub, businessPartyId: parsed.data.businessPartyId },
          { scope: 'SYSTEM' as const, status: 'PUBLISHED' as const, businessPartyId: null },
          ...(user.role === 'ADMIN' ? [{ scope: 'SYSTEM' as const, status: 'DRAFT' as const, businessPartyId: null }] : []),
        ],
      } : {
        OR: [
          { scope: 'PERSONAL' as const, ownerUserId: user.sub },
          { scope: 'SYSTEM' as const, status: 'PUBLISHED' as const },
          ...(user.role === 'ADMIN' ? [{ scope: 'SYSTEM' as const, status: 'DRAFT' as const }] : []),
        ],
      }),
    };
    const candidates = await prisma.reportTemplate.findMany({ where, orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }] });
    const filtered = candidates.filter((template) => {
      if (template.scope === 'PROJECT') return template.projectId === parsed.data.projectId;
      if (template.scope === 'PERSONAL') {
        if (parsed.data.domain === 'PROJECT') return template.projectId === parsed.data.projectId;
        if (parsed.data.domain === 'PARTY') return template.projectId === null && template.businessPartyId === parsed.data.businessPartyId;
        return template.projectId === null && template.businessPartyId === null;
      }
      return true;
    });
    const readable = await Promise.all(filtered.map(async (template) => ({ template, canRead: await canRead(template, user) })));
    return success(await Promise.all(readable.filter((item) => item.canRead).map(async ({ template }) => ({
      ...payloadTemplate(template), editable: await canEdit(template, user),
    }))));
  });

  app.post('/templates', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '报表模板信息不完整或格式不正确', parsed.error.flatten());
    const input = parsed.data;
    if (input.scope === 'SYSTEM' && user.role !== 'ADMIN') return failure(reply, 403, 'REPORT_TEMPLATE_ADMIN_REQUIRED', '只有系统管理员可以创建系统模板');
    if (input.domain === 'PROJECT') {
      if (!input.projectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目级报表必须指定项目');
      if (!(await canAccessProject(user.sub, user.role, input.projectId, ['OWNER', 'MANAGER'], 'PROJECT_MANAGE')) && input.scope !== 'PERSONAL') return failure(reply, 403, 'PROJECT_REPORT_TEMPLATE_EDIT_DENIED', '只有项目负责人或经理可以创建项目共享模板');
      if (!(await hasProject(user, input.projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目报表的权限');
    }
    if (input.domain !== 'PROJECT' && input.scope === 'PROJECT') return failure(reply, 400, 'REPORT_TEMPLATE_SCOPE_INVALID', '公司级或单位档案级模板不能使用项目共享范围');
    if (input.domain === 'PARTY' && input.scope === 'PERSONAL' && !input.businessPartyId) return failure(reply, 400, 'BUSINESS_PARTY_ID_REQUIRED', '单位档案个人模板必须绑定往来单位');
    if (input.domain === 'PARTY' && input.businessPartyId && !(await hasBusinessParty(user, input.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    if (input.domain !== 'PARTY' && input.businessPartyId) return failure(reply, 400, 'REPORT_TEMPLATE_SCOPE_INVALID', '只有单位档案报表可以绑定往来单位');
    if (input.scope === 'PROJECT' && !input.projectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目共享模板必须指定项目');
    const validated = validateReportStudioDefinition(input.definition);
    if (!validated.success) return failure(reply, 400, 'REPORT_STUDIO_DEFINITION_INVALID', validated.message, validated.details);
    if (validated.data.domain !== input.domain) return failure(reply, 400, 'REPORT_STUDIO_DOMAIN_MISMATCH', '模板定义中的报表范围与模板设置不一致');
    const reportKey = studioReportKey(input.domain);
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.reportTemplate.create({ data: {
        reportKey, name: input.name, description: input.description, scope: input.scope,
        projectId: input.scope === 'PROJECT' || (input.domain === 'PROJECT' && input.scope === 'PERSONAL') ? input.projectId ?? null : null,
        businessPartyId: input.domain === 'PARTY' && input.scope === 'PERSONAL' ? input.businessPartyId ?? null : null,
        ownerUserId: input.scope === 'PERSONAL' ? user.sub : input.scope === 'PROJECT' ? user.sub : null,
        version: 1, status: 'DRAFT', definition: validated.data as unknown as Prisma.InputJsonObject,
        createdById: user.sub, updatedById: user.sub,
      } });
      await tx.reportTemplateRevision.create({ data: { templateId: created.id, version: 1, action: 'STUDIO_CREATED', definition: validated.data as unknown as Prisma.InputJsonObject, createdById: user.sub } });
      await tx.auditLog.create({ data: { projectId: input.domain === 'PROJECT' ? input.projectId ?? null : null, userId: user.sub, entity: 'ReportTemplate', entityId: created.id, action: 'REPORT_STUDIO_TEMPLATE_CREATED', changes: { domain: input.domain, name: input.name, scope: input.scope, version: 1 } } });
      return created;
    });
    return reply.code(201).send(success({ ...payloadTemplate(template), editable: true }));
  });

  app.get('/templates/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const id = (request.params as { id: string }).id;
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template || !domainFromStudioReportKey(template.reportKey)) return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在');
    if (!(await canRead(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该模板的权限');
    if (template.businessPartyId && !(await hasBusinessParty(user, template.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    const editable = await canEdit(template, user);
    const definition = template.status === 'PUBLISHED' && template.publishedDefinition && !editable ? template.publishedDefinition : template.definition;
    return success({ ...payloadTemplate({ ...template, definition }), editable });
  });

  app.patch('/templates/:id', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const id = (request.params as { id: string }).id;
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '模板更新请求不完整', parsed.error.flatten());
    const current = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!current || !domainFromStudioReportKey(current.reportKey)) return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在');
    if (!(await canEdit(current, user))) return failure(reply, 403, 'REPORT_TEMPLATE_EDIT_DENIED', '你没有编辑该模板的权限');
    if (current.businessPartyId && !(await hasBusinessParty(user, current.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    if (current.version !== parsed.data.expectedVersion) return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后重新加载');
    if (current.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '归档模板不能修改');
    const validated = validateReportStudioDefinition(parsed.data.definition);
    if (!validated.success) return failure(reply, 400, 'REPORT_STUDIO_DEFINITION_INVALID', validated.message, validated.details);
    if (studioReportKey(validated.data.domain) !== current.reportKey) return failure(reply, 400, 'REPORT_STUDIO_DOMAIN_MISMATCH', '模板不能更改项目级/公司级/单位档案范围；请复制为新模板');
    try {
      const changedTemplate = await prisma.$transaction(async (tx) => {
        const changed = await tx.reportTemplate.updateMany({ where: { id, version: parsed.data.expectedVersion, status: { not: 'ARCHIVED' } }, data: {
          name: parsed.data.name, description: parsed.data.description, definition: validated.data as unknown as Prisma.InputJsonObject,
          version: { increment: 1 }, status: current.publishedDefinition ? 'PUBLISHED' : 'DRAFT', updatedById: user.sub,
        } });
        if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
        const next = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
        await tx.reportTemplateRevision.create({ data: { templateId: id, version: next.version, action: 'STUDIO_UPDATED', definition: validated.data as unknown as Prisma.InputJsonObject, createdById: user.sub } });
        await tx.auditLog.create({ data: { projectId: current.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_STUDIO_TEMPLATE_UPDATED', changes: { name: next.name, version: next.version, domain: validated.data.domain } } });
        return next;
      });
      return success({ ...payloadTemplate(changedTemplate), editable: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_TEMPLATE_VERSION_CONFLICT') return failure(reply, 409, 'REPORT_TEMPLATE_VERSION_CONFLICT', '模板已被其他操作修改，请刷新后重新加载');
      throw error;
    }
  });

  app.post('/templates/:id/publish', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const id = (request.params as { id: string }).id;
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template || !domainFromStudioReportKey(template.reportKey)) return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在');
    if (!(await canEdit(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_PUBLISH_DENIED', '你没有发布模板的权限');
    if (template.businessPartyId && !(await hasBusinessParty(user, template.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    if (template.status === 'ARCHIVED') return failure(reply, 409, 'REPORT_TEMPLATE_ARCHIVED', '归档模板不能发布');
    const validated = validateReportStudioDefinition(template.definition);
    if (!validated.success) return failure(reply, 409, 'REPORT_STUDIO_DEFINITION_INVALID', '模板定义无效，请修复后再发布', validated.details);
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.reportTemplate.updateMany({ where: { id, version: template.version, status: { not: 'ARCHIVED' } }, data: {
        publishedDefinition: validated.data as unknown as Prisma.InputJsonObject, publishedVersion: template.version, status: 'PUBLISHED', updatedById: user.sub,
      } });
      if (changed.count !== 1) throw new Error('REPORT_TEMPLATE_VERSION_CONFLICT');
      const result = await tx.reportTemplate.findUniqueOrThrow({ where: { id } });
      await tx.reportTemplateRevision.create({ data: { templateId: id, version: result.version, action: 'STUDIO_PUBLISHED', definition: validated.data as unknown as Prisma.InputJsonObject, createdById: user.sub } });
      await tx.auditLog.create({ data: { projectId: template.projectId, userId: user.sub, entity: 'ReportTemplate', entityId: id, action: 'REPORT_STUDIO_TEMPLATE_PUBLISHED', changes: { name: result.name, version: result.version, reportKey: result.reportKey } } });
      return result;
    });
    return success({ ...payloadTemplate(updated), editable: true });
  });

  app.get('/templates/:id/revisions', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const id = (request.params as { id: string }).id;
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template || !domainFromStudioReportKey(template.reportKey)) return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在');
    if (!(await canRead(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有访问该模板历史的权限');
    if (template.businessPartyId && !(await hasBusinessParty(user, template.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    return success(await prisma.reportTemplateRevision.findMany({ where: { templateId: id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, version: true, action: true, createdById: true, createdAt: true } }));
  });

  app.post('/preview', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const parsed = z.object({ templateId: z.string().trim().min(1), projectId: z.string().trim().optional(), businessPartyId: z.string().trim().optional() }).strict().safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '预览参数无效', parsed.error.flatten());
    const template = await prisma.reportTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!template || !domainFromStudioReportKey(template.reportKey) || template.status === 'ARCHIVED') return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在或已归档');
    if (!(await canRead(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有预览该模板的权限');
    if (template.businessPartyId && !(await hasBusinessParty(user, template.businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    const editable = await canEdit(template, user);
    const definitionRaw = template.status === 'PUBLISHED' && template.publishedDefinition && !editable ? template.publishedDefinition : template.definition;
    const validated = validateReportStudioDefinition(definitionRaw);
    if (!validated.success || validated.data.domain !== domainFromStudioReportKey(template.reportKey)) return failure(reply, 409, 'REPORT_STUDIO_DEFINITION_INVALID', '模板定义无效，请在设计器中修复');
    const domain = validated.data.domain;
    const effectiveProjectId = domain === 'PROJECT' ? parsed.data.projectId ?? template.projectId ?? undefined : undefined;
    if (domain === 'PROJECT' && !effectiveProjectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目级报表预览需要指定项目');
    if (domain === 'PROJECT' && template.projectId && effectiveProjectId !== template.projectId) return failure(reply, 403, 'REPORT_TEMPLATE_PROJECT_MISMATCH', '项目模板只能用于其所属项目；如需其他项目，请另存模板');
    const effectivePartyId = domain === 'PARTY' ? parsed.data.businessPartyId ?? template.businessPartyId ?? undefined : undefined;
    if (domain === 'PARTY' && !effectivePartyId) return failure(reply, 400, 'BUSINESS_PARTY_ID_REQUIRED', '单位档案级报表预览需要指定往来单位');
    if (domain === 'PARTY' && template.businessPartyId && effectivePartyId !== template.businessPartyId) return failure(reply, 403, 'REPORT_TEMPLATE_PARTY_MISMATCH', '此个人模板只能用于绑定的往来单位');
    if (effectivePartyId && !(await hasBusinessParty(user, effectivePartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    try {
      const dataset = await loadReportStudioDataset(user, domain, effectiveProjectId, effectivePartyId);
      const rendered = renderReportStudio(validated.data, dataset);
      return success(previewReportStudio(rendered));
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number((error as { statusCode: unknown }).statusCode) : 500;
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'REPORT_STUDIO_PREVIEW_FAILED';
      if (status >= 400 && status < 500) return failure(reply, status, code, error instanceof Error ? error.message : '报表预览失败');
      request.log.error({ err: error }, 'Report studio preview failed');
      return failure(reply, 500, 'REPORT_STUDIO_PREVIEW_FAILED', '报表预览失败，请提供请求编号联系管理员');
    }
  });

  app.post('/templates/:id/xlsx/jobs', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const id = (request.params as { id: string }).id;
    const parsed = z.object({ projectId: z.string().trim().optional(), businessPartyId: z.string().trim().optional() }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '导出范围无效', parsed.error.flatten());
    const template = await prisma.reportTemplate.findUnique({ where: { id } });
    if (!template || !domainFromStudioReportKey(template.reportKey)) return failure(reply, 404, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND', '综合报表模板不存在');
    if (!(await canRead(template, user))) return failure(reply, 403, 'REPORT_TEMPLATE_ACCESS_DENIED', '你没有导出该模板的权限');
    const editable = await canEdit(template, user);
    const definitionRaw = template.status === 'PUBLISHED' && template.publishedDefinition && !editable ? template.publishedDefinition : template.definition;
    const validated = validateReportStudioDefinition(definitionRaw);
    if (!validated.success) return failure(reply, 409, 'REPORT_STUDIO_DEFINITION_INVALID', '模板定义无效，请在设计器中修复');
    if (validated.data.domain === 'PROJECT' && !parsed.data.projectId && !template.projectId) return failure(reply, 400, 'PROJECT_ID_REQUIRED', '项目级报表必须指定项目');
    const projectId = validated.data.domain === 'PROJECT' ? parsed.data.projectId ?? template.projectId ?? undefined : undefined;
    if (validated.data.domain === 'PROJECT' && template.projectId && projectId !== template.projectId) return failure(reply, 403, 'REPORT_TEMPLATE_PROJECT_MISMATCH', '项目模板只能用于其所属项目；如需其他项目，请另存模板');
    if (projectId && !(await hasProject(user, projectId))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目报表的权限');
    const businessPartyId = validated.data.domain === 'PARTY' ? parsed.data.businessPartyId ?? template.businessPartyId ?? undefined : undefined;
    if (validated.data.domain === 'PARTY' && !businessPartyId) return failure(reply, 400, 'BUSINESS_PARTY_ID_REQUIRED', '单位档案级报表必须指定往来单位');
    if (validated.data.domain === 'PARTY' && template.businessPartyId && businessPartyId !== template.businessPartyId) return failure(reply, 403, 'REPORT_TEMPLATE_PARTY_MISMATCH', '此个人模板只能用于绑定的往来单位');
    if (businessPartyId && !(await hasBusinessParty(user, businessPartyId))) return failure(reply, 403, 'BUSINESS_PARTY_ACCESS_DENIED', '你没有访问该往来单位经营档案的权限');
    const requestPayload = { templateId: template.id, templateVersion: template.publishedVersion ?? template.version, templateDefinition: validated.data, domain: validated.data.domain, projectId, businessPartyId };
    const rawKey = request.headers['idempotency-key'];
    if (Array.isArray(rawKey)) return failure(reply, 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 请求头只能有一个值');
    const idempotencyKey = rawKey?.trim() || null;
    if (idempotencyKey && (idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) return failure(reply, 400, 'IDEMPOTENCY_KEY_INVALID', '幂等键无效');
    const payload = JSON.parse(JSON.stringify(requestPayload)) as Prisma.InputJsonObject;
    const requestHash = hashJobRequest(payload);
    try {
      const job = await prisma.$transaction(async (tx) => {
        const created = await enqueueBackgroundJob(tx, { type: 'report.studio.xlsx.export', payloadVersion: 1, payload, ownerUserId: user.sub, projectId: projectId ?? null, idempotencyKey, requestHash, maxAttempts: 3 });
        await tx.auditLog.create({ data: { projectId: projectId ?? null, userId: user.sub, entity: 'BackgroundJob', entityId: created.id, action: 'REPORT_STUDIO_XLSX_EXPORT_QUEUED', changes: { templateId: template.id, templateVersion: requestPayload.templateVersion, domain: requestPayload.domain } } });
        return created;
      });
      return reply.code(202).send(success({ id: job.id, type: job.type, status: job.status, createdAt: job.createdAt, statusUrl: `/api/reports/jobs/${job.id}`, downloadUrl: null }));
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.backgroundJob.findFirst({ where: { ownerUserId: user.sub, idempotencyKey } });
        if (existing) {
          if (existing.requestHash !== requestHash) return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '相同幂等键已用于其他导出请求');
          return reply.code(202).send(success({ id: existing.id, type: existing.type, status: existing.status, createdAt: existing.createdAt, statusUrl: `/api/reports/jobs/${existing.id}`, downloadUrl: existing.resultFileName ? `/api/reports/jobs/${existing.id}/download` : null, idempotentReplay: true }));
        }
      }
      throw error;
    }
  });
}
