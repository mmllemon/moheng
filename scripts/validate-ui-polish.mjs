import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const failures = [];
let passed = 0;
function check(label, condition) {
  if (condition) { passed += 1; console.log('PASS ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}

const hana = await read('apps/web/src/styles/hana.css');
const [v6, legacy, main, layout, brand, datePicker, selectField, costLayout, dashboard, projects, assistant, center, appSource, budget, analysis, costs, confirmHost, focusTrap, systemTabs, securityPage, policiesPage, governancePage, parametersPage, accountsPage] = await Promise.all([
  read('apps/web/src/styles/v6.css'),
  read('apps/web/src/styles/legacy.css'),
  read('apps/web/src/main.tsx'),
  read('apps/web/src/components/Layout.tsx'),
  read('apps/web/src/components/BrandMark.tsx'),
  read('apps/web/src/components/DatePicker.tsx'),
  read('apps/web/src/components/SelectField.tsx'),
  read('apps/web/src/components/CostWorkspaceLayout.tsx'),
  read('apps/web/src/pages/DashboardPage.tsx'),
  read('apps/web/src/pages/ProjectsPage.tsx'),
  read('apps/web/src/pages/CostAssistantPage.tsx'),
  read('apps/web/src/pages/ReportCenterPage.tsx'),
  read('apps/web/src/App.tsx'),
  read('apps/web/src/pages/BudgetPage.tsx'),
  read('apps/web/src/pages/AnalysisPage.tsx'),
  read('apps/web/src/pages/CostsPage.tsx'),
  read('apps/web/src/components/ConfirmDialog.tsx'),
  read('apps/web/src/components/FocusTrap.tsx'),
  read('apps/web/src/components/SystemTabs.tsx'),
  read('apps/web/src/pages/SystemSecurityPage.tsx'),
  read('apps/web/src/pages/SystemPoliciesPage.tsx'),
  read('apps/web/src/pages/SystemGovernancePage.tsx'),
  read('apps/web/src/pages/SystemParametersPage.tsx'),
  read('apps/web/src/pages/UserManagementPage.tsx'),
]);
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');
const expectedVersion = rootPackage.version;
const pageFiles = (await readdir(join(root, 'apps/web/src/pages'))).filter((file) => file.endsWith('.tsx'));
const pageSources = await Promise.all(pageFiles.map((file) => read('apps/web/src/pages/' + file)));
const nativeDialogs = pageSources.filter((source) => /window\.(confirm|prompt)/.test(source)).length;

check('release metadata uses ' + expectedVersion,
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)
  && apiPackage.version === expectedVersion
  && webPackage.version === expectedVersion
  && appInfo.includes("APP_VERSION = '" + expectedVersion + "'"));

check('Hana 1.1.35 paper / ink / seal tokens are present',
  hana.includes('--bg: #f8f4ed') && hana.includes('--text: #3b3d3f') && hana.includes('--accent: #466b80') && hana.includes('--sidebar-bg: #f4f0ea'));
check('V6 serif and brush fonts are declared',
  v6.includes('MH Serif SC') && v6.includes('MH Serif') && v6.includes('MH Brush') && v6.includes('notoserifsc.woff2'));
check('Hana original rice / cotton / fine textures are wired',
  hana.includes('rice-mottle-hi.png') && hana.includes('cotton-mottle-hi.png') && hana.includes('fine-mottle-hi.png') && hana.includes('--paper-texture-strength'));
check('legacy styles are isolated in a cascade layer',
  legacy.trimStart().startsWith('@layer legacy') && legacy.trimEnd().endsWith('}'));
check('legacy !important declarations are removed for predictable overrides',
  !legacy.includes('!important'));
check('V6 stylesheet does not depend on !important',
  !v6.includes('!important'));
check('entrypoint loads tailwind, legacy and V6 in order',
  main.includes("import './styles.css';") && main.includes("import './styles/legacy.css';") && main.includes("import './styles/v6.css';") && main.includes("import './styles/hana.css';"));

check('brand mark is the carved vermilion seal with 墨',
  brand.includes('mhSealRough') && brand.includes('feTurbulence') && brand.includes('墨</text>'));
check('sidebar brand uses the brush wordmark and Chinese subtitle',
  layout.includes('BrandMark') && layout.includes('<strong>墨衡</strong>') && layout.includes('工程经营管理'));
check('mobile navigation drawer trigger and backdrop are present',
  layout.includes('titlebar-mobile-menu') && layout.includes('mobile-nav-backdrop') && layout.includes('mobileNavOpen'));
check('active cost tab auto-scrolls into view',
  costLayout.includes('cost-workspace-tab.active') && costLayout.includes('scrollTo'));

check('active cost tab suppresses the legacy hand-drawn ring',
  hana.includes('.cost-workspace-tab.active::before { display: none'));
check('checkbox uses the brush check treatment',
  v6.includes('input[type=checkbox]:checked') && v6.includes('a23a2a'));
check('date picker selected day has the brush ring',
  v6.includes('.date-picker-day.is-selected::before') && datePicker.includes('is-selected'));
check('select shows the brush underline when open',
  v6.includes('.select-control[data-open=true] .select-control-trigger::after') && selectField.includes('data-open'));

check('dashboard is restructured as a V6 ledger page',
  dashboard.includes('v6-hero') && dashboard.includes('v6-split') && dashboard.includes('v6-log'));
check('project archive uses the ledger + dossier workbench',
  projects.includes('projects-kpi-strip') && projects.includes('projects-ledger-layout') && projects.includes('projects-dossier'));
check('hidden assistant route has a V6 header and paper empty state',
  appSource.includes('assistant') && assistant.includes('<h1>成本助手</h1>') && assistant.includes('assistant-unavailable'));
check('report center keeps the compact ledger catalog and export flow',
  center.includes('report-report-list') && center.includes('report-report-option') && center.includes('previewStandardReport'));

check('key routes still exist',
  ['assistant', 'budget', 'analysis', 'projects', 'reports', 'system'].every((route) => appSource.includes(route)));
const designExists = await access(join(root, 'docs/设计系统-v6-文房.md')).then(() => true).catch(() => false);
const componentExists = await access(join(root, 'docs/组件库-v6-文房.md')).then(() => true).catch(() => false);
const hanaDocExists = await access(join(root, 'docs/设计系统-hana.md')).then(() => true).catch(() => false);
const appearanceSettingsExists = await access(join(root, 'apps/web/src/pages/AppearanceSettingsPage.tsx')).then(() => true).catch(() => false);
check('Hana interface settings page is wired', appSource.includes('settings/appearance') && appearanceSettingsExists && hana.includes('grid-template-columns: 208px 670px'));
check('Hana design system document is present', hanaDocExists);
check('legacy radii are flattened for the whole repo',
  !/border-radius:\s*(7px|8px|9px|10px|12px|16px)/.test(legacy));
check('project selector lives in the Hana titlebar, not the old context bar',
  layout.includes('className="titlebar-project"') && layout.includes('titlebar-global-scope') && !layout.includes('project-context-bar'));
check('budget uses the preview ledger drawer and filter segments',
  budget.includes('ldg-drawer') && budget.includes('ldg-segments'));
check('analysis uses the instrument grid',
  analysis.includes('an-grid') && analysis.includes('an-variance'));
check('costs no longer exposes a second cost-type select',
  !costs.includes('table-filter-select'));

check('native confirm/prompt are removed from all pages', nativeDialogs === 0);
check('confirm host and global focus trap are mounted', layout.includes('ConfirmHost') && layout.includes('FocusTrap'));
check('confirm host provides promise-based confirm and prompt', confirmHost.includes('confirmAction') && confirmHost.includes('promptAction'));
check('focus trap cycles Tab and inerts the background', focusTrap.includes('onKeyDown') && focusTrap.includes("setAttribute('inert'"));
check('danger token is not self-referential', hana.includes('--danger: #8b2c1f') && !hana.includes('--warning: var(--warning)'));
check('system governance pages share the local tab workbench', systemTabs.includes("role=\"tablist\"") && [securityPage, policiesPage, governancePage, parametersPage].every((page) => page.includes('SystemTabs')) && v6.includes('.sys-tabs'));
check('accounts page uses the split create/list workbench', accountsPage.includes('sys-split') && accountsPage.includes('sys-split-main'));
check('mobile nav and transient menus are focus-trapped', layout.includes("data-focus-trap={mobileNavOpen ? 'modal' : undefined}") && layout.includes("data-focus-trap={quickActionsOpen ? 'popover' : undefined}") && layout.includes("data-focus-trap={accountMenuOpen ? 'popover' : undefined}"));
check('legacy CSS no longer ships obsolete themes', !legacy.includes('data-theme-name'));
check('browser-level UI gates are present', await access(join(root, 'scripts/ui-visual-regression.mjs')).then(() => true).catch(() => false) && await access(join(root, 'scripts/axe-audit.mjs')).then(() => true).catch(() => false));
check('V6 design and component documents are present', designExists && componentExists);

if (failures.length) {
  console.error('\n' + failures.length + ' UI polish checks failed.');
  process.exit(1);
}
console.log('\n' + passed + ' UI polish checks passed.');
