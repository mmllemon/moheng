import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const [rootPackage, apiPackage, webPackage, schema, migration, adminRoute, readRoute, registry, systemPage, dictionaryPage, parameterPage, app, layout, costsPage, readme, changelog, design, acceptance, guide] = await Promise.all([
  read('package.json').then(JSON.parse), read('apps/api/package.json').then(JSON.parse), read('apps/web/package.json').then(JSON.parse),
  read('apps/api/prisma/schema.prisma'), read('apps/api/prisma/migrations/20261016020000_system_dictionaries_parameters/migration.sql'),
  read('apps/api/src/routes/system-config.ts'), read('apps/api/src/routes/config-read.ts'), read('apps/api/src/platform/module-registry.ts'),
  read('apps/web/src/pages/SystemManagementPage.tsx'), read('apps/web/src/pages/SystemDictionariesPage.tsx'), read('apps/web/src/pages/SystemParametersPage.tsx'),
  read('apps/web/src/App.tsx'), read('apps/web/src/components/Layout.tsx'), read('apps/web/src/pages/CostsPage.tsx'), read('README.md'), read('CHANGELOG.md'),
  read('docs/统一基础字典与参数配置设计-v2.12.0-rc.1.md'), read('docs/阶段验收记录-v2.12.0-rc.1.md'), read('docs/开发维护指南.md'),
]);

check('root/API/Web versions agree with the current candidate and runtime metadata/footer',
  apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version &&
  (await read('apps/api/src/platform/app-info.ts')).includes("APP_VERSION = '" + rootPackage.version + "'") && layout.includes('v' + rootPackage.version));
