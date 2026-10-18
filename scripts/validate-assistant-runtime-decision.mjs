import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const [decision, acceptance, rootPackage, apiPackage, webPackage, server, routes, registry, releaseScript] = await Promise.all([
  read('docs/AI助手实施与准入.md'),
  read('docs/后续四阶段开发路线图.md'),
  read('package.json').then(JSON.parse),
  read('apps/api/package.json').then(JSON.parse),
  read('apps/web/package.json').then(JSON.parse),
  read('apps/api/src/server.ts'),
  read('apps/api/src/routes/assistant-poc.ts'),
  read('apps/api/src/platform/module-registry.ts'),
  read('package.json'),
]);

assert.equal(rootPackage.version, apiPackage.version, 'root/API versions must match');
assert.equal(rootPackage.version, webPackage.version, 'root/Web versions must match');
assert.match(server, /ASSISTANT_POC_ENABLED: z\.enum\(\['true', 'false'\]\)\.default\('false'\)/, 'server-side PoC flag must default to off');
assert.match(routes, /if \(process\.env\.ASSISTANT_POC_ENABLED !== 'true'\)/, 'PoC route must be hidden unless explicitly enabled');
assert.match(routes, /preHandler: \[featureGate, authRequired\]/, 'PoC endpoints must require auth and feature gate');
assert.match(registry, /id: 'assistant-poc'[\s\S]*?integrationVisible: false/, 'assistant PoC must stay hidden from the public integration catalog');
assert.match(decision, /LangGraph\.js \+ PostgreSQL `PostgresSaver`/, 'the adopted next-stage runtime/storage path must be documented');
assert.match(decision, /不构成生产启用批准/, 'runtime choice must not grant production approval');
assert.match(decision, /BackgroundJob/, 'long-running assistant runs must remain inside the PostgreSQL job boundary');
assert.match(decision, /canAccessProject/, 'runtime integration must preserve server-side project authorization');
assert.match(acceptance, /阶段三：完成 AI 助手的产品闭环/, 'assistant implementation must remain a defined development phase');
assert.match(acceptance, /阶段四：统一回归、整理交付与发布评审/, 'release readiness and regression must be a separate phase');
assert.match(decision, /六张业务表零变化/, 'business-table no-write regression must remain a hard gate');
assert.match(releaseScript, /node scripts\/validate-assistant-poc\.mjs[\s\S]*?node scripts\/validate-assistant-runtime-decision\.mjs/, 'both assistant gates must execute in the release validation script');

console.log(JSON.stringify({
  gate: 'ASSISTANT_RUNTIME_STORAGE_DECISION_CONTRACT',
  result: 'PASS',
  assertions: 13,
  runtime: 'LangGraph.js + PostgreSQL PostgresSaver (next-stage candidate only)',
  productionEnabled: false,
  note: 'Static contract validation; does not test provider execution, PostgreSQL, session APIs, SSE, UI or production readiness.',
}, null, 2));
