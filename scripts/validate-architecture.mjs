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

check('workspace/API/UI version and runtime metadata agree on 2.5.0-rc.1',
  rootPackage.version === '2.5.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version &&
  appInfo.includes("APP_VERSION = '2.5.0-rc.1'") && server.includes('version: APP_VERSION'));
check('module registry is the only server-side route registration entry point',
  server.includes('await registerApiModules(app)') && registry.includes('export async function registerApiModules') &&
  !/app\.register\(\w+Routes,\s*\{\s*prefix:/.test(server));
check('all API route plugins are represented in the registry',
  existingRouteFiles.every((file) => registry.includes(`../routes/${file.replace(/\.ts$/, '.js')}`)),
  existingRouteFiles.filter((file) => !registry.includes(`../routes/${file.replace(/\.ts$/, '.js')}`)).join(', '));
const moduleIds = [...registry.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]);
check('module catalog has unique stable IDs and the expected 16 registered modules',
  moduleIds.length === 16 && new Set(moduleIds).size === moduleIds.length, `module IDs found: ${moduleIds.length}`);
check('module registrations declare an API mount prefix and integration visibility',
  (registry.match(/mountPrefix: '\/api/g) ?? []).length === 16 && (registry.match(/integrationVisible: true/g) ?? []).length === 16);
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
