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
const reportStudio = await read('apps/web/src/pages/ReportStudioPage.tsx');
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
check('shared date/select triggers use common geometry, typography, focus ring and popover radius',
  styles.includes('--control-height: 38px;') && styles.includes('--control-focus-ring:') &&
  styles.includes('.select-control-trigger, .date-picker-trigger {') &&
  styles.includes('box-shadow: var(--control-focus-ring)') &&
  styles.includes('border-radius: var(--control-popover-radius)') &&
  styles.includes('min-height: var(--control-height-compact)') &&
  styles.includes('.date-picker-trigger { font-variant-numeric: tabular-nums; }'));
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
check('report studio blocks bindings into non-anchor merged cells before save',
  reportStudio.includes('snapshotDefinition().workbook') &&
  reportStudio.includes('合并单元格绑定必须指向合并区域左上角') &&
  reportStudio.includes('coordinate.row !== merge.startRow || coordinate.column !== merge.startColumn'));
check('select search control is outside a semantic listbox containing only option rows',
  !selectField.includes("className={`select-popover ${presence.visible ? 'is-visible' : 'is-closing'}`}\n      role=\"listbox\"") &&
  !selectField.includes("ref={popupRef}\n      id={`select-options-${controlId}`}") &&
  selectField.includes("id={`select-options-${controlId}`} className=\"select-option-list\" role=\"listbox\"") &&
  selectField.includes("aria-controls={`select-options-${controlId}`}"));
check('select empty-result status is announced outside the listbox and active descendants never target disabled options',
  selectField.includes('className="select-option-empty" role="status" aria-live="polite"') &&
  !selectField.includes(': <div className="select-option-empty">') &&
  selectField.includes('if (activeOption && !activeOption.disabled) return;') &&
  selectField.includes('index === activeIndex && !option.disabled') &&
  (selectField.match(/visibleOptions\[activeIndex\] && !visibleOptions\[activeIndex\]!.disabled/g) ?? []).length === 2);

check('shared select and date popovers close on keyboard focus exit without putting every option in the Tab sequence',
  selectField.includes("document.addEventListener('focusin', onFocusIn)") &&
  selectField.includes("document.removeEventListener('focusin', onFocusIn)") &&
  datePicker.includes("document.addEventListener('focusin', onFocusIn)") &&
  datePicker.includes("document.removeEventListener('focusin', onFocusIn)") &&
  selectField.includes('role="option"\n          tabIndex={-1}\n          aria-selected={option.value === selectedValue}') &&
  selectField.includes('if (wrapperRef.current?.contains(target) || popupRef.current?.contains(target)) return;') &&
  datePicker.includes('if (wrapperRef.current?.contains(target) || popupRef.current?.contains(target)) return;'));
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
  datePicker.includes('monthIntersectsIsoDateBounds') &&
  datePickerUtils.includes('monthIntersectsIsoDateBounds') &&
  datePickerUtilsTests.includes('controlled values normalize to the nearest valid min/max boundary') &&
  datePickerUtilsTests.includes('contradictory bounds never become a keyboard focus target') &&
  datePickerUtilsTests.includes('calendar navigation cannot move into a month with no enabled date'));
check('design docs enforce neutral professional visual language and record navigation/report cleanup',
  design.includes('色彩不是装饰品') && design.includes('150ms ~ 350ms') &&
  acceptance.includes('项目成员与权限') && acceptance.includes('报表中心') &&
  acceptance.includes('经营健康度') && acceptance.includes('项目驾驶舱'));

check('global keyboard focus rings follow the active accent theme rather than a hard-coded hue',
  styles.includes(':where(button, a, input, select, textarea):focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-500) 80%, transparent); outline-offset: 2px; }') &&
  !styles.includes('rgba(81, 105, 216, .75)') &&
  styles.includes('--control-focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent-500) 12%, transparent)'));

check('minimum readable typography removes 8px/9px text declarations',
  styles.includes('--text-2xs: 11px;') &&
  !['font-size: 8px', 'font-size:8px', 'font-size: 9px', 'font-size:9px'].some((token) => styles.includes(token)));
check('font weights follow the standard 400/500/600/700 scale',
  !['font-weight: 550', 'font-weight:550', 'font-weight: 650', 'font-weight:650', 'font-weight: 750', 'font-weight:750', 'font-weight: 800', 'font-weight:800'].some((token) => styles.includes(token)));
check('muted text and sidebar tokens use contrast-strengthened values across four themes',
  styles.includes('--text-muted: #606d80;') &&
  styles.includes('--text-secondary: #475569; --text-muted: #606d80;') &&
  styles.includes('--text-secondary: #57534e; --text-muted: #6f6457;') &&
  styles.includes('--text-secondary: #a1a1aa; --text-muted: #9999a3;') &&
  styles.includes('--text-secondary: #335c67; --text-muted: #4e7184;') &&
  styles.includes('--sidebar-muted: #5f6b7c;') &&
  styles.includes('--sidebar-muted: #766a5d;') &&
  styles.includes('--sidebar-muted: #9696a1;') &&
  styles.includes('--sidebar-muted: #4e7184;'));
check('Obsidian primary actions use contrast-safe dark accent backgrounds',
  styles.includes(':root[data-theme-name="obsidian"] .button-primary { background: var(--accent-600); border-color: var(--accent-600); }') &&
  styles.includes('--accent-600: #5558d8;') &&
  styles.includes('--accent-600: #257b66;') &&
  styles.includes('--accent-600: #ad4030;'));

check('theme rendering uses one canonical attribute to prevent stale dark surfaces after a theme switch',
  !styles.includes(':root[data-theme="dark"]') &&
  styles.includes(':root[data-theme-name="obsidian"] .app-shell') &&
  !/root\.dataset\.theme\s*=/.test((await read('apps/web/src/components/UiPreferencesBar.tsx'))) &&
  (await read('apps/web/src/components/UiPreferencesBar.tsx')).includes('root.dataset.themeName = resolved'));
check('business-party summary, profile, metrics and identity details use shared theme tokens',
  styles.includes('.business-party-summary-strip { display: flex; align-items: center; gap: 22px; padding: 14px 17px; border: 1px solid var(--card-border); border-radius: var(--radius-card); background: var(--card-bg); }') &&
  styles.includes('.business-party-profile-title h2 { margin: 0; color: var(--neutral-800);') &&
  styles.includes('.business-party-metric { display: grid; gap: 7px; min-width: 0; padding: 14px; border: 1px solid var(--card-border); border-radius: var(--radius-card); background: var(--card-bg); }') &&
  styles.includes('.business-party-info-grid span { color: var(--text-muted);') &&
  !styles.includes('color: #253247; font-size: 20px; letter-spacing: -.025em;'));
check('primary action foreground contrast uses the stronger accent-600 background across themes',
  styles.includes('.button-primary { color: white; background: var(--accent-600); border-color: var(--accent-600);') &&
  styles.includes('.breadcrumb { display: flex; align-items: center; min-width: 0; gap: 10px; color: var(--text-muted);'));
console.log(`\n${passed}/${passed + failures.length} UI polish checks passed.`);
if (failures.length) process.exitCode = 1;
