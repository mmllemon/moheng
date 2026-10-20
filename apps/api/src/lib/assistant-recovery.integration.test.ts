import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { prisma } from './prisma.js';
import { appendAssistantRunEvent } from './assistant-run-events.js';
import { claimNextBackgroundJob, reconcileOrphanAssistantRuns } from './background-jobs.js';
import { createAssistantAgentRunJobHandler } from './assistant-agent-run-job.js';
import { assertAssistantUserRunAdmission } from './assistant-submission-policy.js';
import { runLangGraphAssistantTurn } from '../assistant/runtime/langgraph-adapter.js';
import { createFakeRuntimeDependencies, FAKE_PROVIDER_PRIVATE_MARKER } from '../../test-support/fake-assistant-provider.js';
import type { AssistantReadOnlyToolInput } from './assistant-read-only-tools.js';

const enabled = process.env.ASSISTANT_RECOVERY_TESTS === 'true';

test('isolated PostgreSQL assistant recovery + injected fake provider success contract', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated; use local/CI test PostgreSQL');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const artifactDir = process.env.ASSISTANT_GATE_ARTIFACT_DIR;
  const oldEnv = new Map<string, string | undefined>();
  const setEnv = (key: string, value: string) => {
    if (!oldEnv.has(key)) oldEnv.set(key, process.env[key]);
    process.env[key] = value;
  };
  const restoreEnv = () => {
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  let userId: string | undefined;
  let projectId: string | undefined;
  const conversationIds: string[] = [];
  const jobIds: string[] = [];
  const runIds: string[] = [];
  try {
    const user = await prisma.user.create({ data: { name: `Assistant Gate ${suffix}`, email: `assistant-gate-${suffix}@example.invalid`, passwordHash: 'test-only-not-a-login-password', role: 'ADMIN' } });
    userId = user.id;
    const project = await prisma.project.create({ data: {
      name: `Assistant Gate Project ${suffix}`, code: `AG-${suffix}`, ownerName: 'Gate Owner',
      contractAmount: '1200000.00', originalContractAmount: '1200000.00', startDate: new Date(),
    } });
    projectId = project.id;

    async function makeRun(options: {
      label: string; status: 'QUEUED' | 'RUNNING'; job?: { status: 'QUEUED' | 'RUNNING'; attempts: number; maxAttempts: number; lockedAt?: Date; lockedBy?: string };
      cancelRequestedAt?: Date | null; startedAt?: Date | null; createdAt?: Date;
      invalidJobId?: boolean;
    }) {
      const conversation = await prisma.assistantConversation.create({ data: { ownerUserId: user.id, projectId: project.id, title: `Gate ${options.label}` } });
      conversationIds.push(conversation.id);
      const requestId = `gate-${options.label}-${suffix}`;
      await prisma.assistantMessage.create({ data: { conversationId: conversation.id, requestId, role: 'USER', content: `请检查测试场景 ${options.label}。` } });
      const run = await prisma.assistantRun.create({ data: {
        conversationId: conversation.id, ownerUserId: user.id, projectId: project.id,
        requestId, requestHash: createHash('sha256').update(requestId).digest('hex'),
        status: options.status, cancelRequestedAt: options.cancelRequestedAt ?? null,
        ...(options.startedAt ? { startedAt: options.startedAt } : {}),
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      } });
      runIds.push(run.id);
      await prisma.$transaction((tx) => appendAssistantRunEvent(tx, {
        conversationId: conversation.id, runId: run.id, type: 'run.queued', payload: { runId: run.id, messageId: `seed-${suffix}` },
      }));

      let jobId: string | null = null;
      if (options.job) {
        const job = await prisma.backgroundJob.create({ data: {
          type: 'assistant.agent.run', status: options.job.status, payloadVersion: 1,
          payload: { conversationId: conversation.id, runId: run.id, requestId },
          ownerUserId: user.id, projectId: project.id,
          attempts: options.job.attempts, maxAttempts: options.job.maxAttempts,
          lockedAt: options.job.lockedAt ?? null, lockedBy: options.job.lockedBy ?? null,
        } });
        jobId = job.id;
        jobIds.push(job.id);
        await prisma.assistantRun.update({ where: { id: run.id }, data: { jobId: options.invalidJobId ? `missing-${suffix}-${options.label}` : job.id } });
      } else if (options.invalidJobId) {
        await prisma.assistantRun.update({ where: { id: run.id }, data: { jobId: `missing-${suffix}-${options.label}` } });
      }
      return { conversation, requestId, run: await prisma.assistantRun.findUniqueOrThrow({ where: { id: run.id } }), jobId };
    }

    // S1: missing jobId is inside the 60-second grace period; a recovery sweep must not kill it early.
    const s1 = await makeRun({ label: 'S1-missing-job', status: 'RUNNING', startedAt: new Date() });
    // S2: invalid job relation is also fresh; grace protects in-flight writes/redeploy windows.
    const s2 = await makeRun({ label: 'S2-invalid-job', status: 'RUNNING', startedAt: new Date(), invalidJobId: true });
    assert.equal(await reconcileOrphanAssistantRuns(60), 0);
    assert.equal((await prisma.assistantRun.findUniqueOrThrow({ where: { id: s1.run.id } })).status, 'RUNNING');
    assert.equal((await prisma.assistantRun.findUniqueOrThrow({ where: { id: s2.run.id } })).status, 'RUNNING');

    // S3: a valid queued job is claimed and successfully runs through a fake tool-calling model to COMPLETED.
    const s3 = await makeRun({ label: 'S3-valid-queued', status: 'QUEUED', job: { status: 'QUEUED', attempts: 0, maxAttempts: 3 } });
    const claimed = await claimNextBackgroundJob(`assistant-gate-${suffix}`, 900);
    assert.ok(claimed, 'valid queued background job should be claimed');
    assert.equal(claimed.id, s3.jobId);
    assert.equal(claimed.attempts, 1);
    setEnv('ASSISTANT_POC_ENABLED', 'true');
    setEnv('OPENAI_API_KEY', 'test-only-no-provider-call');
    setEnv('ASSISTANT_POC_MODEL_ID', 'moheng-fake-provider');
    setEnv('ASSISTANT_CHECKPOINT_DATABASE_URL', testDatabaseUrl);
    const toolCalls: AssistantReadOnlyToolInput[] = [];
    const fakeDeps = createFakeRuntimeDependencies(toolCalls);
    const fakeHandler = createAssistantAgentRunJobHandler({
      runAssistantTurn: (input) => runLangGraphAssistantTurn(input, fakeDeps),
    });
    await fakeHandler(claimed);
    await prisma.backgroundJob.updateMany({ where: { id: claimed.id, status: 'RUNNING' }, data: { status: 'SUCCEEDED', finishedAt: new Date(), lockedAt: null, lockedBy: null } });
    const s3Run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: s3.run.id } });
    assert.equal(s3Run.status, 'COMPLETED');
    assert.equal(s3Run.usageStatus, 'UNAVAILABLE');
    assert.equal(s3Run.inputTokens, null);
    assert.equal(s3Run.outputTokens, null);
    assert.equal(s3Run.totalTokens, null);
    assert.deepEqual(toolCalls.map((call) => call.toolId), ['cost_variance']);
    const s3Messages = await prisma.assistantMessage.findMany({ where: { conversationId: s3.conversation.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(s3Messages.length, 2);
    assert.match(s3Messages[1]?.content ?? '', /目标成本 100000\.00.*实际成本 999999\.00.*差异 \+899999\.00.*900%.*OVER_TARGET/);
    assert.doesNotMatch(s3Messages[1]?.content ?? '', new RegExp(FAKE_PROVIDER_PRIVATE_MARKER));
    const s3Events = await prisma.assistantRunEvent.findMany({ where: { runId: s3.run.id }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(s3Events.map((event) => event.type), ['run.queued', 'run.started', 'tool.started', 'tool.completed', 'run.completed']);
    assert.deepEqual(s3Events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
    assert.doesNotMatch(JSON.stringify(s3Events.map((event) => ({ type: event.type, payload: event.payload }))), new RegExp(FAKE_PROVIDER_PRIVATE_MARKER));
    assert.doesNotMatch(JSON.stringify(s3Events.map((event) => event.payload)), /100000\.00|999999\.00|899999\.00/);
    // S8: complete provider-reported usage is persisted on the run, never inferred from text.
    const s8 = await makeRun({ label: 'S8-token-usage', status: 'QUEUED', job: { status: 'QUEUED', attempts: 0, maxAttempts: 1 } });
    const s8Claimed = await claimNextBackgroundJob(`assistant-usage-gate-${suffix}`, 900);
    assert.ok(s8Claimed, 'usage test job should be claimed');
    assert.equal(s8Claimed.id, s8.jobId);
    const usageHandler = createAssistantAgentRunJobHandler({
      runAssistantTurn: async () => ({
        text: '仅用于 token 用量持久化验收的回答。',
        tokenUsage: { status: 'COMPLETE', inputTokens: 321, outputTokens: 87, totalTokens: 408 },
      }),
    });
    await usageHandler(s8Claimed);
    await prisma.backgroundJob.updateMany({ where: { id: s8Claimed.id, status: 'RUNNING' }, data: { status: 'SUCCEEDED', finishedAt: new Date(), lockedAt: null, lockedBy: null } });
    const s8Run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: s8.run.id } });
    assert.equal(s8Run.status, 'COMPLETED');
    assert.equal(s8Run.usageStatus, 'COMPLETE');
    assert.equal(s8Run.inputTokens, 321);
    assert.equal(s8Run.outputTokens, 87);
    assert.equal(s8Run.totalTokens, 408);
    assert.ok(s8Run.usageCapturedAt instanceof Date);

    const s3Audit = await prisma.auditLog.findMany({ where: { entity: 'AssistantRun', entityId: s3.run.id } });
    assert.equal(s3Audit.filter((row) => row.action === 'ASSISTANT_RUN_COMPLETED').length, 1);

    // S3-CANCEL: a persisted cancellation request must abort the active model call via AbortSignal.
    const sCancel = await makeRun({ label: 'S3-CANCEL-provider-abort', status: 'QUEUED', job: { status: 'QUEUED', attempts: 0, maxAttempts: 1 } });
    const cancelClaimed = await claimNextBackgroundJob(`assistant-cancel-gate-${suffix}`, 900);
    assert.ok(cancelClaimed, 'queued cancellation test job should be claimed');
    assert.equal(cancelClaimed.id, sCancel.jobId);
    let observedSignal: AbortSignal | undefined;
    let abortObserved = false;
    const cancellationHandler = createAssistantAgentRunJobHandler({
      runAssistantTurn: (input) => new Promise<string>((_resolve, reject) => {
        observedSignal = input.signal;
        assert.ok(observedSignal, 'worker must pass a model-call AbortSignal');
        const onAbort = () => {
          abortObserved = true;
          reject(new Error('ASSISTANT_CANCEL_REQUESTED'));
        };
        if (observedSignal.aborted) onAbort();
        else observedSignal.addEventListener('abort', onAbort, { once: true });
      }),
    });
    const cancellationExecution = cancellationHandler(cancelClaimed);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const liveRun = await prisma.assistantRun.findUniqueOrThrow({ where: { id: sCancel.run.id } });
      if (liveRun.status === 'RUNNING' && observedSignal) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(observedSignal, 'model call should start before cancellation is requested');
    assert.equal((await prisma.assistantRun.findUniqueOrThrow({ where: { id: sCancel.run.id } })).status, 'RUNNING');
    await prisma.assistantRun.update({ where: { id: sCancel.run.id }, data: { cancelRequestedAt: new Date() } });
    await cancellationExecution;
    await prisma.backgroundJob.updateMany({
      where: { id: cancelClaimed.id, status: 'RUNNING' },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), lockedAt: null, lockedBy: null },
    });
    assert.equal(abortObserved, true, 'worker must abort the model call after observing the persisted cancel marker');
    const cancelledRun = await prisma.assistantRun.findUniqueOrThrow({ where: { id: sCancel.run.id } });
    assert.equal(cancelledRun.status, 'CANCELLED');
    assert.equal(await prisma.assistantMessage.count({ where: { conversationId: sCancel.conversation.id, role: 'ASSISTANT' } }), 0);
    const cancelledEvents = await prisma.assistantRunEvent.findMany({ where: { runId: sCancel.run.id }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(cancelledEvents.map((event) => event.type), ['run.queued', 'run.started', 'run.cancelled']);


    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(join(artifactDir, 'assistant-events.jsonl'), s3Events.map((event) => JSON.stringify({ type: event.type, payload: event.payload })).join('\n') + '\n', 'utf8');
      await writeFile(join(artifactDir, 'assistant-forbidden-markers.txt'), [FAKE_PROVIDER_PRIVATE_MARKER, 'test-only-no-provider-call', 'https://provider.example.invalid/v1'].join('\n') + '\n', 'utf8');
    }

    // S4: a valid live lease must stay RUNNING and not be mistaken for an orphan.
    const s4 = await makeRun({ label: 'S4-valid-lease', status: 'RUNNING', startedAt: new Date(), job: { status: 'RUNNING', attempts: 1, maxAttempts: 3, lockedAt: new Date(), lockedBy: `lease-${suffix}` } });
    assert.equal(await reconcileOrphanAssistantRuns(60), 0);
    assert.equal((await prisma.assistantRun.findUniqueOrThrow({ where: { id: s4.run.id } })).status, 'RUNNING');

    const expiredAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    // S5 and S6: max-attempt exhausted leases are reconciled; cancellation wins, otherwise FAILED + audit.
    const s5 = await makeRun({ label: 'S5-cancelled-exhausted', status: 'RUNNING', cancelRequestedAt: new Date(), startedAt: expiredAt, job: { status: 'RUNNING', attempts: 3, maxAttempts: 3, lockedAt: expiredAt, lockedBy: `expired-${suffix}` } });
    const s6 = await makeRun({ label: 'S6-failed-exhausted', status: 'RUNNING', startedAt: expiredAt, job: { status: 'RUNNING', attempts: 3, maxAttempts: 3, lockedAt: expiredAt, lockedBy: `expired-${suffix}` } });
    assert.equal(await claimNextBackgroundJob(`recovery-${suffix}`, 60), null);
    const s5Run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: s5.run.id } });
    const s6Run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: s6.run.id } });
    assert.equal(s5Run.status, 'CANCELLED');
    assert.equal(s5Run.errorCode, null);
    assert.equal(s6Run.status, 'FAILED');
    assert.equal(s6Run.errorCode, 'ASSISTANT_WORKER_LEASE_EXPIRED');
    const s5Events = await prisma.assistantRunEvent.findMany({ where: { runId: s5.run.id } });
    const s6Events = await prisma.assistantRunEvent.findMany({ where: { runId: s6.run.id } });
    assert.equal(s5Events.filter((event) => event.type === 'run.cancelled').length, 1);
    assert.equal(s5Events.filter((event) => event.type === 'run.failed').length, 0);
    assert.equal(s6Events.filter((event) => event.type === 'run.failed').length, 1);
    const s5FailedAudit = await prisma.auditLog.count({ where: { entityId: s5.run.id, action: 'ASSISTANT_RUN_FAILED' } });
    const s6FailedAudit = await prisma.auditLog.count({ where: { entityId: s6.run.id, action: 'ASSISTANT_RUN_FAILED', changes: { path: ['code'], equals: 'ASSISTANT_WORKER_LEASE_EXPIRED' } } });
    assert.equal(s5FailedAudit, 0);
    assert.equal(s6FailedAudit, 1);

    // Follow-up to S1/S2: only once a jobless run is genuinely older than the grace period should it self-heal.
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    const staleOrphan = await makeRun({ label: 'S7-stale-orphan-after-grace', status: 'RUNNING', startedAt: staleAt, createdAt: staleAt });
    assert.equal(await reconcileOrphanAssistantRuns(60), 1);
    const staleOrphanRun = await prisma.assistantRun.findUniqueOrThrow({ where: { id: staleOrphan.run.id } });
    assert.equal(staleOrphanRun.status, 'FAILED');
    assert.equal(staleOrphanRun.errorCode, 'ASSISTANT_ORPHAN_RUN');
    assert.equal(await prisma.assistantRunEvent.count({ where: { runId: staleOrphan.run.id, type: 'run.failed' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: staleOrphan.run.id, action: 'ASSISTANT_RUN_FAILED' } }), 1);
  } finally {
    restoreEnv();
    if (userId) {
      await prisma.backgroundJob.deleteMany({ where: { ownerUserId: userId } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { OR: [{ userId }, ...(projectId ? [{ projectId }] : [])] } }).catch(() => undefined);
    }
    if (conversationIds.length) await prisma.assistantConversation.deleteMany({ where: { id: { in: conversationIds } } }).catch(() => undefined);
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});


