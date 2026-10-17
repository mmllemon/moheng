import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const failures = [];
let passed = 0;
function check(label, condition) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}

const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const server = await read('apps/api/src/server.ts');
const moduleRegistry = await read('apps/api/src/platform/module-registry.ts');
const appInfo = await read('apps/api/src/platform/app-info.ts');
const reportRoute = await read('apps/api/src/routes/reports.ts');
const reportData = await read('apps/api/src/lib/report-data.ts');
const notifyRoute = await read('apps/api/src/routes/notifications.ts');
const budgetRoute = await read('apps/api/src/routes/budget.ts');
const projectRoute = await read('apps/api/src/routes/projects.ts');
const csv = await read('apps/api/src/lib/csv-export.ts');
const csvTests = await read('apps/api/src/lib/csv-export.test.ts');
const app = await read('apps/web/src/App.tsx');
const layout = await read('apps/web/src/components/Layout.tsx');
const workspaceLayout = await read('apps/web/src/components/CostWorkspaceLayout.tsx');
const reportsPage = await read('apps/web/src/pages/ReportCenterPage.tsx');
const notificationsPage = await read('apps/web/src/pages/NotificationsPage.tsx');
const membersPage = await read('apps/web/src/pages/ProjectMembersPage.tsx');
const userManagementPage = await read('apps/web/src/pages/UserManagementPage.tsx');
const systemManagementPage = await read('apps/web/src/pages/SystemManagementPage.tsx');
const budgetPage = await read('apps/web/src/pages/BudgetPage.tsx');
const styles = await read('apps/web/src/styles.css');
const userManual = await read('docs/用户操作手册.md');
const devGuide = await read('docs/开发维护指南.md');
const plan = await read('docs/WP2-WP8实施计划与状态-v2.0.0-rc.1.md');
const acceptance = await read('docs/阶段验收记录-v2.0.0-rc.1.md');
const windowsGate = await read('scripts/windows/verify-release-candidate.ps1');
const e2eChecklist = await read('docs/WP8-Windows与浏览器端到端验收清单-v2.0.0-rc.1.md');

check('package and API versions agree on v2.19.0-rc.1 while retaining Node.js 24+ gate',
  rootPackage.version === '2.19.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version &&
  rootPackage.engines?.node === '>=24.0.0' && apiPackage.engines?.node === '>=24.0.0' && appInfo.includes("APP_VERSION = '2.19.0-rc.1'") && server.includes('version: APP_VERSION'));
check('release command combines original regression contracts, new WP checks and source audit coverage',
  rootPackage.scripts['validate:release-candidate'].includes('validate-release-candidate.mjs') &&
  rootPackage.scripts['validate:release-candidate'].includes('validate-v2-work-packages.mjs') &&
  rootPackage.scripts['validate:release-candidate'].includes('check-audit-coverage.mjs'));
check('eight standard CSV report types are declared and routed behind authenticated API',
  ['target-cost','actual-cost','progress-bills','changes','owner-receivables','owner-receipts','downstream-contracts','downstream-payables'].every((key) => reportData.includes(`'${key}'`)) &&
  reportRoute.includes('preHandler: authRequired') && moduleRegistry.includes("mountPrefix: '/api/reports'"));
check('report export filters project IDs on the server and rejects inaccessible explicit project scope',
  reportData.includes("members: { some: { userId: user.sub } }") && reportData.includes('availableIds.includes(filters.projectId)') && reportData.includes('PROJECT_ACCESS_DENIED'));
check('CSV export applies BOM, quoting, formula neutralization and unit test coverage',
  csv.includes('\\uFEFF') && csv.includes('replace(/"/g,') && csv.includes("text = `'${text}`") &&
  csvTests.includes('formula cells') && csvTests.includes('quotes'));
check('target-cost import shows column mapping, row-level errors and second server preflight before commit',
  budgetPage.includes('suggestImportMapping') && budgetPage.includes('字段映射') && budgetPage.includes('重新校验映射') &&
  budgetPage.includes('/budget/import/preview') && budgetPage.includes('if (!preflight.canImport)') && budgetPage.includes('/budget/import') && budgetRoute.includes('import-csv/preview'));
check('target-cost import preview checks existing codes, duplicate rows and parent-before-child references',
  budgetRoute.includes('在导入文件中重复') && budgetRoute.includes('已存在于当前项目') && budgetRoute.includes('位于子级之后') && budgetRoute.includes('IMPORT_PARENT_MISSING'));
check('project member management belongs to project management and preserves server-side role assignment checks',
  app.includes('path="projects/members" element={<NeedProject><ProjectMembersPage /></NeedProject>}') &&
  app.includes("suffix === '/members' ? '/projects/members'") && !workspaceLayout.includes('项目成员与权限') &&
  membersPage.includes('/members') && projectRoute.includes('MEMBER_ROLE_ASSIGNMENT_FORBIDDEN'));