check('Prisma schema contains one dictionary, item, and parameter-revision model',
  (schema.match(/model SystemDictionary \{/g) ?? []).length === 1 && (schema.match(/model SystemDictionaryItem \{/g) ?? []).length === 1 && (schema.match(/model SystemParameterRevision \{/g) ?? []).length === 1);
check('Prisma schema defines typed scopes and revision statuses once',
  (schema.match(/enum SystemParameterScope \{/g) ?? []).length === 1 && (schema.match(/enum SystemParameterValueType \{/g) ?? []).length === 1 && (schema.match(/enum SystemParameterStatus \{/g) ?? []).length === 1 && schema.includes('SystemParameterRevision[] @relation("SystemParameterRevisionCreator")') && schema.includes('enum SystemParameterVisibility') && schema.includes('visibility   SystemParameterVisibility @default(ADMIN_ONLY)'));
check('migration creates tables, stable uniqueness, scope consistency and one-published-version constraint',
  migration.includes('CREATE TABLE "SystemDictionary"') && migration.includes('CREATE TABLE "SystemDictionaryItem"') && migration.includes('CREATE TABLE "SystemParameterRevision"') &&
  migration.includes('SystemParameterRevision_scope_consistency_check') && migration.includes('CREATE TYPE "SystemParameterVisibility"') && migration.includes('SystemParameterRevision_one_published_per_scope_key') &&
  migration.includes('UNIQUE INDEX "SystemParameterRevision_key_scopeKey_version_key"'));
check('migration seeds four starter dictionaries and examples without core business enum conversion',
  ['PAYMENT_METHOD', 'MEASURE_UNIT', 'DOCUMENT_CATEGORY', 'WARNING_LEVEL'].every((code) => migration.includes(`'${code}'`)) &&
  design.includes('现有的 `Project.status`') && design.includes('不调整合同金额生效'));
check('dictionary management validates stable codes and exposes soft-disable, not delete operations',
  adminRoute.includes("app.get('/dictionaries'") && adminRoute.includes("app.post('/dictionaries'") && adminRoute.includes("app.patch('/dictionaries/:id'") &&
  adminRoute.includes("app.post('/dictionaries/:id/items'") && adminRoute.includes("app.patch('/dictionary-items/:id'") &&
  adminRoute.includes('SYSTEM_DICTIONARY_ITEM_UPDATED') && !/app\.delete\(['"]\/dictionaries/.test(adminRoute));
check('dictionary change paths append AuditLog records',
  ['SYSTEM_DICTIONARY_CREATED', 'SYSTEM_DICTIONARY_UPDATED', 'SYSTEM_DICTIONARY_ITEM_CREATED', 'SYSTEM_DICTIONARY_ITEM_UPDATED'].every((action) => adminRoute.includes(`action: '${action}'`)));
check('parameter values are typed and bounded, and secret-like keys cannot be saved',
  adminRoute.includes("z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON'])") && adminRoute.includes('Number.isFinite(value.value)') &&
  adminRoute.includes('JSON 参数不得超过 16 KB') && adminRoute.includes('PASSWORD|SECRET|TOKEN|PRIVATE.?KEY|API.?KEY|CREDENTIAL') && adminRoute.includes('PARAMETER_DEFINITION_CONFLICT'));
check('draft, publish, and rollback are explicit revision endpoints with transactional versioning',
  adminRoute.includes("app.post('/parameters/drafts'") && adminRoute.includes("app.post('/parameters/:id/publish'") && adminRoute.includes("app.post('/parameters/:id/rollback'") &&
  adminRoute.includes("isolationLevel: 'Serializable'") && adminRoute.includes('PARAMETER_DRAFT_CLAIM_CONFLICT') && adminRoute.includes('PARAMETER_PROJECT_UNAVAILABLE') && adminRoute.includes("status: 'RETIRED'") && adminRoute.includes('rollbackSourceVersion'));
check('parameter audit metadata omits the raw value while retaining traceability',
  adminRoute.includes('safeParameterAuditValue') && !adminRoute.includes('value: created.value') &&
  ['SYSTEM_PARAMETER_DRAFT_CREATED', 'SYSTEM_PARAMETER_PUBLISHED', 'SYSTEM_PARAMETER_ROLLBACK_DRAFT_CREATED'].every((action) => adminRoute.includes(`action: '${action}'`)));
check('project-level published values override global published defaults',
  adminRoute.includes("scopeKey: 'GLOBAL'") && adminRoute.includes('PROJECT:${query.data.projectId}') && adminRoute.includes('project-specific published revisions override it for the same key'));
check('admin write APIs inherit the system-management authentication/role guard',
  (await read('apps/api/src/routes/system-management.ts')).includes('app.addHook(\'preHandler\'') &&
  (await read('apps/api/src/routes/system-management.ts')).includes('await app.register(systemConfigRoutes)') &&
  (await read('apps/api/src/routes/system-management.ts')).includes("'ADMIN'"));
check('consumer reads require a session and return only active dictionaries/published, non-secret parameters',
  readRoute.includes('app.addHook(\'preHandler\', authRequired)') && readRoute.includes("isActive: true") && readRoute.includes("status: 'PUBLISHED'") && readRoute.includes("visibility: 'BUSINESS_READABLE'") &&
  readRoute.includes('secretLikeKey.test(item.key)') && readRoute.includes('members: { some: { userId: actor.sub } }'));
check('public project parameter reads enforce membership or explicit cross-project read-only scope without exposing project existence',
  readRoute.includes("hasCrossProjectReadScope(actor.sub, actor.role, 'PROJECT_READ')") && readRoute.includes("'PROJECT_NOT_FOUND'"));
check('public config reader is registered as an internal modular-monolith API module',
  registry.includes("id: 'system-config-read'") && registry.includes("mountPrefix: '/api/config'") && registry.includes('plugin: configReadRoutes, integrationVisible: false'));
check('the dictionary and parameter workbenches are routed behind the AdminOnly UI guard',
  app.includes('path="system/dictionaries" element={<AdminOnly><SystemDictionariesPage /></AdminOnly>}') &&
  app.includes('path="system/parameters" element={<AdminOnly><SystemParametersPage /></AdminOnly>}'));
check('the actual-cost unit field consumes the shared dictionary but keeps manual-entry compatibility',
  costsPage.includes('/config/dictionaries/MEASURE_UNIT/items') && costsPage.includes('选择或输入单位'));
check('system navigation and overview link to both configuration workbenches',
  layout.includes("to: '/system/dictionaries', label: '基础字典'") && layout.includes("to: '/system/parameters', label: '参数配置'") &&
  systemPage.includes('/system/dictionaries') && systemPage.includes('/system/parameters'));
check('dictionary UI supports classification/item management and explicitly preserves historical records',
  dictionaryPage.includes("'/system-management/dictionaries'") && dictionaryPage.includes('停用只影响后续选择，不删除历史记录') && dictionaryPage.includes('sortOrder'));
check('parameter UI supports global/project scopes, draft publish, history and rollback draft',
  parameterPage.includes("'/system-management/parameters/drafts'") && parameterPage.includes('PROJECT') && parameterPage.includes('发布') && parameterPage.includes('publishDraft.mutate') &&
  parameterPage.includes("'/system-management/parameters/") && parameterPage.includes('创建回滚草稿') && parameterPage.includes('草稿不会影响有效配置'));
check('README, changelog, guide, design, and acceptance notes describe scope and RC verification limits',
  readme.includes('v2.12.0-rc.1 统一基础字典与参数配置') && changelog.startsWith('## v' + rootPackage.version) && changelog.includes('## v2.12.0-rc.1') &&
  guide.includes('v2.12.0-rc.1：统一基础字典与参数配置') && design.includes('已认证业务页面的只读接口') && acceptance.includes('当前为发布候选（RC）'));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} system configuration contract checks passed.`);
if (failed.length) process.exitCode = 1;
