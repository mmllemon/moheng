import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,79}$/, '编码须为 2-80 位大写字母、数字或下划线，且以字母开头');
const dictionaryCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});
const dictionaryPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
const dictionaryItemCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});
const dictionaryItemPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
const parameterKeySchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_.-]{1,99}$/, '参数键须为 2-100 位大写字母、数字、点、下划线或连字符，且以字母开头');
const parameterDraftSchema = z.object({
  key: parameterKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  valueType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']),
  visibility: z.enum(['ADMIN_ONLY', 'BUSINESS_READABLE']).default('ADMIN_ONLY'),
  value: z.unknown(),
  scope: z.enum(['GLOBAL', 'PROJECT']),
  projectId: z.string().trim().min(1).max(100).nullable().optional(),
  changeNote: z.string().trim().min(1).max(1000),
}).superRefine((value, context) => {
  if (value.scope === 'PROJECT' && !value.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['projectId'], message: '项目级参数必须指定项目' });
  if (value.scope === 'GLOBAL' && value.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['projectId'], message: '全局参数不能指定项目' });
  if (/PASSWORD|SECRET|TOKEN|PRIVATE.?KEY|API.?KEY|CREDENTIAL/i.test(value.key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['key'], message: '密码、密钥和凭据必须使用环境变量或集成凭据保险库，不能存入普通参数' });
  if (value.valueType === 'STRING' && (typeof value.value !== 'string' || value.value.length > 4000)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: '字符串参数必须是 0-4000 字符的字符串' });
  if (value.valueType === 'NUMBER' && (typeof value.value !== 'number' || !Number.isFinite(value.value))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: '数值参数必须是有限数字' });
  if (value.valueType === 'BOOLEAN' && typeof value.value !== 'boolean') context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: '布尔参数必须为 true 或 false' });
  if (value.valueType === 'JSON') {
    try {
      const serialized = JSON.stringify(value.value);
      if (serialized === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'JSON 参数格式无效' });
      else if (serialized.length > 16000) context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'JSON 参数不得超过 16 KB' });
    } catch { context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'JSON 参数格式无效' }); }
  }
});
const changeNoteSchema = z.object({ changeNote: z.string().trim().max(1000).optional() });

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'P2002' || error.code === 'P2034');
}
function safeParameterAuditValue(row: { key: string; name: string; description: string | null; scope: string; scopeKey: string; version: number; valueType: string; visibility: string; status: string; changeNote: string | null }) {
  // Configuration values are intentionally omitted from audit snapshots. Names and descriptions are safe metadata.
  return { key: row.key, name: row.name, description: row.description, scope: row.scope, scopeKey: row.scopeKey, version: row.version, valueType: row.valueType, visibility: row.visibility, status: row.status, changeNote: row.changeNote };
}

