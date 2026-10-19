import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const read = (path) => readFile(resolve(path), 'utf8');
const [service, routes, server, registry, piAgent, langGraphAgent, pgSmoke, pgProbe, safePath, hardKillSmoke, packageJsonText, pocPackageText, decision, workflow, assistantConfig, assistantJob, assistantApi, assistantPage] = await Promise.all([
  read('apps/api/src/lib/assistant-read-only-tools.ts'),
  read('apps/api/src/routes/assistant-poc.ts'),
  read('apps/api/src/server.ts'),
  read('apps/api/src/platform/module-registry.ts'),
  read('experiments/pi-durable-poc/src/moheng-read-only-agent.ts'),
  read('experiments/pi-durable-poc/src/moheng-langgraph-agent.ts'),
  read('experiments/pi-durable-poc/src/langgraph-postgres-smoke.mjs'),
  read('experiments/pi-durable-poc/src/storage-probe.mjs'),
  read('experiments/pi-durable-poc/src/safe-storage-path.mjs'),
  read('experiments/pi-durable-poc/src/pi-durable-hardkill-smoke.mjs'),
  read('package.json'),
  read('experiments/pi-durable-poc/package.json'),
  read('docs/AI助手实施与准入.md'),
  read('.github/workflows/assistant-runtime-gates.yml'),
  read('apps/api/src/lib/assistant-config.ts'),
  read('apps/api/src/lib/assistant-agent-run-job.ts'),
  read('apps/web/src/assistant-api.ts'),
  read('apps/web/src/pages/CostAssistantPage.tsx'),
]);

const [cashSummary, costVariance] = await Promise.all([
  read('apps/api/src/lib/report-studio-payment-summary.ts'),
  read('apps/api/src/lib/assistant-cost-variance.ts'),
]);

