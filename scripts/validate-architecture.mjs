import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checks = [];
async function read(relative) { return readFile(join(root, relative), 'utf8'); }
function check(name, condition, details = '') { checks.push({ name, passed: Boolean(condition), details }); }

const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const server = await read('apps/api/src/server.ts');
const appInfo = await read('apps/api/src/platform/app-info.ts');
const registry = await read('apps/api/src/platform/module-registry.ts');
const envExample = await read('apps/api/.env.example');
const existingRouteFiles = (await readdir(join(root, 'apps/api/src/routes'))).filter((name) => name.endsWith('.ts'));
const systemManagementRoutesSource = await read('apps/api/src/routes/system-management.ts');
const assistantPocRoutesSource = await read('apps/api/src/routes/assistant-poc.ts');
const integratedRouteFiles = new Set(['assistant-conversations.ts']);

check('workspace/API/UI version and runtime metadata agree on the current candidate',
  rootPackage.version === apiPackage.version && webPackage.version === rootPackage.version &&
  appInfo.includes(`APP_VERSION = '${rootPackage.version}'`) && server.includes('version: APP_VERSION'));
check('module registry is the only server-side route registration entry point',
  server.includes('await registerApiModules(app)') && registry.includes('export async function registerApiModules') &&
  !/app\.register\(\w+Routes,\s*\{\s*prefix:/.test(server));
check('all API route plugins are represented in the registry',
  existingRouteFiles.every((file) => registry.includes(`../routes/${file.replace(/\.ts$/, '.js')}`) || (file === 'system-config.ts' && systemManagementRoutesSource.includes('systemConfigRoutes')) || (integratedRouteFiles.has(file) && assistantPocRoutesSource.includes('assistantConversationRoutes(app)'))),
  existingRouteFiles.filter((file) => !registry.includes(`../routes/${file.replace(/\.ts$/, '.js')}`) && !(file === 'system-config.ts' && systemManagementRoutesSource.includes('systemConfigRoutes')) && !(integratedRouteFiles.has(file) && assistantPocRoutesSource.includes('assistantConversationRoutes(app)'))).join(', '));
const moduleIds = [...registry.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]);
// 原先这里硬编码 19 / 16 两个数，模块从 19 增到 21（workspace、project-artifacts）后
// 门禁一直红着——新增模块的人没同步魔法数，而门禁不在 CI 也没人看见。
// 改判为不随模块数漂移的结构不变量：模块条目数 == 顶层路由插件数（内联挂载者除外）；
// 每个条目都声明 mountPrefix 与 integrationVisible；“不上集成目录”的集合必须与显式登记名单一致，
// 新增隐藏模块必须在这里加一行，而不是靠总数对不上。
const inlineMountedRouteFiles = new Set(['system-config.ts', ...integratedRouteFiles]);
const routePluginCount = existingRouteFiles.filter((file) => !inlineMountedRouteFiles.has(file)).length;
const INTEGRATION_HIDDEN_MODULE_IDS = ['assistant-poc', 'project-artifacts', 'system-config-read', 'system-management', 'workspace'];
const hiddenIds = registry.split(/\r?\n/)
  .filter((line) => line.includes('integrationVisible: false'))
  .map((line) => (line.match(/\{ id: '([^']+)'/) ?? [])[1])
  .filter(Boolean)
  .sort();
check('module catalog has unique stable IDs and one entry per registered route plugin',
  moduleIds.length > 0 && new Set(moduleIds).size === moduleIds.length && moduleIds.length === routePluginCount,
  `module IDs: ${moduleIds.length}, route plugins: ${routePluginCount}`);
const mountPrefixCount = (registry.match(/mountPrefix: '\/api/g) ?? []).length;
const visibilityDeclarations = (registry.match(/integrationVisible: (?:true|false)/g) ?? []).length;
check('all module registrations declare mount prefix and integration visibility, while admin-only modules stay off the integration catalog',
  mountPrefixCount === moduleIds.length && visibilityDeclarations === moduleIds.length && hiddenIds.join(',') === [...INTEGRATION_HIDDEN_MODULE_IDS].sort().join(','),
  `mountPrefix=${mountPrefixCount}/${moduleIds.length}, visibility=${visibilityDeclarations}/${moduleIds.length}, hidden=[${hiddenIds.join(', ')}]`);
check('module catalog exposes descriptive metadata without requiring extra services',
  registry.includes('export function getApiModuleCatalog') && registry.includes('integrationVisible') &&
  server.includes("app.get('/api/meta'") && server.includes('apiMajorVersion: API_MAJOR_VERSION'));
check('liveness does not depend on PostgreSQL and readiness checks database access',
  server.includes("app.get('/health/live'") && server.includes("app.get('/health/ready', readinessHandler)") &&
  server.includes("app.get('/health', readinessHandler)") && server.includes('await prisma.$queryRaw`SELECT 1`'));
check('existing API prefix remains compatible and correlation ID is returned',
  server.includes("apiBasePath: '/api'") && server.includes("reply.header('x-request-id', request.id)") &&
  server.includes('compatibilityPolicy'));
check('production CORS does not default to development localhost origins',
  server.includes("env.NODE_ENV === 'development' ? 'http://localhost:5173' : ''") &&
  envExample.includes('CORS_ORIGIN=') && !/^CORS_ORIGIN=http:\/\/localhost/m.test(envExample));
check('server logs redact authentication and secret fields',
  server.includes('req.headers.authorization') && server.includes('req.headers.cookie') &&
  server.includes('req.body.password') && server.includes("censor: '[REDACTED]'"));
check('no new always-on cache/broker dependency added',
  !('redis' in (apiPackage.dependencies ?? {})) && !('bullmq' in (apiPackage.dependencies ?? {})) &&
  !('ioredis' in (apiPackage.dependencies ?? {})));

const failed = checks.filter((item) => !item.passed);
for (const item of checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.details ? ` — ${item.details}` : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} architecture checks passed`);
if (failed.length) process.exit(1);
