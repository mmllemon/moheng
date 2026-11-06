/**
 * 成本助手会话的归档与并发回归（真实 PostgreSQL）。
 *
 * 这条链路上有三种「同一时刻只能发生一件」的约束，全都靠事务里的行锁与状态判定：
 *   1. 一个会话同时只能有一个排队或运行中的 run —— 否则两次提问会交叉写事件序列；
 *   2. 有活动 run 时不能归档 —— 否则任务还在跑，会话已经不在列表里；
 *   3. 归档之后不能再提交消息 —— 幂等重放在归档后也必须被拦住。
 *
 * 另外，requestId 幂等在这里有两层：同内容重放要复用同一个 run，不同内容复用同一个
 * requestId 必须拒绝，而不是悄悄新建一个。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   ASSISTANT_CONVERSATION_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:assistant-conversation:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { assistantConversationRoutes } from '../routes/assistant-conversations.js';

const enabled = process.env.ASSISTANT_CONVERSATION_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('成本助手会话：归档前置条件、单会话互斥、requestId 幂等、取消与运行时未配置', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  // 运行配置优先读数据库行；隔离库里若有残留行会盖掉环境变量，先清掉保证走 env 分支。
  await prisma.assistantProviderConfig.deleteMany({ where: { id: 'default' } }).catch(() => undefined);
  const envSnapshot = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.ASSISTANT_POC_MODEL_ID,
    base: process.env.OPENAI_BASE_URL,
    checkpoint: process.env.ASSISTANT_CHECKPOINT_DATABASE_URL,
  };
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  process.env.ASSISTANT_POC_MODEL_ID = 'test-model';
  process.env.OPENAI_BASE_URL = 'https://assistant.invalid/v1';
  process.env.ASSISTANT_CHECKPOINT_DATABASE_URL = testDatabaseUrl;

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(assistantConversationRoutes, {
    prefix: '/api/assistant-poc',
    loadConfig: async () => ({ enabled: true, apiKey: 'test-only-not-a-real-key', modelId: 'test-model', baseUrl: 'https://assistant.invalid/v1', checkpointUrl: testDatabaseUrl, source: 'environment' as const }),
  });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'USER') {
    const user = await prisma.user.create({ data: {
      name: `Assistant Fixture ${label} ${suffix}`,
      email: `assistant-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = typeof response.body === 'string' ? response.body : '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; } }
    return { status: response.statusCode, body };
  };

  try {
    const owner = await makeActor('owner');
    const stranger = await makeActor('stranger');

    const project = await prisma.project.create({ data: {
      name: `Assistant Project ${suffix}`,
      code: `AST-${suffix}`.slice(0, 40),
      ownerName: `助手业主${suffix}`.slice(0, 60),
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.userId, role: 'OWNER' } });

    const base = '/api/assistant-poc/conversations';

    // —— 1. 建会话：非成员看不到项目，成员可建并写审计 ——
    const strangerCreate = await call(stranger, 'POST', base, { projectId: project.id });
    assert.equal(strangerCreate.status, 404);
    assert.equal(strangerCreate.body.error.code, 'PROJECT_NOT_FOUND');

    const created = await call(owner, 'POST', base, { projectId: project.id, title: '成本助手会话' });
    assert.equal(created.status, 201, `建会话应成功：${JSON.stringify(created.body).slice(0, 300)}`);
    const conversationId = created.body.data.id as string;
    assert.equal(created.body.data.status, 'ACTIVE');
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'AssistantConversation', entityId: conversationId, action: 'ASSISTANT_CONVERSATION_CREATED' } }));

    // —— 2. 会话按所有者隔离 ——
    const strangerRead = await call(stranger, 'GET', `${base}/${conversationId}`);
    assert.equal(strangerRead.status, 404);
    assert.equal(strangerRead.body.error.code, 'ASSISTANT_CONVERSATION_NOT_FOUND');

    // —— 3. 首次提问：排队 + 事件 + 审计 + 后台任务 ——
    const requestId = `req-${suffix}-1`;
    const first = await call(owner, 'POST', `${base}/${conversationId}/messages`, { requestId, content: '帮我看下这个项目的成本情况' });
    assert.equal(first.status, 202, `首次提问应 202：${JSON.stringify(first.body).slice(0, 300)}`);
    const runId = first.body.data.runId as string;
    assert.equal(first.body.data.status, 'QUEUED');
    assert.equal(first.body.data.idempotentReplay, false);

    const run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'QUEUED');
    assert.ok(run.jobId, '应同步入队后台任务');
    const queuedJob = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: run.jobId! } });
    assert.equal(queuedJob.type, 'assistant.agent.run');
    assert.equal((queuedJob.payload as Record<string, unknown>).runId, runId);
    assert.equal(await prisma.assistantMessage.count({ where: { conversationId, role: 'USER' } }), 1);
    assert.equal(await prisma.assistantRunEvent.count({ where: { runId, type: 'run.queued' } }), 1);
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'AssistantRun', entityId: runId, action: 'ASSISTANT_MESSAGE_SUBMITTED' } }));

    // —— 4. requestId 幂等：同内容重放复用同一个 run ——
    const replay = await call(owner, 'POST', `${base}/${conversationId}/messages`, { requestId, content: '帮我看下这个项目的成本情况' });
    assert.equal(replay.status, 200, `幂等重放应 200：${JSON.stringify(replay.body).slice(0, 300)}`);
    assert.equal(replay.body.data.runId, runId);
    assert.equal(replay.body.data.idempotentReplay, true);
    assert.equal(await prisma.assistantRun.count({ where: { conversationId } }), 1, '重放不得新建 run');

    // —— 5. 同 requestId 不同内容：拒绝 ——
    const conflict = await call(owner, 'POST', `${base}/${conversationId}/messages`, { requestId, content: '换一个问题' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSED');

    // —— 6. 有排队任务时不能再提 ——
    const whileActive = await call(owner, 'POST', `${base}/${conversationId}/messages`, { requestId: `req-${suffix}-2`, content: '第二个问题' });
    assert.equal(whileActive.status, 409);
    assert.equal(whileActive.body.error.code, 'ASSISTANT_RUN_ALREADY_ACTIVE');
    assert.equal(await prisma.assistantRun.count({ where: { conversationId } }), 1, '被拒的提交不得留下半个 run');

    // —— 7. 有活动任务时不能归档 ——
    const archiveWhileActive = await call(owner, 'POST', `${base}/${conversationId}/archive`);
    assert.equal(archiveWhileActive.status, 409);
    assert.equal(archiveWhileActive.body.error.code, 'ASSISTANT_RUN_ALREADY_ACTIVE');

    // —— 8. 取消排队中的任务：run 与 job 同步取消，写事件与审计 ——
    const cancelled = await call(owner, 'POST', `${base}/${conversationId}/runs/${runId}/cancel`);
    assert.equal(cancelled.status, 200, `取消应成功：${JSON.stringify(cancelled.body).slice(0, 300)}`);
    assert.equal(cancelled.body.data.status, 'CANCELLED');
    assert.equal((await prisma.assistantRun.findUniqueOrThrow({ where: { id: runId } })).status, 'CANCELLED');
    assert.equal((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: run.jobId! } })).status, 'CANCELLED');
    assert.equal(await prisma.assistantRunEvent.count({ where: { runId, type: 'run.cancelled' } }), 1);
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'AssistantRun', entityId: runId, action: 'ASSISTANT_RUN_CANCEL_REQUESTED' } }));

    const cancelAgain = await call(owner, 'POST', `${base}/${conversationId}/runs/${runId}/cancel`);
    assert.equal(cancelAgain.status, 200);
    assert.equal(cancelAgain.body.data.alreadyTerminal, true, '已终止的任务再取消应如实回报');

    // —— 9. 归档：成功并写审计，重复归档幂等 ——
    const archived = await call(owner, 'POST', `${base}/${conversationId}/archive`);
    assert.equal(archived.status, 200, `归档应成功：${JSON.stringify(archived.body).slice(0, 300)}`);
    assert.equal(archived.body.data.status, 'ARCHIVED');
    assert.equal(archived.body.data.alreadyArchived, false);
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'AssistantConversation', entityId: conversationId, action: 'ASSISTANT_CONVERSATION_ARCHIVED' } }));

    const archivedAgain = await call(owner, 'POST', `${base}/${conversationId}/archive`);
    assert.equal(archivedAgain.status, 200);
    assert.equal(archivedAgain.body.data.alreadyArchived, true);

    // —— 10. 归档后不能提问，幂等重放也不行 ——
    const afterArchive = await call(owner, 'POST', `${base}/${conversationId}/messages`, { requestId: `req-${suffix}-3`, content: '归档后还想问' });
    assert.equal(afterArchive.status, 409);
    assert.equal(afterArchive.body.error.code, 'ASSISTANT_CONVERSATION_ARCHIVED');

    // —— 11. 列表：默认不含归档，includeArchived=true 才出现 ——
    const listDefault = await call(owner, 'GET', `${base}?projectId=${project.id}`);
    assert.equal(listDefault.status, 200);
    assert.ok(!(listDefault.body.data as { id: string }[]).some((row) => row.id === conversationId), '默认列表不应包含已归档会话');
    const listAll = await call(owner, 'GET', `${base}?projectId=${project.id}&includeArchived=true`);
    assert.ok((listAll.body.data as { id: string }[]).some((row) => row.id === conversationId), '带 includeArchived 应包含归档会话');

    // —— 12. 运行时未配置：503，且不留下 run ——
    const activeConversation = await call(owner, 'POST', base, { projectId: project.id, title: '未配置运行时会话' });
    assert.equal(activeConversation.status, 201);
    const activeConversationId = activeConversation.body.data.id as string;
    delete process.env.OPENAI_API_KEY;
    const notConfigured = await call(owner, 'POST', `${base}/${activeConversationId}/messages`, { requestId: `req-${suffix}-4`, content: '没有运行环境' });
    assert.equal(notConfigured.status, 503, `未配置运行时应当 503：${JSON.stringify(notConfigured.body).slice(0, 200)}`);
    assert.equal(notConfigured.body.error.code, 'ASSISTANT_RUNTIME_NOT_CONFIGURED');
    assert.equal(await prisma.assistantRun.count({ where: { conversationId: activeConversationId } }), 0, '未配置运行时不得留下 run');
    process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  } finally {
    await app.close();
    process.env.OPENAI_API_KEY = envSnapshot.key;
    process.env.ASSISTANT_POC_MODEL_ID = envSnapshot.model;
    process.env.OPENAI_BASE_URL = envSnapshot.base;
    if (envSnapshot.checkpoint === undefined) delete process.env.ASSISTANT_CHECKPOINT_DATABASE_URL;
    else process.env.ASSISTANT_CHECKPOINT_DATABASE_URL = envSnapshot.checkpoint;
    try {
      for (const projectId of projectIds) {
        const runs = await prisma.assistantRun.findMany({ where: { projectId }, select: { id: true, jobId: true } });
        const runIds = runs.map((row) => row.id);
        const jobIds = runs.map((row) => row.jobId).filter((id): id is string => Boolean(id));
        await prisma.assistantRunEvent.deleteMany({ where: { runId: { in: runIds } } }).catch(() => undefined);
        await prisma.assistantMessage.deleteMany({ where: { conversation: { projectId } } }).catch(() => undefined);
        await prisma.assistantRun.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.backgroundJob.deleteMany({ where: { id: { in: jobIds } } }).catch(() => undefined);
        await prisma.assistantConversation.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '助手业主' } } }).catch(() => undefined);
      const ids = userIds;
      await prisma.backgroundJob.deleteMany({ where: { ownerUserId: { in: ids } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