test('isolated PostgreSQL serializes concurrent assistant submissions across conversations per user', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated; use local/CI test PostgreSQL');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  let userId: string | undefined;
  let projectId: string | undefined;
  const conversationIds: string[] = [];
  try {
    const user = await prisma.user.create({
      data: { name: `Assistant Cap ${suffix}`, email: `assistant-cap-${suffix}@example.invalid`, passwordHash: 'test-only-not-a-login-password', role: 'ADMIN' },
    });
    userId = user.id;
    const project = await prisma.project.create({
      data: { name: `Assistant Cap Project ${suffix}`, code: `AC-${suffix}`, ownerName: 'Gate Owner', contractAmount: '1000.00', originalContractAmount: '1000.00', startDate: new Date() },
    });
    projectId = project.id;
    const conversations = await Promise.all([0, 1, 2].map((index) => prisma.assistantConversation.create({
      data: { ownerUserId: user.id, projectId: project.id, title: `Assistant Cap ${suffix} ${index}` },
    })));
    conversationIds.push(...conversations.map((conversation) => conversation.id));

    const outcomes = await Promise.allSettled(conversations.map((conversation, index) =>
      prisma.$transaction(async (tx) => {
        await assertAssistantUserRunAdmission(tx, user.id);
        const requestId = `cap-${suffix}-${index}`;
        return tx.assistantRun.create({
          data: {
            conversationId: conversation.id, ownerUserId: user.id, projectId: project.id,
            requestId, requestHash: createHash('sha256').update(requestId).digest('hex'), status: 'QUEUED',
          },
        });
      }),
    ));

    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 2);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0]?.reason as Error)?.message, 'ASSISTANT_USER_RUN_LIMIT_REACHED');
    assert.equal(await prisma.assistantRun.count({ where: { ownerUserId: user.id, status: { in: ['QUEUED', 'RUNNING'] } } }), 2);
  } finally {
    if (conversationIds.length) await prisma.assistantConversation.deleteMany({ where: { id: { in: conversationIds } } }).catch(() => undefined);
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});


