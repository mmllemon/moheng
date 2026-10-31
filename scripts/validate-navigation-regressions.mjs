import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModuleSources } from './lib/module-sources.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const failures = [];
let passed = 0;
function check(label, condition) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
const preview = await read('apps/web/src/pages/ReportPreviewPage.tsx');
const studio = await read('apps/web/src/pages/ReportStudioPage.tsx');
const launch = await read('apps/web/src/components/ReportLaunchButton.tsx');
const center = await read('apps/web/src/pages/ReportCenterPage.tsx');
const designer = await read('apps/web/src/pages/ReportDesignerPage.tsx');
const overview = await read('apps/web/src/pages/ProjectOverviewPage.tsx');
const workspace = await read('apps/web/src/components/CostWorkspaceLayout.tsx');
const app = await read('apps/web/src/App.tsx');
const layout = await readModuleSources(root, 'apps/web/src/components/Layout.tsx');
const systemManagement = await read('apps/web/src/pages/SystemManagementPage.tsx');
const styles = await read('apps/web/src/styles.css');
const xlsx = await read('apps/api/src/lib/report-studio-xlsx.ts');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');

check('all package and runtime versions agree with the current candidate',
  apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes(`APP_VERSION = '${rootPackage.version}'`));
check('preview back uses known router history only when explicitly marked and a safe internal fallback otherwise',
  preview.includes('routeState?.safeReportPreviewBack === true') && preview.includes('navigate(safeReturnTo, { replace: true })') && preview.includes("?? '/reports'") && preview.includes("!candidate.startsWith('//')"));
check('project summary auto-preview carries source route and replaces one-shot studio entry',
  launch.includes("autoPreview: '1', returnTo") && studio.includes('replace: automatic') && studio.includes('navigate(`/reports/preview?${params.toString()}`, { replace: true') && studio.includes("params.delete('autoPreview')"));
check('studio manual preview returns to a clean editor path with its saved template ID',
  studio.includes('cleanStudioPath(saved.id)') && studio.includes('params.set(\'templateId\', savedTemplateId)') && studio.includes('safeReportPreviewBack: canGoBackInHistory'));
check('standard report center, ledger entry points and legacy designer carry explicit return targets',
  launch.includes("state: { safeReportPreviewBack: true, returnTo }") && center.includes("state: { safeReportPreviewBack: true, returnTo }") && designer.includes("state: { safeReportPreviewBack: true, returnTo }") && center.includes("params.set('returnTo', returnTo)"));
check('no other route uses a raw history-back operation outside the centralized preview handler',
  (preview.match(/navigate\(-1\)/g) ?? []).length === 1 && !(launch + center + designer + studio).includes('navigate(-1)'));
check('project overview chart reserves Y-axis labels and uses ECharts containLabel',
  overview.includes('grid: { left: 68, right: 18, top: 22, bottom: 34, containLabel: true }') && overview.includes("axisLabel: { color: '#8792a4', margin: 10, hideOverlap: true") && styles.includes('.project-cost-trend-panel, .project-attention-panel'));
check('cost workbench owns the cost layout and no longer contains member-management navigation',
  workspace.includes('export default function CostWorkspaceLayout()') && workspace.includes('aria-label="成本工作台业务导航"') && !workspace.includes('项目成员与权限') && !workspace.includes('/system/members') && styles.includes('.cost-workspace-tabs') && !styles.includes('.project-workspace-tabs'));
check('ExcelJS font builder correctly models incremental font-property assignment',
  xlsx.includes('const font: Partial<ExcelJS.Font> = {};'));
check('system management has independent landing/member routes and legacy workspace URLs redirect safely',
  layout.includes("to: '/system', label: '系统管理'") && layout.includes("to: '/system', label: '概览'") && layout.includes("to: '/projects/members', label: '项目成员与权限'") && layout.includes("to: '/system/accounts', label: '账号管理'") && layout.includes("to: '/system/security', label: '登录安全'") && layout.includes("to: '/audit-logs', label: '操作追溯'") && layout.includes("'经营中心', '工作台', '项目管理', '系统管理'") && systemManagement.includes('系统管理概览') && systemManagement.includes('系统管理扩展入口') && app.includes('path="projects/members"') && app.includes('path="system/members" element={<Navigate to="/projects/members" replace />}') && app.includes('path="system/accounts"') && app.includes('path="system/security"') && app.includes('path="account/security"') && app.includes('path="settings/users" element={<LegacySettingsUsersRedirect />}') && app.includes("pathname: '/system/accounts'") && app.includes('path="workspace" element={<LegacyWorkspaceRedirect />}') && app.includes('path="workspace/*" element={<LegacyWorkspaceRedirect />}') && app.includes("suffix === '/members' ? '/projects/members'") && layout.includes('/account/security'));
check('canonical cost workbench route and source identifiers use cost terminology',
  app.includes('path="cost" element={<NeedProject><CostWorkspaceLayout /></NeedProject>}') && layout.includes("to: '/cost', label: '成本工作台'") && workspace.includes('cost-workspace-tab') && launch.includes("source: 'cost-workspace'") && !layout.includes("label: '项目工作台'"));
check('consolidated report design records preview/export consistency, workspace and print/export constraints',
  (await read('docs/报表中心规格与验收.md')).includes('预览') &&
  (await read('docs/报表中心规格与验收.md')).includes('XLSX') &&
  (await read('docs/报表中心规格与验收.md')).includes('列宽') &&
  (await read('docs/后续四阶段开发路线图.md')).includes('项目驾驶舱'));

console.log(`\n${passed}/${passed + failures.length} navigation/UI/XLSX regression checks passed.`);
if (failures.length) process.exitCode = 1;
