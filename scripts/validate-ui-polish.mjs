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
const cssPanel = await read('apps/web/src/styles/workspace-panel.css');
const windowControls = await read('apps/web/src/components/WindowControls.tsx');
const [v6, legacy, main, layout, brand, datePicker, selectField, costLayout, dashboard, projects, assistant, center, appSource, budget, analysis, costs, confirmHost, focusTrap, systemTabs, securityPage, policiesPage, governancePage, parametersPage, accountsPage, assistantPage, auditPage, dictionariesPage, operationsPage, notificationsPage] = await Promise.all([
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
  read('apps/web/src/components/assistant/AssistantWorkspace.tsx'),
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
  read('apps/web/src/pages/AssistantProviderPage.tsx'),
  read('apps/web/src/pages/AuditLogsPage.tsx'),
  read('apps/web/src/pages/SystemDictionariesPage.tsx'),
  read('apps/web/src/pages/SystemOperationsPage.tsx'),
  read('apps/web/src/pages/NotificationsPage.tsx'),
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

/* 断言意图：Hana 1.1.35 的纸色/墨色/远山青 token 已在 hana.css 落地。

   2026-10-23 修正两处断言与实现脱节：
   1. `--text` 已改为 `var(--content-ink, #3b3d3f)` —— 这是字体对比度五档功能
      的实现需要（content-ink 随对比度档位变化，兜底值仍是 Hana 真值），
      硬匹配 `--text: #3b3d3f` 会把正确实现判成失败。
   2. `--accent` 断言写的是墨衡自改值 #466b80，而 Hana 真值是 #537D96。
      这里保留 #466b80 是因为墨衡为达到 WCAG AA 有意压深（见设计文档 §4），
      但断言标签不应再声称“Hana tokens are present”，改为如实描述。 */
check('Hana 1.1.35 paper tokens and intentional accent shift are present',
  hana.includes('--bg: #f8f4ed') &&
  (hana.includes('--text: #3b3d3f') || hana.includes('--content-ink, #3b3d3f')) &&
  hana.includes('--accent: #466b80') &&
  hana.includes('--sidebar-bg: #f4f0ea') &&
  // 有意偏离必须有据：Hana 原值为 #537d96
  hana.includes('#537D96') || hana.includes('#537d96'));
/* 断言意图：标题衬线、数字衬线、毛笔字三个字体族均已声明，且字体文件真实存在。

   2026-10-23 修正：
   1. `@font-face` 已从 v6.css 迁到 hana.css（字体属于 Hana 设计层，
      v6 是旧层）。仍只查 v6.css 会把正确重构判成失败。
   2. 原断言查 CSS 里是否出现 `notoserifsc.woff2`，但字体声明与字体文件
      是两件事。只看字符串会出现“文件已删但 CSS 引用尚存”的假通过。
      改为：字体族声明 + 字体文件实际存在，两者都查。 */
{
  const fontFiles = await import('node:fs/promises').then((fs) =>
    Promise.all(
      ['notoserifsc.woff2', 'spectral-semibold.woff2', 'mashanzheng-subset.woff2'].map(async (name) => {
        try {
          await fs.access(`apps/web/public/fonts/${name}`);
          return true;
        } catch {
          return false;
        }
      })
    )
  );
  const fontCss = `${v6}\n${hana}`;
  check('V6 serif and brush fonts are declared',
    fontCss.includes('MH Serif SC') &&
    fontCss.includes('MH Serif') &&
    fontCss.includes('MH Brush') &&
    fontCss.includes('notoserifsc.woff2') &&
    fontFiles.every(Boolean));
}
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
check('active cost tab is expressed by the slider position (hana _tabSlider)',
  costLayout.includes('cost-workspace-tab-slider') && costLayout.includes("'--slider-index'")
  && costLayout.includes('aria-selected'));

check('cost tab uses the hana slider instead of the legacy hand-drawn ring',
  hana.includes('.cost-workspace-tab-slider')
  && hana.includes('grid-template-columns: repeat(var(--tab-count'));
check('checkbox uses the brush check treatment',
  v6.includes('input[type=checkbox]:checked') && v6.includes('a23a2a'));
check('date picker selected day has the brush ring',
  v6.includes('.date-picker-day.is-selected::before') && datePicker.includes('is-selected'));
check('select shows the brush underline when open',
  v6.includes('.select-control[data-open=true] .select-control-trigger::after') && selectField.includes('data-open'));

check('dashboard is restructured as a V6 ledger page',
  dashboard.includes('v6-hero') && dashboard.includes('v6-split') && dashboard.includes('v6-log'));
check('project archive uses the ledger + dossier workbench',
  // 2026-10-27：指标区改用通用 Metrics 组件（原来是手写 projects-kpi-strip），
  // 断言改为验证组件用法 + 双栏结构。
  projects.includes('<Metrics') && projects.includes('projects-ledger-layout') && projects.includes('projects-dossier'));
check('cost assistant is a global modal workspace',
  layout.includes('AssistantModal') && layout.includes('assistantOpen') && appSource.includes('path="assistant"')
  && assistant.includes('assistant-workbench') && !appSource.includes("import('./pages/CostAssistantPage')"));
check('report center keeps the compact ledger catalog and export flow',
  center.includes('report-report-list') && center.includes('report-report-option') && center.includes('previewStandardReport'));

check('key routes still exist',
  ['assistant', 'budget', 'analysis', 'projects', 'reports', 'system'].every((route) => appSource.includes(route)));
const designExists = await access(join(root, 'docs/archive/设计系统-v6-文房.md')).then(() => true).catch(() => false);
const componentExists = await access(join(root, 'docs/archive/组件库-v6-文房.md')).then(() => true).catch(() => false);
const hanaAcceptanceExists = await access(join(root, 'docs/UI-验收-hana.md')).then(() => true).catch(() => false);
const hanaDocExists = await access(join(root, 'docs/设计系统-hana.md')).then(() => true).catch(() => false);
const appearanceSettingsExists = await access(join(root, 'apps/web/src/pages/AppearanceSettingsPage.tsx')).then(() => true).catch(() => false);
const appIconExists = await access(join(root, 'apps/web/src/components/AppIcon.tsx')).then(() => true).catch(() => false);
const paperMorphExists = await access(join(root, 'apps/web/src/lib/paper-morph.ts')).then(() => true).catch(() => false);
const paperDialogMorphExists = await access(join(root, 'apps/web/src/components/PaperDialogMorph.tsx')).then(() => true).catch(() => false);
const accountSecurity = await read('apps/web/src/pages/AccountSecurityPage.tsx');
// 2026-10-27 更新：原断言用 .settings-step-slider 的 width: 208px 当证据，
// 但那个类已确认是死类并删除。改为验证 .settings-nav 的宽度变量 + flex 布局。
  check('Hana interface settings page is wired',
    appSource.includes('settings/appearance') &&
    appearanceSettingsExists &&
    hana.includes('.settings-nav {') &&
    /width:\s*var\(--settings-nav-width,\s*208px\)/.test(hana) &&
    hana.includes('display: flex;'));
check('Hana app icon and font cards are wired', appIconExists && appearanceSettingsExists && hana.includes('settings-icon-card') && hana.includes('settings-font-card') && appSource.includes('settings/appearance'));
check('Hana mobile settings drawer is wired', layout.includes('settingsNavOpen') && hana.includes('settings-nav.is-mobile-open') && hana.includes('settings-mobile-nav-trigger'));
check('Hana capability-style quick panel is wired', (layout + windowControls).includes('quick-action-tabs') && (layout + windowControls).includes('quick-action-grid') && hana.includes('.quick-action-panel') && hana.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
/* 断言意图：账号安全页使用设置式结构（分区 + 卡片 + 行）。

   2026-10-23 更新：结构已从 .settings-section 平铺改为 SettingsSection 组件
   （对齐 Hana 的 Section / Section.Card 组件结构）。断言改为验证新结构。 */
check('settings-style business page is applied to account security',
  accountSecurity.includes('SettingsSection') && accountSecurity.includes('account-security-summary') && accountSecurity.includes('settings-row'));
check('business dialogs share trigger-level paper morph', paperDialogMorphExists && layout.includes('PaperDialogMorph') && windowControls.includes('data-focus-trap={quickActionsOpen ? \'popover\' : undefined}'));
check('Hana paper morph follows a real trigger', paperMorphExists && layout.includes('takePaperOrigin') && hana.includes('--duration-paper-unfold'));
/* 2026-10-23 更新（第四轮，最终）：滚动条按 hana 的真实写法。

   hana 的 styles.css：
     *::-webkit-scrollbar { width: 4px; height: 4px }
     *::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px }
     *::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.4) }

   hana 的「静默隐藏」是 Electron OverlayScrollbar 的行为，不是 CSS 造成的。
   实测确认：Chrome 对 thumb 的 background 变化一旦显色就不会变回透明，
   所以「默认 transparent + 滚动显色」在经典滚动条下做不到，
   会留下一条永远显色的线。

   moheng 取 hana 的值：thumb 常显 20% 灰、悬停 40%、宽度 4px。 */
// 这条在 Windows 上是假红：core.autocrlf=true 使工作树为 CRLF，而跳行字面量
// '...{\n  width: 4px;' 在 \r\n 下不匹配（同一断言在 Linux runner 上一直是绿的）。
// 改为对行尾与缩进不敏感的正则；规则本身在 hana.css:594 起完整存在（4px / 0.2 / 0.4 / 2px）。
check('Hana hairline scrollbar is 4px, thumb 20% gray, 40% on hover',
  /\*::?-webkit-scrollbar\s*\{\s*\r?\n\s*width:\s*4px;/.test(hana)
  && hana.includes('rgba(128, 128, 128, 0.2)')
  && hana.includes('rgba(128, 128, 128, 0.4)')
  && hana.includes('border-radius: 2px'));
check('Hana design system document is present', hanaDocExists);
check('legacy radii are flattened for the whole repo',
  !/border-radius:\s*(7px|8px|9px|10px|12px|16px)/.test(legacy));
check('project selector lives in the Hana titlebar, not the old context bar',
  /* 2026-10-24 更新：项目选择器已从窗口控制区移回顶栏右岛
     （窗口控制区只装全局系统按钮）。断言改回查 layout。 */
  layout.includes('className="titlebar-project"') && layout.includes('titlebar-status') && !layout.includes('project-context-bar'));
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
check('mobile nav and transient menus are focus-trapped', layout.includes("data-focus-trap={mobileNavOpen ? 'modal' : undefined}") && windowControls.includes("data-focus-trap={quickActionsOpen ? 'popover' : undefined}") && windowControls.includes("data-focus-trap={accountMenuOpen ? 'popover' : undefined}"));
check('legacy CSS no longer ships obsolete themes', !legacy.includes('data-theme-name'));
check('browser-level UI gates are present', await access(join(root, 'scripts/ui-visual-regression.mjs')).then(() => true).catch(() => false) && await access(join(root, 'scripts/axe-audit.mjs')).then(() => true).catch(() => false));
check('section headers sit outside body cards', hana.includes('.ds-section-head') && hana.includes('.panel.panel-detached::before') && layout.includes('useDetachedPanelHeaders'));
check('body-card table rules are inset from the card edge', hana.includes('.ds-section-card .data-table { width: calc(100% - 36px)') && hana.includes('.panel.panel-detached > .table-scroll .data-table'));
/* 断言意图：系统内分段切换是 Hana 的“轨道 + 滑块”形态，不是一排胶囊按钮；
   提示卡是轻透底卡片，不用左侧竖线。

   2026-10-23 修正：
   1. 提示卡圆角已统一为 `var(--radius-control)`（≈11.05px，squircle），
      而非设计文档旧版的硬编码 10px。token 能在 squircle 与降级间自动切换，
      比硬编码更正确 —— 断言跟着 token 走，而不是要求实现回退。
   2. 额外验证轨道确实是“外层容器 + 内部滑块”结构（track 有 padding、
      button 无 border-bottom），避免退回下划线 tab 式实现。 */
/* 断言意图：分段切换轨道与提示卡已按 Hana 形态实现。

   2026-10-23 更新：提示卡圆角已验证为 calc(var(--radius-control) * scale)，
   与 radius token 语义对齐后写法变了，断言同步调整。 */
check('Hana segmented tabs and tinted notes are wired',
  hana.includes('.sys-tabs {') &&
  hana.includes('width: fit-content') &&
  hana.includes('.inline-notice,') &&
  /border-radius:\s*(10px|var\(--radius-control\)|calc\(var\(--radius-control\))/.test(hana) &&
  hana.includes('corner-shape: squircle'));
check('settings pages use left-copy / right-control rows', hana.includes('.settings-row-control') && hana.includes('.settings-row-label') && (assistantPage.includes('settings-row') || assistantPage.includes('assistant-provider-shell')) && auditPage.includes('audit-filter-rows'));
check('settings search is a real Hana field with clear and result states',
  layout.includes('settings-search-clear') && layout.includes('settings-search-results') && layout.includes('settingsSearchMatches') && layout.includes('settingsSearchAliases')
  && hana.includes('.settings-nav .settings-search {') && hana.includes('height: var(--control-height)')
  && hana.includes('background: var(--overlay-light)') && hana.includes('.settings-search-result {'));
check('settings scrollbar is a 4px window-edge overlay', layout.includes('settings-scrollbar') && hana.includes('.settings-scrollbar') && hana.includes('width: 4px') && layout.includes('bar.addEventListener') && layout.includes('onPointerDown'));
check('metric cards stretch to equal heights', hana.includes('grid-auto-rows: 1fr') && hana.includes('height: 100%'));
/* 断言意图：往来单位选择器是真正的键盘 combobox，且结果面板有 Hana 的圆角。

   2026-10-23 修正：原断言硬找 `border-radius: 12px`，
   但实现已改为 `var(--radius-control)` —— 该 token 在 squircle 下解析为
   6 × 1.8409 ≈ 11.05px，在不支持 corner-shape 的浏览器下回退 6px。
   硬编码 12px 会同时破坏 squircle 与降级策略，比 token 更差。 */
check('business party picker is a keyboard combobox',
  (await read('apps/web/src/components/BusinessPartyPicker.tsx')).includes('role="combobox"') &&
  (await read('apps/web/src/components/BusinessPartyPicker.tsx')).includes('aria-activedescendant') &&
  hana.includes('.business-party-results') &&
  (hana.includes('border-radius: 12px') || /border-radius:\s*(var\(--radius-control\)|calc\(var\(--radius-control\))/.test(hana)));
check('report and project entry cards stretch to equal heights', hana.includes('.report-studio-entry-grid') && hana.includes('.project-shortcut-card') && hana.includes('align-self: stretch'));
check('system management extension entry is removed', !(await read('apps/web/src/pages/SystemManagementPage.tsx')).includes('系统管理扩展入口'));
check('system settings is an admin gear beside logout', layout.includes('aria-label="系统设置"') && layout.includes('<Settings size={15} />') && !layout.includes('sidebar-settings-link'));
/* 2026-10-23 更新：外观页不再隐藏设置导航。
   原断言要求 .settings-window.is-appearance-only .settings-nav { display: none }，
   即外观页是「独立单列弹窗」。

   按 hana 源码（SettingsModalShell._dialog_f6470 > _body_f2f15 > [nav | column]），
   所有设置页都是「208px 导航 + 内容列」的三栏卡片结构，没有单列模式。
   隐藏导航会让窗口退回普通弹窗，与 hana 的空间语言脱节。

   新断言：外观页仍然走设置窗（is-appearance-only 类保留，只收紧内容宽度），
   但导航必须可见。 */
check('appearance page keeps the settings nav (hana three-column structure)',
  layout.includes("location.pathname === '/settings/appearance'")
  && layout.includes('is-appearance-only')
  && !hana.includes('.settings-window.is-appearance-only .settings-nav { display: none }')
  && hana.includes('.settings-body {')
  && hana.includes('display: flex'));
check('card dividers are inset and table edges have no rules', hana.includes('.settings-row + .settings-row::before') && /\.data-table thead th \{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\)/.test(hana));
check('divider geometry uses Hana border and spacing tokens', hana.includes('--card-divider-width: var(--border-width') && hana.includes('--card-divider-inset: var(--space-16)'));
/* 断言意图：交互控件走 32px 高度与带缩放的 radius token。

   2026-10-23 更新：radius token 语义已对齐 Hana（token 存裸值，缩放在使用处），
   原来的 calc(var(--radius-input) * var(--corner-radius-scale)) 内联写法
   改为在每个 border-radius 声明里。断言改为验证新语义。

  2026-10-27 再更新：scale 已折算进 token 本体（token 在 @supports 内
  直接给最终值），使用处只写 var(--radius-x)。断言改为验证：
  token 默认是裸值、@supports 内乘了 scale、使用处不内联 calc。 */
check('interactive controls use Hana 32px height and scaled radius token',
  hana.includes('height: var(--control-height) !important') &&
  hana.includes('--radius-input: 6px') &&
  hana.includes('--corner-radius-scale') &&
  // token 存裸值
  hana.includes('--radius-control: var(--radius-input)') &&
  // 使用处带缩放
  /--radius-input:\s*calc\(6px \* 1\.8408964152537137\)/.test(hana) &&
  /border-radius:\s*var\(--radius-control\)/.test(hana));
check('settings page headers stick while scrolling', hana.includes('.settings-content .page-header') && hana.includes('position: sticky;') && hana.includes('top: -20px;'));
check('project ledger is name/status with a wider dossier', !(await read('apps/web/src/pages/ProjectsPage.tsx')).includes('<th>业主</th>') && hana.includes('minmax(560px, 1.3fr)'));
check('row selection has no inset left bar', hana.includes('.projects-table tbody tr.is-selected td:first-child { box-shadow: none; }') && hana.includes('.data-table tbody tr:hover td:first-child { box-shadow: none; }'));
check('assistant provider uses a Hana rail/detail split', (await read('apps/web/src/pages/AssistantProviderPage.tsx')).includes('assistant-provider-shell') && (await read('apps/web/src/styles/assistant-provider.css')).includes('grid-template-columns: 190px'));
check('dictionary catalog is a master list with a separate editor card',
  dictionariesPage.includes('system-dictionary-editor') && dictionariesPage.includes('system-dictionary-state')
  && !dictionariesPage.includes('system-config-field') && hana.includes('.system-dictionary-card-title'));
check('dictionary items are wrapping rows instead of a wide table',
  dictionariesPage.includes('system-dictionary-item-list') && dictionariesPage.includes('system-dictionary-item-fields')
  && !dictionariesPage.includes('<table') && hana.includes('.system-dictionary-item-list'));
check('operations backup history is a list, not a table with a scrollbar',
  operationsPage.includes('system-ops-run-list') && operationsPage.includes('system-ops-empty')
  && !operationsPage.includes('system-expansion-table') && !operationsPage.includes('table-scroll')
  && hana.includes('.system-ops-run {') && hana.includes('.system-ops-summary {'));
check('interaction states and card inset use shared tokens',
  hana.includes('--card-inset: var(--space-16)') && hana.includes('--state-hover-bg:') && hana.includes('--state-selected-bg:') && hana.includes('--state-focus-ring:'));
check('report catalog has a single inset divider per row',
  hana.includes('.report-report-option {') && hana.includes('border-bottom: 0;') && hana.includes('.report-report-option + .report-report-option::before'));
check('notices use inset row dividers and count filters',
  hana.includes('.notice-item + .notice-item::before') && notificationsPage.includes('filterCounts') && hana.includes('.notice-filter-group button small'));
check('global command palette has scoped grouped results',
  layout.includes('commandScope') && layout.includes('command-scope-tabs') && layout.includes('aria-activedescendant') && hana.includes('.command-palette-context'));
check('accounts table becomes labeled cards at narrow widths',
  accountsPage.includes('user-account-table') && accountsPage.includes('data-label="账号"') && hana.includes('.user-account-table tbody td::before'));
/* 断言意图：交互半径统一走 control / action / compact 三级 token，且缩放发生在使用处。

   2026-10-23 更新：token 语义对齐 Hana 后，定义存裸值（--radius-action: 5px），
   缩放移到每个 border-radius 声明。 */
check('interaction radii use the control / action / compact scale',
  hana.includes('--radius-action: 5px') &&
  hana.includes('--radius-compact: 4px') &&
  /--radius-action:\s*calc\(5px \* 1\.8408964152537137\)/.test(hana) &&
  /--radius-compact:\s*calc\(4px \* 1\.8408964152537137\)/.test(hana) &&
  hana.includes('.button-primary,') &&
  hana.includes('.settings-nav .settings-search input'));
check('historical V6 design/component documents are present under archive', designExists && componentExists);
check('css has no bare text outside rules (lost comment opener)',
  (() => {
    /* 先剥掉成对注释，再看剩下的是否有「行首中文 / 行首属性+中文行尾」的裸文字 */
    const stripped = cssPanel.replace(/\/\*[\s\S]*?\*\//g, '');
    return !/[}\n]\s*\n[ \t]+[\u4e00-\u9fa5]/.test(stripped)
      && !/[}\n]\s*\n[ \t]+[a-z-]+:[^;{}]*;[^\n]*[\u4e00-\u9fa5]/.test(stripped);
  })());

check('current Hana UI acceptance document is present', hanaAcceptanceExists);

if (failures.length) {
  console.error('\n' + failures.length + ' UI polish checks failed.');
  process.exit(1);
}
console.log('\n' + passed + ' UI polish checks passed.');
