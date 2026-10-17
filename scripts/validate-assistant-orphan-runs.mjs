import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [jobs, worker, runtime, handler, schema, ui, apiPackage] = await Promise.all([
  readFile(new URL('../apps/api/src/lib/background-jobs.ts', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/src/lib/background-job-worker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/src/assistant/runtime/langgraph-adapter.ts', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/src/lib/assistant-agent-run-job.ts', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../apps/web/src/pages/CostAssistantPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/package.json', import.meta.url), 'utf8'),
]);
const checks = [];
function check(name, condition) { checks.push({ name, condition: Boolean(condition) }); }
function projectModel() { return schema.slice(schema.indexOf('model Project {'), schema.indexOf('\nmodel RefreshToken {')); }
const project = projectModel();
check('LangChain core peer pin aligned to 1.2.18', JSON.parse(apiPackage).dependencies['@langchain/core'] === '1.2.18');
check('Optional base URL passed through configuration.baseURL', runtime.includes('configuration: { baseURL }') && runtime.includes('baseURL?: string;'));
check('Job handler reads OPENAI_BASE_URL and passes it to runtime', handler.includes('process.env.OPENAI_BASE_URL') && handler.includes('apiKey, modelId, baseURL, checkpointUrl'));
check('Five invalid Project-side reverse relations removed', !project.includes('createdGovernanceRules') && !project.includes('publishedGovernanceRules') && !project.includes('triggeredBackupRuns') && !project.includes('createdIntegrationCredentials') && !project.includes('updatedIntegrationCredentials'));
check('Legitimate Project systemParameterRevisions relation retained', project.includes('systemParameterRevisions SystemParameterRevision[]'));
check('Orphan reconciler uses explicit target-table references and valid run/conversation JSON predicates', jobs.includes('reconcileOrphanAssistantRuns') && jobs.includes('graceSeconds > 3600') && jobs.includes("job.\"type\" = 'assistant.agent.run'") && jobs.includes("job.\"payload\"->>'runId' = \"AssistantRun\".\"id\"") && jobs.includes("job.\"payload\"->>'conversationId' = \"AssistantRun\".\"conversationId\"") && !jobs.includes("run.\"conversationId'") && !jobs.includes('UPDATE \"AssistantRun\" AS run'));
check('Orphan recovery preserves cancellation state and persists terminal events', jobs.includes("'ASSISTANT_ORPHAN_RUN'") && jobs.includes("type: 'run.cancelled'") && jobs.includes("type: 'run.failed'") && jobs.includes("action: 'ASSISTANT_RUN_FAILED'"));
check('Worker periodically invokes orphan reconciliation', worker.includes('lastAssistantOrphanSweepAt') && worker.includes('reconcileOrphanAssistantRuns()'));
check('UI prefers durable terminal state after stream teardown', ui.includes('const persistedRun = latest.runs.find((item) => item.id === runId)') && ui.includes("['COMPLETED', 'FAILED', 'CANCELLED'].includes(persistedRun.status)"));
check('UI provides explicit orphan/lease recovery copy', ui.includes('ASSISTANT_ORPHAN_RUN:') && ui.includes('ASSISTANT_WORKER_LEASE_EXPIRED:'));

for (const { name, condition } of checks) console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
console.log(`ASSISTANT_ORPHAN_RUN_RECOVERY_CONTRACT ${checks.filter((item) => item.condition).length}/${checks.length}`);
assert.ok(checks.every((item) => item.condition), 'Assistant orphan-run recovery contract validation failed');
