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

const center = await read('apps/web/src/pages/ReportCenterPage.tsx');
const styles = await read('apps/web/src/styles.css');
const layout = await read('apps/web/src/components/Layout.tsx');
const datePicker = await read('apps/web/src/components/DatePicker.tsx');
const selectField = await read('apps/web/src/components/SelectField.tsx');
const workspace = await read('apps/web/src/components/CostWorkspaceLayout.tsx');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');
const design = await read('docs/设计系统规范-Pro-Tier-Suite-v4.2.0.md');
const acceptance = await read('docs/后续四阶段开发路线图.md');
const datePickerUtils = await read('apps/web/src/components/date-picker-utils.ts');
const datePickerUtilsTests = await read('apps/web/src/components/date-picker-utils.test.ts');
const corePagePaths = [
  "apps/web/src/pages/AccountSecurityPage.tsx",
  "apps/web/src/pages/AccountSecurityStepPage.tsx",
  "apps/web/src/pages/AnalysisPage.tsx",
  "apps/web/src/pages/AuditLogsPage.tsx",
  "apps/web/src/pages/BudgetPage.tsx",
  "apps/web/src/pages/BusinessPartiesPage.tsx",
  "apps/web/src/pages/BusinessPartyDetailPage.tsx",
  "apps/web/src/pages/ChangesPage.tsx",
  "apps/web/src/pages/ContractsPage.tsx",
  "apps/web/src/pages/CostsPage.tsx",
  "apps/web/src/pages/CostAssistantPage.tsx",
  "apps/web/src/pages/DashboardPage.tsx",
  "apps/web/src/pages/DownstreamContractsPage.tsx",
  "apps/web/src/pages/DownstreamFinancePage.tsx",
  "apps/web/src/pages/DownstreamWorkspacePage.tsx",
  "apps/web/src/pages/LoginPage.tsx",
  "apps/web/src/pages/NotificationsPage.tsx",
  "apps/web/src/pages/OwnerFinancePage.tsx",
  "apps/web/src/pages/ProgressBillsPage.tsx",
  "apps/web/src/pages/ProjectMembersPage.tsx",
  "apps/web/src/pages/ProjectOverviewPage.tsx",
  "apps/web/src/pages/ProjectsPage.tsx",
  "apps/web/src/pages/ReportCenterPage.tsx",
  "apps/web/src/pages/ReportDesignerPage.tsx",
  "apps/web/src/pages/ReportPreviewPage.tsx",
  "apps/web/src/pages/ReportStudioPage.tsx",
  "apps/web/src/pages/SystemAuthorizationPage.tsx",
  "apps/web/src/pages/SystemDictionariesPage.tsx",
  "apps/web/src/pages/SystemGovernancePage.tsx",
  "apps/web/src/pages/SystemManagementPage.tsx",
  "apps/web/src/pages/SystemOperationsPage.tsx",
  "apps/web/src/pages/SystemParametersPage.tsx",
  "apps/web/src/pages/SystemPoliciesPage.tsx",
  "apps/web/src/pages/SystemSecurityPage.tsx",
  "apps/web/src/pages/UserManagementPage.tsx"
];
const corePageSources = await Promise.all(corePagePaths.map(read));

const expectedVersion = rootPackage.version;
const validReleaseVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion);
check(`release package/API/Web/runtime metadata consistently use ${expectedVersion}`,
  validReleaseVersion && apiPackage.version === expectedVersion && webPackage.version === expectedVersion && appInfo.includes(`APP_VERSION = '${expectedVersion}'`));
check('report center removes redundant intro cards and repeated hero banner',
  !center.includes('report-intro-grid') && !center.includes('report-center-hero') && !center.includes('report-library'));
check('report center has a single compact ledger catalog rather than duplicated report-type selector and large cards',
  center.includes('report-report-list') && center.includes('report-report-option') && center.includes('visibleCatalog') && !center.includes('报表类型</span>'));
check('project and company studio entry buttons show clear click affordance',
  center.includes('打开项目级工作室') && center.includes('打开公司级工作室') && center.includes('ArrowRight') && center.includes('aria-label="综合报表设计入口"'));
