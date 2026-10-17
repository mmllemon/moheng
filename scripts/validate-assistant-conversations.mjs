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
  read('docs/assistant-runtime-decision-v1.0.md'),
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

console.log(JSON.stringify({ gate: 'ASSISTANT_CONVERSATION_API_SSE_STATIC_CONTRACT', result: 'PASS', assertions, runtime: 'LangGraph adapter + PostgreSQL checkpoint schema', productionEnabled: false, caveat: 'Static source contract only; not a TypeScript build, live DB migration, API concurrency test, or model E2E.' }, null, 2));