test('isolated PostgreSQL limits concurrent user submissions to six in a rolling minute', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated; use local/CI test PostgreSQL');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  let userId: string | undefined;
  let projectId: string | undefined;
  const conversationIds: string[] = [];
  try {
    const user = await prisma.user.create({
      data: { name: `Assistant Rate ${suffix}`, email: `assistant-rate-${suffix}@example.invalid`, passwordHash: 'test-only-not-a-login-password', role: 'ADMIN' },
    });
    userId = user.id;
    const project = await prisma.project.create({
      data: { name: `Assistant Rate Project ${suffix}`, code: `AR-${suffix}`, ownerName: 'Gate Owner', contractAmount: '1000.00', originalContractAmount: '1000.00', startDate: new Date() },
    });
    projectId = project.id;
    const conversations = await Promise.all(Array.from({ length: 7 }, (_, index) => prisma.assistantConversation.create({
      data: { ownerUserId: user.id, projectId: project.id, title: `Assistant Rate ${suffix} ${index}` },
    })));
    conversationIds.push(...conversations.map((conversation) => conversation.id));

    const outcomes = await Promise.allSettled(conversations.map((conversation, index) =>
      prisma.$transaction(async (tx) => {
        await assertAssistantUserRunAdmission(tx, user.id);
        const requestId = `rate-${suffix}-${index}`;
        return tx.assistantRun.create({
          data: {
            conversationId: conversation.id, ownerUserId: user.id, projectId: project.id,
            requestId, requestHash: createHash('sha256').update(requestId).digest('hex'),
            status: 'FAILED', finishedAt: new Date(), errorCode: 'TEST_ONLY_TERMINAL_RUN',
          },
        });
      }),
    ));

    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 6);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0]?.reason as Error)?.message, 'ASSISTANT_USER_RUN_RATE_LIMIT_REACHED');
    assert.equal(await prisma.assistantRun.count({
      where: { ownerUserId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
    }), 6);
  } finally {
    if (conversationIds.length) await prisma.assistantConversation.deleteMany({ where: { id: { in: conversationIds } } }).catch(() => undefined);
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});