const packageJson = JSON.parse(packageJsonText);
const pocPackage = JSON.parse(pocPackageText);
assert.match(service, /prisma\.downstreamContractPayment\.findMany/, 'read-only project overview must read actual downstream payment/refund records separately');
assert.match(service, /summarizeDownstreamPaymentTotals/, 'cash payment and refund summaries must use exact-cent shared logic');
assert.match(service, /downstreamCash\.scanTruncated/, 'cash summary must surface truncation rather than presenting partial totals as complete');
assert.match(service, /calculateAssistantCostVarianceSummary/, 'cost variance must delegate to the tested calculation policy');
assert.match(costVariance, /input\.targetTruncated/);
assert.match(costVariance, /input\.targetTruncated/);
assert.match(cashSummary, /centsToMoney\(paidCents - refundCents\)/, 'refund must be subtracted exactly once from net cash paid');
const toolIds = [...service.matchAll(/^  '([a-z_]+)',$/gm)].map((m) => m[1]);
assert.deepEqual(toolIds, ['project_operating_overview', 'cost_variance', 'change_evidence_completeness'], 'only the three approved read-only tools may be exposed');
assert.match(service, /canAccessProject\(actor\.sub, actor\.role, projectId, undefined, 'PROJECT_READ'\)/, 'project access must be rechecked at execution time');
assert.match(service, /externalConfirmationStatus: 'EFFECTIVE', externalConfirmedAmount: \{ not: null \}/, 'effective contract calculation must use externally effective amounts only');
assert.match(service, /prisma\.auditLog\.create/, 'tool calls must be audited');
assert.match(service, /ASSISTANT_READ_ONLY_TOOL_FAILED/, 'failed tool calls must create audit outcomes');
assert.match(service, /ASSISTANT_READ_ONLY_TOOL_SUCCEEDED/, 'successful tool calls must create audit outcomes');
assert.match(service, /changes: \{[\s\S]*?toolId: validInput\.toolId[\s\S]*?durationMs:/, 'audit payload must stay metadata-oriented');
assert.doesNotMatch(service, /changes: \{[\s\S]*?(?:prompt|apiKey|authorization|responseText|rawInput):/, 'audit payload must not store prompts, secrets or raw text');
assert.doesNotMatch(service, /prisma\.(?:project|change|budgetItem|costEntry|progressBill|downstreamContract)\.(?:create|update|upsert|delete|deleteMany|updateMany)\s*\(/, 'read-only tool service must not mutate business entities');
assert.match(assistantConfig, /function isAssistantBaseUrlValid/);
assert.match(assistantConfig, /url\.protocol === 'http:' \|\| url\.protocol === 'https:'/);
assert.match(assistantConfig, /!url\.username[\s\S]*?!url\.password[\s\S]*?!url\.search[\s\S]*?!url\.hash/);
assert.match(assistantJob, /!isAssistantBaseUrlValid\(baseURL\)/, 'invalid provider base URL must be rejected before model execution');
assert.match(assistantApi, /endpointValid: boolean/);
assert.match(assistantPage, /status\.configuration\.endpointValid === false[\s\S]*?模型兼容 API 地址格式无效/, 'UI must explain invalid endpoint without rendering the raw URL');

assert.match(routes, /z\.object\([\s\S]*?\)\.strict\(\)/, 'public PoC input schema must reject extra fields');
assert.match(routes, /preHandler: \[featureGate, authRequired\]/, 'each route must be feature-gated and authenticated');
assert.match(routes, /timeWindow: '1 minute'/, 'rate limit must be configured');
assert.deepEqual([...routes.matchAll(/app\.(get|post|put|patch|delete)\(['\"]([^'\"]+)/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`), ['GET /status', 'GET /tools', 'POST /run'], 'POC must expose only the authenticated availability probe and two gated read-only tool routes');
assert.match(routes, /app\.get\('\/status', \{ preHandler: \[authRequired\]/, 'availability probe must require authentication without opening the gated tools');
assert.doesNotMatch(routes, /(?:executeRaw|queryRaw|child_process|fetch\s*\(|axios|undici)/, 'POC route must not expose arbitrary database, command or network access');
assert.match(server, /ASSISTANT_POC_ENABLED: z\.enum\(\['true', 'false'\]\)\.default\('false'\)/, 'PoC must default disabled');
assert.match(registry, /integrationVisible: false/, 'PoC route must be hidden from integration catalog');
assert.match(piAgent, /Type\.Object\(\{\}\)/, 'Pi tools must not accept model-selected project/user ids');
assert.match(piAgent, /if \(process\.env\.ASSISTANT_POC_ENABLED !== 'true'\)/, 'Pi CLI must default disabled');
assert.match(langGraphAgent, /if \(process\.env\.ASSISTANT_POC_ENABLED !== 'true'\)/, 'LangGraph CLI must default disabled');
assert.match(langGraphAgent, /PostgresSaver\.fromConnString\(databaseUrl, \{ schema \}\)/, 'LangGraph checkpoint must use a dedicated schema');
assert.match(langGraphAgent, /tool\(async \(\) =>/, 'model tools must not accept model-supplied identity/project arguments');
assert.match(langGraphAgent, /canAccessProject\(actor\.sub, actor\.role, projectId, undefined, 'PROJECT_READ'\)/, 'agent entry must validate the assigned project before model execution');
assert.match(pgSmoke, /ASSISTANT_POC_DATABASE_URL/, 'PostgreSQL smoke test must use the explicitly isolated database variable');
assert.match(pgSmoke, /databaseUrl === process\.env\.DATABASE_URL/, 'must refuse the main business database URL');
assert.match(pgProbe, /FOR UPDATE/, 'PostgreSQL transitions must row-lock to avoid concurrent transition races');
assert.match(pgProbe, /UNIQUE\(owner_user_id, conversation_id, request_id\)/, 'Postgres submission idempotency key must be unique');
assert.match(safePath, /experiments\/pi-durable-poc\/\.data/, 'SQLite storage path must be confined to the PoC data directory or OS temp folder');
assert.match(piAgent, /assertSafePocSqlitePath/, 'Pi agent must enforce the SQLite path boundary');
assert.match(hardKillSmoke, /assertSafePocSqlitePath/, 'hard-kill smoke must enforce the SQLite path boundary');
assert.match(packageJsonText, /node scripts\/validate-assistant-poc\.mjs/, 'assistant security contract must run in the release-candidate chain');
assert.equal(pocPackage.dependencies['@langchain/core'], '1.2.18', 'Pi Durable PoC must align @langchain/core with langchain@1.5.18 peer requirements');
assert.equal(pocPackage.devDependencies?.vitest, '5.0.5', 'Vitest must be an explicit, pinned development dependency of the PoC');
assert.match(pocPackage.scripts.test, /vitest run test\/pi-durable-storage-conformance\.test\.ts/, 'full PoC suite must include the official storage conformance test');
assert.match(packageJson.scripts['test:pi-poc'], /npm test --prefix experiments\/pi-durable-poc/, 'root workspace must expose the standalone Pi Durable PoC test command');
assert.match(workflow, /npm ci --prefix experiments\/pi-durable-poc/, 'CI must use the committed standalone PoC lockfile');
assert.match(workflow, /package-lock\.json/, 'CI must fail clearly if the standalone PoC lockfile is absent');
assert.match(packageJsonText, /node scripts\/validate-assistant-runtime-decision\.mjs/, 'runtime/storage decision invariants must run in the release-candidate chain');
assert.match(decision, /采用 \*\*LangGraph\.js \+ PostgreSQL `PostgresSaver`\*\*/, 'runtime decision must be explicit');
assert.match(decision, /默认每次模型请求最多生成 1,800 tokens/);
assert.match(decision, /超时为 45 秒/);
assert.match(decision, /最多进行 1 次 SDK 重试/);
assert.match(decision, /不构成生产启用批准/, 'runtime decision must not imply production approval');
assert.match(decision, /ASSISTANT_POC_ENABLED=true/, 'decision must explicitly keep the PoC switch out of production');

console.log(JSON.stringify({
  gate: 'ASSISTANT_POC_STATIC_SECURITY_CONTRACT',
  result: 'PASS',
  assertions: 40,
  toolIds,
  caveat: 'Static contract checks only; not a substitute for TypeScript build, app integration tests, or live authorization against PostgreSQL.',
}, null, 2));
