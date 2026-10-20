import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [rootPackage, apiPackage, adapter, events, adapterTests, eventTests, integration, guard, workflow] = await Promise.all([
  read('package.json').then(JSON.parse), read('apps/api/package.json').then(JSON.parse),
  read('apps/api/src/assistant/runtime/langgraph-adapter.ts'), read('apps/api/src/lib/assistant-run-events.ts'),
  read('apps/api/src/assistant/runtime/langgraph-adapter.test.ts'), read('apps/api/src/lib/assistant-event-safety.test.ts'),
  read('apps/api/src/lib/assistant-recovery.integration.test.ts'), read('scripts/validate-assistant-leaks.mjs'),
  read('.github/workflows/assistant-runtime-gates.yml'),
]);
const tokenUsageSchema = await read('apps/api/prisma/schema.prisma');
const tokenUsageMigration = await read('apps/api/prisma/migrations/20261020100000_assistant_run_token_usage/migration.sql');
const tokenUsageWorker = await read('apps/api/src/lib/assistant-agent-run-job.ts');
const tokenUsageThread = await read('apps/web/src/components/assistant/AssistantThread.tsx');
const checks = [];
function check(name, condition) { checks.push({ name, passed: Boolean(condition) }); }
check('root/API/Web version aligned to the current candidate', rootPackage.version === apiPackage.version && JSON.parse(await read('apps/web/package.json')).version === rootPackage.version);
check('fake provider is injected in-process with no public environment toggle', adapter.includes('dependencies: Partial<AssistantRuntimeTestDependencies>') && !adapter.includes('ASSISTANT_POC_FAKE_PROVIDER'));
check('provider token usage is explicit and unknown-by-default with DB consistency constraints',
  tokenUsageSchema.includes('usageStatus        String   @default("UNAVAILABLE")') &&
  tokenUsageMigration.includes('AssistantRun_usage_consistency_check') &&
  adapter.includes('aggregateTokenUsage') && adapter.includes("status: 'PARTIAL'") && adapter.includes("status: 'UNAVAILABLE'"));
check('usage persistence contains only token counts and statuses, never a price estimate or prompt/answer content',
  tokenUsageWorker.includes('usageUpdateData(tokenUsage)') &&
  tokenUsageWorker.includes('usageStatus: tokenUsage?.status ?? \'UNAVAILABLE\'') &&
  !tokenUsageWorker.includes('estimatedCost') && !tokenUsageWorker.includes('costUsd') &&
  tokenUsageThread.includes('实际用量未知') && tokenUsageThread.includes('未展示估算总量'));
check('production factory remains ChatOpenAI + PostgresSaver', adapter.includes('PostgresSaver.fromConnString') && adapter.includes('new ChatOpenAI') && adapter.includes('createAgent'));
check('tool.completed persists bounded source metadata and fixed limitation copy, never result body', adapter.includes('sources: result.sources.map') && adapter.includes('limitations: result.limitations') && events.includes('ASSISTANT_EVENT_LIMITATION_NOT_ALLOWED') && events.includes('ASSISTANT_SAFE_LIMITATIONS.includes(item)'));
check('runtime event payload has explicit event/field allowlist and validates before sequence allocation', events.includes('assertSafeAssistantEventPayload(input.type, input.payload)') && events.indexOf('assertSafeAssistantEventPayload(input.type, input.payload)') < events.indexOf('tx.assistantRun.update'));
check('nested source metadata excludes raw body/value fields', events.includes("['entity', 'fields', 'rowCount', 'scope']") && events.includes('ASSISTANT_EVENT_SOURCE_FIELD_NOT_ALLOWED'));
check('fake provider success tests assert correct tool choice and grounded values', adapterTests.includes("['cost_variance']") && adapterTests.includes("['project_operating_overview']") && adapterTests.includes('899999\\.00') && adapterTests.includes('OVER_TARGET'));
check('event guard tests cover prompt/answer/amount rejection before write', eventTests.includes('SECRET-PROMPT-TEST-ONLY') && eventTests.includes('SECRET-ANSWER-TEST-ONLY') && eventTests.includes('sequenceAllocated, false'));
check('PostgreSQL regression includes S1-S6 plus stale orphan self-heal', ['S1-missing-job','S2-invalid-job','S3-valid-queued','S4-valid-lease','S5-cancelled-exhausted','S6-failed-exhausted','S7-stale-orphan-after-grace'].every((scenario) => integration.includes(scenario)) && integration.includes('ASSISTANT_WORKER_LEASE_EXPIRED') && integration.includes('ASSISTANT_ORPHAN_RUN'));
check('test database guard requires explicit opt-in and isolation check', integration.includes("ASSISTANT_RECOVERY_TESTS === 'true'") && integration.includes('PRODUCTION_DATABASE_URL') && integration.includes('isolated, migrated PostgreSQL test database'));
check('leak scanner has CLI for runtime logs, events, and forbidden markers', guard.includes("arg('--logs')") && guard.includes("arg('--events')") && guard.includes("arg('--markers')"));
check('CI runs release build, API tests, PostgreSQL recovery, and persisted-event leak scan', workflow.includes('npm run build') && workflow.includes('npm run test -w @cms/api') && workflow.includes('test:assistant-recovery:postgres') && workflow.includes('validate-assistant-leaks.mjs'));
check('release candidate chains runtime safety validation and leak-guard unit tests', rootPackage.scripts['validate:release-candidate'].includes('validate-assistant-safety-contract.mjs') && rootPackage.scripts['validate:release-candidate'].includes('test:assistant-runtime-contracts'));
for (const item of checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`ASSISTANT_RUNTIME_SAFETY_CONTRACT ${checks.filter((item) => item.passed).length}/${checks.length}`);
assert.ok(checks.every((item) => item.passed), 'Assistant runtime safety contract validation failed');
