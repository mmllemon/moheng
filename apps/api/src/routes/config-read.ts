import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';

const secretLikeKey = /PASSWORD|SECRET|TOKEN|PRIVATE.?KEY|API.?KEY|CREDENTIAL/i;

/** Read-only runtime configuration surface for authenticated business modules. */
export async function configReadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authRequired);

  app.get('/dictionaries/:code/items', async (request, reply) => {
    const params = z.object({ code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,79}$/).transform((value) => value.toUpperCase()) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '字典编码不正确');
    const dictionary = await prisma.systemDictionary.findFirst({
      where: { code: params.data.code, isActive: true },
      select: { code: true, name: true, items: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true, description: true, sortOrder: true } } },
    });
    if (!dictionary) return failure(reply, 404, 'DICTIONARY_NOT_FOUND', '可用字典不存在');
    return success(dictionary);
  });

  app.get('/parameters/effective', async (request, reply) => {
    const query = z.object({ projectId: z.string().trim().min(1).max(100).optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目参数查询条件不正确');
    const actor = authUser(request);
    let scopedProjectId: string | null = null;
    if (query.data.projectId) {
      // Non-admins may read project-specific configuration only for a member project or an explicitly granted cross-project read-only scope.
      const crossProjectRead = actor.role === 'ADMIN' || await hasCrossProjectReadScope(actor.sub, actor.role, 'PROJECT_READ');
      const project = await prisma.project.findFirst({
        where: { id: query.data.projectId, deletedAt: null, ...(crossProjectRead ? {} : { members: { some: { userId: actor.sub } } }) },
        select: { id: true },
      });
      if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或当前账号无权访问');
      scopedProjectId = project.id;
    }
    const rows = await prisma.systemParameterRevision.findMany({
      where: { status: 'PUBLISHED', visibility: 'BUSINESS_READABLE', OR: [{ scopeKey: 'GLOBAL' }, ...(scopedProjectId ? [{ scopeKey: `PROJECT:${scopedProjectId}` }] : [])] },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
      select: { key: true, name: true, description: true, value: true, valueType: true, visibility: true, scope: true, scopeKey: true, projectId: true, version: true, publishedAt: true },
    });
    const effective = new Map<string, (typeof rows)[number]>();
    for (const row of rows.filter((item) => item.scope === 'GLOBAL' && !secretLikeKey.test(item.key))) {
      if (!effective.has(row.key)) effective.set(row.key, row);
    }
    for (const row of rows.filter((item) => item.scope === 'PROJECT' && item.projectId === scopedProjectId && !secretLikeKey.test(item.key))) {
      effective.set(row.key, row);
    }
    return success({ projectId: scopedProjectId, items: [...effective.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({ ...row, sourceScope: row.scope })) });
  });
}