check('system account management is separated from project-member and project-role operations',
  app.includes('path="system/accounts" element={<AdminOnly><UserManagementPage /></AdminOnly>}') && app.includes('path="settings/users" element={<LegacySettingsUsersRedirect />}') &&
  layout.includes("to: '/system/accounts', label: '账号管理'") && systemManagementPage.includes('系统管理概览') && userManagementPage.includes('创建系统账号') && userManagementPage.includes('系统账号列表') &&
  !userManagementPage.includes('当前项目角色关联') && !userManagementPage.includes('assignRole') &&
  membersPage.includes('添加项目成员') && membersPage.includes('角色调整'));
check('member role changes preserve the project-owner invariant and write audit records',
  projectRoute.includes('PROJECT_OWNER_REQUIRED') && projectRoute.includes("entity: 'ProjectMember'") &&
  projectRoute.includes("action: existing ? 'PROJECT_MEMBER_ROLE_UPDATED' : 'PROJECT_MEMBER_ADDED'"));
check('live notifications are scoped to accessible projects and cover high-risk ledger tasks',
  notifyRoute.includes("members: { some: { userId: user.sub } }") && notifyRoute.includes('OVERDUE_RECEIVABLE') &&
  notifyRoute.includes('OVERDUE_PAYABLE') && notifyRoute.includes('CHANGE_EVIDENCE') &&
  notifyRoute.includes('CONTRACT_EXPIRING') && notifyRoute.includes('TARGET_COST_OVERRUN'));
check('notification UI labels the list as dynamic tasks, not persistent read/unread messages',
  notificationsPage.includes('不是已读/未读通知') && notificationsPage.includes('refetchInterval: 120000') &&
  notificationsPage.includes('severity-${item.severity}') && notificationsPage.includes('setSelectedProjectId(item.projectId)') && notificationsPage.includes('ErrorBlock'));
check('report and notification centers are routable, searchable in command palette, and globally scoped in header',
  app.includes('path="reports" element={<ReportCenterPage />') && app.includes('path="notifications" element={<NotificationsPage />') &&
  layout.includes("to: '/reports'") && layout.includes("to: '/notifications'") &&
  layout.includes("location.pathname.startsWith('/reports') ? '全局报表中心'") && layout.includes("location.pathname === '/notifications' ? '跨项目待办与预警'") && app.includes('path="reports/designer"'));
check('budget drafts are browser-local only and do not save until explicit form submission',
  budgetPage.includes('moheng:budget-draft:') && budgetPage.includes('localStorage.setItem(draftKey') &&
  budgetPage.includes('点击“保存条目”后才会写入正式台账') && budgetPage.includes('await api.post(`/projects/${projectId}/budget/items`'));
check('source schemas and database migrations remain intentionally unchanged by this work package',
  plan.includes('本轮不修改 Prisma Schema / migration') && acceptance.includes('未修改 Prisma Schema、数据库迁移') &&
  !moduleRegistry.includes('reportJobRoutes') && !moduleRegistry.includes('offlineSyncRoutes'));
check('reduced-motion and responsive rules cover new report, notification, and member views',
  styles.includes('.report-center-page') && styles.includes('.notifications-page') && styles.includes('.project-members-page') &&
  styles.includes(':root[data-motion="reduced"]') && styles.includes('@media (max-width: 760px)'));
check('WP8 checklist includes runtime/build, Prisma/database, browser, Windows and restore gates',
  plan.includes('Node.js 24+') && plan.includes('Prisma') && plan.includes('浏览器 E2E') &&
  plan.includes('Windows 原生') && plan.includes('备份恢复') && acceptance.includes('WP8 阻塞说明'));
check('Windows WP8 script enforces Node 24+, reproducible dependency installation, build/test/Prisma gates and opt-in migrations',
  windowsGate.includes('Node.js 24') && windowsGate.includes('npm.cmd') && windowsGate.includes("'ci'") &&
  windowsGate.includes("'validate'") && windowsGate.includes("'db:generate'") && windowsGate.includes("'lint'") &&
  windowsGate.includes("'test'") && windowsGate.includes("'build'") && windowsGate.includes('$ApplyDatabaseMigrations') &&
  windowsGate.includes('HealthUrl'));

check('WP8 manual E2E checklist covers import, project authorization, finance reversals, alerts, backups and Windows ACL',
  e2eChecklist.includes('八种 CSV 报表') && e2eChecklist.includes('最后一名 OWNER') &&
  e2eChecklist.includes('退款冲销') && e2eChecklist.includes('公式样本') &&
  e2eChecklist.includes('备份恢复') && e2eChecklist.includes('NTFS ACL') && e2eChecklist.includes('Gate 签署'));

check('user and developer documentation clearly distinguish CSV, drafts, alerts and incomplete release gates',
  userManual.includes('报表中心') && userManual.includes('本地草稿') && userManual.includes('待办与预警') &&
  devGuide.includes('v2.0.0-rc.1') && devGuide.includes('CSV') && devGuide.includes('Node.js 24+'));

console.log(`\n${passed}/${passed + failures.length} WP2–WP8 source contracts passed.`);
if (failures.length) process.exitCode = 1;
