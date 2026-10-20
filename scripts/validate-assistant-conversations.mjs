import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const read = (path) => readFile(join(process.cwd(), path), 'utf8');
const [routes, pocRoutes, jobHandler, runtime, eventService, queue, registry, schema, migration, rootPkg, apiPkg, webPkg, setup, decision] = await Promise.all([
  read('apps/api/src/routes/assistant-conversations.ts'),
  read('apps/api/src/routes/assistant-poc.ts'),
  read('apps/api/src/lib/assistant-agent-run-job.ts'),
  read('apps/api/src/assistant/runtime/langgraph-adapter.ts'),
  read('apps/api/src/lib/assistant-run-events.ts'),
  read('apps/api/src/lib/background-jobs.ts'),
  read('apps/api/src/platform/background-job-registry.ts'),
  read('apps/api/prisma/schema.prisma'),
  read('apps/api/prisma/migrations/20261016060000_assistant_sessions_and_events/migration.sql'),
  read('package.json').then(JSON.parse),
  read('apps/api/package.json').then(JSON.parse),
  read('apps/web/package.json').then(JSON.parse),
  read('apps/api/src/assistant/runtime/setup-checkpoint-schema.ts'),
  read('docs/AI助手实施与准入.md'),
]);
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

for (const endpoint of [
  "app.get('/conversations'", "app.post('/conversations'", "app.get('/conversations/:conversationId'",
  "app.post('/conversations/:conversationId/archive'", "app.post('/conversations/:conversationId/messages'",
  "app.post('/conversations/:conversationId/runs/:runId/cancel'", "app.get('/conversations/:conversationId/runs/:runId/events'",
]) check(routes.includes(endpoint), `missing endpoint ${endpoint}`);
check(pocRoutes.includes("process.env.ASSISTANT_POC_ENABLED !== 'true'"), 'assistant must remain feature-gated off by default');
check(pocRoutes.includes('await assistantConversationRoutes(app)'), 'conversation routes must stay under the hidden PoC module');
check(pocRoutes.includes('await assistantConversationRoutes') && !pocRoutes.includes('integrationVisible: true'), 'PoC must not be published as a public module');
check(routes.includes("preHandler: [featureGate, authRequired]"), 'session routes must require auth and the feature gate');
check(routes.includes("where: { id: conversationId, ownerUserId, project: { deletedAt: null } }"), 'conversation lookup must be owner-scoped');
check(routes.includes("canAccessProject(ownerUserId, role, conversation.projectId, undefined, 'PROJECT_READ')"), 'conversation scope must be rechecked against current project permission');
check(routes.includes("z.object({") && routes.includes(".strict()"), 'request schemas must reject unknown fields');
check(routes.includes('requestId') && routes.includes('requestHash') && routes.includes('IDEMPOTENCY_KEY_REUSED'), 'request idempotency and payload mismatch must be explicit');
check(routes.includes('FOR UPDATE') && routes.includes("status: { in: ['QUEUED', 'RUNNING'] }"), 'one run per conversation must be protected inside a transaction');
check(routes.includes("type: 'assistant.agent.run'") && routes.includes('enqueueBackgroundJob(tx'), 'agent run must be atomically queued with the user message');
check(!routes.includes('payload: { conversationId: conversation.id, runId: run.id, requestId: body.data.requestId, content: body.data.content }'), 'raw prompt must not be copied into job payload');
check(routes.includes("requestId: body.data.requestId, promptLength: body.data.content.length"), 'audit metadata should contain prompt length, not raw prompt');
check(routes.includes("header = request.headers['last-event-id']") && routes.includes('event: ${event.type}'), 'SSE must support resume cursor and named events');
check(routes.includes('sequence: { gt: cursor }') && routes.includes("orderBy: { sequence: 'asc' }"), 'SSE must replay ordered persisted events');
check(routes.includes("retry: 3000\\n\\n") && routes.includes("rateLimit: { max: 30, timeWindow: '1 minute' }"), 'SSE reconnect cadence and request rate limit must be compatible');
check(routes.includes('heartbeat') && routes.includes('run.cancel_requested'), 'SSE must send heartbeats and cancellation state');
check(routes.includes("status: 'CANCELLED'") && routes.includes('cancelRequestedAt'), 'cancellation state must be persisted');
check(routes.includes("if (run.cancelRequestedAt) return"), 'repeated cancellation must not append repeated cancellation events');
check(routes.includes("action: 'ASSISTANT_CONVERSATION_ARCHIVED'"), 'archive action must be audited');
check(routes.includes('status: conversation.status'), 'conversation list must expose active/archived status for its archived filter');
check(routes.includes("if (conversation.status !== 'ACTIVE')"), 'archived conversations cannot accept new messages');
check(routes.includes("status: 'ACTIVE', project: { deletedAt: null }") && routes.indexOf('FOR UPDATE') < routes.indexOf("status: 'ACTIVE', project: { deletedAt: null }"), 'message submission rechecks active conversation status under the row lock');
check(routes.includes('ASSISTANT_CONVERSATION_ARCHIVED') && routes.includes('ASSISTANT_RUNTIME_NOT_CONFIGURED'), 'archival race and runtime misconfiguration return explicit safe errors');
check(routes.includes("import { isAssistantBaseUrlValid } from '../lib/assistant-config.js'") && routes.includes('!isAssistantBaseUrlValid(process.env.OPENAI_BASE_URL)'), 'message submission must reject an invalid optional model endpoint before enqueueing a run');
check(routes.includes('ASSISTANT_EVENT_CURSOR_AHEAD') && routes.includes('after > ownedRun.lastEventSequence'), 'SSE rejects a cursor that skips beyond the durable event stream');
check(eventService.includes('lastEventSequence: { increment: 1 }') && eventService.includes('sequence: run.lastEventSequence'), 'run event sequence must be monotonic and transactionally allocated');
check(jobHandler.includes("type: 'run.started'") && jobHandler.includes("type: 'run.completed'") && jobHandler.includes("type: 'run.failed'"), 'run lifecycle must publish durable events');
check(jobHandler.includes("where: { id: runId, status: 'RUNNING', cancelRequestedAt: null }") && jobHandler.includes('completed.count !== 1'), 'terminal completion must atomically lose to a committed cancellation request');
check(jobHandler.includes('const failed = await tx.assistantRun.updateMany') && jobHandler.includes('const cancelled = await tx.assistantRun.updateMany'), 'failure and cancellation transitions use guarded conditional updates');
check(jobHandler.includes('canAccessProject(user.id, user.role, run.projectId, undefined, \'PROJECT_READ\')'), 'worker must recheck project access at execution time');
check(jobHandler.includes("maxAttempts: 1") || routes.includes('maxAttempts: 1'), 'provider work must not be blindly retried and charged twice');
check(!jobHandler.includes('@langchain/') && !jobHandler.includes("from 'langchain'"), 'provider/runtime SDK imports must stay outside the generic job layer');
check(runtime.includes("createSaver: (checkpointUrl, options) => PostgresSaver.fromConnString(checkpointUrl, options)") && runtime.includes("runtime.createSaver(input.checkpointUrl, { schema: checkpointSchema })"), 'LangGraph checkpoint must use its isolated schema');
check(runtime.includes("schema: z.object({}).strict()") && runtime.includes('runAssistantReadOnlyTool'), 'model tools must be argument-free and reuse read-only services');
check(runtime.includes("'project_operating_overview', 'cost_variance', 'change_evidence_completeness'"), 'only the three reviewed read-only tools are allowed');
check(!runtime.includes('await saver.setup()'), 'request-time runtime must never run checkpoint DDL');
check(setup.includes('await saver.setup()') && setup.includes("schema: 'moheng_assistant'"), 'checkpoint DDL must be explicit in the setup command');
check(queue.includes('RETURNING "id", "type", "payload", "ownerUserId", "projectId"') && queue.includes('ASSISTANT_WORKER_LEASE_EXPIRED'), 'exhausted worker lease must reconcile assistant run state');
check(queue.includes("action: 'ASSISTANT_RUN_FAILED'") && jobHandler.includes("action: 'ASSISTANT_RUN_FAILED'"), 'terminal assistant failures must be auditable without storing prompt/response content');
check(registry.includes("['assistant.agent.run', assistantAgentRunJobHandler]"), 'agent job handler must be in the stable background-job registry');
for (const model of ['AssistantConversation', 'AssistantMessage', 'AssistantRun', 'AssistantRunEvent']) check(schema.includes(`model ${model} {`), `missing Prisma model ${model}`);
for (const table of ['AssistantConversation', 'AssistantMessage', 'AssistantRun', 'AssistantRunEvent']) check(migration.includes(`CREATE TABLE "${table}"`), `missing additive migration table ${table}`);
check(migration.includes('AssistantRunEvent_runId_sequence_key') && migration.includes('AssistantMessage_conversationId_requestId_key'), 'DB must enforce event sequence and message idempotency uniqueness');
check(decision.includes('apps/api/src/assistant/runtime/') && runtime.includes('LangGraph/provider SDKs are isolated'), 'runtime adapter boundary must be preserved');
check(rootPkg.version === apiPkg.version && rootPkg.version === webPkg.version, 'root/API/Web package versions must be aligned');
check(['@langchain/core', '@langchain/openai', '@langchain/langgraph-checkpoint-postgres', 'langchain'].every((name) => Boolean(apiPkg.dependencies[name])), 'API must pin required runtime dependencies');
check(rootPkg.scripts['validate:release-candidate'].includes('validate-assistant-conversations.mjs'), 'assistant session contract must run in release validation');

