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
const workspace = await read('apps/web/src/components/ProjectWorkspaceLayout.tsx');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');
const design = await read('docs/报表中心与报表工作室设计方案-v2.6.0-rc.1.md');
const acceptance = await read('docs/WP11-报表中心瘦身与导航校正验收清单-v2.6.0-rc.1.md');

check('release package/API/Web/runtime metadata consistently use v2.6.0-rc.1',
  rootPackage.version === '2.6.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes("APP_VERSION = '2.6.0-rc.1'"));
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
check('project members navigation no longer lives inside cost/downstream business tabs',
  !workspace.split('const costTabs = [')[1]?.split('];')[0]?.includes("'/workspace/members'") && workspace.includes('const projectAdminTabs') && workspace.includes("to: '/workspace/members', label: '项目成员与权限'") && workspace.includes('aria-label="项目管理"'));
check('sidebar health indicator without data semantics is removed and replaced by a functioning dashboard link',
  !layout.includes('经营健康度') && layout.includes('打开当前项目驾驶舱') || (!layout.includes('经营健康度') && layout.includes("onClick={() => navigate('/workspace')}")));
check('documentation discusses the health indicator as non-metric and records navigation/report layout changes',
  design.includes('经营健康度') && design.includes('没有真实数据') && design.includes('项目成员与权限') && acceptance.includes('报表中心') && acceptance.includes('经营健康度'));

console.log(`\n${passed}/${passed + failures.length} UI polish checks passed.`);
if (failures.length) process.exitCode = 1;
