import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const [rootPackage, apiPackage, webPackage, thread, page, apiClient, workspace, routes, serverRoutes, toolAdapter, css, changelog, readme, designDoc, listRoutes] = await Promise.all([
  read('package.json').then(JSON.parse),
  read('apps/api/package.json').then(JSON.parse),
  read('apps/web/package.json').then(JSON.parse),
  read('apps/web/src/components/assistant/AssistantThread.tsx'),
  read('apps/web/src/pages/CostAssistantPage.tsx'),
  read('apps/web/src/assistant-api.ts'),
  read('apps/web/src/components/CostWorkspaceLayout.tsx'),
  read('apps/web/src/App.tsx'),
  read('apps/api/src/routes/assistant-poc.ts'),
  read('apps/api/src/assistant/runtime/langgraph-adapter.ts'),
  read('apps/web/src/styles.css'),
  read('CHANGELOG.md'),
  read('README.md'),
  read('docs/assistant-ui-integration-v1.0.md'),
  read('apps/api/src/routes/assistant-conversations.ts'),
]);
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

check(rootPackage.version === apiPackage.version && rootPackage.version === webPackage.version, 'root/API/Web candidate versions must match');
check(webPackage.dependencies['@assistant-ui/react'] === '0.15.29', 'assistant-ui React must be exactly pinned');
check(webPackage.dependencies['@assistant-ui/react-markdown'] === '0.14.23', 'assistant-ui markdown must be exactly pinned');
check(webPackage.dependencies['remark-gfm'] === '4.0.1', 'GitHub-flavored Markdown plugin must be exactly pinned');
check(thread.includes('useExternalStoreRuntime') && thread.includes('AssistantRuntimeProvider'), 'chat controls must use assistant-ui with an external/custom runtime');
check(thread.includes('ThreadPrimitive.Messages') && thread.includes('ComposerPrimitive.Input') && thread.includes('ComposerPrimitive.Cancel'), 'thread, composer and cancel primitives must be wired');
check(thread.includes('MarkdownTextPrimitive') && thread.includes('remarkGfm'), 'message rendering must support safe Markdown and tables');
check(thread.includes('native.isComposing') && thread.includes('native.keyCode === 229'), 'CJK IME composition guard must prevent accidental Enter submit');
check(thread.includes('submitAssistantMessage') && thread.includes('cancelAssistantRun'), 'send/cancel must call MoHeng APIs, not mock responses');
check(!thread.includes('Hello, world!') && !thread.includes('setTimeout(resolve'), 'production UI must not contain demo reply behavior');
check(apiClient.includes("'/assistant-poc'") && apiClient.includes('listAssistantConversations') && apiClient.includes('archiveAssistantConversation'), 'custom client must use existing MoHeng conversation APIs');
check(apiClient.includes("'Last-Event-ID'") && apiClient.includes("headers.set('Authorization'") && apiClient.includes('api.refreshSession()'), 'SSE must support auth and durable cursor resume');
check(apiClient.includes('event.sequence <= cursor') && apiClient.includes("event.type !== 'access.revoked'"), 'SSE event duplicates must be ignored while unsequenced security terminal events remain visible');
check(page.includes('selectedProjectId') && page.includes('projectDetail = detail?.projectId === selectedProjectId') && page.includes('selectedProjectRef.current !== runProjectId'), 'UI and streamed events must be bound to the active project and not display a prior-project conversation');
check(page.includes("includeArchived ? '隐藏已归档' : '同时显示已归档'"), 'archive toggle copy must match its include-archived behavior');
check(page.includes('getAssistantStatus') && page.includes('if (!featureEnabled)'), 'direct route must fail closed when assistant is disabled');
check(page.includes("conversation.runs[0]") && page.includes('watchRun(conversation.id, latestRun.id, conversation.projectId)'), 'reopening a completed conversation must replay the latest run events for source metadata');
check(page.includes('source.fields.join') && page.includes('tool.limitations'), 'source/limitation panel must use server-returned event metadata');
check(workspace.includes("api.get<{ enabled: boolean }>('/assistant-poc/status')") && workspace.includes('{assistantEnabled &&'), 'assistant navigation must stay hidden unless enabled');
check(routes.includes("const CostAssistantPage = lazy(() => import('./pages/CostAssistantPage'))") && routes.includes('path="assistant"'), 'assistant page must be lazy-loaded under /cost/assistant');
check(serverRoutes.includes("app.get('/status'") && serverRoutes.includes('preHandler: [authRequired]'), 'status endpoint must require an authenticated user');
check(!serverRoutes.includes("app.get('/status', { preHandler: [featureGate, authRequired]"), 'disabled state probe must work without exposing gated tools');
check(toolAdapter.includes('sources: result.sources.map') && toolAdapter.includes('limitations: result.limitations'), 'backend tool event must persist compact structured source metadata');
check(listRoutes.includes('async (request, reply)') && listRoutes.includes('parsedQuery.data.projectId ? { projectId: parsedQuery.data.projectId }'), 'conversation list validation must return a safe error and filter by server query project scope');
check(css.includes('.assistant-markdown table') && css.includes('.assistant-composer-input-wrap'), 'custom theme must style Markdown tables and composer');
check(!webPackage.dependencies['@assistant-ui/react-langgraph'], 'custom persisted SSE transport must not be coupled to LangGraph SDK wire format');
check(designDoc.includes('运行时必须保持可替换') && designDoc.includes('PostgresSaver') && designDoc.includes('不证明 Pi Durable 自带 PostgreSQL adapter'), 'UI decision must preserve swappable runtime and original storage boundaries');
check(designDoc.includes('open-claude-ui') && designDoc.includes('不复制 Claude 商标/品牌文案'), 'UI inspiration must document license/source and clean-room boundaries');
const changelogVersionMatches = changelog.startsWith('## v' + rootPackage.version);
const readmeVersionMatches = readme.includes(rootPackage.version);
check(changelogVersionMatches, 'CHANGELOG must start with current candidate version; expected=## v' + rootPackage.version + ', actual=' + JSON.stringify(changelog.slice(0, 70)));
check(readmeVersionMatches, 'README must mention current candidate version; expected=' + rootPackage.version + ', found=' + readme.includes(rootPackage.version));
check(apiClient.includes('parseAssistantSseBlock') && apiClient.includes('assistant-sse-parser.mjs'), 'SSE parser must be an isolated pure module');
check(rootPackage.scripts['validate:release-candidate'].includes('assistant-sse-parser.test.mjs'), 'pure SSE parser unit tests must run in the release validation chain');
check(rootPackage.scripts['validate:release-candidate'].includes('validate-assistant-ui.mjs'), 'assistant UI Gate must run during release candidate validation');

console.log(JSON.stringify({
  gate: 'ASSISTANT_UI_WORKBENCH_STATIC_CONTRACT',
  result: 'PASS',
  assertions,
  ui: '@assistant-ui/react external-store runtime + MoHeng custom REST/SSE',
  inspirations: ['assistant-ui primitives/runtime', 'open-claude-ui general CJK/scroll interaction patterns'],
  productionEnabled: false,
  caveat: 'Static contract validation only; not npm install, TypeScript build, browser rendering, API/DB integration or model end-to-end test.',
}, null, 2));