const usageSummary = await read('apps/api/src/lib/assistant-usage-summary.ts');
const usageSummaryTests = await read('apps/api/src/lib/assistant-usage-summary.test.ts');
const tokenUsageMigration = await read('apps/api/prisma/migrations/20261020100000_assistant_run_token_usage/migration.sql');
const tokenUsageTests = await read('apps/api/src/assistant/runtime/langgraph-adapter.test.ts');
const tokenUsageIntegration = await read('apps/api/src/lib/assistant-recovery.integration.test.ts');
const tokenUsageWebApi = await read('apps/web/src/assistant-api.ts');
const tokenUsageThread = await read('apps/web/src/components/assistant/AssistantThread.tsx');
const tokenUsageWorker = await read('apps/api/src/lib/assistant-agent-run-job.ts');
const submissionPolicy = await read('apps/api/src/lib/assistant-submission-policy.ts');
const submissionPolicyTests = await read('apps/api/src/lib/assistant-submission-policy.test.ts');
check(routes.includes("assertAssistantUserRunAdmission(tx, actor.sub)") && routes.includes('ASSISTANT_USER_RUN_LIMIT_REACHED') && routes.includes('ASSISTANT_USER_RUN_RATE_LIMIT_REACHED'), 'message submission must enforce cross-conversation active and sliding-window per-user limits');
check(submissionPolicy.includes('MAX_ACTIVE_ASSISTANT_RUNS_PER_USER = 2') && submissionPolicy.includes('FOR UPDATE') && submissionPolicy.includes("status: { in: ['QUEUED', 'RUNNING'] }"), 'user-level admission must serialize the count under a user-row lock and count queued plus running work');
check(submissionPolicy.includes('MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE = 6') && submissionPolicy.includes('createdAt: { gte: windowStart }'), 'user-level sliding-window rate limit must count all recent runs under the same user-row lock');
check(submissionPolicyTests.includes('assistant user sliding-window submission limit admits six and rejects the seventh'), 'user submission rate-limit boundary must have unit coverage');
check((await read('apps/api/src/lib/assistant-recovery.integration.test.ts')).includes('limits concurrent user submissions to six in a rolling minute'), 'isolated PostgreSQL gate must exercise concurrent cross-session rate-limit admission');
check(submissionPolicyTests.includes('assistant user run limit admits fewer than two active runs and rejects the third') && submissionPolicyTests.includes('rejects invalid counters'), 'user run-cap policy must have boundary unit tests');
check(schema.includes('inputTokens        Int?') && schema.includes('outputTokens       Int?') && schema.includes('totalTokens        Int?') && schema.includes("usageStatus        String   @default('UNAVAILABLE')") === false && schema.includes('usageStatus        String   @default("UNAVAILABLE")'), 'AssistantRun must persist optional provider token counts with an explicit unknown-by-default status');
check(tokenUsageMigration.includes('AssistantRun_usageStatus_check') && tokenUsageMigration.includes('AssistantRun_usage_consistency_check') && tokenUsageMigration.includes('AssistantRun_usageStatus_createdAt_idx'), 'token usage migration must constrain status, count consistency and index usage reporting');
check(runtime.includes('function aggregateTokenUsage') && runtime.includes('usage_metadata') && runtime.includes("status: 'PARTIAL'") && runtime.includes("status: 'UNAVAILABLE'"), 'runtime must derive usage only from provider metadata and distinguish incomplete/unavailable counts');
check(tokenUsageWorker.includes('...usageUpdateData(tokenUsage)') && tokenUsageWorker.includes("usageStatus: tokenUsage?.status ?? 'UNAVAILABLE'"), 'worker must persist provider usage metadata on terminal runs without logging prompt or answer text');
check(routes.includes('inputTokens: true, outputTokens: true, totalTokens: true, usageStatus: true, usageCapturedAt: true') && tokenUsageWebApi.includes('usageStatus:') && tokenUsageWebApi.includes('usageCapturedAt:'), 'conversation API must expose the caller-owned run usage summary');
check(tokenUsageTests.includes('provider token usage is summed across generated model messages') && tokenUsageTests.includes('marked partial when any generated model message omits metrics'), 'runtime tests must verify multi-call aggregation and partial-usage nulling');
check(tokenUsageIntegration.includes('S8-token-usage') && tokenUsageIntegration.includes("s3Run.usageStatus, 'UNAVAILABLE'"), 'isolated PostgreSQL tests must cover complete usage persistence and unknown usage defaults');
check(tokenUsageThread.includes('本轮模型用量：输入') && tokenUsageThread.includes('实际用量未知') && tokenUsageThread.includes('未展示估算总量'), 'UI must show verified counts and explicit unknown/partial states without inventing totals');
check(routes.includes("app.get('/usage-summary'") && routes.includes("canAccessProject(actor.sub, actor.role, projectId, undefined, 'PROJECT_READ')") && routes.includes("by: ['usageStatus']") && routes.includes('ownerUserId: actor.sub'), 'project usage summary must be authenticated, owner-scoped and project-authorized');
const usageSummaryRoute = routes.slice(routes.indexOf("app.get('/usage-summary'"), routes.indexOf("app.get('/conversations'"));
check(usageSummaryRoute.includes("createdAt: { gte: periodStart, lte: periodEnd }") && !usageSummaryRoute.match(/prisma\.assistantRun\.count\(\s*\{\s*where:[^}]*createdAt/), 'terminal usage is bounded to 30 days while active run count reflects all current active work');
check(usageSummary.includes('ASSISTANT_USAGE_SUMMARY_WINDOW_DAYS = 30') && usageSummary.includes("usageStatus === 'COMPLETE'") && usageSummary.includes('totalTokens === inputTokens + outputTokens'), 'usage summary must use a bounded period and only expose consistent complete token totals');
check(usageSummaryTests.includes('leaves token totals unknown') && usageSummaryTests.includes('rejects inconsistent aggregate token totals') && usageSummaryTests.includes('zero tokens as a known value'), 'usage summary must cover unknown, inconsistent and zero-token edge cases');


console.log(JSON.stringify({ gate: 'ASSISTANT_CONVERSATION_API_SSE_STATIC_CONTRACT', result: 'PASS', assertions, runtime: 'LangGraph adapter + PostgreSQL checkpoint schema', productionEnabled: false, caveat: 'Static source contract only; not a TypeScript build, live DB migration, API concurrency test, or model E2E.' }, null, 2));
