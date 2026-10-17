import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const checks = [];
function verify(name, assertion) {
  assertion();
  checks.push(name);
}

const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const auth = await read('apps/api/src/lib/auth.ts');
const pocRoute = await read('apps/api/src/routes/assistant-poc.ts');
const conversations = await read('apps/api/src/routes/assistant-conversations.ts');
const systemRoutes = await read('apps/api/src/routes/system-management.ts');
const regressionTest = await read('apps/api/src/lib/auth-prehandler-regression.test.ts');
const server = await read('apps/api/src/server.ts');
const policiesPage = await read('apps/web/src/pages/SystemPoliciesPage.tsx');
const uiComponents = await read('apps/web/src/components/Ui.tsx');
const ciGateDoc = await read('docs/assistant-runtime-ci-gates-v1.0.md');

verify('JWT plugin patched version', () => assert.equal(apiPackage.dependencies['@fastify/jwt'], '10.2.4'));
verify('static plugin patched version', () => assert.equal(apiPackage.dependencies['@fastify/static'], '10.1.6'));
verify('Swagger UI 6 removes vulnerable nested static tree', () => assert.equal(apiPackage.dependencies['@fastify/swagger-ui'], '6.1.2'));
verify('Fastify patched version', () => assert.equal(apiPackage.dependencies.fastify, '5.12.7'));
verify('React Router patched v6 dependency pin', () => assert.equal(webPackage.dependencies['react-router-dom'], '6.30.6'));
verify('Prisma Client is pinned to the Prisma 7 target', () => assert.equal(apiPackage.dependencies['@prisma/client'], '7.10.1'));
verify('Prisma CLI is pinned to the matching Prisma 7 target', () => assert.equal(apiPackage.devDependencies.prisma, '7.10.1'));

const authStart = auth.indexOf('export const authRequired:');
const authBlock = auth.slice(authStart, auth.indexOf('\n};', authStart));
verify('all six auth rejection paths explicitly send 401', () => assert.equal((authBlock.match(/return reply\.code\(401\)\.send\(failure\(reply, 401,/g) ?? []).length, 6));
verify('auth preHandler has no non-terminating 401 returns', () => assert.doesNotMatch(authBlock, /return failure\(reply, 401,/));
for (const [name, source] of [['assistant-poc', pocRoute], ['assistant-conversations', conversations]]) {
  verify(`${name} feature gate explicitly sends 404`, () => assert.match(source, /return reply\.code\(404\)\.send\(failure\(reply, 404, 'ROUTE_NOT_FOUND'/));
}
verify('system-management unauthenticated requests explicitly send 401', () => assert.match(systemRoutes, /if \(!request\.user\) return reply\.code\(401\)\.send\(failure\(reply, 401, 'UNAUTHORIZED'/));
verify('system-management non-admin requests explicitly send 403', () => assert.match(systemRoutes, /return reply\.code\(403\)\.send\(failure\(reply, 403, 'ADMIN_REQUIRED'/));

verify('authorization-review create includes creator relation', () => assert.match(systemRoutes, /systemAuthorizationReview\.create\(\{[\s\S]*?include: \{ createdBy: \{ select: \{ id: true, name: true, email: true \} \} \}/));
verify('authorization-review response uses loaded createdBy relation', () => assert.match(systemRoutes, /createdBy: created\.createdBy/));
verify('authorization-review response does not read name from AuthUser', () => assert.doesNotMatch(systemRoutes, /authUser\(request\)\.name/));
verify('department ancestor query snapshots cursor as string', () => assert.match(systemRoutes, /const cursorId: string = cursor;/));
verify('department ancestor query uses explicitly typed cursor snapshot', () => assert.match(systemRoutes, /where: \{ id: cursorId \}, select: \{ id: true, parentId: true, isActive: true \}/));

verify('SystemPoliciesPage uses ErrorBlock message prop', () => assert.match(policiesPage, /<ErrorBlock message=\{loadError instanceof Error \? loadError\.message : String\(loadError\)\}/));
verify('SystemPoliciesPage uses ErrorBlock retry prop', () => assert.match(policiesPage, /retry=\{\(\) => \{ void accessQuery\.refetch\(\); void workflowQuery\.refetch\(\); void rulesQuery\.refetch\(\); \}\}/));
verify('SystemPoliciesPage no longer uses invalid ErrorBlock props', () => assert.doesNotMatch(policiesPage, /<ErrorBlock error=\{loadError\} onRetry=/));
verify('ErrorBlock component contract remains message/retry', () => assert.match(uiComponents, /export function ErrorBlock\(\{ message, retry \}: \{ message: string; retry\?: \(\) => void \}\)/));
verify('Fastify unknown error is safely narrowed', () => assert.match(server, /error instanceof Error \? error\.message : String\(error\)/));

for (const [pkg, version] of Object.entries({
  '@prisma/client': '7.10.1',
  '@prisma/engines': '7.10.1',
  '@tailwindcss/oxide': '4.1.13',
  esbuild: '0.25.12',
  prisma: '7.10.1',
})) {
  verify(`${pkg} install script allowlist is exact-version pinned`, () => assert.equal(rootPackage.allowScripts[`${pkg}@${version}`], true));
}
verify('protobufjs install script remains denied', () => assert.equal(rootPackage.allowScripts['protobufjs@7.6.6'], false));
verify('ExcelJS unzipper override removes binary/buffers chain', () => assert.equal(rootPackage.overrides.exceljs.unzipper, '0.12.3'));
verify('release-candidate command runs source-completeness preflight', () => assert.match(rootPackage.scripts['validate:release-candidate'], /validate-source-bundle-completeness\.mjs/));
verify('release-candidate command runs R7 static contract', () => assert.match(rootPackage.scripts['validate:release-candidate'], /validate-r7-security-remediation\.mjs/));
verify('API test command includes auth preHandler regression test', () => assert.match(apiPackage.scripts.test, /auth-prehandler-regression\.test\.ts/));
verify('auth regression test asserts handler is not called after denial', () => assert.match(regressionTest, /handlerCalls, 0/));
verify('POC-off regression test covers 404 gate', () => assert.match(regressionTest, /ASSISTANT_POC_ENABLED=false sends ROUTE_NOT_FOUND/));
verify('CI documentation marks old lock SHA historical and expects regeneration', () => assert.match(ciGateDoc, /旧基线锁文件 SHA-256 `F31A4B2E…` 仅作为升级前的历史证据[\s\S]*?新锁文件 SHA 预期会变化/));

console.log(JSON.stringify({
  gate: 'R7_SECURITY_REMEDIATION_STATIC_CONTRACT',
  result: 'PASS',
  assertions: checks.length,
  checks,
  notCovered: [
    'root package-lock presence/hash is checked by validate-source-bundle-completeness.mjs',
    'npm audit after dependency resolution',
    'full runtime regression on Node 24',
    'Prisma 7 runtime compatibility and isolated PostgreSQL migration require CI/runtime execution',
  ],
}, null, 2));
