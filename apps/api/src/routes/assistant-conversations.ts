import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject } from '../lib/project-access.js';
import { prisma } from '../lib/prisma.js';
import { appendAssistantRunEvent } from '../lib/assistant-run-events.js';
import { enqueueBackgroundJob, hashJobRequest } from '../lib/background-jobs.js';
import { isAssistantBaseUrlValid } from '../lib/assistant-config.js';
import { loadAssistantRuntimeConfig } from '../lib/assistant-provider-config.js';
import { assertAssistantUserRunAdmission, MAX_ACTIVE_ASSISTANT_RUNS_PER_USER, MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE } from '../lib/assistant-submission-policy.js';
import { buildAssistantUsageSummary, ASSISTANT_USAGE_SUMMARY_WINDOW_DAYS } from '../lib/assistant-usage-summary.js';

const featureGate: preHandlerHookHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
  const runtime = await loadAssistantRuntimeConfig();
  if (!runtime.enabled) {
    return reply.code(404).send(failure(reply, 404, 'ROUTE_NOT_FOUND', '接口不存在'));
  }
};

const conversationIdSchema = z.string().trim().min(1).max(100);
const createConversationSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();
const submitMessageSchema = z.object({
  requestId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/),
  content: z.string().trim().min(1).max(8000),
}).strict();
const routeParamsSchema = z.object({ conversationId: conversationIdSchema, runId: conversationIdSchema }).strict();
const singleConversationParamsSchema = z.object({ conversationId: conversationIdSchema }).strict();
const conversationListQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
  projectId: z.string().trim().min(1).max(100).optional(),
}).strict();
const terminalStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return 'ASSISTANT_REQUEST_FAILED';
}

async function readableConversation(ownerUserId: string, role: ReturnType<typeof authUser>['role'], conversationId: string) {
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id: conversationId, ownerUserId, project: { deletedAt: null } },
    select: { id: true, ownerUserId: true, projectId: true, title: true, status: true, lastMessageAt: true, createdAt: true, updatedAt: true },
  });
  if (!conversation) return null;
  if (!(await canAccessProject(ownerUserId, role, conversation.projectId, undefined, 'PROJECT_READ'))) return null;
  return conversation;
}