export async function systemConfigRoutes(app: FastifyInstance) {
  // The parent system-management plugin enforces a valid session and company-level ADMIN role.
  app.get('/dictionaries', async () => {
    const rows = await prisma.systemDictionary.findMany({
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
    return success(rows);
  });

  app.post('/dictionaries', async (request, reply) => {
    const parsed = dictionaryCreateSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '字典分类信息有误', parsed.error.flatten());
    const actor = authUser(request);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.systemDictionary.create({ data: { ...parsed.data, isSystem: false } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemDictionary', entityId: created.id, action: 'SYSTEM_DICTIONARY_CREATED', changes: { code: created.code, name: created.name, description: created.description, isSystem: created.isSystem } } });
        return created;
      });
      return reply.code(201).send(success({ ...row, items: [] }));
    } catch (error) {
      if (isUniqueConflict(error)) return failure(reply, 409, 'DICTIONARY_CODE_EXISTS', '该字典编码已存在');
      throw error;
    }
  });

  app.patch('/dictionaries/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const parsed = dictionaryPatchSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '字典分类修改信息有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const current = await prisma.systemDictionary.findUnique({ where: { id: params.data.id }, select: { id: true, code: true, name: true, description: true, isSystem: true, isActive: true } });
    if (!current) return failure(reply, 404, 'DICTIONARY_NOT_FOUND', '字典分类不存在');
    if (current.isSystem && parsed.data.isActive === false) return failure(reply, 409, 'SYSTEM_DICTIONARY_PROTECTED', '内置字典分类不能停用；可逐项停用不再使用的字典项');
    const actor = authUser(request);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.systemDictionary.update({ where: { id: current.id }, data: parsed.data });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemDictionary', entityId: current.id, action: 'SYSTEM_DICTIONARY_UPDATED', changes: { before: { name: current.name, description: current.description, isActive: current.isActive }, after: { name: updated.name, description: updated.description, isActive: updated.isActive }, code: current.code, isSystem: current.isSystem } } });
      return updated;
    });
    return success({ ...row, items: await prisma.systemDictionaryItem.findMany({ where: { dictionaryId: row.id }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }) });
  });

  app.post('/dictionaries/:id/items', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const parsed = dictionaryItemCreateSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '字典项信息有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const dictionary = await prisma.systemDictionary.findUnique({ where: { id: params.data.id }, select: { id: true, code: true, isActive: true } });
    if (!dictionary || !dictionary.isActive) return failure(reply, 404, 'DICTIONARY_NOT_AVAILABLE', '字典分类不存在或已停用');
    const actor = authUser(request);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.systemDictionaryItem.create({ data: { ...parsed.data, dictionaryId: dictionary.id, isSystem: false } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemDictionaryItem', entityId: created.id, action: 'SYSTEM_DICTIONARY_ITEM_CREATED', changes: { dictionaryCode: dictionary.code, code: created.code, name: created.name, sortOrder: created.sortOrder } } });
        return created;
      });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'DICTIONARY_ITEM_CODE_EXISTS', '该字典中已存在相同编码的字典项');
      throw error;
    }
  });

  app.patch('/dictionary-items/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const parsed = dictionaryItemPatchSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '字典项修改信息有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const current = await prisma.systemDictionaryItem.findUnique({ where: { id: params.data.id }, include: { dictionary: { select: { id: true, code: true } } } });
    if (!current) return failure(reply, 404, 'DICTIONARY_ITEM_NOT_FOUND', '字典项不存在');
    const actor = authUser(request);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.systemDictionaryItem.update({ where: { id: current.id }, data: parsed.data });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemDictionaryItem', entityId: current.id, action: 'SYSTEM_DICTIONARY_ITEM_UPDATED', changes: { dictionaryCode: current.dictionary.code, code: current.code, before: { name: current.name, description: current.description, sortOrder: current.sortOrder, isActive: current.isActive }, after: { name: updated.name, description: updated.description, sortOrder: updated.sortOrder, isActive: updated.isActive }, isSystem: current.isSystem } } });
      return updated;
    });
    return success(row);
  });

  app.get('/parameters/revisions', async (request, reply) => {
    const query = z.object({ key: parameterKeySchema.optional(), scope: z.enum(['GLOBAL', 'PROJECT']).optional(), projectId: z.string().trim().min(1).max(100).optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数版本查询条件有误', query.error.flatten());
    const where: Prisma.SystemParameterRevisionWhereInput = {};
    if (query.data.key) where.key = query.data.key;
    if (query.data.scope) where.scope = query.data.scope;
    if (query.data.projectId) where.projectId = query.data.projectId;
    const rows = await prisma.systemParameterRevision.findMany({
      where, orderBy: [{ createdAt: 'desc' }], take: 250,
      include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } }, project: { select: { id: true, code: true, name: true } } },
    });
    return success({ items: rows, truncated: rows.length === 250 });
  });

  app.get('/parameters/effective', async (request, reply) => {
    const query = z.object({ projectId: z.string().trim().min(1).max(100).optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目参数查询条件有误');
    if (query.data.projectId) {
      const project = await prisma.project.findFirst({ where: { id: query.data.projectId, deletedAt: null }, select: { id: true } });
      if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或已归档');
    }
    const rows = await prisma.systemParameterRevision.findMany({
      where: { status: 'PUBLISHED', OR: [{ scopeKey: 'GLOBAL' }, ...(query.data.projectId ? [{ scopeKey: `PROJECT:${query.data.projectId}` }] : [])] },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
      include: { project: { select: { id: true, code: true, name: true } } },
    });
    const effective = new Map<string, (typeof rows)[number]>();
    // Global is the fallback; project-specific published revisions override it for the same key.
    for (const row of rows.filter((item) => item.scope === 'GLOBAL')) if (!effective.has(row.key)) effective.set(row.key, row);
    if (query.data.projectId) {
      for (const row of rows.filter((item) => item.scope === 'PROJECT' && item.projectId === query.data.projectId)) effective.set(row.key, row);
    }
    return success({ projectId: query.data.projectId ?? null, items: [...effective.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({ ...row, sourceScope: row.scope })) });
  });

  app.post('/parameters/drafts', async (request, reply) => {
    const parsed = parameterDraftSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数草稿内容不正确', parsed.error.flatten());
    const projectId = parsed.data.scope === 'PROJECT' ? parsed.data.projectId ?? null : null;
    if (parsed.data.scope === 'PROJECT' && projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
      if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或已归档');
    }
    const scopeKey = projectId ? `PROJECT:${projectId}` : 'GLOBAL';
    const actor = authUser(request);
    try {
      const row = await prisma.$transaction(async (tx) => {
        if (projectId) {
          const availableProject = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
          if (!availableProject) throw new Error('PARAMETER_PROJECT_UNAVAILABLE');
        }
        const conflictingDefinition = await tx.systemParameterRevision.findFirst({
          where: { key: parsed.data.key, OR: [{ valueType: { not: parsed.data.valueType } }, { visibility: { not: parsed.data.visibility } }] },
          select: { id: true },
        });
        // The type/visibility contract is deliberately global across scopes and revisions. Query the conflict itself rather than an arbitrary historical row.
        if (conflictingDefinition) throw new Error('PARAMETER_DEFINITION_CONFLICT');
        const latest = await tx.systemParameterRevision.findFirst({ where: { key: parsed.data.key, scopeKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.systemParameterRevision.create({ data: {
          key: parsed.data.key, name: parsed.data.name, description: parsed.data.description ?? null,
          value: parsed.data.value as Prisma.InputJsonValue, valueType: parsed.data.valueType, visibility: parsed.data.visibility,
          scope: parsed.data.scope, scopeKey, projectId, version: (latest?.version ?? 0) + 1,
          status: 'DRAFT', changeNote: parsed.data.changeNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, projectId, entity: 'SystemParameterRevision', entityId: created.id, action: 'SYSTEM_PARAMETER_DRAFT_CREATED', changes: safeParameterAuditValue(created) } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'PARAMETER_DEFINITION_CONFLICT') return failure(reply, 409, 'PARAMETER_DEFINITION_CONFLICT', '同一参数键的类型和业务读取范围必须保持一致；请使用新键创建不同定义');
      if (error instanceof Error && error.message === 'PARAMETER_PROJECT_UNAVAILABLE') return failure(reply, 409, 'PARAMETER_PROJECT_UNAVAILABLE', '项目已归档，不能创建项目级参数');
      if (isUniqueConflict(error)) return failure(reply, 409, 'PARAMETER_VERSION_CONFLICT', '参数版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/parameters/:id/publish', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const parsed = changeNoteSchema.safeParse(request.body ?? {});
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数发布请求有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const current = await prisma.systemParameterRevision.findUnique({ where: { id: params.data.id } });
    if (!current) return failure(reply, 404, 'PARAMETER_REVISION_NOT_FOUND', '参数版本不存在');
    if (current.status !== 'DRAFT') return failure(reply, 409, 'PARAMETER_DRAFT_REQUIRED', '只有草稿版本可以发布');
    const actor = authUser(request);
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Project-level config must not be published after its project has been archived.
        if (current.projectId) {
          const project = await tx.project.findFirst({ where: { id: current.projectId, deletedAt: null }, select: { id: true } });
          if (!project) throw new Error('PARAMETER_PROJECT_UNAVAILABLE');
        }
        // Claim the draft inside the transaction so double-clicks/concurrent admins cannot publish it twice.
        const claimed = await tx.systemParameterRevision.updateMany({ where: { id: current.id, status: 'DRAFT' }, data: { status: 'RETIRED' } });
        if (claimed.count !== 1) throw new Error('PARAMETER_DRAFT_CLAIM_CONFLICT');
        const retiredPrevious = await tx.systemParameterRevision.updateMany({ where: { key: current.key, scopeKey: current.scopeKey, status: 'PUBLISHED' }, data: { status: 'RETIRED' } });
        const published = await tx.systemParameterRevision.update({ where: { id: current.id }, data: { status: 'PUBLISHED', publishedById: actor.sub, publishedAt: new Date(), ...(parsed.data.changeNote ? { changeNote: parsed.data.changeNote } : {}) } });
        await tx.auditLog.create({ data: { userId: actor.sub, projectId: current.projectId, entity: 'SystemParameterRevision', entityId: current.id, action: 'SYSTEM_PARAMETER_PUBLISHED', changes: { ...safeParameterAuditValue(published), previousPublishedRevisionRetired: retiredPrevious.count > 0, previousPublishedRevisionCount: retiredPrevious.count } } });
        return published;
      }, { isolationLevel: 'Serializable' });
      return success(row);
    } catch (error) {
      if (error instanceof Error && error.message === 'PARAMETER_PROJECT_UNAVAILABLE') return failure(reply, 409, 'PARAMETER_PROJECT_UNAVAILABLE', '项目已归档，不能发布项目级参数');
      if (error instanceof Error && error.message === 'PARAMETER_DRAFT_CLAIM_CONFLICT') return failure(reply, 409, 'PARAMETER_PUBLISH_CONFLICT', '该草稿已被其他操作处理，请刷新版本列表');
      if (isUniqueConflict(error)) return failure(reply, 409, 'PARAMETER_PUBLISH_CONFLICT', '参数发布发生并发冲突，请刷新版本列表后重试');
      throw error;
    }
  });

  app.post('/parameters/:id/rollback', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const parsed = z.object({ changeNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数回滚请求有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const target = await prisma.systemParameterRevision.findUnique({ where: { id: params.data.id } });
    if (!target) return failure(reply, 404, 'PARAMETER_REVISION_NOT_FOUND', '参数版本不存在');
    if (target.status === 'DRAFT') return failure(reply, 409, 'PARAMETER_ROLLBACK_SOURCE_INVALID', '不能从尚未发布的草稿回滚');
    const rollbackNote = `回滚至 v${target.version}：${parsed.data.changeNote}`;
    if (rollbackNote.length > 1000) return failure(reply, 400, 'CHANGE_NOTE_TOO_LONG', `回滚说明前缀占用 ${rollbackNote.length - parsed.data.changeNote.length} 个字符，请将说明缩短至 ${1000 - (`回滚至 v${target.version}：`.length)} 个字符以内`);
    const actor = authUser(request);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.systemParameterRevision.findFirst({ where: { key: target.key, scopeKey: target.scopeKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const draft = await tx.systemParameterRevision.create({ data: {
          key: target.key, name: target.name, description: target.description, value: target.value as Prisma.InputJsonValue,
          valueType: target.valueType, visibility: target.visibility, scope: target.scope, scopeKey: target.scopeKey, projectId: target.projectId,
          version: (latest?.version ?? 0) + 1, status: 'DRAFT', changeNote: rollbackNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, projectId: target.projectId, entity: 'SystemParameterRevision', entityId: draft.id, action: 'SYSTEM_PARAMETER_ROLLBACK_DRAFT_CREATED', changes: { ...safeParameterAuditValue(draft), rollbackSourceVersion: target.version, rollbackSourceId: target.id } } });
        return draft;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (isUniqueConflict(error)) return failure(reply, 409, 'PARAMETER_VERSION_CONFLICT', '参数版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });
}