check('ledger export options and preview remain available from the selected report configuration',
  center.includes('预览并导出 XLSX') && center.includes('导出 CSV') && center.includes('设计报表模板') && center.includes('previewStandardReport'));
check('report center responsive layout stacks under constrained widths and provides focus-visible cues',
  styles.includes('.report-standard-layout { display: grid; grid-template-columns: minmax(250px, .88fr) minmax(0, 1.45fr);') && styles.includes('@media (max-width: 1120px)') && styles.includes('.report-studio-entry-card:focus-visible') && styles.includes('.report-report-option:focus-visible'));
check('report workspace honors reduced-motion preferences',
  styles.includes('@media (prefers-reduced-motion: reduce), :root[data-motion="reduced"]') && styles.includes('.report-studio-entry-card, .report-report-option, .sidebar-note { transition: none !important; }'));
check('project members navigation is absent from cost workspace tabs and the tabs identify the cost workbench',
  !workspace.includes('项目成员与权限') && !workspace.includes('/system/members') && workspace.includes('aria-label="成本工作台业务导航"') && layout.includes("to: '/projects/members', label: '项目成员与权限'") && layout.includes("to: '/system', label: '系统管理'") && layout.includes("to: '/system', label: '概览'") && layout.includes("'经营中心', '工作台', '项目管理', '系统管理'"));
check('sidebar health indicator without data semantics is removed and replaced by a functioning dashboard link',
  !layout.includes('经营健康度') && layout.includes('打开当前项目驾驶舱') || (!layout.includes('经营健康度') && layout.includes("onClick={() => navigate('/cost')}")));
check('core business pages use shared date/select controls instead of unstyled native controls',
  corePageSources.every((source) => !/<select\b/i.test(source) && !/type\s*=\s*["']date["']/i.test(source)));
check('shared date and select controls expose popup relationships, labels, and validation state',
  datePicker.includes('date-picker-dialog-') &&
  datePicker.includes('id={id ? `${id}-native` : undefined}') && datePicker.includes('id={id}') &&
  selectField.includes('id={id ? `${id}-native` : undefined}') && selectField.includes('id={id}') &&
  datePicker.includes("aria-labelledby={props['aria-labelledby']}") &&
  datePicker.includes('aria-current={today ?') &&
  selectField.includes("aria-labelledby={props['aria-labelledby']}") &&
  selectField.includes("aria-errormessage={props['aria-errormessage']}") &&
  datePicker.includes("props['aria-invalid'] === 'true'") &&
  selectField.includes("props['aria-invalid'] === 'true'"));
check('date picker keyboard movement skips disabled dates and preserves focusable range boundaries',
  datePicker.includes('while (isDisabled(asIsoDate(next)) && attempts < 3660)') &&
  datePicker.includes('if (isDisabled(asIsoDate(next))) return;') &&
  datePicker.includes('setFocusedDate(nextValue)'));
check('controlled date picker keeps focus inside externally updated bounds without resetting on month navigation',
  datePicker.includes('normalizeIsoDateWithinBounds(selectedValue, min == null ? null : String(min), max == null ? null : String(max))') &&
  datePicker.includes('if (!focusValue)') &&
  datePicker.includes('setViewDate((current) =>') &&
  datePicker.includes('setFocusedDate((current) => current === focusValue ? current : focusValue)') &&
  datePicker.includes('[selectedValue, min, max]') &&
  datePicker.includes('openCalendar()') &&
  datePickerUtils.includes('normalizeIsoDateWithinBounds') &&
  datePickerUtils.includes('isIsoDateWithinBounds') &&
  datePickerUtilsTests.includes('controlled values normalize to the nearest valid min/max boundary') &&
  datePickerUtilsTests.includes('contradictory bounds never become a keyboard focus target'));
check('design docs enforce neutral professional visual language and record navigation/report cleanup',
  design.includes('色彩不是装饰品') && design.includes('150ms ~ 350ms') &&
  acceptance.includes('项目成员与权限') && acceptance.includes('报表中心') &&
  acceptance.includes('经营健康度') && acceptance.includes('项目驾驶舱'));

console.log(`\n${passed}/${passed + failures.length} UI polish checks passed.`);
if (failures.length) process.exitCode = 1;