function parseAfterSequence(request: FastifyRequest): number | null {
  const query = request.query as { after?: unknown };
  const header = request.headers['last-event-id'];
  const raw = typeof header === 'string' && header.trim() ? header : (typeof query?.after === 'string' ? query.after : '0');
  if (!/^\d{1,10}$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function assistantConversationRoutes(app: FastifyInstance) {
  app.get('/usage-summary', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const query = z.object({ projectId: z.string().trim().min(1).max(100) }).strict().safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'ASSISTANT_USAGE_SUMMARY_QUERY_INVALID', '项目用量查询条件无效');
    const actor = authUser(request);
    const { projectId } = query.data;
    if (!(await canAccessProject(actor.sub, actor.role, projectId, undefined, 'PROJECT_READ'))) {
      return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问');
    }

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - ASSISTANT_USAGE_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [groups, activeRuns] = await Promise.all([
      prisma.assistantRun.groupBy({
        by: ['usageStatus'],
        where: {
          ownerUserId: actor.sub,
          projectId,
          createdAt: { gte: periodStart, lte: periodEnd },
          status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
        },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      // Active work is a current-state metric, not a 30-day creation-window metric.
      prisma.assistantRun.count({
        where: { ownerUserId: actor.sub, projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      }),
    ]);

    return success(buildAssistantUsageSummary({ projectId, periodStart, periodEnd, activeRuns, groups }));
  });

  app.get('/conversations', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const actor = authUser(request);
    const parsedQuery = conversationListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return failure(reply, 400, 'ASSISTANT_CONVERSATION_QUERY_INVALID', '会话查询条件无效', parsedQuery.error.flatten());
    const includeArchived = parsedQuery.data.includeArchived === 'true';
    const candidates = await prisma.assistantConversation.findMany({
      where: { ownerUserId: actor.sub, ...(includeArchived ? {} : { status: 'ACTIVE' }), ...(parsedQuery.data.projectId ? { projectId: parsedQuery.data.projectId } : {}), project: { deletedAt: null } },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, ownerUserId: true, projectId: true, title: true, status: true, lastMessageAt: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
    const visible = await Promise.all(candidates.map(async (conversation) => ({
      conversation,
      allowed: await canAccessProject(actor.sub, actor.role, conversation.projectId, undefined, 'PROJECT_READ'),
    })));
    return success(visible.filter((item) => item.allowed).map(({ conversation }) => ({
      id: conversation.id, projectId: conversation.projectId, title: conversation.title, status: conversation.status,
      lastMessageAt: conversation.lastMessageAt, createdAt: conversation.createdAt,
      messageCount: conversation._count.messages,
    })));
  });

  app.post('/conversations', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = createConversationSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_CONVERSATION_INPUT_INVALID', '会话输入无效', parsed.error.flatten());
    const actor = authUser(request);
    const { projectId } = parsed.data;
    if (!(await canAccessProject(actor.sub, actor.role, projectId, undefined, 'PROJECT_READ'))) {
      return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问');
    }
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问');
    const now = new Date();
    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.assistantConversation.create({ data: {
        ownerUserId: actor.sub, projectId, title: parsed.data.title ?? '成本助手会话', lastMessageAt: now,
      } });
      await tx.auditLog.create({ data: {
        projectId, userId: actor.sub, entity: 'AssistantConversation', entityId: created.id,
        action: 'ASSISTANT_CONVERSATION_CREATED', changes: { projectId },
      } });
      return created;
    });
    return reply.code(201).send(success({ id: conversation.id, projectId, title: conversation.title, status: conversation.status, createdAt: conversation.createdAt }));
  });

  app.get('/conversations/:conversationId', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const params = singleConversationParamsSchema.safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'ASSISTANT_CONVERSATION_ID_INVALID', '会话编号无效');
    const actor = authUser(request);
    const conversation = await readableConversation(actor.sub, actor.role, params.data.conversationId);
    if (!conversation) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    const [messages, runs] = await Promise.all([
      prisma.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
      prisma.assistantRun.findMany({ where: { conversationId: conversation.id, ownerUserId: actor.sub }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, requestId: true, status: true, errorCode: true, createdAt: true, startedAt: true, finishedAt: true, lastEventSequence: true, inputTokens: true, outputTokens: true, totalTokens: true, usageStatus: true, usageCapturedAt: true } }),
    ]);
    return success({ ...conversation, messages: messages.reverse(), runs });
  });

  app.post('/conversations/:conversationId/archive', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const params = singleConversationParamsSchema.safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'ASSISTANT_CONVERSATION_ID_INVALID', '会话编号无效');
    const actor = authUser(request);
    const conversation = await readableConversation(actor.sub, actor.role, params.data.conversationId);
    if (!conversation) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    if (conversation.status === 'ARCHIVED') return success({ id: conversation.id, status: 'ARCHIVED', alreadyArchived: true });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AssistantConversation" WHERE "id" = ${conversation.id} FOR UPDATE`;
      const current = await tx.assistantConversation.findFirst({
        where: { id: conversation.id, ownerUserId: actor.sub, project: { deletedAt: null } },
        select: { id: true, status: true },
      });
      if (!current) return { notFound: true as const };
      if (current.status === 'ARCHIVED') return { conflict: false as const, archived: current, alreadyArchived: true };
      const activeRun = await tx.assistantRun.findFirst({ where: { conversationId: conversation.id, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
      if (activeRun) return { conflict: true as const };
      const archived = await tx.assistantConversation.update({ where: { id: conversation.id }, data: { status: 'ARCHIVED' }, select: { id: true, status: true } });
      await tx.auditLog.create({ data: { projectId: conversation.projectId, userId: actor.sub, entity: 'AssistantConversation', entityId: conversation.id, action: 'ASSISTANT_CONVERSATION_ARCHIVED', changes: { status: 'ARCHIVED' } } });
      return { conflict: false as const, archived, alreadyArchived: false };
    });
    if ('notFound' in result) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    if (result.conflict) return failure(reply, 409, 'ASSISTANT_RUN_ALREADY_ACTIVE', '会话仍有运行中的任务，完成或取消后才能归档');
    return success({ ...result.archived, alreadyArchived: result.alreadyArchived });
  });

  app.post('/conversations/:conversationId/messages', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const params = singleConversationParamsSchema.safeParse(request.params);
    const body = submitMessageSchema.safeParse(request.body);
    if (!params.success || !body.success) return failure(reply, 400, 'ASSISTANT_MESSAGE_INPUT_INVALID', '消息输入无效', { params: params.success ? undefined : params.error.flatten(), body: body.success ? undefined : body.error.flatten() });
    const actor = authUser(request);
    const conversation = await readableConversation(actor.sub, actor.role, params.data.conversationId);
    if (!conversation) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    if (conversation.status !== 'ACTIVE') return failure(reply, 409, 'ASSISTANT_CONVERSATION_ARCHIVED', '已归档会话不能继续发送消息');
    const requestHash = hashJobRequest({ conversationId: conversation.id, projectId: conversation.projectId, content: body.data.content });
    let result: { runId: string; status: string; idempotentReplay: boolean };
    try {
      result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AssistantConversation" WHERE "id" = ${conversation.id} FOR UPDATE`;
        const currentConversation = await tx.assistantConversation.findFirst({
          where: { id: conversation.id, ownerUserId: actor.sub, status: 'ACTIVE', project: { deletedAt: null } },
          select: { id: true },
        });
        if (!currentConversation) throw new Error('ASSISTANT_CONVERSATION_ARCHIVED');
        const previous = await tx.assistantRun.findFirst({ where: { ownerUserId: actor.sub, conversationId: conversation.id, requestId: body.data.requestId }, select: { id: true, status: true, requestHash: true } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw new Error('ASSISTANT_IDEMPOTENCY_CONFLICT');
          return { runId: previous.id, status: previous.status, idempotentReplay: true };
        }
        const runtime = await loadAssistantRuntimeConfig();
        if (!runtime.apiKey || !runtime.checkpointUrl || !runtime.modelId || !isAssistantBaseUrlValid(runtime.baseUrl)) {
          throw new Error('ASSISTANT_RUNTIME_NOT_CONFIGURED');
        }
        const active = await tx.assistantRun.findFirst({ where: { conversationId: conversation.id, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
        if (active) throw new Error('ASSISTANT_RUN_ALREADY_ACTIVE');
        // Hold the user-row lock through run creation so concurrent sessions cannot bypass this cap.
        await assertAssistantUserRunAdmission(tx, actor.sub);
        const message = await tx.assistantMessage.create({ data: {
          conversationId: conversation.id, requestId: body.data.requestId, role: 'USER', content: body.data.content, status: 'COMPLETED',
        } });
        const run = await tx.assistantRun.create({ data: {
          conversationId: conversation.id, ownerUserId: actor.sub, projectId: conversation.projectId,
          requestId: body.data.requestId, requestHash, status: 'QUEUED',
        } });
        const job = await enqueueBackgroundJob(tx, {
          type: 'assistant.agent.run', payloadVersion: 1,
          payload: { conversationId: conversation.id, runId: run.id, requestId: body.data.requestId },
          ownerUserId: actor.sub, projectId: conversation.projectId,
          idempotencyKey: `${conversation.id}:${body.data.requestId}`, requestHash, maxAttempts: 1,
        });
        await tx.assistantRun.update({ where: { id: run.id }, data: { jobId: job.id } });
        await tx.assistantConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
        await appendAssistantRunEvent(tx, { conversationId: conversation.id, runId: run.id, type: 'run.queued', payload: { runId: run.id, messageId: message.id } });
        await tx.auditLog.create({ data: {
          projectId: conversation.projectId, userId: actor.sub, entity: 'AssistantRun', entityId: run.id,
          action: 'ASSISTANT_MESSAGE_SUBMITTED', changes: { conversationId: conversation.id, requestId: body.data.requestId, promptLength: body.data.content.length },
        } });
        return { runId: run.id, status: 'QUEUED', idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'ASSISTANT_USER_RUN_LIMIT_REACHED') return failure(reply, 429, 'ASSISTANT_USER_RUN_LIMIT_REACHED', `该账号最多允许 ${MAX_ACTIVE_ASSISTANT_RUNS_PER_USER} 个排队或运行中的助手任务；请等待完成或取消后再提交`);
      if (error instanceof Error && error.message === 'ASSISTANT_USER_RUN_RATE_LIMIT_REACHED') return failure(reply, 429, 'ASSISTANT_USER_RUN_RATE_LIMIT_REACHED', `该账号每分钟最多提交 ${MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE} 个助手任务，请稍后再试`);
      if (error instanceof Error && error.message === 'ASSISTANT_RUN_ALREADY_ACTIVE') return failure(reply, 409, 'ASSISTANT_RUN_ALREADY_ACTIVE', '该会话已有运行中的任务，请等待完成或取消后再发送');
      if (error instanceof Error && error.message === 'ASSISTANT_CONVERSATION_ARCHIVED') return failure(reply, 409, 'ASSISTANT_CONVERSATION_ARCHIVED', '会话已归档，不能继续发送消息');
      if (error instanceof Error && error.message === 'ASSISTANT_RUNTIME_NOT_CONFIGURED') return failure(reply, 503, 'ASSISTANT_RUNTIME_NOT_CONFIGURED', '只读助手运行环境尚未配置');
      if (error instanceof Error && error.message === 'ASSISTANT_IDEMPOTENCY_CONFLICT') return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', 'requestId 已用于不同的消息内容');
      if (isUniqueViolation(error)) {
        const existing = await prisma.assistantRun.findFirst({ where: { ownerUserId: actor.sub, conversationId: conversation.id, requestId: body.data.requestId }, select: { id: true, status: true, requestHash: true } });
        if (existing && existing.requestHash === requestHash) result = { runId: existing.id, status: existing.status, idempotentReplay: true };
        else return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', 'requestId 已被使用');
      } else {
        request.log.error({ code: safeErrorCode(error) }, 'Assistant message enqueue failed');
        return failure(reply, 500, 'ASSISTANT_SUBMISSION_FAILED', '助手任务提交失败');
      }
    }
    return reply.code(result!.idempotentReplay ? 200 : 202).send(success({ ...result!, eventsUrl: `/api/assistant-poc/conversations/${conversation.id}/runs/${result!.runId}/events` }));
  });

  app.post('/conversations/:conversationId/runs/:runId/cancel', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const params = routeParamsSchema.safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'ASSISTANT_RUN_ID_INVALID', '运行编号无效');
    const actor = authUser(request);
    const conversation = await readableConversation(actor.sub, actor.role, params.data.conversationId);
    if (!conversation) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AssistantRun" WHERE "id" = ${params.data.runId} FOR UPDATE`;
      const run = await tx.assistantRun.findFirst({ where: { id: params.data.runId, conversationId: conversation.id, ownerUserId: actor.sub } });
      if (!run) return null;
      if (terminalStatuses.has(run.status)) return { id: run.id, status: run.status, alreadyTerminal: true, cancelAlreadyRequested: false };
      const now = new Date();
      if (run.status === 'QUEUED') {
        await tx.assistantRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', cancelRequestedAt: now, finishedAt: now } });
        if (run.jobId) await tx.backgroundJob.updateMany({ where: { id: run.jobId, ownerUserId: actor.sub, status: 'QUEUED' }, data: { status: 'CANCELLED', finishedAt: now, lastError: 'CANCELLED_BY_USER', lockedAt: null, lockedBy: null } });
        await appendAssistantRunEvent(tx, { conversationId: conversation.id, runId: run.id, type: 'run.cancelled', payload: { runId: run.id } });
        await tx.auditLog.create({ data: { projectId: conversation.projectId, userId: actor.sub, entity: 'AssistantRun', entityId: run.id, action: 'ASSISTANT_RUN_CANCEL_REQUESTED', changes: { status: 'CANCELLED' } } });
        return { id: run.id, status: 'CANCELLED', alreadyTerminal: false, cancelAlreadyRequested: false };
      }
      if (run.cancelRequestedAt) return { id: run.id, status: 'RUNNING', alreadyTerminal: false, cancelAlreadyRequested: true };
      const cancelUpdate = await tx.assistantRun.updateMany({ where: { id: run.id, status: 'RUNNING', cancelRequestedAt: null }, data: { cancelRequestedAt: now } });
      if (cancelUpdate.count !== 1) return { id: run.id, status: 'RUNNING', alreadyTerminal: false, cancelAlreadyRequested: true };
      await appendAssistantRunEvent(tx, { conversationId: conversation.id, runId: run.id, type: 'run.cancel_requested', payload: { runId: run.id } });
      await tx.auditLog.create({ data: { projectId: conversation.projectId, userId: actor.sub, entity: 'AssistantRun', entityId: run.id, action: 'ASSISTANT_RUN_CANCEL_REQUESTED', changes: { status: 'RUNNING' } } });
      return { id: run.id, status: 'RUNNING', alreadyTerminal: false, cancelAlreadyRequested: false };
    });
    if (!outcome) return failure(reply, 404, 'ASSISTANT_RUN_NOT_FOUND', '运行不存在或无权访问');
    if (outcome.alreadyTerminal) {
      await prisma.auditLog.create({ data: { projectId: conversation.projectId, userId: actor.sub, entity: 'AssistantRun', entityId: outcome.id, action: 'ASSISTANT_RUN_CANCEL_ATTEMPTED', changes: { status: outcome.status, alreadyTerminal: true } } });
    }
    return success(outcome);
  });

  app.get('/conversations/:conversationId/runs/:runId/events', {
    preHandler: [featureGate, authRequired],
    // Native EventSource reconnects automatically; allow reconnects while keeping an explicit ceiling.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const params = routeParamsSchema.safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'ASSISTANT_RUN_ID_INVALID', '运行编号无效');
    const after = parseAfterSequence(request);
    if (after === null) return failure(reply, 400, 'ASSISTANT_EVENT_CURSOR_INVALID', '事件游标无效');
    const actor = authUser(request);
    const conversation = await readableConversation(actor.sub, actor.role, params.data.conversationId);
    if (!conversation) return failure(reply, 404, 'ASSISTANT_CONVERSATION_NOT_FOUND', '会话不存在或无权访问');
    const ownedRun = await prisma.assistantRun.findFirst({ where: { id: params.data.runId, conversationId: conversation.id, ownerUserId: actor.sub }, select: { id: true, lastEventSequence: true } });
    if (!ownedRun) return failure(reply, 404, 'ASSISTANT_RUN_NOT_FOUND', '运行不存在或无权访问');
    if (after > ownedRun.lastEventSequence) return failure(reply, 400, 'ASSISTANT_EVENT_CURSOR_AHEAD', '事件游标超出该运行的当前事件序号');

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    let disconnected = false;
    let cursor = after;
    let lastHeartbeatAt = Date.now();
    let lastPermissionCheckAt = Date.now();
    const onClose = () => { disconnected = true; };
    reply.raw.on('close', onClose);
    const writeChunk = async (chunk: string) => {
      if (disconnected || reply.raw.destroyed) return;
      if (reply.raw.write(chunk)) return;
      await new Promise<void>((resolve) => {
        const finished = () => {
          reply.raw.off('drain', finished);
          reply.raw.off('close', finished);
          resolve();
        };
        reply.raw.once('drain', finished);
        reply.raw.once('close', finished);
      });
    };
    try {
      while (!disconnected) {
        if (Date.now() - lastPermissionCheckAt > 5000) {
          const stillReadable = await readableConversation(actor.sub, actor.role, conversation.id);
          lastPermissionCheckAt = Date.now();
          if (!stillReadable) {
            await writeChunk('event: access.revoked\ndata: {"code":"PROJECT_ACCESS_REVOKED"}\n\n');
            break;
          }
        }
        const events = await prisma.assistantRunEvent.findMany({ where: { runId: ownedRun.id, sequence: { gt: cursor } }, orderBy: { sequence: 'asc' }, take: 100 });
        for (const event of events) {
          if (disconnected) break;
          const payload = JSON.stringify({ sequence: event.sequence, type: event.type, payload: event.payload, createdAt: event.createdAt.toISOString() });
          await writeChunk(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${payload}\n\n`);
          cursor = event.sequence;
        }
        const run = await prisma.assistantRun.findUnique({ where: { id: ownedRun.id }, select: { status: true, lastEventSequence: true } });
        if (!run) break;
        if (terminalStatuses.has(run.status) && cursor >= run.lastEventSequence) break;
        if (Date.now() - lastHeartbeatAt > 15000) {
          await writeChunk(`: heartbeat ${Date.now()}\n\n`);
          lastHeartbeatAt = Date.now();
        }
        if (!disconnected) await sleep(800);
      }
    } catch (error) {
      request.log.error({ runId: ownedRun.id, code: safeErrorCode(error) }, 'Assistant SSE stream failed');
      await writeChunk('event: stream.error\ndata: {"code":"ASSISTANT_EVENT_STREAM_FAILED"}\n\n');
    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });
}
