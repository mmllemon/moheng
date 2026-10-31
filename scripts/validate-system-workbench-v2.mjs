import { readFile } from 'node:fs/promises';
import { readModuleSources } from './lib/module-sources.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const [rootPackage, apiPackage, webPackage, appInfo, schema, migration, systemRoute, page, app, layout, css, dictPage, paramPage, helper, governance, manager, readme, changelog, design, acceptance] = await Promise.all([
  read('package.json').then(JSON.parse), read('apps/api/package.json').then(JSON.parse), read('apps/web/package.json').then(JSON.parse),
  read('apps/api/src/platform/app-info.ts'), read('apps/api/prisma/schema.prisma'), read('apps/api/prisma/migrations/20261016030000_system_authorization_reviews/migration.sql'),
  readModuleSources(root, 'apps/api/src/routes/system-management.ts'), read('apps/web/src/pages/SystemAuthorizationPage.tsx'), read('apps/web/src/App.tsx'), readModuleSources(root, 'apps/web/src/components/Layout.tsx'),
  read('apps/web/src/styles.css'), read('apps/web/src/pages/SystemDictionariesPage.tsx'), read('apps/web/src/pages/SystemParametersPage.tsx'), read('apps/web/src/utils/code-suggestion.ts'),
  read('apps/web/src/pages/SystemGovernancePage.tsx'), read('apps/web/src/pages/SystemManagementPage.tsx'), read('README.md'), read('CHANGELOG.md'),
  read('docs/架构与核心业务规则.md'), read('docs/产品范围与当前状态.md'),
]);

check('root/API/Web/runtime version metadata agree on the current candidate', apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes(`APP_VERSION = '${rootPackage.version}'`));
check('new authorization review schema and additive migration are registered with audit fields and constraints', schema.includes('model SystemAuthorizationReview {') && schema.includes('enum AuthorizationReviewStatus {') && migration.includes('CREATE TABLE "SystemAuthorizationReview"') && migration.includes('SystemAuthorizationReview_review_state_check') && migration.includes('SystemAuthorizationReview_createdById_fkey') && migration.includes('SystemAuthorizationReview_reviewedById_fkey'));
check('all authorization governance API routes are registered behind session and ADMIN guard', systemRoute.includes("app.addHook('preHandler', authRequired)") && systemRoute.includes("app.addHook('preHandler', async (request, reply)") && systemRoute.includes("authUser(request).role !== 'ADMIN'") && ["/authorization/matrix", "/authorization-reviews", "/authorization-reviews/:id", "/authorization-reviews/:id/complete"].every((path) => systemRoute.includes(path)));
check('authorization matrix documents company/project roles, modules and cross-project scopes', systemRoute.includes('companyRoles:') && systemRoute.includes('projectRoles:') && systemRoute.includes('modules:') && systemRoute.includes('scopeRules:') && systemRoute.includes('editable: false'));
check('authorization matrix reflects actual published change-approval policy and fails closed on invalid policy', systemRoute.includes("where: { ruleKey: 'CHANGE_APPROVAL', status: 'PUBLISHED' }") && systemRoute.includes('parseChangeApprovalDefinition(publishedApprovalRule.definition)') && systemRoute.includes('DEFAULT_CHANGE_APPROVER_ROLES') && systemRoute.includes("approvalSource = !publishedApprovalRule ? 'BUILT_IN_DEFAULT' : parsedApprovalRule ? 'PUBLISHED' : 'INVALID'"));
check('authorization snapshot is point-in-time and audited on create and review completion', systemRoute.includes("isolationLevel: 'RepeatableRead'") && systemRoute.includes('AUTHORIZATION_REVIEW_CREATED') && systemRoute.includes('AUTHORIZATION_REVIEW_COMPLETED') && systemRoute.includes("status: 'PENDING'") && systemRoute.includes("status: 'REVIEWED'"));
check('authorization snapshot truncation avoids false zero-grant/no-owner inference', systemRoute.includes('MEMBERSHIP_SNAPSHOT_TRUNCATED') && systemRoute.includes('usersTruncated && !membershipsTruncated') && systemRoute.includes('if (!membershipsTruncated && !projectsTruncated)') && page.includes('未完整计算'));
check('authorization review page is admin-routed and renders role matrix, module boundaries and snapshot history', app.includes('path="system/authorization" element={<AdminOnly><SystemAuthorizationPage /></AdminOnly>}') && page.includes('现行角色权限矩阵') && page.includes('业务模块权限边界') && page.includes('授权复核记录') && page.includes('确认已复核'));
check('authorization module matrix renders company ADMIN distinctly and does not mislabel invalid approval policy as admin-only', page.includes("type MatrixModule = { code: string; label: string; allowed: Array<ProjectRole | 'ADMIN'>; note: string }") && page.includes('moduleRoleNames[item]') && page.includes('已禁用（审批规则无效）'));
check('main sidebar contains only one system-management entry and details are in second-level workspace navigation', (layout.match(/label: '系统管理'/g) ?? []).length === 1 && layout.includes('const systemNavigation') && layout.includes('系统管理二级导航') && layout.includes('className="sidebar-navigation"') && layout.includes('systemNavigation.filter((item) => item.to !== \'/system\')'));
check('sidebar navigation and secondary nav both constrain overflow and preserve focus visibility', css.includes('.sidebar-navigation {') && css.includes('overflow-y: auto') && css.includes('.system-workspace-nav {') && css.includes('overflow-x: auto') && css.includes('.system-workspace-tab:focus-visible'));
check('dictionary category and item codes are suggested from displayed names and preserve manual edits', dictPage.includes('suggestCodeFromName(next, 80)') && dictPage.includes('if (!dictionaryCodeTouched)') && dictPage.includes('if (!itemCodeTouched)') && dictPage.includes('名称输入后自动推荐，可手动修改'));
check('parameter key is suggested from name and manual override is retained', paramPage.includes('suggestCodeFromName(next, 100)') && paramPage.includes('if (!keyTouched)') && paramPage.includes('setKeyTouched(true)'));
check('code suggestion normalizes Latin/digits, has safe unknown Han fallback and enforces minimum length', helper.includes('normalize(\'NFKC\')') && helper.includes('toUpperCase()') && helper.includes('codePointAt(0)') && helper.includes('const limit = Math.max(2') && helper.includes('return result;'));
check('data-quality action is a low-emphasis neutral control rather than primary button', governance.includes('system-quality-scan-trigger') && !governance.includes('className="button-primary" onClick={() => scanQuality.mutate()}') && css.includes('.system-quality-scan-trigger {') && css.includes('.system-quality-scan-trigger:hover:not(:disabled)'));
check('system management overview links authorization governance as a dedicated workbench', manager.includes('/system/authorization') && manager.includes('权限治理与授权复核'));
check('consolidated docs state module boundaries, project authorization and development/pre-production boundary',
  design.includes('模块化单体优先') && design.includes('项目授权') &&
  design.includes('只读') && design.includes('审计') &&
  acceptance.includes('当前仍需继续的开发工作') &&
  acceptance.includes('后续投产阶段事项（当前开发非阻塞）') &&
  /rc/i.test(acceptance));
check('release candidate gate includes this system workbench contract suite', rootPackage.scripts['validate:release-candidate'].includes('validate-system-workbench-v2.mjs'));
check('README and changelog describe current navigation, authorization review and code recommendation', readme.includes('核心业务约束') && changelog.startsWith('## v' + rootPackage.version) && changelog.includes('授权复核工作台'));

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} system workbench checks passed`);
if (failed.length) process.exitCode = 1;
